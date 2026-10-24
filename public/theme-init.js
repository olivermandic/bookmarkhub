// Applies the theme before React starts (avoids a white flash in dark mode).
// Default: follow the system setting; a manual choice is stored in localStorage.
(function () {
  try {
    var t = localStorage.getItem("theme");
    var dark = t === "dark" || (t !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.add(dark ? "dark" : "light");
  } catch (e) { /* ignore */ }
})();
