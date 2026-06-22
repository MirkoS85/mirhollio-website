(function () {
  "use strict";

  // ââ ENDPOINTS ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  // Primary sources: Oracle Daemon + Flare Systems Explorer (existing)
  // Added: Official Flare RPC, Ankr RPC backup, Flare Metrics API,
  //        Official Validator Tracker, Blockscout
  const ENDPOINTS = {
    // Oracle Daemon (primary â existing)
    providersV2: "https://api.oracle-daemon.com/v2/flare/providers",
    providersV1: "https://api.oracle-daemon.com/v1/flare/providers",
    validators: "https://api.oracle-daemon.com/v1/flare/validators",
    // Flare Systems Explorer (existing)
    explorerEntity: "https://flare-systems-explorer.flare.network/backend-url/api/v0/entity/0xb5A081dEc72c8C87256b7e14cFAdcbc342bDeac3",
    explorerFtso: "https://flare-systems-explorer.flare.network/backend-url/api/v0/entity/0xb5A081dEc72c8C87256b7e14cFAdcbc342bDeac3/ftso",
    // Self (existing)
    nodeHealth: "https://node.mirhollio.com/flare/ext/health",
    daemonStatus: "https://node.mirhollio.com/ops/status.json",
    // ââ NEW: Official Flare RPC endpoints (wallet balances + epoch) ââ
    flareRpcPrimary: "https://flare-api.flare.network/ext/C/rpc",
    flareRpcBackup: "https://rpc.ankr.com/flare",
    // ââ NEW: Flare Metrics API (validator backup) ââ
    flareMetricsProvider: "https://flaremetrics.io/api/v1/ftso/providers?network=flare",
    flareMetricsValidator: "https://flaremetrics.io/api/v1/validators?network=flare",
    // ââ NEW: Official Flare Validator Tracker ââ
    flareValidatorTracker: "https://flare-validators.flare.network/api/validators",
    // ââ NEW: Blockscout for on-chain tx verification ââ
    blockscoutAddress: "https://flare-explorer.flare.network/api/v2/addresses/"
  };

  // ââ TARGET âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  const TARGET = {
    name: "mirsflr",
    voter: "0xb5a081dec72c8c87256b7e14cfadcbc342bdeac3",
    delegation: "0xad9105bef5e5df2eacbe2de9037a96695b00cade",
    nodeId: "NodeID-8dNfgpspPNDrZD2ksKCRJoGe4Xqe6qVtz",
    // Operational wallet addresses for balance checks
    submitAddress: null,       // populated from provider data on first load
    signatureAddress: null,
    policyAddress: null
  };

  // ââ WALLET BALANCE THRESHOLDS (FLR) âââââââââââââââââââââââââââââââââââââââ
  const BALANCE_WARN_FLR = 500;
  const BALANCE_DOWN_FLR = 100;

  const SOURCE_TIMEOUT = 16_000;
  const RPC_TIMEOUT = 8_000;
  const AUTO_REFRESH_MS = 60_000;

  const state = {
    lastLoadedAt: null,
    refreshTimer: null,
    sources: {
      provider: "loading",
      validator: "loading",
      explorer: "loading",
      explorerFtso: "loading",
      node: "loading",
      daemon: "loading",
      rpc: "loading",
      flareMetrics: "loading"
    },
    sourceLoadedAt: {
      provider: null,
      validator: null,
      explorer: null,
      explorerFtso: null,
      node: null,
      daemon: null,
      rpc: null,
      flareMetrics: null
    },
    walletBalances: {
      submit: null,
      signature: null,
      policy: null,
      source: null
    },
    epochFallback: null,
    validatorFallback: null,
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

  function setToneCard(card, tone) {
    $$(`[data-tone-card="${card}"]`).forEach(el => {
      el.dataset.tone = tone;
    });
  }

  function setSignal(field, value, stateValue = "") {
    setText(field, value);
    $$(`[data-field="${field}"]`).forEach(el => {
      if (stateValue) el.dataset.state = stateValue;
      else delete el.dataset.state;
    });
  }

  function setMetricTone(field, tone, hint = "") {
    $$(`[data-field="${field}"]`).forEach(el => {
      if (tone) el.dataset.metricTone = tone;
      else delete el.dataset.metricTone;
      if (hint) el.title = hint;
      else el.removeAttribute("title");
    });
  }

  function higherIsBetterTone(value, okAt, warnAt) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    if (n >= okAt) return "ok";
    if (n >= warnAt) return "warn";
    return "down";
  }

  function lowerIsBetterTone(value, okAt, warnAt) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    if (n <= okAt) return "ok";
    if (n <= warnAt) return "warn";
    return "down";
  }

  function median(values) {
    const sorted = (Array.isArray(values) ? values : [])
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
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

  function recentAverage(values, count = 3) {
    const recent = (Array.isArray(values) ? values : [])
      .map(pctNumber)
      .filter(value => value != null)
      .slice(-count);
    if (!recent.length) return null;
    return recent.reduce((sum, value) => sum + value, 0) / recent.length;
  }

  function fmtOptionalPct(value, decimals = 2) {
    return value == null ? "-" : fmtPct(value, decimals);
  }

  function explorerFtsoMetric(payload, windowName, key) {
    const value = payload?.[windowName]?.[key];
    return pctNumber(value);
  }

  function metricWithFallback(primaryValue, fallbackValues, fallbackCount) {
    return primaryValue != null ? primaryValue : recentAverage(fallbackValues, fallbackCount);
  }

  function windowSourceLabel(primaryCount, expectedCount, hours) {
    if (primaryCount >= expectedCount) return "FSE";
    if (primaryCount > 0) return "FSE / Oracle";
    return `Oracle ${hours}h avg`;
  }

  function oracleAverageSource(values, hours) {
    const count = Array.isArray(values) ? Math.min(hours, values.length) : 0;
    if (count >= hours) return `Oracle ${hours}h avg`;
    if (count > 1) return `Oracle ${count}h avg`;
    return "Oracle current";
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

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function availabilityZone(value) {
    const pct = pctNumber(value);
    if (pct == null) return { level: "unknown", label: "Unknown zone" };
    if (pct >= 98) return { level: "ok", label: "OK zone" };
    if (pct >= 95) return { level: "warn", label: "Watch zone" };
    return { level: "down", label: "Critical zone" };
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

  function fmtUntil(value) {
    if (!value) return "-";
    const date = value instanceof Date ? value : new Date(value);
    const ms = date.getTime() - Date.now();
    if (!Number.isFinite(ms)) return "-";
    if (ms <= 0) return "ended";
    const totalMinutes = Math.floor(ms / 60_000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${Math.max(1, minutes)}m`;
  }

  function fmtShortDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "-";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function payloadData(payload) {
    return payload?.m_xData || payload?.data || payload || {};
  }

  function networkInfo(payload) {
    return payloadData(payload)?.m_xNetworkInfo || payload?.m_xNetworkInfo || null;
  }

  function providerTimestamp(payload) {
    return payloadData(payload)?.m_xTimestamp || payload?.m_xTimestamp || null;
  }

  function nodeHealthTimestamps(nodeHealth) {
    const checks = nodeHealth?.checks && typeof nodeHealth.checks === "object" ? Object.values(nodeHealth.checks) : [];
    return checks
      .map(check => new Date(check?.timestamp))
      .filter(date => Number.isFinite(date.getTime()));
  }

  function nodeHealthTimestamp(nodeHealth, mode = "newest") {
    const timestamps = nodeHealthTimestamps(nodeHealth);
    if (!timestamps.length) return null;
    const times = timestamps.map(date => date.getTime());
    const selected = mode === "oldest" ? Math.min(...times) : Math.max(...times);
    return new Date(selected);
  }

  function timestampAgeMs(value) {
    const date = value instanceof Date ? value : new Date(value);
    const time = date.getTime();
    if (!Number.isFinite(time)) return null;
    return Date.now() - time;
  }

  function firstField(sources, ...keys) {
    for (const source of sources) {
      if (!source || typeof source !== "object") continue;
      for (const key of keys) {
        if (source[key] != null && source[key] !== "") return source[key];
      }
    }
    return null;
  }

  function daemonInfo(payload) {
    if (!payload || typeof payload !== "object") return null;
    return payload.daemon || payload.ops || payload.status || payload;
  }

  function daemonSources(payload) {
    const info = daemonInfo(payload);
    return [info, info?.events, payload?.events].filter(item => item && typeof item === "object");
  }

  function daemonTimestamp(payload, ...keys) {
    const value = firstField(daemonSources(payload), ...keys);
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function hostInfo(payload) {
    if (!payload || typeof payload !== "object") return null;
    return payload.host || payload.system || payload.telemetry || payload.ops?.host || payload.daemon?.host || null;
  }

  function feedInfo(payload) {
    if (!payload || typeof payload !== "object") return null;
    return payload.feeds || payload.feedLevel || payload.feed_level || payload.ops?.feeds || payload.daemon?.feeds || null;
  }

  function signalTitle(level, missing = "Not exposed") {
    if (level === "ok") return "OK";
    if (level === "warn") return "Watch";
    if (level === "down") return "Down";
    return missing;
  }

  function hostSignalSummary(payload) {
    const info = hostInfo(payload);
    if (!info) return { level: "ok", title: "Public only", meta: "no node-side agent by design" };
    const cpu = pctNumber(firstField([info], "cpuPct", "cpuPercent", "cpu_percent", "cpu"));
    const memory = pctNumber(firstField([info], "memoryPct", "memoryPercent", "memory_percent", "ramPct", "ram_percent", "ram"));
    const load = Number(firstField([info], "load1", "load_1", "loadAverage1m", "load_average_1m"));
    let level = "ok";
    if ((cpu != null && cpu >= 95) || (memory != null && memory >= 95) || (Number.isFinite(load) && load >= 12)) level = "down";
    else if ((cpu != null && cpu >= 85) || (memory != null && memory >= 85) || (Number.isFinite(load) && load >= 8)) level = "warn";
    const parts = [];
    if (cpu != null) parts.push(`CPU ${fmtPct(cpu, 0)}`);
    if (memory != null) parts.push(`RAM ${fmtPct(memory, 0)}`);
    if (Number.isFinite(load)) parts.push(`load ${fmtNum(load, 1)}`);
    return {
      level,
      title: signalTitle(level),
      meta: parts.length ? parts.join(" - ") : "telemetry wired"
    };
  }

  function feedSignalSummary(payload) {
    const info = feedInfo(payload);
    if (!info) return { level: "ok", title: "Aggregated", meta: "public APIs expose summary data" };
    const misses = Number(firstField([info], "missesLastHour", "misses_last_hour", "misses24h", "misses_24h", "feedMisses"));
    const stale = Number(firstField([info], "staleFeeds", "stale_feeds", "stale"));
    const late = Number(firstField([info], "lateFeeds", "late_feeds", "late"));
    let level = "ok";
    if ((Number.isFinite(misses) && misses > 5) || (Number.isFinite(stale) && stale > 0)) level = "down";
    else if ((Number.isFinite(misses) && misses > 0) || (Number.isFinite(late) && late > 0)) level = "warn";
    const parts = [];
    if (Number.isFinite(misses)) parts.push(`${misses} misses`);
    if (Number.isFinite(stale)) parts.push(`${stale} stale`);
    if (Number.isFinite(late)) parts.push(`${late} late`);
    return {
      level,
      title: signalTitle(level),
      meta: parts.length ? parts.join(" - ") : "feed checks wired"
    };
  }

  function daemonSignalSummary(payload) {
    const info = daemonInfo(payload);
    if (!info || payload?.configured === false || payload?.wired === false || info.configured === false || info.wired === false) {
      return {
        wired: false,
        level: "ok",
        title: "Public-only",
        meta: "no server install",
        fdcLevel: "ok",
        fdcTitle: "Provider metrics",
        fdcMeta: "Oracle provider summary"
      };
    }
    const submit = daemonTimestamp(payload, "lastSubmitAt", "last_submit_at", "submitAt", "submit_at");
    const reveal = daemonTimestamp(payload, "lastRevealAt", "last_reveal_at", "revealAt", "reveal_at");
    const signature = daemonTimestamp(payload, "lastSignatureAt", "last_signature_at", "signatureAt", "signature_at");
    const fdc = daemonTimestamp(payload, "lastFdcSignatureAt", "last_fdc_signature_at", "lastFDCSignatureAt", "fdcSignatureAt", "fdc_signature_at");
    const daemonTimes = [submit, reveal, signature].filter(Boolean);
    const freshestDaemon = daemonTimes.length ? new Date(Math.max(...daemonTimes.map(date => date.getTime()))) : null;
    const daemonAge = freshestDaemon ? timestampAgeMs(freshestDaemon) : null;
    const fdcAge = fdc ? timestampAgeMs(fdc) : null;
    const healthy = info.healthy ?? info.ok ?? info.running;
    let level = healthy === false ? "down" : "ok";
    if (daemonAge == null) level = "warn";
    else if (daemonAge > 30 * 60_000) level = "down";
    else if (daemonAge > 10 * 60_000) level = "warn";
    const fdcLevel = fdcAge == null ? "warn" : fdcAge > 60 * 60_000 ? "down" : fdcAge > 15 * 60_000 ? "warn" : "ok";
    if (fdcLevel === "down") level = "down";
    else if (fdcLevel === "warn" && level === "ok") level = "warn";
    return {
      wired: true,
      level,
      title: level === "ok" ? "OK" : level === "warn" ? "Watch" : "Down",
      meta: daemonAge == null ? "missing event timestamps" : `latest ${fmtAge(freshestDaemon)} old`,
      fdcLevel,
      fdcTitle: fdcLevel === "ok" ? "OK" : fdcLevel === "warn" ? "Watch" : "Down",
      fdcMeta: fdcAge == null ? "missing FDC signature" : `${fmtAge(fdc)} old`,
      healthy, submit, reveal, signature, fdc
    };
  }

  function parseDurationSeconds(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    const ms = trimmed.match(/^(\d+(?:\.\d+)?)ms$/);
    if (ms) return Number(ms[1]) / 1000;
    const hms = trimmed.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
    if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
    const unit = trimmed.match(/^(\d+(?:\.\d+)?)(ns|us|Âµs|ms|s|m|h)$/);
    if (unit) {
      const amount = Number(unit[1]);
      const scale = { ns: 1e-9, us: 1e-6, "Âµs": 1e-6, ms: 1e-3, s: 1, m: 60, h: 3600 }[unit[2]];
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

  // ââ NEW: JSON-RPC call helper ââââââââââââââââââââââââââââââââââââââââââââââ
  function rpcCall(url, method, params, timeout = RPC_TIMEOUT) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      cache: "no-store",
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 })
    })
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(data => { if (data.error) throw new Error(data.error.message); return data.result; })
      .finally(() => clearTimeout(timer));
  }

  // ââ NEW: Fetch one wallet balance via RPC with primaryâbackup fallback âââââ
  async function fetchBalanceFLR(address) {
    if (!address) return null;
    const hexAddress = address.startsWith("0x") ? address : `0x${address}`;
    let result = null;
    try {
      result = await rpcCall(ENDPOINTS.flareRpcPrimary, "eth_getBalance", [hexAddress, "latest"]);
      state.sources.rpc = "ok";
      state.walletBalances.source = "flare-api.flare.network";
    } catch (_) {
      try {
        result = await rpcCall(ENDPOINTS.flareRpcBackup, "eth_getBalance", [hexAddress, "latest"]);
        state.sources.rpc = "ok";
        state.walletBalances.source = "ankr";
      } catch (__) {
        state.sources.rpc = "down";
        return null;
      }
    }
    if (!result) return null;
    // Convert hex wei â FLR (18 decimals)
    const wei = BigInt(result);
    return Number(wei) / 1e18;
  }

  // ââ NEW: Fetch all operational wallet balances in parallel âââââââââââââââââ
  async function fetchWalletBalances(provider) {
    // Extract addresses from provider data on first load
    const submitAddr = provider?.submitAddress || TARGET.submitAddress;
    const sigAddr = provider?.submitSignatureAddress || TARGET.signatureAddress;
    const policyAddr = provider?.signingPolicyAddress || TARGET.policyAddress;

    if (!submitAddr && !sigAddr && !policyAddr) {
      state.sources.rpc = "warn";
      return;
    }

    // Cache addresses for next refresh
    if (submitAddr) TARGET.submitAddress = submitAddr;
    if (sigAddr) TARGET.signatureAddress = sigAddr;
    if (policyAddr) TARGET.policyAddress = policyAddr;

    const [submit, signature, policy] = await Promise.all([
      fetchBalanceFLR(submitAddr),
      fetchBalanceFLR(sigAddr),
      fetchBalanceFLR(policyAddr)
    ]);

    state.walletBalances = { submit, signature, policy, source: state.walletBalances.source };
    state.sourceLoadedAt.rpc = new Date();
  }

  // ââ NEW: Fetch epoch data from Flare Metrics as fallback âââââââââââââââââââ
  async function fetchEpochFallback() {
    try {
      // Flare Metrics returns current epoch info
      const data = await fetchJson("https://flaremetrics.io/api/v1/network?network=flare", 8_000);
      if (data?.current_reward_epoch != null) {
        state.epochFallback = {
          currentEpoch: data.current_reward_epoch,
          epochEndTime: data.reward_epoch_end_time || null,
          source: "Flare Metrics"
        };
        state.sources.flareMetrics = "ok";
        state.sourceLoadedAt.flareMetrics = new Date();
      }
    } catch (_) {
      // Fallback: try computing from RPC block number
      try {
        const blockHex = await rpcCall(ENDPOINTS.flareRpcPrimary, "eth_blockNumber", []);
        const block = parseInt(blockHex, 16);
        // Flare epoch ~3.5 days = ~302,400 blocks at 1s/block
        // Epoch 0 started at block 0, rough estimate
        const estimatedEpoch = Math.floor(block / 302400);
        state.epochFallback = { currentEpoch: estimatedEpoch, epochEndTime: null, source: "RPC estimate" };
        state.sources.rpc = state.sources.rpc === "down" ? "warn" : state.sources.rpc;
      } catch (__) {
        state.sources.flareMetrics = "down";
      }
    }
  }

  // ââ NEW: Fetch validator data from Flare Metrics / official tracker âââââââââ
  async function fetchValidatorFallback() {
    // Try Flare Metrics first
    try {
      const data = await fetchJson(ENDPOINTS.flareMetricsValidator, 10_000);
      const validators = Array.isArray(data) ? data : data?.validators || [];
      const match = validators.find(v => {
        const nodeId = String(v.nodeId || v.node_id || "");
        return nodeId === TARGET.nodeId;
      });
      if (match) {
        state.validatorFallback = {
          uptime: match.uptime_percentage ?? match.uptime ?? null,
          stake: match.stake_amount ?? match.total_stake ?? null,
          delegated: match.delegated_amount ?? null,
          freeSpace: match.free_space ?? match.available_delegation ?? null,
          endTime: match.end_time ?? match.stake_end ?? null,
          source: "Flare Metrics"
        };
        state.sources.flareMetrics = "ok";
        state.sourceLoadedAt.flareMetrics = new Date();
        return;
      }
    } catch (_) {}

    // Try official Flare validator tracker
    try {
      const data = await fetchJson(ENDPOINTS.flareValidatorTracker, 10_000);
      const validators = Array.isArray(data) ? data : data?.validators || [];
      const match = validators.find(v => {
        const nodeId = String(v.nodeId || v.node_id || "");
        return nodeId === TARGET.nodeId;
      });
      if (match) {
        state.validatorFallback = {
          uptime: match.uptime ?? match.uptimePercentage ?? null,
          stake: match.stakeAmount ?? match.stake ?? null,
          delegated: match.delegatedStake ?? null,
          freeSpace: null,
          endTime: match.endTime ?? match.stakeEndTime ?? null,
          source: "Flare Validator Tracker"
        };
      }
    } catch (__) {}
  }

  function seriesFrom(values) {
    if (!Array.isArray(values)) return [];
    return values.map(Number).filter(Number.isFinite).map(value => value <= 1 ? value * 100 : value);
  }

  function hourlySeries(values) {
    if (!Array.isArray(values)) return [];
    return values
      .map(Number)
      .filter(Number.isFinite)
      .slice(0, 24)
      .reverse()
      .map(value => value <= 1 ? value * 100 : value);
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

  function chartPointLabel(point, index, total, options) {
    if (point?.item?.epoch != null) return `Epoch ${point.item.epoch}`;
    if (index === total - 1) return options.lastLabel || "now";
    if (index === 0) return options.firstLabel || `${Math.max(0, total - 1)}h ago`;
    return `${Math.max(0, total - 1 - index)}h ago`;
  }

  function chartTooltipHtml(point, index, total, options) {
    const label = chartPointLabel(point, index, total, options);
    if (options.tooltip === "reward") {
      return `<span>${escapeHtml(label)}</span><strong>${escapeHtml(fmtFullFlr(point.item.value))}</strong>`;
    }
    if (options.tooltip === "availability") {
      const zone = availabilityZone(point.item.value);
      return `<span>${escapeHtml(options.metricLabel || "Availability")}</span><strong>${escapeHtml(fmtPct(point.item.value))}</strong><em>${escapeHtml(label)} - ${escapeHtml(zone.label)}</em>`;
    }
    return `<span>${escapeHtml(label)}</span><strong>${escapeHtml(fmtPct(point.item.value))}</strong>`;
  }

  function ensureChartTooltip(svg) {
    const card = svg.closest(".chart-card");
    if (!card) return null;
    let tooltip = card.querySelector(".ops-chart-tooltip");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "ops-chart-tooltip";
      card.appendChild(tooltip);
    }
    return tooltip;
  }

  function setupChartTooltip(svg, points, options, width, height) {
    if (!options.tooltip) return;
    const tooltip = ensureChartTooltip(svg);
    const card = svg.closest(".chart-card");
    if (!tooltip || !card) return;
    function show(index) {
      const point = points[index];
      if (!point) return;
      const svgRect = svg.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const x = svgRect.left - cardRect.left + (point.x / width) * svgRect.width;
      const y = svgRect.top - cardRect.top + (point.y / height) * svgRect.height;
      const minX = Math.min(92, Math.max(24, cardRect.width / 2));
      const maxX = Math.max(minX, cardRect.width - minX);
      tooltip.innerHTML = chartTooltipHtml(point, index, points.length, options);
      tooltip.dataset.zone = options.tooltip === "availability" ? availabilityZone(point.item.value).level : "reward";
      tooltip.style.left = `${Math.max(minX, Math.min(maxX, x))}px`;
      tooltip.style.top = `${Math.max(44, y - 10)}px`;
      tooltip.classList.add("is-visible");
    }
    function hide() { tooltip.classList.remove("is-visible"); }
    $$(".chart-hit", svg).forEach((hit, index) => {
      hit.addEventListener("pointerenter", () => show(index));
      hit.addEventListener("pointermove", () => show(index));
      hit.addEventListener("pointerdown", event => { event.preventDefault(); show(index); });
      hit.addEventListener("focus", () => show(index));
      hit.addEventListener("pointerleave", hide);
      hit.addEventListener("blur", hide);
    });
  }

  function setupPerformanceTooltip(svg, perf, primary, secondary, points, width, height) {
    const tooltip = ensureChartTooltip(svg);
    const card = svg.closest(".chart-card");
    if (!tooltip || !card) return;
    function show(index) {
      const point = points[index];
      if (!point) return;
      const svgRect = svg.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const x = svgRect.left - cardRect.left + (point.x / width) * svgRect.width;
      const y = svgRect.top - cardRect.top + (point.y / height) * svgRect.height;
      const minX = Math.min(104, Math.max(24, cardRect.width / 2));
      const maxX = Math.max(minX, cardRect.width - minX);
      const label = index === points.length - 1 ? "now" : `${Math.max(0, points.length - 1 - index)}h ago`;
      tooltip.innerHTML = `
        <span>FTSO performance</span>
        <strong>${escapeHtml(fmtPct(perf[index]))}</strong>
        <em>${escapeHtml(label)}</em>
        <div class="tooltip-metrics">
          <span>Primary band <b>${escapeHtml(fmtPct(primary[index]))}</b></span>
          <span>Secondary <b>${escapeHtml(fmtPct(secondary[index]))}</b></span>
        </div>
      `;
      tooltip.dataset.zone = "reward";
      tooltip.style.left = `${Math.max(minX, Math.min(maxX, x))}px`;
      tooltip.style.top = `${Math.max(44, y - 10)}px`;
      tooltip.classList.add("is-visible");
    }
    function hide() { tooltip.classList.remove("is-visible"); }
    $$(".chart-hit", svg).forEach((hit, index) => {
      hit.addEventListener("pointerenter", () => show(index));
      hit.addEventListener("pointermove", () => show(index));
      hit.addEventListener("pointerdown", event => { event.preventDefault(); show(index); });
      hit.addEventListener("focus", () => show(index));
      hit.addEventListener("pointerleave", hide);
      hit.addEventListener("blur", hide);
    });
  }

  function renderLineChart(selector, input, options = {}) {
    const svg = $(`[data-chart="${selector}"]`);
    if (!svg) return;
    const values = (Array.isArray(input) ? input : []).map(item => typeof item === "number" ? { value: item } : item)
      .filter(item => Number.isFinite(Number(item.value)));
    if (values.length < 2) { chartEmpty(svg, options.empty || "No data"); return; }
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
    const zoneRect = (from, to, cls) => {
      const y1 = Math.max(pad.top, Math.min(height - pad.bottom, yFor(from)));
      const y2 = Math.max(pad.top, Math.min(height - pad.bottom, yFor(to)));
      return `<rect class="zone-band ${cls}" x="${pad.left}" y="${Math.min(y1, y2).toFixed(2)}" width="${chartW}" height="${Math.abs(y2 - y1).toFixed(2)}"></rect>`;
    };
    const zoneBands = options.zones === "availability"
      ? [zoneRect(maxValue, 98, "zone-ok"), zoneRect(98, 95, "zone-watch"), zoneRect(95, minValue, "zone-down")].join("") : "";
    const hitWidth = Math.min(chartW, Math.max(24, chartW / Math.max(1, values.length - 1)));
    const hitX = point => Math.max(pad.left, Math.min(width - pad.right - hitWidth, point.x - hitWidth / 2));
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
      ${zoneBands}
      ${gridLines.map(y => `<line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}"></line>`).join("")}
      ${targetY == null ? "" : `<line class="target-line" x1="${pad.left}" x2="${width - pad.right}" y1="${targetY}" y2="${targetY}"></line>`}
      <path class="area-fill" d="${fill}" fill="url(#${selector}-area)"></path>
      <path class="line-glow ${lineClass}" d="${line}" filter="url(#${selector}-glow)"></path>
      <path class="${lineClass}" d="${line}"></path>
      ${points.map(point => `<circle class="dot" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${point === points[points.length - 1] ? 4 : 2.8}"></circle>`).join("")}
      ${options.tooltip ? points.map(point => `<rect class="chart-hit" tabindex="0" x="${hitX(point).toFixed(2)}" y="${pad.top}" width="${hitWidth.toFixed(2)}" height="${chartH}"></rect>`).join("") : ""}
      <text class="axis-label" x="${pad.left}" y="${height - 8}" text-anchor="middle">${first.epoch ?? options.firstLabel ?? ""}</text>
      <text class="axis-label" x="${width - pad.right}" y="${height - 8}" text-anchor="middle">${last.epoch ?? options.lastLabel ?? "now"}</text>
      <text class="axis-label" x="${pad.left - 6}" y="${pad.top + 5}" text-anchor="end">${options.yTop ?? fmtAxis(maxValue)}</text>
      <text class="axis-label" x="${pad.left - 6}" y="${height - pad.bottom + 5}" text-anchor="end">${options.yBottom ?? fmtAxis(minValue)}</text>
    `;
    setupChartTooltip(svg, points, options, width, height);
  }

  function renderPerformanceChart(provider) {
    const svg = $('[data-chart="ftsoPerformance"]');
    if (!svg) return;
    const perf = hourlySeries(provider?.ftsoPerformance?.performance1h);
    const primary = hourlySeries(provider?.ftsoPerformance?.performance1_1h);
    const secondary = hourlySeries(provider?.ftsoPerformance?.performance2_1h);
    const len = Math.max(perf.length, primary.length, secondary.length);
    if (len < 2) { chartEmpty(svg, "No performance data"); return; }
    const width = 640;
    const height = 170;
    const pad = { top: 22, right: 20, bottom: 28, left: 36 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;
    const xFor = index => pad.left + (index / (len - 1)) * chartW;
    const yFor = value => pad.top + (1 - (value / 100)) * chartH;
    const makePoints = arr => arr.map((value, index) => ({ x: xFor(index), y: yFor(value), item: { value } }));
    const perfPoints = makePoints(perf);
    const makePath = arr => smoothPath(makePoints(arr));
    const gridLines = [0, 0.25, 0.5, 0.75, 1].map(step => pad.top + step * chartH);
    const hitWidth = Math.min(chartW, Math.max(24, chartW / Math.max(1, len - 1)));
    const hitX = point => Math.max(pad.left, Math.min(width - pad.right - hitWidth, point.x - hitWidth / 2));
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
      ${perfPoints.map(point => `<rect class="chart-hit" tabindex="0" x="${hitX(point).toFixed(2)}" y="${pad.top}" width="${hitWidth.toFixed(2)}" height="${chartH}"></rect>`).join("")}
      <text class="axis-label" x="${pad.left - 6}" y="${pad.top + 5}" text-anchor="end">100%</text>
      <text class="axis-label" x="${pad.left - 6}" y="${height - pad.bottom + 5}" text-anchor="end">0%</text>
      <text class="axis-label" x="${pad.left}" y="${height - 8}" text-anchor="middle">23h</text>
      <text class="axis-label" x="${width - pad.right}" y="${height - 8}" text-anchor="middle">now</text>
    `;
    setupPerformanceTooltip(svg, perf, primary, secondary, perfPoints, width, height);
  }

  function renderConditionHeatmap(provider) {
    const mount = $('[data-render="conditionHeatmap"]');
    if (!mount) return;
    const rows = [
      ["FTSO", function(item) { return item.ftsoScaling && item.ftsoScaling.conditionMet; }],
      ["Fast", function(item) { return item.fastUpdates && item.fastUpdates.conditionMet; }],
      ["FDC",  function(item) { return item.fdc && item.fdc.conditionMet; }],
      ["Stake",function(item) { return item.staking && item.staking.conditionMet; }]
    ];
    const history = (Array.isArray(provider && provider.epochData) ? provider.epochData : [])
      .slice().sort(function(a,b){ return Number(a.epoch||0)-Number(b.epoch||0); }).slice(-8);
    if (!history.length) { mount.innerHTML = '<span class="label">No data</span>'; return; }
    mount.style.setProperty("--condition-cols", String(history.length));
    const header = '<span class="condition-corner">Epoch</span>' +
      history.map(function(item){ return '<span class="condition-epoch">E'+(item.epoch||'-')+'</span>'; }).join('');
    const body = rows.map(function(row) {
      const label = row[0];
      const getter = row[1];
      const cells = history.map(function(item) {
        const val = getter(item);
        const cls = val === true ? 'ok' : val === false ? 'down' : 'unknown';
        const sym = val === true ? 'OK' : val === false ? 'X' : '?';
        return '<span class="condition-cell ' + cls + '" title="' + label + ' epoch ' + (item.epoch||'-') + '">' + sym + '</span>';
      }).join('');
      return '<span class="label">' + label + '</span>' + cells;
    }).join('');
    mount.innerHTML = header + body;
  }

  function renderUptimeStrip(values) {
    const mount = $('[data-render="uptimeStrip"]');
    if (!mount) return;
    const items = Array.isArray(values) && values.length ? values : [];
    if (!items.length) { mount.innerHTML = `<span class="source-pill">No uptime data</span>`; return; }
    const recent = items.slice(-6);
    mount.innerHTML = recent.map(value => {
      const pct = pctNumber(value);
      const cls = pct == null ? "down" : pct >= 99 ? "" : pct >= 95 ? "warn" : "down";
      return `<span class="uptime-pill ${cls}" title="${fmtPct(value)}"><strong>${fmtPct(value, 0)}</strong></span>`;
    }).join("");
  }

  function renderExpiryList(node) {
    const mount = $('[data-render="expiryList"]');
    if (!mount) return;
    const stake = Array.isArray(node?.m_axStake) ? node.m_axStake[0] : null;
    const delegations = (Array.isArray(node?.m_axDelegation) ? node.m_axDelegation : [])
      .map(item => ({ label: "Delegation", amount: Number(item.m_dAmount), end: item.m_xTimeEnd }))
      .filter(item => Number.isFinite(item.amount) && item.end);
    const items = [
      stake ? { label: "Self stake", amount: Number(stake.m_dAmount), end: stake.m_xTimeEnd } : null,
      ...delegations
    ].filter(Boolean).sort((a, b) => new Date(a.end).getTime() - new Date(b.end).getTime()).slice(0, 5);
    if (!items.length) { mount.innerHTML = `<span><em>No expiry data</em><b>-</b></span>`; return; }
    mount.innerHTML = items.map(item => `
      <span>
        <em>${escapeHtml(item.label)} - ${escapeHtml(fmtCompact(item.amount, " FLR"))}</em>
        <b>${escapeHtml(fmtUntil(item.end))} - ${escapeHtml(fmtShortDate(item.end))}</b>
      </span>
    `).join("");
  }

  function computeLevels(provider, latest, validator, nodeHealth, daemonPayload) {
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
    const daemonSummary = daemonSignalSummary(daemonPayload);

    // ââ NEW: Wallet balance alerts ââââââââââââââââââââââââââââââââââââââââââââ
    const balances = [
      state.walletBalances.submit,
      state.walletBalances.signature,
      state.walletBalances.policy
    ].filter(b => b != null);

    const alerts = [];
    let ftso = "ok";
    let fdc = "ok";
    let val = "ok";
    let nodeLevel = "ok";

    function add(level, title, text) { alerts.push({ level, title, text }); }

    // ââ NEW: Alert on low balances (from RPC, independent of Oracle Daemon) ââ
    if (state.sources.rpc === "ok" && balances.length > 0) {
      const minBal = Math.min(...balances);
      if (minBal < BALANCE_DOWN_FLR) {
        add("down", "Operational wallet critically low", `Minimum balance ${fmtNum(minBal, 1)} FLR â top up immediately.`);
      } else if (minBal < BALANCE_WARN_FLR) {
        add("warn", "Operational wallet low", `Minimum balance ${fmtNum(minBal, 1)} FLR â consider topping up.`);
      }
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
      if (fdcAvail != null && fdcAvail < 90) { fdc = "down"; add("down", "FDC availability critical", `${fmtPct(fdcAvail)} over recent window.`); }
      else if (fdcAvail != null && fdcAvail < 95) { fdc = "warn"; add("warn", "FDC availability watch", `${fmtPct(fdcAvail)} over recent window.`); }
      if (fdcCondition === false) { fdc = "down"; add("down", "FDC condition failed", "Latest FDC reward condition is false."); }
    }

    if (!validator || !node) {
      // ââ NEW: Use fallback validator data if Oracle Daemon missed âââââââââââ
      if (state.validatorFallback) {
        const fbUptime = pctNumber(state.validatorFallback.uptime);
        if (fbUptime != null && fbUptime < 95) { val = "down"; add("down", "Validator uptime critical", `${fmtPct(fbUptime)} (via ${state.validatorFallback.source}).`); }
        else if (fbUptime != null && fbUptime < 99) { val = "warn"; add("warn", "Validator uptime watch", `${fmtPct(fbUptime)} (via ${state.validatorFallback.source}).`); }
        else { add("warn", "Validator data partial", `Oracle Daemon down â using ${state.validatorFallback.source} fallback.`); }
      } else {
        val = "down";
        add("down", "Validator data missing", "Oracle Daemon validator data did not load.");
      }
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
      if (nodePercent != null && nodePercent < 90) { nodeLevel = "down"; add("down", "Validator reach critical", `${fmtPct(nodePercent)} of validator weight reachable.`); }
      else if (nodePercent != null && nodePercent < 95) { nodeLevel = nodeLevel === "down" ? nodeLevel : "warn"; add("warn", "Validator reach watch", `${fmtPct(nodePercent)} of validator weight reachable.`); }
      if (Number.isFinite(nodePeers) && nodePeers < 100) { nodeLevel = nodeLevel === "down" ? nodeLevel : "warn"; add("warn", "Low node peer count", `${nodePeers} connected peers.`); }
      if (Number.isFinite(nodeDisk) && nodeDisk < 50 * 1024 ** 3) { nodeLevel = "down"; add("down", "Disk space critical", `${fmtCompact(nodeDisk / 1024 ** 3, " GB")} available.`); }
      else if (Number.isFinite(nodeDisk) && nodeDisk < 100 * 1024 ** 3) { nodeLevel = nodeLevel === "down" ? nodeLevel : "warn"; add("warn", "Disk space watch", `${fmtCompact(nodeDisk / 1024 ** 3, " GB")} available.`); }
      if (Number.isFinite(lastMsg) && lastMsg > 10) { nodeLevel = nodeLevel === "down" ? nodeLevel : "warn"; add("warn", "No recent node messages", `${nodeHealth.checks.network.message.timeSinceLastMsgReceived} since last received message.`); }
      if (processingBlocks > 5) { nodeLevel = nodeLevel === "down" ? nodeLevel : "warn"; add("warn", "Consensus backlog", `${processingBlocks} processing blocks.`); }
    }

    if (daemonSummary.wired && daemonSummary.level !== "ok") {
      add(daemonSummary.level, "Private liveness", daemonSummary.meta);
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

  function renderRaw(provider, latest, validator, nodeHealth, explorer, explorerFtso, providerPayload, daemonPayload) {
    const mount = $('[data-render="rawDetails"]');
    if (!mount) return;
    const node = getNode(validator);
    const network = networkInfo(providerPayload);
    const fdcHours = hourlySeries(provider?.fdcPerformance?.availability1h);
    const fdc24h = recentAverage(fdcHours, 24);
    const fdc6h = recentAverage(fdcHours, 6);
    const payload = {
      network: {
        currentRewardEpoch: network?.m_iCurrentRewardEpoch ?? state.epochFallback?.currentEpoch,
        rewardEpochEnd: network?.m_xRewardEpochEndTime ?? state.epochFallback?.epochEndTime,
        epochSource: network ? "Oracle Daemon" : (state.epochFallback?.source || "unavailable"),
        oracleTimestamp: providerTimestamp(providerPayload),
        rewardVotePowerBlock: network?.m_iRewardEpochVotePowerBlock
      },
      walletBalances: {
        source: state.walletBalances.source || "not fetched",
        rpcSource: state.sources.rpc,
        submit: state.walletBalances.submit != null ? `${fmtNum(state.walletBalances.submit, 2)} FLR` : "unavailable",
        signature: state.walletBalances.signature != null ? `${fmtNum(state.walletBalances.signature, 2)} FLR` : "unavailable",
        policy: state.walletBalances.policy != null ? `${fmtNum(state.walletBalances.policy, 2)} FLR` : "unavailable"
      },
      validatorFallback: state.validatorFallback || null,
      provider: {
        matchedBy: provider?.voterAddress === TARGET.voter ? "voterAddress" : "name",
        topLevelName: provider?.dataProviderName,
        voterAddress: provider?.voterAddress,
        delegationAddress: provider?.delegationAddress,
        submitAddress: provider?.submitAddress,
        submitAddressBalance: provider?.submitAddressBalance,
        latestEpoch: latest?.epoch,
        totalEpochs: provider?.totalEpochs,
        eligibleEpochs: provider?.eligibleEpochs
      },
      fdcProviderOnly: {
        source: "Oracle Daemon provider payload",
        availabilityNow: provider?.fdcPerformance?.availability != null ? fmtPct(provider.fdcPerformance.availability) : "unavailable",
        availability6h: fdc6h != null ? fmtPct(fdc6h) : "unavailable",
        availability24h: fdc24h != null ? fmtPct(fdc24h) : "unavailable",
        latestEpoch: latest?.epoch,
        latestCondition: latest?.fdc?.conditionMet,
        epochParticipation: latest?.fdc?.participationPercentage != null ? fmtPct(latest.fdc.participationPercentage) : "unavailable",
        rewardedRounds: latest?.fdc?.rewardedVotingRounds != null && latest?.fdc?.totalRewardedVotingRounds != null
          ? `${fmtNum(latest.fdc.rewardedVotingRounds, 0)} / ${fmtNum(latest.fdc.totalRewardedVotingRounds, 0)}`
          : "unavailable"
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
        lastMessageReceived: nodeHealth?.checks?.network?.message?.timeSinceLastMsgReceived,
        diskBytes: nodeHealth?.checks?.diskspace?.message?.availableDiskBytes
      },
      sources: { ...state.sources },
      sourceLoadedAt: Object.fromEntries(
        Object.entries(state.sourceLoadedAt).map(([k, v]) => [k, v ? v.toISOString() : null])
      )
    };
    mount.textContent = JSON.stringify(payload, null, 2);
  }

  function applyData(provider, validator, explorer, explorerFtso, nodeHealth, providerPayload, daemonPayload) {
    const latest = latestEpoch(provider);
    const node = getNode(validator);
    const network = networkInfo(providerPayload);
    const oracleTime = providerTimestamp(providerPayload);
    const levels = computeLevels(provider, latest, validator, nodeHealth, daemonPayload);
    const nodeHealthTime = nodeHealthTimestamp(nodeHealth);
    const daemonSummary = daemonSignalSummary(daemonPayload);
    const hostSummary = hostSignalSummary(daemonPayload);
    const feedSummary = feedSignalSummary(daemonPayload);
    const overall = worstLevel([levels.ftso, levels.fdc, levels.validator, levels.node]);

    $$(".mobile-health, .desktop-health").forEach(el => { el.dataset.overallState = overall; });
    setText("overallLabel", overall === "ok" ? "Primary checks nominal" : overall === "warn" ? "Watch required" : "Action required");
    setText("overallTitle", overall === "ok" ? "Primary OK" : overall === "warn" ? "Watch" : "Act now");
    setText("freshness", state.lastLoadedAt ? `${fmtAge(state.lastLoadedAt)} ago` : "-");

    // ââ Reward epoch: primary from Oracle Daemon, fallback from Flare Metrics/RPC
    const currentEpoch = network?.m_iCurrentRewardEpoch ?? state.epochFallback?.currentEpoch;
    const epochEnds = network?.m_xRewardEpochEndTime ?? state.epochFallback?.epochEndTime;
    setText("currentRewardEpoch", currentEpoch != null ? `E${currentEpoch}` : "-");
    setText("latestCompletedEpoch", latest?.epoch != null ? `E${latest.epoch}` : currentEpoch != null ? `E${currentEpoch - 1}` : "-");
    setText("rewardEpochEnds", epochEnds ? fmtUntil(epochEnds) : "-");

    const oracleAge = oracleTime ? fmtAge(new Date(oracleTime)) : null;
    setText("oraclePayloadAge", oracleAge ? `${oracleAge} old` : "-");
    setText("nodeHealthAge", nodeHealthTime ? `${fmtAge(nodeHealthTime)} old` : "-");
    setText("daemonLiveness", daemonSummary.title);
    setText("daemonLivenessMeta", daemonSummary.meta);

    const oracleDate = oracleTime ? new Date(oracleTime) : null;
    const oracleAgeMs = oracleDate && Number.isFinite(oracleDate.getTime()) ? Date.now() - oracleDate.getTime() : null;
    const nodeAgeMs = nodeHealthTime ? timestampAgeMs(nodeHealthTime) : null;
    setToneCard("oracleFreshness", oracleAgeMs == null ? "watch" : oracleAgeMs > 5 * 60_000 ? "watch" : "ok");
    setToneCard("nodeFreshness", state.sources.node !== "ok" ? "down" : nodeAgeMs == null || nodeAgeMs > 2 * 60_000 ? "watch" : "ok");
    setToneCard("daemonFreshness", daemonSummary.level);

    const ftsoAvailabilityHours = hourlySeries(provider?.ftsoPerformance?.availability1h);
    const fdcAvailabilityHours = hourlySeries(provider?.fdcPerformance?.availability1h);
    const ftsoPerformanceHours = hourlySeries(provider?.ftsoPerformance?.performance1h);
    const ftsoPrimaryHours = hourlySeries(provider?.ftsoPerformance?.performance1_1h);
    const ftsoSecondaryHours = hourlySeries(provider?.ftsoPerformance?.performance2_1h);
    const fseAvailability6h = explorerFtsoMetric(explorerFtso, "last_6h", "availability");
    const fseAvailability24h = explorerFtsoMetric(explorerFtso, "last_24h", "availability");
    const fsePrimary6h = explorerFtsoMetric(explorerFtso, "last_6h", "primary");
    const fseSecondary6h = explorerFtsoMetric(explorerFtso, "last_6h", "secondary");
    const fsePrimary24h = explorerFtsoMetric(explorerFtso, "last_24h", "primary");
    const fseSecondary24h = explorerFtsoMetric(explorerFtso, "last_24h", "secondary");
    const fse6Count = [fseAvailability6h, fsePrimary6h, fseSecondary6h].filter(value => value != null).length;
    const fse24Count = [fseAvailability24h, fsePrimary24h, fseSecondary24h].filter(value => value != null).length;
    const ftsoSource6h = windowSourceLabel(fse6Count, 3, 6);
    const ftsoSource24h = windowSourceLabel(fse24Count, 3, 24);
    const ftsoAvailability6h = metricWithFallback(fseAvailability6h, ftsoAvailabilityHours, 6);
    const ftsoAvailability24h = metricWithFallback(fseAvailability24h, ftsoAvailabilityHours, 24);
    const ftsoPrimary6h = metricWithFallback(fsePrimary6h, ftsoPrimaryHours, 6);
    const ftsoSecondary6h = metricWithFallback(fseSecondary6h, ftsoSecondaryHours, 6);
    const ftsoPrimary24h = metricWithFallback(fsePrimary24h, ftsoPrimaryHours, 24);
    const ftsoSecondary24h = metricWithFallback(fseSecondary24h, ftsoSecondaryHours, 24);

    setStatusCard("ftsoStatus", levels.ftso, levels.ftso === "ok" ? "OK" : levels.ftso === "warn" ? "WARN" : "DOWN", latest ? `E${latest.epoch || "-"}` : "missing");
    const fdcRecent = recentAverage(fdcAvailabilityHours, 3);
    const fdcStatusValue = fdcRecent != null ? fmtPct(fdcRecent) : provider?.fdcPerformance?.availability != null ? fmtPct(provider.fdcPerformance.availability) : levels.fdc === "down" ? "DOWN" : "-";
    setStatusCard("fdcStatus", levels.fdc, fdcStatusValue, "3h avg");
    setStatusCard("validatorStatus", levels.validator, levels.validator === "ok" ? "OK" : levels.validator === "warn" ? "WARN" : "DOWN", node?.m_bConnected === true ? "connected" : state.validatorFallback ? "fallback" : "offline");
    setStatusCard("nodeStatus", levels.node, levels.node === "ok" ? "OK" : levels.node === "warn" ? "WARN" : "DOWN", nodeHealthTime ? `${fmtAge(nodeHealthTime)} old` : nodeHealth?.healthy ? "healthy" : "unhealthy");

    const policy = explorer?.denormalizedsigningpolicy || {};
    const reward = Number(latest?.totalRewardAmount);
    const passes = Number(latest?.passes ?? latest?.newNumberOfPasses);
    const conditionOk = [latest?.ftsoScaling?.conditionMet, latest?.fastUpdates?.conditionMet, latest?.fdc?.conditionMet, latest?.staking?.conditionMet].filter(value => value === true).length;

    setText("latestEpoch", latest?.epoch ? `Epoch ${latest.epoch}` : "Epoch -");
    setText("latestReward", Number.isFinite(reward) ? fmtCompact(reward, "") : "-");
    setText("latestEligibility", latest?.eligibleForReward === true ? "eligible" : latest?.eligibleForReward === false ? "not eligible" : "eligibility -");
    setText("rewardRate", latest?.m_dRewardRate != null ? fmtPct(latest.m_dRewardRate) : "-");
    setText("ftsoPerformance", provider?.ftsoPerformance?.performance != null ? fmtPct(provider.ftsoPerformance.performance) : "-");
    setText("ftsoPrimary", provider?.ftsoPerformance?.performance1 != null ? fmtPct(provider.ftsoPerformance.performance1) : "-");
    setText("ftsoSecondary", provider?.ftsoPerformance?.performance2 != null ? fmtPct(provider.ftsoPerformance.performance2) : "-");
    setText("ftsoAvailability", provider?.ftsoPerformance?.availability != null ? fmtPct(provider.ftsoPerformance.availability) : "-");
    setText("ftsoAvailability6h", fmtOptionalPct(ftsoAvailability6h));
    setText("ftsoAvailability24h", fmtOptionalPct(ftsoAvailability24h));
    setText("ftsoPrimary6h", fmtOptionalPct(ftsoPrimary6h));
    setText("ftsoSecondary6h", fmtOptionalPct(ftsoSecondary6h));
    setText("ftsoPrimary24h", fmtOptionalPct(ftsoPrimary24h));
    setText("ftsoSecondary24h", fmtOptionalPct(ftsoSecondary24h));
    setText("ftso6hSource", ftsoSource6h);
    setText("ftso24hSource", ftsoSource24h);

    const fdcAvailability6h = recentAverage(fdcAvailabilityHours, 6);
    const fdcAvailability24h = recentAverage(fdcAvailabilityHours, 24);
    const fdcSource6h = oracleAverageSource(fdcAvailabilityHours, 6);
    const fdcSource24h = oracleAverageSource(fdcAvailabilityHours, 24);
    setText("fdcAvailabilityNow", provider?.fdcPerformance?.availability != null ? fmtPct(provider.fdcPerformance.availability) : "-");
    setText("fdcAvailability6h", fmtOptionalPct(fdcAvailability6h));
    setText("fdcAvailability", fdcAvailability24h != null ? fmtPct(fdcAvailability24h) : provider?.fdcPerformance?.availability != null ? fmtPct(provider.fdcPerformance.availability) : "-");
    setText("fdcParticipation", latest?.fdc?.participationPercentage != null ? fmtPct(latest.fdc.participationPercentage) : "-");
    setText("fdcConditionStatus", latest?.fdc?.conditionMet === true ? "OK" : latest?.fdc?.conditionMet === false ? "Failed" : "-");
    setText("fdc6hSource", fdcSource6h);
    setText("fdc24hSource", fdcAvailability24h != null ? fdcSource24h : "Oracle current");
    setText("fdcEpochSource", latest?.epoch != null ? `E${latest.epoch}` : "latest epoch");
    setText("conditionPasses", Number.isFinite(passes) ? `${passes}/3` : `${conditionOk}/4`);
    setText("conditionsLabel", `${conditionOk}/4 latest checks`);
    setText("preRegistered", provider?.isPreRegistered === true ? "Yes" : provider?.isPreRegistered === false ? "No" : "-");
    setText("ftsoHits", latest?.ftsoScaling?.totalHits != null && latest?.ftsoScaling?.allPossibleHits != null ? `${fmtNum(latest.ftsoScaling.totalHits, 0)} / ${fmtNum(latest.ftsoScaling.allPossibleHits, 0)}` : "-");
    setText("ftsoHitPct", latest?.ftsoScaling?.hitPercentage != null ? fmtPct(latest.ftsoScaling.hitPercentage) : "-");
    setText("fastUpdates", latest?.fastUpdates?.updates != null && latest?.fastUpdates?.expectedUpdates != null ? `${fmtNum(latest.fastUpdates.updates, 0)} / ${fmtNum(latest.fastUpdates.expectedUpdates, 0)}` : "-");
    setText("fdcRounds", latest?.fdc?.rewardedVotingRounds != null && latest?.fdc?.totalRewardedVotingRounds != null ? `${fmtNum(latest.fdc.rewardedVotingRounds, 0)} / ${fmtNum(latest.fdc.totalRewardedVotingRounds, 0)}` : "-");
    setText("stakingCondition", latest?.staking?.conditionMet === true ? "OK" : latest?.staking?.conditionMet === false ? "Failed" : "-");

    // Adaptive health colours: rolling metrics use their 24h baseline, while
    // epoch metrics use up to the latest 52 epochs (roughly six months).
    const epochHistory = (Array.isArray(provider?.epochData) ? provider.epochData : [])
      .slice()
      .sort((a, b) => Number(a?.epoch || 0) - Number(b?.epoch || 0))
      .slice(-52);
    const recentEpochs = epochHistory.slice(-12);
    const performanceMedian24h = median(ftsoPerformanceHours);
    const primaryMedian24h = median(ftsoPrimaryHours);
    const secondaryMedian24h = median(ftsoSecondaryHours);
    const rewardRateMedian12 = median(recentEpochs.map(item => item?.m_dRewardRate));
    const rewardMedian12 = median(recentEpochs.map(item => item?.totalRewardAmount));
    const fdcMedian6m = median(epochHistory.map(item => item?.fdc?.participationPercentage));
    const hitMedian6m = median(epochHistory.map(item => item?.ftsoScaling?.hitPercentage));

    const performanceOk = Math.max(55, (performanceMedian24h ?? 65) * 0.9);
    const performanceWarn = Math.max(40, (performanceMedian24h ?? 65) * 0.7);
    const primaryOk = Math.max(18, (primaryMedian24h ?? 25) * 0.85);
    const primaryWarn = Math.max(10, (primaryMedian24h ?? 25) * 0.55);
    const secondaryOk = Math.max(82, (secondaryMedian24h ?? 90) * 0.92);
    const secondaryWarn = Math.max(70, (secondaryMedian24h ?? 90) * 0.78);
    const rewardRateOk = Math.max(3, (rewardRateMedian12 ?? 3.75) * 0.8);
    const rewardRateWarn = Math.max(2, (rewardRateMedian12 ?? 3.75) * 0.55);
    const rewardOk = (rewardMedian12 ?? 45_000) * 0.75;
    const rewardWarn = (rewardMedian12 ?? 45_000) * 0.4;
    const fdcEpochOk = Math.max(88, (fdcMedian6m ?? 91) * 0.95);
    const fdcEpochWarn = Math.max(75, (fdcMedian6m ?? 91) * 0.8);
    const hitOk = Math.max(99, (hitMedian6m ?? 99.7) - 0.5);

    setMetricTone("ftsoPerformance", higherIsBetterTone(pctNumber(provider?.ftsoPerformance?.performance), performanceOk, performanceWarn), `Normal >= ${fmtPct(performanceOk)}`);
    setMetricTone("ftsoPrimary", higherIsBetterTone(pctNumber(provider?.ftsoPerformance?.performance1), primaryOk, primaryWarn), `Normal >= ${fmtPct(primaryOk)}`);
    setMetricTone("ftsoSecondary", higherIsBetterTone(pctNumber(provider?.ftsoPerformance?.performance2), secondaryOk, secondaryWarn), `Normal >= ${fmtPct(secondaryOk)}`);
    setMetricTone("ftsoAvailability", higherIsBetterTone(pctNumber(provider?.ftsoPerformance?.availability), 98, 95), "Normal >= 98%");
    setMetricTone("ftsoAvailability6h", higherIsBetterTone(ftsoAvailability6h, 98, 95), "Normal >= 98%");
    setMetricTone("ftsoAvailability24h", higherIsBetterTone(ftsoAvailability24h, 98, 95), "Normal >= 98%");
    setMetricTone("ftsoPrimary6h", higherIsBetterTone(ftsoPrimary6h, primaryOk, primaryWarn), `Normal >= ${fmtPct(primaryOk)}`);
    setMetricTone("ftsoSecondary6h", higherIsBetterTone(ftsoSecondary6h, secondaryOk, secondaryWarn), `Normal >= ${fmtPct(secondaryOk)}`);
    setMetricTone("ftsoPrimary24h", higherIsBetterTone(ftsoPrimary24h, primaryOk, primaryWarn), `Normal >= ${fmtPct(primaryOk)}`);
    setMetricTone("ftsoSecondary24h", higherIsBetterTone(ftsoSecondary24h, secondaryOk, secondaryWarn), `Normal >= ${fmtPct(secondaryOk)}`);
    setMetricTone("fdcAvailabilityNow", higherIsBetterTone(pctNumber(provider?.fdcPerformance?.availability), 97, 90), "Normal >= 97%");
    setMetricTone("fdcAvailability6h", higherIsBetterTone(fdcAvailability6h, 97, 90), "Normal >= 97%");
    setMetricTone("fdcAvailability", higherIsBetterTone(fdcAvailability24h ?? pctNumber(provider?.fdcPerformance?.availability), 97, 90), "Normal >= 97%");
    setMetricTone("fdcParticipation", higherIsBetterTone(pctNumber(latest?.fdc?.participationPercentage), fdcEpochOk, fdcEpochWarn), `Six-month median ${fmtPct(fdcMedian6m)}`);
    setMetricTone("conditionPasses", Number.isFinite(passes) ? higherIsBetterTone(passes, 3, 2) : higherIsBetterTone(conditionOk, 4, 3), "All required conditions should pass");
    setMetricTone("preRegistered", provider?.isPreRegistered === true ? "ok" : provider?.isPreRegistered === false ? "down" : "warn");
    setMetricTone("rewardRate", higherIsBetterTone(latest?.m_dRewardRate, rewardRateOk, rewardRateWarn), `Recent 12-epoch median ${fmtPct(rewardRateMedian12)}`);
    setMetricTone("latestReward", higherIsBetterTone(reward, rewardOk, rewardWarn), `Recent 12-epoch median ${fmtCompact(rewardMedian12, " FLR")}`);
    setMetricTone("ftsoHitPct", higherIsBetterTone(pctNumber(latest?.ftsoScaling?.hitPercentage), hitOk, 97), `Six-month median ${fmtPct(hitMedian6m)}`);
    setMetricTone("fdcConditionStatus", latest?.fdc?.conditionMet === true ? "ok" : latest?.fdc?.conditionMet === false ? "down" : "warn");
    setMetricTone("stakingCondition", latest?.staking?.conditionMet === true ? "ok" : latest?.staking?.conditionMet === false ? "down" : "warn");

    // ââ Wallet balances: RPC-fetched live values (independent of Oracle Daemon)
    const rpcSubmit = state.walletBalances.submit;
    const rpcSignature = state.walletBalances.signature;
    const rpcPolicy = state.walletBalances.policy;
    // Fallback to Oracle Daemon values if RPC unavailable
    const submitBal = rpcSubmit ?? Number(provider?.submitAddressBalance);
    const sigBal = rpcSignature ?? Number(provider?.submitSignatureAddressBalance);
    const policyBal = rpcPolicy ?? Number(provider?.signingPolicyAddressBalance);
    const fastBalances = Array.isArray(provider?.fastUpdatesAddresses)
      ? provider.fastUpdatesAddresses.map(item => Number(item.balance)).filter(Number.isFinite)
      : [];
    const allBalances = [submitBal, sigBal, policyBal, ...fastBalances].filter(b => Number.isFinite(b) && b > 0);
    const minBalance = allBalances.length ? Math.min(...allBalances) : null;
    const balanceTone = minBalance == null ? "watch" : minBalance < BALANCE_DOWN_FLR ? "down" : minBalance < BALANCE_WARN_FLR ? "watch" : "ok";
    const balanceSourceLabel = state.sources.rpc === "ok" ? ` - via ${state.walletBalances.source || "RPC"}` : "";
    setText("balanceStatus", minBalance == null ? "-" : balanceTone === "ok" ? `OK${balanceSourceLabel}` : `LOW${balanceSourceLabel}`);
    setText("submitBalance", Number.isFinite(submitBal) ? fmtCompact(submitBal, " FLR") : "-");
    setText("signatureBalance", Number.isFinite(sigBal) ? fmtCompact(sigBal, " FLR") : "-");
    setText("policyBalance", Number.isFinite(policyBal) ? fmtCompact(policyBal, " FLR") : "-");
    setText("fastBalanceMin", fastBalances.length ? fmtCompact(Math.min(...fastBalances), " FLR") : minBalance != null ? fmtCompact(minBalance, " FLR") : "-");
    $$(".balance-card").forEach(el => { el.dataset.tone = balanceTone; });

    // ââ Validator section: primary from Oracle Daemon, fallback from Flare Metrics
    const uptimeValues = Array.isArray(node?.m_adUptime) ? node.m_adUptime : [];
    const uptimeAvg = uptimeValues.length
      ? uptimeValues.reduce((sum, value) => sum + Number(value || 0), 0) / uptimeValues.length
      : pctNumber(state.validatorFallback?.uptime);
    const stake = Array.isArray(node?.m_axStake) ? node.m_axStake[0] : null;
    const timeLeft = Array.isArray(stake?.m_aiTimeLeftDHM) ? `${stake.m_aiTimeLeftDHM[0]}d ${stake.m_aiTimeLeftDHM[1]}h` : "-";
    const capacity = Number(validator?.m_dTotal ?? state.validatorFallback?.stake);
    const freeSpace = Number(validator?.m_dFreeDelegationSpace ?? state.validatorFallback?.freeSpace);
    const capacityMax = capacity + freeSpace;
    const capacityPct = capacityMax > 0 ? (capacity / capacityMax) * 100 : 0;
    const selfBond = Number(validator?.m_dTotalStake ?? stake?.m_dAmount);
    const delegatedStake = Number.isFinite(capacity) && Number.isFinite(selfBond) ? Math.max(0, capacity - selfBond) : pctNumber(state.validatorFallback?.delegated);

    setText("validatorVersion", node?.m_sVersion ? String(node.m_sVersion).replace(/^avalanchego\//, "v") : "v-");
    setText("validatorConnected", node?.m_bConnected === true ? "Connected" : node?.m_bConnected === false ? "Offline" : state.validatorFallback ? `via ${state.validatorFallback.source}` : "-");
    setText("validatorLastSeen", node?.m_sLastSeen ? `last seen ${node.m_sLastSeen}` : "last seen -");
    setText("validatorLastSeenShort", node?.m_sLastSeen ? node.m_sLastSeen.replace(/\.\d+$/, "") : "-");
    setText("nodeHealthy", nodeHealth?.healthy === true ? "Healthy" : nodeHealth ? "Unhealthy" : "-");
    setText("nodePeers", nodeHealth?.checks?.network?.message?.connectedPeers != null ? `${nodeHealth.checks.network.message.connectedPeers} peers` : "peers -");
    setText("validatorUptime", Number.isFinite(uptimeAvg) ? fmtPct(uptimeAvg) : "-");
    setText("validatorApr", Number.isFinite(estimateValidatorApr(node)) ? fmtPct(estimateValidatorApr(node)) : "-");
    setText("validatorStake", capacity > 0 ? fmtCompact(capacity, " FLR") : validator?.m_dTotal != null ? fmtCompact(validator.m_dTotal, " FLR") : "-");
    setText("validatorStakeMeta", timeLeft !== "-" ? `stake ends in ${timeLeft}` : "self + delegation");
    setText("freeSpace", freeSpace > 0 ? fmtCompact(freeSpace, " FLR") : validator?.m_dFreeDelegationSpace != null ? fmtCompact(validator.m_dFreeDelegationSpace, " FLR") : "-");
    setText("selfBond", Number.isFinite(selfBond) ? fmtCompact(selfBond, " FLR") : "3M FLR");
    setText("delegatedStake", delegatedStake != null ? fmtCompact(delegatedStake, " FLR") : "-");
    setText("stakeEnds", Array.isArray(stake?.m_aiTimeLeftDHM) ? `${stake.m_aiTimeLeftDHM[0]}d` : state.validatorFallback?.endTime ? fmtUntil(state.validatorFallback.endTime) : "-");
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
    const daysLeft = Array.isArray(stake?.m_aiTimeLeftDHM) ? Number(stake.m_aiTimeLeftDHM[0]) : null;
    const lastSeenSeconds = parseDurationSeconds(node?.m_sLastSeen);
    const capacityTone = lowerIsBetterTone(capacityPct, 80, 95);
    setMetricTone("validatorConnected", node?.m_bConnected === true ? "ok" : node?.m_bConnected === false ? "down" : "warn");
    setMetricTone("validatorUptime", higherIsBetterTone(uptimeAvg, 99, 95), "Normal >= 99%");
    setMetricTone("stakeEnds", daysLeft == null ? "" : higherIsBetterTone(daysLeft, 14, 7), "Green >= 14 days remaining");
    setMetricTone("capacityPct", capacityTone, "Green below 80% capacity");
    setMetricTone("validatorStake", capacityTone, "Colour follows validator capacity");
    setMetricTone("delegatedStake", capacityTone, "Colour follows validator capacity");
    setMetricTone("freeSpace", capacityTone, "Colour follows validator capacity");
    setMetricTone("capacityText", capacityTone, "Green below 80% capacity");
    setMetricTone("nodePeers", higherIsBetterTone(nodeHealth?.checks?.network?.message?.connectedPeers, 100, 50), "Normal >= 100 peers");
    setMetricTone("nodeNetwork", higherIsBetterTone(pctNumber(percentConnected), 95, 90), "Validator-weight reach: green >= 95%, watch >= 90%");
    setMetricTone("nodeDisk", Number.isFinite(diskBytes) ? higherIsBetterTone(diskBytes / 1024 ** 3, 100, 50) : "", "Green >= 100 GB free");
    setMetricTone("validatorLastSeenShort", lastSeenSeconds == null ? "" : lowerIsBetterTone(lastSeenSeconds, 60, 180), "Green <= 60 seconds");
    setSignal("daemonSignalStatus", daemonSummary.title, daemonSummary.level);
    setText("daemonSignalMeta", daemonSummary.meta);
    setSignal("fdcSignalStatus", daemonSummary.fdcTitle, daemonSummary.fdcLevel);
    setText("fdcSignalMeta", daemonSummary.fdcMeta);
    setSignal("hostSignalStatus", hostSummary.title, hostSummary.level);
    setText("hostSignalMeta", hostSummary.meta);
    setSignal("feedSignalStatus", feedSummary.title, feedSummary.level);
    setText("feedSignalMeta", feedSummary.meta);

    setText("oracleSource", state.sources.provider === "ok" && state.sources.validator === "ok" ? "OK" : state.sources.provider === "down" || state.sources.validator === "down" ? "DOWN" : "WARN");
    setText("oracleSourceMeta", "providers + validators");
    setText("explorerSource", state.sources.explorer === "ok" ? "OK" : state.sources.explorer === "warn" ? "BLOCKED" : "DOWN");
    const policyEpoch = policy.reward_epoch ?? policy.rewardEpoch;
    setText("explorerSourceMeta", explorerFtso ? "FTSO 6h/24h windows" : policyEpoch ? `policy E${policyEpoch}` : state.sources.explorer === "warn" ? "direct browser fetch blocked" : "entity policy");
    setText("nodeSource", state.sources.node === "ok" ? "OK" : "DOWN");
    setText("nodeSourceMeta", nodeHealthTime ? `health ${fmtAge(nodeHealthTime)} old` : nodeHealth?.checks?.network?.message?.connectedPeers != null ? `${nodeHealth.checks.network.message.connectedPeers} peers` : "self health");

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

    renderLineChart("ftsoRewards", ftsoRewards, { empty: "No reward data", zeroBase: true, yBottom: "0", tooltip: "reward", metricLabel: "FTSO reward" });
    renderLineChart("ftsoAvailability", ftsoAvailabilityHours, { min: 90, max: 100, target: 98, zones: "availability", tooltip: "availability", metricLabel: "FTSO availability", empty: "No FTSO availability", yTop: "100%", yBottom: "90%", firstLabel: "23h ago", lastLabel: "now" });
    renderLineChart("fdcAvailability", fdcAvailabilityHours, { min: 90, max: 100, target: 98, zones: "availability", tooltip: "availability", metricLabel: "FDC availability", empty: "No FDC availability", yTop: "100%", yBottom: "90%", firstLabel: "23h ago", lastLabel: "now" });
    renderPerformanceChart(provider);
    renderConditionHeatmap(provider);
    renderLineChart("validatorRewards", validatorRewards, { empty: "No validator rewards", zeroBase: true, yBottom: "0", lineClass: "line-green" });
    renderUptimeStrip(uptimeValues);
    renderExpiryList(node);
    renderRaw(provider, latest, validator, nodeHealth, explorer, explorerFtso, providerPayload, daemonPayload);
  }

  // ââ MAIN LOAD ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  async function loadAll() {
    document.body.classList.add("is-refreshing");
    setText("refreshLabel", "Loading");

    // Fetch primary + fallback sources in parallel
    const [sourceResults] = await Promise.all([
      Promise.allSettled([
        fetchJson(ENDPOINTS.providersV2),
        fetchJson(ENDPOINTS.validators),
        fetchJson(ENDPOINTS.explorerEntity),
        fetchJson(ENDPOINTS.explorerFtso),
        fetchJson(ENDPOINTS.nodeHealth),
        fetchJson(ENDPOINTS.daemonStatus, 2_500)
      ])
    ]);

    let providerPayload = sourceResults[0].status === "fulfilled" ? sourceResults[0].value : null;
    let validatorPayload = sourceResults[1].status === "fulfilled" ? sourceResults[1].value : null;
    let explorer = sourceResults[2].status === "fulfilled" ? sourceResults[2].value : null;
    let explorerFtso = sourceResults[3].status === "fulfilled" ? sourceResults[3].value : null;
    let nodeHealth = sourceResults[4].status === "fulfilled" ? sourceResults[4].value : null;
    let daemonPayload = sourceResults[5].status === "fulfilled" ? sourceResults[5].value : null;

    state.sourceLoadedAt.provider = providerPayload ? new Date() : null;
    state.sourceLoadedAt.validator = validatorPayload ? new Date() : null;
    state.sourceLoadedAt.explorer = explorer ? new Date() : null;
    state.sourceLoadedAt.explorerFtso = explorerFtso ? new Date() : null;
    state.sourceLoadedAt.node = nodeHealth ? new Date() : null;
    state.sourceLoadedAt.daemon = daemonPayload ? new Date() : null;

    let provider = providerPayload ? findDeep(providerPayload, isMirProvider) : null;

    if (!provider) {
      try {
        providerPayload = await fetchJson(ENDPOINTS.providersV1);
        state.sourceLoadedAt.provider = new Date();
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
    setSource("explorer", explorer || explorerFtso ? "ok" : "warn");
    setSource("explorerFtso", explorerFtso ? "ok" : "warn");
    setSource("node", nodeHealth ? "ok" : "down");
    setSource("daemon", daemonPayload ? "ok" : "public-only");

    // ââ NEW: Fire supplementary fetches in parallel (non-blocking) ââââââââââââ
    // These enrich the page but don't block the initial render
    Promise.allSettled([
      fetchWalletBalances(provider),
      !networkInfo(providerPayload) ? fetchEpochFallback() : Promise.resolve(),
      !validator ? fetchValidatorFallback() : Promise.resolve()
    ]).then(() => {
      // Re-render with enriched data once supplementary sources return
      applyData(provider, validator, explorer, explorerFtso, nodeHealth, providerPayload, daemonPayload);
    });

    state.lastLoadedAt = new Date();
    state.data = { provider, validator, explorer, explorerFtso, nodeHealth, providerPayload, daemonPayload };
    applyData(provider, validator, explorer, explorerFtso, nodeHealth, providerPayload, daemonPayload);
    // Show per-source error state if any source failed after 10s
    if (!provider || !validator || !nodeHealth) {
      const mount = document.querySelector('[data-render="alerts"]');
      const sources = [
        !provider ? 'WARN Oracle Daemon provider unavailable' : null,
        !validator ? 'WARN Oracle Daemon validator unavailable' : null,
        !nodeHealth ? 'WARN Node health endpoint unavailable' : null
      ].filter(Boolean);
      if (mount && sources.length) {
        const existing = mount.querySelector('.alert-item.down, .alert-item.warn');
        if (!existing) {
          mount.innerHTML = sources.map(s => `<article class="alert-item warn"><b>Source error</b><span>${s}</span></article>`).join('') + mount.innerHTML;
        }
      }
    }
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
      if (distance > 90) { armed = false; loadAll(); }
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
