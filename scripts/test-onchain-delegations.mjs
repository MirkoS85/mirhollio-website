// Offline test for the on-chain delegator reader.
//
//   MOCK_LATENCY_MS=2 DELEGATION_BACKFILL_BUDGET_MS=3000 \
//     DELEGATION_BACKFILL_STEP=500000 node scripts/test-onchain-delegations.mjs
//
// Stands a fake Flare RPC in front of scripts/lib/flare-delegations.mjs and
// checks the ABI encoding, the batch handling, the resumable history backfill
// and the shape of the book that comes back. Hitting the real chain from a
// test would make it slow, flaky and dependent on who happens to be delegating
// today; this pins the behaviour that is ours.
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const WNAT = "0x1d80c49bbbcd1c0911346656b529df9e5c2f783d";
const PROVIDER = "0xad9105bef5e5df2eacbe2de9037a96695b00cade";
const HEAD = 57_000_000;

const pad = a => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const word = n => BigInt(n).toString(16).padStart(64, "0");
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const DELEGATE = "0x500599802164a08023e87ffc3eed0ba3ae60697b3083ba81d046683679d81c6b";

// Three delegators: one recent, one ancient (only found by the backfill), and
// one that shows up only as an ERC-20 Transfer and must be filtered out.
const addr = n => `0x${String(n).padStart(40, "a")}`;
const LOGS = [
  { block: HEAD - 1000,     topic0: DELEGATE, from: addr(1) },
  { block: HEAD - 900,      topic0: DELEGATE, from: addr(1) },
  { block: 3_000_000,       topic0: DELEGATE, from: addr(2) },
  { block: HEAD - 500,      topic0: TRANSFER, from: addr(3) }
];

const AMOUNTS = {
  [addr(1)]: 1_500_000n * 10n ** 18n,
  [addr(2)]: 250_000n * 10n ** 18n,
  [addr(3)]: 0n,
  "0xseed": 0n
};
const SEED = "0x00000000000000000000000000000000000000bb";
AMOUNTS[SEED] = 42_000n * 10n ** 18n;

let getLogsCalls = 0;
let batchCalls = 0;
let maxSpanSeen = 0;

function handle(req) {
  const { method, params, id } = req;
  const ok = result => ({ jsonrpc: "2.0", id, result });

  if (method === "eth_blockNumber") return ok(`0x${HEAD.toString(16)}`);

  if (method === "eth_getLogs") {
    getLogsCalls += 1;
    const filter = params[0];
    const from = Number(BigInt(filter.fromBlock));
    const to = Number(BigInt(filter.toBlock));
    maxSpanSeen = Math.max(maxSpanSeen, to - from + 1);
    // Mimic a provider that refuses wide ranges, so the halving path runs.
    if (to - from + 1 > 20_000) {
      return { jsonrpc: "2.0", id, error: { code: -32000, message: "query returned more than 10000 results" } };
    }
    if (filter.topics[2][0] !== `0x${pad(PROVIDER)}`) throw new Error("wrong provider topic");
    const logs = LOGS.filter(l => l.block >= from && l.block <= to).map(l => ({
      address: WNAT,
      blockNumber: `0x${l.block.toString(16)}`,
      topics: [l.topic0, `0x${pad(l.from)}`, `0x${pad(PROVIDER)}`],
      data: "0x"
    }));
    return ok(logs);
  }

  if (method === "eth_call") {
    const { to, data } = params[0];
    if (to.toLowerCase() === "0xad67fe66660fb8dfe9d6b1b4240d8650e30f6019") {
      if (!data.startsWith("0x82760fca")) throw new Error("bad registry selector");
      return ok(`0x${pad(WNAT)}`);
    }
    if (to.toLowerCase() !== WNAT) throw new Error(`unexpected call target ${to}`);
    if (data.startsWith("0xbe0ca747")) {
      const body = data.slice(10);
      const who = `0x${body.slice(24, 64)}`;
      const target = `0x${body.slice(88, 128)}`;
      if (target !== PROVIDER) throw new Error(`votePowerFromTo target ${target}`);
      return ok(`0x${word(AMOUNTS[who] ?? 0n)}`);
    }
    if (data.startsWith("0x142d1018")) {
      const total = Object.values(AMOUNTS).reduce((s, v) => s + v, 0n);
      return ok(`0x${word(total)}`);
    }
    throw new Error(`unexpected selector ${data.slice(0, 10)}`);
  }

  if (method === "eth_getBlockByNumber") {
    const block = Number(BigInt(params[0]));
    return ok({ number: params[0], timestamp: `0x${(1650000000 + block).toString(16)}` });
  }

  throw new Error(`unexpected method ${method}`);
}

const LATENCY_MS = Number(process.env.MOCK_LATENCY_MS || 0);
globalThis.fetch = async (url, init) => {
  if (LATENCY_MS) await new Promise(r => setTimeout(r, LATENCY_MS));
  const body = JSON.parse(init.body);
  if (Array.isArray(body)) batchCalls += 1;
  const result = Array.isArray(body) ? body.map(handle) : handle(body);
  return { ok: true, status: 200, json: async () => result };
};

