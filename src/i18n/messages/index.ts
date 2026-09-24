import type { Locale } from "@/i18n/config";
import { app as amApp } from "./am/app";
import { auth as amAuth } from "./am/auth";
import { common as amCommon } from "./am/common";
import { growth as amGrowth } from "./am/growth";
import { trading as amTrading } from "./am/trading";
import { app as enApp } from "./en/app";
import { auth as enAuth } from "./en/auth";
import { common as enCommon } from "./en/common";
import { growth as enGrowth } from "./en/growth";
import { trading as enTrading } from "./en/trading";

/**
 * One file per namespace and language so features can add strings without
 * touching each other's files:
 *   common  - navigation, generic buttons/states
 *   auth    - login, registration, phone OTP, password, MFA, account security
 *   growth  - coupons, referrals, certificates, leaderboard
 *   trading - terminal, trading rules, market status, news
 *   app     - landing page, dashboard, challenges, purchases, history, account pages
 * The Amharic files are typed against the English keys, so a missing
 * translation is a compile error rather than a blank label.
 */
export const en = { ...enCommon, ...enAuth, ...enGrowth, ...enTrading, ...enApp };
export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

const am: Messages = { ...amCommon, ...amAuth, ...amGrowth, ...amTrading, ...amApp };

export const dictionaries: Record<Locale, Messages> = { en, am };
