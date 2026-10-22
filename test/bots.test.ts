import { describe, expect, it } from 'vitest';
import { determinize, greedyBot, monteCarloBot, randomBot, runGame } from '../src/bots.js';
import { createGame } from '../src/game.js';
import type { Bot, GameState } from '../src/types.js';
import { data } from './helpers.js';

/** Win share of `make(seed)` against `other(seed)` bots, rotating its seat every game. */
function winShare(make: (seed: number) => Bot, other: (seed: number) => Bot, players: number, games: number): number {
  let wins = 0;
  for (let g = 0; g < games; g++) {
    const seat = g % players;
    const bots = Array.from({ length: players }, (_, i) => (i === seat ? make : other)(g * 7 + i));
    const { winners } = runGame(data, { seed: 5000 + g, bots }).result!;
    if (winners.includes(seat)) wins += 1 / winners.length;
  }
  return wins / games;
}

/** Sorted ids of a card list, to compare contents regardless of order. */
const ids = (cards: { id: string }[]) => cards.map((c) => c.id).sort();

describe('runGame', () => {
  it.each([3, 4])('finishes %i-player games with every bot level', (players) => {
    const makers = [randomBot, (s: number) => greedyBot(s), (s: number) => greedyBot(s, 'designer'), monteCarloBot];
    const state = runGame(data, { seed: 11, bots: Array.from({ length: players }, (_, i) => makers[i]!(i)) });
    expect(state.stage).toBe('ended');
    expect(state.players.every((p) => p.hand.length === 0)).toBe(true);
  });

  it('is reproducible from the seeds', () => {
    const play = () => runGame(data, { seed: 3, bots: [greedyBot(1), randomBot(2), greedyBot(3, 'qa')] }).result;
    expect(play()).toEqual(play());
  });
});

describe('determinize', () => {
  it('re-deals only what the seat cannot see', () => {
    const state: GameState = createGame(data, { players: 4, seed: 9 });
    const sim = determinize(data, state, 1, { rng: 42 });
    expect(sim.players[1]!.hand).toEqual(state.players[1]!.hand);
    const hidden = (s: GameState) => ids([...s.players.filter((p) => p.seat !== 1).flatMap((p) => p.hand), ...s.mainRemaining]);
    expect(hidden(sim)).toEqual(hidden(state));
    expect(sim.players.map((p) => p.hand.length)).toEqual(state.players.map((p) => p.hand.length));
    expect(ids(sim.crisisDeck)).toEqual(ids(state.crisisDeck));
    expect(sim.players[0]!.hand).not.toEqual(state.players[0]!.hand);
    expect(sim.activeMeta).toEqual(state.activeMeta);
  });
});

describe('bot strength', () => {
  it('Greedy beats Random', () => {
    expect(winShare((s) => greedyBot(s), randomBot, 4, 200)).toBeGreaterThan(0.5);
  });
});
