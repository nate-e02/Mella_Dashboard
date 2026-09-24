import Link from "next/link";
import { LanguageSwitcher } from "@/components/shared/LanguageSwitcher";
import { getT } from "@/i18n/server";

/** Header shared by the public pages (landing, rules, FAQ). */
export async function PublicHeader() {
  const t = await getT();
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-2 to-accent text-sm font-bold text-white" aria-hidden>
            M
          </span>
          <span className="text-base font-semibold">{t("common.appName")}</span>
        </Link>
        <nav aria-label={t("common.nav.primary")} className="hidden items-center gap-1 md:flex">
          <Link href="/rules" className="whitespace-nowrap rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-white/5 hover:text-foreground">
            {t("common.nav.rules")}
          </Link>
          <Link href="/faq" className="whitespace-nowrap rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-white/5 hover:text-foreground">
            {t("common.nav.faq")}
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <Link href="/login" className="btn-secondary">
            {t("app.landing.login")}
          </Link>
          {/* .btn-* are unlayered CSS and would override `hidden`, so the breakpoint lives on a wrapper. */}
          <span className="hidden sm:inline-flex">
            <Link href="/register" className="btn-primary">
              {t("app.landing.getStarted")}
            </Link>
          </span>
        </div>
      </div>
    </header>
  );
}

/** Footer shared by the public pages: legal disclaimer and links. */
export async function PublicFooter() {
  const t = await getT();
  return (
    <footer className="mt-auto border-t border-border px-4 py-8 text-xs text-muted sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 text-center">
        <nav aria-label={t("app.landing.footer.links")} className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm">
          <Link href="/rules" className="hover:text-foreground">
            {t("common.nav.rules")}
          </Link>
          <Link href="/faq" className="hover:text-foreground">
            {t("common.nav.faq")}
          </Link>
          <Link href="/register" className="hover:text-foreground">
            {t("app.landing.getStarted")}
          </Link>
          <Link href="/login" className="hover:text-foreground">
            {t("app.landing.login")}
          </Link>
        </nav>
        <p className="max-w-3xl leading-relaxed">{t("app.landing.footer.disclaimer")}</p>
        <p>{t("app.landing.footer.copyright", { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  );
}
