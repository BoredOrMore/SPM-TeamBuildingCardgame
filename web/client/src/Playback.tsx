// Plays the game's events one at a time before the board changes, so every move is seen:
// a spotlight shows one card large with one line saying who did what, then the card flies to where it goes.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CardInstance, GameEvent, ScoreResult } from '../../../src/index.js';
import type { GameView, View } from '../../shared/protocol.js';
import { Card, CardBack, eventLine, idOfUid, isAction, type BackDeck } from './cards.js';
import { sfx, type Sfx } from './sound.js';

/** Spotlight speeds a player can pick. */
export const SPEEDS = ['normal', 'fast'] as const;
export type Speed = (typeof SPEEDS)[number];
/**
 * Per speed: how long one spotlight stays on screen, how long its card takes to fly to its zone at the end of it,
 * and how long the reveal flips each card, one seat after another `flipStaggerMs` apart.
 */
const TIMING: Record<Speed, { spotlightMs: number; flightMs: number; flipMs: number; flipStaggerMs: number }> = {
  normal: { spotlightMs: 1500, flightMs: 550, flipMs: 400, flipStaggerMs: 80 },
  fast: { spotlightMs: 750, flightMs: 300, flipMs: 250, flipStaggerMs: 50 },
};
/** Events that change nothing a player needs to watch; the status bar already says whose turn it is. */
const SILENT = new Set(['card_picked', 'teams_updated', 'decision_made', 'game_started', 'game_ended', 'private_meta_dealt', 'turn_started']);

type SeqEvent = GameEvent & { seq: number };

/** The effect each spotlight plays when it appears. */
const SOUND_OF: Record<string, Sfx> = {
  card_gained: 'gain',
  card_stolen: 'steal',
  card_given: 'give',
  cards_swapped: 'swap',
  card_discarded: 'discard',
  crisis_drawn: 'crisis',
  crisis_previewed: 'preview',
  bonus_gained: 'bonus',
  card_protected: 'protect',
  no_effect: 'noEffect',
  hands_passed: 'shuffle',
  hands_swapped: 'shuffle',
  hand_revealed: 'reveal',
  cards_revealed: 'reveal',
  round_started: 'roundStart',
  round_ended: 'roundEnd',
};

interface SpotCard {
  id: string;
  /** zone (data-zone selector) the card flies to; none keeps it in place */
  to?: string;
  /** on a flip step, its place in the order cards turn over: for a reveal, the order of the seat that played it */
  seatOrder?: number;
  /** on a flip step, the deck back it starts as; Main unless set */
  back?: BackDeck;
}

/** One row of the standings shown when a round ends. */
interface Standing {
  seat: number;
  name: string;
  /** points this round */
  round: number;
  /** points over every round so far */
  total: number;
}

export interface Step {
  key: string;
  line: string;
  icon: string;
  cards: SpotCard[];
  /** seats whose area pulses */
  seats: number[];
  /** floating "+N" by a seat */
  bonus?: { seat: number; points: number };
  sound?: Sfx;
  /** every card starts face down and turns over, as when the table reveals together */
  flip?: boolean;
  /** the round's scores, shown until the player taps the button that says `goOn` */
  standings?: Standing[];
  goOn?: string;
}

const zone = (name: string) => `[data-zone="${name}"]`;

/** The icon, spotlight cards and pulses for one event. */
function stepFor(view: GameView, e: SeqEvent): Omit<Step, 'key' | 'line'> {
  const card = e.card as CardInstance | undefined;
  switch (e.type) {
    case 'card_gained':
      return { icon: 'ri-user-add-line', seats: [e.player as number], cards: [{ id: card!.id, to: zone(`team-${e.player}`) }] };
    case 'card_stolen':
      return { icon: 'ri-user-received-line', seats: [e.from as number, e.to as number], cards: [{ id: card!.id, to: zone(`team-${e.to}`) }] };
    case 'card_given':
      return { icon: 'ri-hand-heart-line', seats: [e.from as number, e.to as number], cards: [{ id: card!.id, to: zone(`team-${e.to}`) }] };
    case 'cards_swapped': {
      const [a, b] = e.players as number[];
      const [x, y] = e.cards as CardInstance[];
      return {
        icon: 'ri-arrow-left-right-line',
        seats: [a!, b!],
        cards: [
          { id: x!.id, to: zone(`team-${b}`) },
          { id: y!.id, to: zone(`team-${a}`) },
        ],
      };
    }
    case 'card_discarded':
      return { icon: 'ri-delete-bin-line', seats: [e.player as number], cards: [{ id: card!.id, to: zone('deck') }] };
    case 'crisis_drawn':
      // the top card of the Crisis pile turns over, then lands on the table
      return { icon: 'ri-alarm-warning-line', seats: [], flip: true, cards: [{ id: card!.id, to: zone('crisis'), back: 'crisis' }] };
    case 'round_started':
      // this round's Meta cards turn over as the round begins
      return {
        icon: e.direction === 'left' ? 'ri-arrow-left-line' : 'ri-arrow-right-line',
        seats: [],
        flip: true,
        cards: (e.activeMeta as string[]).map((id, seatOrder) => ({ id, to: zone('crisis'), back: 'meta' as const, seatOrder })),
      };
    case 'round_ended': {
      const round = e.round as number;
      const standings = (e.scores as ScoreResult[]).map((s) => ({
        seat: s.seat,
        name: s.seat === view.you ? 'You' : (view.players[s.seat]?.name ?? '?'),
        round: s.total,
        total: view.roundScores.slice(0, round).reduce((sum, r) => sum + r[s.seat]!.total, 0),
      }));
      const goOn = round < view.totalRounds ? `Start round ${round + 1}` : 'See final results';
      return { icon: 'ri-flag-line', seats: [], cards: [], standings: standings.sort((a, b) => b.total - a.total), goOn };
    }
    case 'crisis_previewed':
      return { icon: 'ri-eye-line', seats: [], cards: [{ id: card!.id }] };
    case 'bonus_gained':
      return { icon: 'ri-coin-line', seats: [e.player as number], cards: [{ id: String(e.source) }], bonus: { seat: e.player as number, points: e.points as number } };
    case 'card_protected':
      return { icon: 'ri-shield-line', seats: [e.player as number], cards: [{ id: idOfUid(view, String(e.uid)) }] };
    case 'no_effect':
      return { icon: 'ri-information-line', seats: [], cards: [{ id: idOfUid(view, String(e.source)) }] };
    case 'hands_passed':
      return { icon: e.direction === 'left' ? 'ri-arrow-left-line' : 'ri-arrow-right-line', seats: [], cards: [] };
    case 'hands_swapped':
      return { icon: 'ri-repeat-line', seats: [], cards: [] };
    default:
      return { icon: 'ri-information-line', seats: [], cards: [] };
  }
}

