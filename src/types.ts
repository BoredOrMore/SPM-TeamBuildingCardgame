// Shapes of data/*.json and of the game state.

export type CardType = 'role' | 'event' | 'action' | 'defense' | 'boost';

export type Condition = {
  maxCount?: Record<string, number>;
  minCount?: Record<string, number>;
  moreThan?: [string, string];
  employeeCountBetween?: [number, number];
  strictlyMostEmployees?: boolean;
  fewestTotalCards?: boolean;
  maxTotalCards?: number;
};

export type Effect = {
  kind: string;
  condition?: Condition;
  [key: string]: unknown;
};

export interface CardDef {
  id: string;
  name: string;
  type?: CardType;
  quantity: number;
  text: string;
  /** Printed text with keyword and icon codes such as {POACH} (data/keywords.json) */
  cardText?: string;
  timing?: 'on_reveal' | 'scoring';
  persistent?: boolean;
  effect?: Effect;
  placeholders?: string[];
}

export interface CardsFile {
  schemaVersion: string;
  roleGroups: Record<string, string[]>;
  decks: { main: CardDef[]; crisis: CardDef[]; meta: CardDef[]; support: CardDef[] };
}

export interface RulesFile {
  schemaVersion: string;
  players: { min: number; max: number };
  setup: { activeMetaCount: number; privateMetaPerPlayer: number; handSize: Record<string, number> };
  turns: { count: Record<string, number> };
  crisis: { afterTurns: number[]; limitedPerGame: { cards: string[]; max: number }; previewNext: boolean };
  scoring: { metaMultiplier: number };
  testCases: Array<{
    name: string;
    team: Record<string, number>;
    choices?: Record<string, string>;
    expect: Record<string, number>;
  }>;
}

export interface GameData {
  cards: CardsFile;
  rules: RulesFile;
  byId: Map<string, CardDef>;
}

export interface CardInstance {
  uid: string;
  id: string;
}

export interface Bonus {
  source: string;
  points: number;
}

export interface PlayerState {
  seat: number;
  hand: CardInstance[];
  team: CardInstance[];
  /** uids protected by NDA */
  protected: string[];
  /** points granted during play (Underdog Bonus, Persevere, Merger Offer, Phone Screen) */
  bonuses: Bonus[];
  /** uids chosen this turn, null until submitted */
  picked: string[] | null;
  revealed: CardInstance[];
  /** Meta card ids only this player sees and scores [P37] */
  privateMeta: string[];
}

export type DecisionKind =
  | 'headhunt'
  | 'phone_screen'
  | 'refactor'
  | 'nda'
  | 'burnout'
  | 'layoff'
  | 'poaching'
  | 'hostile_takeover'
  | 'steal_best_card'
  | 'funding_round'
  | 'pivot_or_persevere'
  | 'merger_propose'
  | 'merger_respond';

export type Choice =
  | { kind: 'headhunt'; opponent: number; give: string; take: string }
  | { kind: 'phone_screen'; opponent: number }
  | { kind: 'refactor'; mode: 'bug_to_qa' | 'juniors_to_senior' | 'points' }
  | { kind: 'nda'; protect: string }
  | { kind: 'discard'; uid: string }
  | { kind: 'take'; opponent: number; uid: string }
  | { kind: 'give'; to: number; uids: string[] }
  | { kind: 'take_discard'; uid: string }
  | { kind: 'draw_main' }
  | { kind: 'persevere' }
  | { kind: 'pivot'; discard: string[] }
  | { kind: 'merger_decline' }
  | { kind: 'merger_offer'; target: number; give: string; take: string }
  | { kind: 'merger_accept' }
  | { kind: 'merger_reject' };

export interface Decision {
  id: number;
  player: number;
  kind: DecisionKind;
  /** card uid or crisis id that caused this decision */
  source: string;
  /** filled when the decision reaches the front of the queue */
  options?: Choice[];
  context?: { proposer?: number; offer?: Extract<Choice, { kind: 'merger_offer' }> };
}

export type Stage = 'pick' | 'actions' | 'nda' | 'crisis' | 'ended';

export interface GameEvent {
  type: string;
  turn: number;
  /** omitted = public; otherwise only these seats may see it */
  visibleTo?: number[];
  [key: string]: unknown;
}

export interface ScoreLine {
  label: string;
  points: number;
  /** how the points were counted, e.g. "2 × -5 (Zero Defect Premium)"; may hold {CODE} icons */
  detail?: string;
}

export interface ScoreResult {
  seat: number;
  total: number;
  lines: ScoreLine[];
}

export interface GameState {
  playerCount: number;
  totalTurns: number;
  turn: number;
  stage: Stage;
  picksRequired: number;
  crunchNextTurn: boolean;
  firstPlayer: number;
  players: PlayerState[];
  mainRemaining: CardInstance[];
  discard: CardInstance[];
  crisisDeck: CardInstance[];
  crisisDiscard: CardInstance[];
  visibleCrisis: CardInstance[];
  activeMeta: string[];
  /** Meta card ids out of play; hidden from everyone */
  unusedMeta: string[];
  queue: Decision[];
  nextDecisionId: number;
  rng: number;
  events: GameEvent[];
  result?: { scores: ScoreResult[]; winners: number[] };
}

export type Action =
  | { type: 'pick'; player: number; cards: string[] }
  | { type: 'choose'; player: number; decisionId: number; option: number };

/** A player controlled by code. `act` is called only when `seat` must act. */
export interface Bot {
  readonly name: string;
  act(data: GameData, state: GameState, seat: number): Action;
}
