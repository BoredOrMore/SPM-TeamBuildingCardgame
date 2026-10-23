import { describe, expect, it } from 'vitest';
import { parseGameData } from '../src/data.js';
import { applyActionInPlace, createGame, currentDecision } from '../src/game.js';
import type { CardsFile, GameState, RulesFile } from '../src/types.js';
import { data } from './helpers.js';

/** Game data with a Crisis drawn after turn 1, so one round of picks reveals it. */
const crisisAfterTurn1 = parseGameData(structuredClone(data.cards) as CardsFile, {
  ...(structuredClone(data.rules) as RulesFile),
  crisis: { ...structuredClone(data.rules.crisis), afterTurns: [1] },
});

/** Plays turn 1 with everyone picking a Coffee, with `crisisId` on top of the Crisis deck and the given teams. */
function revealCrisis(crisisId: string, teams: string[][], setup: (s: GameState) => void = () => {}): GameState {
  const state = createGame(crisisAfterTurn1, { players: 3, seed: 3 });
  const i = state.crisisDeck.findIndex((c) => c.id === crisisId);
  state.crisisDeck.unshift(...state.crisisDeck.splice(i, 1));
  state.players.forEach((p, seat) => {
    p.team = (teams[seat] ?? []).map((id, k) => ({ uid: `t${seat}-${k}`, id }));
    p.hand[0] = { uid: `h${seat}`, id: 'coffee' };
  });
  setup(state);
  for (const p of state.players) applyActionInPlace(crisisAfterTurn1, state, { type: 'pick', player: p.seat, cards: [`h${p.seat}`] });
  return state;
}

/** Ids in one player's team, sorted. */
const ids = (state: GameState, seat: number) => state.players[seat]!.team.map((c) => c.id).sort();

describe('every card has an effect when it comes into play', () => {
  it('Layoff makes a player with no Junior discard a role card instead', () => {
    const state = revealCrisis('layoff', [['junior_dev', 'designer'], ['senior_dev'], ['designer', 'bug']]);
    for (let d = currentDecision(state); d; d = currentDecision(state)) {
      applyActionInPlace(crisisAfterTurn1, state, { type: 'choose', player: d.player, decisionId: d.id, option: 0 });
    }
    expect([ids(state, 0), ids(state, 1), ids(state, 2)]).toEqual([['coffee', 'designer'], ['coffee'], ['bug', 'coffee']]);
  });

  it('Poaching lets the player with the most role cards take a card, Senior or not', () => {
    const state = revealCrisis('poaching', [['designer', 'qa_tester'], ['coffee'], ['bug']]);
    const d = currentDecision(state)!;
    expect([d.kind, d.player]).toEqual(['poaching', 0]);
  });

  it('Funding Round takes from the main deck when the discard pile is empty', () => {
    const state = revealCrisis('funding_round', [[], [], []], (s) => (s.discard = []));
    for (let d = currentDecision(state); d; d = currentDecision(state)) {
      applyActionInPlace(crisisAfterTurn1, state, { type: 'choose', player: d.player, decisionId: d.id, option: 0 });
    }
    expect(state.players.map((p) => p.team.length)).toEqual([2, 2, 2]);
  });

  it('Merger Offer with no deal gives the drawing player +2', () => {
    const state = revealCrisis('merger_offer', [['designer'], ['qa_tester'], ['bug']]);
    const d = currentDecision(state)!;
    expect(d.kind).toBe('merger_propose');
    const decline = d.options!.findIndex((o) => o.kind === 'merger_decline');
    applyActionInPlace(crisisAfterTurn1, state, { type: 'choose', player: d.player, decisionId: d.id, option: decline });
    expect(state.players[d.player]!.bonuses).toEqual([{ source: 'Merger Offer', points: 2 }]);
  });

  it('Refactor with nothing to convert gives +1', () => {
    const state = createGame(data, { players: 3, seed: 3 });
    state.players.forEach((p, seat) => (p.hand[0] = { uid: `h${seat}`, id: seat === 0 ? 'refactor' : 'coffee' }));
    for (const p of state.players) applyActionInPlace(data, state, { type: 'pick', player: p.seat, cards: [`h${p.seat}`] });
    expect(state.players[0]!.bonuses).toEqual([{ source: 'Refactor', points: 1 }]);
  });
});
