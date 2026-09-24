import { clsx } from "clsx";
import type { AccountRules } from "@/lib/services/accountState";
import type { Translate } from "@/i18n/server";

/**
 * The challenge's holding / news rules. `compact` shows only the restrictive
 * ones as chips (dashboard card); the full form lists all three (account page).
 */
export function RulesList({ rules, t, compact = false }: { rules: AccountRules; t: Translate; compact?: boolean }) {
  const items = [
    { allowed: rules.weekendHoldingAllowed, label: t("trading.rules.weekend"), hint: t("trading.rules.weekendHint") },
    { allowed: rules.overnightHoldingAllowed, label: t("trading.rules.overnight"), hint: t("trading.rules.overnightHint") },
    { allowed: rules.newsTradingAllowed, label: t("trading.rules.news"), hint: t("trading.rules.newsHint") },
  ];
  if (compact) {
    const restricted = items.filter((i) => !i.allowed);
    if (restricted.length === 0) return null;
    return (
      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        <span className="text-muted">{t("trading.rules.title")}:</span>
        {restricted.map((i) => (
          <span key={i.label} className="rounded bg-warning/10 px-1.5 py-0.5 text-warning" title={i.hint}>
            {t("trading.rules.notAllowedChip", { rule: i.label })}
          </span>
        ))}
      </div>
    );
  }
  return (
    <>
      {items.map((i) => (
        <div key={i.label} className="contents">
          <dt className="text-muted" title={i.hint}>
            {i.label}
          </dt>
          <dd className={clsx("text-right font-medium", !i.allowed && "text-warning")}>{i.allowed ? t("trading.rules.allowed") : t("trading.rules.notAllowed")}</dd>
        </div>
      ))}
    </>
  );
}
