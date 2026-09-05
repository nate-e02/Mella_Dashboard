"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";
import { useRouter } from "next/navigation";

type Kyc = { id: string; status: string; fullName: string; country: string; documentType: string; submittedAt: string; notes: string } | null;

export function KycSubmissionCard({ latest }: { latest: Kyc }) {
  const [fullName, setFullName] = useState("");
  const [country, setCountry] = useState("");
  const [documentType, setDocumentType] = useState("Passport");
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/trader/kyc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, country, documentType }),
      });
      if (!res.ok) throw new Error();
      toast.push("KYC submission received", "success");
      router.refresh();
    } catch {
      toast.push("Failed to submit KYC", "error");
    } finally {
      setSaving(false);
    }
  }

  if (latest && latest.status !== "REJECTED") {
    return (
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">KYC Verification</h3>
          <StatusBadge status={latest.status} />
        </div>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-muted">Full Name</dt>
          <dd className="text-right font-medium">{latest.fullName}</dd>
          <dt className="text-muted">Document Type</dt>
          <dd className="text-right font-medium">{latest.documentType}</dd>
          <dt className="text-muted">Submitted</dt>
          <dd className="text-right font-medium">{formatDateTime(latest.submittedAt)}</dd>
        </dl>
        <p className="mt-3 text-xs text-muted">This is a demo KYC flow — no real identity documents are verified.</p>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <h3 className="mb-1 text-sm font-semibold">KYC Verification</h3>
      <p className="mb-3 text-xs text-muted">
        {latest?.status === "REJECTED" ? "Your previous submission was rejected. Please resubmit." : "Submit your demo KYC details to verify your account."}
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="font-medium">Full Legal Name</span>
          <input className="input-base" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Country</span>
          <input className="input-base" value={country} onChange={(e) => setCountry(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Document Type</span>
          <select className="input-base" value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
            <option>Passport</option>
            <option>Driver&apos;s License</option>
            <option>National ID</option>
          </select>
        </label>
        <button type="submit" className="btn-primary self-start" disabled={saving}>
          {saving ? "Submitting..." : "Submit for Review"}
        </button>
      </form>
    </div>
  );
}
