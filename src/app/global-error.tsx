"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#05070d", color: "#e7e9ee", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>MellaFx is temporarily unavailable</h1>
          <p style={{ color: "#8b92a4", fontSize: 14 }}>Please try again in a moment.{error.digest ? ` Reference: ${error.digest}` : ""}</p>
          <button onClick={reset} style={{ marginTop: 16, padding: "8px 16px", borderRadius: 8, background: "#3b82f6", color: "white", border: 0 }}>
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
