/* Mirhollio Core network-position widgets (home + subpages). No deps. */
(() => {
  const $ = (id) => document.getElementById(id);
  const S = "http://www.w3.org/2000/svg";
  const el = (t, a) => { const e = document.createElementNS(S, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const fmt = (n, d = 2) => n == null ? "–" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const MAG = "#FF2E63", MAGL = "#FF6E93", DIM = "#3A2A31", AMBER = "#F2B233", RED = "#FF6242", MUT = "#9AA0AF";
  const mono = "IBM Plex Mono, ui-monospace, monospace";

  async function jget(u) { const r = await fetch(u, { cache: "no-store" }); if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }

  /* The seven-day shape under the price.

     It used to inset itself four units on each side and fill with a flat
     rgba, so the shaded area ended in two hard vertical cuts short of the
     card edge and sat on a hard horizontal one. It runs the full width now
     and the fill fades out downwards. */
  function spark(svg, pts, { fill = true } = {}) {
    if (!svg || !pts.length) return;
    const W = 320, H = 74, TOP = 6, BOT = 4;
    const min = Math.min(...pts), max = Math.max(...pts), rng = max - min || 1;
    const xy = pts.map((v, i) => [(i * W) / (pts.length - 1), H - BOT - ((v - min) / rng) * (H - TOP - BOT)]);
    const line = xy.map((p) => p.join(",")).join(" ");

    const defs = el("defs");
    defs.innerHTML = `
      <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(255,46,99,.30)"/>
        <stop offset="100%" stop-color="rgba(255,46,99,0)"/>
      </linearGradient>
      <linearGradient id="sparkLine" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="rgba(255,46,99,.5)"/>
        <stop offset="100%" stop-color="#FF2E63"/>
      </linearGradient>`;
    svg.appendChild(defs);

    if (fill) {
      svg.appendChild(el("path", {
        d: `M${xy[0][0]},${H} L` + line.replace(/ /g, " L") + ` L${xy[xy.length - 1][0]},${H} Z`,
        fill: "url(#sparkFill)"
      }));
    }
    svg.appendChild(el("polyline", { points: line, fill: "none", stroke: "url(#sparkLine)", "stroke-width": 2.4,
      "stroke-linejoin": "round", "stroke-linecap": "round", filter: "drop-shadow(0 0 6px rgba(255,46,99,.45))" }));
    const last = xy[xy.length - 1];
    svg.appendChild(el("circle", { cx: last[0], cy: last[1], r: 4.6, fill: "rgba(255,46,99,.25)" }));
    svg.appendChild(el("circle", { cx: last[0], cy: last[1], r: 3.2, fill: "#FFE6ED" }));
  }

  async function price() {
    const svg = $("np-price-spark"); if (!svg) return;
    const panel = svg.closest(".panel");
    // Reading the feed can take several seconds. An em-dash in a card the
    // height of the two beside it reads as broken, so say what is happening.
    panel?.classList.add("panel-loading");
    $("np-price-sub").textContent = "reading the FTSO feed\u2026";

    // The value comes from the FTSOv2 feed, read on-chain by operator.js, which
    // loads first on every page. That is the oracle this provider helps run, it
    // is seconds old, and it does not depend on an exchange listing FLR.
    const chainPrice = () => new Promise((resolve) => {
      let waited = 0;
      const tick = () => {
        if (Number.isFinite(window.__flrPriceUsd)) return resolve(window.__flrPriceUsd);
        if ((waited += 200) > 9000) return resolve(null);
        setTimeout(tick, 200);
      };
      tick();
    });

    // Candles for the sparkline. The chain gives a spot price and nothing else,
    // so the seven-day shape still needs an exchange - measured, three of them
    // answer and allow a browser to call them.
    const HISTORY = [
      ["https://api.exchange.coinbase.com/products/FLR-USD/candles?granularity=21600",
       (c) => c.slice(0, 28).reverse().map((r) => r[4])],
      ["https://api.coingecko.com/api/v3/coins/flare-networks/market_chart?vs_currency=usd&days=7",
       (c) => (c.prices || []).map((r) => r[1]).filter(Number.isFinite).slice(-28)],
      ["https://api.kraken.com/0/public/OHLC?pair=FLRUSD&interval=240",
       (c) => (Object.values(c.result || {})[0] || []).slice(-28).map((r) => Number(r[4])).filter(Number.isFinite)]
    ];
    async function closes() {
      for (const [url, pick] of HISTORY) {
        try {
          const rows = pick(await jget(url));
          if (rows && rows.length > 2) return rows;
        } catch (_) { /* next source */ }
      }
      return null;
    }

    const [spot, series] = await Promise.all([chainPrice(), closes()]);
    const last = Number.isFinite(spot) ? spot : (series ? series[series.length - 1] : null);

    if (!Number.isFinite(last)) {
      // Nothing could be read at all. A dead card the size of the two beside it
      // reads as a broken site, so it steps out of the row instead.
      panel?.setAttribute("hidden", "");
      panel?.classList.remove("panel-loading");
      return;
    }

    // The nav reads the stored currency preference, so this card has to as
    // well - otherwise the same coin carries a dollar price here and a euro
    // price two centimetres away. operator.js owns both and announces changes.
    panel?.classList.remove("panel-loading");
    let delta = null;
    if (series && series.length > 2) delta = ((last - series[0]) / series[0]) * 100;

    function draw(state) {
      const cur = state?.currency === "EUR" ? "EUR" : "USD";
      const converted = cur === "USD" ? last : state?.prices?.EUR;
      const value = Number.isFinite(converted) ? converted : last;
      const sym = Number.isFinite(converted) && cur === "EUR" ? "\u20ac" : "$";
      $("np-price").textContent = sym + value.toFixed(5);
      $("np-price-sub").textContent = Number.isFinite(spot)
        ? "from the FTSO feed \u00b7 on-chain"
        : "market data \u00b7 7 days";
    }
    draw(window.__flrPriceState);
    addEventListener("flr-price", (e) => draw(e.detail));

    // Hand the seven-day move to anything else that wants it - the ticker does.
    try {
      window.__flrPriceState = Object.assign({ prices: {}, currency: "USD" }, window.__flrPriceState, { delta7d: delta });
      dispatchEvent(new CustomEvent("flr-price", { detail: window.__flrPriceState }));
    } catch (_) { /* nothing else needs it badly enough to fail here */ }

    if (delta != null) {
      const chip = $("np-price-delta");
      chip.textContent = (delta >= 0 ? "\u25b2 +" : "\u25bc ") + delta.toFixed(1) + "% 7D";
      chip.style.color = delta >= 0 ? "#35C77E" : RED;
      spark(svg, series.concat(Number.isFinite(spot) ? [spot] : []));
    } else {
      // A price with no history is still worth showing; the sparkline is not.
      svg.setAttribute("hidden", "");
    }
  }

  /* The capacity dial.

     It used to be two flat rings on a flat disc: a grey track, a pink arc, a
     grey track, an amber arc. At a glance it read as a loading spinner. It is
     an instrument now - a tick bezel, a recessed track, a lit arc with a cap
     marker, and the reading in the middle - and none of it moves, which is
     the point: it has to carry on a phone with Reduce Motion on. */
  function gauge(svg, fillPct, daysLeft, periodPct) {
    if (!svg) return;
    const CX = 60, CY = 60;
    const pct = Number.isFinite(fillPct) ? Math.max(0, Math.min(100, fillPct)) : null;
    const period = Number.isFinite(periodPct) ? Math.max(0, Math.min(100, periodPct)) : 0;

    const defs = el("defs");
    defs.innerHTML = `
      <linearGradient id="gaugeArc" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#FF7FA3"/>
        <stop offset="55%" stop-color="#FF2E63"/>
        <stop offset="100%" stop-color="#D81048"/>
      </linearGradient>
      <linearGradient id="gaugePeriod" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#FFD27A"/>
        <stop offset="100%" stop-color="#F2B233"/>
      </linearGradient>
      <filter id="gaugeGlow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="2" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>`;
    svg.appendChild(defs);

    // Tick bezel: 48 marks, every sixth one longer. Gives the dial a scale to
    // read against instead of a bare ring.
    const ticks = el("g", { opacity: ".5" });
    for (let i = 0; i < 48; i += 1) {
      const a = (i / 48) * Math.PI * 2 - Math.PI / 2;
      const major = i % 6 === 0;
      const r1 = 57, r2 = major ? 52.5 : 54.5;
      ticks.appendChild(el("line", {
        x1: CX + Math.cos(a) * r1, y1: CY + Math.sin(a) * r1,
        x2: CX + Math.cos(a) * r2, y2: CY + Math.sin(a) * r2,
        stroke: major ? "rgba(255,255,255,.3)" : "rgba(255,255,255,.13)",
        "stroke-width": major ? 1.4 : 1, "stroke-linecap": "round"
      }));
    }
    svg.appendChild(ticks);

    const ring = (r, w, stroke, frac, extra) => el("circle", Object.assign({
      cx: CX, cy: CY, r, fill: "none", stroke, "stroke-width": w, "stroke-linecap": "round",
      "stroke-dasharray": `${2 * Math.PI * r * frac} ${2 * Math.PI * r}`,
      transform: `rotate(-90 ${CX} ${CY})`
    }, extra || {}));

    // Capacity: recessed track, then the lit arc.
    svg.appendChild(el("circle", { cx: CX, cy: CY, r: 44, fill: "none", stroke: "rgba(0,0,0,.45)", "stroke-width": 10 }));
    svg.appendChild(el("circle", { cx: CX, cy: CY, r: 44, fill: "none", stroke: "rgba(255,255,255,.07)", "stroke-width": 9 }));
    if (pct != null) {
      svg.appendChild(ring(44, 9, "url(#gaugeArc)", pct / 100, { filter: "url(#gaugeGlow)" }));
      // A bright cap at the end of the arc, so the reading has a needle.
      const a = (pct / 100) * Math.PI * 2 - Math.PI / 2;
      svg.appendChild(el("circle", { cx: CX + Math.cos(a) * 44, cy: CY + Math.sin(a) * 44, r: 3.4, fill: "#FFE6ED" }));
    }

    // Staking period: a thinner inner arc in the warning colour.
    svg.appendChild(el("circle", { cx: CX, cy: CY, r: 32, fill: "none", stroke: "rgba(255,255,255,.055)", "stroke-width": 5 }));
    svg.appendChild(ring(32, 5, "url(#gaugePeriod)", period / 100));

    const t1 = el("text", { x: CX, y: CY + 2, "text-anchor": "middle", "font-size": 21, "font-weight": 800,
      fill: "#F4F4F8", "font-family": "Archivo, sans-serif", "letter-spacing": "-.5" });
    t1.textContent = pct != null ? `${Math.round(pct)}%` : "-";
    // "full \u00b7 18d left" did not fit inside the ring and was clipped at
    // both ends. The ring shows how full; the days belong beside it.
    const t2 = el("text", { x: CX, y: CY + 17, "text-anchor": "middle", "font-size": 9, fill: MUT,
      "font-family": "IBM Plex Mono, monospace", "letter-spacing": ".6" });
    t2.textContent = "taken";
    svg.append(t1, t2);
  }

  function strip(svg, weights, ourIdx, cutoff) {
    if (!svg) return;
    const n = weights.length, W = 1200, base = 78;
    const fs = (px) => fontUnits(svg, px, W);
    const max = weights[0];
    weights.forEach((w, i) => {
      const h = Math.max(4, Math.pow(w / max, 0.5) * 64);
      const me = i === ourIdx;
      svg.appendChild(el("rect", { x: (i * W) / n + 0.5, y: base - h, width: W / n - 1.8, height: h, rx: 2,
        fill: me ? MAG : DIM, ...(me ? { filter: "drop-shadow(0 0 6px rgba(255,46,99,.7))" } : {}) }));
    });
    svg.appendChild(el("line", { x1: 0, x2: W, y1: base, y2: base, stroke: "rgba(255,255,255,.12)" }));
    const ourLabel = `Mirhollio Core · #${ourIdx + 1}`;
    const ourLabelW = ourLabel.length * fs(11) * 0.62;
    const t = el("text", { x: Math.min((ourIdx * W) / n + 6, W - ourLabelW), y: fs(11), "font-size": fs(11), fill: MAGL, "font-family": mono });
    t.textContent = ourLabel;
    svg.appendChild(t);
    // The 92-unit box was sized for 10-unit text; a legible label needs more
    // room under the axis, and the element is height:auto so it can grow.
    const endFont = fs(11);
    svg.setAttribute("viewBox", `0 0 ${W} ${Math.max(92, base + endFont * 1.45 + 6)}`);
    for (const [x, lab, anch] of [[2, "#1", "start"], [W - 2, "#" + n, "end"]]) {
      const tt = el("text", { x, y: base + endFont + 2, "font-size": endFont, fill: MUT, "font-family": mono, "text-anchor": anch }); tt.textContent = lab; svg.appendChild(tt);
    }
  }

  // Where we sit in the field of providers. The old version scaled the track to
  // our own value times 1.25, so the bar stopped at exactly 80% whatever the
  // number was and its length said nothing. This spans the actual spread of
  // providers instead, so position on the track is the information.
  function rrCurve(svg, rr) {
    if (!svg || !rr || rr.ours == null || rr.median == null) return;
    const W = 320, H = 74, PAD = 10;
    const fs = (px) => fontUnits(svg, px, W);
    const field = [rr.ours, rr.median, rr.p25, rr.p75, ...(rr.curve || [])]
      .map(Number).filter(Number.isFinite);
    let lo = Math.min(...field), hi = Math.max(...field);
    if (!(hi > lo)) { lo = 0; hi = rr.ours * 1.25 || 1; }
    const room = (hi - lo) * 0.08;
    lo -= room; hi += room;
    const x = (v) => PAD + ((v - lo) / (hi - lo)) * (W - PAD * 2);
    const yy = 36;

    svg.appendChild(el("rect", { x: PAD, y: yy - 5, width: W - PAD * 2, height: 10, rx: 5,
      fill: "rgba(255,255,255,.07)" }));

    // the middle half of the field, so "typical" is a region rather than a point
    if (Number.isFinite(rr.p25) && Number.isFinite(rr.p75)) {
      svg.appendChild(el("rect", { x: x(rr.p25), y: yy - 5, width: Math.max(x(rr.p75) - x(rr.p25), 2),
        height: 10, rx: 5, fill: "rgba(255,255,255,.19)" }));
    }
    // every sampled provider, so the spread is visible and not just implied
    (rr.curve || []).forEach((v) => {
      if (!Number.isFinite(v)) return;
      svg.appendChild(el("line", { x1: x(v), x2: x(v), y1: yy - 9, y2: yy + 9,
        stroke: "rgba(255,255,255,.20)", "stroke-width": 1.5 }));
    });

    svg.appendChild(el("line", { x1: x(rr.median), x2: x(rr.median), y1: yy - 13, y2: yy + 13,
      stroke: "rgba(255,255,255,.65)", "stroke-width": 2, "stroke-dasharray": "3 3" }));
    svg.appendChild(el("circle", { cx: x(rr.ours), cy: yy, r: 7, fill: MAGL, stroke: "#17171d",
      "stroke-width": 2, filter: "drop-shadow(0 0 7px rgba(255,46,99,.65))" }));

    const half = (t, size) => (t.length * size * 0.6) / 2;
    const ourFont = fs(11), medFont = fs(11);
    const ourTxt = `${(rr.ours * 100).toFixed(2)}%`;
    const medTxt = `median ${(rr.median * 100).toFixed(2)}%`;
    const clamp = (v, w) => Math.min(Math.max(v, w + 2), W - w - 2);

    const to = el("text", { x: clamp(x(rr.ours), half(ourTxt, ourFont)), y: yy - 16,
      "font-size": ourFont, "font-weight": 700, fill: MAGL,
      "font-family": "Archivo, sans-serif", "text-anchor": "middle" });
    to.textContent = ourTxt; svg.appendChild(to);

    const tm = el("text", { x: clamp(x(rr.median), half(medTxt, medFont)), y: yy + 16 + medFont,
      "font-size": medFont, fill: MUT, "font-family": mono, "text-anchor": "middle" });
    tm.textContent = medTxt; svg.appendChild(tm);
  }

  // These charts draw in a 1000-unit space but render into a ~330px panel, so a
  // font-size of 10 units lands on screen at ~3px. Convert a wanted CSS pixel
  // size into the user units that actually produce it at the current width.
  function fontUnits(svg, cssPx, viewWidth) {
    const rendered = svg.getBoundingClientRect().width;
    if (!rendered) return cssPx;
    // Round up: a requested size must never come out below what was asked for,
    // or a label lands just under the legibility floor the rest of the site keeps.
    return Math.ceil(cssPx * (viewWidth / rendered) * 10) / 10;
  }

  // The panels are taller than the 1000x300 box these charts declare, so the
  // drawing was letterboxed and a band of dead space sat above and below it.
  // Derive the drawing height from the box the element actually occupies.
  function fitHeight(svg, viewWidth, fallbackHeight) {
    const b = svg.getBoundingClientRect();
    if (!b.width || !b.height) return fallbackHeight;
    return Math.round(viewWidth * (b.height / b.width));
  }

  // With labels at a legible size, every-bar ticks collide. Keep one in N so a
  // label always has room for its own width.
  function labelStride(count, slotUnits, labelUnits) {
    if (slotUnits <= 0) return 1;
    return Math.max(1, Math.ceil(labelUnits / slotUnits));
  }

  function weightChart(svg, hist) {
    if (!svg || !hist.length) return;
    const W = 1000;
    const H = fitHeight(svg, W, 300);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const fs = (px) => fontUnits(svg, px, W);
    const T = Math.max(14, fs(11) + 6);
    // The gutters have to fit their own labels once the text is legible:
    // otherwise the epoch row sits across the baseline it belongs under.
    const L = Math.max(44, 6 + 4 * fs(11) * 0.62);
    const B = Math.max(34, fs(11) + 14);
    const maxW = Math.max(...hist.map((h) => h.weight), 100);
    const maxBase = Math.max(...hist.map((h) => h.stakeM * 5 + h.wflrM));
    const gw = (W - L) / hist.length;
    for (const g of [0, 0.5, 1]) {
      const y = T + (H - T - B) * (1 - g);
      svg.appendChild(el("line", { x1: L, x2: W, y1: y, y2: y, stroke: "rgba(255,255,255,.07)", "stroke-width": fs(1) }));
      const t = el("text", { x: L - 6, y: y + 3, "font-size": fs(11), fill: MUT, "font-family": mono, "text-anchor": "end" }); t.textContent = Math.round(maxW * g); svg.appendChild(t);
    }
    const epochStride = labelStride(hist.length, gw, String(hist[hist.length - 1].epoch).length * fs(11) * 0.62 + 6);
    const pts = [];
    hist.forEach((h, i) => {
      const x = L + i * gw + gw / 2;
      const sh = ((h.stakeM * 5) / maxBase) * (H - T - B) * 0.92;
      const wh = Math.max(((h.wflrM) / maxBase) * (H - T - B) * 0.92, 2);
      svg.appendChild(el("rect", { x: x - fs(5), y: H - B - sh, width: fs(6), height: sh, rx: fs(1.5), fill: "#4A3540" }));
      svg.appendChild(el("rect", { x: x + fs(2), y: H - B - wh, width: fs(2.6), height: wh, rx: fs(1.3), fill: AMBER }));
      if (i % epochStride === 0 || i === hist.length - 1) {
        const tl = el("text", { x, y: H - B + fs(11) + 4, "font-size": fs(11), fill: MUT, "font-family": mono, "text-anchor": "middle" }); tl.textContent = h.epoch; svg.appendChild(tl);
      }
      pts.push([x, T + (H - T - B) * (1 - h.weight / maxW), h.weight]);
    });
    svg.appendChild(el("polyline", { points: pts.map((p) => p[0] + "," + p[1]).join(" "), fill: "none", stroke: MAG, "stroke-width": fs(2.2), "stroke-linejoin": "round", filter: "drop-shadow(0 0 5px rgba(255,46,99,.5))" }));
    pts.forEach((p, i) => {
      svg.appendChild(el("circle", { cx: p[0], cy: p[1], r: fs(3), fill: MAG }));
      if (i === 0 || i === pts.length - 1 || Math.abs(pts[Math.max(i-1,0)][2] - p[2]) > 15) {
        // A centred label on the first or last point hangs half its width off
        // the chart and gets clipped by the frame, so those two anchor to the
        // edge they sit against.
        const first = i === 0, lastPoint = i === pts.length - 1;
        const anchor = first ? "start" : lastPoint ? "end" : "middle";
        const tx = first ? Math.max(p[0] - fs(6), L) : lastPoint ? Math.min(p[0] + fs(6), W) : p[0];
        const t = el("text", { x: tx, y: Math.max(p[1] - fs(8), T + fs(11)), "font-size": fs(11), "font-weight": 700, fill: MAGL, "font-family": "Archivo, sans-serif", "text-anchor": anchor }); t.textContent = p[2].toFixed(1); svg.appendChild(t);
      }
    });
  }

  function expiryChart(svg, val) {
    if (!svg || !val) return;
    const W = 1000;
    const H = fitHeight(svg, W, 260);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const fs = (px) => fontUnits(svg, px, W);
    const T = Math.max(12, fs(11) + 6);
    const B = Math.max(30, fs(11) + 14);
    const L = Math.max(48, 6 + 4 * fs(11) * 0.62);
    const start = val.totalStakeM;
    const steps = val.expirySteps;
    if (!steps.length) return;
    const t0 = Date.now(), t1 = new Date(steps[steps.length - 1].date).getTime() + 3 * 864e5;
    const x = (d) => L + ((new Date(d).getTime() - t0) / (t1 - t0)) * (W - L - 8);
    const y = (v) => T + (H - T - B) * (1 - v / start);
    for (const g of [0, 0.5, 1]) {
      svg.appendChild(el("line", { x1: L, x2: W, y1: y(start * g), y2: y(start * g), stroke: "rgba(255,255,255,.07)", "stroke-width": fs(1) }));
      const t = el("text", { x: L - 6, y: y(start * g) + (g === 0 ? -5 : 3), "font-size": fs(11), fill: MUT, "font-family": mono, "text-anchor": "end" }); t.textContent = Math.round(start * g) + "M"; svg.appendChild(t);
    }
    let d = `M${L},${y(start)}`; let cur = start;
    for (const s of steps) { d += ` H${Math.max(x(s.date), L)}`; cur = s.remainingM + (s.date < val.stakeEndsAt ? val.selfBondM : 0); d += ` V${y(Math.max(cur, 0))}`; }
    d += ` H${W - 8}`;
    svg.appendChild(el("path", { d: d + ` V${y(0)} H${L} Z`, fill: "rgba(255,46,99,.10)" }));
    svg.appendChild(el("path", { d, fill: "none", stroke: MAG, "stroke-width": fs(2.2), filter: "drop-shadow(0 0 5px rgba(255,46,99,.5))" }));
    const xe = x(val.stakeEndsAt);
    svg.appendChild(el("line", { x1: xe, x2: xe, y1: T, y2: y(0), stroke: AMBER, "stroke-width": fs(1.4), "stroke-dasharray": `${fs(4)} ${fs(4)}` }));
    // At a legible size the full sentence no longer fits the panel, so keep the
    // date and trim the prose, and hold the text inside the left edge.
    const annFont = fs(10.5);
    const annText = val.stakeEndsAt + " — self-bond ends";
    const t = el("text", { x: Math.max(xe - 6, L + annText.length * annFont * 0.62), y: T + annFont, "font-size": annFont, fill: AMBER, "font-family": mono, "text-anchor": "end" });
    t.textContent = annText; svg.appendChild(t);
    // Dates are not evenly spaced, so drop any tick that would touch the last
    // one drawn rather than keeping a fixed every-Nth rule.
    const dateFont = fs(11);
    const minGap = 5 * dateFont * 0.62 + dateFont;
    let lastX = -Infinity;
    for (const [d0, lab] of steps.map((s) => [s.date, s.date.slice(5)])) {
      const tx = x(d0);
      if (tx - lastX < minGap || tx > W - 4) continue;
      lastX = tx;
      const tt = el("text", { x: tx, y: H - B + dateFont + 4, "font-size": dateFont, fill: MUT, "font-family": mono, "text-anchor": "middle" }); tt.textContent = lab; svg.appendChild(tt);
    }
  }

  async function main() {
    price();
    let np = null;
    try { np = await jget("/data/network-position.json?v=core-4"); } catch { return; }
    // How full the validator is, is measured by the watch feed, not this one.
    let cap = null;
    try { cap = (await jget("/data/watch-status.json?v=core-4"))?.validator || null; } catch { cap = null; }
    const p = np.position, rr = np.rewardRate, val = np.validator;
    // hero chips
    if ($("np-rr-rank") && rr) { $("np-rr-rank").textContent = `#${rr.rank} of ${rr.count} providers`; }
    if ($("np-rr-sub") && rr) { $("np-rr-sub").innerHTML = `network median ${(rr.median * 100).toFixed(2)}% — <b style="color:${MAGL}">${(rr.ours / rr.median).toFixed(1)}×</b> above`; }
    rrCurve($("np-rr-curve"), rr);
    if ($("np-stake-end") && val) $("np-stake-end").textContent = "ends " + val.stakeEndsAt.slice(5).replace("-", "/");
    if ($("np-stake") && val) $("np-stake").innerHTML = fmt(val.totalStakeM, 1) + "M<small> FLR</small>";
    const days = val ? Math.max(0, Math.round((new Date(val.stakeEndsAt) - Date.now()) / 864e5)) : null;
    // How full the validator actually is, from the feed that measures it.
    // This used to be the literal 100, so the page told every visitor the node
    // was full while it had millions of FLR of room.
    const fill = Number.isFinite(cap?.fillPct) ? cap.fillPct : null;
    gauge($("np-gauge"), fill, days, days != null ? Math.min(100, 100 - (days / 92) * 100) : 0);

    // Six facts used to run together across three lines joined by middots -
    // "self-bond 6M · 83 delegations", "2.18M FLR still free · 18d left",
    // "uptime 99.75% · APR 1.45%". Nothing lined up and nothing was
    // scannable. They are a label/value grid now. The uptime and APR spans
    // are moved rather than rebuilt, so operator.js keeps filling them.
    const facts = $("np-stake-sub2");
    if (facts && val) {
      const freeM = cap ? cap.free / 1e6 : null;
      const up = document.querySelector('[data-field="validatorUptimeSnapshot"]');
      const apr = document.querySelector('[data-field="validatorAprSnapshot"]');
      const row = (label, value) => `<span><i>${label}</i><b>${value}</b></span>`;
      facts.className = "p-facts";
      facts.innerHTML =
        row("self-bond", `${fmt(val.selfBondM, 0)}M`) +
        row("delegations", val.delegators) +
        row("free", freeM == null ? "&ndash;" : freeM >= 0.01 ? `${fmt(freeM, 2)}M` : "none") +
        row("renews in", days == null ? "&ndash;" : `${days}d`) +
        row("uptime", '<span data-slot="uptime"></span>') +
        row("APR", '<span data-slot="apr"></span>');
      const slotUp = facts.querySelector('[data-slot="uptime"]');
      const slotApr = facts.querySelector('[data-slot="apr"]');
      if (up && slotUp) slotUp.replaceWith(up);
      if (apr && slotApr) slotApr.replaceWith(apr);
      // The two lines these six facts replaced.
      const spare = $("np-stake-sub");
      if (spare) spare.remove();
      const legacy = facts.parentElement && facts.parentElement.querySelector(".p-sub:last-child");
      if (legacy && legacy !== facts && !legacy.querySelector("[data-field]")) legacy.remove();
      else if (legacy && legacy !== facts && legacy.childElementCount === 0) legacy.remove();
    }
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
    // proof sekcija
    if ($("pf-rank") && rr) { $("pf-rank").textContent = "#" + rr.rank;
      $("pf-rank-sub").textContent = `of ${rr.count} providers — top ${Math.max(1, Math.ceil((rr.rank / rr.count) * 100))}%`; }
    if ($("pf-avail") && p.availabilityPct != null) $("pf-avail").textContent = p.availabilityPct.toFixed(1).replace(".0", "") + "%";
    if ($("pf-passes") && p.passes != null) { $("pf-passes").textContent = p.passes + "/3";
      $("pf-passes-sub").textContent = p.eligible ? "eligible for rewards" : "minimal conditions"; }
    // Two definitions of "uptime" were on this page at once: the P-chain's
    // current flag, which reads 100%, and the average across recent reward
    // epochs, which reads 99.75%. Side by side they looked like one of them
    // was wrong. The average is the conservative one and the one the rest of
    // the site quotes, so it wins here; the P-chain figure only fills in if
    // operator.js could not produce an average.
    if ($("pf-uptime")) {
      const node = $("pf-uptime");
      const sub = node.parentElement?.querySelector(".ps");
      const fallback = val && val.uptime != null ? val.uptime.toFixed(1) + "%" : null;
      let waited = 0;
      const settle = () => {
        const avg = window.__fieldValue?.("validatorUptimeAvg");
        if (avg && avg !== "-") {
          node.textContent = avg;
          if (sub) sub.textContent = "average, recent epochs";
          return;
        }
        if ((waited += 250) > 8000) {
          if (fallback) node.textContent = fallback;
          return;
        }
        setTimeout(settle, 250);
      };
      settle();
    }
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
      const LIMIT = 8;
      if (rows.length > LIMIT) {
        const hidden = rows.slice(LIMIT).map((r) => r.replace("<tr>", '<tr class="np-more" hidden>'));
        tb.innerHTML = rows.slice(0, LIMIT).join("") + hidden.join("") +
          `<tr class="np-toggle-row"><td colspan="5"><button type="button" class="np-toggle" id="np-del-toggle">Show all ${rows.length} delegations ▾</button></td></tr>`;
        const btn = document.getElementById("np-del-toggle");
        btn.addEventListener("click", () => {
          const more = tb.querySelectorAll(".np-more");
          const open = btn.dataset.open === "1";
          more.forEach((r) => { r.hidden = open; });
          btn.dataset.open = open ? "0" : "1";
          btn.textContent = open ? `Show all ${rows.length} delegations ▾` : "Show fewer ▴";
        });
      } else {
        tb.innerHTML = rows.join("") || '<tr><td colspan="5">No active delegations.</td></tr>';
      }
      const sub = document.getElementById("np-del-sub");
      if (sub) sub.textContent = `${dels.length} active delegations · ${(total/1e6).toFixed(2)}M FLR delegated + ${(selfB/1e6).toFixed(0)}M self-bond · live from P-chain`;
    } catch (e) {
      if (tb) tb.innerHTML = '<tr><td colspan="5">Live P-chain data unavailable right now.</td></tr>';
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();

/* delegation calculator (FTSO page)
   Reads the reward rate the page is already showing rather than hardcoding one,
   so the estimate always matches the figure above it. The rate is annualised —
   it tracks the validator APR closely, which a per-epoch figure could not. */
(() => {
  const inp = document.getElementById("ftso-calc-in"); if (!inp) return;
  const out = document.getElementById("ftso-calc-out");
  const num = el => {
    const v = el && parseFloat((el.textContent || "").replace(",", ".").replace(/[^\d.\-]/g, ""));
    return Number.isFinite(v) ? v : null;
  };
  function calc() {
    const amt = parseFloat(inp.value);
    const rate = num(document.querySelector('[data-field="rewardRate"]'));
    if (!Number.isFinite(amt) || amt <= 0) {
      out.textContent = "Enter an amount to estimate rewards."; return;
    }
    if (!rate || rate <= 0) {
      out.textContent = "Live reward rate still loading — try again in a moment."; return;
    }
    const yr = amt * (rate / 100), mo = yr / 12;
    const f = n => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
    out.innerHTML = `\u2248 <b>${f(mo)} FLR / month</b> \u00b7 ${f(yr)} FLR / year at the current ${rate.toFixed(2)}% reward rate (after the provider fee; past performance is not a guarantee).`;
  }
  inp.addEventListener("input", calc);
  document.getElementById("ftso-calc-btn")?.addEventListener("click", calc);
})();

/* staking calculator (validator page)
   The validator APR field has never populated — the upstream validators payload
   carries no APR for this node, so the estimate had nothing to work from and sat
   on "Live APR still loading" indefinitely. Fall back to the reward rate the
   pipeline does publish, and label the output for whichever source answered so
   the figure is never passed off as something it is not. */
(() => {
  const inp = document.getElementById("np-calc-in"); if (!inp) return;
  const out = document.getElementById("np-calc-out");
  let published = null;

  const num = el => {
    const v = el && parseFloat((el.textContent || "").replace(",", ".").replace(/[^\d.\-]/g, ""));
    return Number.isFinite(v) && v > 0 ? v : null;
  };

  async function rate() {
    const apr = num(document.querySelector('[data-field="validatorApr"]'));
    if (apr) return { pct: apr, label: "APR" };
    if (published === null) {
      published = await fetch("/data/network-position.json")
        .then(r => r.json())
        .then(d => {
          const v = d && d.rewardRate && d.rewardRate.ours;
          return Number.isFinite(v) ? v * 100 : 0;
        })
        .catch(() => 0);
    }
    return published ? { pct: published, label: "published reward rate" } : null;
  }

  async function calc() {
    const amt = parseFloat(inp.value);
    if (!Number.isFinite(amt) || amt <= 0) {
      out.textContent = "Enter an amount to estimate rewards."; return;
    }
    const r = await rate();
    if (!r) { out.textContent = "Reward rate unavailable right now — try again in a moment."; return; }
    const yr = amt * (r.pct / 100), mo = yr / 12;
    const f = n => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
    out.innerHTML = `\u2248 <b>${f(mo)} FLR / month</b> \u00b7 ${f(yr)} FLR / year at the current ${r.pct.toFixed(2)}% ${r.label} (after the validator fee; past performance is not a guarantee).`;
  }

  inp.addEventListener("input", calc);
  document.getElementById("np-calc-btn")?.addEventListener("click", calc);
})();

/* live reward-epoch pulse in the sidebar (every page) */
(() => {
  const T0 = 1787857200, E0 = 428, LEN = 302400; // epoch 428 start, 3.5d epochs
  const host = document.querySelector(".side > div");
  if (!host) return;
  const box = document.createElement("div");
  box.className = "epoch-pulse";
  box.innerHTML = '<div class="ep-row"><span>Epoch <b id="ep-n">–</b></span><span>ends in <b id="ep-left">–</b></span></div><div class="ep-bar"><div class="ep-fill" id="ep-fill" style="width:0%"></div></div>';
  host.appendChild(box);
  const n = document.getElementById("ep-n"), l = document.getElementById("ep-left"), f = document.getElementById("ep-fill");
  function tick() {
    const now = Date.now() / 1000;
    const ep = Math.floor((now - T0) / LEN) + E0;
    const st = T0 + (ep - E0) * LEN;
    const left = st + LEN - now;
    const pct = ((now - st) / LEN) * 100;
    n.textContent = ep;
    const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = Math.floor(left % 60);
    l.textContent = h > 0 ? `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s` : `${m}m ${String(s).padStart(2, "0")}s`;
    f.style.width = pct.toFixed(2) + "%";
  }
  tick(); setInterval(tick, 1000);
})();
/* hero graphics: data rays canvas + tilt/glow + live ticker */
(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* --- data rays --- */
  const cv = document.getElementById("rays");
  if (cv && !reduced) {
    const ctx = cv.getContext("2d");
    let W, H, parts = [], running = false, raf = 0;
    const DPR = Math.min(devicePixelRatio || 1, 2);
    function size() {
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = W * DPR; cv.height = H * DPR; ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    function spawn() {
      const fromLeft = Math.random() < 0.7;
      return { x: fromLeft ? -20 : Math.random() * W, y: Math.random() * H,
        vx: 0.25 + Math.random() * 0.55, vy: (Math.random() - 0.5) * 0.12,
        len: 26 + Math.random() * 60, a: 0.04 + Math.random() * 0.14, w: Math.random() < 0.25 ? 1.6 : 1 };
    }
    function step() {
      if (!running) return;
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x - p.len > W) Object.assign(p, spawn(), { x: -20 });
        const g = ctx.createLinearGradient(p.x - p.len, p.y, p.x, p.y);
        g.addColorStop(0, "rgba(255,46,99,0)"); g.addColorStop(1, `rgba(255,46,99,${p.a})`);
        ctx.strokeStyle = g; ctx.lineWidth = p.w;
        ctx.beginPath(); ctx.moveTo(p.x - p.len, p.y - p.vy * p.len); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      raf = requestAnimationFrame(step);
    }
    function start() { if (running) return; running = true; size(); if (!parts.length) parts = Array.from({ length: 34 }, spawn); step(); }
    function stop() { running = false; cancelAnimationFrame(raf); }
    new IntersectionObserver((e) => { e[0].isIntersecting && !document.hidden ? start() : stop(); }).observe(cv);
    document.addEventListener("visibilitychange", () => { document.hidden ? stop() : start(); });
    addEventListener("resize", () => { if (running) size(); });
  }
  /* --- tilt + glow --- */
  if (!reduced) {
    document.querySelectorAll(".panel, .why-card").forEach((el) => {
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        el.style.setProperty("--mx", (px * 100).toFixed(1) + "%");
        el.style.setProperty("--my", (py * 100).toFixed(1) + "%");
        el.style.transform = `perspective(900px) rotateX(${((0.5 - py) * 3).toFixed(2)}deg) rotateY(${((px - 0.5) * 3).toFixed(2)}deg)`;
      });
      el.addEventListener("pointerleave", () => { el.style.transform = ""; });
    });
  }
  /* --- live ticker --- */
  const segA = document.getElementById("ticker-a"), segB = document.getElementById("ticker-b");
  if (segA) {
    const T0 = 1787857200, E0 = 428, LEN = 302400;
    const S = { price: null, delta: null, rank: null, voters: null, rrRank: null, rrCount: null, weight: null, uptime: null, stake: null, days: null };
    function esc(x) { return String(x); }
    function render() {
      const now = Date.now() / 1000;
      const ep = Math.floor((now - T0) / LEN) + E0;
      const left = T0 + (ep - E0 + 1) * LEN - now;
      const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60);
      const parts = [];
      parts.push(`FLR <b>${S.price != null ? "$" + S.price.toFixed(5) : "…"}</b>${S.delta != null ? ` <span class="${S.delta >= 0 ? "up" : "down"}">${S.delta >= 0 ? "▲" : "▼"}${Math.abs(S.delta).toFixed(1)}% 7d</span>` : ""}`);
      parts.push(`epoch <b>${ep}</b> ends in <b>${h}h ${String(m).padStart(2, "0")}m</b>`);
      if (S.rrRank) parts.push(`reward rate <em>#${S.rrRank}</em> of ${S.rrCount} providers`);
      if (S.rank) parts.push(`network weight <b>#${S.rank}</b> of ${S.voters ?? "?"}`);
      if (S.stake) parts.push(`validator stake <b>${S.stake}M FLR</b>${S.days != null ? ` · renews in ${S.days}d` : ""}`);
      // Was a hardcoded 100%. The validator card on this same page showed the
      // measured figure, so the two disagreed in plain sight.
      // Two definitions of uptime existed on this page: the P-chain's current
      // flag (100%) and the average across recent reward epochs (99.75%). The
      // average is what the rest of the site quotes, so it wins whenever
      // operator.js has produced one - which is usually after this first ran.
      const avg = Number.parseFloat(String(window.__fieldValue?.("validatorUptimeAvg") ?? ""));
      const uptime = Number.isFinite(avg) ? avg : S.uptime;
      if (uptime != null) parts.push(`uptime <b>${uptime.toFixed(1)}%</b>`);
      parts.push(`<em>formerly MirSFlr</em>`);
      const html = parts.map((p) => esc(p)).join('<span class="ticker-dot">\u25c6</span>');
      segA.innerHTML = html; segB.innerHTML = html;
      // The loop length is one segment's width, and that width changes every
      // time the countdown re-renders.
      if (typeof window.__tickerMeasure === "function") window.__tickerMeasure();
    }
    fetch("/data/network-position.json?v=core-10").then((r) => r.json()).then((np) => {
      S.rank = np.position && np.position.rank;
      S.voters = np.position && np.position.voters;
      if (np.rewardRate) { S.rrRank = np.rewardRate.rank; S.rrCount = np.rewardRate.count; }
      if (np.validator) {
        S.stake = np.validator.totalStakeM.toFixed(0);
        S.uptime = Number.isFinite(np.validator.uptime) ? np.validator.uptime : null;
        S.days = Math.max(0, Math.round((new Date(np.validator.stakeEndsAt) - Date.now()) / 864e5));
      }
      render();
    }).catch(render);
    // The price used to come from a second Coinbase call that duplicated the
    // one the hero card makes - and when Coinbase was unreachable the ticker
    // read "FLR ..." forever. It now takes whatever the shared price state has
    // (the FTSOv2 on-chain feed first, exchanges after) and redraws on change.
    function takePrice(detail) {
      const price = detail?.prices?.USD ?? window.__flrPriceUsd;
      if (Number.isFinite(price)) S.price = price;
      if (Number.isFinite(detail?.delta7d)) S.delta = detail.delta7d;
      render();
    }
    addEventListener("flr-price", (e) => takePrice(e.detail));
    takePrice(window.__flrPriceState);
    render(); setInterval(render, 30000);

    /* --- the band itself ---------------------------------------------------
       This was a CSS animation with a JS watchdog behind it. It was reported
       dead twice, and the reason was found here: with Reduce Motion on - which
       many people run on a phone without thinking about it - the stylesheet
       set `animation:none` and the watchdog was gated behind the same
       preference, so the strip froze at translate 0, flush left and cut off
       mid-word. That is worse than either moving or not existing.

       So there is no CSS animation any more. One requestAnimationFrame loop
       drives it, which also removes any dependence on how a given browser
       handles a percentage translate on a very wide flex container.

       Reduce Motion is still honoured, but by degree rather than by switching
       the content off: the strip is a single line of small text moving
       sideways, not a parallax or a zoom, so it runs at about a third of the
       speed instead of stopping. A tap pauses it either way, which is what
       WCAG 2.2.2 asks for; a mouse pauses it on hover. */
    const track = document.getElementById("ticker-track");
    const band = track && track.closest(".ticker-band");
    if (track && band) {
      track.classList.add("ticker-js");
      const FAST = 58, SLOW = 20;            // px per second
      let speed = reduced ? SLOW : FAST;
      let raf = 0, last = 0, x = 0, span = 0;
      let onScreen = false, paused = false;

      function measure() {
        // The track holds the segment twice; one segment's width is the loop.
        const first = track.firstElementChild;
        span = first ? first.getBoundingClientRect().width : track.getBoundingClientRect().width / 2;
      }

      function frame(now) {
        raf = 0;
        if (!onScreen || paused || document.hidden) return;
        if (last) {
          if (!span) measure();
          x -= (speed * Math.min(now - last, 64)) / 1000;   // cap after a tab switch
          if (span && x <= -span) x += span;
          track.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
        }
        last = now;
        raf = requestAnimationFrame(frame);
      }

      function run() {
        if (raf || paused || !onScreen || document.hidden) return;
        last = 0;
        raf = requestAnimationFrame(frame);
      }

      function stop() {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      }

      new IntersectionObserver((entries) => {
        onScreen = entries[0].isIntersecting;
        onScreen ? run() : stop();
      }).observe(band);

      document.addEventListener("visibilitychange", () => (document.hidden ? stop() : run()));
      addEventListener("resize", () => { measure(); }, { passive: true });
      // Fonts land after first paint and change the segment width under us.
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

      function setPaused(next) {
        paused = next;
        band.classList.toggle("is-paused", paused);
        band.setAttribute("aria-label", paused ? "Live ticker, paused" : "Live ticker, running");
        paused ? stop() : run();
      }
      // A mouse pauses by hovering and resumes by leaving. A finger has no
      // hover, so a tap toggles. Without the pointerType check a mouse click
      // would fire both and cancel itself out.
      let viaMouse = false;
      band.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") { viaMouse = true; setPaused(true); } });
      band.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { viaMouse = false; setPaused(false); } });
      band.addEventListener("pointerdown", (e) => { viaMouse = e.pointerType === "mouse"; });
      band.addEventListener("click", () => { if (!viaMouse) setPaused(!paused); });
      band.setAttribute("role", "button");
      band.setAttribute("tabindex", "0");
      band.setAttribute("aria-label", "Live ticker, running");
      band.removeAttribute("aria-hidden");
      band.addEventListener("keydown", (e) => {
        if (e.key === " " || e.key === "Enter") { e.preventDefault(); setPaused(!paused); }
      });

      window.__tickerMeasure = measure;
      measure();
    }
  }
})();

