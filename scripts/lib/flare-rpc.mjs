// A very small JSON-RPC client for the Flare C-chain.
//
// Enough to read the WNat contract and scan its delegation events: batched
// eth_call, adaptive eth_getLogs, and endpoint failover. Deliberately no ABI
// library - every value this file touches is a uint256 or an address, both of
// which are one 32-byte word.

const list = value => value.split(",").map(url => url.trim()).filter(Boolean);

// Calls go to the official endpoint first.
const ENDPOINTS = list(process.env.FLARE_RPC_URLS || [
  "https://flare-api.flare.network/ext/C/rpc",
  "https://flare.public-rpc.com",
  "https://rpc.ankr.com/flare",
  "https://flare.rpc.thirdweb.com"
].join(","));

// Log scans do not, because the official endpoint caps eth_getLogs at 29 blocks
// per request - measured, not assumed - and Flare is past 70 million blocks.
// The others allow 1000, which is still small but workable for the incremental
// window; whole-history discovery goes through an explorer instead.
const LOG_ENDPOINTS = list(process.env.FLARE_LOG_RPC_URLS || [
  "https://flare.public-rpc.com",
  "https://rpc.ankr.com/flare",
  "https://flare.rpc.thirdweb.com",
  "https://flare-api.flare.network/ext/C/rpc"
].join(","));

const TIMEOUT_MS = Number(process.env.FLARE_RPC_TIMEOUT_MS || 12000);

const preferred = new Map();
let nextId = 1;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function post(endpoint, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Endpoints are tried starting from the last one that worked, so a single slow
// provider costs one timeout per run rather than one per call. The preference
// is per pool: a good log endpoint is not necessarily the one calls should use.
async function send(body, pool = ENDPOINTS) {
  const key = pool === LOG_ENDPOINTS ? "logs" : "calls";
  const start = preferred.get(key) || 0;
  const errors = [];
  for (let hop = 0; hop < pool.length; hop += 1) {
    const index = (start + hop) % pool.length;
    const endpoint = pool[index];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const result = await post(endpoint, body);
        preferred.set(key, index);
        return result;
      } catch (error) {
        errors.push(`${new URL(endpoint).host}: ${error.message}`);
        if (attempt === 1) await sleep(400);
      }
    }
  }
  throw new Error(`all Flare RPC endpoints failed (${errors.join("; ")})`);
}

export { LOG_ENDPOINTS };

function unwrap(entry) {
  if (entry && entry.error) throw new Error(entry.error.message || JSON.stringify(entry.error));
  return entry ? entry.result : undefined;
}

export async function rpc(method, params = [], pool = ENDPOINTS) {
  return unwrap(await send({ jsonrpc: "2.0", id: nextId++, method, params }, pool));
}

/** One HTTP round-trip per `size` calls. Results come back in request order. */
export async function rpcBatch(calls, size = 100) {
  const out = [];
  for (let start = 0; start < calls.length; start += size) {
    const slice = calls.slice(start, start + size);
    const body = slice.map(call => ({
      jsonrpc: "2.0",
      id: nextId++,
      method: call.method,
      params: call.params || []
    }));
    const response = await send(body);

    if (!Array.isArray(response)) {
      // Not every provider honours batch requests; fall back to one at a time.
      for (const call of slice) out.push(await rpc(call.method, call.params));
      continue;
    }

    const byId = new Map(response.map(entry => [entry.id, entry]));
    for (const request of body) out.push(unwrap(byId.get(request.id)));
  }
  return out;
}

// ── encoding ───────────────────────────────────────────────────────────────

const strip = value => String(value || "").replace(/^0x/i, "");

export const padAddress = address => strip(address).toLowerCase().padStart(64, "0");
export const padUint = value => BigInt(value).toString(16).padStart(64, "0");
export const topicToAddress = topic => `0x${strip(topic).slice(-40).toLowerCase()}`;

export function decodeUint(word) {
  const hex = strip(word);
  if (!hex) return null;
  try {
    return BigInt(`0x${hex.slice(0, 64)}`);
  } catch (_) {
    return null;
  }
}

/** 18-decimal fixed point to a JS number. Safe here: WNat supply is ~10^10. */
export const fromWei = value => value == null ? null : Number(value) / 1e18;

export const blockTag = block => typeof block === "string" ? block : `0x${BigInt(block).toString(16)}`;

export function ethCall(to, data, block = "latest") {
  return { method: "eth_call", params: [{ to, data }, blockTag(block)] };
}

// ── logs ───────────────────────────────────────────────────────────────────

/**
 * eth_getLogs across a block range, halving the span whenever a provider
 * refuses it. Public endpoints disagree about the limit (and report it in
 * several different ways), so the span is discovered rather than configured.
 *
 * Returns how far it actually got: with `deadline` set it stops on a chunk
 * boundary when time runs out, so a caller can persist `reached` and resume
 * from there instead of re-scanning.
 */
export async function getLogs({ address, topics, fromBlock, toBlock, span = 1000, deadline = null }) {
  const logs = [];
  let cursor = BigInt(fromBlock);
  const end = BigInt(toBlock);
  // The cap only ever comes down. Growing it back after a refusal just means
  // being refused again every other chunk, which doubles the request count for
  // a scan that already runs into the thousands.
  let width = BigInt(span);

  while (cursor <= end) {
    if (deadline && Date.now() > deadline) {
      return { logs, reached: cursor - 1n, complete: false };
    }
    const stop = cursor + width - 1n > end ? end : cursor + width - 1n;
    try {
      const batch = await rpc("eth_getLogs", [{
        address,
        topics,
        fromBlock: blockTag(cursor),
        toBlock: blockTag(stop)
      }], LOG_ENDPOINTS);
      logs.push(...(batch || []));
      cursor = stop + 1n;
    } catch (error) {
      if (width <= 25n) throw new Error(`eth_getLogs failed at block ${cursor}: ${error.message}`);
      width /= 4n;
    }
  }
  return { logs, reached: end, complete: true };
}
