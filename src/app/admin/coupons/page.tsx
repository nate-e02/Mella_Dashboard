import { requireAdminPage } from "@/lib/auth/pageGuards";
import { CouponsExplorer } from "@/components/admin/CouponsExplorer";

export const dynamic = "force-dynamic";

export default async function AdminCouponsPage() {
  await requireAdminPage();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Coupons</h1>
        <p className="text-sm text-muted">
          Percentage or fixed-ETB discounts for Phase 1 challenges. A redemption is counted when the purchase is paid; a 100% coupon activates the challenge without Chapa. Every change is audited.
        </p>
      </div>
      <CouponsExplorer />
    </div>
  );
}
