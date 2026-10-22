import type { Bonus, CardInstance, Condition, Effect, GameData, ScoreLine, ScoreResult } from './types.js';

export interface ScoringInput {
  data: GameData;
  /** every player's team, indexed by seat (relative Meta cards compare against others) */
  teams: CardInstance[][];
  seat: number;
  activeMeta: string[];
  visibleCrisis: CardInstance[];
  bonuses: Bonus[];
  totalTurns: number;
}

type Counts = Map<string, number>;

/** Number of cards per card id in a team. */
export function countCards(team: CardInstance[]): Counts {
  const c: Counts = new Map();
  for (const card of team) c.set(card.id, (c.get(card.id) ?? 0) + 1);
  return c;
}

/** Count of one card id, 0 when absent. */
const n = (c: Counts, id: string) => c.get(id) ?? 0;

/** Number of role cards (employees) in a team [P24]. */
function employees(data: GameData, team: CardInstance[]): number {
  return team.filter((c) => data.byId.get(c.id)?.type === 'role').length;
}

/** How many of the 4 role groups the team has at least one card of. */
function roleGroupCount(data: GameData, c: Counts): number {
  return Object.values(data.cards.roleGroups).filter((ids) => ids.some((id) => n(c, id) > 0)).length;
}

/** The effect of a card id; throws if the card has none. */
function effectOf(data: GameData, id: string): Effect {
  const effect = data.byId.get(id)?.effect;
  if (!effect) throw new Error(`card ${id} has no effect`);
  return effect;
}

/** Points from a 1/2/3+ tier table for a card count. */
function tierScore(tiers: number[], count: number): number {
  if (count <= 0) return 0;
  return tiers[Math.min(count, tiers.length) - 1]!;
}

/**
 * Scores one player. Scoring-time choices (Upskill role, which penalty Tech Debt Payoff cancels)
 * are made in the owner's favour [P25].
 */
export function scorePlayer(input: ScoringInput): ScoreResult {
  const own = input.teams[input.seat] ?? [];
  const tdp = own.filter((c) => c.id === 'tech_debt_payoff').length;
  const cancellable = effectOf(input.data, 'tech_debt_payoff').cancellable as string[];
  const penalties = input.visibleCrisis.filter((c) => cancellable.includes(c.id));

  let best: ScoreResult | null = null;
  for (const cancelled of subsetsUpTo(penalties, tdp)) {
    const result = scoreWithCancellation(input, new Set(cancelled.map((c) => c.uid)));
    if (!best || result.total > best.total) best = result;
  }
  return best!;
}

/** Every subset of `items` with at most `k` elements, including the empty one. */
function subsetsUpTo<T>(items: T[], k: number): T[][] {
  const out: T[][] = [[]];
  if (k <= 0) return out;
  const rec = (start: number, acc: T[]) => {
    for (let i = start; i < items.length; i++) {
      const next = [...acc, items[i]!];
      out.push(next);
      if (next.length < k) rec(i + 1, next);
    }
  };
  rec(0, []);
  return out;
}

