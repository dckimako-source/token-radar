// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and may add
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value follows only from the snapshot's own figures:
//
//   scaleMult  = clamp(0.35 + 0.30 x log10(max(tvl, $1M) / $1M), 0.35, 1.05)
//                capital efficiency: a dollar of TVL is worth more in a bigger protocol, with
//                diminishing returns, so the multiple grows one step per decade of TVL
//   growth     = clamp(change_7d, -60, 150) per cent
//   growthMult = 1 + (growth / 100) x 0.6
//   ageMult    = 0.7 + min(age_days, 1095) / 1095 x 0.3   (age unknown: 365 days)
//   chainMult  = 1 + min(chains - 1, 5) x 0.02
//   catWeight  = 0.85 .. 1.08, from the snapshot's category field only (see CATEGORY_WEIGHT)
//   implied    = max(1, round(tvl_usd x scaleMult x growthMult x ageMult x chainMult x catWeight))
//
// Every factor is a function of the snapshot's own ten fields. No protocol name is ever special-cased:
// the same function scores every row. The work is split into four layers below: data shapes, factor
// math, board/farm-plan assembly, and validation of the finished artifacts.

import { impliedValue } from './model-scores.ts';

// ------------------------------------------------------------------ public data shapes

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  scale_base: number;
  scale_slope: number;
  scale_cap: number;
  growth_floor: number;
  growth_cap: number;
  growth_weight: number;
  age_floor: number;
  age_range: number;
  age_days: number;
  chain_step: number;
  chain_cap: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  scale_base: 0.35,
  scale_slope: 0.3,
  scale_cap: 1.05,
  growth_floor: -60,
  growth_cap: 150,
  growth_weight: 0.6,
  age_floor: 0.7,
  age_range: 0.3,
  age_days: 1095,
  chain_step: 0.02,
  chain_cap: 5,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    scale_multiplier: number;
    growth_multiplier: number;
    age_multiplier: number;
    chain_multiplier: number;
    category_weight: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  scale_multiplier: number;
  growth_multiplier: number;
  age_multiplier: number;
  chain_multiplier: number;
  category_weight: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

// ------------------------------------------------------------------ factor math

export { ageDays, categoryWeight, impliedValue } from './model-scores.ts';

// ------------------------------------------------------------------ board assembly

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const RELEASE_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !RELEASE_SUFFIX.test(p.name);
}

/** Ascending slug order, used to break ties deterministically. */
function bySlugName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The snapshot's protocol by slug. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/**
 * The board's candidates: every watchlist slug that the snapshot carries, then the strongest pre-token
 * protocols below the floor. The watchlist is the floor, never a ceiling; an already chosen protocol
 * stays chosen and is never replaced by an early find.
 */
function chooseCandidates(snapshot: Snapshot): SnapshotProtocol[] {
  const index = indexBySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || bySlugName(a.slug, b.slug))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);
  return [...chosen.values()];
}

/** One score, with its protocol, as produced by impliedValue. */
interface ScoredProtocol {
  p: SnapshotProtocol;
  implied: number;
  scaleMult: number;
  growthMult: number;
  ageMult: number;
  chainMult: number;
  catWeight: number;
  age: number | null;
}

