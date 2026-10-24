import { useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { api, type User } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/lib/store";
import { Footer } from "./AppShell";
import { Spinner, useToast } from "./ui";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <div className="status-strip" aria-hidden />
      <div className="scroll-area flex flex-col">
        <div className="flex-1 flex items-center justify-center px-4 py-10">
          <div className="w-full max-w-sm">
            <div className="flex flex-col items-center mb-8">
              <img src="logo.png" alt="" width={72} height={72} className="h-[72px] w-[72px] rounded-2xl shadow-card" />
              <h1 className="mt-4 text-2xl font-semibold tracking-tight">BookmarkHub</h1>
            </div>
            <div className="card p-6">{children}</div>
          </div>
        </div>
        <Footer />
      </div>
    </div>
  );
}

export function Login() {
  const { t } = useI18n();
  const { setUser } = useStore();
  const [username, setUsername] = useState(""); const [password, setPassword] = useState("");
  const [ticket, setTicket] = useState<string | null>(null); const [code, setCode] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      if (!ticket) {
        const r = await api<User & { twoFactorRequired?: boolean; ticket?: string }>("/login", { method: "POST", body: { username, password } });
        if (r.twoFactorRequired && r.ticket) { setTicket(r.ticket); setPassword(""); return; }
        setUser(r);
      } else {
        setUser(await api<User>("/login/2fa", { method: "POST", body: { ticket, code } }));
      }
    } catch (err: any) {
      setError(err.status === 429 ? t("login.tooMany") : err.status === 0 ? t("error.offline") : ticket ? (err.message.includes("expired") ? t("login.expired") : t("login.badCode")) : t("login.invalid"));
      if (ticket && err.message.includes("expired")) { setTicket(null); setCode(""); }
    } finally { setBusy(false); }
  };

  return (
    <Frame>
      <form onSubmit={submit} noValidate={false}>
        {!ticket ? (<>
          <h2 className="text-lg font-semibold mb-5">{t("login.title")}</h2>
          <label className="label" htmlFor="u">{t("login.username")}</label>
          <input id="u" className="input mb-4" autoComplete="username" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          <label className="label" htmlFor="p">{t("login.password")}</label>
          <input id="p" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </>) : (<>
          <div className="flex items-center gap-2 mb-2"><ShieldCheck className="text-accent" size={22} /><h2 className="text-lg font-semibold">{t("login.twoFactorTitle")}</h2></div>
          <p className="text-sm text-muted mb-4">{t("login.twoFactorText")}</p>
          <label className="label" htmlFor="c">{t("login.code")}</label>
          <input id="c" className="input text-center tracking-[0.3em] text-lg" dir="ltr" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus maxLength={20} />
          <p className="text-xs text-muted mt-2">{t("login.recoveryHint")}</p>
        </>)}
        {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
        <button className="btn-primary w-full mt-6 h-11" disabled={busy}>{busy ? <Spinner size={16} /> : <KeyRound size={17} />}{ticket ? t("login.verify") : t("login.submit")}</button>
        {ticket && <button type="button" className="btn-ghost w-full mt-2" onClick={() => { setTicket(null); setCode(""); setError(""); }}>{t("common.back")}</button>}
      </form>
      <p className="text-xs text-muted mt-5 text-center">{t("login.forgotHint")}</p>
    </Frame>
  );
}

export function ForcePassword() {
  const { t } = useI18n();
  const { setUser, refresh, logout } = useStore();
  return (
    <Frame>
      <h2 className="text-lg font-semibold mb-1">{t("password.mustChangeTitle")}</h2>
      <p className="text-sm text-muted mb-5">{t("password.mustChangeText")}</p>
      <PasswordForm onDone={(u) => { setUser(u); refresh(); }} />
      <button className="btn-ghost w-full mt-2" onClick={logout}>{t("nav.logout")}</button>
    </Frame>
  );
}

export function PasswordForm({ onDone }: { onDone: (u: User) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [cur, setCur] = useState(""); const [next, setNext] = useState(""); const [rep, setRep] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    if (next !== rep) return setErr(t("password.mismatch"));
    if (next.length < 10) return setErr(t("password.tooShort"));
    setBusy(true);
    try { const u = await api<User>("/me/password", { method: "POST", body: { currentPassword: cur, newPassword: next } }); toast(t("password.changed")); setCur(""); setNext(""); setRep(""); onDone(u); }
    catch (er: any) { setErr(er.message.includes("Current password") ? t("password.wrongCurrent") : er.message.includes("at least") ? t("password.tooShort") : er.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit}>
      <input type="text" autoComplete="username" className="hidden" aria-hidden tabIndex={-1} readOnly />
      <label className="label" htmlFor="pw-cur">{t("password.current")}</label>
      <input id="pw-cur" className="input mb-4" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
      <label className="label" htmlFor="pw-new">{t("password.new")}</label>
      <input id="pw-new" className="input mb-1.5" type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required />
      <p className="text-xs text-muted mb-4">{t("password.rules")}</p>
      <label className="label" htmlFor="pw-rep">{t("password.repeat")}</label>
      <input id="pw-rep" className="input" type="password" autoComplete="new-password" value={rep} onChange={(e) => setRep(e.target.value)} required />
      {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
      <button className="btn-primary w-full mt-5" disabled={busy}>{busy && <Spinner size={16} />}{t("password.change")}</button>
    </form>
  );
}
