#!/usr/bin/env node
//
// What the Flare ecosystem publishes about FTSO providers, and what other
// providers put on their own sites.
//
// This site already downloads a 16MB oracle payload every five minutes and
// renders a small fraction of it. Before adding anything new, the question is
// what the public sources actually offer and what the better-known providers
// consider worth showing. Both are questions to measure, not to recall: this
// environment has no route to any of these hosts, so the answers come from a
// runner.
//
// Read-only. Writes nothing, pushes nothing.

const TIMEOUT = 25_000;
const ours = "0xb5a081dec72c8c87256b7e14cfadcbc342bdeac3";

async function get(url, as = "json") {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { accept: as === "json" ? "application/json" : "text/html,*/*", "user-agent": "Mozilla/5.0 (compatible; MirhollioAudit/1.0)" }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
  return as === "json" ? JSON.parse(text) : text;
}

const hr = t => console.log(`\n${"=".repeat(68)}\n${t}\n${"=".repeat(68)}`);

// ── 1. What the ecosystem tracker publishes per provider ───────────────────
hr("FlareMetrics: the fields the ecosystem compares providers on");
let providers = [];
try {
  const body = await get("https://api.flaremetrics.io/v3/ftso/providers?limit=200");
  providers = Array.isArray(body) ? body : (body.data || body.providers || []);
  console.log(`providers: ${providers.length}`);
  if (providers.length) {
    console.log(`\nfields per provider:\n  ${Object.keys(providers[0]).join("\n  ")}`);
    const mine = providers.find(p => JSON.stringify(p).toLowerCase().includes(ours.slice(2, 12)));
    console.log(`\nour row:\n${JSON.stringify(mine, null, 1).slice(0, 1200)}`);
  }
} catch (e) { console.log("FAILED:", e.message); }

// ── 2. Fee and performance across the field ────────────────────────────────
hr("Where we sit on fee and size");
try {
  const num = (p, keys) => { for (const k of keys) if (Number.isFinite(Number(p[k]))) return Number(p[k]); return null; };
  const fees = providers.map(p => num(p, ["fee", "feePercentage", "delegationFee", "fee_bips", "currentFee"])).filter(Number.isFinite);
  if (fees.length) {
    const s = fees.slice().sort((a, b) => a - b);
    console.log(`fee across ${s.length} providers: min ${s[0]}, p25 ${s[Math.floor(s.length*.25)]}, median ${s[Math.floor(s.length/2)]}, p75 ${s[Math.floor(s.length*.75)]}, max ${s[s.length-1]}`);
    const zero = fees.filter(f => f === 0).length;
    console.log(`providers charging zero: ${zero} of ${fees.length}`);
  } else { console.log("no fee field found; keys were:", providers[0] && Object.keys(providers[0]).join(", ")); }
} catch (e) { console.log("FAILED:", e.message); }

// ── 3. Other providers' own sites ──────────────────────────────────────────
hr("What other providers put on their own sites");
const sites = [];
for (const p of providers) {
  const url = p.url || p.website || p.homepage || p.site || p.listingUrl;
  if (typeof url === "string" && /^https?:/.test(url)) sites.push([p.name || p.displayName || "?", url]);
}
console.log(`sites listed by the tracker: ${sites.length}`);
sites.slice(0, 25).forEach(([n, u]) => console.log(`  ${n} — ${u}`));

for (const [name, url] of sites.slice(0, 10)) {
  try {
    const html = await get(url, "html");
    const strip = s => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const heads = [...html.matchAll(/<h[12][^>]*>([\s\S]{0,120}?)<\/h[12]>/gi)].map(m => strip(m[1])).filter(Boolean).slice(0, 10);
    const hasChart = /chart|recharts|apexcharts|chart\.js|<svg[^>]*(?:polyline|path)/i.test(html);
    const words = ["fee", "apr", "apy", "uptime", "availability", "reward", "delegat", "epoch", "calculator", "accuracy", "risk", "disclaimer", "privacy", "faq", "about", "team", "roadmap", "staking"]
      .filter(w => new RegExp(w, "i").test(strip(html)));
    console.log(`\n${name} (${url})  ${Math.round(html.length / 1024)}KB  charts=${hasChart}`);
    console.log(`  headings: ${heads.join(" | ").slice(0, 220)}`);
    console.log(`  mentions: ${words.join(", ")}`);
  } catch (e) { console.log(`\n${name} (${url}) — unreachable: ${e.message.slice(0, 70)}`); }
}

// ── 4. Other endpoints on the sources we already use ───────────────────────
hr("Other endpoints on sources we already call");
const probes = [
  ["oracle-daemon providers v2", "https://api.oracle-daemon.com/v2/flare/providers"],
  ["oracle-daemon network", "https://api.oracle-daemon.com/v2/flare/network"],
  ["oracle-daemon rewards", "https://api.oracle-daemon.com/v2/flare/rewards"],
  ["FSE entity list", "https://flare-systems-explorer.flare.network/backend-url/api/v0/entity"],
  ["FSE reward epochs", "https://flare-systems-explorer.flare.network/backend-url/api/v0/reward_epoch"],
  ["FSE fast updates", "https://flare-systems-explorer.flare.network/backend-url/api/v0/fast_updates_feed"],
  ["Flare price feeds (FTSOv2)", "https://flare-systems-explorer.flare.network/backend-url/api/v0/feed_values"]
];
for (const [label, url] of probes) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { accept: "application/json" } });
    const text = await res.text();
    let shape = text.slice(0, 160);
    try {
      const j = JSON.parse(text);
      shape = Array.isArray(j) ? `array[${j.length}] keys: ${Object.keys(j[0] || {}).slice(0, 14).join(", ")}`
                               : `object keys: ${Object.keys(j).slice(0, 18).join(", ")}`;
    } catch {}
    console.log(`  ${res.status}  ${label}\n        ${shape.slice(0, 200)}`);
  } catch (e) { console.log(`  ---  ${label} — ${e.message.slice(0, 60)}`); }
}
console.log("\nProbe complete.");
