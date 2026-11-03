// Rule kinds and their parameters. Rules are stored with JSON params; thresholds are percentages
// as exact decimal strings (e.g. '20' for 20%).

import { isCurrencyCode, isDecimalString } from '../db/conventions';
import { Decimal } from '../money/decimal';

export type RuleKind = 'concentration' | 'allocation' | 'cash_floor' | 'currency_exposure';

export type ConcentrationParams =
  | { subject: 'security'; maxPercent: string }
  | { subject: 'tag'; tagId: string; maxPercent: string };

export type AllocationParams = {
  targets: { tagId: string; percent: string }[];
  /** Allowed drift either side of each target, in percentage points. */
  tolerance: string;
};

export type CashFloorParams = { minPercent: string };

export type CurrencyExposureParams = { currency: string; maxPercent: string };

export type RuleParams = {
  concentration: ConcentrationParams;
  allocation: AllocationParams;
  cash_floor: CashFloorParams;
  currency_exposure: CurrencyExposureParams;
};

export type Rule = {
  id: string;
  kind: RuleKind;
  name: string;
  /** null = the whole portfolio. */
  scopeBucketId: string | null;
  params: RuleParams[RuleKind];
  enabled: boolean;
};

export const RULE_KIND_LABELS: Record<RuleKind, string> = {
  concentration: 'Concentration limit',
  allocation: 'Allocation targets',
  cash_floor: 'Cash floor',
  currency_exposure: 'Currency exposure limit',
};

export class RuleParamsError extends Error {}

function percent(value: unknown, label: string, { allowZero = true } = {}): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!isDecimalString(text)) throw new RuleParamsError(`${label} must be a number like 20 or 12.5.`);
  const d = Decimal.parse(text);
  if (d.isNegative() || (!allowZero && d.isZero()) || d.greaterThan(Decimal.fromInteger(100))) {
    throw new RuleParamsError(`${label} must be between ${allowZero ? '0' : 'just above 0'} and 100.`);
  }
  return text;
}

function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new RuleParamsError(`Choose ${label}.`);
  return value;
}

/** Validates and normalizes params for a kind. Throws RuleParamsError with a user-facing message. */
export function validateRuleParams<K extends RuleKind>(kind: K, raw: unknown): RuleParams[K] {
  const p = (raw ?? {}) as Record<string, unknown>;
  switch (kind) {
    case 'concentration': {
      const maxPercent = percent(p.maxPercent, 'The limit', { allowZero: false });
      if (p.subject === 'tag') return { subject: 'tag', tagId: id(p.tagId, 'a tag'), maxPercent } as RuleParams[K];
      return { subject: 'security', maxPercent } as RuleParams[K];
    }
    case 'allocation': {
      const targets = Array.isArray(p.targets) ? (p.targets as Record<string, unknown>[]) : [];
      if (targets.length === 0) throw new RuleParamsError('Add at least one target.');
      const clean = targets.map((t) => ({ tagId: id(t.tagId, 'a tag for each target'), percent: percent(t.percent, 'Each target') }));
      if (new Set(clean.map((t) => t.tagId)).size !== clean.length) throw new RuleParamsError('Each tag can only have one target.');
      const total = Decimal.sum(clean.map((t) => Decimal.parse(t.percent)));
      if (total.greaterThan(Decimal.fromInteger(100))) throw new RuleParamsError(`Targets add up to ${total.normalized().toString()}%, more than 100%.`);
      return { targets: clean, tolerance: percent(p.tolerance, 'The tolerance') } as RuleParams[K];
    }
    case 'cash_floor':
      return { minPercent: percent(p.minPercent, 'The minimum', { allowZero: false }) } as RuleParams[K];
    case 'currency_exposure': {
      const currency = typeof p.currency === 'string' ? p.currency : '';
      if (!isCurrencyCode(currency)) throw new RuleParamsError('Choose a currency.');
      return { currency, maxPercent: percent(p.maxPercent, 'The limit') } as RuleParams[K];
    }
    default:
      throw new RuleParamsError('Unknown rule type.');
  }
}

/** Tag ids a rule depends on (so a tag in use can't be deleted). */
export function tagsUsedBy(rule: Pick<Rule, 'kind' | 'params'>): string[] {
  if (rule.kind === 'concentration') {
    const p = rule.params as ConcentrationParams;
    return p.subject === 'tag' ? [p.tagId] : [];
  }
  if (rule.kind === 'allocation') return (rule.params as AllocationParams).targets.map((t) => t.tagId);
  return [];
}
