// A very small JSON-RPC client for the Flare C-chain.
//
// Enough to read the WNat contract and scan its delegation events: batched
// eth_call, adaptive eth_getLogs, and endpoint failover. Deliberately no ABI
// library - every value this file touches is a uint256 or an address, both of
// which are one 32-byte word.

const ENDPOINTS = (process.env.FLARE_RPC_URLS || [
  "https://flare-api.flare.network/ext/C/rpc",
  "https://flare.rpc.thirdweb.com",
  "https://rpc.ftso.au/flare",
  "https://flare.public-rpc.com"
].join(",")).split(",").map(url => url.trim()).filter(Boolean);

const TIMEOUT_MS = Number(process.env.FLARE_RPC_TIMEOUT_MS || 20000);

let preferred = 0;
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
// provider costs one timeout per run rather than one per call.
async function send(body) {
  const errors = [];
  for (let hop = 0; hop < ENDPOINTS.length; hop += 1) {
    const index = (preferred + hop) % ENDPOINTS.length;
    const endpoint = ENDPOINTS[index];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const result = await post(endpoint, body);
        preferred = index;
        return result;
      } catch (error) {
        errors.push(`${new URL(endpoint).host}: ${error.message}`);
        if (attempt === 1) await sleep(400);
      }
    }
  }
  throw new Error(`all Flare RPC endpoints failed (${errors.join("; ")})`);
}

function unwrap(entry) {
  if (entry && entry.error) throw new Error(entry.error.message || JSON.stringify(entry.error));
  return entry ? entry.result : undefined;
}

export async function rpc(method, params = []) {
  return unwrap(await send({ jsonrpc: "2.0", id: nextId++, method, params }));
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
export async function getLogs({ address, topics, fromBlock, toBlock, span = 50000, deadline = null }) {
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
      }]);
      logs.push(...(batch || []));
      cursor = stop + 1n;
    } catch (error) {
      if (width <= 1000n) throw new Error(`eth_getLogs failed at block ${cursor}: ${error.message}`);
      width /= 4n;
    }
  }
  return { logs, reached: end, complete: true };
}
