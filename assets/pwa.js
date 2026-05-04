(function () {
  let deferredPrompt = null;

  function inStandaloneMode() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function syncInstallButtons() {
    const installed = inStandaloneMode();
    document.querySelectorAll("[data-install-app]").forEach(button => {
      const canPrompt = !!deferredPrompt && !installed;
      button.hidden = !canPrompt;
      button.disabled = !canPrompt;
      button.setAttribute("aria-hidden", canPrompt ? "false" : "true");
    });
  }

  async function promptInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
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
    bindInstallButtons();
    registerServiceWorker();
    syncInstallButtons();

    window.addEventListener("beforeinstallprompt", event => {
      event.preventDefault();
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
