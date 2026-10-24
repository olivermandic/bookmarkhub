import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { X, CheckCircle2, AlertCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/** Accessible modal on top of the native <dialog> (focus trap, Esc, inert background). */
export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useI18n();
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={`p-0 mx-auto mt-[calc(var(--sat)+0.75rem)] mb-auto sm:my-auto bg-transparent text-fg max-h-[calc(100dvh-var(--sat)-var(--sab)-1.5rem)] w-[calc(100vw-1.5rem-var(--sal)-var(--sar))] ${wide ? "max-w-2xl" : "max-w-lg"}`}>
      {open && (
        <div className="card pop-in flex flex-col max-h-[calc(100dvh-var(--sat)-var(--sab)-1.5rem)]">
          <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-line">
            <h2 className="text-base font-semibold flex-1 truncate">{title}</h2>
            <button className="icon-btn -me-2" onClick={onClose} aria-label={t("common.close")}><X size={18} /></button>
          </div>
          <div className="px-5 py-4 overflow-y-auto">{children}</div>
          {footer && <div className="px-5 py-3 border-t border-line flex flex-wrap justify-end gap-2">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} id={id} onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-accent" : "bg-line"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? "start-[1.375rem]" : "start-0.5"}`} />
    </button>
  );
}

export function Field({ label, children, hint, htmlFor }: { label: string; children: ReactNode; hint?: string; htmlFor?: string }) {
  return (
    <div className="mb-4">
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="text-xs text-muted mt-1.5">{hint}</p>}
    </div>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <span className="inline-block ptr-spin rounded-full border-2 border-current border-t-transparent" style={{ width: size, height: size }} aria-hidden />;
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-16 px-6">
      <div className="h-14 w-14 rounded-2xl bg-surface-2 flex items-center justify-center text-muted mb-4">{icon}</div>
      <h3 className="font-semibold text-lg">{title}</h3>
      {text && <p className="text-muted mt-1 max-w-sm">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ---- toasts ----
type Toast = { id: number; text: string; kind: "ok" | "error" };
const ToastCtx = createContext<(text: string, kind?: "ok" | "error") => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-2), { id, text, kind }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed z-50 inset-x-0 flex flex-col items-center gap-2 pointer-events-none px-3" style={{ bottom: "calc(var(--sab) + 1rem)" }} aria-live="polite">
        {list.map((x) => (
          <div key={x.id} role={x.kind === "error" ? "alert" : "status"} className="pop-in pointer-events-auto flex items-center gap-2 rounded-xl bg-fg text-bg px-4 py-3 text-sm shadow-pop max-w-md">
            {x.kind === "error" ? <AlertCircle size={18} className="shrink-0 text-danger" /> : <CheckCircle2 size={18} className="shrink-0 text-ok" />}
            <span>{x.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Simple popover menu (click outside / Esc closes). */
export function Menu({ trigger, children, align = "end", label }: { trigger: ReactNode; children: (close: () => void) => ReactNode; align?: "start" | "end"; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", h); document.addEventListener("touchstart", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("touchstart", h); document.removeEventListener("keydown", k); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="icon-btn" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}>{trigger}</button>
      {open && (
        <div role="menu" className={`pop-in absolute z-40 mt-1 min-w-[13rem] card shadow-pop p-1.5 ${align === "end" ? "end-0" : "start-0"}`} onClick={(e) => e.stopPropagation()}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
export function MenuItem({ icon, children, onClick, danger }: { icon?: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button role="menuitem" type="button" onClick={onClick} className={`w-full flex items-center gap-2.5 px-2.5 h-10 rounded-lg text-sm text-start hover:bg-surface-2 ${danger ? "text-danger" : ""}`}>
      {icon && <span className="shrink-0 opacity-80">{icon}</span>}<span className="truncate">{children}</span>
    </button>
  );
}
