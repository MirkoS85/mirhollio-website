#!/usr/bin/env node
//
// Measure which public Flare endpoints can actually answer the two questions
// the delegator book needs:
//
//   1. discovery - which addresses have ever delegated to this provider
//   2. amounts   - how much each of them delegates right now
//
// (2) already works: WNat.votePowerFromTo over JSON-RPC. (1) is the hard one.
// The official RPC caps eth_getLogs at 30 blocks per request, which over 70
// million blocks is not a scan, so the alternatives have to be measured rather
// than guessed. This script only reads; it writes nothing and is safe to run
// against production at any time.
//
// Run it from the "Probe delegation sources" workflow.

const WNAT = "0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d";
const PROVIDER = "0xad9105bef5e5df2eacbe2de9037a96695b00cade";
const PROVIDER_TOPIC = `0x${PROVIDER.replace(/^0x/, "").padStart(64, "0")}`;
const DELEGATE_TOPIC = "0x500599802164a08023e87ffc3eed0ba3ae60697b3083ba81d046683679d81c6b";

const RPCS = [
  "https://flare-api.flare.network/ext/C/rpc",
  "https://flare.rpc.thirdweb.com",
  "https://rpc.ftso.au/flare",
  "https://flare.public-rpc.com",
  "https://flare-bundler.etherspot.io",
  "https://rpc.ankr.com/flare"
];

const BLOCKSCOUT = "https://flare-explorer.flare.network";

const ok = (label, detail) => console.log(`  OK    ${label}${detail ? ` — ${detail}` : ""}`);
const bad = (label, detail) => console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);

async function json(url, init = {}, timeoutMs = 20000) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(`non-JSON: ${text.slice(0, 160)}`);
  }
}

const rpc = (url, method, params) => json(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
});

async function head(url) {
  const res = await rpc(url, "eth_blockNumber", []);
  if (res.error) throw new Error(res.error.message);
  return Number(BigInt(res.result));
}

// How wide a range will this endpoint accept for eth_getLogs? Binary search
// rather than trusting the error text, which every client words differently.
async function maxLogSpan(url, top) {
  const works = async (span) => {
    try {
      const res = await rpc(url, "eth_getLogs", [{
        address: WNAT,
        topics: [null, null, [PROVIDER_TOPIC]],
        fromBlock: `0x${BigInt(top - span).toString(16)}`,
        toBlock: `0x${BigInt(top).toString(16)}`
      }], 25000);
      if (res.error) return res.error.message;
      return true;
    } catch (error) {
      return error.message;
    }
  };

  const first = await works(50_000);
  if (first === true) return { span: ">=50000", note: "wide ranges accepted" };
  let lo = 0, hi = 50_000, note = String(first).slice(0, 110);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    // eslint-disable-next-line no-await-in-loop
    if (await works(mid) === true) lo = mid; else hi = mid;
  }
  return { span: String(lo), note };
}

async function probeRpcs() {
  console.log("\n== JSON-RPC endpoints ==");
  for (const url of RPCS) {
    const host = new URL(url).host;
    try {
      const top = await head(url);
      const { span, note } = await maxLogSpan(url, top);
      ok(host, `head ${top}, eth_getLogs span ${span}${span === "0" ? ` (${note})` : ""}`);
    } catch (error) {
      bad(host, error.message.slice(0, 140));
    }
  }
}

async function probeBlockscout() {
  console.log("\n== Blockscout (flare-explorer.flare.network) ==");

  // Etherscan-compatible logs endpoint, the one that takes topic filters.
  for (const [label, params] of [
    ["topic2 only, last 1M blocks", { topic2: PROVIDER_TOPIC }],
    ["topic0+topic2, whole history", { topic0: DELEGATE_TOPIC, topic2: PROVIDER_TOPIC, topic0_2_opr: "and", fromBlock: "0" }]
  ]) {
    const url = new URL(`${BLOCKSCOUT}/api`);
    url.search = new URLSearchParams({
      module: "logs", action: "getLogs", address: WNAT,
      fromBlock: "0", toBlock: "latest", page: "1", offset: "1000",
      ...params
    }).toString();
    try {
      const body = await json(url.toString(), {}, 45000);
      const rows = Array.isArray(body.result) ? body.result : [];
      const senders = new Set(rows.map(r => `0x${String(r.topics?.[1] || "").slice(-40)}`));
      ok(`getLogs ${label}`, `status=${body.status} message=${body.message} rows=${rows.length} distinct senders=${senders.size}`);
      if (rows.length) {
        console.log(`        first topic0 ${rows[0].topics?.[0]}, block ${rows[0].blockNumber}`);
      }
    } catch (error) {
      bad(`getLogs ${label}`, error.message.slice(0, 160));
    }
  }

  // v2 API: no topic filter, but says whether the host is up at all.
  try {
    const body = await json(`${BLOCKSCOUT}/api/v2/addresses/${WNAT}/logs`, {}, 30000);
    ok("v2 address logs", `${(body.items || []).length} items`);
  } catch (error) {
    bad("v2 address logs", error.message.slice(0, 160));
  }
}

async function probeAmounts() {
  console.log("\n== Reading amounts (the part that already works) ==");
  const url = RPCS[0];
  const pad = a => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  try {
    const res = await rpc(url, "eth_call", [{
      to: WNAT, data: `0x142d1018${pad(PROVIDER)}`
    }, "latest"]);
    if (res.error) throw new Error(res.error.message);
    const total = Number(BigInt(res.result)) / 1e18;
    ok("votePowerOf(provider)", `${total.toFixed(0)} WFLR delegated right now`);
  } catch (error) {
    bad("votePowerOf(provider)", error.message.slice(0, 140));
  }

  try {
    const { readFile } = await import("node:fs/promises");
    const snap = JSON.parse(await readFile("data/ftso-delegations.json", "utf8"));
    const sample = (snap.delegators || []).slice(0, 3);
    for (const row of sample) {
      // eslint-disable-next-line no-await-in-loop
      const res = await rpc(url, "eth_call", [{
        to: WNAT, data: `0xbe0ca747${pad(row.from)}${pad(PROVIDER)}`
      }, "latest"]);
      const live = res.error ? null : Number(BigInt(res.result)) / 1e18;
      console.log(`        ${row.from}: snapshot ${Math.round(row.amount)} → chain ${live == null ? res.error.message : Math.round(live)}`);
    }
  } catch (error) {
    bad("votePowerFromTo sample", error.message.slice(0, 140));
  }
}

async function probeFlareBase() {
  console.log("\n== flare-base.io ==");
  try {
    const res = await fetch(
      `https://flare-base.io/api/votepower/getDelegatedVotePowerHistory/flare?address=${PROVIDER}&page=1&pageSize=1`,
      { signal: AbortSignal.timeout(20000) }
    );
    console.log(`  HTTP ${res.status} ${res.statusText}`);
  } catch (error) {
    bad("flare-base", error.message.slice(0, 140));
  }
}

await probeRpcs();
await probeBlockscout();
await probeAmounts();
await probeFlareBase();
console.log("\nProbe complete.");
