"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";

type Kyc = {
  id: string;
  status: string;
  submittedAt: string;
  failureReason: string | null;
} | null;

const WIDGET_SCRIPT_SRC = "https://widget.dojah.io/widget.js";

type DojahConnectOptions = {
  app_id: string;
  p_key: string;
  type: string;
  config: { widget_id: string };
  reference_id: string;
  user_data?: Record<string, unknown>;
  onSuccess?: (response: unknown) => void;
  onError?: (err: unknown) => void;
  onClose?: () => void;
};

declare global {
  interface Window {
    Connect?: new (options: DojahConnectOptions) => { setup: () => void; open: () => void };
  }
}

function loadWidgetScript(): Promise<void> {
  if (typeof window !== "undefined" && window.Connect) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${WIDGET_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load verification widget")));
      return;
    }
    const script = document.createElement("script");
    script.src = WIDGET_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load verification widget"));
    document.body.appendChild(script);
  });
}

/** Friendly text for the safe, normalized failure category - never the raw provider payload. */
function describeFailure(reason: string | null): string {
  if (!reason) return "Verification could not be completed.";
  if (reason === "abandoned_by_user") return "The verification session was closed before it finished.";
  if (reason.endsWith("_verification_failed")) return "One or more verification steps could not be confirmed.";
  return "Verification could not be completed.";
}

export function KycSubmissionCard({ latest }: { latest: Kyc }) {
  const [starting, setStarting] = useState(false);
  const [awaitingResult, setAwaitingResult] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const pollCountRef = useRef(0);

  const status = latest?.status;

  // While a verification is PENDING (submitted, awaiting the provider's
  // signed webhook - see kycVerification.ts), periodically refresh this
  // server-rendered page so the trader sees VERIFIED/FAILED as soon as it
  // resolves, without needing a manual reload. Capped so it doesn't poll
  // forever if the trader leaves the tab open.
  useEffect(() => {
    if (status !== "PENDING") {
      pollCountRef.current = 0;
      return;
    }
    if (pollCountRef.current >= 24) return; // ~2 minutes at 5s intervals
    const timer = setTimeout(() => {
      pollCountRef.current += 1;
      router.refresh();
    }, 5000);
    return () => clearTimeout(timer);
  }, [status, latest?.submittedAt, router]);

  async function startVerification() {
    setStarting(true);
    try {
      const res = await fetch("/api/trader/kyc", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to start verification");

      await loadWidgetScript();
      if (!window.Connect) throw new Error("Verification widget failed to load");

      const session = body.session as { appId: string; publicKey: string; widgetId: string; referenceId: string; type: string; userData?: Record<string, unknown> };

      const connect = new window.Connect({
        app_id: session.appId,
        p_key: session.publicKey,
        type: session.type,
        config: { widget_id: session.widgetId },
        reference_id: session.referenceId,
        user_data: session.userData,
        onSuccess: () => {
          // Per Dojah's own guidance, this callback is NOT proof of
          // verification - only the signed server-side webhook is. We just
          // reflect "submitted" here and let polling pick up the real result.
          setAwaitingResult(true);
          toast.push("Verification submitted — confirming your result...", "success");
          router.refresh();
        },
        onClose: () => {
          setAwaitingResult(true);
          router.refresh();
        },
        onError: () => {
          toast.push("Verification could not be started. Please try again.", "error");
        },
      });
      connect.setup();
      connect.open();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Failed to start verification", "error");
    } finally {
      setStarting(false);
    }
  }

  if (status === "APPROVED") {
    return (
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">KYC Verification</h3>
          <StatusBadge status="APPROVED" />
        </div>
        <p className="text-sm text-muted">Your identity has been verified.</p>
      </div>
    );
  }

  if (status === "PENDING") {
    return (
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">KYC Verification</h3>
          <StatusBadge status="PENDING" />
        </div>
        <p className="text-sm text-muted">
          {awaitingResult
            ? "Your verification has been submitted and is being confirmed. This page will update automatically."
            : "A verification session is in progress. If you closed it before finishing, you can start a new one below."}
        </p>
        <p className="mt-2 text-xs text-muted">Submitted {formatDateTime(latest!.submittedAt)}</p>
        {!awaitingResult && (
          <button className="btn-primary mt-3" onClick={startVerification} disabled={starting}>
            {starting ? "Starting..." : "Resume Verification"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="card p-5">
      <h3 className="mb-1 text-sm font-semibold">KYC Verification</h3>
      {status === "REJECTED" ? (
        <>
          <p className="mb-1 text-xs text-danger">{describeFailure(latest!.failureReason)}</p>
          <p className="mb-3 text-xs text-muted">You can start a new verification below.</p>
        </>
      ) : (
        <p className="mb-3 text-xs text-muted">Verify your identity to complete your account setup.</p>
      )}
      <button className="btn-primary" onClick={startVerification} disabled={starting}>
        {starting ? "Starting..." : "Start Verification"}
      </button>
    </div>
  );
}
