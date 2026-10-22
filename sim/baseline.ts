// Baseline balance run: plays many bot games and writes one JSON line per game for later analysis.
//   npm run simulate -- --players 4 --matchup mirror --games 10000 --out results/mirror-4p.jsonl
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { actingSeat, greedyBot, randomBot, type Archetype } from '../src/bots.js';
import { parseGameData } from '../src/data.js';
import { applyActionInPlace, createGame, currentScores } from '../src/game.js';
import { randomInt } from '../src/rng.js';
import type { Bot, CardsFile, GameData, RulesFile } from '../src/types.js';

/** Seed of game 0; game g uses BASE_SEED + g so runs are reproducible. */
const BASE_SEED = 1;
/** Safety stop for one game; a real game takes far fewer steps. */
const MAX_STEPS = 10_000;
/** Archetypes a seat can draw in the `archetypes` matchup. */
const ARCHETYPES: Archetype[] = ['balanced', 'junior', 'senior', 'designer', 'qa'];

/**
 * Who sits where in game `g`:
 * - mirror: Greedy in every seat (seat, card, comeback, Meta and Crisis metrics)
 * - archetypes: every seat gets a random archetype (strategy win rate)
 * - skill: one Greedy, rotating seats, against Random bots (skill gap)
 */
const MATCHUPS: Record<string, (players: number, g: number) => Bot[]> = {
  mirror: (players, g) => seats(players, (i) => greedyBot(g * players + i)),
  archetypes: (players, g) => {
    const holder = { rng: g };
    return seats(players, (i) => greedyBot(g * players + i, ARCHETYPES[randomInt(holder, ARCHETYPES.length)]!));
  },
  skill: (players, g) => seats(players, (i) => (i === g % players ? greedyBot(g * players + i) : randomBot(g * players + i))),
};

/** One bot per seat made by `make`. */
function seats(players: number, make: (seat: number) => Bot): Bot[] {
  return Array.from({ length: players }, (_, i) => make(i));
}

/** Plays game `g` and returns its record: setup, picks, crises, totals at the start of each turn and the final scores. */
function playRecorded(data: GameData, bots: Bot[], g: number) {
  const seed = BASE_SEED + g;
  const state = createGame(data, { players: bots.length, seed });
  const totalsByTurn: number[][] = [];
  for (let steps = 0; state.stage !== 'ended'; steps++) {
    if (steps >= MAX_STEPS) throw new Error(`game ${g} did not finish`);
    if (state.stage === 'pick' && totalsByTurn.length < state.turn) totalsByTurn.push(currentScores(data, state).map((s) => s.total));
    const seat = actingSeat(state);
    applyActionInPlace(data, state, bots[seat]!.act(data, state, seat));
  }
  const picks: string[][] = bots.map(() => []);
  const crises: Array<{ turn: number; id: string }> = [];
  for (const e of state.events) {
    if (e.type === 'cards_revealed') {
      for (const r of e.cards as Array<{ player: number; cards: Array<{ id: string }> }>) picks[r.player]!.push(...r.cards.map((c) => c.id));
    }
    if (e.type === 'crisis_drawn') crises.push({ turn: e.turn, id: (e.card as { id: string }).id });
  }
  return {
    game: g,
    seed,
    players: bots.length,
    bots: bots.map((b) => b.name),
    firstPlayer: state.firstPlayer,
    activeMeta: state.activeMeta,
    crises,
    picks,
    teams: state.players.map((p) => p.team.map((c) => c.id)),
    totalsByTurn,
    scores: state.result!.scores.map((s) => ({ total: s.total, lines: s.lines.map((l) => [l.label, l.points]) })),
    winners: state.result!.winners,
  };
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
    },
  });
  const players = Number(values.players);
  const games = Number(values.games);
  const matchup = MATCHUPS[values.matchup ?? ''];
  if (!matchup || !Number.isInteger(games) || games < 1 || !values.out) {
    throw new Error(`usage: --players 3|4 --matchup ${Object.keys(MATCHUPS).join('|')} --games N --out file.jsonl`);
  }
  const data = parseGameData(readData('cards.json') as CardsFile, readData('rules.json') as RulesFile);
  mkdirSync(dirname(values.out), { recursive: true });
  const out = createWriteStream(values.out);
  const bySeat = new Array<number>(players).fill(0);
  const byBot = new Map<string, { share: number; seats: number }>();
  const started = Date.now();
  for (let g = 0; g < games; g++) {
    const record = playRecorded(data, matchup(players, g), g);
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
