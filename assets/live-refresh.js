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

  function labelPreRegisteredStatus(root = document) {
    root.querySelectorAll("[data-field='preRegisteredStatus']").forEach(el => {
      const raw = (el.textContent || "").trim().toLowerCase();
      let label = "Pre-reg unknown";
      let state = "unknown";

      if (raw === "pre-reg" || raw === "pre-registered" || raw === "yes") {
        label = "Pre-registered";
        state = "ok";
      } else if (raw === "no pre-reg" || raw === "not pre-registered" || raw === "no") {
        label = "Not pre-registered";
        state = "bad";
      }

      el.dataset.mobileLabel = label;
      el.dataset.mobileStatus = state;
    });
  }

  function labelValidatorSnapshotStatus(root = document) {
    root.querySelectorAll(".snap-metric strong[data-field='validatorConnected']").forEach(el => {
      const raw = (el.textContent || "").trim().toLowerCase();
      let label = raw ? el.textContent.trim() : "Unknown";
      let state = "unknown";

      if (raw === "connected") {
        label = "Connected";
        state = "ok";
      } else if (raw === "offline" || raw === "not exposed") {
        label = el.textContent.trim();
        state = "bad";
      }

      el.dataset.mobileLabel = label;
      el.dataset.mobileStatus = state;
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

  function createShellLiveStats(className) {
    const block = document.createElement("div");
    block.className = `shell-live ${className}`;
    block.setAttribute("aria-label", "Live site stats");
    block.innerHTML = `
      <div class="shell-live-row">
        <span>FLR price</span>
        <strong data-field="flrPrice">-</strong>
      </div>
      <div class="shell-live-row">
        <span>Epoch</span>
        <strong data-field="latestEpoch">-</strong>
      </div>
      <div class="shell-live-row">
        <span>FTSO status</span>
        <strong class="shell-live-status"><i aria-hidden="true"></i><b data-field="status">Loading</b></strong>
      </div>
    `;
    return block;
  }

  function injectShellLiveStats() {
    const primaryNav = document.querySelector(".side .nav");
    if (primaryNav && !document.querySelector(".side-live")) {
      primaryNav.insertAdjacentElement("afterend", createShellLiveStats("side-live"));
    }

    const mobileNav = document.querySelector(".mobile-links");
    if (mobileNav && !mobileNav.querySelector(".mobile-live")) {
      mobileNav.appendChild(createShellLiveStats("mobile-live"));
    }
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

    row.insertBefore(toggle, row.firstElementChild || null);

    function syncTopHeight() {
      const height = Math.ceil(mobileTop.getBoundingClientRect().height || 0);
      if (height > 0) document.documentElement.style.setProperty("--mobile-top-height", `${height}px`);
    }

    function setOpen(open) {
      document.body.classList.toggle("mobile-nav-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
      window.requestAnimationFrame(syncTopHeight);
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
      syncTopHeight();
    }, { passive: true });

    if ("ResizeObserver" in window) {
      new ResizeObserver(syncTopHeight).observe(mobileTop);
    }
    window.requestAnimationFrame(syncTopHeight);
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

  function bindPullToRefresh() {
    const isTouchDevice = window.matchMedia("(pointer: coarse)").matches
      || navigator.maxTouchPoints > 0
      || "ontouchstart" in window;
    if (!isTouchDevice || document.querySelector(".pull-refresh-indicator")) return;

    const threshold = 92;
    const maxOffset = 82;
    let startY = 0;
    let currentY = 0;
    let active = false;
    let eligible = false;
    let refreshing = false;

    const indicator = document.createElement("div");
    indicator.className = "pull-refresh-indicator";
    indicator.setAttribute("role", "status");
    indicator.setAttribute("aria-live", "polite");
    indicator.innerHTML = '<span aria-hidden="true"></span><strong>Pull to refresh</strong>';
    document.body.appendChild(indicator);

    const label = indicator.querySelector("strong");

    function atPageTop() {
      const scrollTop = Math.max(
        window.scrollY || 0,
        document.documentElement.scrollTop || 0,
        document.body.scrollTop || 0
      );
      return scrollTop <= 2;
    }

    function setIndicator(distance) {
      const offset = Math.min(Math.max(distance * 0.54, 0), maxOffset);
      const progress = Math.min(Math.max(distance / threshold, 0), 1);
      indicator.style.setProperty("--pull-refresh-offset", `${Math.round(offset)}px`);
      indicator.style.setProperty("--pull-refresh-progress", progress.toFixed(3));
      indicator.classList.toggle("is-ready", distance >= threshold);
      label.textContent = distance >= threshold ? "Release to refresh" : "Pull to refresh";
    }

    function resetIndicator() {
      active = false;
      eligible = false;
      startY = 0;
      currentY = 0;
      indicator.classList.remove("is-ready");
      indicator.style.setProperty("--pull-refresh-offset", "0px");
      indicator.style.setProperty("--pull-refresh-progress", "0");
      label.textContent = "Pull to refresh";
    }

    document.addEventListener("touchstart", event => {
      if (refreshing || event.touches.length !== 1) return;
      if (document.body.classList.contains("mobile-nav-open")) return;
      if (!atPageTop()) return;

      eligible = true;
      active = false;
      startY = event.touches[0].clientY;
      currentY = startY;
    }, { passive: true });

    document.addEventListener("touchmove", event => {
      if (!eligible || refreshing || event.touches.length !== 1) return;

      currentY = event.touches[0].clientY;
      const distance = currentY - startY;
      if (distance <= 0) {
        resetIndicator();
        return;
      }

      if (!active && !atPageTop()) return;
      if (distance > 8) active = true;
      if (!active) return;

      event.preventDefault();
      setIndicator(distance);
    }, { passive: false });

    document.addEventListener("touchend", () => {
      if (!eligible) return;

      const distance = currentY - startY;
      if (active && distance >= threshold) {
        refreshing = true;
        indicator.classList.add("is-refreshing");
        indicator.classList.remove("is-ready");
        indicator.style.setProperty("--pull-refresh-offset", `${maxOffset}px`);
        indicator.style.setProperty("--pull-refresh-progress", "1");
        label.textContent = "Refreshing";
        window.setTimeout(() => window.location.reload(), 180);
        return;
      }

      resetIndicator();
    }, { passive: true });

    document.addEventListener("touchcancel", () => {
      if (!refreshing) resetIndicator();
    }, { passive: true });
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
    // Keep page navigation direct. The previous fade-out made sidebar clicks feel slow.
  }

  function boot() {
    formatFlrUnits();
    simplifyConditionDots();
    tightenLongValues();
    formatPassStrikeValues();
    labelPreRegisteredStatus();
    labelValidatorSnapshotStatus();
    bindPanelAccordion();
    injectShellLiveStats();
    bindMobileNav();
    bindInfoTips();
    bindBackToTop();
    bindPullToRefresh();
    bindPageTransitions();

    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === "childList" || mutation.type === "characterData") {
          formatFlrUnits();
          simplifyConditionDots();
          tightenLongValues();
          formatPassStrikeValues();
          labelPreRegisteredStatus();
          labelValidatorSnapshotStatus();
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
