(function () {
  const targets = [
    ".metric strong",
    ".card strong",
    ".validator-foot strong"
  ];

  function formatFlrUnits(root = document) {
    root.querySelectorAll(targets.join(", ")).forEach(el => {
      if (el.querySelector(".metric-unit")) return;
      if (el.querySelector("small, br")) return;
      const raw = (el.textContent || "").trim();
      const match = raw.match(/^(.*?)(?:\s+)(FLR)$/);
      if (!match) return;
      const value = match[1].trim();
      el.innerHTML = `${value}<span class="metric-unit">${match[2]}</span>`;
    });
  }

  function tightenLongValues(root = document) {
    root.querySelectorAll(targets.join(", ")).forEach(el => {
      el.classList.remove("metric-tight", "metric-ultra-tight");
      if (el.querySelector(".metric-unit")) return;

      const raw = (el.textContent || "").replace(/\s+/g, "");
      if (raw.length >= 10) {
        el.classList.add(raw.length >= 12 ? "metric-ultra-tight" : "metric-tight");
      }
    });
  }

  function simplifyConditionDots(root = document) {
    root.querySelectorAll("[data-render='conditions']").forEach(mount => {
      const items = [...mount.children];
      if (!items.length) return;

      const alreadySimplified = mount.dataset.previewDots === "true"
        && items.length === 3
        && items.every(el => !(el.textContent || "").trim());

      if (alreadySimplified) return;

      const states = items.map(el => {
        if (el.classList.contains("ok")) return "ok";
        if (el.classList.contains("bad")) return "bad";
        return "unknown";
      });

      const okCount = states.filter(state => state === "ok").length;
      const badCount = states.filter(state => state === "bad").length;
      let summary = ["unknown", "unknown", "unknown"];

      if (okCount === states.length) {
        summary = ["ok", "ok", "ok"];
      } else if (badCount === states.length) {
        summary = ["bad", "bad", "bad"];
      } else {
        const greenDots = Math.max(0, Math.min(3, Math.round((okCount / states.length) * 3)));
        summary = summary.map((state, index) => index < greenDots ? "ok" : state);
        if (badCount > 0 && greenDots === 0) summary[0] = "bad";
      }

      mount.innerHTML = summary.map(state => `<span class="${state}" aria-hidden="true"></span>`).join("");
      mount.dataset.previewDots = "true";
    });
  }

  function formatPassStrikeValues(root = document) {
    root.querySelectorAll("[data-field='passes']").forEach(el => {
      if (el.dataset.previewPasses === "true") return;
      const raw = (el.textContent || "").trim();
      const match = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (!match) return;
      const passes = Number(match[1]);
      const strikes = Number(match[2]);
      const passLabel = passes === 1 ? "pass" : "passes";
      const strikeLabel = strikes === 1 ? "strike" : "strikes";
      el.textContent = `${passes} ${passLabel} / ${strikes} ${strikeLabel}`;
      el.dataset.previewPasses = "true";
    });
  }

  function boot() {
    formatFlrUnits();
    simplifyConditionDots();
    tightenLongValues();
    formatPassStrikeValues();

    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === "childList" || mutation.type === "characterData") {
          formatFlrUnits();
          simplifyConditionDots();
          tightenLongValues();
          formatPassStrikeValues();
          break;
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