/* The FDC panel is a <details> so phones are not handed a 12-row table by
   default. Wide screens get it open, matching how it read before. */
(() => {
  const card = document.getElementById("fdc-perf");
  if (!card) return;
  const wide = window.matchMedia("(min-width: 761px)");
  const apply = () => { if (!card.dataset.userToggled) card.open = wide.matches; };
  card.addEventListener("toggle", () => { card.dataset.userToggled = "1"; });
  apply();
  wide.addEventListener("change", () => { delete card.dataset.userToggled; apply(); });
})();

/* FDC performance table, from the oracle-daemon v2 payload, cache-first.
   The operator-earnings panel this block used to fill has been removed: it
   addressed the reader as the person collecting the fee, which on a page a
   prospective delegator reads is exactly backwards. The arithmetic went with
   it rather than staying in a script every visitor downloads. */
(() => {
  const fdcTb = document.querySelector("#fdc-table tbody");
  if (!fdcTb) return;
  const OURS = "0xb5a081dec72c8c87256b7e14cfadcbc342bdeac3";
  function fromCache() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf("mirsflr_cache_") === 0 && k.indexOf("/v2/flare/providers") > 0) {
          return JSON.parse(localStorage.getItem(k)).data;
        }
      }
    } catch (_) {}
    return null;
  }
  function findProv(o) {
    if (!o || typeof o !== "object") return null;
    if (String(o.voterAddress || "").toLowerCase() === OURS) return o;
    for (const k in o) { const r = findProv(o[k]); if (r) return r; }
    return null;
  }
  function render(p) {
    if (!p || !p.epochData) return;
    const eps = p.epochData.slice().sort((a, b) => b.epoch - a.epoch);
    if (fdcTb) {
      const rows = eps.filter((e) => e.fdc && e.fdc.totalRewardedVotingRounds > 0).slice(0, 12);
      let sumR = 0, sumT = 0;
      fdcTb.innerHTML = rows.map((e) => {
        const r = e.fdc.rewardedVotingRounds, tt = e.fdc.totalRewardedVotingRounds, pc = e.fdc.participationPercentage;
        sumR += r; sumT += tt;
        // data-label drives the stacked mobile layout, where thead is hidden.
        return `<tr><td class="addr" data-label="Epoch">E${e.epoch}</td><td class="num" data-label="Rounds">${r.toLocaleString("en-US")}/${tt.toLocaleString("en-US")}</td><td class="num" data-label="Share"${pc >= 99 ? ' style="color:var(--green)"' : pc < 95 ? ' style="color:var(--yellow)"' : ""}>${pc.toFixed(2)}%</td><td><div class="fdc-bar"><i style="width:${pc.toFixed(2)}%"></i></div></td></tr>`;
      }).join("");
      const agg = document.getElementById("fdc-agg");
      if (agg && sumT) agg.textContent = `${((sumR / sumT) * 100).toFixed(2)}% over ${sumT.toLocaleString("en-US")} rewarded voting rounds (last ${rows.length} epochs).`;
    }
  }
  const cached = findProv(fromCache());
  if (cached) { render(cached); return; }
  const tryRender = (attempt) => {
    const p = findProv(fromCache());
    if (p) { render(p); return; }
    // This used to poll localStorage seven times at 2.5s before giving up and
    // pulling the 16MB provider payload itself — seventeen seconds of empty
    // tiles on a good connection, and nothing at all behind a content blocker.
    // The pipeline already mirrors our slice of that payload on this origin.
    fetch("/data/oracle-live.json")
      .then((r) => r.json())
      .then((m) => {
        const prov = findProv(m && (m.providersV2 || m.providersV1));
        if (prov) { render(prov); return; }
        throw new Error("not in mirror");
      })
      .catch(() => {
        if (attempt < 3) { setTimeout(() => tryRender(attempt + 1), 2000); return; }
        fetch("https://api.oracle-daemon.com/v2/flare/providers")
          .then((r) => r.json()).then((d) => render(findProv(d))).catch(() => {});
      });
  };
  tryRender(0);
})();