/** Four decimal places, the precision the dashboard shows for every factor. */
function roundToFour(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Turn one scored protocol into its board.json row, including its farm plan. */
function toBoardRow(s: ScoredProtocol, rank: number, watchSet: Set<string>): BoardRow {
  return {
    rank,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    on_watchlist: watchSet.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      scale_multiplier: roundToFour(s.scaleMult),
      growth_multiplier: roundToFour(s.growthMult),
      age_multiplier: roundToFour(s.ageMult),
      chain_multiplier: roundToFour(s.chainMult),
      category_weight: roundToFour(s.catWeight),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const chosen = chooseCandidates(snapshot);
  const watchSet = new Set(snapshot.watchlist);
  const scored: ScoredProtocol[] = chosen.map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || bySlugName(a.p.slug, b.p.slug));
  return scored.map((s, i) => toBoardRow(s, i + 1, watchSet));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

// ------------------------------------------------------------------ farm plan generation

/** The first chain a protocol names, or a neutral phrase. */
function primaryChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Chains whose gas is cheap (rollups and sidechains); anything else is priced as a mainnet. */
const LOW_GAS_CHAINS = ['arbitrum', 'base', 'optimism', 'polygon', 'zksync', 'linea', 'scroll', 'blast', 'mode', 'mantle', 'nova', 'unichain', 'soneium', 'sonic', 'berachain', 'abstract', 'ink', 'bob'];

/** What one transaction costs on a protocol's main chain, and how to say it. */
function estimateGas(p: SnapshotProtocol): { gas: number; note: string } {
  const chains = p.chains.map((c) => c.toLowerCase());
  if (chains.some((c) => c.includes('ethereum') || c === 'bitcoin')) return { gas: 12, note: 'Ethereum or a mainnet, where a transaction costs real gas' };
  if (chains.some((c) => LOW_GAS_CHAINS.some((g) => c.includes(g)))) return { gas: 1, note: 'a rollup, where a transaction costs cents' };
  if (chains.length === 0) return { gas: 6, note: 'gas is unknown, so budget for a mainnet' };
  return { gas: 4, note: 'gas on its main chain' };
}

/** How much capital one farm position needs, scaled to the protocol's own TVL. */
function capitalBudget(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 300;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 250_000_000) return 120;
  if (p.tvl_usd >= 50_000_000) return 80;
  return 40;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdingWindow(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 75;
  if (age < 365) return 60;
  return 45;
}

/** The category's primary action, in the words a farmer can follow. */
function describePrimaryAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC as collateral to ${name} on ${chain}, then borrow against it at under 40% loan-to-value so the position earns on both sides.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('liquidity manager')) return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain}, split 50/50 unless the pool asks for one-sided.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the funds inside ${name}'s app so the transfer is more than a pass-through.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's native asset through ${name} on ${chain} and keep the liquid receipt token in your wallet.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small long, then close it; keep leverage under 2x.`;
  if (c.includes('option')) return `Fund $${capital} on ${name} and sell one covered option or buy one cheap long, whichever the vault interface offers.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one position on ${name}'s largest market, then hold it to resolution.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into the ${name} vault on ${chain} with the deepest assets and keep the receipt shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold the balance in the app.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield asset on ${chain} and hold it for the full hold window.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} for a 90-day term and keep the policy.`;
  if (c.includes('liquid') && c.includes('restak')) return `Restake $${capital} of a liquid staking receipt through ${name} on ${chain} and keep the new receipt.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's secondary action: the second thing a serious farmer does in the same protocol. */
function describeFollowUpAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `In ${name}, repay the borrow once mid-window and redraw, so the wallet shows a full borrow-repay cycle.`;
  if (c.includes('dex') || c.includes('yield')) return `Swap once on ${name} from the same wallet (about $${Math.max(20, Math.round(capital / 4))}), and vote or stake the LP fees if the page offers it.`;
  if (c.includes('bridge')) return `Move $${Math.max(20, Math.round(capital / 2))} back the other way through ${name}, so the record shows volume in both directions.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `On ${name}, add a second trade in the opposite direction at low size, so the account shows volume both ways.`;
  if (c.includes('prediction')) return `Take one more small position on ${name} in a different market the next week.`;
  return `Return to ${name} once a week and make any one transaction, however small, from the same wallet.`;
}

/** A bridge lead-in when the farmer's funds start elsewhere, from the protocol's chains. */
function bridgeLeadIn(p: SnapshotProtocol, gas: { gas: number; note: string }): FarmStep | null {
  if (p.chains.length === 0) return null;
  const main = p.chains[0]!.toLowerCase();
  if (LOW_GAS_CHAINS.some((g) => main.includes(g))) return null;
  return {
    text: `Move the farming capital to ${p.chains[0]} first through an official bridge, not a third-party one, and send a test transfer before the full amount.`,
    cost: `$${gas.gas} to $${gas.gas * 2} of bridge gas`,
    time: '20 minutes plus bridge wait',
  };
}

/** Step one: an isolated wallet, so the activity is easy to attribute. */
function freshWalletStep(): FarmStep {
  return {
    text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
    cost: 'no cost, only discipline',
    time: '5 minutes',
  };
}

/** Step two: the category's primary action, priced with the protocol's own gas estimate. */
function primaryActionStep(p: SnapshotProtocol, capital: number, chain: string, gas: { gas: number; note: string }): FarmStep {
  return {
    text: describePrimaryAction(p, capital, chain),
    cost: `$${capital} of capital plus about $${gas.gas} of gas on ${gas.note}`,
    time: '15 to 20 minutes to set up',
  };
}

/** The follow-up action that leaves a second kind of transaction in the same wallet. */
function followUpActionStep(p: SnapshotProtocol, capital: number, chain: string, gas: { gas: number; note: string }): FarmStep {
  return {
    text: describeFollowUpAction(p, capital, chain),
    cost: `$${Math.max(4, Math.round(capital / 4))} of capital at risk, plus $${Math.max(1, Math.round(gas.gas / 3))} of gas`,
    time: '10 minutes',
  };
}

