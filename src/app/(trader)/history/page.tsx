import { HistoryExplorer } from "@/components/trader/HistoryExplorer";

export default function HistoryPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">History</h1>
        <p className="text-sm text-muted">Select an account and timeframe to review your trade history.</p>
      </div>
      <HistoryExplorer />
    </div>
  );
}