/* A data source that never answers used to leave the page sitting on
   "Loading…" forever, which reads as a broken site rather than a blocked
   request. In practice the cause is almost always a content blocker or a
   shields setting cutting off the third-party APIs. After a grace period,
   say so plainly and let the rest of the page stand. */
(() => {
  const GRACE_MS = 20000;
  const LOADING = /^\s*(loading|nalag)/i;

  function stillLoading() {
    const nodes = [];
    document.querySelectorAll("td, th, [data-field], [data-render], .skeleton").forEach(el => {
      if (el.querySelector("td, [data-field]")) return;      // containers, not leaves
      if (LOADING.test(el.textContent || "")) nodes.push(el);
    });
    return nodes;
  }

  function banner() {
    if (document.getElementById("data-source-notice")) return;
    const host = document.querySelector("main .inner, main") || document.body;
    const el = document.createElement("div");
    el.id = "data-source-notice";
    el.setAttribute("role", "status");
    el.innerHTML =
      "<strong>Some live data could not be loaded.</strong>" +
      "<span>The public APIs this page reads were not reachable. A content " +
      "blocker, browser shields, or a network filter will usually be the cause — " +
      "allowing this site should restore them. Everything else on the page is still valid.</span>";
    host.insertBefore(el, host.firstChild);
  }

  // Give the slow sources room first, then keep watching: a notice raised
  // while something was still in flight is withdrawn once it lands, so the
  // page never accuses a source that was merely slow.
  function sweep() {
    const stuck = stillLoading();
    const notice = document.getElementById("data-source-notice");
    if (!stuck.length) {
      if (notice) notice.remove();
      return;
    }
    stuck.forEach(el => {
      el.textContent = "Unavailable";
      el.classList.add("data-unavailable");
    });
    banner();
  }

  window.setTimeout(() => {
    sweep();
    window.setTimeout(sweep, 8000);
  }, GRACE_MS);
})();

