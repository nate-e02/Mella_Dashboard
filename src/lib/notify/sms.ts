import "server-only";

/**
 * SMS via a generic HTTP gateway (GeezSMS / SMSEthiopia / 251SMS all expose a
 * JSON POST). Configure SMS_GATEWAY_URL (endpoint accepting {to, message}),
 * SMS_API_KEY (Bearer) and optionally SMS_SENDER_ID. Without configuration
 * the message is logged (development).
 */
export async function sendSms(input: { to: string; message: string }): Promise<{ delivered: boolean }> {
  const url = process.env.SMS_GATEWAY_URL;
  const key = process.env.SMS_API_KEY;
  if (!url || !key) {
    if (process.env.NODE_ENV !== "test") console.log(`[sms:dev] to=${input.to}: ${input.message}`);
    return { delivered: false };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: input.to, message: input.message, sender_id: process.env.SMS_SENDER_ID }),
    });
    if (!res.ok) {
      console.error("sms send failed:", res.status);
      return { delivered: false };
    }
    return { delivered: true };
  } catch (err) {
    console.error("sms send error:", err instanceof Error ? err.message : err);
    return { delivered: false };
  }
}
