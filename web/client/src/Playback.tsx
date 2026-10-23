// Plays the game's events one step at a time before the board changes, so every move is seen:
// a banner says what happened and moved cards fly from where they were to where they go.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CardInstance, GameEvent } from '../../../src/index.js';
import type { GameView, View } from '../../shared/protocol.js';
import { Card, eventLine } from './cards.js';

/** How long one step stays on screen, by kind. */
const STEP_MS = { flight: 1100, banner: 1300, quick: 700 };
/** How long a card takes to fly. */
const FLIGHT_MS = 650;
/** Events that change nothing a player needs to watch. */
const SILENT = new Set(['card_picked', 'teams_updated', 'decision_made', 'game_started', 'game_ended', 'private_meta_dealt']);

type SeqEvent = GameEvent & { seq: number };

interface Flight {
  id: string;
  /** a card element (data-uid) or a zone (data-zone) to start from */
  from: string;
  to: string;
}

export interface Step {
  key: number;
  lines: string[];
  icon: string;
  flights: Flight[];
  /** seats whose area pulses */
  seats: number[];
  /** floating "+N" by a seat */
  bonus?: { seat: number; points: number };
  ms: number;
}

const byUid = (uid: string) => `[data-uid="${uid}"]`;
const zone = (name: string) => `[data-zone="${name}"]`;

/** Where a card someone just gained comes from: your own hand card, else that player's area. */
const gainSource = (view: GameView, seat: number, card: CardInstance) =>
  seat === view.you && view.hand.some((c) => c.uid === card.uid) ? byUid(card.uid) : zone(`seat-${seat}`);

/** The banner icon, flights and pulses for one event. */
function stepFor(view: GameView, e: SeqEvent): Omit<Step, 'key' | 'lines' | 'ms'> & { kind: keyof typeof STEP_MS } {
  const card = e.card as CardInstance | undefined;
  switch (e.type) {
    case 'cards_revealed': {
      const reveals = e.cards as Array<{ player: number; cards: CardInstance[] }>;
      return {
        kind: 'flight',
        icon: 'ri-eye-line',
        seats: reveals.map((r) => r.player),
        flights: reveals.flatMap((r) => r.cards.map((c) => ({ id: c.id, from: gainSource(view, r.player, c), to: zone(`team-${r.player}`) }))),
      };
    }
    case 'card_gained':
      return { kind: 'flight', icon: 'ri-user-add-line', seats: [e.player as number], flights: [{ id: card!.id, from: gainSource(view, e.player as number, card!), to: zone(`team-${e.player}`) }] };
    case 'card_stolen':
      return { kind: 'flight', icon: 'ri-user-received-line', seats: [e.from as number, e.to as number], flights: [{ id: card!.id, from: byUid(card!.uid), to: zone(`team-${e.to}`) }] };
    case 'card_given':
      return { kind: 'flight', icon: 'ri-hand-heart-line', seats: [e.from as number, e.to as number], flights: [{ id: card!.id, from: byUid(card!.uid), to: zone(`team-${e.to}`) }] };
    case 'cards_swapped': {
      const [a, b] = e.players as number[];
      const [x, y] = e.cards as CardInstance[];
      return {
        kind: 'flight',
        icon: 'ri-arrow-left-right-line',
        seats: [a!, b!],
        flights: [
          { id: x!.id, from: byUid(x!.uid), to: zone(`team-${b}`) },
          { id: y!.id, from: byUid(y!.uid), to: zone(`team-${a}`) },
        ],
      };
    }
    case 'card_discarded':
      return { kind: 'flight', icon: 'ri-delete-bin-line', seats: [e.player as number], flights: [{ id: card!.id, from: byUid(card!.uid), to: zone('deck') }] };
    case 'crisis_drawn':
      return { kind: 'flight', icon: 'ri-alarm-warning-line', seats: [], flights: [{ id: card!.id, from: zone('deck'), to: zone('crisis') }] };
    case 'crisis_previewed':
      return { kind: 'banner', icon: 'ri-eye-line', seats: [], flights: [] };
    case 'bonus_gained':
      return { kind: 'banner', icon: 'ri-coin-line', seats: [e.player as number], flights: [], bonus: { seat: e.player as number, points: e.points as number } };
    case 'card_protected':
      return { kind: 'quick', icon: 'ri-shield-line', seats: [e.player as number], flights: [] };
    case 'turn_started':
      return { kind: 'quick', icon: 'ri-time-line', seats: [], flights: [] };
    case 'hands_passed':
    case 'hands_swapped':
      return { kind: 'banner', icon: 'ri-repeat-line', seats: [], flights: [] };
    default:
      return { kind: 'quick', icon: 'ri-information-line', seats: [], flights: [] };
  }
}