/* Vote power snapshot timing (FTSO page).
   The block that fixes weight for a reward epoch is picked at an unannounced
   point inside the epoch before it, so there is nothing to predict and plenty
   to show: where each one actually landed. */
(() => {
  const mount = document.querySelector('[data-render="vote-power-snapshots"]');
  if (!mount) return;

  const fmt = iso => {
    const d = new Date(iso);
    return Number.isFinite(d.getTime())
      ? d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : "";
  };

  const num = (v, d = 0) =>
    Number.isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: d }) : "–";

  Promise.all([
    fetch("/data/network-position.json").then(r => r.json()),
    fetch("/data/ftso-delegations.json").then(r => r.json()).catch(() => null),
  ])
    .then(([d, del]) => {
      const rows = (d && d.votePowerSnapshots) || [];
      if (!rows.length) {
        mount.innerHTML = '<p class="vps-empty">Snapshot history is not available right now.</p>';
        return;
      }
      // What the snapshot actually captured, keyed by the epoch it decided.
      const weights = new Map(((d && d.weightHistory) || []).map(w => [w.epoch, w]));
      const counts = new Map((((del || {}).history) || []).map(h => [h.epoch, h]));

      mount.innerHTML = rows.map((s, i) => {
        const pct = Math.max(0, Math.min(100, Number(s.pct) || 0));
        const w = weights.get(s.epoch);
        const c = counts.get(s.epoch);
        const detail = (w || c)
          ? `<dl class="vps-detail">
               <div><dt>Delegated</dt><dd>${w ? num(w.wflrM) + " WFLR" : "–"}</dd></div>
               <div><dt>Stake</dt><dd>${w ? num(w.stakeM) + " FLR" : "–"}</dd></div>
               <div><dt>Delegators</dt><dd>${c ? num(c.delegators) : "–"}</dd></div>
               <div><dt>Taken</dt><dd>${fmt(s.at)}</dd></div>
               <div><dt>Block</dt><dd>${num(s.block)}</dd></div>
             </dl>`
          : `<p class="vps-detail-empty">No captured figures stored for this epoch.</p>`;
        return `<details class="vps-item${i === 0 ? " latest" : ""}">
            <summary class="vps-row">
              <span class="vps-ep">E${s.epoch}</span>
              <span class="vps-track"><i style="left:${pct.toFixed(2)}%"></i></span>
              <span class="vps-pct">${pct.toFixed(0)}%</span>
              <span class="vps-at">${fmt(s.at)}</span>
            </summary>
            ${detail}
          </details>`;
      }).join("") +
      `<p class="vps-foot">Position within epoch <span>E${rows[0].takenDuring}</span> and earlier — left is the start of that epoch, right is its end. Tap a row for what that snapshot captured.</p>`;
    })
    .catch(() => {
      mount.innerHTML = '<p class="vps-empty">Snapshot history could not be loaded.</p>';
    });
})();

