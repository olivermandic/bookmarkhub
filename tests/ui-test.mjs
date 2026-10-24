// UI regression test (not part of the Docker build). Needs: npm i playwright (any folder) + browsers.
// Usage: BMH_URL=http://localhost:3999/ BMH_USER=admin BMH_PASS=... OUT=./shots node tests/ui-test.mjs
// Covers Oliver's app standard: iPhone top edge (Safari tab + Home-Screen PWA, insets 47/59/62, DPR 3),
// bottom safe area, no horizontal overflow at 320-430 px (de/en/ar/ja), iPad, Android, dark, RTL, GDPR.
// Run only against a TEST instance (it starts - but never completes - a 2FA setup for the test user).
import { webkit, chromium, devices } from "playwright";
import fs from "node:fs";
const URL = process.env.BMH_URL || "http://localhost:3999/";
const USER = process.env.BMH_USER || "admin"; const PASS = process.env.BMH_PASS;
const OUT = process.env.OUT || "./shots"; fs.mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, cond, info = "") => { results.push({ name, pass: !!cond, info }); if (!cond || process.env.VERBOSE) console.log(`${cond ? "PASS" : "FAIL"} ${name} ${info}`); };
const iphone = devices["iPhone 15 Pro"]; // 393x659 viewport, screen 393x852, DPR 3, WebKit

async function login(page) {
  await page.goto(URL); await page.waitForSelector('input[autocomplete="username"]');
  await page.fill('input[autocomplete="username"]', USER); await page.fill('input[type="password"]', PASS);
  await page.keyboard.press("Enter"); await page.waitForSelector(".toolbar", { timeout: 10000 });
}
let storageState;
{ const b = await chromium.launch(); const ctx = await b.newContext(); const p = await ctx.newPage(); await login(p); storageState = await ctx.storageState(); await b.close(); }

function initScript({ sat, sab, standalone, lang, theme }) {
  return `(() => {
    try {
      ${lang ? `localStorage.setItem("bmh.lang", ${JSON.stringify(lang)});` : `localStorage.removeItem("bmh.lang");`}
      ${theme ? `localStorage.setItem("bmh.theme", ${JSON.stringify(theme)});` : ""}
      const sim = () => { const r = document.documentElement; ${sat != null ? `r.style.setProperty("--sim-sat", "${sat}px");` : ""} ${sab != null ? `r.style.setProperty("--sim-sab", "${sab}px");` : ""} };
      // documentElement does not exist yet when init scripts run: set the simulated insets the moment it appears (before theme-init.js)
      if (document.documentElement) sim(); else new MutationObserver((m, o) => { if (document.documentElement) { sim(); o.disconnect(); } }).observe(document, { childList: true });
      ${standalone ? `Object.defineProperty(Navigator.prototype, "standalone", { get: () => true });
        const mm = window.matchMedia.bind(window);
        window.matchMedia = (q) => /display-mode:\\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent() { return false; } } : mm(q);` : ""}
    } catch (e) {}
  })();`;
}