/** Score breakdown for one player with the given crisis cards cancelled. */
function scoreWithCancellation(input: ScoringInput, cancelled: Set<string>): ScoreResult {
  const { data, seat } = input;
  const team = input.teams[seat] ?? [];
  const c = countCards(team);
  const lines: ScoreLine[] = [];
  const add = (label: string, points: number) => {
    if (points !== 0) lines.push({ label, points });
  };

  const crisis = input.visibleCrisis.filter((x) => !cancelled.has(x.uid));
  const crisisCount = (id: string) => crisis.filter((x) => x.id === id).length;
  const meta = new Set(input.activeMeta);
  const metaEffect = (id: string) => (meta.has(id) ? effectOf(data, id) : null);

  // Step 1: pair QA with Bug. Paired Bugs no longer count as Bugs for "no bug" conditions [P26].
  const qaEff = effectOf(data, 'qa_tester');
  const bugEff = effectOf(data, 'bug');
  const pairs = Math.min(n(c, 'qa_tester'), n(c, 'bug'));
  const leftoverQa = n(c, 'qa_tester') - pairs;
  const leftoverBug = n(c, 'bug') - pairs;
  // Bug overrides from Meta apply to everyone, the harshest wins [P31].
  let bugValue = bugEff.points as number;
  for (const m of input.activeMeta) {
    const override = effectOf(data, m).override as { cardId: string; points: number } | undefined;
    if (override?.cardId === 'bug') bugValue = Math.min(bugValue, override.points);
  }
  add('QA Tester (unpaired)', leftoverQa * (qaEff.points as number));
  add('Bug (unpaired)', leftoverBug * bugValue);

  const effective: Counts = new Map(c);
  effective.set('bug', leftoverBug);
  const groups = roleGroupCount(data, c);

  // Step 2: role cards.
  const juniors = n(c, 'junior_dev');
  const juniorEff = effectOf(data, 'junior_dev');
  const pmRule = (juniorEff.multipliers as Array<{ factor: number; conflictAtCount: number; conflictScore: number }>)[0]!;
  const pms = n(c, 'project_manager');
  let factor = 1;
  if (pms >= pmRule.conflictAtCount) factor = pmRule.conflictScore;
  else if (pms > 0) {
    factor = pmRule.factor;
    const agile = metaEffect('agile_at_scale');
    if (agile && checkCondition(agile.condition, input, effective)) factor = agile.factor as number;
  }
  // Fractional multipliers (Agile at Scale x2.5) round down [P32].
  add('Junior Developer', Math.floor(tierScore(juniorEff.tiers as number[], juniors) * factor));

  const seniors = n(c, 'senior_dev');
  const seniorEff = effectOf(data, 'senior_dev');
  const ifMissing = seniorEff.ifMissing as { cardId: string; points: number };
  const perSenior = n(c, ifMissing.cardId) > 0 ? (seniorEff.points as number) : ifMissing.points;
  const mergeConflict = crisisCount('merge_conflict') > 0 && seniors >= 2;
  if (mergeConflict) {
    lines.push({ label: 'Senior Developer (Merge Conflict)', points: 0 });
  } else {
    add('Senior Developer', seniors * perSenior);
    // Each visible Technical Debt copy applies [P28].
    add('Technical Debt', -crisisCount('technical_debt') * seniors);
  }

  add('UX/UI Designer', tierScore(effectOf(data, 'designer').tiers as number[], n(c, 'designer')));

  // Step 3: event cards.
  const scopeCreep = crisisCount('scope_creep') > 0;
  add('Coffee', scopeCreep ? 0 : n(c, 'coffee') * (effectOf(data, 'coffee').points as number));
  add('Freelance', n(c, 'freelance') * (effectOf(data, 'freelance').points as number));
  const invEff = effectOf(data, 'investors');
  const invRequires = (invEff.requires as { roleGroups: number }).roleGroups;
  if (!scopeCreep && groups >= invRequires) {
    let perInvestor = invEff.points as number;
    const vc = metaEffect('venture_capital_boom');
    if (vc && checkCondition(vc.condition, input, effective)) perInvestor = vc.points as number;
    add('Investors', n(c, 'investors') * perInvestor);
  }

  // Step 4: boosts. Upskill picks the role with the most cards; Employee of the Month stacks [P16].
  const roleIds = [...data.byId.values()].filter((d) => d.type === 'role').map((d) => d.id);
  const mostRole = Math.max(0, ...roleIds.map((id) => n(c, id)));
  add('Upskill', n(c, 'upskill') * (effectOf(data, 'upskill').points as number) * mostRole);
  if (mostRole > 0) add('Employee of the Month', n(c, 'employee_of_the_month') * (effectOf(data, 'employee_of_the_month').points as number));

  // Step 5: Meta bonuses.
  for (const id of input.activeMeta) {
    const points = metaPoints(id, effectOf(data, id), input, effective, groups);
    add(`Meta: ${data.byId.get(id)?.name ?? id}`, points);
  }

  // Step 6: Crisis bonuses and play-time bonuses.
  const rush = metaEffect('unicorn_rush');
  if (crisisCount('unicorn_hype') > 0) {
    const base = effectOf(data, 'unicorn_hype');
    const requires = rush ? (rush.requires as { roleGroups: number }) : (base.requires as { roleGroups: number });
    const points = rush ? (rush.points as number) : (base.points as number);
    if (groups >= requires.roleGroups && leftoverBug === 0) add('Unicorn Hype', points);
  }
  if (crisisCount('product_launch') > 0) {
    const tiers = effectOf(data, 'product_launch').tiers as Array<{ requires: { roleGroups: number; maxCount?: Record<string, number> }; points: number }>;
    for (const tier of tiers) {
      const okGroups = groups >= tier.requires.roleGroups;
      const okMax = Object.entries(tier.requires.maxCount ?? {}).every(([id, max]) => n(effective, id) <= max);
      if (okGroups && okMax) add('Product Launch', tier.points);
    }
  }
  if (crisisCount('viral_success') > 0 && n(c, 'designer') > 0) {
    const eff = effectOf(data, 'viral_success');
    const most = Math.max(...input.teams.map((t) => countCards(t).get('designer') ?? 0));
    add('Viral Success', n(c, 'designer') === most ? (eff.mostPoints as number) : (eff.otherPoints as number));
  }
  for (const b of input.bonuses) add(b.source, b.points);

  const total = lines.reduce((s, l) => s + l.points, 0);
  return { seat, total, lines };
}

