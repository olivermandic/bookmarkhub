import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Plus, Search, Settings, Shield, SunMoon, CornerDownLeft } from "lucide-react";
import { hostOf } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/lib/store";
import { Favicon } from "./Favicon";

interface Item { id: string; label: string; sub?: string; icon: JSX.Element; run: () => void }

/** Cmd/Ctrl+K: search all bookmarks and run actions with the keyboard. */
export function CommandPalette({ open, onClose, onAdd, onToggleTheme }: { open: boolean; onClose: () => void; onAdd: () => void; onToggleTheme: () => void }) {
  const { t } = useI18n();
  const { bookmarks, categories, user } = useStore();
  const [q, setQ] = useState(""); const [sel, setSel] = useState(0);
  const ref = useRef<HTMLDialogElement>(null); const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) { setQ(""); setSel(0); d.showModal(); } if (!open && d.open) d.close(); }, [open]);

  const items = useMemo<Item[]>(() => {
    const s = q.trim().toLowerCase();
    const catName = (id?: string | null) => categories.find((c) => c.id === id)?.name || "";
    const bms = bookmarks
      .map((b) => {
        const hay = `${b.title} ${b.url} ${b.description || ""} ${b.tags.join(" ")} ${catName(b.categoryId)}`.toLowerCase();
        const score = !s ? 1 : b.title.toLowerCase().startsWith(s) ? 3 : b.title.toLowerCase().includes(s) ? 2 : hay.includes(s) ? 1 : 0;
        return { b, score };
      })
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.b.title.localeCompare(b.b.title)).slice(0, s ? 30 : 8)
      .map(({ b }) => ({ id: b.id, label: b.title, sub: [hostOf(b.url), catName(b.categoryId)].filter(Boolean).join(" · "), icon: <Favicon b={b} size={22} />, run: () => window.open(b.url, "_blank", "noopener,noreferrer") }));
    const acts: Item[] = [
      { id: "a-add", label: t("bookmark.add"), icon: <Plus size={18} />, run: onAdd },
      { id: "a-settings", label: t("nav.settings"), icon: <Settings size={18} />, run: () => { location.hash = "#/settings"; } },
      ...(user?.isAdmin ? [{ id: "a-admin", label: t("nav.admin"), icon: <Shield size={18} />, run: () => { location.hash = "#/admin"; } }] : []),
      { id: "a-theme", label: t("theme.toggle"), icon: <SunMoon size={18} />, run: onToggleTheme },
    ].filter((a) => !s || a.label.toLowerCase().includes(s));
    return [...bms, ...acts];
  }, [q, bookmarks, categories, user, t, onAdd, onToggleTheme]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);
  const run = (i: Item) => { onClose(); setTimeout(i.run, 0); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter" && items[sel]) { e.preventDefault(); run(items[sel]); }
  };

  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }} aria-label={t("palette.title")}
      className="p-0 bg-transparent text-fg w-[calc(100vw-1.5rem)] max-w-xl mt-[calc(var(--sat)+10vh)] mx-auto">
      {open && (
        <div className="card shadow-pop pop-in overflow-hidden" onKeyDown={onKey}>
          <div className="flex items-center gap-3 px-4 border-b border-line">
            <Search size={18} className="text-muted shrink-0" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("palette.placeholder")} aria-label={t("palette.placeholder")}
              className="flex-1 h-14 bg-transparent outline-none text-base" role="combobox" aria-expanded aria-controls="palette-list" aria-activedescendant={items[sel] ? `pi-${sel}` : undefined} />
            <kbd className="hidden sm:inline text-[11px] text-muted border border-line rounded px-1.5 py-0.5">Esc</kbd>
          </div>
          <div ref={listRef} id="palette-list" role="listbox" className="max-h-[min(60vh,26rem)] overflow-y-auto p-1.5">
            {items.length === 0 && <div className="px-3 py-8 text-center text-muted text-sm">{t("empty.noResults")}</div>}
            {items.map((i, idx) => (
              <div key={i.id} id={`pi-${idx}`} data-idx={idx} role="option" aria-selected={idx === sel} onMouseMove={() => setSel(idx)} onClick={() => run(i)}
                className={`flex items-center gap-3 px-3 h-12 rounded-xl cursor-pointer ${idx === sel ? "bg-surface-2" : ""}`}>
                <span className="w-6 flex justify-center text-muted">{i.icon}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{i.label}</span>{i.sub && <span className="block truncate text-xs text-muted">{i.sub}</span>}</span>
                {idx === sel && (i.id.startsWith("a-") ? <CornerDownLeft size={15} className="text-muted" /> : <ExternalLink size={15} className="text-muted" />)}
              </div>
            ))}
          </div>
        </div>
      )}
    </dialog>
  );
}
