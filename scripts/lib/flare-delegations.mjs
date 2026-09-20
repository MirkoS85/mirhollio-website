// Read the delegator book straight off the Flare C-chain.
//
// Everything about who delegates to this provider used to come from
// flare-base.io. That host has been answering 502 to the CI runner since
// mid-September, which froze the delegator book a whole reward epoch behind
// while the page still had to claim the numbers were current. An indexer going
// down is a normal thing to happen; having no second way to read a number that
// is sitting in public chain state is not.
//
// So this reads the chain directly:
//
//   * WNat emits an event whose second indexed argument is the provider being
//     delegated to. Every address that has ever delegated here appears in the
//     first indexed argument of one of those logs, so scanning them gives the
//     candidate set.
//   * WNat.votePowerFromTo(delegator, provider) then gives each candidate's
//     current delegated amount, and votePowerOf(provider) the total.
//
// The candidate scan is the slow part - it has to cover all of Flare's
// history - so progress is kept in data/delegator-candidates.json and the
// backfill walks a bounded distance backwards on each run. Until it reaches
// genesis the book is seeded from the last published snapshot, so the page is
// complete from the first run rather than after the backfill finishes.
//
// Unlike a Flare Base snapshot, this is *live*: it reflects the chain right
// now, not the last reward-epoch vote-power block.

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

const SEL_GET_CONTRACT = selector("getContractAddressByName(string)");
const SEL_VOTE_POWER_FROM_TO = selector("votePowerFromTo(address,address)");
const SEL_VOTE_POWER_OF = selector("votePowerOf(address)");

// ERC-20 Transfer also carries the recipient in topic 2, so it turns up in the
// scan. Filtering it out keeps the candidate file honest; a stray address would
// be harmless anyway, since it would read back a delegation of zero.
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const STATE_PATH = path.resolve("data/delegator-candidates.json");

const FIRST_RUN_LOOKBACK = 200_000;     // ~4 days, enough to be useful immediately
// The publisher loop runs this inside a five-minute cycle alongside two other
// refreshes, so the history scan gets a slice rather than the whole cycle. Once
// the backfill has reached genesis this is not spent at all: the forward scan
// only covers the blocks since the last run.
const BACKFILL_BUDGET_MS = Number(process.env.DELEGATION_BACKFILL_BUDGET_MS || 45_000);
const LOG_SPAN = Number(process.env.DELEGATION_LOG_SPAN || 50_000);
const BACKFILL_STEP_BLOCKS = Number(process.env.DELEGATION_BACKFILL_STEP || 500_000);

const lower = value => String(value || "").toLowerCase();

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

/** Ask the registry where WNat lives rather than trusting a pasted address. */
async function resolveWNat() {
  const encodedName = Buffer.from("WNat", "utf8").toString("hex").padEnd(64, "0");
  const data = `${SEL_GET_CONTRACT}${(32).toString(16).padStart(64, "0")}${(4).toString(16).padStart(64, "0")}${encodedName}`;
  try {
    const [result] = await rpcBatch([ethCall(CONTRACT_REGISTRY, data)]);
    const address = `0x${String(result || "").replace(/^0x/, "").slice(-40)}`;
    if (/^0x[0-9a-f]{40}$/i.test(address) && !/^0x0+$/.test(address)) return address;
  } catch (_) {
    // fall through
  }
  return WNAT_FALLBACK;
}

/**
 * Collect addresses that appear as the delegator in WNat logs aimed at this
 * provider, over one block range. Returns the addresses with the earliest
 * block each was seen in, and whether the range was covered completely.
 */
async function scanDelegators({ wnat, provider, fromBlock, toBlock, deadline, label }) {
  const providerTopic = `0x${padAddress(provider)}`;
  const found = new Map();
  const topicCounts = new Map();

  // No filter on topic 0: any WNat event whose second indexed argument is this
  // provider identifies a delegator, whatever the event is called. That keeps
  // the scan from depending on one hashed event signature being right.
  const { logs, reached, complete } = await getLogs({
    address: wnat,
    topics: [null, null, [providerTopic]],
    fromBlock,
    toBlock,
    span: LOG_SPAN,
    deadline
  });

  for (const log of logs) {
    const topic0 = lower(log.topics?.[0]);
    topicCounts.set(topic0, (topicCounts.get(topic0) || 0) + 1);
    if (topic0 === TRANSFER_TOPIC) continue;
    const from = topicToAddress(log.topics?.[1]);
    const block = Number(BigInt(log.blockNumber));
    const seen = found.get(from);
    if (seen == null || block < seen) found.set(from, block);
  }

  console.log(`  ${label} ${fromBlock}-${toBlock}: ${complete ? "complete" : `stopped at ${reached}`}, ${found.size} addresses`);
  for (const [topic, count] of topicCounts) console.log(`    topic ${topic}: ${count} logs`);
  return { found, reached: Number(reached), complete };
}

