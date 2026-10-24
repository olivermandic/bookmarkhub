import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MoreHorizontal, Pencil, Trash2, RefreshCw, Link2Off, Users, UserCheck, Lock, Activity } from "lucide-react";
import type { Bookmark } from "@/lib/api";
import { hostOf } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/lib/store";
import { Favicon } from "./Favicon";
import { Menu, MenuItem } from "./ui";

export type View = "grid" | "list" | "compact";
export interface TileActions { edit: (b: Bookmark) => void; remove: (b: Bookmark) => void; refreshIcon: (b: Bookmark) => void; check: (b: Bookmark) => void }

export const BookmarkTile = memo(function BookmarkTile({ b, view, arrange, canEdit, actions, overlay }: { b: Bookmark; view: View; arrange: boolean; canEdit: boolean; actions: TileActions; overlay?: boolean }) {
  const { t } = useI18n();
  const { config, people } = useStore();
  const fetchOn = config?.fetchFavicons !== false; const linkOn = config?.linkCheck !== false;
  const sharedNames = b.isShared && b.sharedWith?.length ? b.sharedWith.map((id) => people.find((p) => p.id === id)?.username).filter(Boolean).join(", ") : "";
  const sortable = useSortable({ id: b.id, disabled: !arrange, data: { type: "bookmark", categoryId: b.categoryId || "none" } });
  const style = overlay ? undefined : { transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition, opacity: sortable.isDragging ? 0.35 : 1 };
  const broken = b.linkStatus?.state === "broken";
  const host = hostOf(b.url);

  const handle = arrange && (
    <button type="button" className="icon-btn h-9 w-9 cursor-grab active:cursor-grabbing touch-none text-muted" aria-label={t("arrange.handle", { title: b.title })}
      {...sortable.attributes} {...sortable.listeners}><GripVertical size={18} /></button>
  );
  const menu = !arrange && (
    <div className={view === "grid" ? "absolute z-10 top-2 end-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity" : ""}>
      <Menu label={t("bookmark.actions", { title: b.title })} trigger={<MoreHorizontal size={18} />}>
        {(close) => (<>
          {canEdit && <MenuItem icon={<Pencil size={16} />} onClick={() => { close(); actions.edit(b); }}>{t("common.edit")}</MenuItem>}
          {fetchOn && <MenuItem icon={<RefreshCw size={16} />} onClick={() => { close(); actions.refreshIcon(b); }}>{t("bookmark.reloadIcon")}</MenuItem>}
          {linkOn && <MenuItem icon={<Activity size={16} />} onClick={() => { close(); actions.check(b); }}>{t("bookmark.checkLink")}</MenuItem>}
          {canEdit && <MenuItem danger icon={<Trash2 size={16} />} onClick={() => { close(); actions.remove(b); }}>{t("common.delete")}</MenuItem>}
        </>)}
      </Menu>
    </div>
  );
  const badges = (
    <span className="inline-flex items-center gap-1.5 text-muted">
      {broken && <span className="inline-flex items-center gap-1 text-danger text-xs font-medium" title={t("bookmark.brokenHint", { code: b.linkStatus?.code || b.linkStatus?.error || "?" })}><Link2Off size={13} />{t("bookmark.broken")}</span>}
      {!b.isShared ? <Lock size={13} aria-label={t("bookmark.private")} /> : b.sharedWith?.length ? <span className="inline-flex" title={t("share.with", { names: sharedNames })}><UserCheck size={13} aria-label={t("share.with", { names: sharedNames })} /></span> : <Users size={13} aria-label={t("bookmark.shared")} />}
    </span>
  );
  const linkProps = arrange ? { onClick: (e: React.MouseEvent) => e.preventDefault(), tabIndex: -1, "aria-disabled": true } : {};
  const ref = overlay ? undefined : sortable.setNodeRef;

  if (view === "compact") {
    return (
      <div ref={ref} style={style} className={`group relative ${overlay ? "shadow-pop rounded-2xl bg-surface" : ""}`}>
        <a href={b.url} target="_blank" rel="noopener noreferrer" {...linkProps} title={`${b.title}\n${host}`}
          className="flex flex-col items-center gap-2 p-3 rounded-2xl hover:bg-surface-2 text-center">
          <span className="relative"><Favicon key={b.iconVersion || ""} b={b} size={44} />{broken && <span className="absolute -top-1 -end-1 h-3 w-3 rounded-full bg-danger ring-2 ring-bg" />}</span>
          <span className="text-xs leading-tight line-clamp-2 break-words w-full">{b.title}</span>
        </a>
        {arrange && <div className="absolute top-0 end-0">{handle}</div>}
      </div>
    );
  }
  if (view === "list") {
    return (
      <div ref={ref} style={style} className={`group flex items-center gap-3 ps-3 pe-1.5 py-2 bg-surface ${overlay ? "shadow-pop rounded-xl border border-line" : "border-b border-line last:border-b-0"}`}>
        {handle}
        <a href={b.url} target="_blank" rel="noopener noreferrer" {...linkProps} className="flex items-center gap-3 min-w-0 flex-1 py-1">
          <Favicon key={b.iconVersion || ""} b={b} size={28} />
          <span className="min-w-0 flex-1">
            <span className="block font-medium truncate">{b.title}</span>
            <span className="block text-xs text-muted truncate">{host}{b.description ? ` · ${b.description}` : ""}</span>
          </span>
        </a>
        {badges}
        {menu}
      </div>
    );
  }
  return (
    <div ref={ref} style={style} className={`group relative card p-4 hover:border-accent/40 transition-colors ${overlay ? "shadow-pop" : ""} ${broken ? "border-danger/40" : ""}`}>
      <a href={b.url} target="_blank" rel="noopener noreferrer" {...linkProps} className="flex flex-col h-full min-h-[7.5rem] outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-accent">
        <span className="flex items-center gap-3 pe-8">
          <Favicon key={b.iconVersion || ""} b={b} size={40} />
          <span className="min-w-0">
            <span className="block font-semibold leading-snug line-clamp-2">{b.title}</span>
            <span className="block text-xs text-muted truncate" dir="ltr">{host}</span>
          </span>
        </span>
        {b.description && <span className="mt-2.5 text-sm text-muted line-clamp-2">{b.description}</span>}
        <span className="mt-auto pt-3 flex items-center gap-2 flex-wrap">
          {b.tags.slice(0, 3).map((tag) => <span key={tag} className="text-[11px] px-2 py-0.5 rounded-full bg-surface-2 text-muted">#{tag}</span>)}
          <span className="ms-auto">{badges}</span>
        </span>
      </a>
      {menu}
      {arrange && <div className="absolute top-2 end-2 z-10">{handle}</div>}
    </div>
  );
});
