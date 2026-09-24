import { requireTraderPage } from "@/lib/auth/pageGuards";
import { listActiveTemplatesForStorefront } from "@/lib/services/templates";
import { ChallengesGrid } from "@/components/trader/ChallengesGrid";

export const dynamic = "force-dynamic";

export default async function ChallengesPage() {
  const [user, templates] = await Promise.all([requireTraderPage(), listActiveTemplatesForStorefront()]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Challenges</h1>
        <p className="text-sm text-muted">Choose a challenge, pay in birr, and start trading. Prices include everything; the fee is refunded with your first payout.</p>
      </div>
      <ChallengesGrid templates={templates} emailVerified={!!user.emailVerifiedAt} />
    </div>
  );
}
