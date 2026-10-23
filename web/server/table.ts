// One game table: lobby seats, bots, the engine state, and what each seat may see. No networking here.

import { applyActionInPlace, createGame, currentDecision, currentScores, greedyBot, IllegalAction } from '../../src/index.js';
import type { Action, Bot, CardInstance, GameData, GameEvent, GameState } from '../../src/index.js';
import type { GameView, LobbyView, OpponentView, SeatInfo, View } from '../shared/protocol.js';

/** How many recent events each view carries for the play log. */
const EVENT_LOG_SIZE = 40;

interface Seat {
  /** client session id, or `bot-N` */
  id: string;
  name: string;
  isBot: boolean;
  connected: boolean;
  bot?: Bot;
}

export class Table {
  readonly code: string;
  seats: Seat[] = [];
  state?: GameState;
  private botCount = 0;

  constructor(
    private readonly data: GameData,
    code: string,
  ) {
    this.code = code;
  }

  /** Whether another human or bot may still sit down. */
  get isFull(): boolean {
    return this.seats.length >= this.data.rules.players.max;
  }

  /** Seat index of a client or bot id, or -1. */
  seatOf(id: string): number {
    return this.seats.findIndex((s) => s.id === id);
  }

  /** Whether this id belongs to the host: the first human seated. */
  isHost(id: string): boolean {
    return this.seats.find((s) => !s.isBot)?.id === id;
  }

  /** Seats a new human in the lobby. */
  join(id: string, name: string): void {
    if (this.state) throw new IllegalAction('game already started');
    if (this.isFull) throw new IllegalAction('room is full');
    this.seats.push({ id, name: name.trim().slice(0, 20) || `Player ${this.seats.length + 1}`, isBot: false, connected: true });
  }

  /** Removes a human for good: frees the seat in the lobby, or hands it to a bot mid-game. */
  leave(id: string): void {
    const seat = this.seats[this.seatOf(id)];
    if (!seat) return;
    if (!this.state) {
      this.seats = this.seats.filter((s) => s !== seat);
      return;
    }
    seat.isBot = true;
    seat.connected = false;
    seat.bot = greedyBot(this.state.rng ^ this.seatOf(id));
  }

  /** Marks a human as dropped or back, without giving up the seat. */
  setConnected(id: string, connected: boolean): void {
    const seat = this.seats[this.seatOf(id)];
    if (seat) seat.connected = connected;
  }

  /** Adds a bot to the lobby (host only). */
  addBot(by: string): void {
    this.requireHostInLobby(by);
    if (this.isFull) throw new IllegalAction('room is full');
    this.botCount++;
    this.seats.push({ id: `bot-${this.botCount}`, name: `Bot ${this.botCount}`, isBot: true, connected: true });
  }

  /** Removes a bot from the lobby (host only). */
  removeBot(by: string, seat: number): void {
    this.requireHostInLobby(by);
    if (!this.seats[seat]?.isBot) throw new IllegalAction('not a bot seat');
    this.seats.splice(seat, 1);
  }

  /** Deals a new game for the seated players (host only). */
  start(by: string, seed: number): void {
    this.requireHostInLobby(by);
    const { min } = this.data.rules.players;
    if (this.seats.length < min) throw new IllegalAction(`need at least ${min} players`);
    this.state = createGame(this.data, { players: this.seats.length, seed });
    this.seats.forEach((s, i) => {
      if (s.isBot) s.bot = greedyBot(seed + i);
    });
  }

  /** Back to the lobby after a game ends, keeping everyone still connected (host only). */
  reset(by: string): void {
    if (!this.isHost(by)) throw new IllegalAction('only the host can do that');
    if (this.state?.stage !== 'ended') throw new IllegalAction('game is still running');
    this.state = undefined;
    this.seats = this.seats.filter((s) => s.id.startsWith('bot-') || (!s.isBot && s.connected));
  }

