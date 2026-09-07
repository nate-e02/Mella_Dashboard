import Link from "next/link";
import { listActiveTemplatesForStorefront } from "@/lib/services/templates";
import { formatCurrency } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const templates = await listActiveTemplatesForStorefront();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-2 to-accent text-sm font-bold text-white">
              M
            </div>
            <span className="text-base font-semibold">MellaFx</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn-secondary">
              Login
            </Link>
            <Link href="/register" className="btn-primary">
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto flex max-w-4xl flex-col items-center gap-5 px-4 py-20 text-center sm:px-6">
        <span className="rounded-full border border-border bg-surface-2 px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted">
          Demo Prop Trading Platform
        </span>
        <h1 className="text-4xl font-semibold sm:text-5xl">Trade our capital. Keep the upside.</h1>
        <p className="max-w-2xl text-muted">
          Pass an evaluation, get funded, and trade with up to {formatCurrency(500000)} in simulated capital. MellaFx is a local demo
          platform — no real money or live broker connection is involved.
        </p>
        <div className="flex gap-3">
          <Link href="/register" className="btn-primary">
            Start a Challenge
          </Link>
          <Link href="/login" className="btn-secondary">
            I already have an account
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl grid-cols-1 gap-4 px-4 pb-16 sm:grid-cols-3 sm:px-6">
        <Feature title="Two-Phase Evaluation" description="Prove your edge across a structured evaluation before trading firm capital." />
        <Feature title="Up to 80% Profit Split" description="Keep the majority of the profits you generate on funded accounts." />
        <Feature title="Transparent Rules" description="Every drawdown, target, and rule is defined up front and never changes after purchase." />
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
        <h2 className="mb-6 text-center text-2xl font-semibold">Choose Your Challenge</h2>
        {templates.length === 0 ? (
          <div className="card p-10 text-center text-sm text-muted">No challenges are currently available. Check back soon.</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {templates.map((t) => (
              <div key={t.id} className="card flex flex-col gap-3 p-5">
                <div className="text-sm text-muted">{t.groupName}</div>
                <div className="text-2xl font-semibold">{formatCurrency(t.accountSize, t.accountCurrency)}</div>
                <p className="line-clamp-2 text-sm text-muted">{t.description}</p>
                <ul className="flex flex-col gap-1 text-xs text-muted">
                  <li>Profit target: {t.profitTarget ?? "—"}%</li>
                  <li>Profit split: {t.profitSplit}%</li>
                  <li>Max drawdown: {t.maxDrawdown}%</li>
                </ul>
                <div className="mt-auto flex items-center justify-between pt-2">
                  <span className="text-lg font-semibold">{formatCurrency(t.price, t.currency)}</span>
                  <Link href="/register" className="btn-secondary !py-1.5 text-xs">
                    Get Started
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="mt-auto border-t border-border py-6 text-center text-xs text-muted">
        MellaFx is a local demo application. Payments (Chapa) and identity verification (Dojah) are real integrations; trading is simulated — no live broker connection exists.
      </footer>
    </div>
  );
}

function Feature({ title, description }: { title: string; description: string }) {
  return (
    <div className="card p-5">
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <p className="text-xs text-muted">{description}</p>
    </div>
  );
}
