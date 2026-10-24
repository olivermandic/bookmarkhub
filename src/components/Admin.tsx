import { useCallback, useEffect, useState } from "react";
import { Archive, BellRing, Download, ExternalLink, Globe, ImageDown, Link2Off, Pencil, Plus, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { api, type Job, type User } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/lib/store";
import { Card } from "./Settings";
import { Field, Modal, Spinner, Switch, useToast } from "./ui";

const fmtDate = (s: string | null | undefined, lang: string) => (s ? new Date(s).toLocaleString(lang, { dateStyle: "medium", timeStyle: "short" }) : "–");
const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function Admin() {
  const { t } = useI18n();
  const { user } = useStore();
  if (!user?.isAdmin) return <p className="p-8 text-center text-muted">{t("error.forbidden")}</p>;
  return (
    <div className="mx-auto max-w-4xl px-3 sm:px-6 py-5 sm:py-8 flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight px-1">{t("nav.admin")}</h1>
      <Users />
      <Privacy />
      <Maintenance />
      <Backups />
    </div>
  );
}

function Users() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { user: me, setUser: setMe } = useStore();
  const [users, setUsers] = useState<User[]>([]);
  const [edit, setEdit] = useState<User | "new" | null>(null);
  const [del, setDel] = useState<User | null>(null);
  const load = useCallback(() => api<User[]>("/users").then(setUsers).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  const remove = async () => {
    if (!del) return;
    try { await api(`/users/${del.id}`, { method: "DELETE" }); toast(t("users.deleted")); load(); } catch (e: any) { toast(e.message, "error"); }
    setDel(null);
  };
  return (
    <Card title={t("users.title")}>
      <div className="flex justify-end -mt-12 mb-3"><button className="btn-primary h-9" onClick={() => setEdit("new")}><Plus size={17} />{t("users.add")}</button></div>
      <div className="divide-y divide-line rounded-xl border border-line overflow-hidden">
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-3 px-3.5 py-3 bg-surface">
            <span className="h-9 w-9 rounded-full bg-surface-2 flex items-center justify-center text-muted shrink-0"><UserRound size={18} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium truncate">{u.username}</span>
                {u.isAdmin && <span className="text-[11px] px-2 py-0.5 rounded-full bg-accent/15 text-accent font-medium">{t("users.admin")}</span>}
                {u.twoFactorEnabled && <ShieldCheck size={15} className="text-ok" aria-label={t("twofa.on")} />}
                {u.mustChangePassword && <span className="text-[11px] text-warn">{t("users.mustChange")}</span>}
              </div>
              <div className="text-xs text-muted">{t("users.meta", { n: u.bookmarkCount || 0, date: fmtDate(u.lastLoginAt, lang) })}</div>
            </div>
            <button className="icon-btn" onClick={() => setEdit(u)} aria-label={t("users.edit", { name: u.username })}><Pencil size={17} /></button>
            {u.id !== me?.id && <button className="icon-btn text-danger" onClick={() => setDel(u)} aria-label={t("users.delete", { name: u.username })}><Trash2 size={17} /></button>}
          </div>
        ))}
      </div>
      <UserDialog target={edit} onClose={() => setEdit(null)} onSaved={(u) => { load(); if (u.id === me?.id) setMe({ ...me!, ...u }); }} />
      <Modal open={!!del} onClose={() => setDel(null)} title={t("users.deleteTitle")}
        footer={<><button className="btn-ghost" onClick={() => setDel(null)}>{t("common.cancel")}</button><button className="btn-danger" onClick={remove}>{t("common.delete")}</button></>}>
        <p>{t("users.deleteConfirm", { name: del?.username || "" })}</p>
      </Modal>
    </Card>
  );
}

function UserDialog({ target, onClose, onSaved }: { target: User | "new" | null; onClose: () => void; onSaved: (u: User) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const isNew = target === "new"; const u = target && target !== "new" ? target : null;
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [isAdmin, setAdmin] = useState(false); const [off2fa, setOff2fa] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { if (target) { setUsername(u?.username || ""); setPassword(""); setAdmin(!!u?.isAdmin); setOff2fa(false); } }, [target]); // eslint-disable-line
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      const body: any = { username, isAdmin };
      if (password) body.password = password;
      if (off2fa) body.disable2fa = true;
      const r = isNew ? await api<User>("/users", { method: "POST", body: { username, password, isAdmin } }) : await api<User>(`/users/${u!.id}`, { method: "PUT", body });
      toast(t("users.saved")); onSaved(r); onClose();
    } catch (er: any) { toast(er.message, "error"); } finally { setBusy(false); }
  };
  return (
    <Modal open={!!target} onClose={onClose} title={isNew ? t("users.add") : t("users.edit", { name: u?.username || "" })}
      footer={<><button className="btn-ghost" onClick={onClose}>{t("common.cancel")}</button><button form="user-form" className="btn-primary" disabled={busy}>{busy && <Spinner size={16} />}{t("common.save")}</button></>}>
      <form id="user-form" onSubmit={save}>
        <Field label={t("login.username")} htmlFor="uf-name"><input id="uf-name" className="input" autoCapitalize="off" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} required pattern="[\w.@\-]{2,50}" /></Field>
        <Field label={isNew ? t("login.password") : t("users.newPassword")} htmlFor="uf-pw" hint={isNew ? t("password.rules") : t("users.newPasswordHint")}>
          <input id="uf-pw" className="input" type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required={isNew} />
        </Field>
        <div className="flex items-center justify-between py-2"><span className="text-sm font-medium">{t("users.admin")}</span><Switch checked={isAdmin} onChange={setAdmin} label={t("users.admin")} /></div>
        {u?.twoFactorEnabled && <div className="flex items-center justify-between py-2"><span className="text-sm font-medium">{t("users.disable2fa")}</span><Switch checked={off2fa} onChange={setOff2fa} label={t("users.disable2fa")} /></div>}
      </form>
    </Modal>
  );
}

