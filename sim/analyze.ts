// Compares a baseline run (sim/baseline.ts output) with the balance thresholds [P21] and flags what falls outside.
//   npm run analyze -- --dir results/baseline --out results/baseline/report.md
// Sections whose run file is missing are skipped. Headline numbers also go to metrics.json next to the report.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { FAVORED, type Archetype } from '../src/bots.js';

// Proposed balance thresholds [P21], in win-share fractions and points.
/** Every seat's win share must stay within 1/N plus or minus this. */
const SEAT_TOLERANCE = 0.03;
/** No archetype may win more than 1/N plus this. */
const STRATEGY_MAX_EDGE = 0.1;
/** A card whose drafted win share differs from 1/N by more than this is flagged. */
const CARD_TOLERANCE = 0.05;
/** The Greedy bot must win at least this share against Random bots. */
const SKILL_MIN = 0.6;
/** A game is close when first and second place are at most this many points apart. */
const CLOSE_POINTS = 5;
/** At least this share of games must be close. */
const CLOSE_MIN = 0.4;
/** Comebacks are measured from the totals after this turn. */
const COMEBACK_AFTER_TURN = 6;
/** Allowed share of games won by a player who was not leading after COMEBACK_AFTER_TURN. */
const COMEBACK_RANGE: [number, number] = [0.1, 0.25];
/** Allowed share of all points that come from Meta cards. */
const META_RANGE: [number, number] = [0.1, 0.3];
/** No Crisis card may change the leader in more than this share of the games it appears in. */
const CRISIS_MAX_SWING = 0.3;
/** Cards drafted in fewer games than this are reported but not flagged (too few to judge). */
const MIN_SAMPLE = 200;
/** Winning-team diversity reports how many plans cover this share of wins. */
const PLAN_COVER = 0.9;

interface GameRecord {
  players: number;
  bots: string[];
  firstPlayer: number;
  activeMeta: string[];
  crises: Array<{ turn: number; id: string; totalsBefore: number[] }>;
  picks: string[][];
  teams: string[][];
  totalsByTurn: number[][];
  scores: Array<{ total: number; lines: Array<[string, number]> }>;
  winners: number[];
}

/** Every game of one run file, or null when the run was not made. */
function load(dir: string, name: string): GameRecord[] | null {
  const path = join(dir, `${name}.jsonl`);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as GameRecord);
}

/** Share of the win that `seat` gets (ties split it). */
function share(game: GameRecord, seat: number): number {
  return game.winners.includes(seat) ? 1 / game.winners.length : 0;
}

/** Seats holding the highest total. */
function leaders(totals: number[]): number[] {
  const top = Math.max(...totals);
  return totals.flatMap((t, seat) => (t === top ? [seat] : []));
}

/** Half-width of the 95% confidence interval of a share measured over `n` trials. */
function ci95(p: number, n: number): number {
  return 1.96 * Math.sqrt((p * (1 - p)) / n);
}

