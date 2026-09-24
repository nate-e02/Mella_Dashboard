import type { Metadata } from "next";
import { requireTraderPage } from "@/lib/auth/pageGuards";
import { listActiveTemplatesForStorefront } from "@/lib/services/templates";
import { ChallengesGrid } from "@/components/trader/ChallengesGrid";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("app.challenges.metaTitle") };
}

export default async function ChallengesPage() {
  const [user, templates, t] = await Promise.all([requireTraderPage(), listActiveTemplatesForStorefront(), getT()]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("app.challenges.title")}</h1>
        <p className="text-sm text-muted">{t("app.challenges.subtitle")}</p>
      </div>
      <ChallengesGrid templates={templates} emailVerified={!!(user.emailVerifiedAt || user.phoneVerifiedAt)} />
    </div>
  );
}
