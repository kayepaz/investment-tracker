// Checks rules against the valued bucket tree and says where each warning belongs.
//
// - A rule broken by particular holdings (a per-security concentration limit) attaches to those
//   holdings, so their buckets show the badge.
// - A rule about a group (tag concentration, allocation drift, cash floor, currency exposure)
//   attaches to the bucket the rule is scoped to, or to the whole portfolio.
// Holdings without a value are left out of the calculation; the message says so.

import type { WarningResponse } from '../db/rulesRepo';
import { Decimal } from '../money/decimal';
import type { BucketNode, HoldingRow, PortfolioTree } from '../portfolio/tree';
import type { AllocationParams, CashFloorParams, ConcentrationParams, CurrencyExposureParams, Rule } from './types';

const HUNDRED = Decimal.fromInteger(100);

export type WarningTarget =
  | { kind: 'holdings'; holdingKeys: string[] }
  | { kind: 'bucket'; bucketId: string }
  | { kind: 'portfolio' };

export type Warning = {
  /** Stable identity, used for snoozing: rule plus subject. */
  key: string;
  rule: Rule;
  /** e.g. "XIU is 23.4% of the portfolio (limit 20%)". */
  message: string;
  target: WarningTarget;
  /** True when some holdings in scope had no value, so the figure may be off. */
  incomplete: boolean;
  /** The response hiding it, if snoozed or acknowledged through today or later. */
  hiddenBy: WarningResponse | null;
};

export type EvaluationInputs = {
  tree: PortfolioTree;
  rules: Rule[];
  tagsBySecurity: Map<string, Set<string>>;
  tagNames: Map<string, string>;
  securityLabels: Map<string, string>;
  responses: Map<string, WarningResponse>;
  today: string;
};

export type Evaluation = {
  warnings: Warning[];
  /** Visible warnings per bucket, counting each warning once per bucket including those below it. */
  bucketCounts: Map<string, number>;
  /** Visible warnings per holding key. */
  holdingCounts: Map<string, number>;
  /** Visible warnings attached to the whole portfolio. */
  portfolioCount: number;
  visibleCount: number;
};

