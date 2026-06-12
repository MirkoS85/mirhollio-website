(function () {
  "use strict";

  const ENDPOINTS = {
    providersV2: "https://api.oracle-daemon.com/v2/flare/providers",
    providersV1: "https://api.oracle-daemon.com/v1/flare/providers",
    validators: "https://api.oracle-daemon.com/v1/flare/validators",
    explorerEntity: "https://flare-systems-explorer.flare.network/backend-url/api/v0/entity/0xb5A081dEc72c8C87256b7e14cFAdcbc342bDeac3",
    nodeHealth: "https://node.mirhollio.com/flare/ext/health"
  };

  const TARGET = {
    name: "mirsflr",
    voter: "0xb5a081dec72c8c87256b7e14cfadcbc342bdeac3",
    delegation: "0xad9105bef5e5df2eacbe2de9037a96695b00cade",
    nodeId: "NodeID-8dNfgpspPNDrZD2ksKCRJoGe4Xqe6qVtz"
  };

  const SOURCE_TIMEOUT = 14_000;
  const AUTO_REFRESH_MS = 60_000;
  const state = {
    lastLoadedAt: null,
    refreshTimer: null,
    sources: {
      provider: "loading",
      validator: "loading",
      explorer: "loading",
      node: "loading"
    },
    data: {}
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function setText(field, value) {
    $$(`[data-field="${field}"]`).forEach(el => {
      el.textContent = value == null || value === "" ? "-" : String(value);
    });
  }

  function setSource(name, status) {
    state.sources[name] = status;
    const sourceName = name === "provider" || name === "validator" ? "oracle" : name;
    const card = $(`[data-source="${sourceName}"]`);
    if (!card) return;
    if (sourceName === "oracle") {
      const oracleStatuses = [state.sources.provider, state.sources.validator];
      card.dataset.status = oracleStatuses.includes("down")
        ? "down"
        : oracleStatuses.every(value => value === "ok")
          ? "ok"
          : "loading";
      return;
    }
    card.dataset.status = status;
  }

  function setStatusCard(card, status, title, meta) {
    const el = $(`[data-card="${card}"]`);
    if (el) el.dataset.status = status;
    $$(`[data-dot="${card}"]`).forEach(dot => {
      dot.dataset.status = status;
    });
    setText(card, title);
    setText(`${card}Meta`, meta);
  }

  function setBar(name, value) {
    const n = Number(value);
    const pct = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
    $$(`[data-bar="${name}"]`).forEach(el => {
      el.style.width = `${pct}%`;
    });
  }

  function setStakeAngle(value) {
    const n = Number(value);
    const pct = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
    $$(".stake-ring").forEach(el => {
      el.style.setProperty("--stake-angle", `${pct}%`);
    });
  }

  function fmtNum(value, decimals = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
  }

  function fmtPct(value, decimals = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    const pct = n <= 1 ? n * 100 : n;
    if (Math.abs(pct - 100) < 0.005) return "100%";
    return `${pct.toFixed(decimals)}%`;
  }

  function pctNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return n <= 1 ? n * 100 : n;
  }

  function fmtCompact(value, suffix = "") {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B${suffix}`;
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M${suffix}`;
    if (abs >= 1_000) return `${(n / 1_000).toFixed(2)}K${suffix}`;
    return `${fmtNum(n, 0)}${suffix}`;
  }

  function fmtAxis(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${fmtNum(n / 1_000_000, 1)}m`;
    if (abs >= 1_000) return `${fmtNum(n / 1_000, 0)}k`;
    return fmtNum(n, 0);
  }

  function niceCeil(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 1;
    const power = 10 ** Math.floor(Math.log10(n));
    const scaled = n / power;
    const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    const step = steps.find(item => scaled <= item) || 10;
    return step * power;
  }

  function fmtFullFlr(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} FLR`;
  }

  function fmtWeight(value) {
    if (value == null || value === "") return "-";
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    const normalized = Math.abs(n) > 1_000_000_000_000 ? n / 1e18 : n;
    return fmtCompact(normalized, " FLR");
  }

  function fmtAge(date) {
    if (!date) return "-";
    const ms = Date.now() - date.getTime();
    if (!Number.isFinite(ms) || ms < 0) return "now";
    if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
    return `${Math.round(ms / 3_600_000)}h`;
  }

  function parseDurationSeconds(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    const ms = trimmed.match(/^(\d+(?:\.\d+)?)ms$/);
    if (ms) return Number(ms[1]) / 1000;
    const hms = trimmed.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
    if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
    const unit = trimmed.match(/^(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)$/);
    if (unit) {
      const amount = Number(unit[1]);
      const scale = { ns: 1e-9, us: 1e-6, "µs": 1e-6, ms: 1e-3, s: 1, m: 60, h: 3600 }[unit[2]];
      return amount * scale;
    }
    const parts = trimmed.match(/(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?/);
    if (!parts || !parts[0]) return null;
    return Number(parts[1] || 0) * 3600 + Number(parts[2] || 0) * 60 + Number(parts[3] || 0);
  }

  function normalizeAddress(value) {
    return String(value || "").toLowerCase();
  }

  function isMirProvider(node) {
    if (!node || typeof node !== "object") return false;
    const name = normalizeAddress(node.dataProviderName || node.m_sFtsoName || node.name || node.display_name);
    const voter = normalizeAddress(node.voterAddress || node.identity_address);
    const delegation = normalizeAddress(node.delegationAddress || node.delegation_address || node.m_sFtsoAddressC);
    return name.includes(TARGET.name) || voter === TARGET.voter || delegation === TARGET.delegation;
  }

  function findDeep(node, predicate) {
    if (!node || typeof node !== "object") return null;
    if (predicate(node)) return node;
    if (Array.isArray(node)) {
      for (const item of node) {
        const match = findDeep(item, predicate);
        if (match) return match;
      }
      return null;
    }
    for (const value of Object.values(node)) {
      const match = findDeep(value, predicate);
      if (match) return match;
    }
    return null;
  }

  function latestEpoch(provider) {
    const history = Array.isArray(provider?.epochData) ? provider.epochData : [];
    if (!history.length) return null;
    return [...history].sort((a, b) => Number(b.epoch || 0) - Number(a.epoch || 0))[0];
  }

  function getNode(validator) {
    return Array.isArray(validator?.m_axNode) ? validator.m_axNode[0] : null;
  }

  function estimateValidatorApr(node) {
    const rewards = Array.isArray(node?.m_axReward) ? node.m_axReward : [];
    const recent = rewards.slice(-20);
    if (!recent.length) return null;
    const avg = recent.reduce((sum, item) => sum + Number(item.m_dValidatorReward || item.m_dNodeReward || 0), 0) / recent.length;
    const stake = Number(node?.m_dStake || 0);
    if (!Number.isFinite(avg) || !Number.isFinite(stake) || stake <= 0) return null;
    return (avg * 26 / stake) * 100;
  }

  function fetchJson(url, timeout = SOURCE_TIMEOUT) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    return fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(response => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.json();
      })
      .finally(() => clearTimeout(timer));
  }

  function seriesFrom(values) {
    if (!Array.isArray(values)) return [];
    return values.map(Number).filter(Number.isFinite).map(value => value <= 1 ? value * 100 : value);
  }

  function rewardSeries(provider, key = "totalRewardAmount") {
    const history = Array.isArray(provider?.epochData) ? provider.epochData : [];
    return history
      .map(item => ({ epoch: Number(item.epoch), value: Number(item[key] || 0) }))
      .filter(item => Number.isFinite(item.epoch) && Number.isFinite(item.value))
      .sort((a, b) => a.epoch - b.epoch)
      .slice(-20);
  }

  function validatorRewardSeries(node) {
    const history = Array.isArray(node?.m_axReward) ? node.m_axReward : [];
    return history
      .map(item => ({
        epoch: Number(item.m_dRewardEpoch),
        value: Number(item.m_dValidatorReward ?? item.m_dNodeReward ?? 0)
      }))
      .filter(item => Number.isFinite(item.epoch) && Number.isFinite(item.value))
      .sort((a, b) => a.epoch - b.epoch)
      .slice(-20);
  }

  function summarizeRewardSeries(series) {
    const values = Array.isArray(series) ? series.map(item => Number(item.value)).filter(Number.isFinite) : [];
    if (!values.length) return { latest: "-", average: "-", range: "-" };
    const latest = values[values.length - 1];
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    return {
      latest: fmtFullFlr(latest),
      average: fmtFullFlr(average),
      range: `${fmtFullFlr(min).replace(" FLR", "")} - ${fmtFullFlr(max)}`
    };
  }

  function chartEmpty(svg, message) {
    if (!svg) return;
    svg.innerHTML = `<text class="empty-text" x="50%" y="52%" text-anchor="middle">${message}</text>`;
  }

  function pointPath(points) {
    return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  }

  function smoothPath(points) {
    if (!Array.isArray(points) || points.length < 3) return pointPath(points || []);
    const commands = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];
    for (let index = 0; index < points.length - 1; index += 1) {
      const p0 = points[index - 1] || points[index];
      const p1 = points[index];
      const p2 = points[index + 1];
      const p3 = points[index + 2] || p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      commands.push(`C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`);
    }
    return commands.join(" ");
  }

  function renderLineChart(selector, input, options = {}) {
    const svg = $(`[data-chart="${selector}"]`);
    if (!svg) return;
    const values = input.map(item => typeof item === "number" ? { value: item } : item)
      .filter(item => Number.isFinite(Number(item.value)));
    if (values.length < 2) {
      chartEmpty(svg, options.empty || "No data");
      return;
    }

    const width = 640;
    const height = options.height || Number(svg.getAttribute("viewBox")?.split(" ")[3]) || 180;
    const pad = { top: 18, right: 18, bottom: 26, left: 36 };
    const rawMin = Math.min(...values.map(item => Number(item.value)));
    const rawMax = Math.max(...values.map(item => Number(item.value)));
    let minValue = options.min ?? rawMin;
    let maxValue = options.max ?? rawMax;
    if (options.zeroBase) {
      minValue = options.min ?? 0;
      maxValue = options.max ?? niceCeil(rawMax * 1.08);
    } else if (options.min == null && options.max == null) {
      const padding = Math.max(0.0001, rawMax - rawMin) * 0.12;
      minValue = Math.max(0, rawMin - padding);
      maxValue = rawMax + padding;
    }
    const range = Math.max(0.0001, maxValue - minValue);
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;
    const xFor = index => pad.left + (values.length === 1 ? 0 : (index / (values.length - 1)) * chartW);
    const yFor = value => pad.top + (1 - ((Number(value) - minValue) / range)) * chartH;
    const points = values.map((item, index) => ({ x: xFor(index), y: yFor(item.value), item }));
    const line = smoothPath(points);
    const fill = `${line} L ${points[points.length - 1].x.toFixed(2)} ${height - pad.bottom} L ${points[0].x.toFixed(2)} ${height - pad.bottom} Z`;
    const targetY = Number.isFinite(options.target) ? yFor(options.target) : null;
    const first = values[0];
    const last = values[values.length - 1];
    const gridLines = [0, 0.25, 0.5, 0.75, 1].map(step => pad.top + step * chartH);
    const lineClass = options.lineClass || "line-main";

    svg.innerHTML = `
      <defs>
        <linearGradient id="${selector}-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ff66a5" stop-opacity=".34"/>
          <stop offset="42%" stop-color="#e04a8a" stop-opacity=".18"/>
          <stop offset="100%" stop-color="#e04a8a" stop-opacity="0"/>
        </linearGradient>
        <filter id="${selector}-glow" x="-12%" y="-35%" width="124%" height="170%">
          <feGaussianBlur stdDeviation="3.4" result="blur"/>
          <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0.95  0 1 0 0 0.18  0 0 1 0 0.48  0 0 0 .55 0"/>
          <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      ${gridLines.map(y => `<line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}"></line>`).join("")}
      ${targetY == null ? "" : `<line class="target-line" x1="${pad.left}" x2="${width - pad.right}" y1="${targetY}" y2="${targetY}"></line>`}
      <path class="area-fill" d="${fill}" fill="url(#${selector}-area)"></path>
      <path class="line-glow ${lineClass}" d="${line}" filter="url(#${selector}-glow)"></path>
      <path class="${lineClass}" d="${line}"></path>
      ${points.map(point => `<circle class="dot" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${point === points[points.length - 1] ? 4 : 2.8}"></circle>`).join("")}
      <text class="axis-label" x="${pad.left}" y="${height - 8}" text-anchor="middle">${first.epoch ?? options.firstLabel ?? ""}</text>
      <text class="axis-label" x="${width - pad.right}" y="${height - 8}" text-anchor="middle">${last.epoch ?? options.lastLabel ?? "now"}</text>
      <text class="axis-label" x="${pad.left - 6}" y="${pad.top + 5}" text-anchor="end">${options.yTop ?? fmtAxis(maxValue)}</text>
      <text class="axis-label" x="${pad.left - 6}" y="${height - pad.bottom + 5}" text-anchor="end">${options.yBottom ?? fmtAxis(minValue)}</text>
    `;
  }

  function renderPerformanceChart(provider) {
    const svg = $('[data-chart="ftsoPerformance"]');
    if (!svg) return;
    const perf = seriesFrom(provider?.ftsoPerformance?.performance1h);
    const primary = seriesFrom(provider?.ftsoPerformance?.performance1_1h);
    const secondary = seriesFrom(provider?.ftsoPerformance?.performance2_1h);
    const len = Math.max(perf.length, primary.length, secondary.length);
    if (len < 2) {
      chartEmpty(svg, "No performance data");
      return;
    }
    const width = 640;
    const height = 170;
    const pad = { top: 22, right: 20, bottom: 28, left: 36 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;
    const xFor = index => pad.left + (index / (len - 1)) * chartW;
    const yFor = value => pad.top + (1 - (value / 100)) * chartH;
    const makePoints = arr => arr.map((value, index) => ({ x: xFor(index), y: yFor(value), item: { value } }));
    const makePath = arr => smoothPath(makePoints(arr));
    const gridLines = [0, 0.25, 0.5, 0.75, 1].map(step => pad.top + step * chartH);
    svg.innerHTML = `
      <defs>
        <filter id="ftsoPerformance-glow" x="-12%" y="-35%" width="124%" height="170%">
          <feGaussianBlur stdDeviation="2.8" result="blur"/>
          <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0.95  0 1 0 0 0.18  0 0 1 0 0.48  0 0 0 .45 0"/>
          <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      ${gridLines.map(y => `<line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}"></line>`).join("")}
      <path class="line-glow line-main" d="${makePath(perf)}" filter="url(#ftsoPerformance-glow)"></path>
      <path class="line-main" d="${makePath(perf)}"></path>
      <path class="line-soft" d="${makePath(primary)}"></path>
      <path class="line-amber" d="${makePath(secondary)}"></path>
      <text class="axis-label" x="${pad.left - 6}" y="${pad.top + 5}" text-anchor="end">100%</text>
      <text class="axis-label" x="${pad.left - 6}" y="${height - pad.bottom + 5}" text-anchor="end">0%</text>
      <text class="axis-label" x="${pad.left}" y="${height - 8}" text-anchor="middle">23h</text>
      <text class="axis-label" x="${width - pad.right}" y="${height - 8}" text-anchor="middle">now</text>
    `;
  }

  function renderConditionHeatmap(provider) {
    const mount = $('[data-render="conditionHeatmap"]');
    if (!mount) return;
    const rows = [
      ["FTSO", item => item.ftsoScaling?.conditionMet],
      ["Fast", item => item.fastUpdates?.conditionMet],
      ["FDC", item => item.fdc?.conditionMet],
      ["Stake", item => item.staking?.conditionMet]
    ];
    const history = (Array.isArray(provider?.epochData) ? provider.epochData : [])
      .slice()
      .sort((a, b) => Number(a.epoch || 0) - Number(b.epoch || 0))
      .slice(-10);

    if (!history.length) {
      mount.innerHTML = `<span class="label">No data</span>`;
      return;
    }

    mount.innerHTML = rows.map(([label, getter]) => {
      const cells = history.map(item => {
        const value = getter(item);
        const cls = value === true ? "ok" : value === false ? "down" : "unknown";
        return `<span class="${cls}" title="${label} epoch ${item.epoch || "-"}"></span>`;
      }).join("");
      return `<span class="label">${label}</span>${cells}`;
    }).join("");
  }

  function renderUptimeStrip(values) {
    const mount = $('[data-render="uptimeStrip"]');
    if (!mount) return;
    const items = Array.isArray(values) && values.length ? values : [];
    if (!items.length) {
      mount.innerHTML = `<span class="source-pill">No uptime data</span>`;
      return;
    }
    mount.innerHTML = items.map(value => {
      const pct = pctNumber(value);
      const cls = pct == null ? "down" : pct >= 99 ? "" : pct >= 95 ? "warn" : "down";
      return `<span class="uptime-pill ${cls}" title="${fmtPct(value)}"></span>`;
    }).join("");
  }

  function computeLevels(provider, latest, validator, nodeHealth) {
    const node = getNode(validator);
    const ftsoAvail = pctNumber(provider?.ftsoPerformance?.availability);
    const fdcAvail = pctNumber(provider?.fdcPerformance?.availability);
    const perf = pctNumber(provider?.ftsoPerformance?.performance);
    const connected = node?.m_bConnected === true;
    const uptimeValues = Array.isArray(node?.m_adUptime) ? node.m_adUptime : [];
    const uptime = uptimeValues.length ? uptimeValues.reduce((sum, value) => sum + Number(value || 0), 0) / uptimeValues.length : null;
    const passes = Number(latest?.passes ?? latest?.newNumberOfPasses);
    const reward = Number(latest?.totalRewardAmount);
    const nodePercent = pctNumber(nodeHealth?.checks?.P?.message?.networking?.percentConnected);
    const nodePeers = Number(nodeHealth?.checks?.network?.message?.connectedPeers);
    const nodeDisk = Number(nodeHealth?.checks?.diskspace?.message?.availableDiskBytes);
    const lastMsg = parseDurationSeconds(nodeHealth?.checks?.network?.message?.timeSinceLastMsgReceived);
    const processingBlocks = Number(nodeHealth?.checks?.P?.message?.engine?.consensus?.processingBlocks || 0)
      + Number(nodeHealth?.checks?.C?.message?.engine?.consensus?.processingBlocks || 0);
    const fdcCondition = latest?.fdc?.conditionMet;
    const ftsoCondition = latest?.ftsoScaling?.conditionMet;
    const fastCondition = latest?.fastUpdates?.conditionMet;
    const stakeCondition = latest?.staking?.conditionMet;
    const preRegistered = provider?.isPreRegistered === true;

    const alerts = [];
    let ftso = "ok";
    let fdc = "ok";
    let val = "ok";
    let nodeLevel = "ok";

    function add(level, title, text) {
      alerts.push({ level, title, text });
    }

    if (!provider || !latest) {
      ftso = "down";
      add("down", "Provider data missing", "Oracle Daemon provider data did not load.");
    } else {
      if (ftsoAvail != null && ftsoAvail < 95) { ftso = "down"; add("down", "FTSO availability critical", `${fmtPct(ftsoAvail)} over recent window.`); }
      else if (ftsoAvail != null && ftsoAvail < 98) { ftso = "warn"; add("warn", "FTSO availability watch", `${fmtPct(ftsoAvail)} over recent window.`); }
      if (latest.eligibleForReward === false) { ftso = "down"; add("down", "Latest epoch not eligible", `Epoch ${latest.epoch || "-"} was not eligible for reward.`); }
      if (Number.isFinite(passes) && passes < 3) { ftso = ftso === "down" ? ftso : "warn"; add("warn", "Condition passes below 3/3", `Latest epoch reports ${passes}/3.`); }
      if (Number.isFinite(reward) && reward <= 0) { ftso = "down"; add("down", "Latest reward is zero", `Epoch ${latest.epoch || "-"} has no reward amount.`); }
      if (ftsoCondition === false || fastCondition === false || stakeCondition === false) { ftso = "warn"; add("warn", "Minimal condition failed", "At least one latest FTSO/staking condition is red."); }
      if (!preRegistered) { ftso = ftso === "down" ? ftso : "warn"; add("warn", "Provider is not pre-registered", "Reward readiness signal is missing."); }
      if (perf != null && perf < 50) { ftso = ftso === "down" ? ftso : "warn"; add("warn", "FTSO performance weak", `${fmtPct(perf)} current performance.`); }
    }

    if (!provider) {
      fdc = "down";
    } else {
      if (fdcAvail != null && fdcAvail < 95) { fdc = "down"; add("down", "FDC availability critical", `${fmtPct(fdcAvail)} over recent window.`); }
      else if (fdcAvail != null && fdcAvail < 98) { fdc = "warn"; add("warn", "FDC availability watch", `${fmtPct(fdcAvail)} over recent window.`); }
      if (fdcCondition === false) { fdc = "down"; add("down", "FDC condition failed", "Latest FDC reward condition is false."); }
    }

    if (!validator || !node) {
      val = "down";
      add("down", "Validator data missing", "Oracle Daemon validator data did not load.");
    } else {
      if (!connected) { val = "down"; add("down", "Validator offline", "External validator status is not connected."); }
      if (uptime != null && uptime < 95) { val = "down"; add("down", "Validator uptime critical", `${fmtPct(uptime)} recent uptime.`); }
      else if (uptime != null && uptime < 99) { val = val === "down" ? val : "warn"; add("warn", "Validator uptime watch", `${fmtPct(uptime)} recent uptime.`); }
      const lastSeen = parseDurationSeconds(node.m_sLastSeen);
      if (lastSeen != null && lastSeen > 180) { val = val === "down" ? val : "warn"; add("warn", "Validator last seen delayed", `${node.m_sLastSeen} since last seen.`); }
      const stake = Array.isArray(node.m_axStake) ? node.m_axStake[0] : null;
      const daysLeft = Array.isArray(stake?.m_aiTimeLeftDHM) ? Number(stake.m_aiTimeLeftDHM[0]) : null;
      if (daysLeft != null && daysLeft < 7) { val = "down"; add("down", "Stake period near end", `${daysLeft} days left on validator stake.`); }
      else if (daysLeft != null && daysLeft < 14) { val = val === "down" ? val : "warn"; add("warn", "Stake renewal window", `${daysLeft} days left on validator stake.`); }
    }

    if (!nodeHealth) {
      nodeLevel = "down";
      add("down", "Direct node health missing", "node.mirhollio.com health endpoint did not load.");
    } else {
      if (nodeHealth.healthy !== true) { nodeLevel = "down"; add("down", "Node self-health failed", "Direct health endpoint reports unhealthy."); }
      if (nodePercent != null && nodePercent < 95) { nodeLevel = "down"; add("down", "Node peer connectivity critical", `${fmtPct(nodePercent)} connected.`); }
      else if (nodePercent != null && nodePercent < 98) { nodeLevel = nodeLevel === "down" ? nodeLevel : "warn"; add("warn", "Node peer connectivity watch", `${fmtPct(nodePercent)} connected.`); }
      if (Number.isFinite(nodePeers) && nodePeers < 100) { nodeLevel = nodeLevel === "down" ? nodeLevel : "warn"; add("warn", "Low node peer count", `${nodePeers} connected peers.`); }
      if (Number.isFinite(nodeDisk) && nodeDisk < 50 * 1024 ** 3) { nodeLevel = "down"; add("down", "Disk space critical", `${fmtCompact(nodeDisk / 1024 ** 3, " GB")} available.`); }
      else if (Number.isFinite(nodeDisk) && nodeDisk < 100 * 1024 ** 3) { nodeLevel = nodeLevel === "down" ? nodeLevel : "warn"; add("warn", "Disk space watch", `${fmtCompact(nodeDisk / 1024 ** 3, " GB")} available.`); }
      if (Number.isFinite(lastMsg) && lastMsg > 10) { nodeLevel = nodeLevel === "down" ? nodeLevel : "warn"; add("warn", "No recent node messages", `${nodeHealth.checks.network.message.timeSinceLastMsgReceived} since last received message.`); }
      if (processingBlocks > 5) { nodeLevel = nodeLevel === "down" ? nodeLevel : "warn"; add("warn", "Consensus backlog", `${processingBlocks} processing blocks.`); }
    }

    return { ftso, fdc, validator: val, node: nodeLevel, alerts };
  }

  function worstLevel(levels) {
    if (levels.includes("down")) return "down";
    if (levels.includes("warn")) return "warn";
    if (levels.includes("loading")) return "loading";
    return "ok";
  }

  function renderAlerts(alerts) {
    const mount = $('[data-render="alerts"]');
    if (!mount) return;
    if (!alerts.length) {
      mount.innerHTML = `<article class="alert-item ok"><b>No active alerts</b><span>All primary checks are inside the configured thresholds.</span></article>`;
      setText("alertCount", "clear");
      const panel = $(".alerts-card");
      if (panel) panel.dataset.alertState = "ok";
      return;
    }
    mount.innerHTML = alerts.slice(0, 6).map(item => `
      <article class="alert-item ${item.level}">
        <b>${item.title}</b>
        <span>${item.text}</span>
      </article>
    `).join("");
    setText("alertCount", `${alerts.length} alert${alerts.length === 1 ? "" : "s"}`);
    const panel = $(".alerts-card");
    if (panel) panel.dataset.alertState = worstLevel(alerts.map(item => item.level));
  }

  function renderRaw(provider, latest, validator, nodeHealth, explorer) {
    const mount = $('[data-render="rawDetails"]');
    if (!mount) return;
    const node = getNode(validator);
    const payload = {
      provider: {
        name: provider?.dataProviderName || "MirSFlr",
        voterAddress: provider?.voterAddress,
        delegationAddress: provider?.delegationAddress,
        latestEpoch: latest?.epoch,
        totalEpochs: provider?.totalEpochs,
        eligibleEpochs: provider?.eligibleEpochs
      },
      validator: {
        nodeId: node?.m_sNodeID,
        connected: node?.m_bConnected,
        lastSeen: node?.m_sLastSeen,
        version: node?.m_sVersion,
        total: validator?.m_dTotal,
        freeSpace: validator?.m_dFreeDelegationSpace
      },
      nodeHealth: {
        healthy: nodeHealth?.healthy,
        peers: nodeHealth?.checks?.network?.message?.connectedPeers,
        percentConnected: nodeHealth?.checks?.P?.message?.networking?.percentConnected,
        bls: nodeHealth?.checks?.bls?.message,
        diskBytes: nodeHealth?.checks?.diskspace?.message?.availableDiskBytes
      },
      explorer: {
        rewardEpoch: explorer?.denormalizedsigningpolicy?.reward_epoch,
        normalizedWeight: explorer?.denormalizedsigningpolicy?.normalized_weight,
        delegationFeeBips: explorer?.denormalizedsigningpolicy?.delegation_fee_bips
      }
    };
    mount.textContent = JSON.stringify(payload, null, 2);
  }

  function applyData(provider, validator, explorer, nodeHealth) {
    const latest = latestEpoch(provider);
    const node = getNode(validator);
    const levels = computeLevels(provider, latest, validator, nodeHealth);
    const overall = worstLevel([levels.ftso, levels.fdc, levels.validator, levels.node]);
    $$(".mobile-health, .desktop-health").forEach(el => {
      el.dataset.overallState = overall;
    });
    setText("overallLabel", overall === "ok" ? "All systems nominal" : overall === "warn" ? "Watch required" : "Action required");
    setText("overallTitle", overall === "ok" ? "All good" : overall === "warn" ? "Watch" : "Act now");
    setText("freshness", state.lastLoadedAt ? `${fmtAge(state.lastLoadedAt)} ago` : "-");

    setStatusCard("ftsoStatus", levels.ftso, levels.ftso === "ok" ? "OK" : levels.ftso === "warn" ? "WARN" : "DOWN", latest ? `E${latest.epoch || "-"}` : "missing");
    setStatusCard("fdcStatus", levels.fdc, levels.fdc === "ok" ? "OK" : levels.fdc === "warn" ? "WARN" : "DOWN", fmtPct(provider?.fdcPerformance?.availability));
    setStatusCard("validatorStatus", levels.validator, levels.validator === "ok" ? "OK" : levels.validator === "warn" ? "WARN" : "DOWN", node?.m_bConnected === true ? "connected" : "offline");
    setStatusCard("nodeStatus", levels.node, levels.node === "ok" ? "OK" : levels.node === "warn" ? "WARN" : "DOWN", nodeHealth?.healthy ? "healthy" : "unhealthy");

    const policy = explorer?.denormalizedsigningpolicy || {};
    const fee = policy.delegation_fee_bips ?? latest?.voterRegistration?.delegationFeeBIPS;
    const reward = Number(latest?.totalRewardAmount);
    const passes = Number(latest?.passes ?? latest?.newNumberOfPasses);
    const conditionOk = [latest?.ftsoScaling?.conditionMet, latest?.fastUpdates?.conditionMet, latest?.fdc?.conditionMet, latest?.staking?.conditionMet]
      .filter(value => value === true).length;

    setText("latestEpoch", latest?.epoch ? `Epoch ${latest.epoch}` : "Epoch -");
    setText("latestReward", Number.isFinite(reward) ? fmtCompact(reward, "") : "-");
    setText("latestEligibility", latest?.eligibleForReward === true ? "eligible" : latest?.eligibleForReward === false ? "not eligible" : "eligibility -");
    setText("rewardRate", latest?.m_dRewardRate != null ? fmtPct(latest.m_dRewardRate) : "-");
    setText("ftsoAvailability", provider?.ftsoPerformance?.availability != null ? fmtPct(provider.ftsoPerformance.availability) : "-");
    setText("fdcAvailability", provider?.fdcPerformance?.availability != null ? fmtPct(provider.fdcPerformance.availability) : "-");
    setText("conditionPasses", Number.isFinite(passes) ? `${passes}/3` : `${conditionOk}/4`);
    setText("conditionsLabel", `${conditionOk}/4 latest checks`);
    setText("preRegistered", provider?.isPreRegistered === true ? "Yes" : provider?.isPreRegistered === false ? "No" : "-");

    const uptimeValues = Array.isArray(node?.m_adUptime) ? node.m_adUptime : [];
    const uptimeAvg = uptimeValues.length ? uptimeValues.reduce((sum, value) => sum + Number(value || 0), 0) / uptimeValues.length : null;
    const stake = Array.isArray(node?.m_axStake) ? node.m_axStake[0] : null;
    const timeLeft = Array.isArray(stake?.m_aiTimeLeftDHM) ? `${stake.m_aiTimeLeftDHM[0]}d ${stake.m_aiTimeLeftDHM[1]}h` : "-";
    const capacity = Number(validator?.m_dTotal);
    const freeSpace = Number(validator?.m_dFreeDelegationSpace);
    const capacityMax = capacity + freeSpace;
    const capacityPct = capacityMax > 0 ? (capacity / capacityMax) * 100 : 0;
    const selfBond = 3_000_000;
    const delegatedStake = Number.isFinite(capacity) ? Math.max(0, capacity - selfBond) : null;

    setText("validatorVersion", node?.m_sVersion ? String(node.m_sVersion).replace(/^avalanchego\//, "v") : "v-");
    setText("validatorConnected", node?.m_bConnected === true ? "Connected" : node?.m_bConnected === false ? "Offline" : "-");
    setText("validatorLastSeen", node?.m_sLastSeen ? `last seen ${node.m_sLastSeen}` : "last seen -");
    setText("nodeHealthy", nodeHealth?.healthy === true ? "Healthy" : nodeHealth ? "Unhealthy" : "-");
    setText("nodePeers", nodeHealth?.checks?.network?.message?.connectedPeers != null ? `${nodeHealth.checks.network.message.connectedPeers} peers` : "peers -");
    setText("validatorUptime", Number.isFinite(uptimeAvg) ? fmtPct(uptimeAvg) : "-");
    setText("validatorApr", Number.isFinite(estimateValidatorApr(node)) ? fmtPct(estimateValidatorApr(node)) : "-");
    setText("validatorStake", validator?.m_dTotal != null ? fmtCompact(validator.m_dTotal, " FLR") : "-");
    setText("validatorStakeMeta", timeLeft !== "-" ? `stake ends in ${timeLeft}` : "self + delegation");
    setText("freeSpace", validator?.m_dFreeDelegationSpace != null ? fmtCompact(validator.m_dFreeDelegationSpace, " FLR") : "-");
    setText("selfBond", "3M FLR");
    setText("delegatedStake", delegatedStake != null ? fmtCompact(delegatedStake, " FLR") : "-");
    setText("stakeEnds", Array.isArray(stake?.m_aiTimeLeftDHM) ? `${stake.m_aiTimeLeftDHM[0]}d` : "-");
    setText("capacityText", capacityMax > 0 ? `${fmtCompact(capacity, "")} / ${fmtCompact(capacityMax, " FLR")}` : "-");
    setText("capacityPct", `${fmtNum(capacityPct, 1)}%`);
    setBar("stakeCapacity", capacityPct);
    setStakeAngle(capacityPct);

    const percentConnected = nodeHealth?.checks?.P?.message?.networking?.percentConnected;
    setText("nodeNetwork", percentConnected != null ? fmtPct(percentConnected) : "-");
    const diskBytes = Number(nodeHealth?.checks?.diskspace?.message?.availableDiskBytes);
    setText("nodeDisk", Number.isFinite(diskBytes) ? fmtCompact(diskBytes / 1024 ** 4, " TB") : "-");
    const processing = Number(nodeHealth?.checks?.P?.message?.engine?.consensus?.processingBlocks || 0)
      + Number(nodeHealth?.checks?.C?.message?.engine?.consensus?.processingBlocks || 0);
    setText("nodeProcessing", `${processing} blocks`);
    setText("nodeBls", String(nodeHealth?.checks?.bls?.message || "").includes("correct") ? "OK" : "-");

    setText("oracleSource", state.sources.provider === "ok" && state.sources.validator === "ok" ? "OK" : state.sources.provider === "down" || state.sources.validator === "down" ? "DOWN" : "WARN");
    setText("oracleSourceMeta", "providers + validators");
    setText("explorerSource", state.sources.explorer === "ok" ? "OK" : state.sources.explorer === "warn" ? "BLOCKED" : "DOWN");
    setText("explorerSourceMeta", policy.reward_epoch ? `policy E${policy.reward_epoch}` : state.sources.explorer === "warn" ? "direct browser fetch blocked" : "entity policy");
    setText("nodeSource", state.sources.node === "ok" ? "OK" : "DOWN");
    setText("nodeSourceMeta", nodeHealth?.checks?.network?.message?.connectedPeers != null ? `${nodeHealth.checks.network.message.connectedPeers} peers` : "self health");
    const oracleGroup = state.sources.provider === "ok" && state.sources.validator === "ok" ? "ok" : "down";
    const sourceGroups = [oracleGroup, state.sources.explorer, state.sources.node];
    const liveSources = sourceGroups.filter(value => value === "ok").length;
    const blockedSources = sourceGroups.filter(value => value === "warn").length;
    setText("sourceSummary", blockedSources ? `${liveSources}/3 live` : `${liveSources}/3 online`);

    renderAlerts(levels.alerts);
    const ftsoRewards = rewardSeries(provider);
    const validatorRewards = validatorRewardSeries(node);
    const ftsoSummary = summarizeRewardSeries(ftsoRewards);
    const validatorSummary = summarizeRewardSeries(validatorRewards);
    setText("ftsoRewardLatestFull", ftsoSummary.latest);
    setText("ftsoRewardAverageFull", ftsoSummary.average);
    setText("ftsoRewardRangeFull", ftsoSummary.range);
    setText("validatorRewardLatestFull", validatorSummary.latest);
    setText("validatorRewardAverageFull", validatorSummary.average);
    setText("validatorRewardRangeFull", validatorSummary.range);
    renderLineChart("ftsoRewards", ftsoRewards, { empty: "No reward data", zeroBase: true, yBottom: "0" });
    renderLineChart("ftsoAvailability", seriesFrom(provider?.ftsoPerformance?.availability1h), { min: 90, max: 100, target: 98, empty: "No FTSO availability", yTop: "100%", yBottom: "90%" });
    renderLineChart("fdcAvailability", seriesFrom(provider?.fdcPerformance?.availability1h), { min: 90, max: 100, target: 98, empty: "No FDC availability", yTop: "100%", yBottom: "90%" });
    renderPerformanceChart(provider);
    renderConditionHeatmap(provider);
    renderLineChart("validatorRewards", validatorRewards, { empty: "No validator rewards", zeroBase: true, yBottom: "0", lineClass: "line-green" });
    renderUptimeStrip(uptimeValues);
    renderRaw(provider, latest, validator, nodeHealth, explorer);
  }

  async function loadAll() {
    document.body.classList.add("is-refreshing");
    setText("refreshLabel", "Loading");
    const sourceResults = await Promise.allSettled([
      fetchJson(ENDPOINTS.providersV2),
      fetchJson(ENDPOINTS.validators),
      fetchJson(ENDPOINTS.explorerEntity),
      fetchJson(ENDPOINTS.nodeHealth)
    ]);

    let providerPayload = sourceResults[0].status === "fulfilled" ? sourceResults[0].value : null;
    let validatorPayload = sourceResults[1].status === "fulfilled" ? sourceResults[1].value : null;
    let explorer = sourceResults[2].status === "fulfilled" ? sourceResults[2].value : null;
    let nodeHealth = sourceResults[3].status === "fulfilled" ? sourceResults[3].value : null;
    let provider = providerPayload ? findDeep(providerPayload, isMirProvider) : null;

    if (!provider) {
      try {
        providerPayload = await fetchJson(ENDPOINTS.providersV1);
        provider = findDeep(providerPayload, isMirProvider);
      } catch (_) {}
    }

    const validator = validatorPayload ? findDeep(validatorPayload, node => {
      if (!node || typeof node !== "object") return false;
      const name = normalizeAddress(node.m_sFtsoName);
      const cAddress = normalizeAddress(node.m_sFtsoAddressC);
      const nodes = Array.isArray(node.m_axNode) ? node.m_axNode : [];
      return name.includes(TARGET.name) || cAddress === TARGET.delegation || nodes.some(item => item.m_sNodeID === TARGET.nodeId);
    }) : null;

    setSource("provider", provider ? "ok" : "down");
    setSource("validator", validator ? "ok" : "down");
    setSource("explorer", explorer ? "ok" : "warn");
    setSource("node", nodeHealth ? "ok" : "down");

    state.lastLoadedAt = new Date();
    state.data = { provider, validator, explorer, nodeHealth };
    applyData(provider, validator, explorer, nodeHealth);
    setText("refreshLabel", "Refresh");
    document.body.classList.remove("is-refreshing");
  }

  function startAutoRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(loadAll, AUTO_REFRESH_MS);
  }

  function initPullToRefresh() {
    let startY = 0;
    let armed = false;
    window.addEventListener("touchstart", event => {
      if (window.scrollY > 0 || !event.touches.length) return;
      startY = event.touches[0].clientY;
      armed = true;
    }, { passive: true });
    window.addEventListener("touchmove", event => {
      if (!armed || !event.touches.length) return;
      const distance = event.touches[0].clientY - startY;
      if (distance > 90) {
        armed = false;
        loadAll();
      }
    }, { passive: true });
    window.addEventListener("touchend", () => { armed = false; }, { passive: true });
  }

  document.addEventListener("click", event => {
    if (event.target.closest("[data-action='refresh']")) loadAll();
  });

  loadAll();
  startAutoRefresh();
  initPullToRefresh();
})();
