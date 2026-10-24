// Theme: "system" follows prefers-color-scheme live; manual light/dark is stored locally.
export type Theme = "system" | "light" | "dark";
const mq = () => window.matchMedia("(prefers-color-scheme: dark)");
export function getTheme(): Theme { return (localStorage.getItem("bmh.theme") as Theme) || "system"; }
export function applyTheme(t: Theme) {
  if (t === "system") localStorage.removeItem("bmh.theme"); else localStorage.setItem("bmh.theme", t);
  const dark = t === "dark" || (t === "system" && mq().matches);
  const el = document.documentElement;
  el.classList.toggle("dark", dark); el.classList.toggle("light", !dark);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? "#0b0d12" : "#f6f7f9"));
}
export function watchSystemTheme() {
  const h = () => { if (getTheme() === "system") applyTheme("system"); };
  mq().addEventListener("change", h);
  return () => mq().removeEventListener("change", h);
}
