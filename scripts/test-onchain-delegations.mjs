// Offline test for the on-chain delegator reader.
//
//   node scripts/test-onchain-delegations.mjs
//
// Stands a fake Flare RPC and a fake block explorer in front of
// scripts/lib/flare-delegations.mjs and checks the ABI encoding, the batch
// handling, both discovery paths, and - the property that matters most in
// production - that a total discovery failure still produces a correct book for
// the wallets already known, rather than no book at all.
//
// Hitting the real chain from a test would make it slow, flaky and dependent on
// who happens to be delegating today. This pins the behaviour that is ours.

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const WNAT = "0x1d80c49bbbcd1c0911346656b529df9e5c2f783d";
const VP_READ = "0x000000000000000000000000000000000000cc01";
const VP_WRITE = "0x000000000000000000000000000000000000cc02";
const PROVIDER = "0xad9105bef5e5df2eacbe2de9037a96695b00cade";
const HEAD = 70_242_562;

const pad = a => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const word = n => BigInt(n).toString(16).padStart(64, "0");
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const DELEGATE = "0x500599802164a08023e87ffc3eed0ba3ae60697b3083ba81d046683679d81c6b";

const addr = n => `0x${String(n).padStart(40, "a")}`;
const SEED = "0x00000000000000000000000000000000000000bb";

// Ancient delegator: only the explorer's whole-history query finds this one.
// Recent delegator: inside the forward window, so the RPC scan finds it.
// Transfer-only address: must be filtered out.
const HISTORY_LOGS = [
  { block: 3_000_000, topic0: DELEGATE, from: addr(2), contract: VP_READ },
  { block: 3_000_100, topic0: TRANSFER, from: addr(3), contract: VP_READ }
];
const RECENT_LOGS = [
  { block: HEAD - 1000, topic0: DELEGATE, from: addr(1), contract: VP_WRITE },
  { block: HEAD - 900, topic0: DELEGATE, from: addr(1), contract: VP_WRITE }
];

const AMOUNTS = {
  [addr(1)]: 1_500_000n * 10n ** 18n,
  [addr(2)]: 250_000n * 10n ** 18n,
  [addr(3)]: 0n,
  [SEED]: 42_000n * 10n ** 18n
};

const fail = { explorer: false, rpcLogs: false };
let explorerCalls = 0;
let batchCalls = 0;
let maxLogSpan = 0;

function handleRpc(req) {
  const { method, params, id } = req;
  const ok = result => ({ jsonrpc: "2.0", id, result });

  if (method === "eth_blockNumber") return ok(`0x${HEAD.toString(16)}`);

  if (method === "eth_getLogs") {
    if (fail.rpcLogs) return { jsonrpc: "2.0", id, error: { code: -32000, message: "logs disabled in this test" } };
    const f = params[0];
    const from = Number(BigInt(f.fromBlock));
    const to = Number(BigInt(f.toBlock));
    maxLogSpan = Math.max(maxLogSpan, to - from + 1);
    // Every public Flare endpoint measured caps this at 1000 blocks.
    if (to - from + 1 > 1000) {
      return { jsonrpc: "2.0", id, error: { code: -32000, message: "requested too many blocks, maximum is set to 1000" } };
    }
    if (f.topics[2][0] !== `0x${pad(PROVIDER)}`) throw new Error("wrong provider topic");
    const logs = RECENT_LOGS
      .filter(l => l.contract === f.address.toLowerCase() && l.block >= from && l.block <= to)
      .map(l => ({ blockNumber: `0x${l.block.toString(16)}`, topics: [l.topic0, `0x${pad(l.from)}`, `0x${pad(PROVIDER)}`] }));
    return ok(logs);
  }

  if (method === "eth_call") {
    const { to, data } = params[0];
    const target = to.toLowerCase();
    if (target === "0xad67fe66660fb8dfe9d6b1b4240d8650e30f6019") {
      if (!data.startsWith("0x82760fca")) throw new Error("bad registry selector");
      return ok(`0x${pad(WNAT)}`);
    }
    if (target !== WNAT) throw new Error(`unexpected call target ${to}`);
    if (data.startsWith("0x9b3baa0e")) return ok(`0x${pad(VP_READ)}`);
    if (data.startsWith("0x1fec092a")) return ok(`0x${pad(VP_WRITE)}`);
    if (data.startsWith("0xbe0ca747")) {
      const body = data.slice(10);
      const who = `0x${body.slice(24, 64)}`;
      if (`0x${body.slice(88, 128)}` !== PROVIDER) throw new Error("votePowerFromTo target mismatch");
      return ok(`0x${word(AMOUNTS[who] ?? 0n)}`);
    }
    if (data.startsWith("0x142d1018")) {
      return ok(`0x${word(Object.values(AMOUNTS).reduce((s, v) => s + v, 0n))}`);
    }
    throw new Error(`unexpected selector ${data.slice(0, 10)}`);
  }

  if (method === "eth_getBlockByNumber") {
    const block = Number(BigInt(params[0]));
    return ok({ timestamp: `0x${(1650000000 + block).toString(16)}` });
  }
  throw new Error(`unexpected method ${method}`);
}