  /** Applies a human's move; throws IllegalAction when it is not allowed. */
  act(id: string, move: { type: 'pick'; cards: string[] } | { type: 'choose'; decisionId: number; option: number }): GameEvent[] {
    if (!this.state) throw new IllegalAction('game has not started');
    const seat = this.seatOf(id);
    if (seat < 0 || this.seats[seat]!.isBot) throw new IllegalAction('you have no seat');
    return applyActionInPlace(this.data, this.state, { ...move, player: seat } as Action);
  }

  /** The next move a bot should make now, or undefined when only humans can act. */
  nextBotAction(): Action | undefined {
    const state = this.state;
    if (!state || state.stage === 'ended') return undefined;
    const decision = currentDecision(state);
    const seats = decision ? [decision.player] : state.players.filter((p) => !p.picked).map((p) => p.seat);
    const seat = seats.find((s) => this.seats[s]!.isBot);
    return seat === undefined ? undefined : this.seats[seat]!.bot!.act(this.data, state, seat);
  }

  /** Applies a bot's move from nextBotAction. */
  applyBotAction(action: Action): GameEvent[] {
    return applyActionInPlace(this.data, this.state!, action);
  }

  /** What the given client may see right now. */
  viewFor(id: string): View {
    const you = this.seatOf(id);
    const seats: SeatInfo[] = this.seats.map((s, seat) => ({ seat, name: s.name, isBot: s.isBot, isHost: this.isHost(s.id), connected: s.connected }));
    const state = this.state;
    if (!state) {
      const lobby: LobbyView = { phase: 'lobby', code: this.code, you, seats, minPlayers: this.data.rules.players.min, maxPlayers: this.data.rules.players.max };
      return lobby;
    }
    const me = state.players[you]!;
    const decision = currentDecision(state);
    const players: OpponentView[] = state.players.map((p) => ({
      ...seats[p.seat]!,
      team: p.team,
      protected: p.protected,
      bonuses: p.bonuses,
      handCount: p.hand.length,
      hasPicked: p.picked !== null,
      revealed: p.revealed,
    }));
    const yourScore = currentScores(this.data, state)[you]!;
    const view: GameView = {
      phase: 'game',
      code: this.code,
      you,
      round: state.round,
      totalRounds: this.data.rules.rounds.count,
      passDirection: this.data.rules.rounds.passDirection[state.round - 1]!,
      turn: state.turn,
      totalTurns: state.totalTurns,
      stage: state.stage,
      picksRequired: state.picksRequired,
      crunchNextTurn: state.crunchNextTurn,
      hand: me.hand,
      picked: me.picked,
      privateMeta: me.privateMeta,
      players,
      activeMeta: state.activeMeta,
      visibleCrisis: state.visibleCrisis,
      discard: state.discard,
      mainRemaining: state.mainRemaining.length,
      crisisRemaining: state.crisisDeck.length,
      decision: decision && {
        id: decision.id,
        player: decision.player,
        kind: decision.kind,
        source: decision.source,
        options: decision.player === you ? decision.options : undefined,
        context: decision.context,
      },
      yourScore,
      yourTotal: state.roundScores.reduce((sum, r) => sum + r[you]!.total, state.stage === 'ended' ? 0 : yourScore.total),
      roundScores: state.roundScores,
      roundTeams: state.events.filter((e) => e.type === 'round_ended').map((e) => e.teams as CardInstance[][]),
      events: state.events
        .map((e, seq) => ({ ...e, seq }))
        .filter((e) => !e.visibleTo || e.visibleTo.includes(you))
        .slice(-EVENT_LOG_SIZE),
      result: state.result,
    };
    return structuredClone(view);
  }

  /** Throws unless the game has not started and `by` is the host. */
  private requireHostInLobby(by: string): void {
    if (this.state) throw new IllegalAction('game already started');
    if (!this.isHost(by)) throw new IllegalAction('only the host can do that');
  }
}
