#!/usr/bin/env node
//
// Round two. The first pass found the tracker's real field names and that it
// publishes no site URLs, so this one reads the fields that exist, places us in
// the field on each of them, and goes at other providers' sites directly.
//
// Read-only. Writes nothing, pushes nothing.

const TIMEOUT = 25_000;
const OURS = "0xad9105bef5e5df2eacbe2de9037a96695b00cade";

async function get(url, as = "json") {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { accept: as === "json" ? "application/json" : "text/html,*/*",
               "user-agent": "Mozilla/5.0 (compatible; MirhollioAudit/1.0)" }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return as === "json" ? JSON.parse(text) : text;
}
const hr = t => console.log(`\n${"=".repeat(68)}\n${t}\n${"=".repeat(68)}`);
const pct = (arr, q) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length * q)];

// ── where we actually stand, on every metric the tracker publishes ─────────
hr("Our position across the whole provider field");
let rows = [];
try {
  const body = await get("https://api.flaremetrics.io/v3/ftso/providers?limit=200");
  rows = Array.isArray(body) ? body : (body.data || body.providers || body.results || []);
  const mine = rows.find(r => String(r.delegationAddress || "").toLowerCase() === OURS);
  console.log(`providers: ${rows.length}`);
  console.log(`\nour row:\n${JSON.stringify(mine, null, 1).slice(0, 900)}`);

  for (const key of ["delegationFeePercentage", "fspRewardRate", "fspRewardRateAvg", "fspRewardRateCV", "fspApr", "registrationWeight"]) {
    const vals = rows.map(r => Number(r[key])).filter(Number.isFinite);
    if (!vals.length) { console.log(`\n${key}: no values`); continue; }
    const ours = Number(mine?.[key]);
    const better = vals.filter(v => v < ours).length;      // lower is better for fee and CV
    const higher = vals.filter(v => v > ours).length;      // higher is better for rate and APR
    console.log(`\n${key}`);
    console.log(`  field: min ${pct(vals,0).toFixed(4)} | p25 ${pct(vals,.25).toFixed(4)} | median ${pct(vals,.5).toFixed(4)} | p75 ${pct(vals,.75).toFixed(4)} | max ${pct(vals,.999).toFixed(4)}`);
    console.log(`  ours:  ${Number.isFinite(ours) ? ours.toFixed(4) : "?"}  → ${higher} providers above us, ${better} below us`);
    if (key === "delegationFeePercentage") {
      const buckets = {};
      vals.forEach(v => { const b = v === 0 ? "0%" : v <= 5 ? "1-5%" : v <= 10 ? "6-10%" : v <= 15 ? "11-15%" : v <= 20 ? "16-20%" : ">20%"; buckets[b] = (buckets[b] || 0) + 1; });
      console.log(`  fee distribution: ${JSON.stringify(buckets)}`);
    }
  }
  // Consistency is the one thing nobody seems to surface, so look at it closely.
  const cvs = rows.map(r => ({ n: r.entity?.name || r.entity?.displayName || r.voterId, cv: Number(r.fspRewardRateCV), rate: Number(r.fspRewardRate) }))
                  .filter(x => Number.isFinite(x.cv)).sort((a, b) => a.cv - b.cv);
  console.log(`\nsteadiest 8 providers by reward-rate variation (low = steady):`);
  cvs.slice(0, 8).forEach(x => console.log(`  CV ${x.cv.toFixed(3)}  rate ${(x.rate||0).toFixed(4)}  ${x.n}`));
  const us = cvs.findIndex(x => String(x.n).toLowerCase().includes("mir"));
  console.log(`  …our rank by steadiness: ${us >= 0 ? us + 1 : "?"} of ${cvs.length}`);
} catch (e) { console.log("FAILED:", e.message); }

// ── what other providers choose to show ────────────────────────────────────
hr("Other providers' own sites");
const SITES = [
  "https://flaremetrics.io/ftso", "https://ftso.au", "https://bifrostoracle.com",
  "https://www.flareoracle.io", "https://aureusether.com", "https://ftsoeu.com",
  "https://www.towolabs.com", "https://flare.space", "https://oracle-daemon.com",
  "https://a-labs.io", "https://www.sparkles.network", "https://ftso.eu"
];
for (const url of SITES) {
  try {
    const html = await get(url, "html");
    const strip = s => s.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const body = strip(html);
    const heads = [...html.matchAll(/<h[123][^>]*>([\s\S]{0,110}?)<\/h[123]>/gi)].map(m => strip(m[1])).filter(Boolean);
    const topics = ["fee", "apr", "apy", "uptime", "availability", "accuracy", "reward", "calculator",
                    "delegat", "stake", "epoch", "chart", "history", "faq", "about", "team", "contact",
                    "roadmap", "risk", "disclaimer", "privacy", "terms", "node", "infrastructure", "monitoring"]
      .filter(w => new RegExp(w, "i").test(body));
    console.log(`\n${url}  ${Math.round(html.length/1024)}KB`);
    console.log(`  headings (${heads.length}): ${heads.slice(0, 12).join(" | ").slice(0, 260)}`);
    console.log(`  covers: ${topics.join(", ")}`);
  } catch (e) { console.log(`\n${url} — ${e.message.slice(0, 50)}`); }
}

// ── what else the oracle daemon offers ─────────────────────────────────────
hr("Unused endpoints on the oracle daemon");
for (const [label, url] of [["network", "https://api.oracle-daemon.com/v2/flare/network"],
                            ["rewards", "https://api.oracle-daemon.com/v2/flare/rewards"]]) {
  try {
    const j = await get(url);
    const data = j.m_xData ?? j;
    const peek = Array.isArray(data)
      ? `array[${data.length}] keys: ${Object.keys(data[0] || {}).join(", ")}`
      : `keys: ${Object.keys(data).join(", ")}\n      sample: ${JSON.stringify(data).slice(0, 400)}`;
    console.log(`\n${label}: ${peek}`);
  } catch (e) { console.log(`\n${label} — ${e.message}`); }
}
console.log("\nProbe complete.");
