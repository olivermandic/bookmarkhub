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
