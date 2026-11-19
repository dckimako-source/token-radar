import type { ModelConstants, SnapshotProtocol } from './model2.ts';

// ------------------------------------------------------------------ factor math

const MILLIS_PER_DAY = 86_400_000;

/** A finite number, else `fallback`. */
function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** True when the text contains any one of the fragments. */
function containsAny(text: string, fragments: readonly string[]): boolean {
  return fragments.some((fragment) => text.includes(fragment));
}

/**
 * The category weight, from the snapshot's `category` field alone. It is a propensity judgement about
 * the category, never a name: categories whose usage is monetizable through on-chain actions a farmer
 * repeats (trading, lending, hedging) read as worth more per dollar of TVL; a bridge's usage is mostly
 * one-shot transfers, which read as worth less. Everything unmatched scores 1.
 */
export function categoryWeight(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  if (containsAny(c, ['perpetual', 'derivative', 'option'])) return 1.08;
  if (containsAny(c, ['dex', 'lend', 'cdp', 'collateralized'])) return 1.06;
  if (containsAny(c, ['yield', 'liquidity'])) return 1.04;
  if (containsAny(c, ['bridge', 'canonical'])) return 0.85;
  return 1;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / MILLIS_PER_DAY));
}

/** Capital efficiency: one step up per decade of TVL, between the base and the cap. */
function scaleFactor(tvlUsd: number, model: ModelConstants): number {
  return Math.min(model.scale_cap, Math.max(model.scale_base, model.scale_base + model.scale_slope * Math.log10(Math.max(tvlUsd, 1e6) / 1e6)));
}

/** Momentum: a clamped weekly change, turned into a multiplier around one. */
function growthFactor(change7d: number | null, model: ModelConstants): number {
  const raw = finiteOr(change7d, 0);
  const pct = Math.min(model.growth_cap, Math.max(model.growth_floor, raw));
  return 1 + (pct / 100) * model.growth_weight;
}

/** Maturity: a longer run earns a larger share of the age range; unknown age uses the model's default. */
function ageFactor(age: number | null, model: ModelConstants): number {
  const days = age ?? model.unknown_age_days;
  return model.age_floor + (Math.min(Math.max(days, 0), model.age_days) / model.age_days) * model.age_range;
}

/** Chain spread: each extra chain beyond the first adds a step, up to the cap. */
function chainFactor(chainCount: number, model: ModelConstants): number {
  return 1 + Math.min(Math.max(chainCount - 1, 0), model.chain_cap) * model.chain_step;
}

/** The five factors and the implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { implied: number; scaleMult: number; growthMult: number; ageMult: number; chainMult: number; catWeight: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const scaleMult = scaleFactor(protocol.tvl_usd, model);
  const growthMult = growthFactor(protocol.change_7d, model);
  const ageMult = ageFactor(age, model);
  const chainMult = chainFactor(protocol.chains.length, model);
  const catWeight = categoryWeight(protocol.category);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * scaleMult * growthMult * ageMult * chainMult * catWeight));
  return { implied, scaleMult, growthMult, ageMult, chainMult, catWeight, age };
}
