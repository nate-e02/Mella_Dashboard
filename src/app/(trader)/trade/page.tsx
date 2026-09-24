import Link from "next/link";
import { requireTrader } from "@/lib/auth/guards";
import { listTradableAccounts } from "@/lib/services/accountState";
import { latestFxRates, listInstruments } from "@/lib/services/market";
import { TradeTerminal } from "@/components/trader/terminal/TradeTerminal";

export const dynamic = "force-dynamic";

export const metadata = { title: "Trade · MellaFx" };

export default async function TradePage() {
  const user = await requireTrader();
  const [accounts, instruments, fxRates] = await Promise.all([listTradableAccounts(user.id), listInstruments(), latestFxRates("ETB")]);

  if (accounts.length === 0) {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">No active trading account</h1>
        <p className="mt-2 text-sm text-muted">
          The terminal opens once you have an active or funded challenge account. Pick a challenge to get started, or check your purchases if a
          payment is still being confirmed.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/challenges" className="btn-primary">
            Browse challenges
          </Link>
          <Link href="/purchases" className="btn-secondary">
            My purchases
          </Link>
        </div>
      </div>
    );
  }

  if (instruments.length === 0) {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">Market data is not available yet</h1>
        <p className="mt-2 text-sm text-muted">No instruments are enabled for trading right now. Please check back shortly.</p>
        <Link href="/dashboard" className="btn-secondary mt-5">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Trade</h1>
        <Link href="/dashboard" className="text-xs text-muted hover:text-foreground">
          Objectives →
        </Link>
      </div>
      <TradeTerminal accounts={accounts} instruments={instruments} fxRates={fxRates} />
    </div>
  );
}
