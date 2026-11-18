import { describe, expect, it } from 'vitest';
import { deckSize } from '../src/data.js';
import { applyAction, createGame, currentDecision, IllegalAction } from '../src/game.js';
import type { Choice, GameState } from '../src/types.js';
import { data, playRandomGame } from './helpers.js';

function mainCardsInPlay(state: GameState): string[] {
  return [
    ...state.players.flatMap((p) => [...p.hand, ...p.team, ...p.revealed]),
    ...state.discard,
    ...state.mainRemaining,
  ].map((c) => c.uid);
}

describe('setup', () => {
  it('deals 7 cards to 3 and 4 players, with 1 Meta card in the first round [P42]', () => {
    expect(createGame(data, { players: 3, seed: 1 }).players.map((p) => p.hand.length)).toEqual([7, 7, 7]);
    const four = createGame(data, { players: 4, seed: 1 });
    expect(four.players.map((p) => p.hand.length)).toEqual([7, 7, 7, 7]);
    expect(four.activeMeta).toHaveLength(1);
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
    it(`${players} players: 200 games finish, draw each round's crises and conserve every main card`, () => {
      for (let seed = 1; seed <= 200; seed++) {
        const end = playRandomGame(players, seed);
        expect(end.stage).toBe('ended');
        expect(end.roundScores).toHaveLength(data.rules.rounds.count);
        // Every round draws a Crisis after each listed turn it reaches; Deadline Crunch can end a round early [P12].
        for (let round = 1; round <= data.rules.rounds.count; round++) {
          const events = end.events.filter((e) => e.round === round);
          // Events after a turn's picks carry the next turn number.
          const lastTurn = Math.max(...events.map((e) => e.turn)) - 1;
          const expected = data.rules.crisis.afterTurns.filter((t) => t <= lastTurn).length;
          expect(events.filter((e) => e.type === 'crisis_drawn')).toHaveLength(expected);
          expect(expected).toBeGreaterThanOrEqual(2);
        }
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

describe('Phone Screen', () => {
  /** A 3-player game on turn 1 where seat 0 played Phone Screen and has just looked at seat 1's hand. */
  function peeked(): GameState {
    let s = createGame(data, { players: 3, seed: 7 });
    s.players[0]!.hand[0]!.id = 'phone_screen';
    for (const p of s.players.slice(1)) p.hand[0]!.id = 'coffee';
    for (const p of s.players) s = applyAction(data, s, { type: 'pick', player: p.seat, cards: [p.hand[0]!.uid] }).state;
    const look = currentDecision(s)!;
    expect(look.kind).toBe('phone_screen');
    const option = look.options!.findIndex((o) => o.kind === 'phone_screen' && o.opponent === 1);
    return applyAction(data, s, { type: 'choose', player: 0, decisionId: look.id, option }).state;
  }

  it('discards the chosen card from the peeked hand, refills it from the deck, and tells who receives that hand', () => {
    const s = peeked();
    const d = currentDecision(s)!;
    expect(d.kind).toBe('phone_screen_discard');
    expect(d.context).toEqual({ target: 1, receiver: 2 });
    const option = d.options!.findIndex((o) => o.kind === 'hand_discard');
    const target = d.options![option] as Extract<Choice, { kind: 'hand_discard' }>;
    const top = s.mainRemaining[0]!;
    const { state, events } = applyAction(data, s, { type: 'choose', player: 0, decisionId: d.id, option });
    expect(state.discard.map((c) => c.uid)).toContain(target.uid);
    expect(events.find((e) => e.type === 'hand_card_discarded')!.visibleTo).toEqual([0, 1]);
    // hands have been passed on: seat 2 now holds seat 1's old hand, still 6 cards
    const received = state.players[2]!.hand.map((c) => c.uid);
    expect(received).toHaveLength(6);
    expect(received).not.toContain(target.uid);
    expect(received).toContain(top.uid);
  });

  it('gives +2 when the player takes the points instead', () => {
    const s = peeked();
    const d = currentDecision(s)!;
    const option = d.options!.findIndex((o) => o.kind === 'phone_screen_points');
    const { state } = applyAction(data, s, { type: 'choose', player: 0, decisionId: d.id, option });
    expect(state.players[0]!.bonuses).toEqual([{ source: 'Phone Screen', points: 2 }]);
  });
});