/** Turns new events into spotlights, one per event and one per player for a reveal. */
export function stepsFor(view: GameView, events: SeqEvent[]): Step[] {
  const steps: Step[] = [];
  for (const e of events) {
    if (SILENT.has(e.type)) continue;
    if (e.type === 'cards_revealed') {
      const reveals = e.cards as Array<{ player: number; cards: CardInstance[] }>;
      // everyone's picks turn over together first, then each player's play is shown on its own
      steps.push({
        key: `${e.seq}-flip`,
        line: 'Everyone reveals',
        icon: 'ri-eye-line',
        seats: reveals.map((r) => r.player),
        cards: reveals.flatMap((r, seatOrder) => r.cards.map((c) => ({ id: c.id, seatOrder }))),
        sound: SOUND_OF[e.type],
        flip: true,
      });
      for (const r of reveals) {
        steps.push({
          key: `${e.seq}-${r.player}`,
          line: eventLine(view, { ...e, cards: [r] })!,
          icon: 'ri-eye-line',
          seats: [r.player],
          // played Action cards go to the discard pile, the rest join the team
          cards: r.cards.map((c) => ({ id: c.id, to: isAction(c.id) ? zone('deck') : zone(`team-${r.player}`) })),
        });
      }
      continue;
    }
    const line = eventLine(view, e);
    if (!line) continue;
    steps.push({ key: String(e.seq), line, sound: SOUND_OF[e.type], ...stepFor(view, e) });
  }
  return steps;
}

/** Highest event seq in a view, or -1. */
const lastSeqOf = (view: GameView) => view.events.reduce((m, e) => Math.max(m, e.seq), -1);

/**
 * The view to draw and the spotlight playing now. Incoming views wait in line: each one's new events
 * play over the previous board first, then the board catches up. `skip` jumps to the newest view.
 */
export function usePlayback(view: View | undefined, speed: Speed): { shown: View | undefined; step: Step | undefined; skip: () => void; next: () => void } {
  const [shown, setShown] = useState(view);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const [step, setStep] = useState<Step>();
  const queue = useRef<View[]>([]);
  const lastSeq = useRef(-1);
  const busy = useRef(false);
  const skipping = useRef(false);
  const shownRef = useRef(view);
  /** ends the spotlight now playing early */
  const wake = useRef(() => {});

  /** Shows the next waiting view, after playing its new events. */
  const pump = async () => {
    if (busy.current) return;
    busy.current = true;
    while (queue.current.length) {
      const next = queue.current.shift()!;
      // the first board after the lobby is drawn first, then plays only the opening round's start (its Meta cards turning over)
      const opening = next.phase === 'game' && shownRef.current?.phase === 'lobby';
      if (opening) {
        // a new game numbers its events from the start again
        lastSeq.current = -1;
        shownRef.current = next;
        setShown(next);
      }
      if (next.phase === 'game' && shownRef.current?.phase === 'game') {
        const fresh = next.events.filter((e) => e.seq > lastSeq.current && (!opening || e.type === 'round_started'));
        // labels and positions come from the board still on screen, where the cards are now
        for (const s of stepsFor(next, fresh)) {
          // skipping passes everything but a round's standings, which wait for a tap
          if (skipping.current && !s.standings) continue;
          setStep(s);
          if (s.sound) sfx(s.sound);
          await new Promise<void>((resolve) => {
            const timer = s.standings ? undefined : setTimeout(resolve, TIMING[speedRef.current].spotlightMs);
            wake.current = () => {
              clearTimeout(timer);
              resolve();
            };
          });
        }
        setStep(undefined);
      }
      if (next.phase === 'game') lastSeq.current = lastSeqOf(next);
      shownRef.current = next;
      setShown(next);
    }
    skipping.current = false;
    busy.current = false;
  };

  useEffect(() => {
    if (!view) {
      queue.current = [];
      shownRef.current = undefined;
      setShown(undefined);
      return;
    }
    queue.current.push(view);
    void pump();
    // pump reads refs only, so it does not need to be a dependency
  }, [view]);

  return {
    shown,
    step,
    skip: () => {
      skipping.current = true;
      setStep(undefined);
      wake.current();
    },
    next: () => wake.current(),
  };
}

