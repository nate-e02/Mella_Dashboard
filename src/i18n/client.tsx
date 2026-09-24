"use client";

import { createContext, useCallback, useContext } from "react";
import type { Locale } from "@/i18n/config";
import { interpolate } from "@/i18n/format";
import type { MessageKey, Messages } from "@/i18n/messages";

type I18nValue = { locale: Locale; messages: Messages };

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ locale, messages, children }: I18nValue & { children: React.ReactNode }) {
  return <I18nContext.Provider value={{ locale, messages }}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useT/useLocale must be used inside <I18nProvider> (see src/app/layout.tsx)");
  return value;
}

export function useLocale(): Locale {
  return useI18n().locale;
}

/** Client components: `const t = useT(); t("common.nav.trade")`. */
export function useT(): (key: MessageKey, vars?: Record<string, string | number>) => string {
  const { messages } = useI18n();
  return useCallback((key: MessageKey, vars?: Record<string, string | number>) => interpolate(messages[key] ?? key, vars), [messages]);
}
