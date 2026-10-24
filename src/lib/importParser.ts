// Parses browser bookmark exports (Netscape HTML: Chrome, Firefox, Safari, Edge) and
// BookmarkHub JSON exports in the browser. Folders become categories (innermost folder name).
export interface ImportItem { title: string; url: string; category?: string; description?: string; tags?: string[]; addDate?: string; isShared?: boolean }

export function parseImport(text: string): ImportItem[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return parseJson(JSON.parse(trimmed));
  return parseNetscape(text);
}

function parseJson(data: any): ImportItem[] {
  const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.bookmarks) ? data.bookmarks : [];
  const cats: Record<string, string> = {};
  if (Array.isArray(data?.categories)) data.categories.forEach((c: any) => { if (c && c.id) cats[c.id] = c.name; });
  return list.filter((b) => b && typeof b.url === "string").map((b) => ({
    title: String(b.title || b.url), url: b.url, description: b.description || "", tags: Array.isArray(b.tags) ? b.tags.map(String) : [],
    category: b.category || (b.categoryId && cats[b.categoryId]) || "", addDate: b.createdAt, isShared: typeof b.isShared === "boolean" ? b.isShared : undefined,
  }));
}

const SKIP_FOLDERS = /^(bookmarks bar|bookmarks toolbar|lesezeichenleiste|lesezeichen-symbolleiste|favoritenleiste|favorites bar|other bookmarks|weitere lesezeichen|andere lesezeichen|mobile bookmarks|menu|bookmarks menu|lesezeichen-menü|favorites|favoriten)$/i;

function parseNetscape(html: string): ImportItem[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: ImportItem[] = [];
  const walk = (dl: Element, folder: string) => {
    for (const dt of Array.from(dl.children)) {
      if (dt.tagName !== "DT") { if (dt.tagName === "DL") walk(dt, folder); continue; }
      const h3 = dt.querySelector(":scope > h3");
      const a = dt.querySelector(":scope > a");
      if (h3) {
        const name = (h3.textContent || "").trim();
        const sub = dt.querySelector(":scope > dl") || (dt.nextElementSibling?.tagName === "DL" ? dt.nextElementSibling : null);
        if (sub) walk(sub, SKIP_FOLDERS.test(name) ? folder : name);
      } else if (a) {
        const url = a.getAttribute("href") || "";
        if (!/^https?:\/\//i.test(url)) continue;
        const add = Number(a.getAttribute("add_date"));
        const tags = (a.getAttribute("tags") || "").split(",").map((s) => s.trim()).filter(Boolean);
        out.push({ title: (a.textContent || "").trim() || url, url, category: folder || "", tags, addDate: add ? new Date(add * 1000).toISOString() : undefined });
      }
    }
  };
  const root = doc.querySelector("dl");
  if (root) walk(root, "");
  return out;
}

/** Same normalisation as the server: scheme, www., trailing slash and #hash are ignored. */
export const normUrl = (u: string) => { try { const x = new URL(u); x.hash = ""; return x.toString().replace(/\/$/, "").replace(/^http:/, "https:").replace("://www.", "://").toLowerCase(); } catch { return ""; } };
