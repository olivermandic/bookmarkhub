// Applies theme + text direction before React starts (no white flash in dark mode).
// Theme: follows the system unless a manual choice is stored in localStorage.
(function () {
  try {
    var t = localStorage.getItem("bmh.theme");
    var dark = t === "dark" || (t !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.add(dark ? "dark" : "light");
    var l = localStorage.getItem("bmh.lang");
    if (l === "ar" || l === "he") document.documentElement.dir = "rtl";
    // Make the apple-touch-icon absolute (iOS ignores <base> for it in some versions).
    var a = document.querySelector('link[rel="apple-touch-icon"]');
    if (a) a.setAttribute("href", a.href);
  } catch (e) { /* ignore */ }
})();

// iPhone top/bottom edge safety net (Oliver's app standard).
// The status strip normally uses env(safe-area-inset-top). Some iOS 26 builds report 0 although the
// page is drawn under the status bar (Safari tab with the floating tab bar, and the 26.1 PWA bug).
// Only in exactly that case we set --sat-fallback / --sab-fallback (CSS takes the max, so never a double inset).
(function () {
  var root = document.documentElement;
  var ua = navigator.userAgent || "";
  var iPhone = /iPhone|iPod/.test(ua);
  function px(prop, sim) {
    var d = document.createElement("div");
    d.style.cssText = "position:fixed;left:0;top:0;width:0;padding:0;border:0;box-sizing:content-box;visibility:hidden;pointer-events:none;height:var(" + sim + ",env(" + prop + ",0px))";
    root.appendChild(d);
    var v = Math.round(d.getBoundingClientRect().height);
    root.removeChild(d);
    return v;
  }
  function env() { return { top: px("safe-area-inset-top", "--sim-sat"), bottom: px("safe-area-inset-bottom", "--sim-sab") }; }
  function statusBarHeight(w, h) {
    var key = Math.min(w, h) + "x" + Math.max(w, h);
    var table = { "375x667": 20, "414x736": 20, "375x812": 50, "414x896": 48, "390x844": 47, "428x926": 47,
      "393x852": 59, "430x932": 59, "402x874": 62, "440x956": 62, "420x912": 62 };
    return table[key] || (Math.max(w, h) >= 870 ? 62 : 47);
  }
  function update() {
    var top = 0, bottom = 0;
    try {
      if (iPhone) {
        var standalone = navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
        var portrait = window.innerHeight > window.innerWidth;
        var vvTop = window.visualViewport ? window.visualViewport.offsetTop : 0;
        // Page reaches the physical top edge of the screen -> the status bar overlays it.
        var full = Math.round(window.innerHeight + vvTop) >= screen.height - 1;
        var e = env();
        if (portrait && e.top === 0 && (standalone || full)) top = statusBarHeight(screen.width, screen.height);
        // Safari tab with floating bottom bar overlaying the page: keep content clear of it.
        if (!standalone && full && e.bottom < 60) bottom = 80;
        else if (standalone && portrait && e.bottom === 0 && top >= 44) bottom = 34;
      }
    } catch (x) { /* ignore */ }
    root.style.setProperty("--sat-fallback", top + "px");
    root.style.setProperty("--sab-fallback", bottom + "px");
  }
  update();
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", function () { setTimeout(update, 300); });
})();
