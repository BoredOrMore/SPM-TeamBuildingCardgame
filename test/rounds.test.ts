import { describe, expect, it } from 'vitest';
import { actingSeat, randomBot } from '../src/bots.js';
import { applyActionInPlace, createGame } from '../src/game.js';
import { data, playRandomGame } from './helpers.js';

describe('rounds [P41]', () => {
  const games = [3, 4].flatMap((players) => Array.from({ length: 20 }, (_, i) => playRandomGame(players, 100 + i)));

  it('passes hands in the direction listed for each round', () => {
    for (const end of games) {
      for (const e of end.events.filter((x) => x.type === 'hands_passed')) {
        expect(e.direction).toBe(data.rules.rounds.passDirection[e.round - 1]);
      }
    }
  });

  it('shows new Meta cards every round, never one from an earlier round', () => {
    for (const end of games) {
      const metas = end.events.filter((e) => e.type === 'round_started').map((e) => e.activeMeta as string[]);
      expect(metas).toHaveLength(data.rules.rounds.count);
      for (const m of metas) expect(m).toHaveLength(data.rules.setup.activeMetaCount);
      const all = metas.flat();
      expect(new Set(all).size).toBe(all.length);
    }
  });

  it('deals a new hand and starts every team empty each round', () => {
    for (const players of [3, 4]) {
      const state = createGame(data, { players, seed: 7 });
      const bots = state.players.map((p) => randomBot(p.seat));
      const handSize = data.rules.setup.handSize[players]!;
      let round = 1;
      while (state.stage !== 'ended') {
        if (state.round !== round) {
          round = state.round;
          for (const p of state.players) {
            expect(p.team).toEqual([]);
            expect(p.hand).toHaveLength(handSize);
          }
          expect(state.visibleCrisis).toEqual([]);
        }
        const seat = actingSeat(state);
        applyActionInPlace(data, state, bots[seat]!.act(data, state, seat));
      }
      expect(round).toBe(data.rules.rounds.count);
    }
  });

  it('adds up every round and gives the win to the highest total', () => {
    for (const end of games) {
      const { scores, winners } = end.result!;
      for (const s of scores) {
        expect(s.lines).toHaveLength(data.rules.rounds.count);
        expect(s.total).toBe(end.roundScores.reduce((sum, r) => sum + r[s.seat]!.total, 0));
      }
      const top = Math.max(...scores.map((s) => s.total));
      for (const w of winners) expect(scores[w]!.total).toBe(top);
      const ended = end.events.find((e) => e.type === 'game_ended')!;
      expect(ended.totals).toEqual(scores.map((s) => s.total));
    }
  });
});
