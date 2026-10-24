// App state: session user, bookmarks, categories. One refresh() reloads everything (pull-to-refresh).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type AppConfig, type Bookmark, type Category, type Person, type Prefs, type User } from "./api";

interface Store {
  user: User | null; loading: boolean; bookmarks: Bookmark[]; categories: Category[]; config: AppConfig | null; people: Person[];
  reloadConfig: () => Promise<void>;
  setUser: (u: User | null) => void; refresh: () => Promise<void>; logout: () => Promise<void>;
  savePrefs: (p: Partial<Prefs>) => Promise<void>;
  upsertBookmark: (b: Bookmark) => void; removeBookmark: (id: string) => void; patchBookmark: (id: string, p: Partial<Bookmark>) => void;
  setCategories: (c: Category[]) => void;
}
const Ctx = createContext<Store>(null as any);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const userRef = useRef(user); userRef.current = user;

  const loadData = useCallback(async () => {
    const [b, c, cfg, ppl] = await Promise.all([api<Bookmark[]>("/bookmarks"), api<Category[]>("/categories"), api<AppConfig>("/config").catch(() => null), api<Person[]>("/users/directory").catch(() => [])]);
    setBookmarks(b); setCategories(c); if (cfg) setConfig(cfg); setPeople(ppl);
  }, []);
  const refresh = useCallback(async () => {
    try {
      const me = await api<User>("/me");
      setUser(me);
      if (!me.mustChangePassword) await loadData();
    } catch (e: any) {
      if (e.status === 401) setUser(null);
      else throw e;
    }
  }, [loadData]);

  useEffect(() => { refresh().catch(() => {}).finally(() => setLoading(false)); }, [refresh]);
  useEffect(() => {
    const h = () => setUser(null);
    window.addEventListener("bmh:unauthorized", h);
    return () => window.removeEventListener("bmh:unauthorized", h);
  }, []);
  useEffect(() => { if (user && !user.mustChangePassword) loadData().catch(() => {}); }, [user?.id, user?.mustChangePassword, loadData]);
  // refresh when the app comes back to the foreground (PWA)
  useEffect(() => {
    const h = () => { if (document.visibilityState === "visible" && userRef.current) refresh().catch(() => {}); };
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, [refresh]);

  const reloadConfig = useCallback(async () => { const [cfg, ppl] = await Promise.all([api<AppConfig>("/config"), api<Person[]>("/users/directory")]); setConfig(cfg); setPeople(ppl); }, []);
  const logout = useCallback(async () => { try { await api("/logout", { method: "POST" }); } finally { setUser(null); setBookmarks([]); } }, []);
  const savePrefs = useCallback(async (p: Partial<Prefs>) => {
    setUser((u) => (u ? { ...u, prefs: { ...(u.prefs || {}), ...p } } : u)); // optimistic
    const u = await api<User>("/me/prefs", { method: "PUT", body: p });
    setUser((cur) => (cur ? { ...cur, prefs: u.prefs } : cur));
  }, []);
  const upsertBookmark = useCallback((b: Bookmark) => setBookmarks((l) => (l.some((x) => x.id === b.id) ? l.map((x) => (x.id === b.id ? b : x)) : [...l, b])), []);
  const removeBookmark = useCallback((id: string) => setBookmarks((l) => l.filter((x) => x.id !== id)), []);
  const patchBookmark = useCallback((id: string, p: Partial<Bookmark>) => setBookmarks((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x))), []);

  const value = useMemo(() => ({ user, loading, bookmarks, categories, config, people, reloadConfig, setUser, refresh, logout, savePrefs, upsertBookmark, removeBookmark, patchBookmark, setCategories }),
    [user, loading, bookmarks, categories, config, people, reloadConfig, refresh, logout, savePrefs, upsertBookmark, removeBookmark, patchBookmark]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useStore = () => useContext(Ctx);

/** Tiny hash router (#/settings, #/admin) – independent of the install path. */
export function useRoute(): [string, (r: string) => void] {
  const get = () => (location.hash.replace(/^#\/?/, "") || "home").split("?")[0];
  const [route, setRoute] = useState(get);
  useEffect(() => { const h = () => setRoute(get()); window.addEventListener("hashchange", h); return () => window.removeEventListener("hashchange", h); }, []);
  return [route, (r: string) => { location.hash = r === "home" ? "" : `#/${r}`; }];
}
