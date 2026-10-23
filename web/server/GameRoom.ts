// Colyseus room: one table per room code. Sends every client its own filtered view after each change.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Room, ServerError, type Client } from '@colyseus/core';
import { IllegalAction, parseGameData } from '../../src/index.js';
import type { CardsFile, GameData, RulesFile } from '../../src/index.js';
import type { ClientMessages, JoinOptions } from '../shared/protocol.js';
import { Table } from './table.js';

/** Pause before each bot move so people can follow what happened. */
const BOT_DELAY_MS = 700;
/** How long a dropped player keeps their seat. */
const RECONNECT_SECONDS = 120;
/** Letters used in room codes: no I or O, which read like 1 and 0. */
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 4;
/** Error code sent with a rejected join. */
const JOIN_REJECTED = 4000;

/** Parsed JSON file from data/. */
const read = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../data/${name}`, import.meta.url)), 'utf8'));
const data: GameData = parseGameData(read('cards.json') as CardsFile, read('rules.json') as RulesFile);

const codesInUse = new Set<string>();

/** A room code nobody is using. */
function newCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
    if (!codesInUse.has(code)) return code;
  }
}

export class GameRoom extends Room {
  maxClients = data.rules.players.max;
  private table!: Table;
  private botTimer = false;

  /** Picks a room code and wires up the client messages. */
  onCreate(): void {
    const code = newCode();
    codesInUse.add(code);
    this.roomId = code;
    this.table = new Table(data, code);

    this.handle('add_bot', (c) => this.table.addBot(c.sessionId));
    this.handle('remove_bot', (c, m) => this.table.removeBot(c.sessionId, m.seat));
    this.handle('start', (c) => {
      this.table.start(c.sessionId, Math.floor(Math.random() * 2 ** 31));
      void this.lock();
    });
    this.handle('pick', (c, m) => this.table.act(c.sessionId, { type: 'pick', cards: m.cards }));
    this.handle('choose', (c, m) => this.table.act(c.sessionId, { type: 'choose', decisionId: m.decisionId, option: m.option }));
    this.handle('play_again', (c) => {
      this.table.reset(c.sessionId);
      void this.unlock();
    });
  }

  /** Seats the new client, or rejects the join. */
  onJoin(client: Client, options: JoinOptions): void {
    try {
      this.table.join(client.sessionId, String(options?.name ?? ''));
    } catch (err) {
      if (err instanceof IllegalAction) throw new ServerError(JOIN_REJECTED, err.message);
      throw err;
    }
    this.broadcastViews();
  }

  /** Keeps a dropped player's seat for a while. */
  async onDrop(client: Client): Promise<void> {
    this.table.setConnected(client.sessionId, false);
    this.broadcastViews();
    await this.allowReconnection(client, RECONNECT_SECONDS);
  }

  /** Welcomes a player back to their seat. */
  onReconnect(client: Client): void {
    this.table.setConnected(client.sessionId, true);
    this.broadcastViews();
  }

  /** Frees the seat, or hands it to a bot mid-game. */
  onLeave(client: Client): void {
    this.table.leave(client.sessionId);
    this.broadcastViews();
    this.runBots();
  }

  /** Releases the room code. */
  onDispose(): void {
    codesInUse.delete(this.table.code);
  }

  /** Registers a handler that changes the table, then updates everyone; rule errors go back to the sender only. */
  private handle<K extends keyof ClientMessages>(type: K, fn: (client: Client, message: ClientMessages[K]) => unknown): void {
    this.onMessage(type, (client: Client, message: ClientMessages[K]) => {
      try {
        fn(client, message ?? ({} as ClientMessages[K]));
      } catch (err) {
        if (!(err instanceof IllegalAction)) throw err;
        client.send('error_msg', err.message);
        return;
      }
      this.broadcastViews();
      this.runBots();
    });
  }

  /** Lets bots move one at a time, with a pause between moves, until a human must act. */
  private runBots(): void {
    if (this.botTimer) return;
    const action = this.table.nextBotAction();
    if (!action) return;
    this.botTimer = true;
    this.clock.setTimeout(() => {
      this.botTimer = false;
      // the table may have changed during the pause, so ask again
      const next = this.table.nextBotAction();
      if (next) this.table.applyBotAction(next);
      this.broadcastViews();
      this.runBots();
    }, BOT_DELAY_MS);
  }

  /** Sends each connected client its own view. */
  private broadcastViews(): void {
    for (const client of this.clients) client.send('view', this.table.viewFor(client.sessionId));
  }
}
