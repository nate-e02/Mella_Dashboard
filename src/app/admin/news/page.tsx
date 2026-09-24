import { requireAdminPage } from "@/lib/auth/pageGuards";
import { NewsCalendarAdmin } from "@/components/admin/NewsCalendarAdmin";

export const dynamic = "force-dynamic";

export default async function AdminNewsPage() {
  await requireAdminPage();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">News Calendar</h1>
        <p className="text-sm text-muted">
          High-impact economic events for the news-trading rule. Accounts whose challenge forbids news trading cannot open positions on instruments in the event&apos;s
          currency during the window around each HIGH event; stop-loss, take-profit and manual closes still work. The trading worker picks changes up immediately
          {process.env.NEWS_CALENDAR_URL ? " and imports NEWS_CALENDAR_URL every 6 hours" : " (set NEWS_CALENDAR_URL to import a weekly calendar automatically)"}.
        </p>
      </div>
      <NewsCalendarAdmin />
    </div>
  );
}
