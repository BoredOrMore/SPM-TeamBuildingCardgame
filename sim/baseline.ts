// Baseline balance run: plays many bot games and writes one JSON line per game for later analysis.
//   npm run simulate -- --players 4 --matchup mirror --games 10000 --out results/mirror-4p.jsonl
// Balance experiments add --variant file.json: { "rules": {...}, "effects": { "<card id>": {...} } },
// merged over data/ (objects merge key by key, anything else replaces).
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { actingSeat, greedyBot, monteCarloBot, randomBot, type Archetype } from '../src/bots.js';
import { parseGameData } from '../src/data.js';
import { applyActionInPlace, createGame, gameTotals } from '../src/game.js';
import { randomInt } from '../src/rng.js';
import type { Bot, CardsFile, GameData, RulesFile } from '../src/types.js';

/** Seed of game 0; game g uses BASE_SEED + g so runs are reproducible. */
const BASE_SEED = 1;
/** Safety stop for one game; a real game takes far fewer steps. */
const MAX_STEPS = 10_000;
/** Archetypes a seat can draw in the `archetypes` matchup. */
const ARCHETYPES: Archetype[] = ['balanced', 'junior', 'senior', 'designer', 'qa'];

/** Greedy pick options from the command line (archetype bonus and denial weight). */
type GreedyOpts = { favorBonus?: number; denial?: number };

/**
 * Who sits where in game `g`:
 * - mirror: Greedy in every seat (seat, card, comeback, Meta and Crisis metrics)
 * - archetypes: every seat gets a random archetype (strategy win rate)
 * - skill: one Greedy, rotating seats, against Random bots (skill gap)
 * - denial: one denial Greedy, rotating seats, against plain Greedy bots
 * - planning: one Monte Carlo bot, rotating seats, against Greedy bots (does looking ahead pay?)
 */
const MATCHUPS: Record<string, (players: number, g: number, opts: GreedyOpts) => Bot[]> = {
  mirror: (players, g) => seats(players, (i) => greedyBot(g * players + i)),
  archetypes: (players, g, opts) => {
    const holder = { rng: g };
    return seats(players, (i) => greedyBot(g * players + i, ARCHETYPES[randomInt(holder, ARCHETYPES.length)]!, { favorBonus: opts.favorBonus }));
  },
  skill: (players, g) => seats(players, (i) => (i === g % players ? greedyBot(g * players + i) : randomBot(g * players + i))),
  denial: (players, g, opts) => seats(players, (i) => greedyBot(g * players + i, 'balanced', i === g % players ? { denial: opts.denial } : {})),
  planning: (players, g) => seats(players, (i) => (i === g % players ? monteCarloBot(g * players + i) : greedyBot(g * players + i))),
};

/** One bot per seat made by `make`. */
function seats(players: number, make: (seat: number) => Bot): Bot[] {
  return Array.from({ length: players }, (_, i) => make(i));
}

/**
 * Plays game `g` and returns its record: setup, picks, crises (with the game totals just before
 * and just after each one), game totals at the start of every turn of every round [P41], each
 * round's totals and the final scores with lines summed over the rounds.
 */
function playRecorded(data: GameData, bots: Bot[], g: number) {
  const seed = BASE_SEED + g;
  const state = createGame(data, { players: bots.length, seed });
  const totalsByTurn: number[][] = [];
  const totalsBeforeCrisis: number[][] = [];
  let lastTurn = '';
  for (let steps = 0; state.stage !== 'ended'; steps++) {
    if (steps >= MAX_STEPS) throw new Error(`game ${g} did not finish`);
    if (state.stage === 'pick' && lastTurn !== `${state.round}:${state.turn}`) {
      lastTurn = `${state.round}:${state.turn}`;
      totalsByTurn.push(gameTotals(data, state));
    }
    const seat = actingSeat(state);
    const action = bots[seat]!.act(data, state, seat);
    // On a crisis turn, replay the action on a copy whose rules skip this crisis to see the totals just before it.
    const turn = state.turn;
    const copy = data.rules.crisis.afterTurns.includes(turn) ? structuredClone({ ...state, events: [] }) : undefined;
    applyActionInPlace(data, state, action);
    if (copy && state.turn !== turn) {
      applyActionInPlace(withoutCrisisAfter(data, turn), copy, action);
      totalsBeforeCrisis.push(gameTotals(data, copy));
    }
  }
  const picks: string[][] = bots.map(() => []);
  const teams: string[][] = bots.map(() => []);
  const crises: Array<{ round: number; turn: number; id: string; totalsBefore: number[]; totalsAfter?: number[] }> = [];
  // Global turn index of each turn start, to find the totals right after a Crisis.
  let turnIndex = -1;
  for (const e of state.events) {
    if (e.type === 'turn_started') turnIndex += 1;
    if (e.type === 'cards_revealed') {
      for (const r of e.cards as Array<{ player: number; cards: Array<{ id: string }> }>) picks[r.player]!.push(...r.cards.map((c) => c.id));
    }
    if (e.type === 'round_ended') (e.teams as Array<Array<{ id: string }>>).forEach((t, seat) => teams[seat]!.push(...t.map((c) => c.id)));
    if (e.type === 'crisis_drawn') crises.push({ round: e.round, turn: e.turn, id: (e.card as { id: string }).id, totalsBefore: totalsBeforeCrisis[crises.length]!, totalsAfter: undefined });
    if (e.type === 'turn_started') for (const c of crises) c.totalsAfter ??= totalsByTurn[turnIndex];
  }
  const final = state.result!.scores.map((s) => s.total);
  for (const c of crises) c.totalsAfter ??= final;
  // Lines of all rounds summed by label, so Meta and other sources can be compared over the game.
  const lines = state.players.map((p) => {
    const sum = new Map<string, number>();
    for (const r of state.roundScores) for (const l of r[p.seat]!.lines) sum.set(l.label, (sum.get(l.label) ?? 0) + l.points);
    return [...sum.entries()];
  });
  return {
    game: g,
    seed,
    players: bots.length,
    bots: bots.map((b) => b.name),
    firstPlayer: state.firstPlayer,
    activeMeta: state.events.filter((e) => e.type === 'round_started').map((e) => e.activeMeta as string[]),
    ...(data.rules.setup.privateMetaPerPlayer > 0 && { privateMeta: state.players.map((p) => p.privateMeta) }),
    crises,
    picks,
    teams,
    totalsByTurn,
    rounds: state.roundScores.map((r) => r.map((s) => s.total)),
    scores: state.result!.scores.map((s) => ({ total: s.total, lines: lines[s.seat]! })),
    winners: state.result!.winners,
  };
}

