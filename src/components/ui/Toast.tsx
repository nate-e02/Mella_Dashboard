"use client";

import { createContext, useCallback, useContext, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";

type Toast = { id: number; message: string; tone: "success" | "error" | "info" };
type ToastContextValue = { push: (message: string, tone?: Toast["tone"]) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

const noopSubscribe = () => () => {};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // False on the server and during hydration, true afterwards: the portal is
  // only created once the client tree matches the server HTML.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

  const push = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      {mounted &&
        createPortal(
          <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2" role="status" aria-live="polite">
            {toasts.map((t) => (
              <div
                key={t.id}
                className={clsx(
                  "card min-w-[260px] px-4 py-3 text-sm shadow-lg",
                  t.tone === "success" && "border-success/40 text-success",
                  t.tone === "error" && "border-danger/40 text-danger",
                  t.tone === "info" && "text-foreground",
                )}
              >
                {t.message}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
