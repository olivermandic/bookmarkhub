import { useEffect, useRef, useState } from "react";
import { Check, ImageUp, Lock, RefreshCw, RotateCcw, UserCheck, Users } from "lucide-react";
import { api, type Bookmark, type Category } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/lib/store";
import { Favicon } from "./Favicon";
import { Field, Modal, Spinner, useToast } from "./ui";

type Audience = "private" | "all" | "users";

const NEW = "__new__";

export function BookmarkDialog({ open, onClose, bookmark, defaultCategory }: { open: boolean; onClose: () => void; bookmark: Bookmark | null; defaultCategory?: string | null }) {
  const { t } = useI18n();
  const toast = useToast();
  const { categories, setCategories, upsertBookmark, patchBookmark, bookmarks, user, people, config } = useStore();
  const fetchOn = config?.fetchFavicons !== false;
  const [title, setTitle] = useState(""); const [url, setUrl] = useState(""); const [description, setDescription] = useState("");
  const [tags, setTags] = useState(""); const [audience, setAudience] = useState<Audience>("all"); const [chosen, setChosen] = useState<string[]>([]); const [categoryId, setCategoryId] = useState<string>("");
  const [newCat, setNewCat] = useState(""); const [iconUrl, setIconUrl] = useState(""); const [busy, setBusy] = useState(false); const [iconBusy, setIconBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const owner = bookmark?.createdBy || user?.id || "";
  const others = people.filter((p) => p.id !== owner).sort((a, b) => a.username.localeCompare(b.username));
  const live = bookmark ? bookmarks.find((b) => b.id === bookmark.id) || bookmark : null;

  useEffect(() => {
    if (!open) return;
    setTitle(bookmark?.title || ""); setUrl(bookmark?.url || ""); setDescription(bookmark?.description || "");
    setTags((bookmark?.tags || []).join(", ")); setAudience(!bookmark ? "all" : !bookmark.isShared ? "private" : bookmark.sharedWith?.length ? "users" : "all"); setChosen(bookmark?.sharedWith || []);
    setCategoryId(bookmark ? bookmark.categoryId || "" : defaultCategory || ""); setNewCat(""); setIconUrl(bookmark?.iconUrl || "");
  }, [open, bookmark, defaultCategory]);

  const normalizedUrl = (u: string) => (/^[a-z][a-z0-9+.-]*:/i.test(u.trim()) ? u.trim() : `https://${u.trim()}`);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (audience === "users" && !chosen.filter((id) => id !== owner).length) { toast(t("share.pickOne"), "error"); return; }
    setBusy(true);
    try {
      let cat: string | null = categoryId || null;
      if (categoryId === NEW) {
        const c = await api<Category>("/categories", { method: "POST", body: { name: newCat } });
        if (!categories.some((x) => x.id === c.id)) setCategories([...categories, c]);
        cat = c.id;
      }
      const data = { title: title.trim() || url, url: normalizedUrl(url), description, tags: tags.split(",").map((s) => s.trim()).filter(Boolean), isShared: audience !== "private", sharedWith: audience === "users" ? chosen.filter((id) => id !== owner) : [], categoryId: cat, iconUrl: iconUrl.trim() ? normalizedUrl(iconUrl) : "" };
      const saved = bookmark
        ? await api<Bookmark>(`/bookmarks/${bookmark.id}`, { method: "PUT", body: { updates: data } })
        : await api<Bookmark>("/bookmarks", { method: "POST", body: { bookmark: data } });
      upsertBookmark(saved);
      toast(bookmark ? t("bookmark.saved") : t("bookmark.added"));
      onClose();
      if (!bookmark) setTimeout(() => api<Bookmark[]>("/bookmarks").then((l) => { const x = l.find((y) => y.id === saved.id); if (x) upsertBookmark(x); }).catch(() => {}), 4000);
    } catch (err: any) { toast(err.message || t("error.generic"), "error"); } finally { setBusy(false); }
  };

  const iconAction = async (kind: "refresh" | "reset" | "upload", file?: File) => {
    if (!bookmark) return;
    setIconBusy(true);
    try {
      let r: { status: string; iconVersion: string | null };
      if (kind === "upload" && file) {
        if (file.size > 500_000) throw new Error(t("icon.tooLarge"));
        const data = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(file); });
        r = await api(`/bookmarks/${bookmark.id}/favicon`, { method: "POST", body: { data } });
      } else if (kind === "reset") { r = await api(`/bookmarks/${bookmark.id}/favicon`, { method: "DELETE" }); setIconUrl(""); }
      else r = await api(`/bookmarks/${bookmark.id}/favicon/refresh`, { method: "POST" });
      patchBookmark(bookmark.id, { iconStatus: r.status as any, iconVersion: r.iconVersion || String(Date.now()), ...(kind === "reset" ? { iconUrl: "" } : {}) });
      toast(r.status === "none" ? t("icon.notFound") : t("icon.reloaded"));
    } catch (err: any) { toast(err.message || t("error.generic"), "error"); } finally { setIconBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={bookmark ? t("bookmark.edit") : t("bookmark.add")}
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>{t("common.cancel")}</button><button form="bm-form" className="btn-primary" disabled={busy}>{busy && <Spinner size={16} />}{t("common.save")}</button></>}>
      <form id="bm-form" onSubmit={submit}>
        <Field label={t("bookmark.url")} htmlFor="bm-url"><input id="bm-url" className="input" dir="ltr" inputMode="url" autoComplete="url" autoCapitalize="off" value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="https://…" autoFocus={!bookmark} /></Field>
        <Field label={t("bookmark.title")} htmlFor="bm-title" hint={!bookmark ? t("bookmark.titleHint") : undefined}><input id="bm-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></Field>
        <Field label={t("bookmark.category")} htmlFor="bm-cat">
          <select id="bm-cat" className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{t("category.none")}</option>
            {[...categories].sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value={NEW}>{t("category.new")}</option>
          </select>
          {categoryId === NEW && <input className="input mt-2" value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder={t("category.name")} aria-label={t("category.name")} required maxLength={80} />}
        </Field>
        <Field label={t("bookmark.description")} htmlFor="bm-desc"><textarea id="bm-desc" className="input h-20 py-2.5 resize-y" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} /></Field>
        <Field label={t("bookmark.tags")} htmlFor="bm-tags" hint={t("bookmark.tagsHint")}><input id="bm-tags" className="input" value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
        <fieldset className="mb-4 min-w-0" data-testid="share-picker">
          <legend className="font-medium text-sm mb-1.5">{t("share.label")}</legend>
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-surface-2 border border-line" role="radiogroup" aria-label={t("share.label")}>
            {([["private", <Lock size={15} key="l" />, t("share.private")], ["all", <Users size={15} key="a" />, t("share.all")], ["users", <UserCheck size={15} key="u" />, t("share.users")]] as const).map(([v, icon, label]) => (
              <button key={v} type="button" role="radio" aria-checked={audience === v} onClick={() => setAudience(v)}
                className={`min-w-0 min-h-[3.25rem] px-1 py-1.5 rounded-lg text-xs leading-tight text-center inline-flex flex-col items-center justify-center gap-1 ${audience === v ? "bg-surface shadow-sm font-medium text-fg" : "text-muted hover:text-fg"}`}>
                <span className="shrink-0">{icon}</span><span data-label className="max-w-full line-clamp-2 break-words [hyphens:auto]">{label}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted mt-1.5">{audience === "private" ? t("bookmark.privateHint") : audience === "all" ? t("bookmark.sharedHint") : t("share.usersHint")}</p>
          {audience === "users" && (
            others.length ? (
              <ul className="mt-2 rounded-xl border border-line divide-y divide-line max-h-48 overflow-y-auto" aria-label={t("share.users")}>
                {others.map((p) => {
                  const on = chosen.includes(p.id);
                  return (
                    <li key={p.id}>
                      <label className="flex items-center gap-3 px-3 h-11 cursor-pointer min-w-0">
                        <input type="checkbox" className="sr-only peer" checked={on} onChange={() => setChosen(on ? chosen.filter((x) => x !== p.id) : [...chosen, p.id])} />
                        <span className={`h-5 w-5 shrink-0 rounded-md border flex items-center justify-center peer-focus-visible:ring-2 ring-accent ${on ? "bg-accent border-accent text-accent-fg" : "border-line"}`}>{on && <Check size={14} />}</span>
                        <span className="h-7 w-7 shrink-0 rounded-full bg-surface-2 text-xs font-semibold flex items-center justify-center">{p.username.slice(0, 1).toUpperCase()}</span>
                        <span className="truncate text-sm">{p.username}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="text-sm text-muted mt-2">{t("share.noUsers")}</p>
          )}
        </fieldset>
        <details className="rounded-xl border border-line px-3.5 py-2.5 group" open={!!bookmark && !!iconUrl}>
          <summary className="cursor-pointer text-sm font-medium select-none">{t("icon.section")}</summary>
          <div className="pt-3">
            {live && (
              <div className="flex items-center gap-3 mb-3">
                <Favicon key={live.iconVersion || ""} b={live} size={40} />
                <div className="text-xs text-muted flex-1">{t(`icon.status.${live.iconStatus || "unknown"}`)}</div>
              </div>
            )}
            {fetchOn ? <Field label={t("icon.urlLabel")} htmlFor="bm-icon" hint={t("icon.urlHint")}><input id="bm-icon" className="input" dir="ltr" inputMode="url" value={iconUrl} onChange={(e) => setIconUrl(e.target.value)} placeholder="https://…/logo.png" /></Field>
              : <p className="text-xs text-muted mb-3">{t("icon.fetchOff")}</p>}
            {bookmark && (
              <div className="flex flex-wrap gap-2">
                {fetchOn && <button type="button" className="btn-outline h-9" disabled={iconBusy} onClick={() => iconAction("refresh")}>{iconBusy ? <Spinner size={14} /> : <RefreshCw size={15} />}{t("bookmark.reloadIcon")}</button>}
                <button type="button" className="btn-outline h-9" disabled={iconBusy} onClick={() => fileRef.current?.click()}><ImageUp size={15} />{t("icon.upload")}</button>
                {(live?.iconStatus === "custom" || live?.iconUrl) && <button type="button" className="btn-ghost h-9" disabled={iconBusy} onClick={() => iconAction("reset")}><RotateCcw size={15} />{t("icon.reset")}</button>}
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/x-icon,.ico" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) iconAction("upload", f); e.target.value = ""; }} />
              </div>
            )}
          </div>
        </details>
      </form>
    </Modal>
  );
}

export function CategoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { categories, setCategories } = useStore();
  const [name, setName] = useState("");
  useEffect(() => { if (open) setName(""); }, [open]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try { const c = await api<Category>("/categories", { method: "POST", body: { name } }); if (!categories.some((x) => x.id === c.id)) setCategories([...categories, c]); onClose(); } catch (err: any) { toast(err.message || t("error.generic"), "error"); }
  };
  return (
    <Modal open={open} onClose={onClose} title={t("category.add")}>
      <form onSubmit={save}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("category.name")} aria-label={t("category.name")} required maxLength={80} autoFocus />
        <div className="flex justify-end gap-2 mt-4"><button type="button" className="btn-ghost" onClick={onClose}>{t("common.cancel")}</button><button className="btn-primary">{t("common.save")}</button></div>
      </form>
    </Modal>
  );
}
