import "server-only";

/**
 * Transactional email. Uses Resend's HTTP API when RESEND_API_KEY and
 * EMAIL_FROM are set; otherwise logs the message (development) so links can
 * be copied from the server console. Never throws to the caller's user flow.
 */
export async function sendEmail(input: { to: string; subject: string; text: string; html?: string }): Promise<{ delivered: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    if (process.env.NODE_ENV !== "test") {
      console.log(`[email:dev] to=${input.to} subject="${input.subject}"\n${input.text}`);
    }
    return { delivered: false };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, text: input.text, html: input.html }),
    });
    if (!res.ok) {
      console.error("email send failed:", res.status, await res.text().catch(() => ""));
      return { delivered: false };
    }
    return { delivered: true };
  } catch (err) {
    console.error("email send error:", err instanceof Error ? err.message : err);
    return { delivered: false };
  }
}