/** Percentage with one decimal. */
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
/** Signed percentage points with one decimal. */
const pp = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`;
/** Markdown table from a header row and body rows. */
const table = (head: string[], rows: string[][]) =>
  [head, head.map(() => '---'), ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n');

/**
 * Gini coefficient of how often each class occurs: 0 when all are equally common,
 * near 1 when one dominates (used for hero pick spread in Dota 2 balance reviews).
 */
function gini(counts: number[]): number {
  const sorted = [...counts].sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  if (sorted.length < 2 || total === 0) return 0;
  const weighted = sorted.reduce((sum, c, i) => sum + (i + 1) * c, 0);
  return (2 * weighted) / (sorted.length * total) - (sorted.length + 1) / sorted.length;
}

/** Win share of the bot named `name` over every seat it held. */
function botShare(games: GameRecord[], name: string): number {
  let won = 0;
  let seats = 0;
  for (const g of games) g.bots.forEach((n, seat) => n === name && ((won += share(g, seat)), (seats += 1)));
  return won / seats;
}

/**
 * The report section for one player count; `flags` collects every value outside its threshold
 * and `metrics` the headline numbers.
 */
function analyze(dir: string, players: number, flags: string[], metrics: Record<string, unknown>): string {
  const fair = 1 / players;
  const tag = `${players}p`;
  const mirror = load(dir, `mirror-${tag}`);
  if (!mirror) throw new Error(`${dir} has no mirror-${tag}.jsonl`);
  const out: string[] = [`## ${players} players (fair win share ${pct(fair)})`];

  // Seat win rate, by position after the first player.
  const bySeat = new Array<number>(players).fill(0);
  for (const g of mirror) g.winners.forEach((w) => (bySeat[(w - g.firstPlayer + players) % players]! += 1 / g.winners.length));
  const seatRows = bySeat.map((s, i) => {
    const rate = s / mirror.length;
    const ok = Math.abs(rate - fair) <= SEAT_TOLERANCE;
    if (!ok) flags.push(`${tag} seat ${i + 1} wins ${pct(rate)}`);
    return [`${i + 1}${i === 0 ? ' (first)' : ''}`, pct(rate), pp(rate - fair), ok ? 'ok' : 'FLAG'];
  });
  metrics.seatMaxGap = Math.max(...bySeat.map((s) => Math.abs(s / mirror.length - fair)));
  out.push(`### Seat win rate (mirror, ±${pct(SEAT_TOLERANCE)})`, table(['Position', 'Win share', 'vs fair', ''], seatRows));

  // Strategy win rate.
  const arch = load(dir, `archetypes-${tag}`);
  if (arch) {
    const strategies: Record<string, { win: number; favored: number | null }> = (metrics.strategies = {});
    const byBot = new Map<string, { share: number; seats: number }>();
    for (const g of arch) {
      g.bots.forEach((name, seat) => {
        const b = byBot.get(name) ?? { share: 0, seats: 0 };
        b.share += share(g, seat);
        b.seats += 1;
        byBot.set(name, b);
      });
    }
    const stratRows = [...byBot.entries()].sort().map(([name, b]) => {
      const rate = b.share / b.seats;
      const ok = rate <= fair + STRATEGY_MAX_EDGE;
      if (!ok) flags.push(`${tag} strategy ${name} wins ${pct(rate)}`);
      // Share of the favoured cards in this bot's final teams compared with plain Greedy teams.
      const ids = FAVORED[(name === 'greedy' ? 'balanced' : name.replace('greedy_', '')) as Archetype];
      const favoredShare = (bot: string) => {
        let hit = 0;
        let all = 0;
        for (const g of arch) g.bots.forEach((n, seat) => n === bot && ((all += g.teams[seat]!.length), (hit += g.teams[seat]!.filter((c) => ids.includes(c)).length)));
        return all ? hit / all : 0;
      };
      const own = ids.length ? `${pct(favoredShare(name))} (Greedy ${pct(favoredShare('greedy'))})` : '-';
      strategies[name] = { win: rate, favored: ids.length ? favoredShare(name) : null };
      return [name, pct(rate), pp(rate - fair), own, ok ? 'ok' : 'FLAG'];
    });
    out.push(
      `### Strategy win rate (archetypes, at most ${pct(fair + STRATEGY_MAX_EDGE)})`,
      table(['Bot', 'Win share', 'vs fair', 'Favoured cards in final team', ''], stratRows),
    );
  }

  // Skill gap.
  const skill = load(dir, `skill-${tag}`);
  if (skill) {
    const greedySeat = (g: GameRecord) => g.bots.indexOf('greedy');
    const skillRate = skill.reduce((sum, g) => sum + share(g, greedySeat(g)), 0) / skill.length;
    metrics.skill = skillRate;
    if (skillRate < SKILL_MIN) flags.push(`${tag} Greedy beats Random only ${pct(skillRate)}`);
    out.push(`### Skill gap (Greedy vs ${players - 1} Random, at least ${pct(SKILL_MIN)})`, `Greedy win share ${pct(skillRate)}: ${skillRate >= SKILL_MIN ? 'ok' : 'FLAG'}`);
  }

  // Card win rate when drafted.
  const cardStats = new Map<string, { share: number; seats: number }>();
  for (const g of mirror) {
    g.picks.forEach((picked, seat) => {
      for (const id of new Set(picked)) {
        const c = cardStats.get(id) ?? { share: 0, seats: 0 };
        c.share += share(g, seat);
        c.seats += 1;
        cardStats.set(id, c);
      }
    });
  }
  const seatsTotal = mirror.length * players;
  const cardGaps: Record<string, number> = (metrics.cardGap = {});
  const cardRows = [...cardStats.entries()]
    .map(([id, c]) => ({ id, rate: c.share / c.seats, seats: c.seats }))
    .sort((a, b) => b.rate - a.rate)
    .map(({ id, rate, seats }) => {
      const off = Math.abs(rate - fair) > CARD_TOLERANCE;
      const judged = seats >= MIN_SAMPLE;
      if (judged) cardGaps[id] = rate - fair;
      if (off && judged) flags.push(`${tag} card ${id} drafted win share ${pct(rate)} (${pp(rate - fair)})`);
      return [id, pct(seats / seatsTotal), pct(rate), pp(rate - fair), `±${pct(ci95(rate, seats))}`, !judged ? 'too few' : off ? 'FLAG' : 'ok'];
    });
  out.push(
    `### Card win rate when drafted (mirror, ±${pct(CARD_TOLERANCE)} from fair)`,
    'A seat counts once per card id it picked at least once.',
    table(['Card', 'Seats that drafted it', 'Win share', 'vs fair', '95% CI', ''], cardRows),
  );

  // Close games, comebacks, Meta share.
  const close = mirror.filter((g) => {
    const t = g.scores.map((s) => s.total).sort((a, b) => b - a);
    return t[0]! - t[1]! <= CLOSE_POINTS;
  }).length / mirror.length;
  // Two Deadline Crunches can end a game before turn 7; then the final totals stand in.
  const afterTurn = (g: GameRecord) => g.totalsByTurn[COMEBACK_AFTER_TURN] ?? g.scores.map((s) => s.total);
  const comeback = mirror.filter((g) => !leaders(afterTurn(g)).some((s) => g.winners.includes(s))).length / mirror.length;
  let metaPoints = 0;
  let allPoints = 0;
  for (const g of mirror) {
    for (const s of g.scores) {
      allPoints += s.total;
      for (const [label, points] of s.lines) if (label.startsWith('Meta: ')) metaPoints += points;
    }
  }
  const metaShare = metaPoints / allPoints;
  const inRange = (x: number, [lo, hi]: [number, number]) => x >= lo && x <= hi;
  Object.assign(metrics, { close, comeback, metaShare });
  if (close < CLOSE_MIN) flags.push(`${tag} close games ${pct(close)}`);
  if (!inRange(comeback, COMEBACK_RANGE)) flags.push(`${tag} comeback rate ${pct(comeback)}`);
  if (!inRange(metaShare, META_RANGE)) flags.push(`${tag} Meta share of points ${pct(metaShare)}`);
  out.push(
    '### Game shape (mirror)',
    table(
      ['Metric', 'Value', 'Threshold', ''],
      [
        [`Close games (top two within ${CLOSE_POINTS} points)`, pct(close), `at least ${pct(CLOSE_MIN)}`, close >= CLOSE_MIN ? 'ok' : 'FLAG'],
        [`Comeback (winner not leading after turn ${COMEBACK_AFTER_TURN})`, pct(comeback), `${pct(COMEBACK_RANGE[0])}-${pct(COMEBACK_RANGE[1])}`, inRange(comeback, COMEBACK_RANGE) ? 'ok' : 'FLAG'],
        ['Meta share of all points', pct(metaShare), `${pct(META_RANGE[0])}-${pct(META_RANGE[1])}`, inRange(metaShare, META_RANGE) ? 'ok' : 'FLAG'],
      ],
    ),
  );

  // Crisis swing: the leader just before a Crisis compared with the leader when the next turn starts.
  const crisisStats = new Map<string, { seen: number; swings: number }>();
  for (const g of mirror) {
    for (const c of g.crises) {
      const before = leaders(c.totalsBefore).join();
      // A Crisis drawn after the last turn is followed by final scoring instead of a new turn.
      const after = leaders(g.totalsByTurn[c.turn - 1] ?? g.scores.map((s) => s.total)).join();
      const s = crisisStats.get(c.id) ?? { seen: 0, swings: 0 };
      s.seen += 1;
      if (before !== after) s.swings += 1;
      crisisStats.set(c.id, s);
    }
  }
  const crisisSwing: Record<string, number> = (metrics.crisisSwing = {});
  const crisisRows = [...crisisStats.entries()]
    .map(([id, s]) => ({ id, rate: s.swings / s.seen, seen: s.seen }))
    .sort((a, b) => b.rate - a.rate)
    .map(({ id, rate, seen }) => {
      crisisSwing[id] = rate;
      const ok = rate <= CRISIS_MAX_SWING;
      if (!ok && seen >= MIN_SAMPLE) flags.push(`${tag} crisis ${id} changes the leader in ${pct(rate)} of draws`);
      return [id, String(seen), pct(rate), seen < MIN_SAMPLE ? 'too few' : ok ? 'ok' : 'FLAG'];
    });
  out.push(
    `### Crisis swing (mirror, leader changed in at most ${pct(CRISIS_MAX_SWING)} of draws)`,
    'Leader just before the Crisis compared with the leader when the next turn starts.',
    table(['Crisis', 'Draws', 'Leader changed', ''], crisisRows),
  );

  // Winning-team diversity: which scoring line earned each winner the most points.
  const plans = new Map<string, number>();
  for (const g of mirror) {
    for (const w of g.winners) {
      const top = [...g.scores[w]!.lines].sort((a, b) => b[1] - a[1])[0];
      const plan = (top?.[0] ?? 'none').replace(/ \(.*\)$/, '').replace(/^Meta: .*/, 'Meta card');
      plans.set(plan, (plans.get(plan) ?? 0) + 1 / g.winners.length);
    }
  }
  const planRows = [...plans.entries()].sort((a, b) => b[1] - a[1]);
  let covered = 0;
  const cover = planRows.findIndex(([, n]) => (covered += n) >= PLAN_COVER * mirror.length) + 1;
  metrics.diversity = { gini: gini(planRows.map(([, n]) => n)), plansFor90: cover, topPlan: planRows[0]![0], topShare: planRows[0]![1] / mirror.length };
  out.push(
    '### Winning-team diversity (mirror, report only)',
    `The scoring line that gave each winner the most points. Gini ${gini(planRows.map(([, n]) => n)).toFixed(2)} (0 = every plan wins equally often); ${cover} plans cover ${pct(PLAN_COVER)} of wins.`,
    table(['Biggest line of the winner', 'Share of wins'], planRows.map(([plan, n]) => [plan, pct(n / mirror.length)])),
  );

  // Optional runs: a denial drafter and a planning (Monte Carlo) bot against plain Greedy bots.
  const denial = load(dir, `denial-${tag}`);
  if (denial) {
    const name = denial[0]!.bots.find((b) => b.endsWith('_denial'))!;
    metrics.denial = botShare(denial, name);
    out.push(`### Denial drafting (1 ${name} vs ${players - 1} Greedy, report only)`, `Win share ${pct(botShare(denial, name))} over ${denial.length} games (fair ${pct(fair)}).`);
  }
  const planning = load(dir, `planning-${tag}`);
  if (planning) {
    const rate = botShare(planning, 'monte_carlo');
    metrics.planning = rate;
    metrics.planningCi = ci95(rate, planning.length);
    out.push(`### Planning pays (1 Monte Carlo vs ${players - 1} Greedy, report only)`, `Win share ${pct(rate)} ±${pct(ci95(rate, planning.length))} over ${planning.length} games (fair ${pct(fair)}).`);
  }
  return out.join('\n\n');
}

/** Writes the Markdown report and prints the flags. */
function main(): void {
  const { values } = parseArgs({ options: { dir: { type: 'string' }, out: { type: 'string' } } });
  if (!values.dir || !values.out) throw new Error('usage: --dir results/baseline --out report.md');
  const flags: string[] = [];
  const metrics: Record<string, Record<string, unknown>> = { '3p': {}, '4p': {} };
  const sections = [3, 4].map((players) => analyze(values.dir!, players, flags, metrics[`${players}p`]!));
  const report = ['# Baseline balance report', '## Flags', flags.length ? flags.map((f) => `- ${f}`).join('\n') : 'None.', ...sections].join('\n\n');
  writeFileSync(values.out, report + '\n');
  writeFileSync(join(dirname(values.out), 'metrics.json'), JSON.stringify({ flags, ...metrics }, null, 2) + '\n');
  console.log(`${flags.length} flags -> ${values.out}`);
  for (const f of flags) console.log(`  ${f}`);
}

main();
