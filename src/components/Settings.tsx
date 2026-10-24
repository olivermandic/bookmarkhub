import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, FileUp, Monitor, Moon, ShieldCheck, ShieldOff, Sun, Upload } from "lucide-react";
import { api, type Bookmark, type Category, type User } from "@/lib/api";
import { LOCALES, useI18n } from "@/lib/i18n";
import { normUrl, parseImport, type ImportItem } from "@/lib/importParser";
import { useStore } from "@/lib/store";
import { applyTheme, getTheme, type Theme } from "@/lib/theme";
import { PasswordForm } from "./Login";
import { Field, Modal, Spinner, Switch, useToast } from "./ui";

export function Card({ title, desc, children, id }: { title: string; desc?: string; children: React.ReactNode; id?: string }) {
  return (
    <section className="card p-5 sm:p-6" id={id} aria-labelledby={id ? `${id}-h` : undefined}>
      <h2 id={id ? `${id}-h` : undefined} className="text-base font-semibold">{title}</h2>
      {desc && <p className="text-sm text-muted mt-1">{desc}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Settings() {
  const { t } = useI18n();
  const { user } = useStore();
  useEffect(() => { if (location.hash.includes("import")) document.getElementById("import")?.scrollIntoView(); }, []);
  if (!user) return null;
  return (
    <div className="mx-auto max-w-3xl px-3 sm:px-6 py-5 sm:py-8 flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight px-1">{t("nav.settings")}</h1>
      <Appearance />
      <Card title={t("password.change")} desc={t("settings.accountDesc", { name: user.username })}><div className="max-w-sm"><PasswordForm onDone={() => {}} /></div></Card>
      <TwoFactor />
      <ImportExport />
    </div>
  );
}

function Appearance() {
  const { t, choice, setChoice } = useI18n();
  const { savePrefs } = useStore();
  const [theme, setTheme] = useState<Theme>(getTheme());
  const set = (th: Theme) => { setTheme(th); applyTheme(th); savePrefs({ theme: th }).catch(() => {}); };
  const opt = (v: Theme, icon: JSX.Element) => (
    <button type="button" onClick={() => set(v)} aria-pressed={theme === v} className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border text-sm ${theme === v ? "border-accent bg-accent/10 text-fg" : "border-line hover:bg-surface-2 text-muted"}`}>{icon}{t(`theme.${v}`)}</button>
  );
  return (
    <Card title={t("settings.appearance")}>
      <div className="label">{t("theme.label")}</div>
      <div className="flex gap-2 mb-5">{opt("system", <Monitor size={20} />)}{opt("light", <Sun size={20} />)}{opt("dark", <Moon size={20} />)}</div>
      <Field label={t("settings.language")} htmlFor="lang">
        <select id="lang" className="input" value={choice} onChange={(e) => { setChoice(e.target.value); savePrefs({ language: e.target.value }).catch(() => {}); }}>
          <option value="auto">{t("settings.languageAuto")}</option>
          {LOCALES.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.name}</option>)}
        </select>
      </Field>
    </Card>
  );
}

function TwoFactor() {
  const { t } = useI18n();
  const toast = useToast();
  const { user, setUser } = useStore();
  const [step, setStep] = useState<"idle" | "password" | "scan" | "codes" | "disable" | "regen">("idle");
  const [password, setPassword] = useState(""); const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string; otpauthUrl: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  const close = () => { setStep("idle"); setPassword(""); setCode(""); setSetup(null); };
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e: any) { toast(e.message.includes("password") ? t("password.wrongCurrent") : e.message.includes("code") ? t("login.badCode") : e.message, "error"); } finally { setBusy(false); } };
  const enabled = !!user?.twoFactorEnabled;
  const download = () => {
    const blob = new Blob([`BookmarkHub – ${t("twofa.recoveryTitle")}\n${user?.username}\n\n${codes.join("\n")}\n`], { type: "text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "bookmarkhub-recovery-codes.txt"; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <Card title={t("twofa.title")} desc={t("twofa.desc")}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${enabled ? "text-ok" : "text-muted"}`}>{enabled ? <ShieldCheck size={18} /> : <ShieldOff size={18} />}{enabled ? t("twofa.on") : t("twofa.off")}</span>
        <span className="flex-1" />
        {enabled ? (<>
          <button className="btn-outline" onClick={() => setStep("regen")}>{t("twofa.newCodes")}</button>
          <button className="btn-outline text-danger" onClick={() => setStep("disable")}>{t("twofa.disable")}</button>
        </>) : <button className="btn-primary" data-testid="twofa-enable" onClick={() => setStep("password")}>{t("twofa.enable")}</button>}
      </div>
      {!enabled && user?.isAdmin && <p className="text-sm text-warn mt-3">{t("twofa.adminRecommend")}</p>}

      <Modal open={step !== "idle"} onClose={close} title={t("twofa.title")}>
        {(step === "password" || step === "disable" || step === "regen") && (
          <form onSubmit={(e) => { e.preventDefault(); run(async () => {
            if (step === "password") { setSetup(await api("/me/2fa/setup", { method: "POST", body: { password } })); setStep("scan"); }
            else if (step === "regen") { const r = await api<{ recoveryCodes: string[] }>("/me/2fa/recovery-codes", { method: "POST", body: { password } }); setCodes(r.recoveryCodes); setStep("codes"); }
            else { setUser(await api<User>("/me/2fa/disable", { method: "POST", body: { password, code } })); toast(t("twofa.disabled")); close(); }
          }); }}>
            <input type="text" autoComplete="username" className="hidden" aria-hidden tabIndex={-1} readOnly value={user?.username || ""} />
            <Field label={t("password.current")} htmlFor="tf-pw"><input id="tf-pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus /></Field>
            {step === "disable" && <Field label={t("login.code")} htmlFor="tf-code" hint={t("login.recoveryHint")}><input id="tf-code" className="input" dir="ltr" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required /></Field>}
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={close}>{t("common.cancel")}</button><button className={step === "disable" ? "btn-danger" : "btn-primary"} disabled={busy}>{busy && <Spinner size={16} />}{t("common.continue")}</button></div>
          </form>
        )}
        {step === "scan" && setup && (
          <form onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await api<User & { recoveryCodes: string[] }>("/me/2fa/enable", { method: "POST", body: { code } }); setUser(r); setCodes(r.recoveryCodes); setStep("codes"); }); }}>
            <ol className="text-sm list-decimal ps-5 space-y-1 mb-4"><li>{t("twofa.step1")}</li><li>{t("twofa.step2")}</li></ol>
            <div className="mx-auto w-52 h-52 rounded-xl bg-white p-2.5" role="img" aria-label={t("twofa.qrAlt")} dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
            <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted">{t("twofa.manual")}</summary><code className="block mt-2 p-2.5 rounded-lg bg-surface-2 break-all text-xs" dir="ltr">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code></details>
            <Field label={t("login.code")} htmlFor="tf-c"><input id="tf-c" className="input text-center tracking-[0.3em] text-lg mt-1" dir="ltr" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required autoFocus /></Field>
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={close}>{t("common.cancel")}</button><button className="btn-primary" disabled={busy}>{busy && <Spinner size={16} />}{t("twofa.activate")}</button></div>
          </form>
        )}
        {step === "codes" && (
          <div>
            <h3 className="font-semibold">{t("twofa.recoveryTitle")}</h3>
            <p className="text-sm text-muted mt-1 mb-3">{t("twofa.recoveryText")}</p>
            <div className="grid grid-cols-2 gap-2 font-mono text-sm p-3 rounded-xl bg-surface-2" dir="ltr">{codes.map((c) => <span key={c}>{c}</span>)}</div>
            <div className="flex flex-wrap justify-end gap-2 mt-4">
              <button className="btn-outline" onClick={() => { navigator.clipboard?.writeText(codes.join("\n")); toast(t("common.copied")); }}><Copy size={16} />{t("common.copy")}</button>
              <button className="btn-outline" onClick={download}><Download size={16} />{t("common.download")}</button>
              <button className="btn-primary" onClick={close}>{t("common.done")}</button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

function ImportExport() {
  const { t } = useI18n();
  const toast = useToast();
  const { bookmarks, categories, setCategories, refresh } = useStore();
  const [items, setItems] = useState<ImportItem[] | null>(null); const [fileName, setFileName] = useState("");
  const [shared, setShared] = useState(false); const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const existing = useMemo(() => new Set(bookmarks.map((b) => normUrl(b.url))), [bookmarks]);
  const analysis = useMemo(() => {
    if (!items) return null;
    const seen = new Set<string>(); let dup = 0; let invalid = 0; const fresh: (ImportItem & { dup: boolean })[] = []; const cats = new Map<string, number>();
    for (const it of items) {
      const k = normUrl(it.url);
      if (!k) { invalid++; continue; }
      const d = existing.has(k) || seen.has(k); seen.add(k);
      if (d) dup++;
      else if (it.category) cats.set(it.category, (cats.get(it.category) || 0) + 1);
      fresh.push({ ...it, dup: d });
    }
    const known = new Set(categories.map((c) => c.name.toLowerCase()));
    return { total: items.length, dup, invalid, add: fresh.filter((x) => !x.dup).length, rows: fresh, cats: [...cats.entries()], newCats: [...cats.keys()].filter((c) => !known.has(c.toLowerCase())).length };
  }, [items, existing, categories]);

  const onFile = async (f: File) => {
    try { const text = await f.text(); const parsed = parseImport(text); setFileName(f.name); setItems(parsed); if (!parsed.length) toast(t("import.nothing"), "error"); }
    catch { toast(t("import.unreadable"), "error"); }
  };
  const doImport = async () => {
    if (!items) return; setBusy(true);
    try {
      const r = await api<{ created: number; skipped: number; invalid: number; categoriesCreated: number }>("/import", { method: "POST", body: { items, isShared: shared } });
      toast(t("import.done", { created: r.created, skipped: r.skipped }));
      setItems(null); await refresh();
      setCategories(await api<Category[]>("/categories"));
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  return (
    <Card id="import" title={t("import.title")} desc={t("import.desc")}>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => fileRef.current?.click()}><FileUp size={17} />{t("import.choose")}</button>
        <a className="btn-outline" href="api/export" download><Upload size={17} />{t("export.button")}</a>
        <input ref={fileRef} type="file" accept=".html,.htm,.json,text/html,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      </div>
      <p className="text-xs text-muted mt-3">{t("import.howto")}</p>
      <Modal open={!!analysis} onClose={() => setItems(null)} title={t("import.preview")} wide
        footer={<><button className="btn-ghost" onClick={() => setItems(null)}>{t("common.cancel")}</button><button className="btn-primary" disabled={busy || !analysis?.add} onClick={doImport}>{busy && <Spinner size={16} />}{t("import.confirm", { n: analysis?.add || 0 })}</button></>}>
        {analysis && (<>
          <p className="text-sm text-muted mb-3 break-all">{fileName}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {[[t("import.found"), analysis.total], [t("import.new"), analysis.add], [t("import.duplicates"), analysis.dup], [t("import.newCategories"), analysis.newCats]].map(([l, n]) => (
              <div key={String(l)} className="rounded-xl bg-surface-2 p-3"><div className="text-xl font-semibold tabular-nums">{n}</div><div className="text-xs text-muted">{l}</div></div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-4 mb-3"><span className="text-sm font-medium">{t("import.shareAll")}</span><Switch checked={shared} onChange={setShared} label={t("import.shareAll")} /></div>
          <div className="max-h-72 overflow-y-auto rounded-xl border border-line divide-y divide-line text-sm">
            {analysis.rows.slice(0, 300).map((r, i) => (
              <div key={i} className={`flex items-center gap-3 px-3 py-2 ${r.dup ? "opacity-50" : ""}`}>
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.title}</span><span className="block truncate text-xs text-muted" dir="ltr">{r.url}</span></span>
                {r.category && <span className="text-xs px-2 py-0.5 rounded-full bg-surface-2 text-muted truncate max-w-[8rem]">{r.category}</span>}
                {r.dup && <span className="text-xs text-muted">{t("import.duplicate")}</span>}
              </div>
            ))}
          </div>
          {analysis.rows.length > 300 && <p className="text-xs text-muted mt-2">{t("import.more", { n: analysis.rows.length - 300 })}</p>}
        </>)}
      </Modal>
    </Card>
  );
}