function mergeCandidates(candidates, found) {
  for (const [address, block] of found) {
    const existing = candidates.get(address);
    if (!existing) candidates.set(address, { firstBlock: block });
    else if (block < (existing.firstBlock ?? Infinity)) existing.firstBlock = block;
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
 * The live delegator book, or null if the chain could not be read.
 *
 * `seedAddresses` are delegators already known from another source; they are
 * probed alongside anything the scan turns up, so a partly-finished backfill
 * never makes the book look smaller than it is.
 */
export async function readOnChainDelegators({ provider, seedAddresses = [], epoch = null }) {
  const providerAddress = lower(provider);
  const state = await readState();
  const wnat = state?.wnat || await resolveWNat();
  const latest = Number(BigInt(await rpc("eth_blockNumber")));
  console.log(`  chain head ${latest}, WNat ${wnat}`);

  const candidates = new Map(
    Object.entries(state?.candidates || {}).map(([address, value]) => [lower(address), { ...value }])
  );
  const started = Date.now();

  // Forward: everything since the last run. Small, and always completes.
  const forwardFrom = Number.isFinite(state?.scannedToBlock)
    ? state.scannedToBlock + 1
    : Math.max(0, latest - FIRST_RUN_LOOKBACK);
  let scannedToBlock = Number.isFinite(state?.scannedToBlock) ? state.scannedToBlock : forwardFrom - 1;

  if (forwardFrom <= latest) {
    const forward = await scanDelegators({
      wnat, provider: providerAddress,
      fromBlock: forwardFrom, toBlock: latest,
      deadline: started + BACKFILL_BUDGET_MS, label: "forward"
    });
    mergeCandidates(candidates, forward.found);
    scannedToBlock = Math.max(scannedToBlock, forward.reached);
  }

  // Backward: history in fixed steps, committing only completed steps so an
  // interrupted run resumes at a boundary instead of leaving a gap behind.
  let backfilledFrom = Number.isFinite(state?.backfilledFromBlock)
    ? state.backfilledFromBlock
    : forwardFrom;
  const deadline = started + BACKFILL_BUDGET_MS;
  while (backfilledFrom > 0 && Date.now() < deadline) {
    const windowStart = Math.max(0, backfilledFrom - BACKFILL_STEP_BLOCKS);
    const backward = await scanDelegators({
      wnat, provider: providerAddress,
      fromBlock: windowStart, toBlock: backfilledFrom - 1,
      deadline, label: "backfill"
    });
    mergeCandidates(candidates, backward.found);
    if (!backward.complete) break;
    backfilledFrom = windowStart;
  }

  for (const address of seedAddresses) {
    const key = lower(address);
    if (key && !candidates.has(key)) candidates.set(key, { firstBlock: null, seeded: true });
  }
  if (!candidates.size) return null;

  // Current delegated amount for every candidate, in one pass.
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
    if (!Number.isFinite(amount) || amount <= 0) return;
    active.push({ address, amount, meta: candidates.get(address) });
  });
  console.log(`  ${active.length} active delegators of ${addresses.length} candidates, total ${total?.toFixed(0)} WFLR`);

  // Timestamps only for the ones we have not dated yet.
  const undated = active.filter(row => row.meta.firstSeen == null && Number.isFinite(row.meta.firstBlock));
  if (undated.length) {
    const stamps = await blockTimestamps(undated.map(row => row.meta.firstBlock));
    undated.forEach(row => {
      const stamp = stamps.get(row.meta.firstBlock);
      if (stamp) row.meta.firstSeen = stamp;
    });
  }

  // "Change" on the page means change within the current reward epoch, so a
  // baseline is captured the first time each epoch is seen.
  const baseline = state?.baseline?.epoch === epoch && epoch != null
    ? state.baseline
    : { epoch, capturedAt: Math.floor(Date.now() / 1000), amounts: Object.fromEntries(active.map(row => [row.address, row.amount])) };

  const now = Math.floor(Date.now() / 1000);
  const delegators = active
    .map(row => {
      const before = baseline.amounts?.[row.address];
      return {
        from: row.address,
        amount: row.amount,
        share: total ? (row.amount / total) * 100 : null,
        firstSeen: row.meta.firstSeen ?? null,
        lastSeen: now,
        firstBlock: row.meta.firstBlock ?? null,
        delta: Number.isFinite(before) ? row.amount - before : null,
        hasPriorSnapshot: Number.isFinite(before)
      };
    })
    .sort((a, b) => b.amount - a.amount);

  await writeState({
    generatedAt: new Date().toISOString(),
    provider: providerAddress,
    wnat,
    chainHead: latest,
    scannedToBlock,
    backfilledFromBlock: backfilledFrom,
    backfillComplete: backfilledFrom <= 0,
    candidates: Object.fromEntries([...candidates].map(([address, meta]) => [address, meta])),
    baseline
  });

  return {
    delegators,
    total,
    wnat,
    chainHead: latest,
    scannedToBlock,
    backfilledFromBlock: backfilledFrom,
    backfillComplete: backfilledFrom <= 0,
    candidateCount: addresses.length
  };
}