/** Points one active Meta card gives this player. */
function metaPoints(id: string, eff: Effect, input: ScoringInput, c: Counts, groups: number): number {
  const team = input.teams[input.seat] ?? [];
  const ok = checkCondition(eff.condition, input, c);
  switch (eff.kind) {
    case 'per_card_bonus':
      return ok ? (eff.points as number) * n(c, eff.cardId as string) : 0;
    case 'flat_if':
    case 'flat_if_with_override':
      return ok ? (eff.points as number) : 0;
    case 'per_employee_bonus':
      return ok ? (eff.points as number) * employees(input.data, team) : 0;
    case 'per_role_group_bonus':
      return Math.min(eff.max as number, (eff.points as number) * groups);
    case 'per_unused_slot':
      // Baseline = turns in this game [P4].
      return (eff.points as number) * Math.max(0, input.totalTurns - team.length);
    case 'override_card_effect': {
      const penalty = eff.penalty as { cardId: string; pointsEach: number } | undefined;
      return penalty ? penalty.pointsEach * n(c, penalty.cardId) : 0;
    }
    case 'override_multiplier':
    case 'override_points':
      return 0; // applied inside the card they modify
    default:
      throw new Error(`unknown meta effect kind ${eff.kind} on ${id}`);
  }
}

/** Card count for a role group name, or for a single card id. */
function groupOrCard(input: ScoringInput, c: Counts, key: string): number {
  const ids = input.data.cards.roleGroups[key];
  return ids ? ids.reduce((s, id) => s + n(c, id), 0) : n(c, key);
}

/** Whether the player meets a Meta or card condition. */
export function checkCondition(cond: Condition | undefined, input: ScoringInput, c: Counts): boolean {
  if (!cond) return true;
  const team = input.teams[input.seat] ?? [];
  if (cond.maxCount && !Object.entries(cond.maxCount).every(([id, max]) => n(c, id) <= max)) return false;
  if (cond.minCount && !Object.entries(cond.minCount).every(([id, min]) => n(c, id) >= min)) return false;
  if (cond.moreThan && !(groupOrCard(input, c, cond.moreThan[0]) > groupOrCard(input, c, cond.moreThan[1]))) return false;
  if (cond.employeeCountBetween) {
    const e = employees(input.data, team);
    if (e < cond.employeeCountBetween[0] || e > cond.employeeCountBetween[1]) return false;
  }
  if (cond.strictlyMostEmployees) {
    const mine = employees(input.data, team);
    if (!input.teams.every((t, i) => i === input.seat || employees(input.data, t) < mine)) return false;
  }
  if (cond.fewestTotalCards && !input.teams.every((t) => team.length <= t.length)) return false;
  if (cond.maxTotalCards !== undefined && team.length > cond.maxTotalCards) return false;
  return true;
}

/** Highest total wins; ties go to most role cards, then the victory is shared. */
export function winners(data: GameData, scores: ScoreResult[], teams: CardInstance[][]): number[] {
  const top = Math.max(...scores.map((s) => s.total));
  let tied = scores.filter((s) => s.total === top).map((s) => s.seat);
  if (tied.length > 1) {
    const roles = (seat: number) => employees(data, teams[seat] ?? []);
    const most = Math.max(...tied.map(roles));
    tied = tied.filter((s) => roles(s) === most);
  }
  return tied;
}
