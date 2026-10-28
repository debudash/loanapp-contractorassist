import type { CardLabel } from "./types";

export function money(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function years(termMonths: number): string {
  return `${termMonths / 12} years`;
}

/** Fills {name} slots in compliance-owned wording with figures from the server. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (slot, name: string) => String(values[name] ?? slot));
}

/** What each card label says. Never "recommended" (NG-3). Kept in step with CARD_TITLES in server/src/quote.ts. */
export const CARD_TITLES: Record<CardLabel, string> = {
  lowest_total: "Lowest total cost",
  lowest_total_and_monthly: "Lowest total cost and lowest monthly",
  lowest_monthly: "Lowest monthly",
  promo: "Promo",
  next_lowest_total: "Next lowest total cost",
  next_lowest_total_2: "Next lowest total cost",
};
