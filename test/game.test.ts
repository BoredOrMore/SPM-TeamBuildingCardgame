import { describe, expect, it } from 'vitest';
import { deckSize } from '../src/data.js';
import { applyAction, createGame, IllegalAction } from '../src/game.js';
import type { GameState } from '../src/types.js';
import { data, playRandomGame } from './helpers.js';

function mainCardsInPlay(state: GameState): string[] {
  return [
    ...state.players.flatMap((p) => [...p.hand, ...p.team, ...p.revealed]),
    ...state.discard,
    ...state.mainRemaining,
  ].map((c) => c.uid);
}

describe('setup', () => {
  it('deals 10 cards to 3 players and 8 to 4 players, with 3 Meta cards', () => {
    expect(createGame(data, { players: 3, seed: 1 }).players.map((p) => p.hand.length)).toEqual([10, 10, 10]);
    const four = createGame(data, { players: 4, seed: 1 });
    expect(four.players.map((p) => p.hand.length)).toEqual([8, 8, 8, 8]);
    expect(four.activeMeta).toHaveLength(3);
  });

  it('rejects unsupported player counts', () => {
    expect(() => createGame(data, { players: 2, seed: 1 })).toThrow(IllegalAction);
  });
});

describe('turn flow', () => {
  it('reveals only after everyone picked, then passes hands left on turn 1', () => {
    let s = createGame(data, { players: 3, seed: 7 });
    const handsBefore = s.players.map((p) => p.hand.map((c) => c.uid));
    for (const p of s.players.slice(0, 2)) s = applyAction(data, s, { type: 'pick', player: p.seat, cards: [p.hand[0]!.uid] }).state;
    expect(s.stage).toBe('pick');
    const last = s.players[2]!;
    const { state, events } = applyAction(data, s, { type: 'pick', player: 2, cards: [last.hand[0]!.uid] });
    expect(events.some((e) => e.type === 'cards_revealed')).toBe(true);
    if (state.stage === 'pick') {
      // Seat 1 now holds what is left of seat 0's hand.
      expect(state.players[1]!.hand.map((c) => c.uid)).toEqual(handsBefore[0]!.slice(1));
    }
  });

  it('rejects picking a card that is not in hand and picking twice', () => {
    let s = createGame(data, { players: 3, seed: 3 });
    expect(() => applyAction(data, s, { type: 'pick', player: 0, cards: ['nope'] })).toThrow(IllegalAction);
    s = applyAction(data, s, { type: 'pick', player: 0, cards: [s.players[0]!.hand[0]!.uid] }).state;
    expect(() => applyAction(data, s, { type: 'pick', player: 0, cards: [s.players[0]!.hand[0]!.uid] })).toThrow(IllegalAction);
  });

  it('does not mutate the previous state', () => {
    const s = createGame(data, { players: 3, seed: 5 });
    const snapshot = JSON.stringify(s);
    applyAction(data, s, { type: 'pick', player: 0, cards: [s.players[0]!.hand[0]!.uid] });
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe('full games with random moves', () => {
  for (const players of [3, 4]) {
    it(`${players} players: 200 games finish, draw 3 crises and conserve every main card`, () => {
      for (let seed = 1; seed <= 200; seed++) {
        const end = playRandomGame(players, seed);
        expect(end.stage).toBe('ended');
        expect(end.events.filter((e) => e.type === 'crisis_drawn')).toHaveLength(3);
        const uids = mainCardsInPlay(end);
        expect(uids).toHaveLength(deckSize(data, 'main'));
        expect(new Set(uids).size).toBe(uids.length);
        expect(end.result!.winners.length).toBeGreaterThan(0);
        expect(end.players.every((p) => p.hand.length === 0)).toBe(true);
      }
    });
  }

  it('is reproducible from the seed', () => {
    expect(JSON.stringify(playRandomGame(3, 42).result)).toBe(JSON.stringify(playRandomGame(3, 42).result));
  });
});