function useJobs() {
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const poll = useCallback(() => api<Record<string, Job>>("/jobs").then(setJobs).catch(() => {}), []);
  useEffect(() => { poll(); }, [poll]);
  const running = Object.values(jobs).some((j) => j.running);
  useEffect(() => { if (!running) return; const i = setInterval(poll, 1500); return () => clearInterval(i); }, [running, poll]);
  return { jobs, poll };
}

function JobRow({ kind, job, icon, label, desc, onStart, summary, disabled }: { kind: string; job?: Job; icon: JSX.Element; label: string; desc: string; onStart: () => void; summary: (j: Job) => string; disabled?: boolean }) {
  const { t, lang } = useI18n();
  const pct = job && job.total ? Math.round((job.done / job.total) * 100) : 0;
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <span className="h-9 w-9 rounded-xl bg-surface-2 flex items-center justify-center text-muted shrink-0">{icon}</span>
        <div className="flex-1 min-w-0"><div className="font-medium">{label}</div><div className="text-sm text-muted">{desc}</div></div>
        <button className="btn-outline h-9 shrink-0" disabled={job?.running || disabled} onClick={onStart} data-job={kind}>{job?.running ? <Spinner size={15} /> : null}{t("jobs.start")}</button>
      </div>
      {job && (
        <div className="mt-3 ms-12">
          {job.running ? (<>
            <div className="h-2 rounded-full bg-surface-2 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
            <div className="text-xs text-muted mt-1 tabular-nums">{t("jobs.progress", { done: job.done, total: job.total })}</div>
          </>) : <div className="text-xs text-muted">{t("jobs.finished", { date: fmtDate(job.finishedAt, lang) })} · {summary(job)}</div>}
        </div>
      )}
    </div>
  );
}

interface AdminSettings { fetchFavicons: boolean; linkCheck: boolean; updateCheck: boolean; updateState?: { checkedAt?: string; latest?: string; url?: string; error?: string } | null }

function Privacy() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { reloadConfig } = useStore();
  const [s, setS] = useState<AdminSettings | null>(null);
  const [busy, setBusy] = useState("");
  useEffect(() => { api<AdminSettings>("/admin/settings").then(setS).catch(() => {}); }, []);
  const change = async (key: keyof AdminSettings, value: boolean) => {
    setBusy(key);
    try { setS(await api<AdminSettings>("/admin/settings", { method: "PUT", body: JSON.stringify({ [key]: value }) })); await reloadConfig(); }
    catch (e: any) { toast(e.message, "error"); } finally { setBusy(""); }
  };
  const row = (key: "fetchFavicons" | "linkCheck" | "updateCheck", icon: JSX.Element, label: string, desc: string, extra?: React.ReactNode) => (
    <div className="py-4 first:pt-0 last:pb-0 flex items-start gap-3" data-setting={key}>
      <span className="h-9 w-9 rounded-xl bg-surface-2 flex items-center justify-center text-muted shrink-0">{icon}</span>
      <div className="flex-1 min-w-0"><div className="font-medium">{label}</div><div className="text-sm text-muted">{desc}</div>{extra}</div>
      <div className="shrink-0 pt-1 flex items-center gap-2">{busy === key && <Spinner size={14} />}<Switch checked={!!s?.[key]} onChange={(v) => change(key, v)} label={label} /></div>
    </div>
  );
  if (!s) return null;
  const st = s.updateState;
  return (
    <Card title={t("privacy.title")} desc={t("privacy.desc")} id="privacy">
      <div className="divide-y divide-line">
        {row("fetchFavicons", <ImageDown size={18} />, t("privacy.favicons"), t("privacy.faviconsDesc"))}
        {row("linkCheck", <Globe size={18} />, t("privacy.links"), t("privacy.linksDesc"))}
        {row("updateCheck", <BellRing size={18} />, t("privacy.update"), t("privacy.updateDesc"),
          s.updateCheck && st?.checkedAt ? <div className="text-xs text-muted mt-1">{t("privacy.lastCheck", { date: fmtDate(st.checkedAt, lang) })}{st.latest ? <> · <bdi dir="ltr">v{st.latest}</bdi></> : null}{st.error ? <> · <bdi dir="ltr">{st.error}</bdi></> : null}</div> : null)}
      </div>
    </Card>
  );
}

