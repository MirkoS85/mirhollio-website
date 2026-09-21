// Read the delegator book off the Flare C-chain.
//
// flare-base.io has been answering 502 since mid-September. It was the only
// source for who delegates here, so the published book froze - and a frozen
// book is worse than no book: a probe against the chain found one wallet the
// snapshot still credited with 18.3M WFLR that now delegates 2,599. An indexer
// going down is normal; having no second way to read state anyone can read is
// not.
//
// The book needs two different answers, and they need different sources.
//
//   Amounts. WNat.votePowerFromTo(delegator, provider) for each wallet and
//   votePowerOf(provider) for the total. Plain eth_call, batched, works on
//   every public endpoint. This is the part that matters and it is exact.
//
//   Discovery - which addresses to ask about. Delegations are announced by
//   events, but not on WNat: a Flare VPToken keeps its vote-power bookkeeping
//   in a separate VPContract and the events come from there, which is why a log
//   scan against WNat turns up nothing but ERC-20 transfers. Worse, the public
//   RPCs cap eth_getLogs at 1000 blocks per request (29 on the official one),
//   and Flare is past 70 million blocks - so whole-history discovery over RPC
//   would be seventy thousand requests. The block explorer answers the same
//   query in one paginated call, so history goes through it and the RPC only
//   covers the blocks since the last run.
//
// Discovery is therefore best-effort and never fatal. Seeded with the wallets
// the previous snapshot knew, the book is correct for them from the first run;
// discovery only adds wallets nobody had listed yet, and the page says while
// that is still incomplete.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  rpc, rpcBatch, ethCall, getLogs,
  padAddress, decodeUint, fromWei, topicToAddress
} from "./flare-rpc.mjs";
import { selector } from "./keccak.mjs";

// Published by Flare and identical on every Flare network.
const CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const WNAT_FALLBACK = "0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d";
const EXPLORER = process.env.FLARE_EXPLORER_URL || "https://flare-explorer.flare.network";

const SEL_GET_CONTRACT = selector("getContractAddressByName(string)");
const SEL_VOTE_POWER_FROM_TO = selector("votePowerFromTo(address,address)");
const SEL_VOTE_POWER_OF = selector("votePowerOf(address)");
const SEL_READ_VP_CONTRACT = selector("readVotePowerContract()");
const SEL_WRITE_VP_CONTRACT = selector("writeVotePowerContract()");

// ERC-20 Transfer also carries the recipient in topic 2, so it turns up in the
// scan. Filtering it out keeps the candidate file honest; a stray address would
// be harmless anyway, since it would read back a delegation of zero.
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const STATE_PATH = path.resolve("data/delegator-candidates.json");

const FIRST_RUN_LOOKBACK = Number(process.env.DELEGATION_FIRST_LOOKBACK || 50_000);
const DISCOVERY_BUDGET_MS = Number(process.env.DELEGATION_DISCOVERY_BUDGET_MS || 45_000);
const EXPLORER_PAGE_SIZE = 1000;
const EXPLORER_MAX_PAGES = 40;

// A revoked delegation can leave a few wei behind. Those wallets are not
// delegators in any sense a reader cares about, and a row reading "0.00" looks
// like a bug rather than like dust.
const MIN_AMOUNT_WFLR = Number(process.env.DELEGATION_MIN_AMOUNT || 0.01);

// Asking the explorer for all 70 million blocks at once earns a Cloudflare 504:
// the query is too expensive for one request. It is walked backwards in windows
// instead, and the window shrinks when a request times out.
const EXPLORER_WINDOW = Number(process.env.DELEGATION_EXPLORER_WINDOW || 2_000_000);
const EXPLORER_MIN_WINDOW = 100_000;

// Most of Flare's history predates this provider entirely, and no amount of
// walking will find a delegation that could not have happened. The walk stops
// a margin before the earliest delegation anything has ever recorded here.
const HISTORY_MARGIN_DAYS = Number(process.env.DELEGATION_HISTORY_MARGIN_DAYS || 120);

