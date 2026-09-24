import { formatCurrency, formatSigned } from "@/lib/format";

/** Accounts are denominated in ETB; always pass the currency explicitly. */
export const ACCOUNT_CURRENCY = "ETB";

export function etb(value: number): string {
  return formatCurrency(value, ACCOUNT_CURRENCY);
}

/** ETB amount with an explicit sign, so gains and losses are readable without colour. */
export function signedEtb(value: number): string {
  return formatSigned(value, ACCOUNT_CURRENCY);
}

export function pnlTone(value: number): "success" | "danger" | "default" {
  if (value > 0) return "success";
  if (value < 0) return "danger";
  return "default";
}

export function pnlClass(value: number): string {
  if (value > 0) return "text-success";
  if (value < 0) return "text-danger";
  return "text-foreground";
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
