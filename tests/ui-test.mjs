// UI regression test (not part of the Docker build). Needs: npm i playwright (any folder) + browsers.
// Usage: BMH_URL=http://localhost:3999/ BMH_USER=admin BMH_PASS=... OUT=./shots node tests/ui-test.mjs
import { webkit, chromium, devices } from "playwright";
import fs from "node:fs";
const URL = process.env.BMH_URL || "http://localhost:3999/";
const USER = process.env.BMH_USER || "admin"; const PASS = process.env.BMH_PASS;
const OUT = process.env.OUT || "./shots"; fs.mkdirSync(OUT, { recursive: true });
const results = []; const ok = (name, cond, info = "") => { results.push({ name, pass: !!cond, info }); console.log(`${cond ? "PASS" : "FAIL"} ${name} ${info}`); };

async function login(page) {
  await page.goto(URL); await page.waitForSelector('input[autocomplete="username"]');
  await page.fill('input[autocomplete="username"]', USER); await page.fill('input[type="password"]', PASS);
  await page.keyboard.press("Enter"); await page.waitForSelector(".toolbar", { timeout: 10000 });
  await page.waitForTimeout(800);
}
async function chrome(page) {
  return page.evaluate(() => {
    const s = document.querySelector(".status-strip"), t = document.querySelector(".toolbar");
    const cs = (e) => getComputedStyle(e);
    const alpha = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 1; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; };
    return { stripH: s.getBoundingClientRect().height, toolbarTop: t.getBoundingClientRect().top,
      stripAlpha: alpha(cs(s).backgroundColor), toolbarAlpha: alpha(cs(t).backgroundColor),
      backdrop: [s, t].some((e) => (cs(e).backdropFilter || cs(e).webkitBackdropFilter || "none") !== "none") };
  });
}

// 1) iPhone, WebKit DPR 3: header regression with simulated notch inset (47px)
{
  const b = await webkit.launch(); const ctx = await b.newContext({ ...devices["iPhone 15 Pro"], colorScheme: "light" });
  const page = await ctx.newPage(); await login(page);
  ok("webkit dpr3", (await page.evaluate(() => window.devicePixelRatio)) === 3);
  await page.addStyleTag({ content: ":root{--sat:47px !important}" }); await page.waitForTimeout(200);
  const c = await chrome(page);
  ok("iphone status strip = inset", Math.abs(c.stripH - 47) < 0.5, JSON.stringify(c));
  ok("iphone toolbar top == inset", Math.abs(c.toolbarTop - 47) < 0.5);
  ok("chrome opaque, no backdrop-filter", c.stripAlpha === 1 && c.toolbarAlpha === 1 && !c.backdrop);
  await page.screenshot({ path: `${OUT}/iphone-light.png` });
  await page.emulateMedia({ colorScheme: "dark" }); await page.evaluate(() => { localStorage.setItem("bmh.theme", "system"); }); await page.reload(); await page.waitForSelector(".toolbar");
  await page.addStyleTag({ content: ":root{--sat:47px !important}" }); await page.waitForTimeout(500);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok("dark theme is truly dark", (() => { const n = bg.match(/\d+/g).slice(0, 3).map(Number); return Math.max(...n) < 30; })(), bg);
  await page.screenshot({ path: `${OUT}/iphone-dark.png` });
  // footer
  const footer = await page.evaluate(() => { const a = [...document.querySelectorAll("footer a")].find((x) => x.href.includes("olivermandic.de")); return a ? a.closest("footer").textContent : ""; });
  ok("footer © link olivermandic.de", footer.includes("©"), footer.trim().slice(0, 60));
  // manifest + icons
  const man = await page.evaluate(async () => { const l = document.querySelector('link[rel="manifest"]'); const r = await fetch(l.href); return r.json(); });
  ok("manifest icons 192+512+maskable", ["192x192", "512x512"].every((s) => man.icons.some((i) => i.sizes === s)) && man.icons.some((i) => (i.purpose || "").includes("maskable")));
  const ati = await page.evaluate(() => document.querySelector('link[rel="apple-touch-icon"]')?.href);
  const atiRes = await page.request.get(ati); ok("apple-touch-icon served", atiRes.ok() && (atiRes.headers()["content-type"] || "").includes("png"), ati);
  await b.close();
}
// 2) Desktop Chromium light/dark, palette, settings, admin; 3) RTL; 4) iPad window-mode reserve
{
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const external = []; page.on("request", (r) => { const u = new globalThis.URL(r.url()); if (u.origin !== new globalThis.URL(URL).origin && !u.protocol.startsWith("data")) external.push(r.url()); });
  await login(page); await page.screenshot({ path: `${OUT}/desktop-light.png` });
  await page.keyboard.press("Control+k"); await page.waitForTimeout(300);
  ok("Ctrl+K opens palette", await page.locator("dialog[open]").count() > 0);
  await page.keyboard.type("git"); await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/desktop-palette.png` }); await page.keyboard.press("Escape");
  await page.evaluate(() => localStorage.setItem("bmh.theme", "dark")); await page.reload(); await page.waitForSelector(".toolbar"); await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/desktop-dark.png` });
  await page.goto(URL + "#/settings"); await page.waitForTimeout(800); await page.screenshot({ path: `${OUT}/desktop-settings.png`, fullPage: true });
  await page.goto(URL + "#/admin"); await page.waitForTimeout(1200); await page.screenshot({ path: `${OUT}/desktop-admin.png`, fullPage: true });
  ok("no external requests (GDPR)", external.length === 0, external.slice(0, 3).join(" "));
  // RTL
  await page.evaluate(() => { localStorage.setItem("bmh.lang", "ar"); localStorage.setItem("bmh.theme", "light"); }); await page.goto(URL); await page.waitForSelector(".toolbar"); await page.waitForTimeout(800);
  ok("arabic sets dir=rtl", (await page.evaluate(() => document.documentElement.dir)) === "rtl");
  await page.screenshot({ path: `${OUT}/desktop-rtl-ar.png` });
  await page.evaluate(() => localStorage.setItem("bmh.lang", "ja")); await page.reload(); await page.waitForTimeout(800);
  ok("japanese loads", (await page.evaluate(() => document.documentElement.lang)).startsWith("ja"));
  await page.screenshot({ path: `${OUT}/desktop-ja.png` });
  await page.evaluate(() => localStorage.removeItem("bmh.lang"));
  ok("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  // mobile list + compact views, Android-ish
  const m = await b.newContext({ ...devices["Pixel 7"] }); const mp = await m.newPage(); await login(mp); await mp.screenshot({ path: `${OUT}/android-light.png` });
  await b.close();
}
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.pass); console.log(`${results.length - failed.length}/${results.length} passed`); process.exit(failed.length ? 1 : 0);
