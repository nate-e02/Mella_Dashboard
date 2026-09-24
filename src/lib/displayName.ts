/**
 * Privacy-friendly public name: first name plus last initial ("Abebe
 * Kebede" -> "Abebe K."). Used anywhere a trader's name is shown to other
 * people (certificates, referral lists) so full names never leak.
 * Dependency-free so client components and tests can use it too.
 */
export function maskDisplayName(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Trader";
  const first = Array.from(parts[0]).slice(0, 30).join("");
  if (parts.length === 1) return first;
  // Ethiopian names are "given father grandfather": the father's name is the
  // family-name equivalent, so its initial is used. Array.from keeps a whole
  // code point (e.g. an Ethiopic syllable) as the initial.
  const initial = Array.from(parts[1])[0].toLocaleUpperCase("en-US");
  return `${first} ${initial}.`;
}
