import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, localeFromAcceptLanguage, type Locale } from "@/i18n/config";
import { interpolate } from "@/i18n/format";
import { dictionaries, type MessageKey, type Messages } from "@/i18n/messages";

/** Request locale: explicit cookie choice, then the browser's Accept-Language, then English. */
export const getLocale = cache(async (): Promise<Locale> => {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  return localeFromAcceptLanguage((await headers()).get("accept-language")) ?? DEFAULT_LOCALE;
});

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function translator(messages: Messages): Translate {
  return (key, vars) => interpolate(messages[key] ?? key, vars);
}

/** Server components: `const t = await getT(); t("common.nav.trade")`. */
export async function getT(): Promise<Translate> {
  return translator(dictionaries[await getLocale()]);
}

/** Non-request contexts (SMS, email, jobs): translate for an explicit locale. */
export function tFor(locale: string | null | undefined): Translate {
  return translator(dictionaries[isLocale(locale) ? locale : DEFAULT_LOCALE]);
}