/* Weight rank (FTSO page): position among the registered voters by total
   registration weight — stake plus delegations. Named for what it measures
   rather than "network rank", which reads as a standing rather than a metric. */
(() => {
  const el = document.getElementById("ftso-rank");
  if (!el) return;
  fetch("/data/network-position.json")
    .then(r => r.json())
    .then(d => {
      const p = d && d.position;
      const rank = p && Number(p.rank);
      const of = p && Number(p.voters);
      if (!(rank > 0 && of > 0)) { el.textContent = "–"; return; }
      el.textContent = `#${rank}`;
      el.classList.remove("skeleton-value");
      el.removeAttribute("aria-busy");
      if (!el.parentElement.querySelector(".rank-of")) {
        el.insertAdjacentHTML("afterend", `<em class="rank-of">of ${of} by weight</em>`);
      }
    })
    .catch(() => { el.textContent = "–"; });
})();

/* Validator hero: the grid holds four and only three were filled, leaving a
   quarter of it empty. Delegation count is the figure a would-be staker asks
   for next, and the P-chain answers it live. */
(() => {
  const el = document.getElementById("val-delegations");
  if (!el) return;
  const show = v => {
    el.textContent = v;
    el.classList.remove("skeleton-value");
    el.removeAttribute("aria-busy");
  };
  fetch("https://flare-api.flare.network/ext/bc/P", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "platform.getCurrentValidators",
      params: { nodeIDs: ["NodeID-8dNfgpspPNDrZD2ksKCRJoGe4Xqe6qVtz"] },
    }),
  })
    .then(r => r.json())
    .then(j => {
      const v = ((j.result || {}).validators || [])[0];
      const n = v && Number(v.delegatorCount);
      show(Number.isFinite(n) ? n.toLocaleString("en-US") : "–");
    })
    .catch(() => show("–"));
})();