function findNode(nodes: BucketNode[], id: string): BucketNode | null {
  for (const node of nodes) {
    if (node.bucket.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

function rowsUnder(nodes: BucketNode[]): HoldingRow[] {
  return nodes.flatMap((node) => [...node.holdings, ...rowsUnder(node.children)]);
}

const pct = (value: Decimal) => `${value.toFixed(1)}%`;
const limit = (value: string) => `${Decimal.parse(value).normalized().toString()}%`;

function shareOf(rows: HoldingRow[], total: Decimal): Decimal {
  const sum = Decimal.sum(rows.map((r) => r.value ?? Decimal.ZERO));
  return sum.times(HUNDRED).dividedBy(total, 6);
}

export function evaluateRules(inputs: EvaluationInputs): Evaluation {
  const warnings: Warning[] = [];

  for (const rule of inputs.rules.filter((r) => r.enabled)) {
    let nodes: BucketNode[];
    let total: Decimal;
    let unvalued: number;
    let scopeName: string;
    let target: WarningTarget;
    if (rule.scopeBucketId === null) {
      nodes = inputs.tree.roots;
      total = inputs.tree.total.value;
      unvalued = inputs.tree.total.unvalued;
      scopeName = 'the portfolio';
      target = { kind: 'portfolio' };
    } else {
      const node = findNode(inputs.tree.roots, rule.scopeBucketId);
      if (!node) continue; // Empty or hidden bucket: nothing to check.
      nodes = [node];
      total = node.value;
      unvalued = node.unvalued;
      scopeName = node.bucket.name;
      target = { kind: 'bucket', bucketId: node.bucket.id };
    }
    if (!total.greaterThan(Decimal.ZERO)) continue;

    const rows = rowsUnder(nodes).filter((r) => r.value !== null);
    const hasTag = (row: HoldingRow, tagId: string) => inputs.tagsBySecurity.get(row.securityId)?.has(tagId) ?? false;
    const incomplete = unvalued > 0;
    const add = (key: string, message: string, at: WarningTarget) => {
      const response = inputs.responses.get(key);
      const hiddenBy = response?.hiddenUntil && response.hiddenUntil >= inputs.today ? response : null;
      warnings.push({ key, rule, message, target: at, incomplete, hiddenBy });
    };

    switch (rule.kind) {
      case 'concentration': {
        const p = rule.params as ConcentrationParams;
        const max = Decimal.parse(p.maxPercent);
        if (p.subject === 'security') {
          const bySecurity = new Map<string, HoldingRow[]>();
          for (const row of rows.filter((r) => !r.isCash)) {
            bySecurity.set(row.securityId, [...(bySecurity.get(row.securityId) ?? []), row]);
          }
          for (const [securityId, group] of bySecurity) {
            const share = shareOf(group, total);
            if (share.greaterThan(max)) {
              const label = inputs.securityLabels.get(securityId) ?? group[0]!.label;
              add(`rule:${rule.id}:security:${securityId}`, `${label} is ${pct(share)} of ${scopeName} (limit ${limit(p.maxPercent)})`, {
                kind: 'holdings',
                holdingKeys: group.map((r) => r.key),
              });
            }
          }
        } else {
          const share = shareOf(rows.filter((r) => hasTag(r, p.tagId)), total);
          if (share.greaterThan(max)) {
            const tag = inputs.tagNames.get(p.tagId) ?? 'Tagged holdings';
            add(`rule:${rule.id}:scope`, `${tag} is ${pct(share)} of ${scopeName} (limit ${limit(p.maxPercent)})`, target);
          }
        }
        break;
      }
      case 'allocation': {
        const p = rule.params as AllocationParams;
        const tolerance = Decimal.parse(p.tolerance);
        for (const t of p.targets) {
          const share = shareOf(rows.filter((r) => hasTag(r, t.tagId)), total);
          const goal = Decimal.parse(t.percent);
          if (share.minus(goal).abs().greaterThan(tolerance)) {
            const tag = inputs.tagNames.get(t.tagId) ?? 'Tagged holdings';
            const direction = share.greaterThan(goal) ? 'above' : 'below';
            add(
              `rule:${rule.id}:tag:${t.tagId}`,
              `${tag} is ${pct(share)} of ${scopeName}, ${direction} its ${limit(t.percent)} target (± ${limit(p.tolerance)})`,
              target,
            );
          }
        }
        break;
      }
      case 'cash_floor': {
        const p = rule.params as CashFloorParams;
        const share = shareOf(rows.filter((r) => r.isCash), total);
        if (share.lessThan(Decimal.parse(p.minPercent))) {
          add(`rule:${rule.id}:scope`, `Cash is ${pct(share)} of ${scopeName} (minimum ${limit(p.minPercent)})`, target);
        }
        break;
      }
      case 'currency_exposure': {
        const p = rule.params as CurrencyExposureParams;
        const share = shareOf(rows.filter((r) => r.currency === p.currency), total);
        if (share.greaterThan(Decimal.parse(p.maxPercent))) {
          add(`rule:${rule.id}:scope`, `${p.currency} holdings are ${pct(share)} of ${scopeName} (limit ${limit(p.maxPercent)})`, target);
        }
        break;
      }
    }
  }

  // Where each holding and bucket sits, to roll counts up to ancestors.
  const parentOf = new Map<string, string | null>();
  const bucketOfHolding = new Map<string, string>();
  const index = (nodes: BucketNode[], parent: string | null) => {
    for (const node of nodes) {
      parentOf.set(node.bucket.id, parent);
      for (const h of node.holdings) bucketOfHolding.set(h.key, node.bucket.id);
      index(node.children, node.bucket.id);
    }
  };
  index(inputs.tree.roots, null);
  const withAncestors = (bucketId: string): string[] => {
    const ids: string[] = [];
    for (let id: string | null = bucketId; id !== null; id = parentOf.get(id) ?? null) ids.push(id);
    return ids;
  };

  const bucketCounts = new Map<string, number>();
  const holdingCounts = new Map<string, number>();
  let portfolioCount = 0;
  const visible = warnings.filter((w) => !w.hiddenBy);
  for (const warning of visible) {
    const buckets = new Set<string>();
    if (warning.target.kind === 'portfolio') {
      portfolioCount += 1;
    } else if (warning.target.kind === 'bucket') {
      withAncestors(warning.target.bucketId).forEach((id) => buckets.add(id));
    } else {
      for (const key of warning.target.holdingKeys) {
        holdingCounts.set(key, (holdingCounts.get(key) ?? 0) + 1);
        const bucketId = bucketOfHolding.get(key);
        if (bucketId) withAncestors(bucketId).forEach((id) => buckets.add(id));
      }
    }
    for (const id of buckets) bucketCounts.set(id, (bucketCounts.get(id) ?? 0) + 1);
  }

  return { warnings, bucketCounts, holdingCounts, portfolioCount, visibleCount: visible.length };
}
