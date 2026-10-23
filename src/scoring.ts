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

/** Points from a 1/2/3 tier table for a card count, plus `perExtra` for each card past the table. */
function tierScore(tiers: number[], count: number, perExtra = 0): number {
  if (count <= 0) return 0;
  return tiers[Math.min(count, tiers.length) - 1]! + Math.max(0, count - tiers.length) * perExtra;
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

  // Each Tech Debt Payoff cancels one penalty or gives its points instead, whichever scores more.
  const unusedPoints = effectOf(input.data, 'tech_debt_payoff').pointsIfUnused as number;
  let best: ScoreResult | null = null;
  for (const cancelled of subsetsUpTo(penalties, tdp)) {
    const result = scoreWithCancellation(input, new Set(cancelled.map((c) => c.uid)));
    const unused = tdp - cancelled.length;
    if (unused > 0) {
      result.lines.push({ label: 'Tech Debt Payoff', points: unused * unusedPoints });
      result.total += unused * unusedPoints;
    }
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
  else if (pms > 0) factor = pmRule.factor;
  add('Junior Developer', tierScore(juniorEff.tiers as number[], juniors, juniorEff.pointsEachAfterTiers as number) * factor);
  add('Project Manager', pms * (effectOf(data, 'project_manager').points as number));

  const seniors = n(c, 'senior_dev');
  const seniorEff = effectOf(data, 'senior_dev');
  const ifMissing = seniorEff.ifMissing as { cardId: string; points: number };
  const perSenior = n(c, ifMissing.cardId) > 0 ? (seniorEff.points as number) : ifMissing.points;
  // Merge Conflict sets every Senior to a fixed value; each visible Technical Debt copy still applies [P28].
  const mergeConflict = crisisCount('merge_conflict') > 0;
  const seniorValue = mergeConflict ? Math.min(perSenior, effectOf(data, 'merge_conflict').points as number) : perSenior;
  add(mergeConflict ? 'Senior Developer (Merge Conflict)' : 'Senior Developer', seniors * seniorValue);
  add('Technical Debt', -crisisCount('technical_debt') * seniors);

  add('UX/UI Designer', tierScore(effectOf(data, 'designer').tiers as number[], n(c, 'designer')));

  // Step 3: event cards.
  const scopeCreep = crisisCount('scope_creep') > 0;
  add('Coffee', scopeCreep ? 0 : n(c, 'coffee') * (effectOf(data, 'coffee').points as number));
  add('Freelance', scopeCreep ? 0 : n(c, 'freelance') * (effectOf(data, 'freelance').points as number));
  const invEff = effectOf(data, 'investors');
  const allGroups = Object.keys(data.cards.roleGroups).length;
  const fullTeam = groups >= allGroups;
  if (!scopeCreep) {
    const perInvestor = groups * (invEff.pointsPerRoleType as number) + (fullTeam ? (invEff.fullTeamPoints as number) : 0);
    add('Investors', n(c, 'investors') * perInvestor);
  }

  // Step 4: boosts. Upskill picks the role with the most cards; Employee of the Month stacks [P16].
  const roleIds = [...data.byId.values()].filter((d) => d.type === 'role').map((d) => d.id);
  const mostRole = Math.max(0, ...roleIds.map((id) => n(c, id)));
  add('Upskill', n(c, 'upskill') * (effectOf(data, 'upskill').points as number) * mostRole);
  if (mostRole > 0) add('Employee of the Month', n(c, 'employee_of_the_month') * (effectOf(data, 'employee_of_the_month').points as number));

  // Step 5: Meta bonuses.
  for (const id of input.activeMeta) {
    const raw = metaPoints(id, effectOf(data, id), input, effective, groups);
    // Only bonuses are scaled [P35]; fractions round down [P32].
    const points = raw > 0 ? Math.floor(raw * data.rules.scoring.metaMultiplier) : raw;
    add(`Meta: ${data.byId.get(id)?.name ?? id}`, points);
  }

  // Step 6: Crisis bonuses and play-time bonuses.
  // Unicorn Hype and Product Launch: points per role type, plus more with no unpaired Bug.
  for (const [id, label] of [['unicorn_hype', 'Unicorn Hype'], ['product_launch', 'Product Launch']] as const) {
    if (crisisCount(id) === 0) continue;
    const eff = effectOf(data, id);
    add(label, groups * (eff.pointsPerRoleType as number) + (leftoverBug === 0 ? (eff.cleanPoints as number) : 0));
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
    case 'per_card_graded': {
      // A base value per card (or per employee), plus more when the condition holds [P40].
      const count = eff.per === 'employee' ? employees(input.data, team) : n(c, eff.per as string);
      const bonusEach = ok ? ((eff.bonusEach as number | undefined) ?? 0) : 0;
      const bonusFlat = ok ? ((eff.bonusFlat as number | undefined) ?? 0) : 0;
      return count * ((eff.points as number) + bonusEach) + bonusFlat;
    }
    case 'employee_bands': {
      const e = employees(input.data, team);
      const band = (eff.bands as Array<{ min: number; max?: number; points: number }>).find((b) => e >= b.min && e <= (b.max ?? Infinity));
      return band?.points ?? 0;
    }
    case 'employee_rank': {
      // Strictly the most employees takes the first value; tied for most, or one player ahead, takes the second.
      const mine = employees(input.data, team);
      const ahead = input.teams.filter((t, i) => i !== input.seat && employees(input.data, t) > mine).length;
      const tied = input.teams.some((t, i) => i !== input.seat && employees(input.data, t) === mine);
      const rank = ahead === 0 && !tied ? 0 : ahead <= 1 ? 1 : -1;
      return rank < 0 ? 0 : (eff.points as number[])[rank]!;
    }
    case 'per_unused_slot':
      // Baseline = turns in this game [P4].
      return (eff.points as number) * Math.max(0, input.totalTurns - team.length);
    case 'flat_if_with_penalty': {
      // The bonus needs the condition and enough role types; the penalty always applies [P39].
      const penalty = eff.penalty as { cardId: string; pointsEach: number };
      const bonus = ok && groups >= (eff.requires as { roleGroups: number }).roleGroups ? (eff.points as number) : 0;
      return bonus + penalty.pointsEach * n(c, penalty.cardId);
    }
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