/** Whether the player asked their system for less motion. */
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Centre of the first element matching a selector, or undefined when it is not on the page. */
function centreOf(selector: string): { x: number; y: number } | undefined {
  const el = document.querySelector(selector);
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** The spotlight for the step playing now, with seat pulses and bonus numbers. Tap to skip. */
export function PlaybackOverlay({ step, speed, onSkip, onNext }: { step: Step | undefined; speed: Speed; onSkip: () => void; onNext: () => void }) {
  const cards = useRef<HTMLDivElement>(null);
  const [bonusAt, setBonusAt] = useState<{ x: number; y: number }>();

  // pulse the seats involved, then send each card to its zone; positions are read before the board changes
  useLayoutEffect(() => {
    if (!step) return;
    const els = step.seats.map((s) => document.querySelector(zone(`seat-${s}`))).filter((el): el is Element => !!el);
    els.forEach((el) => el.classList.add('pulse'));
    setBonusAt(step.bonus && centreOf(zone(`seat-${step.bonus.seat}`)));
    const { spotlightMs, flightMs } = TIMING[speed];
    // the swish as cards leave for their zones
    if (step.cards.some((c) => c.to)) sfx('whoosh', (spotlightMs - flightMs) / 1000);
    if (cards.current && !reducedMotion()) {
      cards.current.querySelectorAll<HTMLElement>('.spot-card').forEach((el, i) => {
        const to = step.cards[i]?.to;
        const end = to && centreOf(to);
        if (!end) return;
        const r = el.getBoundingClientRect();
        const dx = end.x - (r.left + r.width / 2);
        const dy = end.y - (r.top + r.height / 2);
        el.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(0.25)`, opacity: 0.4 }], {
          duration: flightMs,
          delay: spotlightMs - flightMs,
          easing: 'cubic-bezier(.5,0,.7,.4)',
          fill: 'forwards',
        });
      });
    }
    return () => els.forEach((el) => el.classList.remove('pulse'));
    // speed is read when a step starts; changing it mid-step does not restart the step
  }, [step]);

  if (!step) return null;
  return (
    <div className="playback" onClick={step.standings ? undefined : onSkip}>
      <div key={step.key} className="spotlight" role="status">
        {step.standings ? (
          <div className="standings">
            <h2>{step.line}</h2>
            <table>
              <thead>
                <tr>
                  <th />
                  <th>This round</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {step.standings.map((r, i) => (
                  <tr key={r.seat}>
                    <td>
                      {i === 0 && <i className="ri-trophy-line" />} {r.name}
                    </td>
                    <td>{r.round}</td>
                    <td>
                      <b>{r.total}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="primary" onClick={onNext}>
              {step.goOn}
            </button>
          </div>
        ) : step.flip ? (
          <div ref={cards} className={`spot-cards flip-row ${step.cards.length === 1 ? 'single' : ''}`}>
            {step.cards.map((c, i) => (
              <div
                key={i}
                className="flip-card spot-card"
                style={{ '--flip-ms': `${TIMING[speed].flipMs}ms`, '--flip-delay': `${(c.seatOrder ?? 0) * TIMING[speed].flipStaggerMs}ms` } as React.CSSProperties}
              >
                <div className="flip-inner">
                  <div className="flip-back">
                    <CardBack deck={c.back ?? 'main'} />
                  </div>
                  <div className="flip-front">
                    <Card id={c.id} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : step.cards.length > 0 ? (
          <div ref={cards} className="spot-cards">
            {step.cards.map((c, i) => (
              <div key={i} className="spot-card">
                <Card id={c.id} />
              </div>
            ))}
          </div>
        ) : (
          <i className={`spot-icon ${step.icon}`} />
        )}
        {!step.standings && (
          <p className="spot-line">
            {step.cards.length > 0 && <i className={step.icon} />} {step.line}
          </p>
        )}
      </div>
      {step.bonus && bonusAt && (
        <div key={`bonus-${step.key}`} className="bonus-float" style={{ left: bonusAt.x, top: bonusAt.y }}>
          +{step.bonus.points}
        </div>
      )}
      {!step.standings && <span className="skip-hint">tap to skip</span>}
    </div>
  );
}
