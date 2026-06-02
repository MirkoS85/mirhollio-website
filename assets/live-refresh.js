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

  function positionInfoTip(button) {
    const tooltip = button.querySelector("span");
    if (!tooltip) return;

    const margin = 16;
    const gap = 10;
    const buttonRect = button.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const width = Math.min(tooltipRect.width || 280, window.innerWidth - margin * 2);
    const height = tooltipRect.height || 120;
    const preferredLeft = buttonRect.right - width;
    const left = Math.max(margin, Math.min(preferredLeft, window.innerWidth - width - margin));
    let top = buttonRect.top - height - gap;

    if (top < margin) top = Math.min(buttonRect.bottom + gap, window.innerHeight - height - margin);
    top = Math.max(margin, top);

    tooltip.style.setProperty("--tip-left", `${Math.round(left)}px`);
    tooltip.style.setProperty("--tip-top", `${Math.round(top)}px`);
  }

  function bindInfoTips() {
    const buttons = [...document.querySelectorAll(".info-tip")];
    if (!buttons.length) return;
    const prefersTouch = window.matchMedia("(pointer: coarse)").matches
      || window.matchMedia("(max-width: 620px)").matches
      || navigator.maxTouchPoints > 0
      || "ontouchstart" in window;

    function closeTouchTip(button) {
      button.classList.remove("info-touch-active");
      button.blur();
    }

    function closeAllTouchTips() {
      buttons.forEach(closeTouchTip);
    }

    buttons.forEach(button => {
      ["pointerenter", "mouseenter", "focus"].forEach(type => {
        button.addEventListener(type, () => positionInfoTip(button));
      });

      if (prefersTouch) {
        const openTip = event => {
          closeAllTouchTips();
          button.classList.add("info-touch-active");
          positionInfoTip(button);
          button.setPointerCapture?.(event.pointerId);
        };

        button.addEventListener("pointerdown", openTip);
        button.addEventListener("touchstart", openTip, { passive: true });

        ["pointerup", "pointercancel", "pointerleave", "lostpointercapture", "touchend", "touchcancel"].forEach(type => {
          button.addEventListener(type, () => closeTouchTip(button));
        });

        button.addEventListener("click", () => {
          window.setTimeout(() => closeTouchTip(button), 0);
        });
      }
    });

    ["scroll", "resize"].forEach(type => {
      window.addEventListener(type, () => {
        closeAllTouchTips();
        const active = document.querySelector(".info-tip:hover, .info-tip:focus-visible");
        if (active) positionInfoTip(active);
      }, { passive: true });
    });
  }

  function bindMobileNav() {
    const mobileTop = document.querySelector(".mobile-top");
    const row = mobileTop?.querySelector(".mobile-row");
    const nav = mobileTop?.querySelector(".mobile-links");
    if (!mobileTop || !row || !nav || row.querySelector(".mobile-nav-toggle")) return;

    const navId = nav.id || "mobile-navigation";
    nav.id = navId;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "mobile-nav-toggle";
    toggle.setAttribute("aria-label", "Open navigation");
    toggle.setAttribute("aria-controls", navId);
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = "<span></span><span></span><span></span>";

    const delegateButton = row.querySelector(".btn");
    row.insertBefore(toggle, delegateButton || null);

    function setOpen(open) {
      document.body.classList.toggle("mobile-nav-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    }

    toggle.addEventListener("click", event => {
      event.stopPropagation();
      setOpen(!document.body.classList.contains("mobile-nav-open"));
    });

    nav.querySelectorAll("a").forEach(link => {
      link.addEventListener("click", () => setOpen(false));
    });

    document.addEventListener("click", event => {
      if (!document.body.classList.contains("mobile-nav-open")) return;
      if (mobileTop.contains(event.target)) return;
      setOpen(false);
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") setOpen(false);
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 620) setOpen(false);
    }, { passive: true });
  }

  function bindBackToTop() {
    const button = document.createElement("button");
    button.className = "back-to-top";
    button.type = "button";
    button.setAttribute("aria-label", "Back to top");
    button.textContent = "Top";
    document.body.appendChild(button);

    function update() {
      button.classList.toggle("is-visible", window.scrollY > 520);
    }

    button.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
      button.blur();
    });
    window.addEventListener("scroll", update, { passive: true });
    update();
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
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;
        setPanelState(button, !isOpen);
        history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));
        window.setTimeout(() => window.scrollTo(scrollX, scrollY), 80);
        window.setTimeout(() => window.scrollTo(scrollX, scrollY), 280);
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
    bindMobileNav();
    bindInfoTips();
    bindBackToTop();
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
