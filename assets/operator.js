const MirSFlr = (() => {
  const API_URL = "https://api.oracle-daemon.com/v1/flare/providers";
  const VALIDATORS_URL = "https://api.oracle-daemon.com/v1/flare/validators";
  const PROVIDERS_V2_URL = "https://api.oracle-daemon.com/v2/flare/providers";
  const FLR_PRICE_URL = "https://api.coinbase.com/v2/prices/FLR-USD/spot";
  const FLR_PRICE_EUR_URL = "https://api.coinbase.com/v2/prices/FLR-EUR/spot";
  const CACHE_PREFIX = "mirsflr_cache_";
  const CURRENCY_KEY = "mirsflr_currency";
  const CACHE_TTLS = {
    provider: 60_000,
    validator: 90_000,
    explorer: 90_000,
    price: 5 * 60_000
  };
  const TARGET_VOTER = "0xb5a081dec72c8c87256b7e14cfadcbc342bdeac3";
  const TARGET_VOTER_CHECKSUM = "0xb5A081dEc72c8C87256b7e14cFAdcbc342bDeac3";
  const FTSO_EXPLORER_URL = `https://flare-systems-explorer.flare.network/backend-url/api/v0/entity/${TARGET_VOTER_CHECKSUM}/ftso`;
  const FTSO_ENTITY_URL = `https://flare-systems-explorer.flare.network/backend-url/api/v0/entity/${TARGET_VOTER_CHECKSUM}`;
  const FTSO_ENTITY_SNAPSHOT = {
    denormalizedsigningpolicy: {
      reward_epoch: 403,
      delegation_fee_bips: 2000,
      w_nat_weight: "500064431770537519626378286",
      w_nat_capped_weight: "500064431770537519626378286",
      staking_weight: "20376514597507581000000000",
      weight: "520440946368045100626378286"
    }
  };
  const FTSO_UPTIME_SNAPSHOT = [
    { reward_epoch_id: 392, availability: 1.0 },
    { reward_epoch_id: 393, availability: 0.999702380952381 },
    { reward_epoch_id: 394, availability: 1.0 },
    { reward_epoch_id: 395, availability: 1.0 }
  ];
  const TARGET_DELEGATION = "0xad9105bef5e5df2eacbe2de9037a96695b00cade";
  const CONTACT_EMAIL = "mirsven@icloud.com";
  let providerData = null;
  let validatorData = null;
  let latestData = null;
  let ftsoExplorerData = null;
  let ftsoEntityData = null;
  let prices = { USD: null, EUR: null };
  let activePriceCurrency = "EUR";
  let monthlyRewards = { ftso: null, validator: null };
  let lastUpdatedSet = false;
  const RETRY_MESSAGE = "Could not load live data. Try again, or use the verification links while the API catches up.";

  function fmtNum(value, decimals = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
  }

  function fmtPct(value, decimals = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    const pct = n <= 1 ? n * 100 : n;
    return pct.toFixed(decimals) + "%";
  }

  function fmtPrecisePct(value, decimals = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    const pct = n <= 1 ? n * 100 : n;
    if (Math.abs(pct - 100) < 0.000001) return "100%";
    return `${pct.toFixed(decimals)}%`;
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

  function fmtWeight(value) {
    const n = normalizedWeight(value);
    if (!Number.isFinite(n)) return "-";
    return `${(n / 1_000_000).toLocaleString("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mil`;
  }

  function normalizedWeight(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return NaN;
    return Math.abs(n) > 1_000_000_000_000 ? n / 1_000_000_000_000_000_000 : n;
  }

  function fmtChainAmount(value, suffix = " FLR") {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    const normalized = Math.abs(n) > 1_000_000_000_000 ? n / 1_000_000_000 : n;
    return fmtCompact(normalized, suffix);
  }

  function shortAddr(addr) {
    if (!addr) return "-";
    const s = String(addr);
    return `${s.slice(0, 6)}...${s.slice(-4)}`;
  }

  function isZeroAddress(addr) {
    return /^0x0{40}$/i.test(String(addr || ""));
  }

  function setText(key, value) {
    document.querySelectorAll(`[data-field="${key}"]`).forEach(el => {
      el.textContent = value;
      el.classList.remove("skeleton-value");
      el.removeAttribute("aria-busy");
    });
  }

  function getStorage(name) {
    try {
      return window[name] || null;
    } catch (_) {
      return null;
    }
  }

  function storageGet(storage, key) {
    if (!storage) return null;
    try {
      return storage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function storageSet(storage, key, value) {
    if (!storage) return;
    try {
      storage.setItem(key, value);
    } catch (_) {}
  }

  function normalizeCurrency(currency) {
    return currency === "USD" ? "USD" : "EUR";
  }

  function restoreCurrencyPreference() {
    activePriceCurrency = normalizeCurrency(storageGet(getStorage("localStorage"), CURRENCY_KEY) || "EUR");
    document.querySelectorAll("[data-price-currency]").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-price-currency") === activePriceCurrency);
    });
  }

  async function fetchJsonWithCache(url, ttlMs = 60_000) {
    const key = `${CACHE_PREFIX}${url}`;
    const cache = getStorage("sessionStorage");
    const cached = storageGet(cache, key);
    if (cached) {
      try {
        const { data, ts } = JSON.parse(cached);
        if (Date.now() - Number(ts) < ttlMs) return data;
      } catch (_) {}
    }

    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`Request failed: ${url}`);
    const data = await res.json();
    storageSet(cache, key, JSON.stringify({ data, ts: Date.now() }));
    return data;
  }

  function setLoadingState() {
    document.querySelectorAll("[data-field]").forEach(el => {
      const raw = (el.textContent || "").trim();
      if (raw && raw !== "-" && raw.toLowerCase() !== "loading") return;
      el.classList.add("skeleton-value");
      el.setAttribute("aria-busy", "true");
      if (!raw || raw === "-") el.textContent = "Loading";
    });

    document.querySelectorAll("[data-render='epoch-table'], [data-render='validator-epoch-table'], [data-render='validator-delegator-table'], [data-render='entity-address-table']").forEach(tbody => {
      renderTableLoading(tbody);
    });
  }

  function clearLiveErrors() {
    document.querySelectorAll("[data-error]").forEach(el => {
      el.classList.remove("live-error");
      el.textContent = "";
    });
  }

  function showLiveError(message = RETRY_MESSAGE) {
    document.querySelectorAll("[data-error]").forEach(el => {
      el.classList.add("live-error");
      el.innerHTML = `<span>${message}</span><button class="btn ghost retry-btn" type="button" data-retry-live>Retry</button>`;
    });
  }

  function renderTableLoading(tbody) {
    const columns = tbody.closest("table")?.querySelectorAll("thead th").length || 4;
    const labels = tableLabels(tbody);
    tbody.innerHTML = Array.from({ length: 4 }, () => `
      <tr class="table-loading-row">
        ${Array.from({ length: columns }, (_, index) => `<td data-label="${labels[index] || ""}"><span class="skeleton-line"></span></td>`).join("")}
      </tr>
    `).join("");
  }

  function renderTableEmpty(tbody, message) {
    const columns = tbody.closest("table")?.querySelectorAll("thead th").length || 4;
    tbody.innerHTML = `<tr><td colspan="${columns}"><div class="empty-state">${message}</div></td></tr>`;
  }

  function tableLabels(tbody) {
    return [...(tbody.closest("table")?.querySelectorAll("thead th") || [])]
      .map(th => (th.textContent || "").trim());
  }

  function formatRelativeTime(date) {
    const ts = date instanceof Date ? date.getTime() : new Date(date).getTime();
    if (!Number.isFinite(ts)) return "-";
    const diffSeconds = Math.round((ts - Date.now()) / 1000);
    const divisions = [
      ["year", 60 * 60 * 24 * 365],
      ["month", 60 * 60 * 24 * 30],
      ["day", 60 * 60 * 24],
      ["hour", 60 * 60],
      ["minute", 60],
      ["second", 1]
    ];
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    for (const [unit, seconds] of divisions) {
      if (Math.abs(diffSeconds) >= seconds || unit === "second") {
        return formatter.format(Math.round(diffSeconds / seconds), unit);
      }
    }
    return "-";
  }

  function formatDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "-";
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function setPriceDisplay(currency = activePriceCurrency, options = {}) {
    activePriceCurrency = normalizeCurrency(currency);
    if (options.persist !== false) {
      storageSet(getStorage("localStorage"), CURRENCY_KEY, activePriceCurrency);
    }
    const value = prices[activePriceCurrency];
    const prefix = activePriceCurrency === "EUR" ? "€" : "$";
    setText("flrPrice", Number.isFinite(value) ? `${prefix}${value.toFixed(6)}` : "-");
    setText("flrUsd", Number.isFinite(prices.USD) ? `$${prices.USD.toFixed(6)}` : "-");
    setText("ftsoMonthlyFiat", fmtFiat(monthlyRewards.ftso, activePriceCurrency));
    setText("validatorMonthlyFiat", fmtFiat(monthlyRewards.validator, activePriceCurrency));
    document.querySelectorAll("[data-price-currency]").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-price-currency") === activePriceCurrency);
    });
    if (providerData) renderRewardChart(providerData);
    if (validatorData) renderValidatorRewardChart(Array.isArray(validatorData.m_axNode) ? validatorData.m_axNode[0] : null);
  }

  function fmtFiat(flrAmount, currency = activePriceCurrency) {
    const amount = Number(flrAmount);
    const price = prices[currency];
    if (!Number.isFinite(amount) || !Number.isFinite(price)) return "-";
    const prefix = currency === "EUR" ? "€" : "$";
    return `${prefix}${fmtNum(amount * price, 0)}`;
  }

  function setBar(key, value) {
    const n = Number(value);
    const pct = Number.isFinite(n) ? Math.max(0, Math.min(100, n <= 1 ? n * 100 : n)) : 0;
    document.querySelectorAll(`[data-bar="${key}"]`).forEach(el => {
      el.style.width = `${pct}%`;
    });
  }

  function pickFirstDefined(...values) {
    for (const value of values) {
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return null;
  }

  function parseBooleanLike(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (value === 1) return true;
      if (value === 0) return false;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "yes", "y", "1", "registered", "pre-registered", "preregistered", "ready", "active", "pass", "passed"].includes(normalized)) return true;
      if (["false", "no", "n", "0", "not registered", "not pre-registered", "unregistered", "inactive", "fail", "failed"].includes(normalized)) return false;
    }
    return null;
  }

  function findValueByKeyDeep(node, candidateKeys) {
    if (!node || typeof node !== "object") return null;
    const candidates = candidateKeys.map(key => key.toLowerCase());
    let match = null;

    function walk(obj) {
      if (match !== null || obj == null) return;
      if (Array.isArray(obj)) {
        for (const item of obj) walk(item);
        return;
      }
      if (typeof obj !== "object") return;
      for (const [key, value] of Object.entries(obj)) {
        if (candidates.includes(key.toLowerCase())) {
          match = value;
          return;
        }
      }
      for (const value of Object.values(obj)) walk(value);
    }

    walk(node);
    return match;
  }

  function detectPreRegistration(provider) {
    const raw = pickFirstDefined(
      provider.preRegistered,
      provider.preregistered,
      provider.isPreRegistered,
      provider.preRegistration,
      provider.pre_registration,
      provider.nextEpochRegistered,
      provider.registeredForNextEpoch,
      provider.nextRewardEpochRegistered,
      findValueByKeyDeep(provider, [
        "preRegistered",
        "preregistered",
        "isPreRegistered",
        "preRegistration",
        "registeredForNextEpoch",
        "nextEpochRegistered",
        "nextRewardEpochRegistered"
      ])
    );
    let parsed = parseBooleanLike(raw);
    if (parsed === null) {
      const latest = latestEpoch(provider);
      parsed = parseBooleanLike(pickFirstDefined(
        latest?.preRegistered,
        latest?.preregistered,
        latest?.isPreRegistered,
        latest?.preRegistration,
        latest?.registeredForNextEpoch,
        latest?.nextEpochRegistered,
        latest?.nextRewardEpochRegistered
      ));
    }
    if (parsed === true) return "Yes";
    if (parsed === false) return "No";
    return "Not exposed";
  }

  function minimalConditions(provider, latest) {
    const latestConditions = getLatestConditions(latest).map(item => item.met).filter(value => typeof value === "boolean");
    const eligibleEpochs = Number(provider?.eligibleEpochs);
    const totalEpochs = Number(provider?.totalEpochs);
    const latestEligible = latest?.eligibleForReward;
    if (latestConditions.length > 0) return latestConditions.every(Boolean) ? "Pass" : "Watch";
    if (latestEligible === false) return "Watch";
    if (Number.isFinite(eligibleEpochs) && Number.isFinite(totalEpochs) && totalEpochs > 0) {
      return eligibleEpochs >= totalEpochs ? "Pass" : "Watch";
    }
    return latestEligible === true ? "Pass" : "Not exposed";
  }

  function getLatestConditions(latest) {
    return [
      ["FTSO Anchor Feeds", latest?.ftsoScaling?.conditionMet],
      ["FTSO Block-Latency Feeds", latest?.fastUpdates?.conditionMet],
      ["FDC", latest?.fdc?.conditionMet],
      ["Staking", latest?.staking?.conditionMet]
    ];
  }

  function renderConditions(latest) {
    const conditions = getLatestConditions(latest);
    document.querySelectorAll("[data-render='conditions']").forEach(mount => {
      mount.innerHTML = conditions.map(([label, met]) => {
        const state = met === true ? "ok" : met === false ? "bad" : "unknown";
        const title = `${label}: ${met === true ? "OK" : met === false ? "Needs attention" : "Not exposed"}`;
        return `<span class="${state}" title="${title}" aria-label="${title}">${met === true ? "✓" : met === false ? "×" : "?"}</span>`;
      }).join("");
    });
  }

  function renderConditionPasses(provider, latest) {
    const passes = Number(latest?.passes ?? latest?.newNumberOfPasses);
    const maxPasses = 3;
    const history = Array.isArray(provider?.epochData) ? provider.epochData : [];
    const recent = [...history]
      .sort((a, b) => Number(b.epoch ?? 0) - Number(a.epoch ?? 0))
      .slice(0, 10);
    const successCount = recent.filter(epoch => epoch.passEarned === true || Number(epoch.passes ?? epoch.newNumberOfPasses) >= maxPasses).length;
    const successRate = recent.length ? (successCount / recent.length) * 100 : null;
    const value = Number.isFinite(passes)
      ? `${passes}/${maxPasses}${Number.isFinite(successRate) ? ` ${successRate.toFixed(1)}%` : ""}`
      : "-";
    document.querySelectorAll("[data-render='condition-passes']").forEach(el => {
      el.textContent = value;
    });
  }

  function renderPreRegisteredState(value) {
    document.querySelectorAll("[data-state='preRegistered']").forEach(el => {
      el.classList.toggle("ok", value === "Yes");
      el.classList.toggle("bad", value === "No");
      el.setAttribute("aria-label", `Pre-registered: ${value}`);
      el.removeAttribute("aria-hidden");
    });
  }

  function uptimeEpochLabel(index, total) {
    const latestEpochNumber = Number(latestData?.epoch);
    if (!Number.isFinite(latestEpochNumber)) return `E ${index + 1}`;
    return `E ${latestEpochNumber - total + index}`;
  }

  function normalizeUptimeItems(values) {
    if (!Array.isArray(values)) return [];
    return values.map((item, index) => {
      if (item && typeof item === "object") {
        return {
          epoch: Number(item.reward_epoch_id ?? item.epoch ?? item.rewardEpoch),
          value: Number(item.availability ?? item.uptime ?? item.value)
        };
      }
      return {
        epoch: null,
        value: Number(item),
        index
      };
    }).filter(item => Number.isFinite(item.value));
  }

  function renderUptime(values) {
    const items = normalizeUptimeItems(values);
    document.querySelectorAll("[data-render='validator-uptime']").forEach(mount => {
      if (!items.length) {
        mount.innerHTML = "<span>-</span>";
        return;
      }
      mount.innerHTML = items.map((item, index) => {
        const pct = fmtPrecisePct(item.value);
        const epoch = Number.isFinite(item.epoch) ? `E ${item.epoch}` : uptimeEpochLabel(index, items.length);
        const title = `${epoch}: ${pct} availability`;
        return `<span title="${title}"><em>${epoch}</em>${pct}</span>`;
      }).join("");
    });
  }

  function recentFtsoAvailability() {
    const epochs = Array.isArray(ftsoExplorerData?.per_reward_epoch) ? ftsoExplorerData.per_reward_epoch : [];
    const explorerEpochs = [...epochs]
      .filter(item => Number.isFinite(Number(item?.reward_epoch_id)) && Number.isFinite(Number(item?.availability)))
      .sort((a, b) => Number(a.reward_epoch_id) - Number(b.reward_epoch_id));
    if (explorerEpochs.length) return explorerEpochs;

    return FTSO_UPTIME_SNAPSHOT;
  }

  function estimateFtsoMonthlyReward(provider) {
    const direct = Number(provider?.m_dMonthlyReward ?? provider?.monthlyReward ?? provider?.monthlyRewards ?? provider?.estimatedMonthlyReward);
    if (Number.isFinite(direct)) return direct;
    const history = Array.isArray(provider?.epochData) ? provider.epochData : [];
    const recent = history
      .filter(item => Number.isFinite(Number(item.totalRewardAmount)))
      .sort((a, b) => Number(b.epoch) - Number(a.epoch))
      .slice(0, 8);
    if (!recent.length) return null;
    const total = recent.reduce((sum, item) => sum + Number(item.totalRewardAmount || 0), 0);
    return total * (30.5 / 28);
  }

  function estimateValidatorMonthlyReward(node) {
    const direct = Number(node?.m_dMonthlyReward ?? node?.monthlyReward ?? node?.monthlyRewards ?? node?.estimatedMonthlyReward);
    if (Number.isFinite(direct)) return direct;
    const history = Array.isArray(node?.m_axReward) ? node.m_axReward : [];
    const recent = history
      .filter(item => Number.isFinite(Number(item.m_dNodeReward ?? item.m_dValidatorReward)))
      .sort((a, b) => Number(b.m_dRewardEpoch) - Number(a.m_dRewardEpoch))
      .slice(0, 8);
    if (!recent.length) return null;
    const total = recent.reduce((sum, item) => sum + Number(item.m_dNodeReward ?? item.m_dValidatorReward ?? 0), 0);
    return total * (30.5 / 28);
  }

  function estimateValidatorApr(node) {
    const history = Array.isArray(node?.m_axReward) ? node.m_axReward : [];
    const recent = history
      .filter(item => Number.isFinite(Number(item.m_dValidatorReward)) && Number(item.m_dRewardWeight) > 0)
      .sort((a, b) => Number(b.m_dRewardEpoch) - Number(a.m_dRewardEpoch))
      .slice(0, 8);
    if (!recent.length) return null;
    const avgRate = recent.reduce((sum, item) => sum + (Number(item.m_dValidatorReward) / Number(item.m_dRewardWeight)), 0) / recent.length;
    return avgRate * (365 / 3.5) * 100;
  }

  function timeLeftPct(stake) {
    if (!stake?.m_xTimeStart || !stake?.m_xTimeEnd) return null;
    const start = new Date(stake.m_xTimeStart).getTime();
    const end = new Date(stake.m_xTimeEnd).getTime();
    const now = Date.now();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return Math.max(0, Math.min(100, ((end - now) / (end - start)) * 100));
  }

  function renderMonthlyRewards() {
    setText("ftsoMonthlyRewards", Number.isFinite(monthlyRewards.ftso) ? `${fmtNum(monthlyRewards.ftso, 0)} FLR` : "-");
    setText("validatorMonthlyRewards", Number.isFinite(monthlyRewards.validator) ? `${fmtNum(monthlyRewards.validator, 0)} FLR` : "-");
    setText("ftsoMonthlyFiat", fmtFiat(monthlyRewards.ftso));
    setText("validatorMonthlyFiat", fmtFiat(monthlyRewards.validator));
  }

  function findProviderDeep(data) {
    let found = null;
    function walk(node) {
      if (found || node == null) return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      if (typeof node === "object") {
        const voter = String(node.voterAddress || "").toLowerCase();
        const delegation = String(node.delegationAddress || "").toLowerCase();
        const name = String(node.dataProviderName || "").toLowerCase();
        if (voter === TARGET_VOTER || delegation === TARGET_DELEGATION || name === "mirsflr") {
          found = node;
          return;
        }
        for (const value of Object.values(node)) walk(value);
      }
    }
    walk(data);
    return found;
  }

  function findValidatorDeep(data) {
    const validators = data?.m_axValidator || data?.validators || data?.data?.m_axValidator || [];
    if (!Array.isArray(validators)) return null;
    return validators.find(item => {
      const blob = JSON.stringify(item).toLowerCase();
      return blob.includes("mirsflr") || blob.includes(TARGET_DELEGATION);
    }) || null;
  }

  function findProviderV2Data(data) {
    return data?.m_xData || data?.data || data || null;
  }

  function latestEpoch(provider) {
    if (!provider?.epochData?.length) return null;
    return [...provider.epochData].sort((a, b) => Number(b.epoch) - Number(a.epoch))[0];
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 1500);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    showToast("Copied");
  }

  async function copyFromButton(text, button) {
    await copy(text);
    if (!button) return;
    const originalText = button.textContent;
    const originalLabel = button.getAttribute("aria-label");
    button.textContent = "Copied";
    button.setAttribute("aria-label", "Copied");
    button.classList.add("copied");
    clearTimeout(button.copyTimer);
    button.copyTimer = setTimeout(() => {
      button.textContent = originalText;
      if (originalLabel) {
        button.setAttribute("aria-label", originalLabel);
      } else {
        button.removeAttribute("aria-label");
      }
      button.classList.remove("copied");
    }, 1600);
  }

  function renderEpochTable(provider) {
    const history = [...(provider.epochData || [])]
      .sort((a, b) => Number(b.epoch) - Number(a.epoch));
    document.querySelectorAll("[data-render='epoch-table']").forEach(tbody => {
      const rows = history.slice(0, tbody.dataset.limit ? Number(tbody.dataset.limit) : 12);
      const labels = tableLabels(tbody);
      if (!rows.length) {
        renderTableEmpty(tbody, "No FTSO epoch data is available yet.");
        return;
      }

      tbody.innerHTML = rows.map(item => `
        <tr>
          <th scope="row" data-label="${labels[0] || "Epoch"}">${item.epoch ?? "-"}</th>
          <td data-label="${labels[1] || "Reward"}">${item.totalRewardAmount != null ? fmtNum(item.totalRewardAmount, 2) : "-"}</td>
          <td data-label="${labels[2] || "Reward rate"}">${item.m_dRewardRate != null ? fmtPct(item.m_dRewardRate) : "-"}</td>
          <td data-label="${labels[3] || "Eligible"}">${item.eligibleForReward === true ? "Yes" : item.eligibleForReward === false ? "No" : "-"}</td>
        </tr>
      `).join("");
    });
  }

  function renderValidatorEpochTable(node) {
    document.querySelectorAll("[data-render='validator-epoch-table']").forEach(tbody => {
      const history = [...(node?.m_axReward || [])]
        .sort((a, b) => Number(b.m_dRewardEpoch) - Number(a.m_dRewardEpoch))
        .slice(0, tbody.dataset.limit ? Number(tbody.dataset.limit) : 10);

      if (!history.length) {
        renderTableEmpty(tbody, "Validator reward history is not available yet.");
        return;
      }

      const labels = tableLabels(tbody);
      const fee = node?.m_dFee != null ? `${fmtNum(node.m_dFee, 2)}%` : "-";
      tbody.innerHTML = history.map(item => {
        const validatorReward = Number(item.m_dValidatorReward ?? item.m_dNodeReward);
        const nodeReward = Number(item.m_dNodeReward);
        return `
          <tr>
            <th scope="row" data-label="${labels[0] || "Validator epoch"}">${item.m_dRewardEpoch ?? "-"}</th>
            <td data-label="${labels[1] || "Validator reward"}">${Number.isFinite(validatorReward) ? fmtNum(validatorReward, 2) : "-"}</td>
            <td data-label="${labels[2] || "Node reward"}">${Number.isFinite(nodeReward) ? fmtNum(nodeReward, 2) : "-"}</td>
            <td data-label="${labels[3] || "Fee"}">${fee}</td>
          </tr>
        `;
      }).join("");
    });
  }

  function renderValidatorDelegators(node) {
    const delegators = Array.isArray(node?.m_axDelegation)
      ? [...node.m_axDelegation].sort((a, b) => Number(b.m_dAmount) - Number(a.m_dAmount))
      : [];
    const totalDelegation = delegators.reduce((sum, item) => sum + Number(item.m_dAmount || 0), 0);
    const now = Date.now();
    const fiveDays = 5 * 24 * 60 * 60 * 1000;
    const newDelegators = delegators.filter(item => {
      const start = new Date(item.m_xTimeStart).getTime();
      return Number.isFinite(start) && start <= now && start >= now - fiveDays;
    });
    const endingDelegators = delegators.filter(item => {
      const end = new Date(item.m_xTimeEnd).getTime();
      return Number.isFinite(end) && end >= now && end <= now + fiveDays;
    });
    const newAmount = newDelegators.reduce((sum, item) => sum + Number(item.m_dAmount || 0), 0);
    const endingAmount = endingDelegators.reduce((sum, item) => sum + Number(item.m_dAmount || 0), 0);

    setText("validatorDelegatorCount", fmtNum(delegators.length, 0));
    setText("validatorDelegatorTotal", fmtCompact(totalDelegation, " FLR"));
    setText("validatorDelegatorNew", `${fmtNum(newDelegators.length, 0)} / ${fmtCompact(newAmount, " FLR")}`);
    setText("validatorDelegatorEnding", `${fmtNum(endingDelegators.length, 0)} / ${fmtCompact(endingAmount, " FLR")}`);

    document.querySelectorAll("[data-render='validator-delegator-table']").forEach(tbody => {
      if (!delegators.length) {
        renderTableEmpty(tbody, "No validator delegators are visible yet.");
        return;
      }

      const labels = tableLabels(tbody);
      tbody.innerHTML = delegators.map((item, index) => {
        const amount = Number(item.m_dAmount);
        const share = totalDelegation > 0 && Number.isFinite(amount) ? (amount / totalDelegation) * 100 : null;
        const timeLeft = Array.isArray(item.m_aiTimeLeftDHM)
          ? `${item.m_aiTimeLeftDHM[0]}d ${item.m_aiTimeLeftDHM[1]}h`
          : "-";
        return `
          <tr>
            <th scope="row" data-label="${labels[0] || "#"}">${index + 1}</th>
            <td data-label="${labels[1] || "Address"}"><span class="delegator-address">${shortAddr(item.m_sAddressP_Bech32 || item.m_sAddressP || item.m_sAddressC)}</span></td>
            <td data-label="${labels[2] || "Amount"}">${Number.isFinite(amount) ? fmtNum(amount, 0) : "-"}</td>
            <td data-label="${labels[3] || "Share"}">${Number.isFinite(share) ? `${fmtNum(share, 1)}%` : "-"}</td>
            <td data-label="${labels[4] || "Start"}">${formatDate(item.m_xTimeStart)}</td>
            <td data-label="${labels[5] || "End"}">${formatDate(item.m_xTimeEnd)}</td>
            <td data-label="${labels[6] || "Time left"}">${timeLeft}</td>
          </tr>
        `;
      }).join("");
    });
  }

  function rewardWithFiat(value) {
    return `${fmtNum(value, 2)} FLR<br><small>${fmtFiat(value)}</small>`;
  }

  function rewardRangeWithFiat(minReward, maxReward) {
    return `${fmtNum(minReward, 0)} - ${fmtNum(maxReward, 0)} FLR<br><small>${fmtFiat(minReward)} - ${fmtFiat(maxReward)}</small>`;
  }

  function renderRewardSeries({ svg, tooltip, summary, series, emptyMessage, gradientId }) {
    if (!svg) return;

    if (!series.length) {
      svg.innerHTML = `<text x="40" y="40" fill="#b8c1bd" font-size="16" font-weight="700">${emptyMessage}</text>`;
      if (summary) summary.innerHTML = `<span class="empty-state">${emptyMessage}</span>`;
      return;
    }

    const width = 1000;
    const height = 280;
    const padX = 46;
    const padTop = 26;
    const padBottom = 34;
    const minReward = Math.min(...series.map(item => item.reward));
    const maxReward = Math.max(...series.map(item => item.reward), 1);
    const avgReward = series.reduce((sum, item) => sum + item.reward, 0) / series.length;
    const range = (maxReward - minReward) || 1;
    const stepX = (width - padX * 2) / Math.max(series.length - 1, 1);
    const plotH = height - padTop - padBottom;
    const points = series.map((item, index) => {
      const x = padX + index * stepX;
      const y = height - padBottom - ((item.reward - minReward) / range) * plotH;
      return { ...item, x, y };
    });
    const line = points.map(point => `${point.x},${point.y}`).join(" ");
    const area = [`${points[0].x},${height - padBottom}`, ...points.map(point => `${point.x},${point.y}`), `${points[points.length - 1].x},${height - padBottom}`].join(" ");
    const last = series[series.length - 1];
    const avgY = height - padBottom - ((avgReward - minReward) / range) * plotH;
    const grid = [0, 1, 2, 3].map(i => {
      const y = padTop + plotH * (i / 3);
      return `<line x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}" stroke="rgba(255,255,255,.10)" />`;
    }).join("");
    const labels = [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]].map(point => `
      <text x="${point.x}" y="${height - 6}" text-anchor="middle" fill="#b8c1bd" font-size="12" font-weight="700">${point.epoch}</text>
    `).join("");
    const circles = points.map((point, index) => `
      <circle cx="${point.x}" cy="${point.y}" r="${index === points.length - 1 ? 5 : 4}" fill="${index === points.length - 1 ? "#e9167c" : "#f4f6f2"}"></circle>
      <circle cx="${point.x}" cy="${point.y}" r="15" fill="transparent" data-chart-index="${index}" style="cursor:pointer"></circle>
    `).join("");

    svg.innerHTML = `
      <defs>
        <linearGradient id="${gradientId}LineGrad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stop-color="rgba(233,22,124,.58)" />
          <stop offset="100%" stop-color="#e9167c" />
        </linearGradient>
        <linearGradient id="${gradientId}FillGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="rgba(233,22,124,.28)" />
          <stop offset="100%" stop-color="rgba(233,22,124,.02)" />
        </linearGradient>
      </defs>
      ${grid}
      <text x="8" y="${padTop + 6}" fill="#b8c1bd" font-size="12" font-weight="700">${fmtNum(maxReward, 0)}</text>
      <text x="8" y="${height - padBottom}" fill="#b8c1bd" font-size="12" font-weight="700">${fmtNum(minReward, 0)}</text>
      <line x1="${padX}" y1="${avgY}" x2="${width - padX}" y2="${avgY}" stroke="rgba(233,22,124,.48)" stroke-dasharray="6 6" />
      <polygon points="${area}" fill="url(#${gradientId}FillGrad)"></polygon>
      <polyline points="${line}" fill="none" stroke="url(#${gradientId}LineGrad)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"></polyline>
      ${circles}
      ${labels}
    `;

    const showTooltip = target => {
        const point = points[Number(target.getAttribute("data-chart-index"))];
        if (!tooltip || !point) return;
        const wrapRect = svg.parentElement.getBoundingClientRect();
        const svgRect = svg.getBoundingClientRect();
        const left = (point.x / width) * svgRect.width;
        const top = (point.y / height) * svgRect.height;
        tooltip.innerHTML = `Epoch ${point.epoch}<br>${rewardWithFiat(point.reward)}`;
        tooltip.style.display = "block";
        tooltip.style.left = `${Math.max(8, Math.min(left - 48, wrapRect.width - 160))}px`;
        tooltip.style.top = `${Math.max(8, top - 52)}px`;
    };
    const hideTooltip = () => {
      if (tooltip) tooltip.style.display = "none";
    };

    svg.querySelectorAll("[data-chart-index]").forEach(target => {
      target.addEventListener("mouseenter", () => {
        showTooltip(target);
      });
      target.addEventListener("focus", () => {
        showTooltip(target);
      });
      target.addEventListener("click", event => {
        event.preventDefault();
        showTooltip(target);
      });
      target.addEventListener("touchstart", event => {
        event.preventDefault();
        showTooltip(target);
      }, { passive: false });
      target.addEventListener("mouseleave", hideTooltip);
      target.addEventListener("blur", hideTooltip);
      document.addEventListener("click", event => {
        if (!svg.contains(event.target)) hideTooltip();
      });
    });

    if (summary && last) {
      summary.innerHTML = `<span>Latest <strong>${rewardWithFiat(last.reward)}</strong></span><span>Average <strong>${rewardWithFiat(avgReward)}</strong></span><span>Range <strong>${rewardRangeWithFiat(minReward, maxReward)}</strong></span>`;
    }
  }

  function renderRewardChart(provider) {
    const series = [...(provider.epochData || [])]
      .sort((a, b) => Number(a.epoch) - Number(b.epoch))
      .slice(-20)
      .map(item => ({
        epoch: item.epoch,
        reward: Number(item.totalRewardAmount || 0)
      }));

    renderRewardSeries({
      svg: document.querySelector("[data-render='reward-chart']"),
      tooltip: document.querySelector("[data-render='reward-tooltip']"),
      summary: document.querySelector("[data-render='reward-summary']"),
      series,
      emptyMessage: "FTSO reward history unavailable",
      gradientId: "ftsoReward"
    });
  }

  function renderValidatorRewardChart(node) {
    const series = [...(node?.m_axReward || [])]
      .sort((a, b) => Number(a.m_dRewardEpoch) - Number(b.m_dRewardEpoch))
      .slice(-20)
      .map(item => ({
        epoch: item.m_dRewardEpoch,
        reward: Number(item.m_dValidatorReward ?? item.m_dNodeReward ?? 0)
      }));

    renderRewardSeries({
      svg: document.querySelector("[data-render='validator-reward-chart']"),
      tooltip: document.querySelector("[data-render='validator-reward-tooltip']"),
      summary: document.querySelector("[data-render='validator-reward-summary']"),
      series,
      emptyMessage: "Validator reward history unavailable",
      gradientId: "validatorReward"
    });
  }

  function renderAddresses(provider) {
    const mount = document.querySelector("[data-render='addresses']");
    if (!mount) return;
    const rows = [
      ["Delegation address", provider.delegationAddress || TARGET_DELEGATION, "Use this in your wallet when delegating."],
      ["Provider identity", provider.voterAddress || TARGET_VOTER, "Compare this with Explorer and FlareMetrics."],
      ["Submit address", provider.submitAddress, "Operational submit address from provider data."],
      ["Submit signature address", provider.submitSignatureAddress, "Signature address from provider data."],
      ["Signing policy address", provider.signingPolicyAddress, "Signing policy address from provider data."]
    ].filter(([, value]) => value);

    mount.innerHTML = rows.map(([label, value, help]) => `
      <article class="address">
        <span>${label}</span>
        <code>${value}</code>
        <div class="copy-row">
          <div class="copy-help">${help}</div>
          <button class="btn ghost" type="button" data-copy="${value}" aria-label="Copy ${label}">Copy</button>
        </div>
      </article>
    `).join("");
  }

  function fmtAddressBalance(value) {
    if (value === null || value === undefined || value === "") return '<span class="balance-empty">-</span>';
    const n = Number(value);
    return Number.isFinite(n) ? fmtNum(n, n >= 1000 ? 2 : 4) : '<span class="balance-empty">-</span>';
  }

  function renderEntityAddresses(provider, validator) {
    const validatorNode = Array.isArray(validator?.m_axNode) ? validator.m_axNode[0] : null;
    const fastUpdates = Array.isArray(provider?.fastUpdatesAddresses) ? provider.fastUpdatesAddresses : [];
    const rows = [];

    function addRow({ scope = "core", role, network = "C-chain", address, flr, wflr = null, purpose }) {
      if (!address || isZeroAddress(address)) return;
      rows.push({ scope, role, network, address, flr, wflr, purpose });
    }

    addRow({
      role: "Provider identity",
      address: provider?.voterAddress || TARGET_VOTER,
      flr: provider?.voterAddressBalance,
      purpose: "Provider identity used for external verification."
    });
    addRow({
      role: "Delegation address",
      address: provider?.delegationAddress || TARGET_DELEGATION,
      flr: provider?.delegationAddressBalance,
      purpose: "Address shown in wallets for FTSO delegation."
    });
    addRow({
      scope: "technical",
      role: "Submit address",
      address: provider?.submitAddress,
      flr: provider?.submitAddressBalance,
      purpose: "Operational address for provider submissions."
    });
    addRow({
      scope: "technical",
      role: "Submit signature",
      address: provider?.submitSignatureAddress,
      flr: provider?.submitSignatureAddressBalance,
      purpose: "Signature address for provider submissions."
    });
    addRow({
      scope: "technical",
      role: "Signing policy",
      address: provider?.signingPolicyAddress,
      flr: provider?.signingPolicyAddressBalance,
      purpose: "Signing policy address from current provider data."
    });
    fastUpdates.forEach((item, index) => addRow({
      scope: "technical",
      role: `Fast update ${index + 1}`,
      address: item.address,
      flr: item.balance,
      purpose: "Fast updates operational address."
    }));
    addRow({
      scope: "technical",
      role: "Validator FTSO C",
      address: validator?.m_sFtsoAddressC,
      flr: validator?.m_dTotal,
      purpose: "Validator entity C-chain address."
    });
    addRow({
      scope: "technical",
      role: "Validator FTSO P",
      network: "P-chain",
      address: validator?.m_sFtsoAddressP_Bech32 || validator?.m_sFtsoAddressP,
      flr: validator?.m_dTotal,
      purpose: "Validator entity P-chain address."
    });
    addRow({
      scope: "technical",
      role: "Validator node",
      network: "P-chain",
      address: validatorNode?.m_sAddressP_Bech32 || validatorNode?.m_sAddressP,
      flr: validatorNode?.m_dStake,
      purpose: "Node staking address."
    });
    addRow({
      scope: "technical",
      role: "Node ID",
      network: "Validator",
      address: validatorNode?.m_sNodeID,
      flr: null,
      purpose: "Public validator node identifier."
    });

    document.querySelectorAll("[data-render='entity-address-table']").forEach(tbody => {
      const scope = tbody.getAttribute("data-scope") || "core";
      const scopedRows = rows.filter(row => row.scope === scope);
      if (!scopedRows.length) {
        renderTableEmpty(tbody, scope === "core" ? "No entity address data is available yet." : "No technical address data is available yet.");
        return;
      }

      const labels = tableLabels(tbody);
      tbody.innerHTML = scopedRows.map(row => `
        <tr>
          <th scope="row" data-label="${labels[0] || "Role"}">${row.role}</th>
          <td data-label="${labels[1] || "Network"}">${row.network}</td>
          <td data-label="${labels[2] || "Address"}"><code>${row.address}</code></td>
          <td data-label="${labels[3] || "FLR"}">${fmtAddressBalance(row.flr)}</td>
          <td data-label="${labels[4] || "WFLR"}">${fmtAddressBalance(row.wflr)}</td>
          <td data-label="${labels[5] || "Purpose"}">${row.purpose}</td>
        </tr>
      `).join("");
    });
  }

  function enhanceTooltips() {
    document.querySelectorAll(".info-tip").forEach((button, index) => {
      const tooltip = button.querySelector("span");
      if (!tooltip) return;
      const id = tooltip.id || `tooltip-${index + 1}`;
      tooltip.id = id;
      tooltip.setAttribute("role", "tooltip");
      button.setAttribute("aria-describedby", id);
    });
  }

  function enhanceCopyButtons() {
    document.querySelectorAll("[data-copy]").forEach(button => {
      if (button.hasAttribute("aria-label")) return;
      const key = button.getAttribute("data-copy");
      const label = key === "delegation" ? "delegation address"
        : key === "identity" ? "provider identity"
        : key === "email" ? "email address"
        : "value";
      button.setAttribute("aria-label", `Copy ${label}`);
    });
  }

  function applyData(provider, latest) {
    const delegation = provider.delegationAddress || TARGET_DELEGATION;
    const voter = provider.voterAddress || TARGET_VOTER;
    setText("status", "Online");
    setText("providerName", provider.dataProviderName && provider.dataProviderName !== "Unknown" ? provider.dataProviderName : "MirSFlr");
    setText("rewardRate", latest?.m_dRewardRate != null ? fmtPct(latest.m_dRewardRate) : "-");
    if (!ftsoEntityData) {
      setText("votePower", latest?.m_dTotalWeight != null ? fmtCompact(latest.m_dTotalWeight) : "-");
      setText("ftsoWeight", latest?.m_dTotalWeight != null ? fmtWeight(latest.m_dTotalWeight) : "-");
      setText("delegationWeight", latest?.m_dDelegationWeight != null ? fmtWeight(latest.m_dDelegationWeight) : "-");
      setText("stakeWeight", latest?.m_dStakeWeight != null ? fmtWeight(latest.m_dStakeWeight) : "-");
      setText("ftsoFee", latest?.voterRegistration?.delegationFeeBIPS != null ? `${fmtNum(Number(latest.voterRegistration.delegationFeeBIPS) / 100, 2)}%` : "-");
    }
    setText("totalRewards", provider.totalRewards != null ? fmtCompact(provider.totalRewards, " FLR") : "-");
    setText("averageReward", provider.averageRewardPerEpoch != null ? fmtCompact(provider.averageRewardPerEpoch, " FLR") : "-");
    setText("availability", provider.ftsoPerformance?.availability != null ? fmtPct(provider.ftsoPerformance.availability) : "-");
    setText("performance", provider.ftsoPerformance?.performance != null ? fmtPct(provider.ftsoPerformance.performance) : "-");
    setText("performance1", provider.ftsoPerformance?.performance1 != null ? fmtPct(provider.ftsoPerformance.performance1) : "-");
    setText("performance2", provider.ftsoPerformance?.performance2 != null ? fmtPct(provider.ftsoPerformance.performance2) : "-");
    setText("fdcAvailability", provider.fdcPerformance?.availability != null ? fmtPct(provider.fdcPerformance.availability) : "-");
    setText("eligible", `${provider.eligibleEpochs ?? "-"} / ${provider.totalEpochs ?? "-"}`);
    setText("passes", `${provider.totalPasses ?? 0} / ${provider.totalStrikes ?? 0}`);
    const preReg = detectPreRegistration(provider);
    setText("preRegistered", preReg);
    setText("preRegisteredStatus", preReg === "Yes" ? "Pre-reg" : preReg === "No" ? "No pre-reg" : "Pre-reg unknown");
    renderPreRegisteredState(preReg);
    setText("minimalConditions", minimalConditions(provider, latest));
    monthlyRewards.ftso = estimateFtsoMonthlyReward(provider);
    renderMonthlyRewards();
    setText("selfBond", latest?.staking?.totalSelfBond != null ? fmtChainAmount(latest.staking.totalSelfBond) : "-");
    setText("stakedFlr", latest?.staking?.stakeWithUptime != null ? fmtChainAmount(latest.staking.stakeWithUptime) : latest?.staking?.stake != null ? fmtChainAmount(latest.staking.stake) : "-");
    setText("latestEpoch", latest?.epoch ?? "-");
    setText("latestReward", latest?.totalRewardAmount != null ? `${fmtNum(latest.totalRewardAmount, 2)} FLR` : "-");
    setText("latestEligibility", latest?.eligibleForReward === true ? "Yes" : latest?.eligibleForReward === false ? "No" : "-");
    setText("delegationAddress", delegation);
    setText("providerIdentity", voter);
    setText("shortDelegation", shortAddr(delegation));
    setText("shortIdentity", shortAddr(voter));
    setText("contactEmail", CONTACT_EMAIL);
    setBar("availability", provider.ftsoPerformance?.availability);
    setBar("performance", provider.ftsoPerformance?.performance);
    setBar("performance1", provider.ftsoPerformance?.performance1);
    setBar("performance2", provider.ftsoPerformance?.performance2);
    setBar("fdcAvailability", provider.fdcPerformance?.availability);
    renderConditions(latest);
    renderConditionPasses(provider, latest);
    renderEpochTable(provider);
    renderAddresses(provider);
    renderEntityAddresses(provider, validatorData);
    renderRewardChart(provider);
    const ftsoUptime = recentFtsoAvailability();
    if (ftsoUptime.length) {
      renderUptime(ftsoUptime);
    } else if (validatorData) {
      const node = Array.isArray(validatorData.m_axNode) ? validatorData.m_axNode[0] : null;
      renderUptime(Array.isArray(node?.m_adUptime) ? node.m_adUptime : []);
    }
  }

  function applyValidatorData(validator) {
    if (!validator) {
      setText("validatorConnected", "Not exposed");
      return;
    }
    const node = Array.isArray(validator.m_axNode) ? validator.m_axNode[0] : null;
    const stake = Array.isArray(node?.m_axStake) ? node.m_axStake[0] : null;
    const connected = node?.m_bConnected === true ? "Connected" : node?.m_bConnected === false ? "Offline" : "Not exposed";
    const uptimeValues = Array.isArray(node?.m_adUptime) ? node.m_adUptime : [];
    const uptime = uptimeValues.length ? uptimeValues.map(v => fmtPrecisePct(v)).join(" / ") : "-";
    const uptimeAvg = uptimeValues.length ? uptimeValues.reduce((sum, value) => sum + Number(value || 0), 0) / uptimeValues.length : null;
    const timeLeft = Array.isArray(stake?.m_aiTimeLeftDHM)
      ? `${stake.m_aiTimeLeftDHM[0]}d ${stake.m_aiTimeLeftDHM[1]}h ${stake.m_aiTimeLeftDHM[2]}m left`
      : "-";
    const stakeEnd = stake?.m_xTimeEnd ? new Date(stake.m_xTimeEnd).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "-";
    const capacity = Number(validator.m_dTotal);
    const freeSpace = Number(validator.m_dFreeDelegationSpace);
    const capacityMax = capacity + freeSpace;
    const capacityPct = capacityMax > 0 ? (capacity / capacityMax) * 100 : null;
    const leftPct = timeLeftPct(stake);

    setText("validatorConnected", connected);
    setText("validatorNodeId", shortAddr(node?.m_sNodeID));
    setText("validatorApr", Number.isFinite(estimateValidatorApr(node)) ? fmtPct(estimateValidatorApr(node)) : "-");
    setText("validatorUptimeAvg", Number.isFinite(uptimeAvg) ? `${fmtNum(uptimeAvg, 2)}%` : "-");
    setText("validatorUptime", uptime);
    setText("validatorFee", node?.m_dFee != null ? `${fmtNum(node.m_dFee, 2)}%` : "-");
    setText("validatorNodeVersion", node?.m_sVersion ? String(node.m_sVersion).replace(/^avalanchego\//, "") : "-");
    monthlyRewards.validator = estimateValidatorMonthlyReward(node);
    renderMonthlyRewards();
    setText("validatorBoost", node?.m_dBoost != null ? fmtCompact(node.m_dBoost, " FLR") : "-");
    setText("validatorTotal", validator.m_dTotal != null ? fmtCompact(validator.m_dTotal, " FLR") : "-");
    setText("validatorStake", validator.m_dTotalStake != null ? fmtCompact(validator.m_dTotalStake, " FLR") : "-");
    setText("validatorDelegation", validator.m_dTotalDelegation != null ? fmtCompact(validator.m_dTotalDelegation, " FLR") : "-");
    setText("freeDelegationSpace", validator.m_dFreeDelegationSpace != null ? fmtCompact(validator.m_dFreeDelegationSpace, " FLR") : "-");
    setText("stakeDelegation", `${fmtCompact(validator.m_dTotalStake, "")} / ${fmtCompact(validator.m_dTotalDelegation, "")}`);
    setText("validatorCapacityText", capacityMax > 0 ? `${fmtCompact(capacity, "")} / ${fmtCompact(capacityMax, " FLR")}` : "-");
    setText("validatorCapacityPct", Number.isFinite(capacityPct) ? `${fmtNum(capacityPct, 1)}% full` : "-");
    setText("validatorTimeLeftPct", Number.isFinite(leftPct) ? `${fmtNum(leftPct, 1)}% of staking period left` : "-");
    setBar("validatorStakeCapacity", capacityPct);
    setBar("validatorTimeLeft", leftPct);
    if (!latestData?.staking?.stakeWithUptime && validator.m_dTotalStake != null) setText("stakedFlr", fmtCompact(validator.m_dTotalStake, " FLR"));
    setText("stakeEnd", stakeEnd);
    setText("stakeTimeLeft", timeLeft);
    if (!recentFtsoAvailability().length) renderUptime(uptimeValues);
    if (providerData) renderEntityAddresses(providerData, validator);
    renderValidatorDelegators(node);
    renderValidatorEpochTable(node);
    renderValidatorRewardChart(node);
  }

  function applyFtsoExplorerData(data) {
    ftsoExplorerData = data;
    const uptime = recentFtsoAvailability();
    if (uptime.length) renderUptime(uptime);
  }

  function applyFtsoEntityData(data) {
    ftsoEntityData = data;
    const policy = data?.denormalizedsigningpolicy || {};
    const totalWeight = policy.weight;
    const delegatedWeight = policy.w_nat_weight ?? policy.w_nat_capped_weight;
    const stakingWeight = policy.staking_weight;
    const fee = policy.delegation_fee_bips;

    setText("ftsoWeight", totalWeight != null ? fmtWeight(totalWeight) : "-");
    setText("votePower", totalWeight != null ? fmtWeight(totalWeight) : "-");
    setText("delegationWeight", delegatedWeight != null ? fmtWeight(delegatedWeight) : "-");
    setText("stakeWeight", stakingWeight != null ? fmtWeight(stakingWeight) : "-");
    if (fee != null) setText("ftsoFee", `${fmtNum(Number(fee) / 100, 2)}%`);
  }

  function applyProviderV2Data(data) {
    const wrapped = findProviderV2Data(data);
    if (!wrapped) return;
    if (wrapped.m_xTimestamp) {
      setText("lastUpdated", formatRelativeTime(wrapped.m_xTimestamp));
      lastUpdatedSet = true;
    }
    const usd = Number(wrapped.m_xCurrencyUSDInfo?.m_dValue);
    const eur = Number(wrapped.m_xCurrencyEURInfo?.m_dValue);
    if (Number.isFinite(usd)) prices.USD = usd;
    if (Number.isFinite(eur)) prices.EUR = eur;
    setPriceDisplay(activePriceCurrency);
  }

  async function loadPrice() {
    try {
      const [usdRes, eurRes] = await Promise.allSettled([
        fetchJsonWithCache(FLR_PRICE_URL, CACHE_TTLS.price),
        fetchJsonWithCache(FLR_PRICE_EUR_URL, CACHE_TTLS.price)
      ]);
      if (usdRes.status === "fulfilled") {
        const price = Number(usdRes.value?.data?.amount);
        if (Number.isFinite(price)) prices.USD = price;
      }
      if (eurRes.status === "fulfilled") {
        const price = Number(eurRes.value?.data?.amount);
        if (Number.isFinite(price)) prices.EUR = price;
      }
      setPriceDisplay(activePriceCurrency);
    } catch (_) {
      setPriceDisplay(activePriceCurrency);
    }
  }

  async function load() {
    try {
      let provider = null;
      try {
        const v2Data = await fetchJsonWithCache(PROVIDERS_V2_URL, CACHE_TTLS.provider);
        applyProviderV2Data(v2Data);
        provider = findProviderDeep(v2Data);
      } catch (_) {}

      if (!provider) {
        provider = findProviderDeep(await fetchJsonWithCache(API_URL, CACHE_TTLS.provider));
      }

      if (!provider) throw new Error("MirSFlr provider not found");
      providerData = provider;
      latestData = latestEpoch(provider);
      applyData(providerData, latestData);
      if (!lastUpdatedSet) setText("lastUpdated", formatRelativeTime(new Date()));
      clearLiveErrors();
    } catch (error) {
      setText("status", "Delayed");
      showLiveError();
    }
  }

  async function loadValidator() {
    try {
      const data = await fetchJsonWithCache(VALIDATORS_URL, CACHE_TTLS.validator);
      validatorData = findValidatorDeep(data);
      applyValidatorData(validatorData);
    } catch (_) {
      setText("validatorConnected", "Delayed");
      document.querySelectorAll("[data-render='validator-epoch-table']").forEach(tbody => {
        renderTableEmpty(tbody, "Validator reward history could not be loaded.");
      });
    }
  }

  async function loadFtsoExplorer() {
    try {
      applyFtsoExplorerData(await fetchJsonWithCache(FTSO_EXPLORER_URL, CACHE_TTLS.explorer));
    } catch (_) {}
  }

  async function loadFtsoEntity() {
    try {
      applyFtsoEntityData(await fetchJsonWithCache(FTSO_ENTITY_URL, CACHE_TTLS.explorer));
    } catch (_) {
      applyFtsoEntityData(FTSO_ENTITY_SNAPSHOT);
    }
  }

  async function loadProviderV2() {
    try {
      applyProviderV2Data(await fetchJsonWithCache(PROVIDERS_V2_URL, CACHE_TTLS.provider));
    } catch (_) {}
  }

  function bindCopy() {
    document.addEventListener("click", event => {
      const btn = event.target.closest("[data-copy]");
      if (!btn) return;
      const key = btn.getAttribute("data-copy");
      const value = key === "delegation" ? (providerData?.delegationAddress || TARGET_DELEGATION)
        : key === "identity" ? (providerData?.voterAddress || TARGET_VOTER)
        : key === "email" ? CONTACT_EMAIL
        : key;
      copyFromButton(value, btn);
    });

    document.addEventListener("click", event => {
      const btn = event.target.closest("[data-retry-live]");
      if (!btn) return;
      clearLiveErrors();
      setLoadingState();
      load();
      loadValidator();
      loadFtsoExplorer();
      loadFtsoEntity();
      loadPrice();
    });

    document.addEventListener("click", event => {
      const btn = event.target.closest("[data-price-currency]");
      if (!btn) return;
      setPriceDisplay(btn.getAttribute("data-price-currency") || "EUR");
    });
  }

  function init() {
    bindCopy();
    enhanceTooltips();
    enhanceCopyButtons();
    restoreCurrencyPreference();
    setLoadingState();
    load();
    loadValidator();
    loadFtsoExplorer();
    loadFtsoEntity();
    loadPrice();
    window.addEventListener("resize", () => {
      if (providerData) renderRewardChart(providerData);
    });
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", MirSFlr.init);
