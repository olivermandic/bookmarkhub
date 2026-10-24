// Fails the build when a translation catalog is incomplete or looks machine-garbled:
// missing/extra keys, placeholder mismatch, numbers missing from the source, odd length
// ratios, untranslated long strings and known hallucination patterns.
import fs from "node:fs";
import path from "node:path";

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "src", "i18n");
const LOCALES = "de en it fr es ja ko zh-CN zh-TW ar tr pt-BR pt-PT el ru hr nb sv fi da pl sk cs hu ro he ga nl id th vi hi uk".split(" ");
const CJK = new Set(["ja", "ko", "zh-CN", "zh-TW", "th"]);
const NON_LATIN = new Set(["ja", "ko", "zh-CN", "zh-TW", "th", "ar", "he", "el", "ru", "uk", "hi"]);
const en = JSON.parse(fs.readFileSync(path.join(dir, "en.json"), "utf8"));
const errors = [];
const err = (l, k, m) => errors.push(`${l} ${k}: ${m}`);
const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(",");
const nums = (s) => (s.match(/\d+/g) || []).sort().join(",");
// brand / technical words allowed to stay identical or in Latin script
const ALLOWED = /\b(?:BookmarkHub|URL|JSON|HTML|KB|QR|Chrome|Edge|Firefox|Safari|Aegis|2FAS|Google Authenticator|GitHub|iPhone|Ctrl|Esc|Enter|OK)\b|A–Z/g;
const HALLUCINATION = [/\b(regulation|directive|pursuant|hereby|article \d+|GDPR|EU)\b/i, /(\b\w{3,}\b)(\s+\1){2,}/i, /https?:\/\//, /<\/?[a-z]+>/i, /\?\?|�|\\n/];

for (const l of LOCALES) {
  const file = path.join(dir, `${l}.json`);
  if (!fs.existsSync(file)) { err(l, "-", "catalog missing"); continue; }
  let d;
  try { d = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { err(l, "-", `invalid JSON: ${e.message}`); continue; }
  for (const k of Object.keys(en)) {
    const s = en[k]; const v = d[k];
    if (typeof v !== "string" || !v.trim()) { err(l, k, "missing"); continue; }
    if (Object.values(d).some((x) => typeof x === "object")) err(l, k, "catalog must be flat");
    if (ph(v) !== ph(s)) err(l, k, `placeholders ${ph(v)} != ${ph(s)}`);
    if (nums(v) !== nums(s)) err(l, k, `numbers ${nums(v)} != ${nums(s)}`);
    if (l === "en") continue;
    const a = s.replace(ALLOWED, "").length || 1; const b = v.replace(ALLOWED, "").length;
    const r = b / a; const [lo, hi] = CJK.has(l) ? [0.15, 2.2] : [0.4, 2.8];
    if (s.length > 14 && (r < lo || r > hi)) err(l, k, `length ratio ${r.toFixed(2)}`);
    if (s.length > 14 && v === s) err(l, k, "identical to English (untranslated?)");
    for (const re of HALLUCINATION) if (re.test(v) && !re.test(s)) err(l, k, `suspicious pattern ${re}`);
    if (NON_LATIN.has(l)) {
      const latin = v.replace(ALLOWED, "").replace(/\{\w+\}/g, "").match(/[A-Za-z]{4,}/g);
      if (latin) err(l, k, `Latin words in non-Latin locale: ${latin.join(" ")}`);
    }
  }
  for (const k of Object.keys(d)) if (!(k in en)) err(l, k, "unknown key");
}
// keys used in the source code must exist
const src = path.join(dir, "..");
const used = new Set();
const walk = (p) => { for (const f of fs.readdirSync(p)) { const q = path.join(p, f); if (fs.statSync(q).isDirectory()) walk(q); else if (/\.tsx?$/.test(f)) for (const m of fs.readFileSync(q, "utf8").matchAll(/\bt\(\s*["'`]([\w.]+)["'`]/g)) used.add(m[1]); } };
walk(src);
for (const k of used) if (!(k in en)) err("src", k, "used in code but missing in en.json");

if (errors.length) { console.error(`i18n check failed (${errors.length}):\n` + errors.slice(0, 80).join("\n")); process.exit(1); }
console.log(`i18n check ok: ${LOCALES.length} locales × ${Object.keys(en).length} keys`);
