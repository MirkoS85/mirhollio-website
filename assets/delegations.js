/* Delegation explorer.
 *
 * Numbers arrive from three places that age very differently, so every block on
 * the page says which one it is showing rather than presenting all of them as
 * "live":
 *
 *   - /data/ftso-delegations.json, republished every 15 minutes. When its
 *     source.delegators is "flare-chain" the delegator book in it was read
 *     straight off WNat by the pipeline, which makes it both the freshest and
 *     the most trustworthy option - so it is preferred, not a fallback.
 *   - flare-base.io, fetched from the browser. Still the only source with
 *     per-reward-epoch history, so it is tried first for the charts. It has
 *     been returning 502 to our CI runners since mid-September; a browser on a
 *     home connection is a different client and often gets through where the
 *     runner does not.
 *   - the published snapshot's own history array, when flare-base is down
 *     everywhere.
 *
 * Every block carries the age and origin of what it is showing. A number with no
 * provenance is what made the rest of this site untrustworthy.
 */
(function () {
  "use strict";

  const SNAPSHOT_URL = "/data/ftso-delegations.json?v=core-33";
  const FB_HISTORY = "https://flare-base.io/api/votepower/getDelegatedVotePowerHistory/flare";
  const FB_DELEGATORS = "https://flare-base.io/api/delegations/getDelegatorsAt/flare";
  const DELEGATION_ADDRESS = "0xad9105bef5e5df2eacbe2de9037a96695b00cade";
  const EXPLORER_ADDRESS = "https://flare-explorer.flare.network/address/";

  // Reward epochs run on a fixed cadence from a known anchor, so the current one
  // and the next snapshot are derived exactly rather than read from a feed that
  // only ever publishes completed epochs.
  const EPOCH_ANCHOR = 428;
  const EPOCH_ANCHOR_TIME = 1787857200;
  const EPOCH_LENGTH_SECONDS = 302400;

  const LIVE_TIMEOUT_MS = 12000;
  const AUTO_REFRESH_MS = 60000;

  const state = {
    history: [],
    historyOrigin: null,
    delegators: [],
    delegatorsOrigin: null,
    snapshot: null,
    weights: null,
    range: 0,
    sort: "amount",
    search: "",
    showAll: false
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const el = (dx) => $(`[data-dx="${dx}"]`);

  // ── formatting ────────────────────────────────────────────────────────────
  function fmtAmount(value, decimals = 2) {
    if (!Number.isFinite(value)) return "—";
    const abs = Math.abs(value);
    if (abs >= 1e9) return `${(value / 1e9).toFixed(decimals)}B`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(decimals)}M`;
    if (abs >= 1e3) return `${(value / 1e3).toFixed(decimals)}K`;
    return value.toFixed(0);
  }

  function fmtFull(value) {
    if (!Number.isFinite(value)) return "—";
    return Math.round(value).toLocaleString("en-US");
  }

  function fmtPct(value, decimals = 1) {
    if (!Number.isFinite(value)) return "—";
    return `${value.toFixed(decimals)}%`;
  }

  function fmtAge(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "just now";
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${Math.max(1, s)}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 172800) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  function shortAddress(addr) {
    const a = String(addr || "");
    return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  // ── epoch maths ───────────────────────────────────────────────────────────
  function epochNow() {
    const elapsed = Math.floor(Date.now() / 1000) - EPOCH_ANCHOR_TIME;
    if (!Number.isFinite(elapsed) || elapsed < 0) return null;
    return EPOCH_ANCHOR + Math.floor(elapsed / EPOCH_LENGTH_SECONDS);
  }

  function epochBounds() {
    const current = epochNow();
    if (current == null) return null;
    const start = EPOCH_ANCHOR_TIME + (current - EPOCH_ANCHOR) * EPOCH_LENGTH_SECONDS;
    const end = start + EPOCH_LENGTH_SECONDS;
    const now = Math.floor(Date.now() / 1000);
    return {
      current,
      start,
      end,
      remaining: end - now,
      progress: Math.min(1, Math.max(0, (now - start) / EPOCH_LENGTH_SECONDS))
    };
  }

  function fmtRemaining(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "now";
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  // ── fetching ──────────────────────────────────────────────────────────────
  async function fetchWithTimeout(url, asText) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return asText ? res.text() : res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // flare-base answers with semicolon-delimited rows, not JSON.
  function parseRows(text) {
    const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = lines.shift().split(";");
    return lines.map((line) => {
      const values = line.split(";");
      return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
    });
  }

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  async function loadSnapshot() {
    try {
      const data = await fetchWithTimeout(`${SNAPSHOT_URL}&t=${Math.floor(Date.now() / 60000)}`, false);
      state.snapshot = data;
      state.weights = data?.weights || null;
      return data;
    } catch (_) {
      return null;
    }
  }

  async function loadHistory() {
    try {
      const text = await fetchWithTimeout(
        `${FB_HISTORY}?${new URLSearchParams({ address: DELEGATION_ADDRESS })}`, true);
      const rows = parseRows(text)
        .map((r) => ({
          epoch: num(r.rewardEpochId ?? r.epoch),
          delegated: num(r.amount ?? r.delegated ?? r.votePower),
          delegators: num(r.count ?? r.delegators)
        }))
        .filter((r) => Number.isFinite(r.epoch) && Number.isFinite(r.delegated))
        .sort((a, b) => a.epoch - b.epoch);
      if (!rows.length) throw new Error("empty");
      state.history = rows;
      state.historyOrigin = { kind: "flare-base", at: Date.now() };
      return;
    } catch (_) {
      // Fall back to the committed snapshot and say so.
    }
    const rows = Array.isArray(state.snapshot?.history) ? state.snapshot.history : [];
    state.history = rows
      .map((r) => ({ epoch: num(r.epoch), delegated: num(r.delegated), delegators: num(r.delegators) }))
      .filter((r) => Number.isFinite(r.epoch) && Number.isFinite(r.delegated))
      .sort((a, b) => a.epoch - b.epoch);
    state.historyOrigin = {
      kind: "snapshot",
      label: "Flare Base unreachable — showing published snapshot",
      at: Date.parse(state.snapshot?.generatedAt) || null
    };
  }

  function snapshotDelegatorRows() {
    const rows = Array.isArray(state.snapshot?.delegators) ? state.snapshot.delegators : [];
    return rows
      .map((r) => ({
        from: r.from,
        amount: num(r.amount),
        share: num(r.share),
        delta: num(r.delta),
        firstSeen: num(r.firstSeen)
      }))
      .filter((r) => r.from && Number.isFinite(r.amount));
  }

  async function loadDelegators() {
    // The pipeline reads WNat directly. When that worked, it beats anything the
    // browser can fetch: it is chain state rather than an indexer's view of it,
    // and it is at most one refresh old.
    const live = state.snapshot?.live;
    if (state.snapshot?.source?.delegators === "flare-chain") {
      const rows = snapshotDelegatorRows();
      if (rows.length) {
        state.delegators = rows;
        state.delegatorsOrigin = {
          kind: "chain",
          at: Date.parse(state.snapshot?.generatedAt) || null,
          block: num(live?.blockNumber),
          // The event scan that finds delegators walks back through Flare's
          // whole history and takes a few hours on first run. Until it is done
          // the book can be missing a wallet that has not moved in years.
          indexing: live ? live.historyScanComplete === false : false
        };
        return;
      }
    }

    const epoch = state.history.length
      ? state.history[state.history.length - 1].epoch
      : epochNow();
    try {
      const text = await fetchWithTimeout(`${FB_DELEGATORS}?${new URLSearchParams({
        address: DELEGATION_ADDRESS,
        epochId: epoch,
        page: 1,
        pageSize: 500,
        sortField: "amount",
        sortOrder: "desc"
      })}`, true);
      const rows = parseRows(text)
        .map((r) => ({
          from: r.from || r.address || r.delegator,
          amount: num(r.amount),
          firstSeen: num(r.timestamp) || null,
          delta: null
        }))
        .filter((r) => r.from && Number.isFinite(r.amount));
      if (!rows.length) throw new Error("empty");
      const total = rows.reduce((sum, r) => sum + r.amount, 0);
      rows.forEach((r) => { r.share = total > 0 ? (r.amount / total) * 100 : null; });
      state.delegators = rows;
      state.delegatorsOrigin = { kind: "flare-base", at: Date.now(), epoch };
      return;
    } catch (_) {
      // Fall back to the committed snapshot and say so.
    }

    state.delegators = snapshotDelegatorRows();
    state.delegatorsOrigin = {
      kind: "snapshot",
      label: "Live sources unreachable — showing published snapshot",
      at: Date.parse(state.snapshot?.generatedAt) || null,
      epoch: state.snapshot?.insights?.latestEpoch ?? null
    };
  }

  // ── freshness labels ──────────────────────────────────────────────────────
  function describeOrigin(origin) {
    if (!origin) return { text: "Source unavailable", tone: "down" };
    const age = origin.at ? Date.now() - origin.at : null;
    const when = age == null ? "age unknown" : fmtAge(age);
    // Anything under a refresh interval is current; past that, say so loudly
    // rather than letting a frozen pipeline look healthy.
    const tone = age == null ? "down" : age > 6 * 3600e3 ? "down" : age > 45 * 60e3 ? "warn" : "ok";

    if (origin.kind === "chain") {
      const block = Number.isFinite(origin.block) ? ` · block ${fmtFull(origin.block)}` : "";
      const indexing = origin.indexing ? " · still indexing older delegators" : "";
      return {
        text: `Read from the Flare chain${block} · ${when}${indexing}`,
        tone: tone === "ok" ? "live" : tone
      };
    }
    if (origin.kind === "flare-base") {
      return { text: `Live from Flare Base · ${when}`, tone: "live" };
    }
    return { text: `${origin.label || "Published snapshot"} · ${when}`, tone };
  }

  function paintFreshness(key, origin) {
    const node = $(`[data-dx-freshness="${key}"]`);
    if (!node) return;
    const d = describeOrigin(origin);
    node.textContent = d.text;
    node.dataset.tone = d.tone;
  }

  // ── charts ────────────────────────────────────────────────────────────────
  // Two separate single-series charts rather than one dual-axis chart: WFLR and
  // a wallet count differ by six orders of magnitude, and a second y-scale is
  // the fastest way to make a chart lie.
  function visibleHistory() {
    if (!state.range || state.range >= state.history.length) return state.history;
    return state.history.slice(-state.range);
  }

  function drawChart(key, accessor, opts) {
    const svg = $(`[data-dx-chart="${key}"]`);
    if (!svg) return;
    const rows = visibleHistory().filter((r) => Number.isFinite(accessor(r)));
    const W = key === "power" ? 1000 : 1000;
    const H = key === "power" ? 300 : 150;
    // padR clears the y-axis labels so the latest point is never jammed
    // under them; padB clears the epoch row.
    const padL = 8, padR = 56, padT = 16, padB = 22;

    if (rows.length < 2) {
      svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" class="dx-chart-empty" text-anchor="middle">No history available</text>`;
      return;
    }

    const values = rows.map(accessor);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || max || 1;
    const lo = Math.max(0, min - span * 0.12);
    const hi = max + span * 0.12;
    const x = (i) => padL + (i * (W - padL - padR)) / (rows.length - 1);
    const y = (v) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);

    const line = rows.map((r, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(accessor(r)).toFixed(1)}`).join("");
    const area = `${line}L${x(rows.length - 1).toFixed(1)},${H - padB}L${padL},${H - padB}Z`;

    // Direct-label the most recent point only; a number on every point is noise.
    const lastX = x(rows.length - 1);
    const lastY = y(accessor(rows[rows.length - 1]));

    svg.innerHTML = `
      <defs>
        <linearGradient id="dxfill-${key}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${opts.color}" stop-opacity=".30"/>
          <stop offset="100%" stop-color="${opts.color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#dxfill-${key})"/>
      <path d="${line}" fill="none" stroke="${opts.color}" stroke-width="2"
            stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="4"
              fill="${opts.color}" stroke="var(--surface)" stroke-width="2"/>
      <line class="dx-crosshair" data-dx-crosshair="${key}" x1="0" y1="${padT}" x2="0" y2="${H - padB}" opacity="0"/>
    `;

    svg.dataset.rows = String(rows.length);
    drawAxes(svg, rows, { lo, hi, fmt: opts.axis || fmtAmount });
    bindHover(svg, key, rows, accessor, x, y, opts);
  }

  // Recessive gridlines plus value labels. Without them the plot is a shape
  // with no magnitude - pretty, and unreadable.
  function drawAxes(svg, rows, { lo, hi, fmt }) {
    const wrap = svg.closest(".dx-chart-wrap");
    if (!wrap) return;
    wrap.querySelectorAll(".dx-axis").forEach((n) => n.remove());

    const steps = [hi, lo + (hi - lo) / 2, lo];
    const yAxis = document.createElement("div");
    yAxis.className = "dx-axis dx-axis-y";
    yAxis.innerHTML = steps.map((v) => `<span>${fmt(v)}</span>`).join("");

    const xAxis = document.createElement("div");
    xAxis.className = "dx-axis dx-axis-x";
    const mid = rows[Math.floor((rows.length - 1) / 2)];
    xAxis.innerHTML = `
      <span>E${rows[0].epoch}</span>
      <span>E${mid.epoch}</span>
      <span>E${rows[rows.length - 1].epoch}</span>`;

    wrap.appendChild(yAxis);
    wrap.appendChild(xAxis);
  }

  function bindHover(svg, key, rows, accessor, x, y, opts) {
    const tip = $(`[data-dx-tooltip="${key}"]`);
    const cross = svg.querySelector(`[data-dx-crosshair="${key}"]`);
    if (!tip || !cross) return;

    function pick(event) {
      const box = svg.getBoundingClientRect();
      const ratio = (event.clientX - box.left) / box.width;
      const i = Math.round(ratio * (rows.length - 1));
      return Math.min(rows.length - 1, Math.max(0, i));
    }

    function move(event) {
      const i = pick(event);
      const row = rows[i];
      const px = x(i);
      cross.setAttribute("x1", px);
      cross.setAttribute("x2", px);
      cross.setAttribute("opacity", "1");
      tip.hidden = false;
      tip.innerHTML = `<b>Epoch ${row.epoch}</b><span>${opts.tip(row)}</span>`;
      const box = svg.getBoundingClientRect();
      const left = (px / 1000) * box.width;
      tip.style.left = `${Math.min(Math.max(left, 60), box.width - 60)}px`;
    }

    function leave() {
      cross.setAttribute("opacity", "0");
      tip.hidden = true;
    }

    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerleave", leave);
    svg.addEventListener("pointerdown", move);
  }

  function renderCharts() {
    drawChart("power", (r) => r.delegated, {
      color: "#FF2E63",
      tip: (r) => `${fmtFull(r.delegated)} WFLR`
    });
    drawChart("count", (r) => r.delegators, {
      color: "#9AA0AF",
      axis: (v) => Math.round(v).toLocaleString("en-US"),
      tip: (r) => `${fmtFull(r.delegators)} delegators`
    });

    const rows = visibleHistory();
    const vals = rows.map((r) => r.delegated).filter(Number.isFinite);
    if (vals.length) {
      el("chartLatest").textContent = `${fmtAmount(vals[vals.length - 1])} WFLR`;
      el("chartPeak").textContent = `${fmtAmount(Math.max(...vals))} WFLR`;
      el("chartLow").textContent = `${fmtAmount(Math.min(...vals))} WFLR`;
    }
  }

  // ── delegator book ────────────────────────────────────────────────────────
  function sortedDelegators() {
    const q = state.search.trim().toLowerCase();
    let rows = state.delegators.slice();
    if (q) rows = rows.filter((r) => String(r.from).toLowerCase().includes(q));
    const key = state.sort;
    rows.sort((a, b) => {
      if (key === "delta") return (b.delta ?? -Infinity) - (a.delta ?? -Infinity);
      if (key === "firstSeen") return (b.firstSeen ?? 0) - (a.firstSeen ?? 0);
      return (b.amount ?? 0) - (a.amount ?? 0);
    });
    return rows;
  }

  function renderDelegators() {
    const body = el("delegatorRows");
    if (!body) return;
    const rows = sortedDelegators();

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="6" class="dx-empty">${
        state.search ? "No wallet matches that filter." : "No delegator data available."
      }</td></tr>`;
      el("delegatorShown").textContent = "0 wallets";
      return;
    }

    // 168 rows rendered flat made the table 81% of the page. Show the wallets
    // that actually carry the weight; the rest stay one click away.
    const PAGE = 25;
    const capped = state.showAll || state.search ? rows : rows.slice(0, PAGE);

    body.innerHTML = capped.map((r, i) => {
      // Change is status-coloured but never colour alone - the sign carries it.
      let change = '<span class="dx-flat">—</span>';
      if (Number.isFinite(r.delta) && Math.abs(r.delta) >= 1) {
        const up = r.delta > 0;
        change = `<span class="dx-delta ${up ? "up" : "down"}">${up ? "▲ +" : "▼ −"}${fmtAmount(Math.abs(r.delta))}</span>`;
      }
      const seen = Number.isFinite(r.firstSeen)
        ? new Date(r.firstSeen).toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : "—";
      return `
        <tr>
          <td class="dx-rank">${i + 1}</td>
          <td><a class="dx-wallet" href="${EXPLORER_ADDRESS}${encodeURIComponent(r.from)}" target="_blank" rel="noopener" title="${escapeHtml(r.from)}">${escapeHtml(shortAddress(r.from))}</a></td>
          <td class="dx-num"><strong>${fmtAmount(r.amount)}</strong></td>
          <td class="dx-num">
            <span class="dx-share"><i style="width:${Math.min(100, Math.max(0, r.share ?? 0)).toFixed(1)}%"></i></span>
            ${fmtPct(r.share)}
          </td>
          <td class="dx-num">${change}</td>
          <td class="dx-num dx-dim">${seen}</td>
        </tr>`;
    }).join("");

    if (!state.showAll && !state.search && rows.length > PAGE) {
      body.insertAdjacentHTML("beforeend", `
        <tr class="dx-more-row">
          <td colspan="6">
            <button type="button" class="dx-more" data-dx="showAll">
              Show all ${rows.length} wallets
            </button>
          </td>
        </tr>`);
      const more = el("showAll");
      if (more) more.addEventListener("click", () => { state.showAll = true; renderDelegators(); });
    }

    const total = state.delegators.length;
    const shown = capped.length;
    el("delegatorShown").textContent = shown === total
      ? `${total} wallets`
      : `${shown} of ${total} wallets`;
  }

  function renderConcentration() {
    const rows = state.delegators.slice().sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
    const bar = $(".dx-conc-bar");
    if (!bar) return;
    const total = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
    if (!total) { bar.innerHTML = ""; return; }

    const top = rows.slice(0, 5);
    const rest = total - top.reduce((s, r) => s + r.amount, 0);
    const segs = top.map((r, i) => ({ pct: (r.amount / total) * 100, i }));
    if (rest > 0) segs.push({ pct: (rest / total) * 100, i: -1 });

    // A 2px surface gap between adjacent fills keeps the segments legible.
    bar.innerHTML = segs.map((s) => `<i class="${s.i === -1 ? "rest" : `w${s.i}`}" style="width:${s.pct.toFixed(2)}%"></i>`).join("");

    el("whaleShare").textContent = fmtPct(segs[0]?.pct);
    el("top5Share").textContent = fmtPct(top.reduce((s, r) => s + (r.amount / total) * 100, 0));
    bar.setAttribute("aria-label",
      `Top wallet ${fmtPct(segs[0]?.pct)}, top five ${fmtPct(top.reduce((s, r) => s + (r.amount / total) * 100, 0))} of delegated power`);
  }

  // ── headline + snapshot ───────────────────────────────────────────────────
  function renderHeadline() {
    const latest = state.history.length ? state.history[state.history.length - 1] : null;
    const live = state.snapshot?.live;
    // Three answers to "how much is delegated", in descending order of how
    // directly they were measured: WNat's own vote power right now, the signing
    // policy weight for the current epoch, and the tail of the history series.
    let delegated = num(live?.delegated);
    let origin = Number.isFinite(delegated)
      ? {
          kind: "chain",
          at: Date.parse(state.snapshot?.generatedAt) || null,
          block: num(live?.blockNumber)
        }
      : null;

    if (!Number.isFinite(delegated) && Number.isFinite(state.weights?.delegatedWeight)) {
      delegated = state.weights.delegatedWeight;
      origin = {
        kind: "snapshot",
        label: "Signing policy weight via Flare Systems Explorer",
        at: Date.parse(state.snapshot?.generatedAt) || null
      };
    }
    if (!Number.isFinite(delegated)) {
      delegated = latest?.delegated;
      origin = state.historyOrigin;
    }

    el("delegatedWflr").textContent = fmtAmount(delegated, 2);
    el("delegatedWflr").title = `${fmtFull(delegated)} WFLR`;

    const count = state.delegators.length || latest?.delegators;
    el("delegatorCount").textContent = Number.isFinite(count) ? fmtFull(count) : "—";

    const bips = state.weights?.feeBips;
    el("fee").textContent = Number.isFinite(bips) ? `${(bips / 100).toFixed(0)}%` : "—";

    const bounds = epochBounds();
    el("epoch").textContent = bounds ? bounds.current : "—";

    paintFreshness("power", origin);
  }

  function renderSnapshot() {
    const bounds = epochBounds();
    const card = $(".dx-snapshot");
    if (!bounds || !card) return;
    el("snapshotCountdown").textContent = fmtRemaining(bounds.remaining);
    el("snapshotWhen").textContent = new Date(bounds.end * 1000)
      .toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    el("nextEpoch").textContent = bounds.current + 1;
    const bar = $('[data-dx-bar="epochProgress"]');
    if (bar) bar.style.width = `${(bounds.progress * 100).toFixed(1)}%`;
    card.dataset.dxState = bounds.remaining < 6 * 3600 ? "soon" : "ok";
  }

  // ── wiring ────────────────────────────────────────────────────────────────
  function bindControls() {
    $$("[data-dx-range]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.range = Number(btn.dataset.dxRange) || 0;
        $$("[data-dx-range]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
        renderCharts();
      });
    });
    $$("[data-dx-sort]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.sort = btn.dataset.dxSort;
        $$("[data-dx-sort]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
        renderDelegators();
      });
    });
    const search = el("search");
    if (search) {
      search.addEventListener("input", () => {
        state.search = search.value;
        renderDelegators();
      });
    }
  }

  function renderAll() {
    renderHeadline();
    renderSnapshot();
    renderCharts();
    renderConcentration();
    renderDelegators();
    paintFreshness("history", state.historyOrigin);
    paintFreshness("delegators", state.delegatorsOrigin);
  }

  async function load() {
    await loadSnapshot();
    await loadHistory();
    await loadDelegators();
    renderAll();
  }

  bindControls();
  load();
  setInterval(load, AUTO_REFRESH_MS);
  setInterval(renderSnapshot, 30000);
})();
