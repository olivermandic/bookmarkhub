import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Command, LogOut, Moon, MoveVertical, Plus, Search, Settings as SettingsIcon, Shield, Sun, Check } from "lucide-react";
import type { Bookmark } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useRoute, useStore } from "@/lib/store";
import { applyTheme, getTheme, watchSystemTheme } from "@/lib/theme";
import { AppShell } from "./components/AppShell";
import { BookmarkDialog, CategoryDialog } from "./components/BookmarkDialog";
import { CommandPalette } from "./components/CommandPalette";
import { Home } from "./components/Home";
import { ForcePassword, Login } from "./components/Login";
import { Settings } from "./components/Settings";
import { Admin } from "./components/Admin";
import { Menu, MenuItem, Spinner, useToast } from "./components/ui";

export default function App() {
  const { user, loading } = useStore();
  const { t } = useI18n();
  useEffect(() => watchSystemTheme(), []);
  // language/theme saved in the account follow the user to new devices
  const { choice, setChoice } = useI18n();
  useEffect(() => {
    const p = user?.prefs; if (!p) return;
    if (p.language && !localStorage.getItem("bmh.lang") && p.language !== choice) setChoice(p.language);
    if (p.theme && !localStorage.getItem("bmh.theme.synced")) { localStorage.setItem("bmh.theme.synced", "1"); applyTheme(p.theme); }
  }, [user?.id]); // eslint-disable-line
  if (loading) return <div className="h-full flex items-center justify-center text-muted" aria-label={t("common.loading")}><Spinner size={28} /></div>;
  if (!user) return <Login />;
  if (user.mustChangePassword) return <ForcePassword />;
  return <Main />;
}

function Main() {
  const { t } = useI18n();
  const toast = useToast();
  const { user, refresh, logout } = useStore();
  const [route, go] = useRoute();
  const [arrange, setArrange] = useState(false);
  const [palette, setPalette] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; bookmark: Bookmark | null; cat?: string | null }>({ open: false, bookmark: null });
  const [catDialog, setCatDialog] = useState(false);
  const [dark, setDark] = useState(document.documentElement.classList.contains("dark"));

  const onRefresh = useCallback(async () => { try { await refresh(); } catch { toast(t("error.offline"), "error"); } }, [refresh, toast, t]);
  const openAdd = useCallback((cat?: string | null) => setDialog({ open: true, bookmark: null, cat }), []);
  const toggleTheme = useCallback(() => { const next = document.documentElement.classList.contains("dark") ? "light" : "dark"; applyTheme(next); setDark(next === "dark"); }, []);
  useEffect(() => { const o = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark"))); o.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] }); return () => o.disconnect(); }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
      else if (e.key === "/" && !/input|textarea|select/i.test((e.target as HTMLElement).tagName) && !(e.target as HTMLElement).isContentEditable) { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  useEffect(() => { if (route !== "home") setArrange(false); document.getElementById("main-scroll")?.scrollTo(0, 0); }, [route]);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  const toolbar = (
    <div className="h-14 flex items-center gap-1.5 sm:gap-2">
      {route !== "home" ? (
        <button className="icon-btn -ms-1.5" onClick={() => go("home")} aria-label={t("common.back")}><ArrowLeft size={20} className="rtl:rotate-180" /></button>
      ) : null}
      <a href="#" onClick={(e) => { e.preventDefault(); go("home"); }} className="flex items-center gap-2.5 min-w-0 me-auto rounded-lg">
        <img src="logo.png" alt="" width={30} height={30} className="h-[30px] w-[30px] rounded-lg shrink-0" />
        <span className="font-semibold text-[17px] tracking-tight truncate">BookmarkHub</span>
      </a>
      <button onClick={() => setPalette(true)} className="hidden md:flex items-center gap-2 h-10 w-64 lg:w-80 px-3 rounded-xl border border-line bg-bg text-muted text-sm hover:border-accent/40" aria-label={t("palette.title")} aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}>
        <Search size={16} /><span className="flex-1 text-start">{t("palette.placeholder")}</span>
        <kbd className="inline-flex items-center gap-0.5 text-[11px] border border-line rounded px-1.5 py-0.5">{isMac ? <Command size={11} /> : "Ctrl"}K</kbd>
      </button>
      <button className="icon-btn md:hidden" onClick={() => setPalette(true)} aria-label={t("palette.title")}><Search size={20} /></button>
      {route === "home" && (
        <button className={`icon-btn ${arrange ? "bg-accent text-accent-fg hover:bg-accent/90" : ""}`} onClick={() => setArrange((a) => !a)} aria-pressed={arrange} aria-label={arrange ? t("arrange.done") : t("arrange.start")} title={arrange ? t("arrange.done") : t("arrange.start")}>
          {arrange ? <Check size={20} /> : <MoveVertical size={20} />}
        </button>
      )}
      <button className="btn-primary px-2.5 sm:px-3.5" onClick={() => openAdd()} aria-label={t("bookmark.add")}><Plus size={19} /><span className="hidden sm:inline">{t("bookmark.addShort")}</span></button>
      <Menu label={t("nav.menu")} trigger={<span className="h-8 w-8 rounded-full bg-surface-2 border border-line flex items-center justify-center text-sm font-semibold uppercase">{Array.from(user?.username || "?")[0]}</span>}>
        {(close) => (<>
          <div className="px-2.5 py-2 text-xs text-muted truncate border-b border-line mb-1">{user?.username}</div>
          <MenuItem icon={<SettingsIcon size={16} />} onClick={() => { close(); go("settings"); }}>{t("nav.settings")}</MenuItem>
          {user?.isAdmin && <MenuItem icon={<Shield size={16} />} onClick={() => { close(); go("admin"); }}>{t("nav.admin")}</MenuItem>}
          <MenuItem icon={dark ? <Sun size={16} /> : <Moon size={16} />} onClick={() => { close(); toggleTheme(); }}>{dark ? t("theme.light") : t("theme.dark")}</MenuItem>
          <MenuItem icon={<LogOut size={16} />} onClick={() => { close(); logout(); }}>{t("nav.logout")}</MenuItem>
        </>)}
      </Menu>
    </div>
  );

  return (
    <AppShell toolbar={toolbar} onRefresh={onRefresh}>
      {route === "settings" ? <Settings /> : route === "admin" ? <Admin /> : (
        <Home arrange={arrange} onAdd={openAdd} onEdit={(b) => setDialog({ open: true, bookmark: b })} onAddCategory={() => setCatDialog(true)} />
      )}
      <BookmarkDialog open={dialog.open} bookmark={dialog.bookmark} defaultCategory={dialog.cat} onClose={() => setDialog((d) => ({ ...d, open: false }))} />
      <CategoryDialog open={catDialog} onClose={() => setCatDialog(false)} />
      <CommandPalette open={palette} onClose={() => setPalette(false)} onAdd={() => openAdd()} onToggleTheme={toggleTheme} />
    </AppShell>
  );
}
