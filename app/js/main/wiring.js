/**
 * Dekxitty - click wiring for static markup.
 *
 * index.html carries no inline handlers; instead, elements declare what they
 * do with data-act="<name>" (plus data-arg where needed) and this file binds
 * them. Handlers resolve their targets at click time (window.x && window.x()),
 * because the modules that define them (diffusion, mermaid, settings, ...) load
 * after this file.
 */
(function () {
  "use strict";

  const call = (name, ...args) => {
    const fn = window[name];
    return typeof fn === "function" ? fn(...args) : undefined;
  };
  const body = document.body;

  const ACTIONS = {
    "topbar-open":      () => call("setTopbarOpen", true),
    "topbar-close":     () => call("setTopbarOpen", false),
    "home":             () => call("showHomepage"),
    "fullscreen":       () => call("toggleFullscreen"),
    "expand-nav":       (el) => call("openExpandedNavigation", el.dataset.arg),
    "fm-nav-open":      () => body.classList.remove("fm-nav-closed"),
    "fm-nav-close":     () => body.classList.add("fm-nav-closed"),
    "fm-sidebar-toggle": () => body.classList.toggle("fm-sidebar-collapsed"),
    "settings":         () => call("openSettingsManager"),
    "debug":            () => call("debug"),
    "sync":             () => call("forceSyncToCloud"),
    "asteroid":         () => {
      if (typeof window.openAsteroidBelt === "function") window.openAsteroidBelt();
      else call("showNotification", "Asteroid belt \u2014 coming soon");
    },
    "diff-pick":        () => call("dexDiffPickFile"),
    "mermaid-pick":     () => call("dexMermaidPickFile"),
    "diff-bottom":      (el) => call("dexBottomClick", el.dataset.target, el),
    "mermaid-bottom":   (el) => call("dexMermaidBottomClick", el.dataset.target),
    "chain":            () => call("openChainPanel")
  };

  const CHANGE_ACTIONS = {
    "diffusion": () => call("diffusion")
  };

  function bind(root) {
    root.querySelectorAll("[data-act]").forEach((el) => {
      if (el.__dexWired) return;
      el.__dexWired = true;
      const act = ACTIONS[el.dataset.act];
      if (act) el.addEventListener("click", () => act(el));
    });
    root.querySelectorAll("[data-act-change]").forEach((el) => {
      if (el.__dexWiredChange) return;
      el.__dexWiredChange = true;
      const act = CHANGE_ACTIONS[el.dataset.actChange];
      if (act) el.addEventListener("change", () => act(el));
    });
  }

  // Loaded dynamically, so DOMContentLoaded may already be behind us.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => bind(document), { once: true });
  } else {
    bind(document);
  }
})();
