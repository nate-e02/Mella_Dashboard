import Link from "next/link";
import { getT } from "@/i18n/server";

export default async function NotFound() {
  const t = await getT();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="text-5xl font-semibold text-muted">404</div>
        <h1 className="mt-2 text-lg font-semibold">{t("app.notFound.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("app.notFound.body")}</p>
        <Link href="/" className="btn-primary mt-5 inline-flex">
          {t("app.notFound.back")}
        </Link>
      </div>
    </div>
  );
}
