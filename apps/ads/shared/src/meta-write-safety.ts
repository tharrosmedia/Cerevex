import type { ApplyMutation } from "./audit-schemas";
import { stampNoBefore, type LiveEntityState, type MutationOutcome } from "./mutate-types";

/** Q7. A live re-check that does not confirm the target writes nothing. */
export const META_COULD_NOT_CONFIRM = "Couldn't confirm this on Meta. Nothing was written.";

export const META_TARGET_NOT_IN_ACCOUNT = "meta.target_not_in_account";

export const META_TARGET_NOT_IN_ACCOUNT_REASON =
  "This target is in another ad account (meta.target_not_in_account). Nothing was written.";

export const META_TARGET_ID_REASON = "Target id must be digits only. Nothing was written.";

export const META_CURRENCY_REASON =
  "This ad account's currency isn't a 2-decimal currency. Nothing was written.";

/** Pause, budget, and bid fail closed when the live re-check does not confirm the target. */
export const META_CONFIRM_ACTIONS = new Set(["pause", "update_budget", "update_bid"]);

const META_WRITE_ACTIONS = new Set([
  "pause",
  "update_budget",
  "update_bid",
  "create_ad",
  "exclude_placement",
]);

/**
 * Meta Marketing API currencies whose offset is 100 (two decimal places).
 * Budget and bid amounts are sent in minor units, so anything else is refused.
 * Source: Marketing API currency table (offset 100). Zero-decimal codes (offset 1)
 * such as JPY, KRW, TWD, VND, CLP, COP, CRC, HUF, ISK, IDR, and PYG are absent on purpose.
 */
export const META_TWO_DECIMAL_CURRENCIES = [
  "AED",
  "ARS",
  "AUD",
  "BDT",
  "BGN",
  "BHD",
  "BOB",
  "BRL",
  "CAD",
  "CHF",
  "CNY",
  "CZK",
  "DKK",
  "DZD",
  "EGP",
  "EUR",
  "FBZ",
  "GBP",
  "GTQ",
  "HKD",
  "HNL",
  "HRK",
  "ILS",
  "INR",
  "JOD",
  "KES",
  "LTL",
  "LVL",
  "MOP",
  "MXN",
  "MYR",
  "NGN",
  "NIO",
  "NOK",
  "NZD",
  "PEN",
  "PHP",
  "PKR",
  "PLN",
  "QAR",
  "RON",
  "RSD",
  "RUB",
  "SAR",
  "SEK",
  "SGD",
  "SKK",
  "THB",
  "TRY",
  "UAH",
  "USD",
  "UYU",
  "VEF",
  "VES",
  "ZAR",
] as const;

const TWO_DECIMAL = new Set<string>(META_TWO_DECIMAL_CURRENCIES);

export function isMetaTwoDecimalCurrency(currency: string | null | undefined): boolean {
  if (!currency) return false;
  return TWO_DECIMAL.has(currency.trim().toUpperCase());
}

/** Empty or unreadable currency fails closed. A known non-2-decimal code is refused by name. */
export function metaCurrencyRefusal(currency: string | null | undefined): string | null {
  if (isMetaTwoDecimalCurrency(currency)) return null;
  if (!currency?.trim()) return META_COULD_NOT_CONFIRM;
  return META_CURRENCY_REASON;
}

export function normalizeMetaAccountId(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return String(value);
  if (typeof value !== "string") return null;
  const stripped = value.trim().replace(/^act_/i, "");
  return /^\d+$/.test(stripped) ? stripped : null;
}

export function metaTargetIdIsDigits(externalId: string | null | undefined): boolean {
  return typeof externalId === "string" && /^\d+$/.test(externalId);
}

export function metaAccountsMatch(targetAccountId: unknown, accountExternalId: string): boolean {
  const target = normalizeMetaAccountId(targetAccountId);
  const account = normalizeMetaAccountId(accountExternalId);
  return Boolean(target && account && target === account);
}

export function metaTextField(payload: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  if (!payload) return null;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** The first missing create or placement field, in the order the fixtures check. */
export function missingMetaWriteField(mutation: ApplyMutation): "placement" | "page id" | "link" | "name" | "message" | null {
  const payload = mutation.payload ?? {};
  if (mutation.action === "exclude_placement" && !metaTextField(payload, ["placement"])) return "placement";
  if (mutation.action !== "create_ad") return null;
  if (!metaTextField(payload, ["pageId", "page_id"])) return "page id";
  if (!metaTextField(payload, ["link"])) return "link";
  if (!metaTextField(payload, ["proposedName", "name"])) return "name";
  if (!metaTextField(payload, ["body", "message"])) return "message";
  return null;
}

export function missingMetaFieldReason(field: string): string {
  return `Missing ${field}. Nothing was written.`;
}

export function metaWriteFailure(mutation: ApplyMutation, reason: string): MutationOutcome {
  return {
    action: mutation.action,
    platform: "meta",
    target: mutation.target,
    status: "failed",
    mode: "live",
    writes: false,
    reason,
  };
}

/** Refusals that do not need a live read: bad target id, or a hard-coded fallback we no longer fill in. */
export function metaWriteInputRefusal(mutation: ApplyMutation): MutationOutcome | null {
  if (!META_WRITE_ACTIONS.has(mutation.action)) return null;
  if (!metaTargetIdIsDigits(mutation.target.externalId)) {
    return metaWriteFailure(mutation, META_TARGET_ID_REASON);
  }
  const missing = missingMetaWriteField(mutation);
  if (missing) return metaWriteFailure(mutation, missingMetaFieldReason(missing));
  return null;
}

/**
 * Ownership and Q7. A missing read, or a read without account_id, confirms nothing.
 * A present account_id in another ad account is meta.target_not_in_account.
 */
export function metaLiveConfirmRefusal(input: {
  mutation: ApplyMutation;
  live: LiveEntityState | null;
  accountExternalId: string;
}): MutationOutcome | null {
  const { mutation, live } = input;
  if (!META_WRITE_ACTIONS.has(mutation.action)) return null;
  if (!live || live.accountId == null || live.accountId === "") {
    const failure = metaWriteFailure(mutation, META_COULD_NOT_CONFIRM);
    return live ? failure : stampNoBefore(failure);
  }
  if (!metaAccountsMatch(live.accountId, input.accountExternalId)) {
    return metaWriteFailure(mutation, META_TARGET_NOT_IN_ACCOUNT_REASON);
  }
  return null;
}

export function metaCreateCopy(payload: Record<string, unknown> | null | undefined): {
  pageId: string;
  link: string;
  name: string;
  message: string;
  headline: string;
} | null {
  const pageId = metaTextField(payload, ["pageId", "page_id"]);
  const link = metaTextField(payload, ["link"]);
  const name = metaTextField(payload, ["proposedName", "name"]);
  const message = metaTextField(payload, ["body", "message"]);
  if (!pageId || !link || !name || !message) return null;
  return {
    pageId,
    link,
    name,
    message,
    headline: metaTextField(payload, ["headline"]) ?? name,
  };
}
