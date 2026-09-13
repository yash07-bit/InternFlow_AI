import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "info";

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  durationMs?: number;
}

interface ToastItem extends Required<Omit<ToastOptions, "description">> {
  id: number;
  description?: string;
}

const ToastContext = React.createContext<((opts: ToastOptions) => void) | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <Toaster>");
  return ctx;
}

const ICONS: Record<ToastVariant, React.ReactNode> = {
  success: <CircleCheck className="size-4 text-emerald-600" />,
  error: <CircleAlert className="size-4 text-rose-600" />,
  info: <Info className="size-4 text-accent" />,
};

export function Toaster({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const nextId = React.useRef(1);

  const dismiss = React.useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const toast = React.useCallback(
    (opts: ToastOptions) => {
      const id = nextId.current++;
      const item: ToastItem = { id, title: opts.title, description: opts.description, variant: opts.variant ?? "info", durationMs: opts.durationMs ?? 4200 };
      setToasts((t) => [...t.slice(-3), item]);
      window.setTimeout(() => dismiss(id), item.durationMs);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-3 bottom-3 z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, transition: { duration: 0.15 } }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
              role={t.variant === "error" ? "alert" : "status"}
              className={cn(
                "pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 shadow-raised sm:w-[360px]",
              )}
            >
              <span className="mt-0.5">{ICONS[t.variant]}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-5 font-medium text-ink">{t.title}</p>
                {t.description && <p className="mt-0.5 text-[13px] leading-5 text-ink-3">{t.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="-mt-0.5 -mr-1 inline-flex size-6 items-center justify-center rounded-md text-ink-4 hover:bg-sunken hover:text-ink"
                aria-label="Dismiss notification"
              >
                <X className="size-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