const dir = await mkdtemp(path.join(tmpdir(), "dx-"));
process.chdir(dir);

const { readOnChainDelegators } = await import(
  path.join(HERE, "lib", "flare-delegations.mjs")
);

console.log("=== run 1 (first run: forward window only, one backfill step) ===");
const first = await readOnChainDelegators({ provider: PROVIDER, seedAddresses: [SEED], epoch: 434 });
console.log(JSON.stringify(first.delegators, null, 2));
console.log("total:", first.total, "complete:", first.backfillComplete, "backfilledFrom:", first.backfilledFromBlock);

const state1 = JSON.parse(await readFile(path.join(dir, "data/delegator-candidates.json"), "utf8"));
console.log("state after run 1:", {
  wnat: state1.wnat,
  scannedToBlock: state1.scannedToBlock,
  backfilledFromBlock: state1.backfilledFromBlock,
  candidates: Object.keys(state1.candidates)
});

console.log("\n=== run 2 (resume: forward from stored head, backfill continues) ===");
const second = await readOnChainDelegators({ provider: PROVIDER, seedAddresses: [SEED], epoch: 434 });
const state2 = JSON.parse(await readFile(path.join(dir, "data/delegator-candidates.json"), "utf8"));
console.log("backfill moved:", state1.backfilledFromBlock, "->", state2.backfilledFromBlock);
console.log("delegators still:", second.delegators.length);

console.log("\n=== run 3 (a delegator tops up: delta against the epoch baseline) ===");
AMOUNTS[addr(1)] = 1_800_000n * 10n ** 18n;
const third = await readOnChainDelegators({ provider: PROVIDER, seedAddresses: [SEED], epoch: 434 });
const topUp = third.delegators.find(d => d.from === addr(1));
console.log("delta for topped-up wallet:", topUp.delta);
console.log("run3 complete:", third.backfillComplete, "backfilledFrom:", third.backfilledFromBlock, "total:", third.total, "sumShares:", third.delegators.reduce((s,d)=>s+d.share,0), "rows:", third.delegators.length);

console.log("\n=== drain: keep running until the history scan finishes ===");
let final = third;
let runs = 3;
while (!final.backfillComplete && runs < 60) {
  final = await readOnChainDelegators({ provider: PROVIDER, seedAddresses: [SEED], epoch: 434 });
  runs += 1;
}
console.log(`complete after ${runs} runs, ${final.delegators.length} delegators, shares sum ${final.delegators.reduce((s, d) => s + d.share, 0).toFixed(4)}`);

console.log("\n=== new reward epoch: baseline re-captured ===");
const rolled = await readOnChainDelegators({ provider: PROVIDER, seedAddresses: [SEED], epoch: 435 });
console.log("delta after epoch roll:", rolled.delegators.find(d => d.from === addr(1)).delta);

console.log("\n=== checks ===");
const names = first.delegators.map(d => d.from);
const checks = [
  ["registry resolved WNat", first.wnat.toLowerCase() === WNAT],
  ["Transfer-only address excluded", !names.includes(addr(3))],
  ["recent delegator present", names.includes(addr(1))],
  ["seed address present", names.includes(SEED.toLowerCase())],
  ["sorted by amount desc", first.delegators.every((d, i, a) => i === 0 || a[i - 1].amount >= d.amount)],
  // Mid-backfill the book is knowingly incomplete, so its shares sum to less
  // than the live total. They only have to add up once the scan has finished.
  ["shares below 100 while the scan is incomplete", first.delegators.reduce((s, d) => s + d.share, 0) < 100],
  ["scan eventually completes", final.backfillComplete],
  ["ancient delegator found by the backfill", final.delegators.some(d => d.from === addr(2))],
  ["shares sum to ~100 once the scan completes", Math.abs(final.delegators.reduce((s, d) => s + d.share, 0) - 100) < 0.01],
  ["firstSeen dated from block", Number.isFinite(first.delegators.find(d => d.from === addr(1)).firstSeen)],
  ["earliest block wins for repeat delegator", first.delegators.find(d => d.from === addr(1)).firstBlock === HEAD - 1000],
  ["delta null on first epoch capture", first.delegators.every(d => d.delta === 0 || d.delta === null)],
  ["backfill advanced between runs", state2.backfilledFromBlock < state1.backfilledFromBlock],
  ["backfill did not finish in one run", state1.backfilledFromBlock > 0],
  ["delta tracks a top-up within the epoch", Math.abs(topUp.delta - 300000) < 1],
  ["delta resets when the reward epoch rolls", rolled.delegators.find(d => d.from === addr(1)).delta === 0],
  ["wide getLogs ranges were narrowed", maxSpanSeen > 20000],
  ["eth_calls were batched", batchCalls > 0]
];
let failed = 0;
for (const [label, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) failed += 1;
}
console.log(`\ngetLogs calls: ${getLogsCalls}, batched HTTP requests: ${batchCalls}`);
process.exit(failed ? 1 : 0);
