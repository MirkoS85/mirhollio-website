#!/usr/bin/env node
//
// Which sources can tell this site the FLR price, and which of them also give
// enough history for the seven-day sparkline.
//
// The home page currently asks Coinbase and shows a dead card when that fails.
// Before adding fallbacks it is worth measuring what actually answers - and
// one candidate is unusual enough to be worth testing first: FTSOv2 publishes
// FLR/USD on-chain, so the price can be read from the oracle this provider
// helps operate rather than from an exchange that may or may not list it.
//
// Read-only. Writes nothing, pushes nothing.

const TIMEOUT = 20_000;
const CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const FLR_USD_FEED = "0x01464c522f55534400000000000000000000000000";
const SEL_GET_CONTRACT = "0x82760fca";
const SEL_GET_FEED = "0x93e9f806";          // getFeedById(bytes21)

const hr = t => console.log(`\n${"=".repeat(66)}\n${t}\n${"=".repeat(66)}`);

async function get(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT),
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; MirhollioAudit/1.0)", ...(init?.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 90)}`);
  return JSON.parse(text);
}

// ── the oracle this provider runs ──────────────────────────────────────────
hr("FTSOv2 on-chain feed (the oracle we help operate)");
for (const rpc of ["https://flare-api.flare.network/ext/C/rpc",
                   "https://flare.public-rpc.com",
                   "https://rpc.ankr.com/flare"]) {
  try {
    const call = async (to, data) => {
      const r = await get(rpc, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }) });
      if (r.error) throw new Error(r.error.message);
      return r.result;
    };
    const name = Buffer.from("FtsoV2", "utf8").toString("hex").padEnd(64, "0");
    const data = `${SEL_GET_CONTRACT}${(32).toString(16).padStart(64, "0")}${(6).toString(16).padStart(64, "0")}${name}`;
    const addr = `0x${(await call(CONTRACT_REGISTRY, data)).slice(-40)}`;
    const raw = await call(addr, SEL_GET_FEED + FLR_USD_FEED.slice(2).padEnd(64, "0"));
    // (uint256 value, int8 decimals, uint64 timestamp)
    const body = raw.replace(/^0x/, "");
    const value = BigInt("0x" + body.slice(0, 64));
    const decRaw = BigInt("0x" + body.slice(64, 128));
    const dec = decRaw > 2n ** 255n ? Number(decRaw - 2n ** 256n) : Number(decRaw);
    const ts = Number(BigInt("0x" + body.slice(128, 192)));
    const price = Number(value) / 10 ** dec;
    console.log(`  OK   ${new URL(rpc).host}`);
    console.log(`       FtsoV2 at ${addr}`);
    console.log(`       FLR/USD = $${price.toFixed(6)}  (decimals ${dec}, published ${new Date(ts * 1000).toISOString()}, ${Math.round(Date.now() / 1000 - ts)}s ago)`);
    break;
  } catch (e) {
    console.log(`  FAIL ${new URL(rpc).host} — ${e.message.slice(0, 90)}`);
  }
}

// ── exchanges and aggregators ──────────────────────────────────────────────
hr("Exchanges and aggregators: spot price");
const SPOT = [
  ["Coinbase (current source)", "https://api.exchange.coinbase.com/products/FLR-USD/ticker", b => b.price],
  ["CoinGecko simple", "https://api.coingecko.com/api/v3/simple/price?ids=flare-networks&vs_currencies=usd&include_24hr_change=true", b => b["flare-networks"]?.usd],
  ["Kraken", "https://api.kraken.com/0/public/Ticker?pair=FLRUSD", b => Object.values(b.result || {})[0]?.c?.[0]],
  ["Binance", "https://api.binance.com/api/v3/ticker/price?symbol=FLRUSDT", b => b.price],
  ["OKX", "https://www.okx.com/api/v5/market/ticker?instId=FLR-USDT", b => b.data?.[0]?.last],
  ["KuCoin", "https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=FLR-USDT", b => b.data?.price],
  ["Bitstamp", "https://www.bitstamp.net/api/v2/ticker/flrusd/", b => b.last]
];
for (const [name, url, pick] of SPOT) {
  try {
    const v = pick(await get(url));
    console.log(`  ${v != null ? "OK  " : "EMPTY"} ${name.padEnd(26)} ${v != null ? "$" + Number(v).toFixed(6) : ""}`);
  } catch (e) { console.log(`  FAIL  ${name.padEnd(26)} ${e.message.slice(0, 70)}`); }
}

hr("Seven days of history, for the sparkline");
const HIST = [
  ["Coinbase candles", "https://api.exchange.coinbase.com/products/FLR-USD/candles?granularity=21600", b => b.length],
  ["CoinGecko market_chart", "https://api.coingecko.com/api/v3/coins/flare-networks/market_chart?vs_currency=usd&days=7", b => b.prices?.length],
  ["Kraken OHLC", "https://api.kraken.com/0/public/OHLC?pair=FLRUSD&interval=240", b => Object.values(b.result || {})[0]?.length],
  ["Binance klines", "https://api.binance.com/api/v3/klines?symbol=FLRUSDT&interval=6h&limit=28", b => b.length]
];
for (const [name, url, count] of HIST) {
  try {
    const n = count(await get(url));
    console.log(`  ${n ? "OK  " : "EMPTY"} ${name.padEnd(26)} ${n || 0} points`);
  } catch (e) { console.log(`  FAIL  ${name.padEnd(26)} ${e.message.slice(0, 70)}`); }
}

hr("CORS: can a browser actually call these?");
for (const [name, url] of [["Coinbase", "https://api.exchange.coinbase.com/products/FLR-USD/ticker"],
                           ["CoinGecko", "https://api.coingecko.com/api/v3/simple/price?ids=flare-networks&vs_currencies=usd"],
                           ["Kraken", "https://api.kraken.com/0/public/Ticker?pair=FLRUSD"],
                           ["Binance", "https://api.binance.com/api/v3/ticker/price?symbol=FLRUSDT"],
                           ["Flare RPC", "https://flare-api.flare.network/ext/C/rpc"]]) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { origin: "https://www.mirhollio.com" } });
    const acao = res.headers.get("access-control-allow-origin");
    console.log(`  ${acao ? "OK  " : "NONE"} ${name.padEnd(12)} access-control-allow-origin: ${acao || "(absent)"}`);
  } catch (e) { console.log(`  FAIL  ${name.padEnd(12)} ${e.message.slice(0, 60)}`); }
}
console.log("\nProbe complete.");
