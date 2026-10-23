import { describe, expect, it } from 'vitest';
import { DataError, parseGameData } from '../src/data.js';
import { applyActionInPlace, createGame, currentDecision } from '../src/game.js';
import { scorePlayer } from '../src/scoring.js';
import type { CardsFile, GameData, RulesFile } from '../src/types.js';
import { data, playRandomGame, team } from './helpers.js';

/** The real data with `change` applied to deep copies of cards.json and rules.json. */
function variant(change: (cards: CardsFile, rules: RulesFile) => void): GameData {
  const cards = structuredClone(data.cards);
  const rules = structuredClone(data.rules);
  change(cards, rules);
  return parseGameData(cards, rules);
}

/** The effect object of one card in a cards.json copy. */
function effectOf(cards: CardsFile, id: string) {
  const def = Object.values(cards.decks).flat().find((c) => c.id === id);
  if (!def?.effect) throw new Error(`no effect on ${id}`);
  return def.effect;
}

const CATCH_UP = ['steal_best_card', 'hostile_takeover', 'underdog_bonus'];

describe('balance knobs in data', () => {
  it('rejects a negative minLead', () => {
    expect(() => variant((cards) => (effectOf(cards, 'steal_best_card').minLead = -1))).toThrow(DataError);
  });

  it('catch-up Crisis cards do nothing while the lead is below minLead [P33]', () => {
    const strict = variant((cards) => CATCH_UP.forEach((id) => (effectOf(cards, id).minLead = 1000)));
    let skipped = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const events = playRandomGame(4, seed, strict).events;
      expect(events.some((e) => e.type === 'bonus_gained' && e.source === 'underdog_bonus')).toBe(false);
      expect(events.some((e) => (e.type === 'card_stolen' && e.reason === 'steal_best_card') || (e.type === 'card_given' && e.reason === 'hostile_takeover'))).toBe(false);
      skipped += events.filter((e) => e.reason === 'lead_below_minimum').length;
    }
    expect(skipped).toBeGreaterThan(0);
  });

  it('Hostile Takeover gives effect.count cards', () => {
    const one = variant((cards) => (effectOf(cards, 'hostile_takeover').count = 1));
    let takeovers = 0;
    for (let seed = 1; seed <= 300; seed++) {
      for (const e of playRandomGame(3, seed, one).events) {
        if (e.type !== 'decision_made' || e.decision !== 'hostile_takeover') continue;
        expect((e.choice as { uids: string[] }).uids).toHaveLength(1);
        takeovers += 1;
      }
    }
    expect(takeovers).toBeGreaterThan(0);
  });

  it('draws at most `max` of the limited Crisis cards per game [P34]', () => {
    const limited = ['steal_best_card', 'hostile_takeover', 'poaching', 'burnout', 'layoff', 'underdog_bonus'];
    const once = variant((_, rules) => (rules.crisis.limitedPerGame = { cards: limited, max: 1 }));
    for (let seed = 1; seed <= 300; seed++) {
      const drawn = playRandomGame(4, seed, once).events.filter((e) => e.type === 'crisis_drawn' && limited.includes((e.card as { id: string }).id));
      expect(drawn.length).toBeLessThanOrEqual(1);
    }
  });

  it('Refactor takes QA from the discard pile only when addFrom allows it [P27]', () => {
    const play = (gameData: GameData) => {
      const state = createGame(gameData, { players: 3, seed: 5 });
      const qa = state.mainRemaining.filter((c) => c.id === 'qa_tester');
      state.mainRemaining = state.mainRemaining.filter((c) => c.id !== 'qa_tester');
      state.players.forEach((p) => (p.hand = p.hand.filter((c) => c.id !== 'qa_tester')));
      state.discard.push(...qa);
      state.players[0]!.team = [{ uid: 'b', id: 'bug' }];
      state.players.forEach((p, i) => (p.hand[0] = { uid: `h${i}`, id: i === 0 ? 'refactor' : 'coffee' }));
      for (const p of state.players) applyActionInPlace(gameData, state, { type: 'pick', player: p.seat, cards: [p.hand[0]!.uid] });
      // Refactor may wait on a choice when it can convert more than one way.
      const d = currentDecision(state);
      if (d?.kind === 'refactor') applyActionInPlace(gameData, state, { type: 'choose', player: 0, decisionId: d.id, option: 0 });
      return state.players[0]!.team.map((c) => c.id);
    };
    expect(play(data)).toEqual(['bug']);
    expect(play(variant((cards) => (effectOf(cards, 'refactor').addFrom = ['main_deck', 'discard'])))).toEqual(['qa_tester']);
  });

  it('scales Meta bonuses by metaMultiplier, rounding down [P35]', () => {
    const half = variant((_, rules) => (rules.scoring.metaMultiplier = 0.5));
    const meta = (gameData: GameData) =>
      scorePlayer({ data: gameData, teams: [team({ junior_dev: 6 })], seat: 0, activeMeta: ['developer_shortage'], visibleCrisis: [], bonuses: [], totalTurns: 10 })
        .lines.find((l) => l.label.startsWith('Meta'))!.points;
    expect(meta(data)).toBe(6);
    expect(meta(half)).toBe(3);
  });

  it('shows the next Crisis a turn early and then draws that same card [P36]', () => {
    const telegraphed = variant((_, rules) => (rules.crisis.previewNext = true));
    for (let seed = 1; seed <= 100; seed++) {
      const events = playRandomGame(4, seed, telegraphed).events;
      const previews = events.filter((e) => e.type === 'crisis_previewed').map((e) => (e.card as { uid: string }).uid);
      const draws = events.filter((e) => e.type === 'crisis_drawn').map((e) => (e.card as { uid: string }).uid);
      expect(previews).toEqual(draws);
    }
    expect(playRandomGame(4, 1).events.some((e) => e.type === 'crisis_previewed')).toBe(false);
  });

  it('deals private Meta that scores only for its owner [P37]', () => {
    const secret = variant((_, rules) => (rules.setup.privateMetaPerPlayer = 1));
    const state = createGame(secret, { players: 4, seed: 7 });
    const dealt = state.players.map((p) => p.privateMeta);
    expect(dealt.every((m) => m.length === 1)).toBe(true);
    expect(new Set([...state.activeMeta, ...dealt.flat(), ...state.unusedMeta]).size).toBe(state.activeMeta.length + 4 + state.unusedMeta.length);
    const event = state.events.find((e) => e.type === 'private_meta_dealt' && e.player === 2)!;
    expect(event.visibleTo).toEqual([2]);
    expect(() => variant((_, rules) => (rules.setup.privateMetaPerPlayer = 10))).toThrow(DataError);
  });
});
