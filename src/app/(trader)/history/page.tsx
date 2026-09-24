import type { Metadata } from "next";
import { HistoryExplorer } from "@/components/trader/HistoryExplorer";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("app.history.metaTitle") };
}

export default async function HistoryPage() {
  const t = await getT();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("app.history.title")}</h1>
        <p className="text-sm text-muted">{t("app.history.subtitle")}</p>
      </div>
      <HistoryExplorer />
    </div>
  );
}
