// Flat-key JSON catalogs in src/i18n/<locale>.json. English is bundled, the others load on demand.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import en from "../i18n/en.json";

export const LOCALES: { code: string; name: string }[] = [
  { code: "de", name: "Deutsch" }, { code: "en", name: "English" }, { code: "it", name: "Italiano" }, { code: "fr", name: "Français" },
  { code: "es", name: "Español" }, { code: "ja", name: "日本語" }, { code: "ko", name: "한국어" }, { code: "zh-CN", name: "简体中文" },
  { code: "zh-TW", name: "繁體中文" }, { code: "ar", name: "العربية" }, { code: "tr", name: "Türkçe" }, { code: "pt-BR", name: "Português (Brasil)" },
  { code: "pt-PT", name: "Português (Portugal)" }, { code: "el", name: "Ελληνικά" }, { code: "ru", name: "Русский" }, { code: "hr", name: "Hrvatski" },
  { code: "nb", name: "Norsk bokmål" }, { code: "sv", name: "Svenska" }, { code: "fi", name: "Suomi" }, { code: "da", name: "Dansk" },
  { code: "pl", name: "Polski" }, { code: "sk", name: "Slovenčina" }, { code: "cs", name: "Čeština" }, { code: "hu", name: "Magyar" },
  { code: "ro", name: "Română" }, { code: "he", name: "עברית" }, { code: "ga", name: "Gaeilge" }, { code: "nl", name: "Nederlands" },
  { code: "id", name: "Bahasa Indonesia" }, { code: "th", name: "ไทย" }, { code: "vi", name: "Tiếng Việt" }, { code: "hi", name: "हिन्दी" },
  { code: "uk", name: "Українська" },
];
const CODES = LOCALES.map((l) => l.code);
const RTL = ["ar", "he"];
const loaders = import.meta.glob(["../i18n/*.json", "!../i18n/en.json"], { import: "default" }) as Record<string, () => Promise<Record<string, string>>>;

export function detectLocale(): string {
  const list = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"]).map((l) => l.toLowerCase());
  for (const l of list) {
    if (l.startsWith("zh")) return /tw|hk|mo|hant/.test(l) ? "zh-TW" : "zh-CN";
    if (l.startsWith("pt")) return l.startsWith("pt-br") ? "pt-BR" : "pt-PT";
    if (l.startsWith("nb") || l.startsWith("no") || l.startsWith("nn")) return "nb";
    if (l === "iw" || l.startsWith("iw-")) return "he";
    if (l === "in" || l.startsWith("in-")) return "id";
    const base = l.split("-")[0];
    if (CODES.includes(base)) return base;
  }
  return "en";
}

type Vars = Record<string, string | number>;
interface I18nCtx { lang: string; choice: string; setChoice: (c: string) => void; t: (key: string, vars?: Vars) => string; dir: "ltr" | "rtl" }
const Ctx = createContext<I18nCtx>(null as any);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<string>(() => localStorage.getItem("bmh.lang") || "auto");
  const lang = choice === "auto" || !CODES.includes(choice) ? detectLocale() : choice;
  const [dict, setDict] = useState<Record<string, string>>(en);
  useEffect(() => {
    let alive = true;
    if (lang === "en") setDict(en);
    else loaders[`../i18n/${lang}.json`]?.().then((d) => alive && setDict(d)).catch(() => setDict(en));
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL.includes(lang) ? "rtl" : "ltr";
    return () => { alive = false; };
  }, [lang]);
  const setChoice = useCallback((c: string) => {
    localStorage.setItem("bmh.lang", c === "auto" ? "auto" : c);
    setChoiceState(c);
  }, []);
  const t = useCallback((key: string, vars?: Vars) => {
    let s = dict[key] ?? (en as Record<string, string>)[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  }, [dict]);
  const value = useMemo(() => ({ lang, choice, setChoice, t, dir: (RTL.includes(lang) ? "rtl" : "ltr") as "ltr" | "rtl" }), [lang, choice, setChoice, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useI18n = () => useContext(Ctx);