/** Turns new events into steps; cards gained one after another play as one step. */
export function stepsFor(view: GameView, events: SeqEvent[]): Step[] {
  const steps: Step[] = [];
  for (const e of events) {
    if (SILENT.has(e.type)) continue;
    const line = eventLine(view, e);
    if (!line) continue;
    const lines = e.type === 'cards_revealed' ? line.split(' · ') : [line];
    const s = stepFor(view, e);
    const prev = steps[steps.length - 1];
    if (e.type === 'card_gained' && prev?.icon === s.icon) {
      prev.lines.push(...lines);
      prev.flights.push(...s.flights);
      prev.seats.push(...s.seats);
      continue;
    }
    steps.push({ key: e.seq, lines, icon: s.icon, flights: s.flights, seats: s.seats, bonus: s.bonus, ms: STEP_MS[s.kind] });
  }
  return steps;
}

/** Highest event seq in a view, or -1. */
const lastSeqOf = (view: GameView) => view.events.reduce((m, e) => Math.max(m, e.seq), -1);

/**
 * The view to draw and the step playing now. Incoming views wait in line: each one's new events
 * play over the previous board first, then the board catches up. `skip` jumps to the newest view.
 */
export function usePlayback(view: View | undefined): { shown: View | undefined; step: Step | undefined; skip: () => void } {
  const [shown, setShown] = useState(view);
  const [step, setStep] = useState<Step>();
  const queue = useRef<View[]>([]);
  const lastSeq = useRef(-1);
  const busy = useRef(false);
  const skipping = useRef(false);
  const shownRef = useRef(view);
  /** ends the step now playing early */
  const wake = useRef(() => {});

  /** Shows the next waiting view, after playing its new events. */
  const pump = async () => {
    if (busy.current) return;
    busy.current = true;
    while (queue.current.length) {
      const next = queue.current.shift()!;
      if (next.phase === 'game' && shownRef.current?.phase === 'game' && !skipping.current) {
        const fresh = next.events.filter((e) => e.seq > lastSeq.current);
        // labels and positions come from the board still on screen, where the cards are now
        for (const s of stepsFor(next, fresh)) {
          if (skipping.current) break;
          setStep(s);
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, reducedMotion() ? Math.min(s.ms, STEP_MS.quick) : s.ms);
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
  };
}

/** Whether the player asked their system for less motion. */
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Centre of the first element matching a selector, or undefined when it is not on screen. */
function centreOf(selector: string): { x: number; y: number } | undefined {
  const el = document.querySelector(selector);
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Banner, flying cards, seat pulses and bonus numbers for the step playing now. Tap to skip. */
export function PlaybackOverlay({ step, onSkip }: { step: Step | undefined; onSkip: () => void }) {
  const flights = useRef<HTMLDivElement>(null);
  const [bonusAt, setBonusAt] = useState<{ x: number; y: number }>();

  // pulse the seats involved; positions are read before the board changes
  useLayoutEffect(() => {
    if (!step) return;
    const els = step.seats.map((s) => document.querySelector(zone(`seat-${s}`))).filter((el): el is Element => !!el);
    els.forEach((el) => el.classList.add('pulse'));
    setBonusAt(step.bonus && centreOf(zone(`seat-${step.bonus.seat}`)));
    const host = flights.current;
    if (host && !reducedMotion()) {
      host.querySelectorAll<HTMLElement>('.flight').forEach((el, i) => {
        const f = step.flights[i];
        const from = f && centreOf(f.from);
        const to = f && centreOf(f.to);
        if (!from || !to) return void (el.style.display = 'none');
        el.animate(
          [
            { transform: `translate(${from.x}px, ${from.y}px) translate(-50%, -50%) scale(1)`, opacity: 1 },
            { transform: `translate(${(from.x + to.x) / 2}px, ${Math.min(from.y, to.y) - 40}px) translate(-50%, -50%) scale(1.15)`, opacity: 1, offset: 0.5 },
            { transform: `translate(${to.x}px, ${to.y}px) translate(-50%, -50%) scale(0.8)`, opacity: 0.9 },
          ],
          { duration: FLIGHT_MS, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' },
        );
      });
    }
    return () => els.forEach((el) => el.classList.remove('pulse'));
  }, [step]);

  if (!step) return null;
  return (
    <div className="playback" onClick={onSkip}>
      <div ref={flights}>
        {step.flights.map((f, i) => (
          <div key={`${step.key}-${i}`} className="flight">
            <Card id={f.id} small />
          </div>
        ))}
      </div>
      {step.bonus && bonusAt && (
        <div key={step.key} className="bonus-float" style={{ left: bonusAt.x, top: bonusAt.y }}>
          +{step.bonus.points}
        </div>
      )}
      <div key={step.key} className="banner" role="status">
        <i className={step.icon} />
        <div>
          {step.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </div>
      <span className="skip-hint">tap to skip</span>
    </div>
  );
}
