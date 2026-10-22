import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseGameData } from '../src/data.js';
import { applyAction, createGame, currentDecision } from '../src/game.js';
import { nextRandom } from '../src/rng.js';
import { scorePlayer } from '../src/scoring.js';
import type { CardInstance, CardsFile, GameData, GameState, RulesFile } from '../src/types.js';

/** Parsed JSON file from data/. */
const read = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../data/${name}`, import.meta.url)), 'utf8'));

export const data: GameData = parseGameData(read('cards.json') as CardsFile, read('rules.json') as RulesFile);
export const placeholders = read('placeholders.json') as { items: Array<{ id: string }> };

/** Team with the given number of each card id. */
export function team(spec: Record<string, number>): CardInstance[] {
  const out: CardInstance[] = [];
  for (const [id, count] of Object.entries(spec)) {
    for (let i = 0; i < count; i++) out.push({ uid: `${id}-${i}`, id });
  }
  return out;
}

/** Score of seat 0 with the given team, Meta cards, crisis cards and opponents. */
export function score(
  spec: Record<string, number>,
  opts: { meta?: string[]; crisis?: string[]; others?: Record<string, number>[]; turns?: number } = {},
) {
  const teams = [team(spec), ...(opts.others ?? []).map(team)];
  return scorePlayer({
    data,
    teams,
    seat: 0,
    activeMeta: opts.meta ?? [],
    visibleCrisis: (opts.crisis ?? []).map((id, i) => ({ uid: `c${i}`, id })),
    bonuses: [],
    totalTurns: opts.turns ?? 10,
  });
}

/** Plays a whole game with uniformly random legal moves. */
export function playRandomGame(players: number, seed: number): GameState {
  let state = createGame(data, { players, seed });
  const policy = { rng: seed ^ 0x9e3779b9 };
  for (let steps = 0; steps < 10_000; steps++) {
    if (state.stage === 'ended') return state;
    const decision = currentDecision(state);
    if (decision) {
      const option = Math.floor(nextRandom(policy) * decision.options!.length);
      state = applyAction(data, state, { type: 'choose', player: decision.player, decisionId: decision.id, option }).state;
      continue;
    }
    const p = state.players.find((x) => !x.picked)!;
    const need = Math.min(state.picksRequired, p.hand.length);
    const hand = p.hand.slice();
    const cards: string[] = [];
    while (cards.length < need) cards.push(hand.splice(Math.floor(nextRandom(policy) * hand.length), 1)[0]!.uid);
    state = applyAction(data, state, { type: 'pick', player: p.seat, cards }).state;
  }
  throw new Error('game did not finish');
}
