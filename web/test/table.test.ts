import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IllegalAction, parseGameData } from '../../src/index.js';
import type { CardsFile, GameData, RulesFile } from '../../src/index.js';
import type { GameView } from '../shared/protocol.js';
import { Table } from '../server/table.js';

/** Parsed JSON file from data/. */
const read = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../data/${name}`, import.meta.url)), 'utf8'));
const data: GameData = parseGameData(read('cards.json') as CardsFile, read('rules.json') as RulesFile);

/** A started table with two humans (`a`, `b`) and one bot. */
function startedTable(seed = 1): Table {
  const table = new Table(data, 'TEST');
  table.join('a', 'Ann');
  table.join('b', 'Ben');
  table.addBot('a');
  table.start('a', seed);
  return table;
}

/** Plays humans with the first legal move and bots with their own logic until the game ends. */
function playOut(table: Table): void {
  for (let steps = 0; table.state!.stage !== 'ended'; steps++) {
    if (steps > 5000) throw new Error('game did not finish');
    const bot = table.nextBotAction();
    if (bot) {
      table.applyBotAction(bot);
      continue;
    }
    const decision = table.state!.queue[0];
    if (decision) {
      table.act(table.seats[decision.player]!.id, { type: 'choose', decisionId: decision.id, option: 0 });
      continue;
    }
    const p = table.state!.players.find((x) => !x.picked)!;
    table.act(table.seats[p.seat]!.id, { type: 'pick', cards: p.hand.slice(0, table.state!.picksRequired).map((c) => c.uid) });
  }
}

describe('lobby', () => {
  it('only the host adds bots and starts', () => {
    const table = new Table(data, 'TEST');
    table.join('a', 'Ann');
    table.join('b', 'Ben');
    expect(() => table.addBot('b')).toThrow(IllegalAction);
    expect(() => table.start('b', 1)).toThrow(IllegalAction);
    table.addBot('a');
    expect(table.seats.map((s) => s.name)).toEqual(['Ann', 'Ben', 'Bot 1']);
  });

  it('refuses to start below the minimum player count', () => {
    const table = new Table(data, 'TEST');
    table.join('a', 'Ann');
    expect(() => table.start('a', 1)).toThrow(IllegalAction);
  });

  it('passes host to the next human when the host leaves', () => {
    const table = new Table(data, 'TEST');
    table.join('a', 'Ann');
    table.join('b', 'Ben');
    table.leave('a');
    expect(table.isHost('b')).toBe(true);
  });
});

describe('views hide private information', () => {
  it('shows your hand and private Meta but only counts for others', () => {
    const table = startedTable();
    const view = table.viewFor('a') as GameView;
    const state = table.state!;
    expect(view.hand).toEqual(state.players[0]!.hand);
    expect(view.privateMeta).toEqual(state.players[0]!.privateMeta);
    const json = JSON.stringify(view);
    for (const card of state.players[1]!.hand) expect(json).not.toContain(`"${card.uid}"`);
    for (const id of state.unusedMeta) expect(view.activeMeta).not.toContain(id);
    expect(view.players[1]!.handCount).toBe(state.players[1]!.hand.length);
    expect(json).not.toContain('mainRemaining":[');
  });

  it('sends decision options only to the decision owner and private events only to their audience', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const table = startedTable(seed);
      for (let steps = 0; table.state!.stage !== 'ended' && steps < 5000; steps++) {
        const decision = table.state!.queue[0];
        for (const id of ['a', 'b']) {
          const view = table.viewFor(id) as GameView;
          if (view.decision && view.decision.player !== view.you) expect(view.decision.options).toBeUndefined();
          for (const e of view.events) if (e.visibleTo) expect(e.visibleTo).toContain(view.you);
        }
        const bot = table.nextBotAction();
        if (bot) table.applyBotAction(bot);
        else if (decision) table.act(table.seats[decision.player]!.id, { type: 'choose', decisionId: decision.id, option: 0 });
        else {
          const p = table.state!.players.find((x) => !x.picked)!;
          table.act(table.seats[p.seat]!.id, { type: 'pick', cards: p.hand.slice(0, table.state!.picksRequired).map((c) => c.uid) });
        }
      }
    }
  });
});

describe('full games', () => {
  it('finish with humans and bots, and return to the lobby', () => {
    const table = startedTable(7);
    playOut(table);
    expect((table.viewFor('a') as GameView).result?.winners.length).toBeGreaterThan(0);
    table.reset('a');
    expect(table.viewFor('a').phase).toBe('lobby');
    expect(table.seats).toHaveLength(3);
  });

  it('hands a leaving player to a bot so the game can finish', () => {
    const table = startedTable(3);
    table.leave('b');
    expect(table.seats[1]!.isBot).toBe(true);
    playOut(table);
    expect(table.state!.stage).toBe('ended');
  });

  it('rejects moves from someone without a seat', () => {
    const table = startedTable();
    expect(() => table.act('zzz', { type: 'pick', cards: [] })).toThrow(IllegalAction);
  });
});
