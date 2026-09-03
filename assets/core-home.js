/* Mirhollio Core network-position widgets (home + subpages). No deps. */
(() => {
  const $ = (id) => document.getElementById(id);
  const S = "http://www.w3.org/2000/svg";
  const el = (t, a) => { const e = document.createElementNS(S, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const fmt = (n, d = 2) => n == null ? "–" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const MAG = "#FF2E63", MAGL = "#FF6E93", DIM = "#3A2A31", AMBER = "#F2B233", RED = "#FF6242", MUT = "#9AA0AF";
  const mono = "IBM Plex Mono, ui-monospace, monospace";

  async function jget(u) { const r = await fetch(u, { cache: "no-store" }); if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }

  function spark(svg, pts, { fill = true } = {}) {
    if (!svg || !pts.length) return;
    const W = 320, H = 74, P = 4;
    const min = Math.min(...pts), max = Math.max(...pts), rng = max - min || 1;
    const xy = pts.map((v, i) => [P + (i * (W - 2 * P)) / (pts.length - 1), H - P - ((v - min) / rng) * (H - 2 * P - 8)]);
    const line = xy.map((p) => p.join(",")).join(" ");
    if (fill) { const path = el("path", { d: `M${xy[0][0]},${H} L` + line.replace(/ /g, " L") + ` L${xy[xy.length-1][0]},${H} Z`, fill: "rgba(255,46,99,.14)" }); svg.appendChild(path); }
    svg.appendChild(el("polyline", { points: line, fill: "none", stroke: MAG, "stroke-width": 2.2, "stroke-linejoin": "round", filter: "drop-shadow(0 0 5px rgba(255,46,99,.5))" }));
    const last = xy[xy.length - 1];
    svg.appendChild(el("circle", { cx: last[0], cy: last[1], r: 3.6, fill: MAGL }));
  }

  async function price() {
    const svg = $("np-price-spark"); if (!svg) return;
    try {
      const c = await jget("https://api.exchange.coinbase.com/products/FLR-USD/candles?granularity=21600");
      const rows = c.slice(0, 28).reverse(); // [t, low, high, open, close, vol]
      const closes = rows.map((r) => r[4]);
      const lastP = closes[closes.length - 1], firstP = closes[0];
      $("np-price").textContent = "$" + lastP.toFixed(5);
      const d = ((lastP - firstP) / firstP) * 100;
      const chip = $("np-price-delta");
      chip.textContent = (d >= 0 ? "▲ +" : "▼ ") + d.toFixed(1) + "% 7D";
      chip.style.color = d >= 0 ? "#35C77E" : RED;
      spark(svg, closes);
    } catch { $("np-price-sub").textContent = "market data unavailable"; }
  }

  function gauge(svg, fillPct, daysLeft, periodPct) {
    if (!svg) return;
    const c1 = 2 * Math.PI * 48, c2 = 2 * Math.PI * 34;
    svg.appendChild(el("circle", { cx: 60, cy: 60, r: 48, fill: "none", stroke: "rgba(255,255,255,.09)", "stroke-width": 11 }));
    svg.appendChild(el("circle", { cx: 60, cy: 60, r: 48, fill: "none", stroke: MAG, "stroke-width": 11, "stroke-linecap": "round",
      "stroke-dasharray": `${(c1 * fillPct) / 100} ${c1}`, transform: "rotate(-90 60 60)", filter: "drop-shadow(0 0 5px rgba(255,46,99,.5))" }));
    svg.appendChild(el("circle", { cx: 60, cy: 60, r: 34, fill: "none", stroke: "rgba(255,255,255,.09)", "stroke-width": 7 }));
    svg.appendChild(el("circle", { cx: 60, cy: 60, r: 34, fill: "none", stroke: AMBER, "stroke-width": 7, "stroke-linecap": "round",
      "stroke-dasharray": `${(c2 * periodPct) / 100} ${c2}`, transform: "rotate(-90 60 60)" }));
    const t1 = el("text", { x: 60, y: 56, "text-anchor": "middle", "font-size": 17, "font-weight": 800, fill: "#F4F4F8", "font-family": "Archivo, sans-serif" });
    t1.textContent = Math.round(fillPct) + "%";
    const t2 = el("text", { x: 60, y: 72, "text-anchor": "middle", "font-size": 9, fill: MUT });
    t2.textContent = daysLeft != null ? `full · ${daysLeft}d left` : "full";
    svg.append(t1, t2);
  }

  function strip(svg, weights, ourIdx, cutoff) {
    if (!svg) return;
    const n = weights.length, W = 1200, base = 78;
    const max = weights[0];
    weights.forEach((w, i) => {
      const h = Math.max(4, Math.pow(w / max, 0.5) * 64);
      const me = i === ourIdx;
      svg.appendChild(el("rect", { x: (i * W) / n + 0.5, y: base - h, width: W / n - 1.8, height: h, rx: 2,
        fill: me ? MAG : DIM, ...(me ? { filter: "drop-shadow(0 0 6px rgba(255,46,99,.7))" } : {}) }));
    });
    svg.appendChild(el("line", { x1: 0, x2: W, y1: base, y2: base, stroke: "rgba(255,255,255,.12)" }));
    const t = el("text", { x: Math.min((ourIdx * W) / n + 6, W - 220), y: 14, "font-size": 12, fill: MAGL, "font-family": mono });
    t.textContent = `Mirhollio Core · #${ourIdx + 1}`;
    svg.appendChild(t);
    for (const [x, lab, anch] of [[2, "#1", "start"], [W - 2, "#" + n, "end"]]) {
      const tt = el("text", { x, y: 90, "font-size": 10, fill: MUT, "font-family": mono, "text-anchor": anch }); tt.textContent = lab; svg.appendChild(tt);
    }
  }

  function rrCurve(svg, rr) {
    if (!svg || !rr) return;
    const vals = rr.curve.slice();       // p90..p10 (desc)
    const max = Math.max(...vals, rr.ours || 0);
    const W = 320, H = 74, bw = 9, gap = 5, x0 = 6;
    const medY = H - 6 - (rr.median / max) * (H - 22);
    svg.appendChild(el("line", { x1: 0, x2: W, y1: medY, y2: medY, stroke: "rgba(255,255,255,.18)", "stroke-dasharray": "4 5" }));
    const ml = el("text", { x: 2, y: medY - 4, "font-size": 9, fill: MUT, "font-family": mono }); ml.textContent = "median"; svg.appendChild(ml);
    vals.forEach((v, i) => svg.appendChild(el("rect", { x: x0 + i * (bw + gap), y: H - 6 - (v / max) * (H - 22), width: bw, height: (v / max) * (H - 22), rx: 2, fill: DIM })));
    if (rr.ours != null) svg.appendChild(el("rect", { x: x0 + vals.length * (bw + gap) + 6, y: H - 6 - (rr.ours / max) * (H - 22), width: bw + 2, height: (rr.ours / max) * (H - 22), rx: 2, fill: MAG, filter: "drop-shadow(0 0 5px rgba(255,46,99,.6))" }));
  }

  function weightChart(svg, hist) {
    if (!svg || !hist.length) return;
    const W = 1000, H = 300, L = 44, B = 34, T = 14;
    const maxW = Math.max(...hist.map((h) => h.weight), 100);
    const maxBase = Math.max(...hist.map((h) => h.stakeM * 5 + h.wflrM));
    const gw = (W - L) / hist.length;
    for (const g of [0, 0.5, 1]) {
      const y = T + (H - T - B) * (1 - g);
      svg.appendChild(el("line", { x1: L, x2: W, y1: y, y2: y, stroke: "rgba(255,255,255,.07)" }));
      const t = el("text", { x: L - 6, y: y + 3, "font-size": 10, fill: MUT, "font-family": mono, "text-anchor": "end" }); t.textContent = Math.round(maxW * g); svg.appendChild(t);
    }
    const pts = [];
    hist.forEach((h, i) => {
      const x = L + i * gw + gw / 2;
      const sh = ((h.stakeM * 5) / maxBase) * (H - T - B) * 0.92;
      const wh = Math.max(((h.wflrM) / maxBase) * (H - T - B) * 0.92, 2);
      svg.appendChild(el("rect", { x: x - 14, y: H - B - sh, width: 18, height: sh, rx: 2, fill: "#4A3540" }));
      svg.appendChild(el("rect", { x: x + 6, y: H - B - wh, width: 7, height: wh, rx: 2, fill: AMBER }));
      const tl = el("text", { x, y: H - B + 16, "font-size": 10, fill: MUT, "font-family": mono, "text-anchor": "middle" }); tl.textContent = h.epoch; svg.appendChild(tl);
      pts.push([x, T + (H - T - B) * (1 - h.weight / maxW), h.weight]);
    });
    svg.appendChild(el("polyline", { points: pts.map((p) => p[0] + "," + p[1]).join(" "), fill: "none", stroke: MAG, "stroke-width": 2.4, "stroke-linejoin": "round", filter: "drop-shadow(0 0 5px rgba(255,46,99,.5))" }));
    pts.forEach((p, i) => {
      svg.appendChild(el("circle", { cx: p[0], cy: p[1], r: 3.6, fill: MAG }));
      if (i === 0 || i === pts.length - 1 || Math.abs(pts[Math.max(i-1,0)][2] - p[2]) > 15) {
        const t = el("text", { x: p[0], y: p[1] - 9, "font-size": 11, "font-weight": 700, fill: MAGL, "font-family": "Archivo, sans-serif", "text-anchor": "middle" }); t.textContent = p[2].toFixed(1); svg.appendChild(t);
      }
    });
  }

  function expiryChart(svg, val) {
    if (!svg || !val) return;
    const W = 1000, H = 260, L = 48, B = 30, T = 12;
    const start = val.totalStakeM;
    const steps = val.expirySteps;
    if (!steps.length) return;
    const t0 = Date.now(), t1 = new Date(steps[steps.length - 1].date).getTime() + 3 * 864e5;
    const x = (d) => L + ((new Date(d).getTime() - t0) / (t1 - t0)) * (W - L - 8);
    const y = (v) => T + (H - T - B) * (1 - v / start);
    for (const g of [0, 0.5, 1]) {
      svg.appendChild(el("line", { x1: L, x2: W, y1: y(start * g), y2: y(start * g), stroke: "rgba(255,255,255,.07)" }));
      const t = el("text", { x: L - 6, y: y(start * g) + 3, "font-size": 10, fill: MUT, "font-family": mono, "text-anchor": "end" }); t.textContent = Math.round(start * g) + "M"; svg.appendChild(t);
    }
    let d = `M${L},${y(start)}`; let cur = start;
    for (const s of steps) { d += ` H${Math.max(x(s.date), L)}`; cur = s.remainingM + (s.date < val.stakeEndsAt ? val.selfBondM : 0); d += ` V${y(Math.max(cur, 0))}`; }
    d += ` H${W - 8}`;
    svg.appendChild(el("path", { d: d + ` V${y(0)} H${L} Z`, fill: "rgba(255,46,99,.10)" }));
    svg.appendChild(el("path", { d, fill: "none", stroke: MAG, "stroke-width": 2.4, filter: "drop-shadow(0 0 5px rgba(255,46,99,.5))" }));
    const xe = x(val.stakeEndsAt);
    svg.appendChild(el("line", { x1: xe, x2: xe, y1: T, y2: y(0), stroke: AMBER, "stroke-dasharray": "4 4" }));
    const t = el("text", { x: xe - 6, y: T + 12, "font-size": 11, fill: AMBER, "font-family": mono, "text-anchor": "end" });
    t.textContent = val.stakeEndsAt + " — self-bond ends, renewal planned"; svg.appendChild(t);
    for (const [d0, lab] of steps.filter((s, i) => i % 4 === 0).map((s) => [s.date, s.date.slice(5)])) {
      const tt = el("text", { x: x(d0), y: H - B + 16, "font-size": 10, fill: MUT, "font-family": mono, "text-anchor": "middle" }); tt.textContent = lab; svg.appendChild(tt);
    }
  }

  async function main() {
    price();
    let np = null;
    try { np = await jget("/data/network-position.json?v=core-4"); } catch { return; }
    const p = np.position, rr = np.rewardRate, val = np.validator;
    // hero chips
    if ($("np-rr-rank") && rr) { $("np-rr-rank").textContent = `#${rr.rank} of ${rr.count} providers`; }
    if ($("np-rr-sub") && rr) { $("np-rr-sub").innerHTML = `network median ${(rr.median * 100).toFixed(2)}% — <b style="color:${MAGL}">${(rr.ours / rr.median).toFixed(1)}×</b> above`; }
    rrCurve($("np-rr-curve"), rr);
    if ($("np-stake-end") && val) $("np-stake-end").textContent = "ends " + val.stakeEndsAt.slice(5).replace("-", "/");
    if ($("np-stake") && val) $("np-stake").innerHTML = fmt(val.totalStakeM, 1) + "M<small> FLR</small>";
    if ($("np-stake-sub2") && val) $("np-stake-sub2").textContent = `self-bond ${fmt(val.selfBondM,0)}M · ${val.delegators} delegations`;
    const days = val ? Math.max(0, Math.round((new Date(val.stakeEndsAt) - Date.now()) / 864e5)) : null;
    gauge($("np-gauge"), 100, days, days != null ? Math.min(100, 100 - (days / 92) * 100) : 0);
    // strip
    if ($("np-rank")) $("np-rank").textContent = "#" + p.rank;
    if ($("np-voters")) $("np-voters").textContent = p.voters;
    if ($("np-epoch")) $("np-epoch").textContent = `epoch ${p.epoch} · weight ${fmt(p.weight,1)} (${p.pct}%)`;
    strip($("np-strip"), p.weights, p.ourIndex, p.cutoff);
    if ($("np-legend")) $("np-legend").innerHTML =
      `<span><i style="background:${MAG}"></i>our weight ${fmt(p.weight,1)}</span><span><i style="background:${DIM}"></i>other voters</span>` +
      `<span>eviction threshold ${fmt(p.cutoff,1)}</span><span>${p.voters}/${p.maxVoters} seats taken</span>` +
      `<span style="opacity:.7">updated ${Math.round((Date.now() - new Date(np.generatedAt)) / 36e5 * 10) / 10}h ago</span>`;
    // feature cards
    if ($("np-f-rank") && rr) $("np-f-rank").textContent = `#${rr.rank} reward rate of ${rr.count} providers (FlareMetrics), ${(rr.ours/rr.median).toFixed(1)}× the median.`;
    if ($("np-f-cond") && p) $("np-f-cond").textContent = `${p.passes ?? "-"} passes held, availability ${p.availabilityPct != null ? p.availabilityPct.toFixed(1) : "-"}%, eligible for rewards.`;
    // subpage charts
    weightChart(document.querySelector("svg[data-render='np-weight-chart']"), np.weightHistory || []);
    expiryChart(document.querySelector("svg[data-render='np-expiry-chart']"), val);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main); else main();
})();
/* live P-chain delegations (validator page) + live stake numbers */
(() => {
  const tb = document.querySelector("#np-del-table tbody");
  const NODE = "NodeID-8dNfgpspPNDrZD2ksKCRJoGe4Xqe6qVtz";
  async function run() {
    try {
      const r = await fetch("https://flare-api.flare.network/ext/bc/P", { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "platform.getCurrentValidators", params: { nodeIDs: [NODE] } }) });
      const j = await r.json();
      const v = j.result && j.result.validators && j.result.validators[0];
      if (!v) throw new Error("node not found");
      const dels = (v.delegators || []).map((d) => ({
        owner: (d.rewardOwner && d.rewardOwner.addresses && d.rewardOwner.addresses[0]) || "",
        amt: Number(d.weight) / 1e9, start: Number(d.startTime) * 1000, end: Number(d.endTime) * 1000 }))
        .sort((a, b) => a.end - b.end);
      const total = dels.reduce((s, d) => s + d.amt, 0);
      const selfB = Number(v.weight) / 1e9;
      // živi popravki hero panela na domači strani
      const st = document.getElementById("np-stake");
      if (st) st.innerHTML = ((total + selfB) / 1e6).toFixed(1) + "M<small> FLR</small>";
      const ss = document.getElementById("np-stake-sub2");
      if (ss) ss.textContent = `self-bond ${(selfB/1e6).toFixed(0)}M · ${dels.length} delegations · live`;
      if (!tb) return;
      const day = 864e5, now = Date.now();
      const fd = (t) => new Date(t).toISOString().slice(0, 10);
      const rows = dels.map((d) => {
        const left = Math.max(0, Math.ceil((d.end - now) / day));
        const short = d.owner ? d.owner.slice(0, 10) + "…" + d.owner.slice(-4) : "–";
        return `<tr><td class="addr">${short}</td><td class="num">${d.amt >= 1e6 ? (d.amt/1e6).toFixed(2)+"M" : Math.round(d.amt).toLocaleString("en-US")}</td><td>${fd(d.start)}</td><td>${fd(d.end)}</td><td class="num${left <= 7 ? " soon" : ""}">${left}d</td></tr>`;
      });
      tb.innerHTML = rows.join("") || '<tr><td colspan="5">No active delegations.</td></tr>';
      const sub = document.getElementById("np-del-sub");
      if (sub) sub.textContent = `${dels.length} active delegations · ${(total/1e6).toFixed(2)}M FLR delegated + ${(selfB/1e6).toFixed(0)}M self-bond · live from P-chain`;
    } catch (e) {
      if (tb) tb.innerHTML = '<tr><td colspan="5">Live P-chain data unavailable right now.</td></tr>';
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();
