"use client";

import { clsx } from "clsx";
import { useT } from "@/i18n/client";
import { eatDayTime, eatTime } from "./messages";
import type { RuleNotice } from "./rules";

const MAX_SYMBOLS = 4;

/**
 * Heads-up and in-force notices for the account's challenge rules (news
 * windows, weekend and overnight flattening). Only rendered for accounts
 * whose rules restrict them; times are shown in East Africa Time.
 */
export function RuleBanners({ notices, locale }: { notices: RuleNotice[]; locale: string }) {
  const t = useT();
  if (notices.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      {notices.map((n) => {
        let text: string;
        switch (n.kind) {
          case "news": {
            const shown = n.symbols.slice(0, MAX_SYMBOLS).join(", ");
            const symbols = n.symbols.length > MAX_SYMBOLS ? t("trading.banner.moreSymbols", { symbols: shown, count: n.symbols.length - MAX_SYMBOLS }) : shown;
            text = n.active
              ? t("trading.banner.news.active", { currency: n.event.currency, title: n.event.title, symbols, to: eatTime(n.end) })
              : t("trading.banner.news.upcoming", { currency: n.event.currency, time: eatTime(n.event.scheduledAt), symbols, from: eatTime(n.start), to: eatTime(n.end) });
            break;
          }
          case "weekend":
            text = n.active
              ? t("trading.banner.weekend.active", { reopen: eatDayTime(n.reopen, locale) })
              : t("trading.banner.weekend.upcoming", { time: eatDayTime(n.cutoff, locale) });
            break;
          case "overnight":
            text = n.active ? t("trading.banner.overnight.active", { time: eatTime(n.rollover) }) : t("trading.banner.overnight.upcoming", { time: eatTime(n.cutoff) });
            break;
        }
        const key = n.kind === "news" ? `news-${n.event.id}` : n.kind;
        return (
          <div
            key={key}
            className={clsx(
              "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
              n.active ? "border-danger/30 bg-danger/10 text-danger" : "border-warning/30 bg-warning/10 text-warning",
            )}
          >
            <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
            <span>{text}</span>
          </div>
        );
      })}
    </div>
  );
}