async function chromeState(page) {
  return page.evaluate(() => {
    const s = document.querySelector(".status-strip"), t = document.querySelector(".toolbar"), sc = document.querySelector(".scroll-area");
    const alpha = (c) => { if (!c || c === "transparent") return 0; const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 1; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; };
    const chain = (e) => { const a = []; for (let x = e; x && x.nodeType === 1; x = x.parentElement) a.push(x); return a; };
    const bf = (e) => { const c = getComputedStyle(e); return (c.backdropFilter && c.backdropFilter !== "none") || (c.webkitBackdropFilter && c.webkitBackdropFilter !== "none"); };
    const sr = s.getBoundingClientRect(), tr = t.getBoundingClientRect(), cr = sc.getBoundingClientRect();
    const W = innerWidth;
    const atStrip = sr.height >= 2 ? document.elementFromPoint(W / 2, Math.floor(sr.height / 2)) : null;
    const atToolbar = document.elementFromPoint(8, tr.top + 4);
    return {
      stripH: sr.height, stripTop: sr.top, toolbarTop: tr.top, toolbarBottom: tr.bottom, contentTop: cr.top,
      docScroll: [window.scrollX, window.scrollY, document.scrollingElement.scrollTop, document.scrollingElement.scrollLeft],
      stripAlpha: alpha(getComputedStyle(s).backgroundColor), toolbarAlpha: alpha(getComputedStyle(t).backgroundColor), htmlAlpha: alpha(getComputedStyle(document.documentElement).backgroundColor),
      backdrop: [...chain(s), ...chain(t), ...t.querySelectorAll("*")].some(bf),
      textShadow: [t, ...t.querySelectorAll("*")].some((e) => { const v = getComputedStyle(e).textShadow; return v && v !== "none"; }),
      translucent: [...chain(t)].some((e) => parseFloat(getComputedStyle(e).opacity) < 1),
      stripHit: atStrip ? atStrip.classList.contains("status-strip") : true,
      toolbarHit: !!(atToolbar && atToolbar.closest(".toolbar")),
    };
  });
}