/* Track record.
   The oracle payload carries 97 reward epochs with what each one actually paid
   delegators, how accurate the price submissions were and which protocol
   condition failed when one did. Almost none of it reached a page: the site
   showed a reward figure that was in fact the operator's own fee, and a single
   opaque "performance" percentage that looks poor until you see it against the
   network. This block answers the question a delegator is really asking - has
   this worked, and for how long. */
(() => {
  const card = document.getElementById("track-record");
  if (!card) return;
  const el = (k) => card.querySelector(`[data-tr="${k}"]`);
  const flr = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : Math.round(n).toLocaleString("en-US");

  Promise.all([
    fetch("/data/oracle-live.json?v=tr-1").then((r) => r.json()).catch(() => null),
    fetch("/data/network-position.json?v=tr-1").then((r) => r.json()).catch(() => null)
  ]).then(([oracle, np]) => {
    const p = oracle?.providersV1;
    const eps = Array.isArray(p?.epochData) ? p.epochData : [];
    if (!eps.length) { card.hidden = true; return; }

    const paid = eps.reduce((sum, e) => sum + (Number(e.delegatorsRewardAmount) || 0), 0);
    el("paid").textContent = `${flr(paid)} FLR`;
    el("paidSub").textContent = `Across ${eps.length} reward epochs, to delegators - not the provider's fee.`;

    el("eligible").textContent = `${p.eligibleEpochs} / ${p.totalEpochs}`;

    // Hit percentage is the share of submissions inside the reward band, which
    // is a far more direct quality signal than the blended "performance".
    const hits = eps.slice(-20).map((e) => e.ftsoScaling?.hitPercentage).filter(Number.isFinite);
    if (hits.length) {
      el("accuracy").textContent = `${(hits.reduce((a, b) => a + b, 0) / hits.length).toFixed(2)}%`;
      el("accuracySub").textContent = `Average over the last ${hits.length} epochs, lowest ${Math.min(...hits).toFixed(1)}%.`;
    }

    const struck = eps.filter((e) => Number(e.strikes) > 0);
    const latest = eps[eps.length - 1]?.epoch;
    el("strikes").textContent = `${struck.length} in ${eps.length}`;
    el("strikesSub").textContent = struck.length
      ? `Epoch ${struck[0].epoch}, ${String(struck[0].failures?.[0]?.failureId || "a protocol round").replace(/_/g, " ").toLowerCase()}. ${latest - struck[0].epoch} epochs clean since.`
      : "No protocol strike on record.";

    // The blended performance figure reads badly on its own. Against the
    // network's own medians it reads as what it is.
    const pos = np?.position;
    if (pos && Number.isFinite(pos.primaryPct) && Number.isFinite(pos.medianPrimaryPct)) {
      el("perfNote").innerHTML =
        `Anchor feeds <b>${pos.primaryPct.toFixed(1)}%</b> against a network median of ${pos.medianPrimaryPct.toFixed(1)}%, ` +
        `block-latency feeds <b>${pos.secondaryPct.toFixed(1)}%</b> against ${pos.medianSecondaryPct.toFixed(1)}%.`;
    }
  });
})();