/** The same game data with no Crisis drawn after `turn`. */
function withoutCrisisAfter(data: GameData, turn: number): GameData {
  return { ...data, rules: { ...data.rules, crisis: { ...data.rules.crisis, afterTurns: data.rules.crisis.afterTurns.filter((t) => t !== turn) } } };
}

/** `base` with `patch` merged in: plain objects merge key by key, anything else replaces. */
function merge<T>(base: T, patch: unknown): T {
  if (!isObject(base) || !isObject(patch)) return structuredClone(patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = k in out ? merge(out[k], v) : structuredClone(v);
  return out as T;
}

/** True for a plain JSON object (not an array or null). */
function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** cards.json and rules.json with a variant file's `rules` and per-card `effects` merged in. */
function applyVariant(cards: CardsFile, rules: RulesFile, path: string): [CardsFile, RulesFile] {
  const variant = JSON.parse(readFileSync(path, 'utf8')) as { rules?: unknown; effects?: Record<string, unknown> };
  const unknownKeys = Object.keys(variant).filter((k) => k !== 'rules' && k !== 'effects');
  if (unknownKeys.length) throw new Error(`${path}: unknown keys ${unknownKeys.join(', ')}`);
  const patched = structuredClone(cards);
  for (const [id, effect] of Object.entries(variant.effects ?? {})) {
    const def = Object.values(patched.decks).flat().find((c) => c.id === id);
    if (!def?.effect) throw new Error(`${path}: card ${id} has no effect to change`);
    def.effect = merge(def.effect, effect);
  }
  return [patched, merge(rules, variant.rules ?? {})];
}

/** Reads a JSON file from data/ (the build runs from dist/sim/). */
function readData(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../data/${name}`, import.meta.url), 'utf8'));
}

/** Runs the games, writes the JSON lines and prints win share by seat and by bot. */
function main(): void {
  const { values } = parseArgs({
    options: {
      players: { type: 'string' },
      matchup: { type: 'string' },
      games: { type: 'string' },
      out: { type: 'string' },
      variant: { type: 'string' },
      'favor-bonus': { type: 'string' },
      denial: { type: 'string' },
    },
  });
  const optional = (x: string | undefined) => (x === undefined ? undefined : Number(x));
  const opts: GreedyOpts = { favorBonus: optional(values['favor-bonus']), denial: optional(values.denial) };
  if (Object.values(opts).some((x) => x !== undefined && !(x >= 0))) throw new Error('--favor-bonus and --denial must be numbers >= 0');
  const players = Number(values.players);
  const games = Number(values.games);
  const matchup = MATCHUPS[values.matchup ?? ''];
  if (!matchup || !Number.isInteger(games) || games < 1 || !values.out) {
    throw new Error(`usage: --players 3|4 --matchup ${Object.keys(MATCHUPS).join('|')} --games N --out file.jsonl [--variant file.json] [--favor-bonus N] [--denial N]`);
  }
  let files: [CardsFile, RulesFile] = [readData('cards.json') as CardsFile, readData('rules.json') as RulesFile];
  if (values.variant) files = applyVariant(...files, values.variant);
  const data = parseGameData(...files);
  mkdirSync(dirname(values.out), { recursive: true });
  const out = createWriteStream(values.out);
  const bySeat = new Array<number>(players).fill(0);
  const byBot = new Map<string, { share: number; seats: number }>();
  const started = Date.now();
  for (let g = 0; g < games; g++) {
    const record = playRecorded(data, matchup(players, g, opts), g);
    out.write(JSON.stringify(record) + '\n');
    record.bots.forEach((name, seat) => {
      const share = record.winners.includes(seat) ? 1 / record.winners.length : 0;
      bySeat[seat]! += share;
      const b = byBot.get(name) ?? { share: 0, seats: 0 };
      b.share += share;
      b.seats += 1;
      byBot.set(name, b);
    });
  }
  out.end();
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`${values.matchup} ${players}p: ${games} games in ${((Date.now() - started) / 1000).toFixed(0)}s -> ${values.out}`);
  console.log(`  win share by seat: ${bySeat.map((s) => pct(s / games)).join(' ')} (fair ${pct(1 / players)})`);
  for (const [name, b] of byBot) console.log(`  ${name}: ${pct(b.share / b.seats)} over ${b.seats} seats`);
}

main();
