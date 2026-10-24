import { useState } from "react";
import type { Bookmark } from "@/lib/api";
import { hostOf } from "@/lib/api";

// Deterministic colour per host, so the same site always gets the same letter avatar.
function hue(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; }

export function LetterAvatar({ text, seed, size }: { text: string; seed: string; size: number }) {
  const h = hue(seed);
  const ch = Array.from(text.trim() || "?")[0].toUpperCase();
  return (
    <span aria-hidden className="inline-flex items-center justify-center font-semibold rounded-[22%] shrink-0 select-none"
      style={{ width: size, height: size, fontSize: size * 0.48, background: `hsl(${h} 65% 46%)`, color: "#fff" }}>{ch}</span>
  );
}

/** Icon comes from the server's favicon cache (api/favicon/:id) – the browser never contacts the site. */
export function Favicon({ b, size = 32 }: { b: Bookmark; size?: number }) {
  const [failed, setFailed] = useState(false);
  const host = hostOf(b.url);
  const legacy = b.favicon && !/^https?:/i.test(b.favicon) && b.favicon.length <= 8 ? b.favicon : "";
  if (failed || b.iconStatus === "none") {
    if (legacy && /\p{Extended_Pictographic}/u.test(legacy)) return <span aria-hidden className="inline-flex items-center justify-center shrink-0" style={{ width: size, height: size, fontSize: size * 0.8 }}>{legacy}</span>;
    return <LetterAvatar text={b.title || host} seed={host} size={size} />;
  }
  return (
    <span className="inline-flex items-center justify-center shrink-0 rounded-[22%] bg-white ring-1 ring-black/5 overflow-hidden" style={{ width: size, height: size }}>
      <img src={`api/favicon/${encodeURIComponent(b.id)}${b.iconVersion ? `?v=${b.iconVersion}` : ""}`} alt="" width={size} height={size} loading="lazy" decoding="async"
        className="object-contain" style={{ width: size * 0.78, height: size * 0.78 }} onError={() => setFailed(true)} />
    </span>
  );
}
