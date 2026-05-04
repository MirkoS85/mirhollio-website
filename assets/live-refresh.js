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

  function bindPanelAccordion() {
    const buttons = [...document.querySelectorAll("[data-panel-toggle]")];
    const panels = new Map(
      [...document.querySelectorAll("[data-accordion-panel]")].map(panel => [panel.id, panel])
    );
    if (!buttons.length || !panels.size) return;

    function syncButtons(openId) {
      buttons.forEach(button => {
        const targetId = button.getAttribute("data-panel-toggle");
        const expanded = targetId === openId;
        button.setAttribute("aria-expanded", expanded ? "true" : "false");
        button.textContent = expanded
          ? (button.getAttribute("data-close-label") || "Hide panel")
          : (button.getAttribute("data-open-label") || "Open panel");
      });
    }

    function setOpenPanel(openId, { scroll = false } = {}) {
      panels.forEach((panel, id) => {
        panel.hidden = id !== openId;
        panel.closest(".role-choice")?.classList.toggle("panel-open", id === openId);
      });
      syncButtons(openId);

      if (scroll && openId) {
        const panel = panels.get(openId);
        const target = panel?.closest(".role-choice") || panel;
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }

    buttons.forEach(button => {
      button.addEventListener("click", () => {
        const targetId = button.getAttribute("data-panel-toggle");
        const isOpen = button.getAttribute("aria-expanded") === "true";
        const nextId = isOpen ? "" : targetId;
        setOpenPanel(nextId, { scroll: !isOpen });

        if (nextId) {
          history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${nextId}`);
        } else {
          history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        }
      });
    });

    const hashId = window.location.hash.replace("#", "");
    if (hashId && panels.has(hashId)) {
      setOpenPanel(hashId);
    } else {
      setOpenPanel("");
    }
  }

  function boot() {
    formatFlrUnits();
    simplifyConditionDots();
    tightenLongValues();
    formatPassStrikeValues();
    bindPanelAccordion();

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