async function edgeCase(browser, { mode, sat, sab = 34, expectSat = sat, theme = "dark" }) {
  const ctx = await browser.newContext({ ...iphone, storageState, colorScheme: theme });
  await ctx.addInitScript(initScript({ sat, sab, standalone: mode === "standalone", theme }));
  const page = await ctx.newPage(); await page.goto(URL); await page.waitForSelector(".toolbar"); await page.waitForTimeout(400);
  const tag = `${mode} ${theme} inset ${sat ?? "env0"}`;
  for (const scrolled of [false, true]) {
    if (scrolled) {
      await page.evaluate(() => { document.querySelector(".scroll-area").scrollTop = 600; window.scrollTo(200, 300); document.scrollingElement.scrollTop = 300; document.scrollingElement.scrollLeft = 200; });
      await page.keyboard.press("End").catch(() => {}); await page.waitForTimeout(250);
    }
    const c = await chromeState(page); const st = `${tag} ${scrolled ? "scrolled" : "top"}`;
    ok(`${st}: strip height == inset (${expectSat})`, c.stripH === expectSat && c.stripTop === 0, JSON.stringify({ h: c.stripH, top: c.stripTop }));
    ok(`${st}: toolbar top == inset`, c.toolbarTop === expectSat, String(c.toolbarTop));
    ok(`${st}: integer offsets`, Number.isInteger(c.stripH) && Number.isInteger(c.toolbarTop));
    ok(`${st}: content starts below toolbar`, Math.abs(c.contentTop - c.toolbarBottom) < 0.5, `${c.contentTop} vs ${c.toolbarBottom}`);
    ok(`${st}: document never scrolls`, c.docScroll.every((v) => v === 0), JSON.stringify(c.docScroll));
    ok(`${st}: opaque strip/toolbar/html`, c.stripAlpha === 1 && c.toolbarAlpha === 1 && c.htmlAlpha === 1 && !c.translucent);
    ok(`${st}: no backdrop-filter / text-shadow`, !c.backdrop && !c.textShadow);
    ok(`${st}: status-bar area is the strip`, c.stripHit && c.toolbarHit);
  }
  await page.evaluate(() => { const s = document.querySelector(".scroll-area"); s.scrollTop = s.scrollHeight; }); await page.waitForTimeout(200);
  const bottom = await page.evaluate(() => { const f = document.querySelector("footer a"); const sab = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sim-sab")) || 0; return { fb: f.getBoundingClientRect().bottom, limit: innerHeight - sab }; });
  ok(`${tag}: footer above bottom inset`, bottom.fb <= bottom.limit + 0.5, JSON.stringify(bottom));
  if (sat === 59 && theme === "dark") await page.screenshot({ path: `${OUT}/iphone-${mode}-inset59-bottom.png` });
  await ctx.close();
}

// ---- (a)+(b) iPhone top edge, WebKit DPR 3 ----
{
  const b = await webkit.launch();
  for (const mode of ["browser", "standalone"]) for (const sat of [47, 59, 62]) await edgeCase(b, { mode, sat });
  await edgeCase(b, { mode: "browser", sat: 59, theme: "light" });
  await edgeCase(b, { mode: "standalone", sat: 59, theme: "light" });
  // iOS 26.x bug: standalone, env() reports 0 -> JS fallback must add the real status bar (393x852 -> 59)
  await edgeCase(b, { mode: "standalone", sat: null, sab: null, expectSat: 59 });
  // Safari tab where Safari itself keeps the page below the status bar (env 0, page not full-screen) -> no extra strip
  await edgeCase(b, { mode: "browser", sat: null, sab: null, expectSat: 0 });
  const ctx = await b.newContext({ ...iphone, storageState, colorScheme: "dark" }); const page = await ctx.newPage();
  await page.goto(URL); await page.waitForSelector(".toolbar"); await page.waitForLoadState("networkidle"); await page.waitForTimeout(800);
  ok("webkit dpr3", (await page.evaluate(() => window.devicePixelRatio)) === 3);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok("dark theme is truly dark", Math.max(...bg.match(/\d+/g).slice(0, 3).map(Number)) < 30, bg);
  const footer = await page.evaluate(() => { const a = [...document.querySelectorAll("footer a")].find((x) => x.href.includes("olivermandic.de")); return a ? a.closest("footer").textContent : ""; });
  ok("footer © link olivermandic.de", footer.includes("©"));
  const man = await page.evaluate(async () => (await fetch(document.querySelector('link[rel="manifest"]').href)).json());
  ok("manifest icons 192+512+maskable", ["192x192", "512x512"].every((s) => man.icons.some((i) => i.sizes === s)) && man.icons.some((i) => (i.purpose || "").includes("maskable")));
  const ati = await page.evaluate(() => document.querySelector('link[rel="apple-touch-icon"]')?.href);
  const atiRes = await page.request.get(ati); ok("apple-touch-icon served", atiRes.ok() && (atiRes.headers()["content-type"] || "").includes("png"));
  await ctx.close(); await b.close();
}

// ---- (c) no horizontal overflow ----
const overflowCheck = () => {
  const W = document.documentElement.clientWidth || innerWidth; const bad = [];
  const desc = (e) => (e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).slice(0, 3).join(".") : "") + " '" + (e.textContent || "").trim().slice(0, 20) + "'");
  if (document.documentElement.scrollWidth > W) bad.push(`document scrollWidth ${document.documentElement.scrollWidth} > ${W}`);
  const sc = document.querySelector(".scroll-area"); if (sc && sc.scrollWidth > sc.clientWidth + 1) bad.push(`scroll-area scrollWidth ${sc.scrollWidth} > ${sc.clientWidth}`);
  const visible = (e) => { const r = e.getBoundingClientRect(); if (r.width <= 1 || r.height <= 1) return false; const c = getComputedStyle(e); return c.visibility !== "hidden" && c.display !== "none"; };
  for (const e of document.querySelectorAll('[data-testid="toolbar"] *, [data-testid="filter-row"] *, dialog[open] *, [role="menu"] *')) {
    if (!visible(e) || e.closest(".sr-only")) continue; const r = e.getBoundingClientRect();
    if (r.left < -0.5 || r.right > W + 0.5) bad.push(`outside viewport: ${desc(e)} [${Math.round(r.left)},${Math.round(r.right)}]`);
  }
  for (const e of document.querySelectorAll('[data-testid="toolbar"] *, [data-testid="filter-row"], [data-testid="filter-row"] *')) if (e.scrollWidth > e.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(e).overflowX)) bad.push(`sideways scroller: ${desc(e)}`);
  for (const e of document.querySelectorAll(".app-shell *")) {
    if (!visible(e) || e.closest(".sr-only")) continue; const r = e.getBoundingClientRect();
    if (r.left >= -0.5 && r.right <= W + 0.5) continue;
    let clipped = false; for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const ox = getComputedStyle(p).overflowX; if (ox !== "visible" && !p.classList.contains("scroll-area")) { const pr = p.getBoundingClientRect(); if (pr.left >= -0.5 && pr.right <= W + 0.5) { clipped = true; break; } } }
    if (!clipped) bad.push(`sticks out: ${desc(e)} [${Math.round(r.left)},${Math.round(r.right)}]`);
  }
  return [...new Set(bad)].slice(0, 6);
};
async function noOverflow(page, name) { const bad = await page.evaluate(overflowCheck); ok(name, bad.length === 0, bad.join(" | ")); }

