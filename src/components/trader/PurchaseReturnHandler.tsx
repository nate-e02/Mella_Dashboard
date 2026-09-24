"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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
    verifying: { tone: "border-border bg-surface-2 text-muted", message: "Confirming your payment with Chapa…" },
    success: { tone: "border-success/30 bg-success/10 text-success", message: "Payment confirmed — your challenge is now active." },
    pending: { tone: "border-warning/30 bg-warning/10 text-warning", message: "Your payment is still being confirmed. This page will update once Chapa reports the final status." },
    failed: { tone: "border-danger/30 bg-danger/10 text-danger", message: "Your payment was not completed, so no challenge was activated." },
    error: { tone: "border-danger/30 bg-danger/10 text-danger", message: "We couldn't confirm your payment status. Please check back in a moment." },
  };
  const banner = banners[state];
  return (
    <div role="status" className={`card border px-4 py-3 text-sm ${banner.tone}`}>
      {banner.message}
    </div>
  );
}
