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

  function boot() {
    formatFlrUnits();

    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === "childList" || mutation.type === "characterData") {
          formatFlrUnits();
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