globalThis.fetch = async (url, init = {}) => {
  const href = String(url);

  if (href.includes("/api?") && href.includes("module=logs")) {
    explorerCalls += 1;
    if (fail.explorer) return { ok: false, status: 502, text: async () => "Bad Gateway", json: async () => ({}) };
    const params = new URL(href).searchParams;
    const contract = params.get("address").toLowerCase();
    const page = Number(params.get("page"));
    const rows = page > 1 ? [] : HISTORY_LOGS
      .filter(l => l.contract === contract)
      .map(l => ({ blockNumber: `0x${l.block.toString(16)}`, topics: [l.topic0, `0x${pad(l.from)}`, `0x${pad(PROVIDER)}`] }));
    const payload = { status: rows.length ? "1" : "0", message: rows.length ? "OK" : "No logs found", result: rows };
    return { ok: true, status: 200, text: async () => JSON.stringify(payload), json: async () => payload };
  }

  const body = JSON.parse(init.body);
  if (Array.isArray(body)) batchCalls += 1;
  const result = Array.isArray(body) ? body.map(handleRpc) : handleRpc(body);
  return { ok: true, status: 200, text: async () => JSON.stringify(result), json: async () => result };
};

const dir = await mkdtemp(path.join(tmpdir(), "dx-"));
process.chdir(dir);
const { readOnChainDelegators } = await import(path.join(HERE, "lib", "flare-delegations.mjs"));
const statePath = path.join(dir, "data/delegator-candidates.json");
const readStateFile = async () => JSON.parse(await readFile(statePath, "utf8"));

console.log("=== run 1: explorer history + rpc forward window ===");
const first = await readOnChainDelegators({ provider: PROVIDER, seeds: [{ from: SEED, firstSeen: 1700000000 }], epoch: 434 });
const state1 = await readStateFile();
const explorerAfterFirst = explorerCalls;

console.log("\n=== run 2: history already complete, explorer not queried again ===");
const second = await readOnChainDelegators({ provider: PROVIDER, seeds: [{ from: SEED, firstSeen: 1700000000 }], epoch: 434 });
const explorerAfterSecond = explorerCalls;

console.log("\n=== run 3: a delegator tops up inside the same reward epoch ===");
AMOUNTS[addr(1)] = 1_800_000n * 10n ** 18n;
const third = await readOnChainDelegators({ provider: PROVIDER, seeds: [{ from: SEED, firstSeen: 1700000000 }], epoch: 434 });
const toppedUp = third.delegators.find(d => d.from === addr(1));

console.log("\n=== run 4: new reward epoch re-captures the baseline ===");
const rolled = await readOnChainDelegators({ provider: PROVIDER, seeds: [{ from: SEED, firstSeen: 1700000000 }], epoch: 435 });

console.log("\n=== run 5: both discovery paths down - the book must survive ===");
fail.explorer = true;
fail.rpcLogs = true;
const degraded = await readOnChainDelegators({ provider: PROVIDER, seeds: [{ from: SEED, firstSeen: 1700000000 }], epoch: 435 });

const names = first.delegators.map(d => d.from);
const checks = [
  ["registry resolved WNat", first.wnat === WNAT],
  ["both vote-power contracts resolved", first.vpContracts.includes(VP_READ) && first.vpContracts.includes(VP_WRITE)],
  ["explorer found the ancient delegator", names.includes(addr(2))],
  ["rpc forward scan found the recent delegator", names.includes(addr(1))],
  ["seed address carried through", names.includes(SEED)],
  ["seed keeps its own first-seen date", first.delegators.find(d => d.from === SEED).firstSeen === 1700000000],
  ["transfer-only address excluded", !names.includes(addr(3))],
  ["earliest block wins for a repeat delegator", first.delegators.find(d => d.from === addr(1)).firstBlock === HEAD - 1000],
  ["firstSeen dated from the block", Number.isFinite(first.delegators.find(d => d.from === addr(2)).firstSeen)],
  ["sorted by amount, descending", first.delegators.every((d, i, a) => i === 0 || a[i - 1].amount >= d.amount)],
  ["shares sum to 100 of the live total", Math.abs(first.delegators.reduce((s, d) => s + d.share, 0) - 100) < 0.01],
  ["listed total matches the sum of rows", Math.abs(first.listed - first.delegators.reduce((s, d) => s + d.amount, 0)) < 1],
  ["history marked complete", first.historyComplete && state1.historyComplete],
  ["explorer queried on the first run", explorerAfterFirst > 0],
  ["explorer not queried again once complete", explorerAfterSecond === explorerAfterFirst],
  // Asking for more than the endpoints allow costs a rejected request per
  // chunk, so the scan must never request a wider range than the cap.
  ["rpc log requests stayed within the 1000-block cap", maxLogSpan > 0 && maxLogSpan <= 1000],
  ["eth_calls were batched", batchCalls > 0],
  ["second run kept every delegator", second.delegators.length === first.delegators.length],
  ["delta tracks a top-up within the epoch", Math.abs(toppedUp.delta - 300000) < 1],
  ["delta resets when the reward epoch rolls", rolled.delegators.find(d => d.from === addr(1)).delta === 0],
  ["book survives total discovery failure", degraded !== null && degraded.delegators.length === first.delegators.length],
  ["amounts still exact when discovery is down", degraded.delegators.find(d => d.from === addr(1)).amount === 1_800_000]
];

console.log("\n=== checks ===");
let failed = 0;
for (const [label, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) failed += 1;
}
console.log(`\nexplorer requests: ${explorerCalls}, batched rpc requests: ${batchCalls}`);
process.exit(failed ? 1 : 0);
