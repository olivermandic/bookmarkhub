// Fetch wrapper: relative URLs (work under any install path), cookies, CSRF header, readable errors.
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function api<T = any>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`api${path}`, {
      method: options.method || "GET",
      credentials: "same-origin",
      headers: { "X-Requested-With": "bookmarkhub", ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError("offline", 0);
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/login") && path !== "/me") window.dispatchEvent(new Event("bmh:unauthorized"));
    throw new ApiError((data && data.error) || `HTTP ${res.status}`, res.status);
  }
  return data as T;
}

export const hostOf = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
};

export interface User {
  id: string; username: string; isAdmin: boolean; isFirstLogin?: boolean; mustChangePassword?: boolean;
  twoFactorEnabled?: boolean; prefs?: Prefs; lastLoginAt?: string | null; bookmarkCount?: number;
}
export interface Prefs {
  view?: "grid" | "list" | "compact"; theme?: "system" | "light" | "dark"; sort?: "manual" | "title" | "recent";
  language?: string; categoryOrder?: string[]; bookmarkOrder?: Record<string, string[]>; collapsed?: string[];
}
export interface LinkStatus { state: "ok" | "broken" | "unknown"; code?: number; error?: string; checkedAt?: string; fails?: number }
export interface Bookmark {
  id: string; title: string; url: string; description?: string; tags: string[]; isShared: boolean; createdBy: string;
  createdAt: string; updatedAt: string; categoryId?: string | null; iconUrl?: string; favicon?: string;
  iconStatus?: "found" | "fallback" | "custom" | "none"; iconVersion?: string | null; linkStatus?: LinkStatus;
}
export interface Category { id: string; name: string; createdBy: string; createdAt: string }
export interface Job { kind: string; running: boolean; total: number; done: number; results: Record<string, number>; startedAt: string; finishedAt: string | null }
