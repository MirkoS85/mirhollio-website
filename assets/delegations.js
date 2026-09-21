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

  const SNAPSHOT_URL = "/data/ftso-delegations.json?v=core-34";
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
    sort: "amount-desc",
    filter: "all",
    pinned: null,
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
    // Wallets that left are published separately - they are not delegators any
    // more, so they cannot sit in the live list - but the book still has to be
    // able to show them, or "four left this epoch" has no answer to "which four".
    const gone = Array.isArray(state.snapshot?.departed) ? state.snapshot.departed : [];
    return rows.concat(gone)
      .map((r) => ({
        from: r.from,
        amount: num(r.amount) ?? 0,
        previous: num(r.previous),
        share: num(r.share),
        delta: num(r.delta),
        firstSeen: num(r.firstSeen),
        joined: Boolean(r.joined),
        departed: Boolean(r.departed)
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
          // Discovery and the amounts come from different places: the amounts
          // are exact, but a wallet nobody has listed yet is simply absent. The
          // gap between what the rows add up to and the provider's actual vote
          // power is the honest measure of that, so it is shown rather than
          // left for someone to notice.
          indexing: live ? live.historyScanComplete === false : false,
          coverage: Number.isFinite(num(live?.listed)) && num(live?.delegated) > 0
            ? num(live.listed) / num(live.delegated)
            : null
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

  /**
   * The charts come from Flare Base, which only ever publishes finished reward
   * epochs, while the headline is read off the chain right now. With nothing
   * joining them the page showed 95.02M above a chart ending at 133.96M and
   * left the reader to reconcile the two. The live reading is appended as the
   * current epoch's point instead, drawn provisionally, so the chart tells the
   * same story the headline does.
   */
  function appendLivePoint() {
    const live = state.snapshot?.live;
    const delegated = num(live?.delegated);
    const bounds = epochBounds();
    const last = state.history[state.history.length - 1];
    if (!Number.isFinite(delegated) || !bounds || !last) return;
    if (!(bounds.current > last.epoch)) return;
    state.history = state.history.concat({
      epoch: bounds.current,
      delegated,
      delegators: num(live?.delegators),
      provisional: true
    });
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
      const short = Number.isFinite(origin.coverage) && origin.coverage < 0.995;
      const covers = short ? ` · lists ${(origin.coverage * 100).toFixed(1)}% of delegated power` : "";
      const indexing = origin.indexing ? " · still finding older delegators" : "";
      return {
        text: `Read from the Flare chain${block} · ${when}${covers}${indexing}`,
        tone: short || origin.indexing ? "warn" : (tone === "ok" ? "live" : tone)
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

    const point = (r, i) => `${x(i).toFixed(1)},${y(accessor(r)).toFixed(1)}`;
    const line = rows.map((r, i) => `${i === 0 ? "M" : "L"}${point(r, i)}`).join("");
    const area = `${line}L${x(rows.length - 1).toFixed(1)},${H - padB}L${padL},${H - padB}Z`;

    // The last point can be the live reading rather than a settled epoch. It is
    // drawn dashed and hollow so it is not mistaken for a closed measurement.
    const last = rows[rows.length - 1];
    const provisional = Boolean(last?.provisional) && rows.length > 1;
    const settled = provisional
      ? rows.slice(0, -1).map((r, i) => `${i === 0 ? "M" : "L"}${point(r, i)}`).join("")
      : line;
    const pending = provisional
      ? `<path d="M${point(rows[rows.length - 2], rows.length - 2)}L${point(last, rows.length - 1)}"
              fill="none" stroke="${opts.color}" stroke-width="2" stroke-dasharray="5 4"
              stroke-linecap="round" opacity=".85"/>`
      : "";

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
      <path d="${settled}" fill="none" stroke="${opts.color}" stroke-width="2"
            stroke-linejoin="round" stroke-linecap="round"/>
      ${pending}
      <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="4"
              fill="${provisional ? "var(--surface)" : opts.color}"
              stroke="${provisional ? opts.color : "var(--surface)"}" stroke-width="2"/>
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
    // Tapping pins the reading. A tooltip that only exists while the pointer is
    // held over a point is unusable on a touch screen, which is where most of
    // this page is read.
    svg.addEventListener("pointerdown", (event) => {
      move(event);
      pinEpoch(rows[pick(event)]?.epoch);
    });
  }

  // ── a pinned epoch ────────────────────────────────────────────────────────
  function pinEpoch(epoch) {
    state.pinned = Number.isFinite(epoch) && state.pinned === epoch ? null : epoch;
    renderPinned();
  }

  function renderPinned() {
    const box = $(".dx-pinned");
    if (!box) return;
    const row = state.history.find((r) => r.epoch === state.pinned);
    if (!row) { box.hidden = true; return; }

    const index = state.history.indexOf(row);
    const before = index > 0 ? state.history[index - 1] : null;
    const delta = before ? row.delegated - before.delegated : null;
    const moved = Number.isFinite(delta) && Math.abs(delta) >= MOVED;
    const change = moved
      ? `<span class="${delta > 0 ? "dx-up" : "dx-down"}">${delta > 0 ? "▲ +" : "▼ −"}${fmtAmount(Math.abs(delta))}</span>`
      : '<span class="dx-flat">no change</span>';

    box.hidden = false;
    box.innerHTML = `
      <b>Epoch ${row.epoch}${row.provisional ? " (in progress)" : ""}</b>
      <span><strong>${fmtAmount(row.delegated)}</strong> WFLR</span>
      <span>${Number.isFinite(row.delegators) ? `<strong>${fmtFull(row.delegators)}</strong> delegators` : ""}</span>
      <span>${change} vs epoch ${before ? before.epoch : "—"}</span>
      <button type="button" class="dx-unpin" data-dx="unpin">Clear</button>`;
    const clear = el("unpin");
    if (clear) clear.addEventListener("click", () => { state.pinned = null; renderPinned(); });
  }

  function renderCharts() {
    drawChart("power", (r) => r.delegated, {
      color: "#FF2E63",
      tip: (r) => `${fmtFull(r.delegated)} WFLR${r.provisional ? " (now)" : ""}`
    });
    drawChart("count", (r) => r.delegators, {
      color: "#9AA0AF",
      axis: (v) => Math.round(v).toLocaleString("en-US"),
      tip: (r) => `${fmtFull(r.delegators)} delegators${r.provisional ? " (now)" : ""}`
    });

    const rows = visibleHistory();
    const vals = rows.map((r) => r.delegated).filter(Number.isFinite);
    if (vals.length) {
      const live = rows[rows.length - 1]?.provisional;
      el("chartLatest").textContent = `${fmtAmount(vals[vals.length - 1])} WFLR${live ? " · now" : ""}`;
      el("chartPeak").textContent = `${fmtAmount(Math.max(...vals))} WFLR`;
      el("chartLow").textContent = `${fmtAmount(Math.min(...vals))} WFLR`;
    }
  }

  // ── the book ──────────────────────────────────────────────────────────────

  // A wallet counts as having moved only if the move is big enough to be worth
  // a reader's attention; dust from a rounding difference is not news.
  const MOVED = 1;

  const GROUPS = {
    all: () => true,
    joined: (r) => r.joined && !r.departed,
    increased: (r) => Number.isFinite(r.delta) && r.delta >= MOVED && !r.joined,
    decreased: (r) => Number.isFinite(r.delta) && r.delta <= -MOVED && !r.departed,
    departed: (r) => r.departed
  };

  function whaleCut() {
    const live = state.delegators.filter((r) => !r.departed);
    if (!live.length) return Infinity;
    const sorted = live.map((r) => r.amount).sort((a, b) => b - a);
    return sorted[Math.max(0, Math.ceil(sorted.length * 0.01) - 1)];
  }

  function groupCount(key) {
    if (key === "whales") {
      const cut = whaleCut();
      return state.delegators.filter((r) => !r.departed && r.amount >= cut).length;
    }
    return state.delegators.filter(GROUPS[key] || (() => true)).length;
  }

  function filteredDelegators() {
    const term = state.search.trim().toLowerCase();
    let rows = state.delegators;

    if (state.filter === "whales") {
      const cut = whaleCut();
      rows = rows.filter((r) => !r.departed && r.amount >= cut);
    } else if (state.filter !== "all") {
      rows = rows.filter(GROUPS[state.filter] || (() => true));
    } else {
      // Departed wallets are history, not holdings: they belong under their own
      // filter, not mixed into a list the totals are read from.
      rows = rows.filter((r) => !r.departed);
    }

    if (term) rows = rows.filter((r) => r.from.toLowerCase().includes(term));

    const [key, dir] = state.sort.split("-");
    const sign = dir === "asc" ? 1 : -1;
    const value = (r) => {
      if (key === "firstSeen") return Number.isFinite(r.firstSeen) ? r.firstSeen : (dir === "asc" ? Infinity : -Infinity);
      if (key === "delta") return Number.isFinite(r.delta) ? r.delta : 0;
      if (key === "share") return Number.isFinite(r.share) ? r.share : 0;
      return r.departed ? (r.previous || 0) : r.amount;
    };
    return rows.slice().sort((a, b) => (value(a) - value(b)) * sign);
  }

  function rowMarkup(r, index, cut) {
    const tag = r.departed
      ? '<span class="dx-tag gone">left</span>'
      : r.joined
        ? '<span class="dx-tag new">new</span>'
        : (r.amount >= cut ? '<span class="dx-tag whale">top 1%</span>' : "");

    let change = '<span class="dx-change flat">no change</span>';
    if (r.departed) {
      change = `<span class="dx-change down">&#9660; withdrew ${fmtAmount(r.previous || 0)}</span>`;
    } else if (Number.isFinite(r.delta) && Math.abs(r.delta) >= MOVED) {
      const up = r.delta > 0;
      change = `<span class="dx-change ${up ? "up" : "down"}">${up ? "&#9650; +" : "&#9660; &minus;"}${fmtAmount(Math.abs(r.delta))}</span>`;
    } else if (r.joined) {
      change = '<span class="dx-change up">&#9650; joined this epoch</span>';
    }

    const since = Number.isFinite(r.firstSeen)
      ? `since ${new Date(r.firstSeen).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          ...(new Date(r.firstSeen).getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" })
        })}`
      : "not yet dated";

    const shown = r.departed ? (r.previous || 0) : r.amount;
    const pct = Math.min(100, Math.max(0, r.share ?? 0));

    return `
      <li class="dx-row${r.departed ? " is-departed" : ""}">
        <span class="dx-rank">${String(index + 1).padStart(2, "0")}</span>
        <span class="dx-who">
          <a class="dx-wallet" href="${EXPLORER_ADDRESS}${encodeURIComponent(r.from)}" target="_blank" rel="noopener"
             title="${escapeHtml(r.from)}">${escapeHtml(shortAddress(r.from))}</a>${tag}
          <small class="dx-since">${since}</small>
        </span>
        <span class="dx-amount">${fmtAmount(shown)}<u>WFLR</u></span>
        <span class="dx-meter">
          <span class="dx-bar"><i style="width:${pct.toFixed(1)}%"></i></span>
          <span class="dx-pct">${r.departed ? "&mdash;" : fmtPct(r.share)}</span>
        </span>
        ${change}
      </li>`;
  }

  function renderDelegators() {
    const list = el("delegatorRows");
    if (!list) return;
    const rows = filteredDelegators();
    const cut = whaleCut();

    if (!rows.length) {
      list.innerHTML = `<li class="dx-empty">${
        state.search ? "No wallet matches that search."
          : state.filter === "all" ? "No delegator data available."
          : "No wallet is in that group this epoch."
      }</li>`;
      el("delegatorShown").textContent = "0 wallets";
      return;
    }

    // 137 rows rendered flat made the page eight screens long. Show the wallets
    // that carry the weight; the rest stay one tap away.
    const PAGE = 25;
    const capped = state.showAll || state.search ? rows : rows.slice(0, PAGE);
    list.innerHTML = capped.map((r, i) => rowMarkup(r, i, cut)).join("");

    if (!state.showAll && !state.search && rows.length > PAGE) {
      list.insertAdjacentHTML("beforeend", `
        <li class="dx-more-row">
          <button type="button" class="dx-more" data-dx="showAll">Show all ${rows.length} wallets</button>
        </li>`);
      const more = el("showAll");
      if (more) more.addEventListener("click", () => { state.showAll = true; renderDelegators(); });
    }

    const label = state.filter === "all" ? "wallets" : `in "${$(`[data-dx-filter="${state.filter}"]`)?.textContent.trim() || state.filter}"`;
    el("delegatorShown").textContent = capped.length === rows.length
      ? `${rows.length} ${label}`
      : `${capped.length} of ${rows.length} ${label}`;
  }

  function renderChips() {
    $$("[data-dx-filter]").forEach((btn) => {
      const key = btn.dataset.dxFilter;
      btn.setAttribute("aria-pressed", String(key === state.filter));
      if (key !== "all") {
        const n = groupCount(key);
        btn.disabled = n === 0;
        btn.title = `${n} wallet${n === 1 ? "" : "s"}`;
      }
    });
    $$("[data-dx-flow]").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.dxFlow === state.filter));
    });
  }

  function renderConcentration() {
    const bar = $(".dx-conc-bar");
    const live = state.delegators.filter((r) => !r.departed);
    if (!bar || !live.length) return;
    const total = live.reduce((sum, r) => sum + r.amount, 0);
    if (!total) return;

    const top = live.slice().sort((a, b) => b.amount - a.amount).slice(0, 5);
    const segs = top.map((r) => ({ pct: (r.amount / total) * 100 }));
    const rest = Math.max(0, 100 - segs.reduce((s, x) => s + x.pct, 0));
    bar.innerHTML = segs.map((s, i) => `<i class="w${i}" style="width:${s.pct.toFixed(2)}%"></i>`).join("")
      + (rest > 0.2 ? `<i class="rest" style="width:${rest.toFixed(2)}%"></i>` : "");

    const top5 = segs.reduce((s, x) => s + x.pct, 0);
    el("whaleShare").textContent = fmtPct(segs[0]?.pct);
    el("top5Share").textContent = fmtPct(top5);
    el("tailCount").textContent = Math.max(0, live.length - 5).toLocaleString("en-US");
    bar.setAttribute("aria-label",
      `Top wallet ${fmtPct(segs[0]?.pct)}, top five ${fmtPct(top5)} of delegated power`);
  }

  // ── headline, epoch and flow ────────────────────────────────────────────────
  function renderHeadline() {
    const latest = state.history.length ? state.history[state.history.length - 1] : null;
    const live = state.snapshot?.live;
    // Three answers to "how much is delegated", in descending order of how
    // directly they were measured: WNat's own vote power right now, the signing
    // policy weight for the current epoch, and the tail of the history series.
    let delegated = num(live?.delegated);
    let origin = Number.isFinite(delegated)
      ? { kind: "chain", at: Date.parse(state.snapshot?.generatedAt) || null, block: num(live?.blockNumber) }
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

    el("delegatedWflr").textContent = `${fmtAmount(delegated, 2)}`;
    el("delegatedWflr").title = `${fmtFull(delegated)} WFLR`;

    const net = num(live?.flow?.netChange);
    const netEl = el("delegatedDelta");
    if (netEl) {
      if (Number.isFinite(net) && Math.abs(net) >= MOVED) {
        const up = net > 0;
        netEl.className = up ? "dx-up" : "dx-down";
        netEl.textContent = `${up ? "▲ +" : "▼ −"}${fmtAmount(Math.abs(net))} WFLR`;
      } else {
        netEl.className = "dx-flat";
        netEl.textContent = "No net change";
      }
    }

    const count = state.delegators.filter((r) => !r.departed).length || latest?.delegators;
    el("delegatorCount").textContent = Number.isFinite(count) ? fmtFull(count) : "-";

    const summary = el("flowSummary");
    if (summary) {
      const joined = state.delegators.filter(GROUPS.joined).length;
      const left = state.delegators.filter(GROUPS.departed).length;
      summary.textContent = joined || left
        ? `${joined} joined, ${left} left this epoch`
        : "Unchanged this epoch";
    }

    const bips = state.weights?.feeBips;
    el("fee").textContent = Number.isFinite(bips) ? `${(bips / 100).toFixed(0)}%` : "-";

    const bounds = epochBounds();
    el("epoch").textContent = bounds ? bounds.current : "-";
    if (bounds) el("epochRemaining").textContent = `${fmtRemaining(bounds.remaining)} until the snapshot`;

    paintFreshness("power", origin);
  }

  function renderFlow() {
    const flow = state.snapshot?.live?.flow;
    const rows = state.delegators;
    const sum = (predicate, pick) => rows.filter(predicate).reduce((s, r) => s + Math.abs(pick(r) || 0), 0);

    const parts = [
      ["flowJoined", "flowJoinedAmt", "joined", GROUPS.joined, (r) => r.amount],
      ["flowUp", "flowUpAmt", "increased", GROUPS.increased, (r) => r.delta],
      ["flowDown", "flowDownAmt", "decreased", GROUPS.decreased, (r) => r.delta],
      ["flowLeft", "flowLeftAmt", "departed", GROUPS.departed, (r) => r.previous]
    ];
    parts.forEach(([countKey, amountKey, group, predicate, pick]) => {
      const n = rows.filter(predicate).length;
      const node = el(countKey);
      if (node) node.textContent = Number.isFinite(n) ? String(n) : "-";
      const amount = el(amountKey);
      if (amount) amount.textContent = n ? `${fmtAmount(sum(predicate, pick))} WFLR` : "—";
      const stat = $(`[data-dx-flow="${group}"]`);
      if (stat) stat.dataset.dxEmpty = String(n === 0);
    });

    const net = num(flow?.netChange);
    const netEl = el("flowNet");
    if (netEl) {
      const moved = Number.isFinite(net) && Math.abs(net) >= MOVED;
      netEl.className = moved ? (net > 0 ? "dx-up" : "dx-down") : "dx-flat";
      netEl.textContent = moved
        ? `${net > 0 ? "+" : "−"}${fmtAmount(Math.abs(net))} WFLR`
        : "unchanged";
    }
    const since = el("flowSince");
    if (since) {
      const at = num(flow?.baselineAt);
      since.textContent = Number.isFinite(at)
        ? `, ${fmtAge(Date.now() - at)}`
        : "";
    }
  }

  function renderSnapshot() {
    const bounds = epochBounds();
    const card = $(".dx-countdown");
    if (!bounds || !card) return;
    el("snapshotCountdown").textContent = fmtRemaining(bounds.remaining);
    el("snapshotWhen").textContent = new Date(bounds.end * 1000)
      .toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    el("nextEpoch").textContent = bounds.current + 1;
    el("epochInline").textContent = bounds.current;
    el("epochProgressPct").textContent = `${(bounds.progress * 100).toFixed(0)}%`;
    const bar = $('[data-dx-bar="epochProgress"]');
    if (bar) bar.style.width = `${(bounds.progress * 100).toFixed(1)}%`;
    card.dataset.dxState = bounds.remaining < 6 * 3600 ? "soon" : "ok";
    if (el("epochRemaining")) el("epochRemaining").textContent = `${fmtRemaining(bounds.remaining)} until the snapshot`;
  }

  // ── wiring ────────────────────────────────────────────────────────────────
  function setFilter(key) {
    state.filter = state.filter === key && key !== "all" ? "all" : key;
    state.showAll = false;
    renderChips();
    renderDelegators();
  }

  function bindControls() {
    // The chart range uses the site's own toggle, so it carries the site's
    // active state rather than a second convention for the same thing.
    $$("[data-dx-range]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.range = Number(btn.dataset.dxRange) || 0;
        $$("[data-dx-range]").forEach((b) => b.classList.toggle("active", b === btn));
        renderCharts();
      });
    });

    $$("[data-dx-filter]").forEach((btn) => {
      btn.addEventListener("click", () => setFilter(btn.dataset.dxFilter));
    });
    $$("[data-dx-flow]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setFilter(btn.dataset.dxFlow);
        document.querySelector(".dx-book")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });

    const sort = el("sort");
    if (sort) {
      sort.addEventListener("change", () => {
        state.sort = sort.value;
        state.showAll = false;
        renderDelegators();
      });
    }

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
    renderFlow();
    renderCharts();
    renderPinned();
    renderConcentration();
    renderChips();
    renderDelegators();
    paintFreshness("history", state.historyOrigin);
    paintFreshness("delegators", state.delegatorsOrigin);
  }

  async function load() {
    await loadSnapshot();
    await loadHistory();
    await loadDelegators();
    appendLivePoint();
    renderAll();
  }

  bindControls();
  load();
  setInterval(load, AUTO_REFRESH_MS);
  setInterval(renderSnapshot, 30000);
})();
