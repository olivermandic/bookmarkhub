import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Spinner } from "./ui";

/** iPadOS window mode: keep the top-left corner free for the window controls. */
function useWindowControlsReserve() {
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone;
    const iPad = /iPad/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const update = () => {
      const windowed = standalone && iPad && (window.innerWidth < screen.width - 4 && window.innerWidth < screen.height - 4);
      document.documentElement.style.setProperty("--tl-reserve", windowed ? "4.5rem" : "0px");
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
}

/** Pull-to-refresh on the app's own scroll container – also works in the iOS standalone PWA. */
function usePullToRefresh(ref: React.RefObject<HTMLElement>, onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const THRESHOLD = 72;
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let startY = 0; let active = false; let dist = 0;
    const start = (e: TouchEvent) => {
      if (busy || el.scrollTop > 0 || e.touches.length !== 1) { active = false; return; }
      const target = e.target as HTMLElement;
      if (target.closest("[data-no-ptr]")) { active = false; return; }
      startY = e.touches[0].clientY; active = true; dist = 0;
    };
    const move = (e: TouchEvent) => {
      if (!active) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || el.scrollTop > 0) { dist = 0; setPull(0); return; }
      dist = Math.min(120, dy * 0.5);
      setPull(dist);
      if (dy > 8 && e.cancelable) e.preventDefault();
    };
    const end = async () => {
      if (!active) return; active = false;
      if (dist >= THRESHOLD * 0.75) {
        setBusy(true); setPull(48);
        try { await onRefresh(); } finally { setBusy(false); setPull(0); }
      } else setPull(0);
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end); el.addEventListener("touchcancel", end);
    return () => { el.removeEventListener("touchstart", start); el.removeEventListener("touchmove", move); el.removeEventListener("touchend", end); el.removeEventListener("touchcancel", end); };
  }, [ref, onRefresh, busy]);
  return { pull, busy, ready: pull >= THRESHOLD * 0.75 };
}

export function AppShell({ toolbar, children, onRefresh }: { toolbar: ReactNode; children: ReactNode; onRefresh: () => Promise<unknown> }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  useWindowControlsReserve();
  const { pull, busy, ready } = usePullToRefresh(scrollRef, onRefresh);
  return (
    <div className="app-shell">
      <div className="status-strip" data-testid="status-strip" aria-hidden />
      <header className="toolbar" data-testid="toolbar">{toolbar}</header>
      <div ref={scrollRef} className="scroll-area" id="main-scroll">
        <div className="flex justify-center overflow-hidden text-muted transition-[height] duration-150" style={{ height: pull }} aria-hidden={!busy}>
          <div className="flex items-center gap-2 text-sm self-end pb-3">
            {busy ? <><Spinner /> {t("common.refreshing")}</> : <><ArrowDown size={16} className={`transition-transform ${ready ? "rotate-180" : ""}`} /> {ready ? t("ptr.release") : t("ptr.pull")}</>}
          </div>
        </div>
        <main className="min-h-[calc(100%-4rem)]">{children}</main>
        <Footer />
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="page-bottom pt-6 text-center text-xs text-muted">
      © {new Date().getFullYear()} <a href="https://olivermandic.de" target="_blank" rel="noopener" className="hover:text-fg underline-offset-2 hover:underline">Oliver Mandić</a>
      <span className="mx-1.5">·</span>BookmarkHub {__APP_VERSION__}
    </footer>
  );
}
