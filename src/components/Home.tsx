import { useCallback, useMemo, useState } from "react";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Bookmark as BookmarkIcon, ChevronDown, FolderPlus, GripVertical, MoreHorizontal, Pencil, Plus, Search, SearchX, Trash2, X, LayoutGrid, List, Grid3x3 } from "lucide-react";
import { api, type Bookmark, type Category } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/lib/store";
import { BookmarkTile, type TileActions, type View } from "./BookmarkTile";
import { Empty, Menu, MenuItem, Modal, useToast } from "./ui";

const NONE = "none";
type Filter = "all" | "mine" | "shared" | "broken";

export function Home({ arrange, onAdd, onEdit, onAddCategory }: { arrange: boolean; onAdd: (categoryId?: string | null) => void; onEdit: (b: Bookmark) => void; onAddCategory: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { user, bookmarks, categories, savePrefs, patchBookmark, removeBookmark, setCategories, upsertBookmark } = useStore();
  const prefs = user?.prefs || {};
  const view: View = prefs.view || "grid";
  const sort = prefs.sort || "manual";
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Category | null>(null);
  const [confirmDel, setConfirmDel] = useState<Bookmark | null>(null);
  const collapsed = new Set(prefs.collapsed || []);
  const canEdit = useCallback((b: Bookmark) => !!user && (b.createdBy === user.id || user.isAdmin), [user]);

  const brokenCount = bookmarks.filter((b) => b.linkStatus?.state === "broken").length;
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => bookmarks.filter((b) => {
    if (filter === "mine" && b.createdBy !== user?.id) return false;
    if (filter === "shared" && !b.isShared) return false;
    if (filter === "broken" && b.linkStatus?.state !== "broken") return false;
    if (!q) return true;
    return [b.title, b.url, b.description || "", b.tags.join(" ")].join(" ").toLowerCase().includes(q);
  }), [bookmarks, filter, q, user?.id]);

  const catIds = useMemo(() => {
    const known = new Set(categories.map((c) => c.id));
    const order = (prefs.categoryOrder || []).filter((id) => id === NONE || known.has(id));
    const rest = categories.filter((c) => !order.includes(c.id)).sort((a, b) => a.name.localeCompare(b.name)).map((c) => c.id);
    const all = [...order, ...rest];
    if (!all.includes(NONE)) all.push(NONE);
    return all;
  }, [categories, prefs.categoryOrder]);

  const grouped = useMemo(() => {
    const known = new Set(categories.map((c) => c.id));
    const g: Record<string, Bookmark[]> = {};
    for (const id of catIds) g[id] = [];
    for (const b of filtered) (g[b.categoryId && known.has(b.categoryId) ? b.categoryId : NONE] ||= []).push(b);
    for (const id of Object.keys(g)) {
      const list = g[id];
      if (sort === "title") list.sort((a, b) => a.title.localeCompare(b.title));
      else if (sort === "recent") list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      else {
        const ord = (prefs.bookmarkOrder || {})[id] || [];
        const idx = (x: Bookmark) => { const i = ord.indexOf(x.id); return i < 0 ? 1e9 : i; };
        list.sort((a, b) => idx(a) - idx(b) || a.title.localeCompare(b.title));
      }
    }
    return g;
  }, [filtered, catIds, categories, sort, prefs.bookmarkOrder]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const catOf = (id: string): string | null => {
    if (id.startsWith("sec:")) return id.slice(4);
    if (id.startsWith("drop:")) return id.slice(5);
    const b = bookmarks.find((x) => x.id === id);
    return b ? (b.categoryId && categories.some((c) => c.id === b.categoryId) ? b.categoryId : NONE) : null;
  };

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    const a = String(e.active.id); const o = e.over ? String(e.over.id) : null;
    if (!o || a === o) return;
    if (a.startsWith("sec:")) {
      const from = catIds.indexOf(a.slice(4)); const to = catIds.indexOf(catOf(o) || "");
      if (from < 0 || to < 0) return;
      savePrefs({ categoryOrder: arrayMove(catIds, from, to) }).catch(() => toast(t("error.save"), "error"));
      return;
    }
    const fromCat = catOf(a); const toCat = catOf(o);
    if (!fromCat || !toCat) return;
    const fromIds = grouped[fromCat].map((x) => x.id);
    if (fromCat === toCat) {
      const to = fromIds.indexOf(o);
      if (to < 0) return;
      savePrefs({ bookmarkOrder: { [fromCat]: arrayMove(fromIds, fromIds.indexOf(a), to) } }).catch(() => toast(t("error.save"), "error"));
      return;
    }
    const b = bookmarks.find((x) => x.id === a)!;
    if (!canEdit(b)) { toast(t("arrange.notOwner"), "error"); return; }
    const toIds = grouped[toCat].map((x) => x.id).filter((x) => x !== a);
    const pos = toIds.indexOf(o); toIds.splice(pos < 0 ? toIds.length : pos, 0, a);
    patchBookmark(a, { categoryId: toCat === NONE ? null : toCat });
    try {
      const updated = await api<Bookmark>(`/bookmarks/${a}`, { method: "PUT", body: { updates: { categoryId: toCat === NONE ? null : toCat } } });
      upsertBookmark(updated);
      await savePrefs({ bookmarkOrder: { [toCat]: toIds, [fromCat]: fromIds.filter((x) => x !== a) } });
    } catch { patchBookmark(a, { categoryId: b.categoryId }); toast(t("error.save"), "error"); }
  };

  const actions: TileActions = useMemo(() => ({
    edit: onEdit,
    remove: (b) => setConfirmDel(b),
    refreshIcon: async (b) => {
      try {
        const r = await api<{ status: string; iconVersion: string | null }>(`/bookmarks/${b.id}/favicon/refresh`, { method: "POST" });
        patchBookmark(b.id, { iconStatus: r.status as any, iconVersion: r.iconVersion || String(Date.now()) });
        toast(r.status === "none" ? t("icon.notFound") : t("icon.reloaded"));
      } catch { toast(t("error.generic"), "error"); }
    },
    check: async (b) => {
      try {
        const r = await api<any>(`/bookmarks/${b.id}/check`, { method: "POST" });
        patchBookmark(b.id, { linkStatus: r });
        toast(r.state === "ok" ? t("link.ok") : r.state === "broken" ? t("link.broken", { code: r.code || r.error || "?" }) : t("link.unknown"), r.state === "broken" ? "error" : "ok");
      } catch { toast(t("error.generic"), "error"); }
    },
  }), [onEdit, patchBookmark, toast, t]);

  const doDelete = async () => {
    const b = confirmDel; if (!b) return;
    setConfirmDel(null);
    try { await api(`/bookmarks/${b.id}`, { method: "DELETE" }); removeBookmark(b.id); toast(t("bookmark.deleted")); } catch { toast(t("error.generic"), "error"); }
  };
  const toggleCollapse = (id: string) => {
    const next = new Set(collapsed); if (next.has(id)) next.delete(id); else next.add(id);
    savePrefs({ collapsed: [...next] }).catch(() => {});
  };
  const deleteCategory = async (c: Category) => {
    if (!confirm(t("category.deleteConfirm", { name: c.name }))) return;
    try {
      await api(`/categories/${c.id}`, { method: "DELETE" });
      setCategories(categories.filter((x) => x.id !== c.id));
      bookmarks.filter((b) => b.categoryId === c.id).forEach((b) => patchBookmark(b.id, { categoryId: null }));
    } catch (e: any) { toast(e.status === 403 ? t("error.forbidden") : t("error.generic"), "error"); }
  };

  const activeBookmark = activeId && !activeId.startsWith("sec:") ? bookmarks.find((b) => b.id === activeId) : null;
  const visibleSections = catIds.filter((id) => grouped[id] && (grouped[id].length > 0 || (arrange && !q && filter === "all" && id !== NONE)));
  const showEmpty = bookmarks.length === 0;
  const dndEnabled = arrange && sort === "manual" && !q && filter === "all";

  const viewBtn = (v: View, icon: JSX.Element, label: string) => (
    <button type="button" onClick={() => savePrefs({ view: v })} aria-pressed={view === v} aria-label={label} title={label}
      className={`h-9 w-9 inline-flex items-center justify-center rounded-lg ${view === v ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg"}`}>{icon}</button>
  );

  return (
    <div className="mx-auto max-w-7xl px-3 sm:px-6 py-4 sm:py-6">
      {!showEmpty && (
        <div className="flex flex-col gap-3 mb-5">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={18} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("home.filterPlaceholder")} aria-label={t("home.filterPlaceholder")} className="input ps-10 pe-10" data-no-ptr />
              {query && <button className="icon-btn h-8 w-8 absolute end-1.5 top-1/2 -translate-y-1/2" onClick={() => setQuery("")} aria-label={t("common.clear")}><X size={16} /></button>}
            </div>
            <div className="hidden sm:flex items-center p-0.5 rounded-xl bg-surface-2 border border-line" role="group" aria-label={t("view.label")}>
              {viewBtn("grid", <LayoutGrid size={17} />, t("view.grid"))}{viewBtn("list", <List size={17} />, t("view.list"))}{viewBtn("compact", <Grid3x3 size={17} />, t("view.compact"))}
            </div>
          </div>
          {/* Mobile: chips on row 1 (wrap), view toggle + sort on row 2. sm+: one row. Never scrolls sideways. */}
          <div className="flex flex-wrap items-center gap-2 min-w-0" data-testid="filter-row">
            <div className="flex flex-wrap items-center gap-2 min-w-0 w-full sm:w-auto sm:flex-1">
              {(["all", "mine", "shared"] as Filter[]).map((f) => (
                <button key={f} className={`chip ${filter === f ? "chip-on" : ""}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>{t(`filter.${f}`)}</button>
              ))}
              {brokenCount > 0 && <button className={`chip ${filter === "broken" ? "chip-on" : "text-danger"}`} aria-pressed={filter === "broken"} onClick={() => setFilter("broken")}>{t("filter.broken")} · {brokenCount}</button>}
            </div>
            <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto">
              <div className="sm:hidden flex items-center p-0.5 rounded-xl bg-surface-2 border border-line shrink-0" role="group" aria-label={t("view.label")}>
                {viewBtn("grid", <LayoutGrid size={16} />, t("view.grid"))}{viewBtn("list", <List size={16} />, t("view.list"))}{viewBtn("compact", <Grid3x3 size={16} />, t("view.compact"))}
              </div>
              <label className="sr-only" htmlFor="sort">{t("sort.label")}</label>
              <select id="sort" value={sort} onChange={(e) => savePrefs({ sort: e.target.value as any })} title={t("sort.label")}
                className="h-9 min-w-0 flex-1 sm:flex-none sm:w-auto sm:max-w-[16rem] truncate rounded-xl border border-line bg-surface ps-2.5 pe-7 text-sm">
                <option value="manual">{t("sort.manual")}</option><option value="title">{t("sort.title")}</option><option value="recent">{t("sort.recent")}</option>
              </select>
            </div>
          </div>
          {arrange && !dndEnabled && <p className="text-sm text-warn">{t("arrange.needsManual")}</p>}
          {arrange && dndEnabled && <p className="text-sm text-muted">{t("arrange.hint")}</p>}
        </div>
      )}

      {showEmpty ? (
        <Empty icon={<BookmarkIcon size={26} />} title={t("empty.title")} text={t("empty.text")}
          action={<div className="flex flex-wrap gap-2 justify-center"><button className="btn-primary" onClick={() => onAdd()}><Plus size={18} />{t("bookmark.add")}</button><a className="btn-outline" href="#/settings?import">{t("import.title")}</a></div>} />
      ) : filtered.length === 0 ? (
        <Empty icon={<SearchX size={26} />} title={t("empty.noResults")} text={q ? t("empty.noResultsText", { q: query }) : undefined}
          action={<button className="btn-outline" onClick={() => { setQuery(""); setFilter("all"); }}>{t("common.reset")}</button>} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}
          accessibility={{ screenReaderInstructions: { draggable: t("dnd.instructions") }, announcements: {
            onDragStart: () => t("dnd.picked"), onDragOver: () => "", onDragEnd: () => t("dnd.dropped"), onDragCancel: () => t("dnd.cancelled") } }}>
          <SortableContext items={visibleSections.map((id) => `sec:${id}`)} strategy={verticalListSortingStrategy} disabled={!dndEnabled}>
            <div className="flex flex-col gap-7">
              {visibleSections.map((id) => {
                const cat = categories.find((c) => c.id === id);
                return (
                  <Section key={id} id={id} name={cat ? cat.name : t("category.none")} count={grouped[id].length} collapsed={collapsed.has(id) && !arrange && !q}
                    onToggle={() => toggleCollapse(id)} arrange={dndEnabled}
                    menu={cat && (user?.isAdmin || cat.createdBy === user?.id) && !arrange ? (
                      <Menu label={t("category.actions", { name: cat.name })} trigger={<MoreHorizontal size={18} />}>
                        {(close) => (<>
                          <MenuItem icon={<Plus size={16} />} onClick={() => { close(); onAdd(cat.id); }}>{t("bookmark.addHere")}</MenuItem>
                          <MenuItem icon={<Pencil size={16} />} onClick={() => { close(); setRenaming(cat); }}>{t("common.rename")}</MenuItem>
                          <MenuItem danger icon={<Trash2 size={16} />} onClick={() => { close(); deleteCategory(cat); }}>{t("common.delete")}</MenuItem>
                        </>)}
                      </Menu>) : null}>
                    <SortableContext items={grouped[id].map((b) => b.id)} strategy={view === "list" ? verticalListSortingStrategy : rectSortingStrategy} disabled={!dndEnabled}>
                      <DropZone id={id} view={view} empty={grouped[id].length === 0} emptyText={t("arrange.dropHere")}>
                        {grouped[id].map((b) => <BookmarkTile key={b.id} b={b} view={view} arrange={dndEnabled} canEdit={canEdit(b)} actions={actions} />)}
                      </DropZone>
                    </SortableContext>
                  </Section>
                );
              })}
              {arrange && <button className="btn-outline self-start" onClick={onAddCategory}><FolderPlus size={18} />{t("category.add")}</button>}
            </div>
          </SortableContext>
          <DragOverlay>{activeBookmark ? <BookmarkTile b={activeBookmark} view={view} arrange canEdit={false} actions={actions} overlay /> : null}</DragOverlay>
        </DndContext>
      )}

      <RenameCategory cat={renaming} onClose={() => setRenaming(null)} />
      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title={t("bookmark.deleteTitle")}
        footer={<><button className="btn-ghost" onClick={() => setConfirmDel(null)}>{t("common.cancel")}</button><button className="btn-danger" onClick={doDelete}>{t("common.delete")}</button></>}>
        <p>{t("bookmark.deleteConfirm", { title: confirmDel?.title || "" })}</p>
      </Modal>
    </div>
  );
}

function Section({ id, name, count, collapsed, onToggle, arrange, menu, children }: { id: string; name: string; count: number; collapsed: boolean; onToggle: () => void; arrange: boolean; menu: React.ReactNode; children: React.ReactNode }) {
  const { t } = useI18n();
  const s = useSortable({ id: `sec:${id}`, disabled: !arrange, data: { type: "section" } });
  return (
    <section ref={s.setNodeRef} style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition, opacity: s.isDragging ? 0.5 : 1 }} aria-labelledby={`h-${id}`}>
      <div className="flex items-center gap-1 mb-2.5 -ms-1">
        {arrange && <button className="icon-btn h-9 w-9 touch-none cursor-grab text-muted" aria-label={t("arrange.handleCategory", { name })} {...s.attributes} {...s.listeners}><GripVertical size={18} /></button>}
        <button className="flex items-center gap-1.5 h-9 px-1 rounded-lg hover:text-fg text-start min-w-0" onClick={onToggle} aria-expanded={!collapsed} disabled={arrange}>
          <ChevronDown size={16} className={`text-muted transition-transform shrink-0 ${collapsed ? "-rotate-90 rtl:rotate-90" : ""}`} />
          <h2 id={`h-${id}`} className="font-semibold text-[15px] truncate">{name}</h2>
          <span className="text-xs text-muted tabular-nums">{count}</span>
        </button>
        <span className="flex-1" />
        {menu}
      </div>
      {!collapsed && children}
    </section>
  );
}

function DropZone({ id, view, empty, emptyText, children }: { id: string; view: View; empty: boolean; emptyText: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop:${id}` });
  const cls = view === "list" ? "card overflow-hidden" : view === "compact" ? "grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-1" : "grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3";
  return (
    <div ref={setNodeRef} className={`${cls} ${isOver ? "ring-2 ring-accent/50 rounded-2xl" : ""} ${empty ? "!block border-2 border-dashed border-line rounded-2xl p-6 text-center text-sm text-muted" : ""}`}>
      {empty ? emptyText : children}
    </div>
  );
}

function RenameCategory({ cat, onClose }: { cat: Category | null; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { categories, setCategories } = useStore();
  const [name, setName] = useState("");
  const [lastId, setLastId] = useState<string | null>(null);
  if (cat && cat.id !== lastId) { setLastId(cat.id); setName(cat.name); }
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (!cat) return;
    try { const c = await api<Category>(`/categories/${cat.id}`, { method: "PUT", body: { name } }); setCategories(categories.map((x) => (x.id === c.id ? c : x))); onClose(); } catch { toast(t("error.generic"), "error"); }
  };
  return (
    <Modal open={!!cat} onClose={onClose} title={t("category.rename")}>
      <form onSubmit={save}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus aria-label={t("category.name")} />
        <div className="flex justify-end gap-2 mt-4"><button type="button" className="btn-ghost" onClick={onClose}>{t("common.cancel")}</button><button className="btn-primary">{t("common.save")}</button></div>
      </form>
    </Modal>
  );
}
