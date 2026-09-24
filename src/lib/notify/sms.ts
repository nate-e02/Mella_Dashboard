import "server-only";
import { maskPhone } from "@/lib/phone";

/**
 * Outbound SMS. SMS_PROVIDER picks the gateway:
 *  - `afromessage`: AfroMessage (api.afromessage.com), the common Ethiopian
 *    gateway. AFROMESSAGE_TOKEN (Bearer), AFROMESSAGE_IDENTIFIER_ID (the
 *    short code / identifier the message is sent from) and optionally
 *    AFROMESSAGE_SENDER_NAME (an approved sender name).
 *  - `generic`: any HTTP gateway accepting a JSON POST {to, message, sender_id}
 *    with a Bearer key (GeezSMS / SMSEthiopia / 251SMS): SMS_GATEWAY_URL,
 *    SMS_API_KEY, optionally SMS_SENDER_ID.
 *  - unset: `generic` when SMS_GATEWAY_URL/SMS_API_KEY are set (backwards
 *    compatible), otherwise no provider.
 * Without a configured provider the message is printed in development (so OTP
 * codes can be copied from the server console) and dropped in production.
 * Never throws; message bodies are never logged outside development.
 */

export type SmsProvider = "afromessage" | "generic" | "console";
export type SmsResult = { delivered: boolean; provider: SmsProvider };

const TIMEOUT_MS = 10_000;
const AFROMESSAGE_URL = "https://api.afromessage.com/api/send";

function configuredProvider(): Exclude<SmsProvider, "console"> | null {
  const choice = (process.env.SMS_PROVIDER ?? "").trim().toLowerCase();
  if (choice === "afromessage") return process.env.AFROMESSAGE_TOKEN && process.env.AFROMESSAGE_IDENTIFIER_ID ? "afromessage" : null;
  if (choice === "generic" || choice === "") return process.env.SMS_GATEWAY_URL && process.env.SMS_API_KEY ? "generic" : null;
  return null;
}

/** True when a real gateway is configured (OTP login fails closed in production without one). */
export function smsConfigured(): boolean {
  return configuredProvider() !== null;
}

export async function sendSms(input: { to: string; message: string }): Promise<SmsResult> {
  const provider = configuredProvider();
  if (!provider) {
    if (process.env.NODE_ENV === "development") console.log(`[sms:dev] to=${input.to}: ${input.message}`);
    else if (process.env.NODE_ENV !== "test") console.warn(`[sms] no SMS provider configured; message to ${maskPhone(input.to)} dropped`);
    return { delivered: false, provider: "console" };
  }
  try {
    const delivered = provider === "afromessage" ? await sendViaAfroMessage(input) : await sendViaGenericGateway(input);
    return { delivered, provider };
  } catch (err) {
    // Timeouts and network errors. The message (which may hold a code) is not logged.
    console.error(`sms send error (${provider}) to ${maskPhone(input.to)}:`, err instanceof Error ? err.name : "unknown");
    return { delivered: false, provider };
  }
}

/**
 * AfroMessage send API: POST {from, sender, to, message} with a Bearer token.
 * It answers HTTP 200 even for rejected messages; the outcome is in the body:
 * `{ acknowledge: "success" | "error", response: {...} }`.
 */
async function sendViaAfroMessage(input: { to: string; message: string }): Promise<boolean> {
  const res = await fetch(AFROMESSAGE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.AFROMESSAGE_TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      from: process.env.AFROMESSAGE_IDENTIFIER_ID,
      sender: process.env.AFROMESSAGE_SENDER_NAME || undefined,
      to: input.to,
      message: input.message,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => null)) as { acknowledge?: string; response?: { errors?: unknown } } | null;
  if (res.ok && body?.acknowledge === "success") return true;
  // The error payload describes the request (e.g. "invalid phone", "insufficient balance"), not the message text.
  console.error(`sms send failed (afromessage) to ${maskPhone(input.to)}: status=${res.status}`, JSON.stringify(body?.response?.errors ?? body?.response ?? null).slice(0, 300));
  return false;
}

async function sendViaGenericGateway(input: { to: string; message: string }): Promise<boolean> {
  const res = await fetch(process.env.SMS_GATEWAY_URL!, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SMS_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to: input.to, message: input.message, sender_id: process.env.SMS_SENDER_ID }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    console.error(`sms send failed (generic) to ${maskPhone(input.to)}: status=${res.status}`);
    return false;
  }
  return true;
}
