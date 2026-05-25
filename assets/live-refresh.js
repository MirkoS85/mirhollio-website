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
      el.textContent = `${Number(match[1])} / ${Number(match[2])}`;
      el.dataset.previewPasses = "true";
    });
  }

  function bindPanelAccordion() {
    const buttons = [...document.querySelectorAll("[data-panel-toggle]")];
    const panels = new Map(
      [...document.querySelectorAll("[data-accordion-panel]")].map(panel => [panel.id, panel])
    );
    if (!buttons.length || !panels.size) return;

    function setPanelState(button, expanded) {
      const targetId = button.getAttribute("data-panel-toggle");
      const panel = panels.get(targetId);
      if (!panel) return;

      panel.hidden = !expanded;
      panel.closest(".role-choice")?.classList.toggle("panel-open", expanded);
      button.setAttribute("aria-expanded", expanded ? "true" : "false");
      button.textContent = expanded
        ? (button.getAttribute("data-close-label") || "Hide panel")
        : (button.getAttribute("data-open-label") || "Open panel");
    }

    buttons.forEach(button => {
      button.addEventListener("click", () => {
        const isOpen = button.getAttribute("aria-expanded") === "true";
        setPanelState(button, !isOpen);
        history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      });
    });

    const hashId = window.location.hash.replace("#", "");
    buttons.forEach(button => {
      const targetId = button.getAttribute("data-panel-toggle");
      setPanelState(button, hashId && targetId === hashId);
    });
    if (hashId) history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }

  function bindPageTransitions() {
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;

    document.addEventListener("click", event => {
      const link = event.target.closest("a[href]");
      if (!link) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (link.target && link.target !== "_self") return;
      if (link.hasAttribute("download")) return;

      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      event.preventDefault();
      document.body.classList.add("page-leaving");
      window.setTimeout(() => {
        window.location.href = url.href;
      }, 120);
    });
  }

  function boot() {
    formatFlrUnits();
    simplifyConditionDots();
    tightenLongValues();
    formatPassStrikeValues();
    bindPanelAccordion();
    bindPageTransitions();

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
