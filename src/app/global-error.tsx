"use client";

import { dictionaries } from "@/i18n/messages";
import { interpolate } from "@/i18n/format";

/**
 * Replaces the root layout when it fails, so there is no I18nProvider (and the
 * locale cookie may be the thing that failed). Show both languages instead of
 * guessing; the texts still come from the message catalogue.
 */
const en = dictionaries.en;
const am = dictionaries.am;

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, "Noto Sans Ethiopic", "Nyala", sans-serif',
          background: "#05070d",
          color: "#e7e9ee",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
        }}
      >
        <title>{en["app.globalError.title"]}</title>
        <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{en["app.globalError.title"]}</h1>
          <p style={{ color: "#8b92a4", fontSize: 14 }}>{en["app.globalError.body"]}</p>
          <div lang="am">
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: "20px 0 0" }}>{am["app.globalError.title"]}</h2>
            <p style={{ color: "#8b92a4", fontSize: 14 }}>{am["app.globalError.body"]}</p>
          </div>
          {error.digest && (
            <p style={{ color: "#8b92a4", fontSize: 12, fontFamily: "monospace" }}>{interpolate(en["app.error.reference"], { ref: error.digest })}</p>
          )}
          <button onClick={reset} style={{ marginTop: 16, padding: "8px 16px", borderRadius: 8, background: "#3b82f6", color: "white", border: 0, cursor: "pointer" }}>
            {en["app.globalError.reload"]} · <span lang="am">{am["app.globalError.reload"]}</span>
          </button>
        </div>
      </body>
    </html>
  );
}