async function overflowRun(browserType, ctxOpts, label, langs, deep) {
  const b = await browserType.launch(); const errors = [];
  for (const lang of langs) {
    const ctx = await b.newContext({ ...ctxOpts, storageState }); await ctx.addInitScript(initScript({ lang, sat: ctxOpts.isMobile ? 59 : null, sab: ctxOpts.isMobile ? 34 : null }));
    const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(e.message));
    const tag = `${label} ${lang}`; const isPhone = /iPhone|Android/.test(label);
    await page.goto(URL); await page.waitForSelector('[data-testid="filter-row"]'); await page.waitForTimeout(500);
    await noOverflow(page, `${tag} home: no horizontal overflow`);
    const hdr = await page.evaluate(() => { const items = [...document.querySelectorAll('[data-testid="toolbar"] > div > *')].filter((e) => e.getBoundingClientRect().width > 1).map((e) => e.getBoundingClientRect()); for (let i = 1; i < items.length; i++) if ((document.dir === "rtl" ? items[i - 1].left < items[i].right - 0.5 : items[i].left < items[i - 1].right - 0.5)) return false; return true; });
    ok(`${tag} header items don't overlap`, hdr);
    if (isPhone) {
      const rows = await page.evaluate(() => { const fr = document.querySelector('[data-testid="filter-row"]'); const [chips, rest] = fr.children; return chips.getBoundingClientRect().bottom <= rest.getBoundingClientRect().top + 0.5; });
      ok(`${tag} chips and sort on separate rows`, rows);
    }
    if (deep) {
      await page.locator('[data-testid="toolbar"] button[aria-haspopup="menu"]').click(); await page.waitForTimeout(250);
      await noOverflow(page, `${tag} account menu inside viewport`);
      await page.keyboard.press("Escape"); await page.mouse.click(5, 400); await page.waitForTimeout(150);
      await page.locator('[data-testid="toolbar"] .btn-primary').click(); await page.waitForSelector("dialog[open]"); await page.waitForTimeout(300);
      await noOverflow(page, `${tag} add dialog: no overflow`);
      const dlgTop = await page.evaluate(() => document.querySelector("dialog[open]").getBoundingClientRect().top);
      ok(`${tag} dialog below status bar`, dlgTop >= (ctxOpts.isMobile ? 59 : 0), String(dlgTop));
      await page.keyboard.press("Escape"); await page.waitForTimeout(200);
      for (const route of ["settings", "admin"]) { await page.goto(URL + "#/" + route); await page.waitForTimeout(900); await noOverflow(page, `${tag} ${route}: no overflow`); }
      await page.goto(URL + "#/settings"); await page.waitForTimeout(700);
      const fileInput = page.locator('input[type="file"][accept*=".html"]');
      if (await fileInput.count()) {
        await fileInput.setInputFiles({ name: "bookmarks.html", mimeType: "text/html", buffer: Buffer.from('<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3>Ein sehr langer Ordnername für die Vorschau-Prüfung</H3><DL><p><DT><A HREF="https://example.com/a/very/long/path/that/should/never/overflow/the/viewport/on/small/phones/index.html">Example mit einem extrem langen Titel, der umbrechen muss</A><DT><A HREF="https://github.com">GitHub</A></DL><p></DL>') });
        await page.waitForTimeout(600);
        await noOverflow(page, `${tag} import preview: no overflow`);
        if (label.includes("320") && lang === "de") await page.screenshot({ path: `${OUT}/import-preview-320-de.png` });
        await page.keyboard.press("Escape"); await page.waitForTimeout(200);
      } else ok(`${tag} import input found`, false);
      await page.goto(URL + "#/settings"); await page.waitForTimeout(700);
      const twofa = page.locator('[data-testid="twofa-enable"]');
      if (await twofa.count()) {
        await twofa.click(); await page.waitForTimeout(300);
        await noOverflow(page, `${tag} 2FA password step: no overflow`);
        const pw = page.locator('input[type="password"]').first();
        if (await pw.count()) { await pw.fill(PASS); await pw.press("Enter"); await page.waitForTimeout(900); }
        await noOverflow(page, `${tag} 2FA QR step: no overflow`);
        if (label.includes("320") && lang === "de") await page.screenshot({ path: `${OUT}/twofa-320-de.png` });
      } else ok(`${tag} 2FA button found`, false);
      await page.goto(URL); await page.waitForSelector(".toolbar"); await page.waitForTimeout(300);
      await page.keyboard.press("Control+k"); await page.waitForTimeout(300);
      if (await page.locator("dialog[open]").count()) await noOverflow(page, `${tag} palette: no overflow`);
    }
    if (["de", "ar", "ja"].includes(lang) && /320|390/.test(label)) { await page.goto(URL); await page.waitForSelector('[data-testid="filter-row"]'); await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/home-${label.replace(/\W+/g, "-")}-${lang}.png` }); }
    await ctx.close();
  }
  ok(`${label}: no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
  await b.close();
}
const langs = ["de", "en", "ar", "ja"];
for (const w of [320, 375, 390, 430]) await overflowRun(webkit, { viewport: { width: w, height: 760 }, screen: { width: w, height: 900 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: iphone.userAgent, colorScheme: "light" }, `iPhone ${w}px`, langs, true);
await overflowRun(webkit, { ...devices["iPad Pro 11"] }, "iPad portrait", langs, true);
await overflowRun(webkit, { ...devices["iPad Pro 11 landscape"] }, "iPad landscape", langs, false);
await overflowRun(chromium, { ...devices["Pixel 7"], viewport: { width: 412, height: 839 } }, "Android 412px", langs, true);

// ---- desktop: palette, GDPR, RTL, language loading ----
{
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", storageState });
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const external = []; page.on("request", (r) => { const u = new globalThis.URL(r.url()); if (u.origin !== new globalThis.URL(URL).origin && !u.protocol.startsWith("data")) external.push(r.url()); });
  await page.goto(URL); await page.waitForSelector(".toolbar"); await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/desktop-light.png` });
  await noOverflow(page, "desktop 1440: no overflow");
  await page.keyboard.press("Control+k"); await page.waitForTimeout(300);
  ok("Ctrl+K opens palette", await page.locator("dialog[open]").count() > 0); await page.keyboard.press("Escape");
  await page.goto(URL + "#/settings"); await page.waitForTimeout(600); await page.goto(URL + "#/admin"); await page.waitForTimeout(800);
  ok("no external requests (GDPR)", external.length === 0, external.slice(0, 3).join(" "));
  await page.evaluate(() => localStorage.setItem("bmh.lang", "ar")); await page.goto(URL); await page.waitForSelector(".toolbar"); await page.waitForTimeout(600);
  ok("arabic sets dir=rtl", (await page.evaluate(() => document.documentElement.dir)) === "rtl");
  await page.screenshot({ path: `${OUT}/desktop-rtl-ar.png` });
  await page.evaluate(() => localStorage.setItem("bmh.lang", "ja")); await page.reload(); await page.waitForTimeout(600);
  ok("japanese loads", (await page.evaluate(() => document.documentElement.lang)).startsWith("ja"));
  ok("desktop: no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await b.close();
}
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.pass); console.log(`${results.length - failed.length}/${results.length} passed`); process.exit(failed.length ? 1 : 0);
