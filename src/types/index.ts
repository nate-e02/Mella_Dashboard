import type { Template } from "@prisma/client";

/**
 * Frozen copy of the challenge-relevant fields of a Template, stored on a
 * Purchase / TradingAccount at the moment of purchase so later edits to the
 * live Template never rewrite an already-sold challenge's rules.
 *
 * `nextPhaseSnapshot` freezes the whole progression chain (Phase 2, Funded)
 * at purchase time as well, so a trader always advances into the rules that
 * were on sale when they paid - never into a template an admin edited later.
 */
export type TemplateSnapshot = Pick<
  Template,
  | "id"
  | "name"
  | "description"
  | "price"
  | "currency"
  | "phase"
  | "programType"
  | "groupName"
  | "groupKey"
  | "startingBalance"
  | "accountSize"
  | "leverage"
  | "accountCurrency"
  | "profitTarget"
  | "profitSplit"
  | "maxDrawdown"
  | "dailyDrawdown"
  | "minTradingDays"
  | "maxTradingDays"
  | "maxPositionSize"
  | "maxPositions"
  | "durationDays"
  | "passingRequirements"
  | "failingRequirements"
  | "weekendHoldingAllowed"
  | "overnightHoldingAllowed"
  | "newsTradingAllowed"
  | "stopLossRequired"
  | "dailyLossResetTime"
  | "consistencyRequirement"
  | "nextPhaseId"
> & {
  snapshotAt: string;
  drawdownMode?: "STATIC" | "TRAILING";
  nextPhaseSnapshot?: TemplateSnapshot | null;
};

export function toTemplateSnapshot(template: Template, nextPhaseSnapshot?: TemplateSnapshot | null): TemplateSnapshot {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    price: template.price,
    currency: template.currency,
    phase: template.phase,
    programType: template.programType,
    groupName: template.groupName,
    groupKey: template.groupKey,
    startingBalance: template.startingBalance,
    accountSize: template.accountSize,
    leverage: template.leverage,
    accountCurrency: template.accountCurrency,
    profitTarget: template.profitTarget,
    profitSplit: template.profitSplit,
    maxDrawdown: template.maxDrawdown,
    drawdownMode: template.drawdownMode,
    dailyDrawdown: template.dailyDrawdown,
    minTradingDays: template.minTradingDays,
    maxTradingDays: template.maxTradingDays,
    maxPositionSize: template.maxPositionSize,
    maxPositions: template.maxPositions,
    durationDays: template.durationDays,
    passingRequirements: template.passingRequirements,
    failingRequirements: template.failingRequirements,
    weekendHoldingAllowed: template.weekendHoldingAllowed,
    overnightHoldingAllowed: template.overnightHoldingAllowed,
    newsTradingAllowed: template.newsTradingAllowed,
    stopLossRequired: template.stopLossRequired,
    dailyLossResetTime: template.dailyLossResetTime,
    consistencyRequirement: template.consistencyRequirement,
    nextPhaseId: template.nextPhaseId,
    nextPhaseSnapshot: nextPhaseSnapshot ?? null,
    snapshotAt: new Date().toISOString(),
  };
}

export type PaginatedResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
