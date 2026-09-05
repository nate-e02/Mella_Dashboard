import { listActiveTemplatesForStorefront } from "@/lib/services/templates";
import { ChallengesGrid } from "@/components/trader/ChallengesGrid";

export const dynamic = "force-dynamic";

export default async function ChallengesPage() {
  const templates = await listActiveTemplatesForStorefront();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Challenges</h1>
        <p className="text-sm text-muted">Choose a challenge and start your funded trading journey. All payments here are demo-only.</p>
      </div>
      <ChallengesGrid templates={templates} />
    </div>
  );
}
