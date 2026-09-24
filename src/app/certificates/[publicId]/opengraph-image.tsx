import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { certificateText, formatCertificateDate } from "@/lib/growth/certificateText";
import { translator } from "@/i18n/server";
import { dictionaries } from "@/i18n/messages";
import { loadCertificate } from "./data";

export const alt = "MellaFx certificate";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

// Served from public/ so the files ship with the standalone build (see
// Dockerfile). Passing `fonts` replaces the default font, so a Latin serif and
// an Ethiopic face are both loaded; Satori falls back per glyph between them,
// which keeps Amharic names readable.
const fontDir = join(process.cwd(), "public", "fonts", "certificate");
let fontsPromise: Promise<Buffer[]> | null = null;
function loadFonts(): Promise<Buffer[]> {
  // Read once per process, lazily (a missing file must fail this request, not crash the server at import).
  fontsPromise ??= Promise.all(["NotoSerif-Regular.ttf", "NotoSerif-Bold.ttf", "NotoSansEthiopic-Bold.ttf"].map((f) => readFile(join(fontDir, f)))).catch(
    (err) => {
      fontsPromise = null;
      throw err;
    },
  );
  return fontsPromise;
}

/**
 * Link preview for a certificate (Telegram, WhatsApp, X). Rendered in English:
 * crawlers send no locale and the preview is seen by the recipient's contacts.
 */
export default async function Image({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const cert = await loadCertificate(publicId);
  if (!cert) return new Response("Not found", { status: 404 });

  const t = translator(dictionaries.en);
  const text = certificateText(t, cert);
  const [serifRegular, serifBold, ethiopicBold] = await loadFonts();
  const gold = "#b8913a";

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: "#05070d",
        padding: 28,
      }}
    >
      {/* Satori has no `border-style: double`: two nested solid frames instead. */}
      <div
        style={{
          flex: 1,
          display: "flex",
          background: "#fbf8f1",
          border: `3px solid ${gold}`,
          padding: 6,
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "space-between",
            border: `1px solid ${gold}`,
            padding: "34px 60px",
            color: "#1c1b2e",
            fontFamily: "Noto Serif",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                fontSize: 40,
                fontWeight: 700,
              }}
            >
              <svg width="40" height="40" viewBox="0 0 32 32" style={{ marginRight: 12 }}>
                <path d="M16 2 30 12 16 30 2 12Z" fill="#6d5ef8" />
                <path d="M16 2 23 12 16 30 9 12Z" fill="#3b82f6" opacity="0.85" />
              </svg>
              MellaFx
            </div>
            <div
              style={{
                marginTop: 18,
                fontSize: 22,
                letterSpacing: 8,
                color: gold,
                textTransform: "uppercase",
              }}
            >
              {text.kind}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 30, fontStyle: "normal", color: "#6b6a7a" }}>{t("growth.certificate.certifies")}</div>
            <div
              style={{
                marginTop: 8,
                fontSize: 78,
                fontWeight: 700,
                borderBottom: `2px solid ${gold}`,
                padding: "0 32px 6px",
              }}
            >
              {cert.recipientName}
            </div>
            <div
              style={{
                marginTop: 22,
                fontSize: 38,
                fontWeight: 700,
                maxWidth: 1000,
                lineHeight: 1.2,
              }}
            >
              {text.title}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              width: "100%",
              justifyContent: "space-between",
              fontSize: 22,
              color: "#6b6a7a",
            }}
          >
            <div style={{ display: "flex" }}>{formatCertificateDate(cert.issuedAt, "en")}</div>
            <div style={{ display: "flex", color: "#1f7a4a", fontWeight: 700 }}>Verified · {cert.publicId}</div>
          </div>
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        {
          name: "Noto Serif",
          data: serifRegular,
          weight: 400,
          style: "normal",
        },
        { name: "Noto Serif", data: serifBold, weight: 700, style: "normal" },
        {
          name: "Noto Sans Ethiopic",
          data: ethiopicBold,
          weight: 700,
          style: "normal",
        },
      ],
      headers: { "Cache-Control": "public, max-age=86400, immutable" },
    },
  );
}
