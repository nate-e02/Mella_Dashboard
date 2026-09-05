import { KycTable } from "@/components/admin/KycTable";

export default function AdminKycPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">KYC Verification</h1>
        <p className="text-sm text-muted">Demo KYC review queue — no real identity verification provider is integrated.</p>
      </div>
      <KycTable />
    </div>
  );
}