// data/ftso-delegations.json has carried millisecond timestamps since Flare Base
// wrote it, and the page reads them that way. Everything published here matches
// that rather than introducing a second convention in the same file.
function toMillis(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e11 ? Math.round(n * 1000) : Math.round(n);
}

const lower = value => String(value || "").toLowerCase();
const isAddress = value => /^0x[0-9a-f]{40}$/.test(lower(value)) && !/^0x0+$/.test(lower(value));

async function readState() {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf8"));
  } catch (_) {
    return null;
  }
}

async function writeState(state) {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

const addressFromWord = word => `0x${String(word || "").replace(/^0x/, "").slice(-40).toLowerCase()}`;

/** Ask the registry where WNat lives rather than trusting a pasted address. */
async function resolveWNat() {
  const encodedName = Buffer.from("WNat", "utf8").toString("hex").padEnd(64, "0");
  const data = `${SEL_GET_CONTRACT}${(32).toString(16).padStart(64, "0")}${(4).toString(16).padStart(64, "0")}${encodedName}`;
  try {
    const [result] = await rpcBatch([ethCall(CONTRACT_REGISTRY, data)]);
    const address = addressFromWord(result);
    if (isAddress(address)) return address;
  } catch (_) {
    // fall through
  }
  return lower(WNAT_FALLBACK);
}

/**
 * The contracts that actually emit delegation events. There are usually two
 * (a read and a write VPContract) and they are sometimes the same; Flare has
 * replaced them before, so any address ever seen is kept and re-scanned.
 */
async function resolveVpContracts(wnat, remembered = []) {
  const found = new Set(remembered.map(lower).filter(isAddress));
  try {
    const results = await rpcBatch([
      ethCall(wnat, SEL_READ_VP_CONTRACT),
      ethCall(wnat, SEL_WRITE_VP_CONTRACT)
    ]);
    results.map(addressFromWord).filter(isAddress).forEach(address => found.add(address));
  } catch (error) {
    console.log(`  VPContract lookup failed: ${error.message}`);
  }
  return [...found];
}

function collectDelegators(logs, into) {
  const topicCounts = new Map();
  for (const log of logs) {
    const topic0 = lower(log.topics?.[0]);
    topicCounts.set(topic0, (topicCounts.get(topic0) || 0) + 1);
    if (topic0 === TRANSFER_TOPIC) continue;
    const from = topicToAddress(log.topics?.[1]);
    if (!isAddress(from)) continue;
    const block = Number(BigInt(log.blockNumber));
    const seen = into.get(from);
    if (seen == null || block < seen) into.set(from, block);
  }
  return topicCounts;
}

function reportTopics(counts, indent = "    ") {
  for (const [topic, count] of counts) console.log(`${indent}topic ${topic}: ${count} logs`);
}

/**
 * Whole-history discovery through the block explorer. One paginated query per
 * contract instead of the seventy thousand eth_getLogs calls the same range
 * would take at the RPCs' 1000-block ceiling.
 */
async function discoverViaExplorer({ contracts, provider, cursor, window, streak: startStreak = 0, floor = 0, deadline }) {
  const providerTopic = `0x${padAddress(provider)}`;
  const found = new Map();
  const errors = [];
  let at = cursor;
  let span = Math.max(EXPLORER_MIN_WINDOW, window);
  // The streak carries across runs. One window is about all that fits in a
  // run's budget, so a counter that reset each time would never reach the
  // threshold and the window would stay at whatever size one timeout left it.
  let streak = startStreak;

  const query = async (contract, from, to, page) => {
    const url = new URL(`${EXPLORER}/api`);
    url.search = new URLSearchParams({
      module: "logs",
      action: "getLogs",
      address: contract,
      fromBlock: String(from),
      toBlock: String(to),
      topic2: providerTopic,
      page: String(page),
      offset: String(EXPLORER_PAGE_SIZE)
    }).toString();
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(45_000)
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
    const body = JSON.parse(text);
    if (body?.status === "0" && !/no logs found/i.test(String(body?.message || ""))) {
      throw new Error(`explorer said: ${body.message}`);
    }
    return Array.isArray(body?.result) ? body.result : [];
  };

  while (at >= floor) {
    if (Date.now() > deadline) {
      console.log(`  explorer: out of budget at block ${at}`);
      return { found, cursor: at, window: span, streak, complete: false, errors };
    }
    const from = Math.max(floor, at - span + 1);
    let windowFailed = false;

    for (const contract of contracts) {
      for (let page = 1; page <= EXPLORER_MAX_PAGES; page += 1) {
        let rows;
        try {
          rows = await query(contract, from, at, page);
        } catch (error) {
          errors.push(`${from}-${at} p${page}: ${error.message}`.slice(0, 220));
          console.log(`  explorer: ${from}-${at} page ${page} failed: ${error.message}`);
          windowFailed = true;
          break;
        }
        const counts = collectDelegators(rows, found);
        if (rows.length) console.log(`  explorer: ${from}-${at} page ${page} -> ${rows.length} logs, ${found.size} addresses so far`);
        if (page === 1 && counts.size) reportTopics(counts);
        if (rows.length < EXPLORER_PAGE_SIZE) break;
      }
      if (windowFailed) break;
    }

    if (windowFailed) {
      // Too much to chew at once. Take a smaller bite of the same range rather
      // than skipping it, and give up for this run if we are already at the
      // smallest window the walk is worth doing in.
      if (span <= EXPLORER_MIN_WINDOW) {
        return { found, cursor: at, window: span, streak: 0, complete: false, errors };
      }
      span = Math.max(EXPLORER_MIN_WINDOW, Math.floor(span / 4));
      streak = 0;
      console.log(`  explorer: narrowing the window to ${span} blocks`);
      continue;
    }

    // Log density varies enormously across history - most of it holds nothing
    // for this provider - so a window that was too wide in a busy stretch is
    // fine in a quiet one. Widen again once the current size has proved itself.
    streak += 1;
    if (streak >= 2 && span < EXPLORER_WINDOW) {
      span = Math.min(EXPLORER_WINDOW, span * 4);
      streak = 0;
      console.log(`  explorer: widening the window to ${span} blocks`);
    }

    at = from - 1;
  }

  return { found, cursor: at, window: span, streak, complete: true, errors };
}

/** The blocks since the last run, straight from the RPCs. Small by design. */
async function discoverViaRpc({ contracts, provider, fromBlock, toBlock, deadline }) {
  const providerTopic = `0x${padAddress(provider)}`;
  const found = new Map();
  let reached = Number(toBlock);

  for (const contract of contracts) {
    try {
      // No filter on topic 0: any event from the vote-power contract whose
      // second indexed argument is this provider identifies a delegator,
      // whatever the event happens to be called.
      const result = await getLogs({
        address: contract,
        topics: [null, null, [providerTopic]],
        fromBlock,
        toBlock,
        deadline
      });
      reportTopics(collectDelegators(result.logs, found));
      if (!result.complete) reached = Math.min(reached, Number(result.reached));
    } catch (error) {
      console.log(`  rpc scan of ${contract} failed: ${error.message}`);
      reached = Math.min(reached, Number(fromBlock) - 1);
    }
  }
  return { found, reached };
}

function mergeCandidates(candidates, found) {
  let added = 0;
  for (const [address, block] of found) {
    const existing = candidates.get(address);
    if (!existing) {
      candidates.set(address, { firstBlock: block });
      added += 1;
    } else if (block < (existing.firstBlock ?? Infinity)) {
      existing.firstBlock = block;
    }
  }
  return added;
}

/**
 * The block below which a delegation to this provider cannot exist, worked out
 * from the earliest one anything has recorded plus a wide margin. The block
 * rate is measured from two real blocks rather than assumed, because a wrong
 * constant here would silently truncate the search.
 */
async function historyFloor(chainHead, earliestMillis) {
  if (!Number.isFinite(earliestMillis) || earliestMillis <= 0) return 0;
  const probe = Math.max(0, chainHead - 1_000_000);
  try {
    const [top, older] = await rpcBatch([
      { method: "eth_getBlockByNumber", params: [`0x${BigInt(chainHead).toString(16)}`, false] },
      { method: "eth_getBlockByNumber", params: [`0x${BigInt(probe).toString(16)}`, false] }
    ]);
    const topTime = Number(BigInt(top.timestamp)) * 1000;
    const olderTime = Number(BigInt(older.timestamp)) * 1000;
    const msPerBlock = (topTime - olderTime) / (chainHead - probe);
    if (!(msPerBlock > 0)) return 0;
    const target = earliestMillis - HISTORY_MARGIN_DAYS * 86_400_000;
    const floor = Math.floor(chainHead - (topTime - target) / msPerBlock);
    return Math.max(0, floor);
  } catch (error) {
    console.log(`  block-rate probe failed, walking to genesis: ${error.message}`);
    return 0;
  }
}

/** Attach a wall-clock timestamp to the blocks we just discovered. */
async function blockTimestamps(blocks) {
  const unique = [...new Set(blocks)].filter(Number.isFinite);
  if (!unique.length) return new Map();
  const results = await rpcBatch(unique.map(block => ({
    method: "eth_getBlockByNumber",
    params: [`0x${BigInt(block).toString(16)}`, false]
  })), 50);
  const out = new Map();
  unique.forEach((block, index) => {
    const timestamp = results[index]?.timestamp;
    if (timestamp) out.set(block, Number(BigInt(timestamp)));
  });
  return out;
}

/**
 * The live delegator book, or null if the chain could not be read at all.
 *
 * `seedAddresses` are delegators already known from another source. They are
 * probed alongside anything discovery turns up, so the book is right for them
 * even on a run where discovery fails completely.
 */
export async function readOnChainDelegators({ provider, seeds = [], epoch = null }) {
  const providerAddress = lower(provider);
  const state = await readState();
  const started = Date.now();
  const deadline = started + DISCOVERY_BUDGET_MS;

  const wnat = state?.wnat || await resolveWNat();
  const latest = Number(BigInt(await rpc("eth_blockNumber")));
  const contracts = await resolveVpContracts(wnat, state?.vpContracts || []);
  console.log(`  chain head ${latest}, WNat ${wnat}`);
  console.log(`  vote-power contracts: ${contracts.join(", ") || "none resolved"}`);

  const candidates = new Map(
    Object.entries(state?.candidates || {}).map(([address, value]) => [lower(address), { ...value }])
  );
  const discovery = { explorer: null, rpc: null };

  // Whole history, once. After it has succeeded there is nothing to repeat:
  // anything new arrives in the forward window below.
  let historyComplete = Boolean(state?.historyComplete);
  let explorerCursor = Number.isFinite(state?.explorerCursor) ? state.explorerCursor : latest;
  let explorerWindow = Number.isFinite(state?.explorerWindow) ? state.explorerWindow : EXPLORER_WINDOW;
  let historyFloorBlock = Number.isFinite(state?.historyFloorBlock) ? state.historyFloorBlock : null;
  let explorerStreak = Number.isFinite(state?.explorerStreak) ? state.explorerStreak : 0;
  if (contracts.length && !historyComplete) {
    const knownDates = [...candidates.values()]
      .map(meta => Number(meta.firstSeen))
      .filter(value => Number.isFinite(value) && value > 0);
    const seedDates = seeds
      .map(seed => toMillis(seed?.firstSeen))
      .filter(Boolean);
    const earliest = Math.min(...knownDates, ...seedDates, Infinity);
    const floor = Number.isFinite(state?.historyFloorBlock)
      ? state.historyFloorBlock
      : await historyFloor(latest, Number.isFinite(earliest) ? earliest : null);
    historyFloorBlock = floor;
    console.log(`  history floor: block ${floor}${floor ? "" : " (genesis)"}`);

    const result = await discoverViaExplorer({
      contracts, provider: providerAddress,
      cursor: explorerCursor, window: explorerWindow, streak: explorerStreak, floor, deadline
    });
    const added = mergeCandidates(candidates, result.found);
    historyComplete = result.complete;
    explorerCursor = result.cursor;
    explorerWindow = result.window;
    explorerStreak = result.streak;
    discovery.explorer = {
      found: result.found.size, added, complete: result.complete,
      cursor: result.cursor, window: result.window, errors: result.errors
    };
    console.log(`  explorer discovery: ${result.found.size} addresses, ${added} new, ${result.complete ? "complete" : `down to block ${result.cursor}`}`);
  }

  // Everything since the last run.
  const forwardFrom = Number.isFinite(state?.scannedToBlock)
    ? state.scannedToBlock + 1
    : Math.max(0, latest - FIRST_RUN_LOOKBACK);
  let scannedToBlock = forwardFrom - 1;
  if (contracts.length && forwardFrom <= latest) {
    const result = await discoverViaRpc({
      contracts, provider: providerAddress,
      fromBlock: forwardFrom, toBlock: latest, deadline
    });
    const added = mergeCandidates(candidates, result.found);
    scannedToBlock = Math.max(scannedToBlock, result.reached);
    discovery.rpc = { from: forwardFrom, to: result.reached, found: result.found.size, added };
    console.log(`  rpc discovery ${forwardFrom}-${result.reached}: ${result.found.size} addresses, ${added} new`);
  }

  // Seeds bring their own first-seen dates. Those matter: a wallet that has
  // delegated here for two years shows up in the forward window the moment it
  // tops up, and dating it from that block would have the table claim it
  // arrived today.
  for (const seed of seeds) {
    const key = lower(seed?.from ?? seed);
    if (!isAddress(key)) continue;
    const known = toMillis(seed?.firstSeen);
    const entry = candidates.get(key) || { firstBlock: null, seeded: true };
    if (known) entry.firstSeen = Math.min(entry.firstSeen ?? Infinity, known);
    candidates.set(key, entry);
  }
  if (!candidates.size) {
    console.log("  no candidate addresses at all; nothing to read");
    return null;
  }

  // ── the exact part: what each candidate delegates right now ───────────────
  const addresses = [...candidates.keys()];
  const amounts = await rpcBatch(addresses.map(address => ethCall(
    wnat,
    `${SEL_VOTE_POWER_FROM_TO}${padAddress(address)}${padAddress(providerAddress)}`
  )));
  const [totalRaw] = await rpcBatch([ethCall(wnat, `${SEL_VOTE_POWER_OF}${padAddress(providerAddress)}`)]);
  const total = fromWei(decodeUint(totalRaw));

  const active = [];
  addresses.forEach((address, index) => {
    const amount = fromWei(decodeUint(amounts[index]));
    if (!Number.isFinite(amount) || amount < MIN_AMOUNT_WFLR) return;
    active.push({ address, amount, meta: candidates.get(address) });
  });
  const listed = active.reduce((sum, row) => sum + row.amount, 0);
  console.log(`  ${active.length} active delegators of ${addresses.length} candidates`);
  console.log(`  listed ${listed.toFixed(0)} of ${total?.toFixed(0)} WFLR total (${total ? ((listed / total) * 100).toFixed(2) : "?"}%)`);

  if (!active.length) return null;

  // Only date a wallet from the block we found it in once the history walk has
  // finished. Before that, all we have scanned is a window of recent blocks, so
  // the first event we saw is the first event *we* saw - dating a two-year-old
  // delegator from the day it happened to top up is worse than saying nothing.
  const undated = historyComplete
    ? active.filter(row => !Number.isFinite(row.meta.firstSeen) && Number.isFinite(row.meta.firstBlock))
    : [];
  if (undated.length) {
    try {
      const stamps = await blockTimestamps(undated.map(row => row.meta.firstBlock));
      undated.forEach(row => {
        const stamp = toMillis(stamps.get(row.meta.firstBlock));
        // Only ever move the date earlier.
        if (stamp) row.meta.firstSeen = Math.min(row.meta.firstSeen ?? Infinity, stamp);
      });
    } catch (error) {
      console.log(`  block timestamps failed: ${error.message}`);
    }
  }

  // "Change" on the page means change within the current reward epoch, so a
  // baseline is captured the first time each epoch is seen.
  const baseline = state?.baseline?.epoch === epoch && epoch != null
    ? state.baseline
    : {
        epoch,
        capturedAt: Date.now(),
        amounts: Object.fromEntries(active.map(row => [row.address, row.amount]))
      };

  const now = Date.now();
  const delegators = active
    .map(row => {
      const before = baseline.amounts?.[row.address];
      return {
        from: row.address,
        amount: row.amount,
        previous: Number.isFinite(before) ? before : null,
        share: total ? (row.amount / total) * 100 : null,
        firstSeen: Number.isFinite(row.meta.firstSeen) ? row.meta.firstSeen : null,
        lastSeen: now,
        firstBlock: row.meta.firstBlock ?? null,
        delta: Number.isFinite(before) ? row.amount - before : null,
        // Nothing at the epoch baseline and something now: this wallet arrived
        // during the epoch in progress.
        joined: !Number.isFinite(before) || before < MIN_AMOUNT_WFLR,
        hasPriorSnapshot: Number.isFinite(before)
      };
    })
    .sort((a, b) => b.amount - a.amount);

  // Wallets that were delegating at the epoch baseline and are not any more.
  // They drop out of `active` entirely, so without this the page can show that
  // the total fell without being able to say who left - which is exactly the
  // question an operator asks first.
  const stillHere = new Set(active.map(row => row.address));
  const departed = Object.entries(baseline.amounts || {})
    .filter(([address, amount]) => !stillHere.has(address) && Number(amount) >= MIN_AMOUNT_WFLR)
    .map(([address, amount]) => ({
      from: address,
      amount: 0,
      previous: Number(amount),
      share: 0,
      delta: -Number(amount),
      firstSeen: Number.isFinite(candidates.get(address)?.firstSeen) ? candidates.get(address).firstSeen : null,
      lastSeen: now,
      joined: false,
      departed: true,
      hasPriorSnapshot: true
    }))
    .sort((a, b) => b.previous - a.previous);

  const flow = {
    epoch,
    baselineAt: baseline.capturedAt ?? null,
    joined: delegators.filter(row => row.joined).length,
    departed: departed.length,
    increased: delegators.filter(row => Number.isFinite(row.delta) && row.delta >= MIN_AMOUNT_WFLR).length,
    decreased: delegators.filter(row => Number.isFinite(row.delta) && row.delta <= -MIN_AMOUNT_WFLR).length,
    netChange: delegators.reduce((sum, row) => sum + (Number(row.delta) || 0), 0)
      - departed.reduce((sum, row) => sum + row.previous, 0)
  };
  console.log(`  epoch ${epoch} flow: +${flow.joined} joined, -${flow.departed} left, ${flow.increased} up, ${flow.decreased} down, net ${Math.round(flow.netChange)} WFLR`);

  await writeState({
    generatedAt: new Date().toISOString(),
    provider: providerAddress,
    wnat,
    vpContracts: contracts,
    chainHead: latest,
    scannedToBlock,
    historyComplete,
    explorerCursor,
    explorerWindow,
    explorerStreak,
    historyFloorBlock,
    discovery,
    candidates: Object.fromEntries(candidates),
    baseline
  });

  return {
    delegators,
    departed,
    flow,
    total,
    listed,
    wnat,
    vpContracts: contracts,
    chainHead: latest,
    historyComplete,
    candidateCount: addresses.length
  };
}
