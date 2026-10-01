(function () {
  const targets = [
    ".metric strong",
    ".card strong",
    ".validator-foot strong",
    // These two were left out, so "1.53M FLR" stayed one run of text and
    // broke at the space - the unit dropped to a second line at full size
    // instead of sitting small beside the figure.
    ".hero-live-tile strong",
    ".snap-metric strong"
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
      if (el.classList.contains("pre-reg-value")) return;
      el.classList.remove("metric-tight", "metric-ultra-tight");

      // A value with a unit used to be exempt, because the unit sat on its own
      // line and the number alone always fitted. The unit is inline now, so
      // "19,777.45 FLR" has to be measured whole or it runs past the card.
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

    // A tap anywhere else dismisses whichever tip is open.
    if (prefersTouch) {
      document.addEventListener("click", event => {
        if (!event.target.closest(".info-tip")) closeAllTouchTips();
      });
    }

    buttons.forEach(button => {
      ["pointerenter", "mouseenter", "focus"].forEach(type => {
        button.addEventListener(type, () => positionInfoTip(button));
      });

      if (prefersTouch) {
        // Holding the button to read the tip is what let iOS start a text
        // selection on it, and the tip then stayed up behind the selection
        // handles until that was dismissed — the ten seconds of it hanging
        // around. Tap to open, tap again or anywhere else to close.
        button.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();
          const wasOpen = button.classList.contains("info-touch-active");
          closeAllTouchTips();
          if (!wasOpen) {
            button.classList.add("info-touch-active");
            positionInfoTip(button);
          }
        });

        button.addEventListener("pointercancel", () => closeTouchTip(button));
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

    // These rows are born empty. If operator.js already wrote the epoch and
    // the status before this ran - which is what happened on every page but
    // the home page - nothing would ever fill them again.
    window.__replayFields?.();
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

  // Keyboard and screen-reader users had to walk the whole sidebar nav on every
  // page before reaching the content. Injected here rather than pasted into
  // eight files, the same way the back-to-top button already is.
  function bindSkipLink() {
    if (document.querySelector(".skip-link")) return;
    const main = document.querySelector("main");
    if (!main) return;
    if (!main.id) main.id = "main-content";
    const link = document.createElement("a");
    link.className = "skip-link";
    link.href = `#${main.id}`;
    link.textContent = "Skip to content";
    link.addEventListener("click", () => {
      main.setAttribute("tabindex", "-1");
      main.focus({ preventScroll: false });
    });
    document.body.insertBefore(link, document.body.firstChild);
  }

  function bindBackToTop() {
    const button = document.createElement("button");
    button.className = "back-to-top";
    button.type = "button";
    button.setAttribute("aria-label", "Back to top");
    // A solid pink "Top" pill sat on top of whatever was being read. An arrow
    // in a glass disc says the same thing and gets out of the way.
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 19V6M12 5l-7 7M12 5l7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
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

  function syncLatestHistoryScroll(root = document) {
    if (!window.matchMedia("(max-width: 620px)").matches) return;

    const conditionWrappers = root.querySelectorAll
      ? [...root.querySelectorAll(".condition-history-wrap")]
      : [];
    const rewardWrappers = [...document.querySelectorAll("[data-render='reward-chart'], [data-render='validator-reward-chart']")]
      .map(svg => svg.closest(".reward-chart-wrap"))
      .filter(Boolean);
    const wrappers = [
      ...conditionWrappers,
      ...rewardWrappers
    ];

    wrappers.forEach(wrapper => {
      const svg = wrapper.querySelector("svg");
      const table = wrapper.querySelector("table");
      const signature = [
        wrapper.scrollWidth,
        wrapper.clientWidth,
        svg?.innerHTML.length || 0,
        table?.rows.length || 0,
        table?.textContent.length || 0
      ].join(":");

      if (wrapper.dataset.latestScrollSignature === signature) return;
      wrapper.dataset.latestScrollSignature = signature;

      window.requestAnimationFrame(() => {
        const maxScroll = wrapper.scrollWidth - wrapper.clientWidth;
        if (maxScroll > 4) wrapper.scrollLeft = maxScroll;
      });
    });
  }

  function bindPullToRefresh() {
    const isTouchDevice = window.matchMedia("(pointer: coarse)").matches
      || navigator.maxTouchPoints > 0
      || "ontouchstart" in window;
    if (!isTouchDevice || document.querySelector(".pull-refresh-indicator")) return;

    const threshold = 88;
    const maxOffset = 72;
    let startY = 0;
    let currentY = 0;
    let active = false;
    let eligible = false;
    let refreshing = false;

    const indicator = document.createElement("div");
    indicator.className = "pull-refresh-indicator";
    indicator.setAttribute("role", "status");
    indicator.setAttribute("aria-live", "polite");
    indicator.setAttribute("aria-label", "Pull to refresh");
    indicator.innerHTML = '<span aria-hidden="true"></span>';
    document.body.appendChild(indicator);

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
      indicator.setAttribute("aria-label", distance >= threshold ? "Release to refresh" : "Pull to refresh");
    }

    function resetIndicator() {
      active = false;
      eligible = false;
      startY = 0;
      currentY = 0;
      indicator.classList.remove("is-ready");
      indicator.style.setProperty("--pull-refresh-offset", "0px");
      indicator.style.setProperty("--pull-refresh-progress", "0");
      indicator.setAttribute("aria-label", "Pull to refresh");
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
        indicator.setAttribute("aria-label", "Refreshing");
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

    // Initial state. A panel marked data-accordion-open starts open: the epoch
    // page's whole purpose is reward history, and it was hiding that history
    // behind a click, so a visitor evaluating the provider met two headings and
    // two buttons. A matching URL hash still wins, as before.
    const hashId = window.location.hash.replace("#", "");
    buttons.forEach(button => {
      const targetId = button.getAttribute("data-panel-toggle");
      const openByDefault = panels.get(targetId)?.hasAttribute("data-accordion-open");
      setPanelState(button, Boolean(hashId ? targetId === hashId : openByDefault));
    });
    if (hashId) history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }

  function bindPageTransitions() {
    // Keep page navigation direct. The previous fade-out made sidebar clicks feel slow.
  }

  /* =========================================================================
     Motion layer.

     Presentation only. Nothing here reads, derives or alters a value; the
     count-up ends on exactly the string that was already on the page, and
     operator.js cancels a running one before it writes a new value (see
     writeField). All of it is off under prefers-reduced-motion.
     ========================================================================= */

  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** A hairline across the top that fills as the page scrolls. */
  function bindScrollProgress() {
    if (REDUCED || document.querySelector(".scroll-progress")) return;
    const bar = document.createElement("div");
    bar.className = "scroll-progress";
    bar.setAttribute("aria-hidden", "true");
    document.body.appendChild(bar);

    let queued = false;
    function update() {
      queued = false;
      const doc = document.documentElement;
      const span = doc.scrollHeight - window.innerHeight;
      const ratio = span > 160 ? Math.min(1, Math.max(0, window.scrollY / span)) : 0;
      bar.style.setProperty("--progress", ratio.toFixed(4));
      bar.classList.toggle("on", span > 160 && window.scrollY > 24);
    }
    const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    update();
  }

  /* Blocks that rise into place on first sight. Grid children are staggered
     so a row of tiles arrives as a row. */
  const REVEAL_GROUPS = [
    ".section > .inner > .section-title",
    ".hero-panels > .panel",
    ".hero-live-strip > *",
    ".proof-grid > *",
    ".cards > *",
    ".panel-mini-grid > *",
    ".home-snap-metrics > *",
    ".why-grid > *",
    ".address-grid > *",
    ".chart-panel",
    ".validator-panel > .panel-wide-card",
    ".flow > .step",
    ".qa",
    ".cta-band"
  ];

  function bindReveal() {
    if (REDUCED || !("IntersectionObserver" in window)) return;

    const seen = new WeakSet();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const node = entry.target;
        observer.unobserve(node);
        node.classList.add("reveal-in");
        // Take the class off once it has played. A transform left on an
        // ancestor turns it into the containing block for the position:fixed
        // info tips, which would then open in the wrong place.
        const clear = () => {
          node.classList.remove("reveal", "reveal-in");
          node.style.removeProperty("--reveal-delay");
        };
        node.addEventListener("transitionend", clear, { once: true });
        window.setTimeout(clear, 1400);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.04 });

    REVEAL_GROUPS.forEach(selector => {
      const groups = new Map();
      document.querySelectorAll(selector).forEach(node => {
        if (seen.has(node) || node.closest(".reveal")) return;
        seen.add(node);
        const parent = node.parentElement;
        const position = groups.get(parent) ?? 0;
        groups.set(parent, position + 1);
        // Anything already on screen at load skips the entrance: a block that
        // faded in under the user's thumb would read as a glitch.
        const box = node.getBoundingClientRect();
        if (box.top < window.innerHeight * 0.9) return;
        node.classList.add("reveal");
        if (position) node.style.setProperty("--reveal-delay", `${Math.min(position, 5) * 0.06}s`);
        observer.observe(node);
      });
    });
  }

  /* Numbers that climb to their value the first time they are seen. The value
     is never computed here - the final frame writes back the exact string that
     was already rendered, and the grouping and decimal separators are taken
     from the locale the page is formatted in. */
  const COUNT_SELECTORS = [".proof-tile .pv", ".p-big", ".hero-live-tile strong", ".metric > strong", ".compact-stat > strong", "article.card > strong"];

  function localeSeparators() {
    try {
      const parts = new Intl.NumberFormat().formatToParts(12345.6);
      return {
        group: parts.find(part => part.type === "group")?.value ?? ",",
        decimal: parts.find(part => part.type === "decimal")?.value ?? "."
      };
    } catch (_) {
      return { group: ",", decimal: "." };
    }
  }

  function bindCountUp() {
    if (REDUCED || !("IntersectionObserver" in window)) return;
    const { group, decimal } = localeSeparators();

    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        run(entry.target);
      }
    }, { threshold: 0.3 });

    function parse(text) {
      // Leading symbol ($, #, ~), the number, then whatever trails it (%, M,
      // " FLR"). Ratios, addresses and dates are left alone.
      if (/[/:]|0x/.test(text)) return null;
      const escape = ch => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`^([^0-9+-]*)([+-]?[0-9${escape(group)}${escape(decimal)}]*[0-9])(.*)$`, "s");
      const match = text.match(pattern);
      if (!match) return null;
      const [, prefix, digits, suffix] = match;
      const decimals = digits.includes(decimal) ? digits.length - digits.lastIndexOf(decimal) - 1 : 0;
      const value = Number(digits.split(group).join("").replace(decimal, "."));
      if (!Number.isFinite(value) || value === 0 || Math.abs(value) > 1e12) return null;
      return { prefix, suffix, decimals, value };
    }

    function run(node) {
      const final = node.textContent;
      const parsed = parse(final.trim());
      if (!parsed) return;
      const format = new Intl.NumberFormat(undefined, {
        minimumFractionDigits: parsed.decimals,
        maximumFractionDigits: parsed.decimals
      });

      let cancelled = false;
      // operator.js calls this before writing a new value, so a live update
      // during the animation wins instead of being overwritten by the last
      // frame of a stale one.
      node.__countCancel = () => { cancelled = true; node.__countCancel = null; };

      const DURATION = 680;
      const started = performance.now();
      function frame(now) {
        if (cancelled) return;
        const t = Math.min(1, (now - started) / DURATION);
        const eased = 1 - Math.pow(1 - t, 3);
        if (t >= 1) {
          node.textContent = final;
          node.__countCancel = null;
          return;
        }
        node.textContent = parsed.prefix + format.format(parsed.value * eased) + parsed.suffix;
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }

    COUNT_SELECTORS.forEach(selector => {
      document.querySelectorAll(selector).forEach(node => {
        if (node.dataset.counted) return;
        const text = node.textContent.trim();
        if (!text || text === "-" || text === "\u2013") return;
        node.dataset.counted = "1";
        observer.observe(node);
      });
    });
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
    bindSkipLink();
    bindBackToTop();
    syncLatestHistoryScroll();
    bindPullToRefresh();
    bindPageTransitions();
    bindScrollProgress();
    bindReveal();
    // Values arrive asynchronously; counting up a dash is pointless, so this
    // runs once the first render has had a chance to land.
    window.setTimeout(bindCountUp, 1200);

    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === "childList" || mutation.type === "characterData") {
          formatFlrUnits();
          simplifyConditionDots();
          tightenLongValues();
          formatPassStrikeValues();
          labelPreRegisteredStatus();
          labelValidatorSnapshotStatus();
          syncLatestHistoryScroll();
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