export function UpdateBanner() {
  const { t } = useI18n();
  const { user, config } = useStore();
  const u = config?.update;
  const [hidden, setHidden] = useState(() => (u ? localStorage.getItem("bmh.updateDismissed") === u.latest : false));
  useEffect(() => { if (u) setHidden(localStorage.getItem("bmh.updateDismissed") === u.latest); }, [u?.latest]); // eslint-disable-line
  if (!user?.isAdmin || !u || hidden) return null;
  return (
    <div role="status" data-testid="update-banner" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm min-w-0">
      <BellRing size={16} className="shrink-0 text-accent" />
      <span className="flex-1 min-w-0">{t("update.available", { version: u.latest })}</span>
      <a className="inline-flex items-center gap-1 font-medium text-accent hover:underline" href={u.url} target="_blank" rel="noopener noreferrer">{t("update.notes")}<ExternalLink size={14} /></a>
      <button type="button" className="text-muted hover:text-fg text-xs" onClick={() => { localStorage.setItem("bmh.updateDismissed", u.latest); setHidden(true); }}>{t("common.close")}</button>
    </div>
  );
}

function Maintenance() {
  const { t } = useI18n();
  const toast = useToast();
  const { refresh, bookmarks, config } = useStore();
  const { jobs, poll } = useJobs();
  const [wasRunning, setWasRunning] = useState<Record<string, boolean>>({});
  useEffect(() => {
    for (const [k, j] of Object.entries(jobs)) { if (wasRunning[k] && !j.running) refresh().catch(() => {}); }
    setWasRunning(Object.fromEntries(Object.entries(jobs).map(([k, j]) => [k, j.running])));
  }, [jobs]); // eslint-disable-line
  const start = async (path: string) => { try { await api(path, { method: "POST" }); poll(); } catch (e: any) { toast(e.message, "error"); } };
  const broken = bookmarks.filter((b) => b.linkStatus?.state === "broken");
  return (
    <Card title={t("jobs.title")}>
      <div className="divide-y divide-line">
        <JobRow kind="favicons" job={jobs.favicons} icon={<ImageDown size={18} />} label={t("jobs.favicons")} desc={t("jobs.faviconsDesc")} onStart={() => start("/admin/favicons/refresh-all")} disabled={config?.fetchFavicons === false}
          summary={(j) => t("jobs.faviconsSummary", { found: (j.results.found || 0) + (j.results.custom || 0), fallback: j.results.fallback || 0, failed: (j.results.none || 0) + (j.results.failed || 0) })} />
        <JobRow kind="links" job={jobs.links} icon={<Link2Off size={18} />} label={t("jobs.links")} desc={t("jobs.linksDesc")} onStart={() => start("/admin/links/check-all")} disabled={config?.linkCheck === false}
          summary={(j) => t("jobs.linksSummary", { ok: j.results.ok || 0, broken: j.results.broken || 0, unknown: j.results.unknown || 0 })} />
      </div>
      {broken.length > 0 && (
        <div className="mt-5">
          <div className="section-title mb-2">{t("jobs.brokenList", { n: broken.length })}</div>
          <ul className="text-sm divide-y divide-line rounded-xl border border-line">
            {broken.map((b) => <li key={b.id} className="px-3 py-2 flex gap-2"><span className="truncate flex-1">{b.title}</span><span className="text-danger text-xs shrink-0">{b.linkStatus?.code || b.linkStatus?.error}</span></li>)}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Backups() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [data, setData] = useState<{ dir: string; backups: { name: string; day: string; manual: boolean; size: number; createdAt: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api("/admin/backups").then(setData).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  const now = async () => { setBusy(true); try { await api("/admin/backups", { method: "POST" }); toast(t("backups.created")); load(); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); } };
  return (
    <Card title={t("backups.title")} desc={t("backups.desc")}>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button className="btn-primary" disabled={busy} onClick={now}>{busy ? <Spinner size={16} /> : <Archive size={17} />}{t("backups.now")}</button>
        {data && <span className="text-xs text-muted break-all">{t("backups.folder")}: <code dir="ltr">{data.dir}</code></span>}
      </div>
      {data && data.backups.length === 0 && <p className="text-sm text-muted">{t("backups.none")}</p>}
      {data && data.backups.length > 0 && (
        <div className="rounded-xl border border-line divide-y divide-line max-h-80 overflow-y-auto">
          {data.backups.map((b) => (
            <div key={b.name} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
              <span className="flex-1 min-w-0"><span className="block">{fmtDate(b.createdAt, lang)}</span><span className="block text-xs text-muted">{b.manual ? t("backups.manual") : t("backups.auto")} · {fmtSize(b.size)}</span></span>
              <a className="icon-btn" href={`api/admin/backups/${encodeURIComponent(b.name)}`} download aria-label={t("common.download")}><Download size={17} /></a>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
