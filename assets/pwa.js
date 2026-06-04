(function () {
  let deferredPrompt = null;

  function inStandaloneMode() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function isLikelyIos() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent || "");
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function ensureInstallControls() {
    const side = document.querySelector(".side");
    if (side && !side.querySelector("[data-install-app]")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "install-app-button";
      button.dataset.installApp = "true";
      button.hidden = true;
      button.textContent = "Install app";

      const liveStats = side.querySelector(".side-live");
      const nav = side.querySelector(".nav");
      if (liveStats) {
        liveStats.insertAdjacentElement("afterend", button);
      } else if (nav) {
        nav.insertAdjacentElement("afterend", button);
      }
    }

    const mobileNav = document.querySelector(".mobile-links");
    if (mobileNav && !mobileNav.querySelector("[data-install-app]")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "install-app-button mobile-install-app";
      button.dataset.installApp = "true";
      button.hidden = true;
      button.textContent = "Install app";
      mobileNav.appendChild(button);
    }
  }

  function syncInstallButtons() {
    ensureInstallControls();
    const installed = inStandaloneMode();
    const canPrompt = !installed && (!!deferredPrompt || isLikelyIos());
    document.querySelectorAll("[data-install-app]").forEach(button => {
      button.hidden = !canPrompt;
      button.disabled = false;
      button.setAttribute("aria-hidden", canPrompt ? "false" : "true");
    });
  }

  async function promptInstall() {
    if (inStandaloneMode()) return;
    if (!deferredPrompt) {
      showToast(isLikelyIos() ? "Use Share, then Add to Home Screen" : "Use the browser menu to install this app");
      return;
    }

    await deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } catch (_) {
      // No-op: browser controls the install flow.
    }
    deferredPrompt = null;
    syncInstallButtons();
  }

  function bindInstallButtons() {
    document.addEventListener("click", event => {
      const button = event.target.closest("[data-install-app]");
      if (!button) return;
      event.preventDefault();
      promptInstall().catch(() => {});
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }, { once: true });
  }

  function init() {
    ensureInstallControls();
    bindInstallButtons();
    registerServiceWorker();
    syncInstallButtons();

    window.addEventListener("beforeinstallprompt", event => {
      deferredPrompt = event;
      syncInstallButtons();
      showToast("App install is available");
    });

    window.addEventListener("appinstalled", () => {
      deferredPrompt = null;
      syncInstallButtons();
      showToast("App installed");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
