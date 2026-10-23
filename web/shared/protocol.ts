// Messages between the room server and the browser client, and the per-seat view the server sends.

import type { Bonus, CardInstance, Choice, DecisionKind, GameEvent, ScoreResult, Stage } from '../../src/index.js';

export const ROOM_NAME = 'head_hunter';

/** A seat in the lobby or game, as everyone sees it. */
export interface SeatInfo {
  seat: number;
  name: string;
  isBot: boolean;
  isHost: boolean;
  connected: boolean;
}

/** Lobby screen: who is in the room before the game starts. */
export interface LobbyView {
  phase: 'lobby';
  code: string;
  you: number;
  seats: SeatInfo[];
  minPlayers: number;
  maxPlayers: number;
}

/** Another player's board, without anything hidden from you. */
export interface OpponentView extends SeatInfo {
  team: CardInstance[];
  protected: string[];
  bonuses: Bonus[];
  handCount: number;
  hasPicked: boolean;
  revealed: CardInstance[];
  /** points this round if it ended now, from what everyone can see (your own also counts your private Meta) */
  score: number;
}

/** The decision someone must answer now. `options` is set only when it is yours. */
export interface DecisionView {
  id: number;
  player: number;
  kind: DecisionKind;
  source: string;
  options?: Choice[];
  context?: { proposer?: number; offer?: Extract<Choice, { kind: 'merger_offer' }> };
}

/** Game screen: everything one seat is allowed to see. */
export interface GameView {
  phase: 'game';
  code: string;
  you: number;
  /** 1-based round, of `totalRounds` */
  round: number;
  totalRounds: number;
  /** which way hands pass this round */
  passDirection: 'left' | 'right';
  /** turn within the round, of `totalTurns` per round */
  turn: number;
  totalTurns: number;
  stage: Stage;
  picksRequired: number;
  crunchNextTurn: boolean;
  hand: CardInstance[];
  picked: string[] | null;
  privateMeta: string[];
  players: OpponentView[];
  activeMeta: string[];
  visibleCrisis: CardInstance[];
  discard: CardInstance[];
  mainRemaining: number;
  crisisRemaining: number;
  decision?: DecisionView;
  /** your score if the game ended now, counting your private Meta */
  yourScore: ScoreResult;
  /** your points over every finished round plus this one */
  yourTotal: number;
  /** each finished round's scores and teams, by seat */
  roundScores: ScoreResult[][];
  roundTeams: CardInstance[][][];
  /** recent events you may see; `seq` is the event's position in the whole game, so the client can tell which are new */
  events: Array<GameEvent & { seq: number }>;
  result?: { scores: ScoreResult[]; winners: number[] };
}

export type View = LobbyView | GameView;

/** Client → server messages. */
export interface ClientMessages {
  add_bot: Record<string, never>;
  remove_bot: { seat: number };
  start: Record<string, never>;
  pick: { cards: string[] };
  choose: { decisionId: number; option: number };
  play_again: Record<string, never>;
}

/** Options the client sends when creating or joining a room. */
export interface JoinOptions {
  name: string;
}
