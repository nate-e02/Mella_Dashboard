import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_Ethiopic } from "next/font/google";
import { I18nProvider } from "@/i18n/client";
import { dictionaries } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Amharic (Ge'ez script) glyphs; used as the fallback after Geist so Latin text is unchanged.
const notoEthiopic = Noto_Sans_Ethiopic({
  variable: "--font-ethiopic",
  subsets: ["ethiopic"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "MellaFx | Prop Trading Platform",
  description: "Ethiopian prop trading firm: trade a simulated ETB account, pass the challenge, get paid to telebirr.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} ${notoEthiopic.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <I18nProvider locale={locale} messages={dictionaries[locale]}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
