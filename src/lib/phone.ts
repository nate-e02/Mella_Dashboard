/**
 * Phone numbers are stored and compared in E.164 (`+251911234567`). Input is
 * whatever people type: Ethiopian local forms (`0911 23 45 67`, `0711…` for
 * Safaricom Ethiopia, `911234567`), `251…` / `+251…` / `00251…`, with spaces,
 * dashes, dots or parentheses. Ethiopian numbers must be mobile (`+2519…` /
 * `+2517…`, 9 digits after the country code) because only mobiles receive
 * SMS; other countries (diaspora) are accepted as generic E.164.
 *
 * Dependency-free so client components can use it for instant feedback.
 */

const ET_MOBILE = /^\+251[79]\d{8}$/;
const E164 = /^\+[1-9]\d{7,14}$/;

export function normalizePhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed === "" || trimmed.length > 32 || /[^\d\s\-.()+]/.test(trimmed)) return null;

  let digits = trimmed.replace(/[\s\-.()]/g, "");
  if (digits.lastIndexOf("+") > 0) return null;
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;

  let e164: string;
  if (digits.startsWith("+")) e164 = digits;
  else if (/^0[79]\d{8}$/.test(digits)) e164 = `+251${digits.slice(1)}`;
  else if (/^[79]\d{8}$/.test(digits)) e164 = `+251${digits}`;
  else if (/^2510?[79]\d{8}$/.test(digits)) e164 = `+${digits}`;
  else return null;

  if (e164.startsWith("+251")) {
    // "+251 0911…" is a common mix of the international and trunk prefixes.
    if (/^\+2510[79]\d{8}$/.test(e164)) e164 = `+251${e164.slice(5)}`;
    return ET_MOBILE.test(e164) ? e164 : null;
  }
  return E164.test(e164) ? e164 : null;
}

export function isEthiopianMobile(e164: string): boolean {
  return ET_MOBILE.test(e164);
}

/** `+251912345567` → `+251 912 345 567`; other numbers are returned unchanged. */
export function formatPhone(e164: string): string {
  if (!ET_MOBILE.test(e164)) return e164;
  return `+251 ${e164.slice(4, 7)} ${e164.slice(7, 10)} ${e164.slice(10)}`;
}

/** `+251912345567` → `+251 9•• ••• 567`. Safe to show to someone who only typed the number. */
export function maskPhone(e164: string): string {
  if (ET_MOBILE.test(e164)) return `+251 ${e164[4]}•• ••• ${e164.slice(-3)}`;
  if (e164.length < 8) return "•".repeat(e164.length);
  return `${e164.slice(0, 3)} ${"•".repeat(e164.length - 6)} ${e164.slice(-3)}`;
}
