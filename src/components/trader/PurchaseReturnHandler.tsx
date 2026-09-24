"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";

/**
 * After Chapa's hosted checkout redirects back to /purchases?tx_ref=..., ask
 * the server to verify that payment (authenticated; ownership-checked). The
 * webhook is authoritative regardless - this only makes the customer's own
 * view update immediately.
 */
export function PurchaseReturnHandler({ txRef }: { txRef: string }) {
  const [state, setState] = useState<"verifying" | "success" | "pending" | "failed" | "error">("verifying");
  const router = useRouter();
  const started = useRef(false);
  const t = useT();

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    fetch(`/api/trader/purchases/${encodeURIComponent(txRef)}/verify`, { method: "POST" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return setState("error");
        const outcome = body.outcome as string;
        if (outcome === "PAID" || outcome === "ALREADY_PAID") setState("success");
        else if (outcome === "PENDING") setState("pending");
        else setState("failed");
        router.refresh();
      })
      .catch(() => setState("error"));
  }, [txRef, router]);

  const banners: Record<typeof state, { tone: string; message: string }> = {
    verifying: { tone: "border-border bg-surface-2 text-muted", message: t("growth.purchases.return.verifying") },
    success: { tone: "border-success/30 bg-success/10 text-success", message: t("growth.purchases.return.success") },
    pending: { tone: "border-warning/30 bg-warning/10 text-warning", message: t("growth.purchases.return.pending") },
    failed: { tone: "border-danger/30 bg-danger/10 text-danger", message: t("growth.purchases.return.failed") },
    error: { tone: "border-danger/30 bg-danger/10 text-danger", message: t("growth.purchases.return.error") },
  };
  const banner = banners[state];
  return (
    <div role="status" className={`card border px-4 py-3 text-sm ${banner.tone}`}>
      {banner.message}
    </div>
  );
}