/** The closing steps: recurring activity, a long-enough hold, program checks, claim and log. */
function closingSteps(capital: number, hold: number, age: number | null, gas: { gas: number; note: string }): FarmStep[] {
  return [
    {
      text: `Make one qualifying action each week for the first month - a deposit, a borrow, a swap or a vote - so the wallet's history has more than one cluster.`,
      cost: `about $${Math.max(1, Math.round(gas.gas / 4))} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days - ${age === null ? 'the snapshot lists no date, so assume a young protocol' : `the protocol has run ${age} days with no token`} - so the activity lands in more than one snapshot.`,
      cost: `the $${capital} stays locked in the position`,
      time: `${hold} days`,
    },
    {
      text: `Watch the protocol's own announcements for a points program or governance test, and join it the week it opens; the cheap phases are early.`,
      cost: 'no fee to join',
      time: '15 minutes a fortnight',
    },
    {
      text: `Before you withdraw, check the protocol's own page for a claim; claim only from a link it publishes, and never pay anyone to unlock an airdrop.`,
      cost: 'no fee; a claim that asks for payment is a scam',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, dates and every transaction hash in a farm log so you can repeat the position or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/**
 * A protocol's farm plan: seven or eight steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a hand-written list
 * of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = primaryChain(p);
  const capital = capitalBudget(p);
  const hold = holdingWindow(age);
  const gas = estimateGas(p);
  const steps: FarmStep[] = [freshWalletStep(), primaryActionStep(p, capital, chain, gas)];
  const bridge = bridgeLeadIn(p, gas);
  if (bridge !== null) steps.push(bridge);
  steps.push(followUpActionStep(p, capital, chain, gas));
  steps.push(...closingSteps(capital, hold, age, gas));
  return steps;
}

// ------------------------------------------------------------------ dashboard payload

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    on_watchlist: row.on_watchlist,
    implied_value_usd: row.implied_value_usd,
    scale_multiplier: row.model.scale_multiplier,
    growth_multiplier: row.model.growth_multiplier,
    age_multiplier: row.model.age_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    category_weight: row.model.category_weight,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

// ------------------------------------------------------------------ snapshot validation

/** Turn parsed JSON into the object the model scores, or explain why it cannot. */
function requireDocument(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  return raw as Record<string, unknown>;
}

/** Check the snapshot's header fields, in the same order the gate reports them. */
function requireHeader(o: Record<string, unknown>): void {
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
}

/** Normalize one protocol entry, defaulting every optional field to null or an empty list. */
function readProtocol(value: unknown, i: number): SnapshotProtocol {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
  const p = value as Record<string, unknown>;
  if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
    throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
  }
  return {
    slug: p.slug,
    name: p.name,
    category: typeof p.category === 'string' ? p.category : null,
    chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
    tvl_usd: p.tvl_usd,
    change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
    mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
    listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
    gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
    symbol: typeof p.symbol === 'string' ? p.symbol : null,
  };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  const o = requireDocument(raw);
  requireHeader(o);
  const protocols = (o.protocols as unknown[]).map((v, i) => readProtocol(v, i));
  return {
    as_of: o.as_of as string,
    source: o.source as string,
    floor_usd: o.floor_usd as number,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

// ------------------------------------------------------------------ gate checks

/** Coverage: the board must carry every watchlist slug. */
function missingCoverage(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  return null;
}

/** Ranks must be exactly 1..n, whatever the row order. */
function brokenRanks(board: BoardRow[]): string | null {
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  return null;
}

/** The rows must already be in non-increasing implied value. */
function outOfOrder(board: BoardRow[]): string | null {
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  return null;
}

/** A board whose first and last rows tie values nothing by value. */
function uniformValues(board: BoardRow[]): string | null {
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  return null;
}

/** One row's farm-step and implied-value sanity checks. */
function rowProblem(r: BoardRow): string | null {
  const steps = r.farm_steps;
  if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
  for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
  if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  return null;
}

/** The first unacceptable row, if any. */
function firstRowProblem(board: BoardRow[]): string | null {
  for (const r of board) {
    const problem = rowProblem(r);
    if (problem !== null) return problem;
  }
  return null;
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  return missingCoverage(board, snapshot)
    ?? brokenRanks(board)
    ?? outOfOrder(board)
    ?? uniformValues(board)
    ?? firstRowProblem(board);
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
