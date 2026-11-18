// Your hand and the play zone: hold a card to pick it up and see it large, drag it onto the zone to play it.

import { useEffect, useRef, useState } from 'react';
import type { GameView } from '../../shared/protocol.js';
import { Card, CardPreview, HOLD_MS, STILL_PX, cardName, usePreview } from './cards.js';
import { t } from './i18n.js';
import { sfx } from './sound.js';

/** A mouse drag starts after this many px; touch needs a hold first so the page can still scroll. */
const MOUSE_DRAG_PX = 4;

interface Drag {
  uid: string;
  id: string;
  pointerId: number;
  isTouch: boolean;
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** held still long enough: picked up, preview showing */
  held: boolean;
  /** moving with the pointer */
  dragging: boolean;
  /** size of the card in the hand, so the dragged card keeps it */
  width: number;
  height: number;
  timer: number;
}

/** Hand cards with drag-and-hold onto a play zone; tap-to-select plus a Play button still works. */
export function Hand({ view, showCombos, onPlay }: { view: GameView; showCombos: boolean; onPlay: (uids: string[]) => void }) {
  const preview = usePreview();
  const [staged, setStaged] = useState<string[]>([]);
  const [drag, setDrag] = useState<Drag>();
  const [overZone, setOverZone] = useState(false);
  const dragRef = useRef<Drag>(undefined);
  const zoneRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  /** whether the last press was a finger, so its tap opens the card large first (Bored's choice, 2026-11-18) */
  const touchPress = useRef(false);
  /** the hand card opened large by a tap: tapping it again plays it */
  const [peek, setPeek] = useState<{ uid: string; id: string }>();

  const need = Math.min(view.picksRequired, view.hand.length);
  const picking = view.stage === 'pick' && !view.picked;

  // a new turn or a new hand clears anything half-staged
  const handKey = view.hand.map((c) => c.uid).join();
  useEffect(() => {
    setStaged([]);
    setPeek(undefined);
  }, [handKey, view.turn]);

  /** Adds a card to the zone and plays as soon as the zone is full. */
  const stage = (uid: string) => {
    const next = staged.includes(uid) ? staged : need === 1 ? [uid] : [...staged, uid].slice(0, need);
    setStaged(next);
    if (next.length === need) play(next);
    else sfx('drop');
  };

  const play = (uids: string[]) => {
    sfx('play');
    onPlay(uids);
  };

  /** Tap: toggle a card in or out of the zone without playing. */
  const toggle = (uid: string) => {
    sfx('tap');
    setStaged((s) => (s.includes(uid) ? s.filter((x) => x !== uid) : need === 1 ? [uid] : s.length < need ? [...s, uid] : s));
  };

  const isOverZone = (x: number, y: number) => {
    const r = zoneRef.current?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  const update = (d: Drag | undefined) => {
    dragRef.current = d;
    setDrag(d && { ...d });
  };

  // window listeners follow the pointer outside the card; touchmove is cancelled so a held card does not scroll the page
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
      if (!d.dragging) {
        if (d.isTouch && !d.held) {
          // moved before the hold finished: the finger is scrolling, not picking up
          if (dist > STILL_PX) {
            clearTimeout(d.timer);
            update(undefined);
          }
          return;
        }
        if (!picking || dist <= (d.isTouch ? STILL_PX : MOUSE_DRAG_PX)) return;
        clearTimeout(d.timer);
        d.dragging = true;
        if (!d.held) sfx('pickup');
        preview(undefined);
      }
      d.x = e.clientX;
      d.y = e.clientY;
      setOverZone(isOverZone(d.x, d.y));
      update(d);
    };
    const up = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      clearTimeout(d.timer);
      if (d.dragging || d.held) suppressClick.current = true;
      if (d.dragging && isOverZone(e.clientX, e.clientY)) stage(d.uid);
      else if (d.dragging) sfx('cancel');
      setOverZone(false);
      update(undefined);
    };
    const blockScroll = (e: TouchEvent) => {
      if (dragRef.current?.held || dragRef.current?.dragging) e.preventDefault();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('touchmove', blockScroll, { passive: false });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('touchmove', blockScroll);
    };
    // listeners are re-bound when a drag starts or ends; positions are read from dragRef
  }, [!!drag, staged, need, picking]);

  /** Starts watching a press on a hand card: a hold picks it up, a move drags it. */
  const press = (uid: string, id: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    suppressClick.current = false;
    touchPress.current = e.pointerType !== 'mouse';
    const d: Drag = {
      uid,
      id,
      pointerId: e.pointerId,
      isTouch: e.pointerType !== 'mouse',
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      held: false,
      dragging: false,
      timer: 0,
      width: e.currentTarget.getBoundingClientRect().width,
      height: e.currentTarget.getBoundingClientRect().height,
    };
    d.timer = window.setTimeout(() => {
      const cur = dragRef.current;
      if (cur !== d || cur.dragging) return;
      cur.held = true;
      navigator.vibrate?.(10);
      sfx('pickup');
      // a mouse sees keywords by hovering, so only touch opens the big preview
      if (cur.isTouch) preview(cur.id);
      update(cur);
    }, HOLD_MS);
    update(d);
  };

  /** Tap on a hand card, ignored right after a hold or a drag. A finger's tap opens the card large; a mouse click picks it. */
  const tap = (uid: string, id: string) => () => {
    if (suppressClick.current) return void (suppressClick.current = false);
    if (touchPress.current) setPeek({ uid, id });
    else if (picking) toggle(uid);
  };

  /** The tapped card goes to the play zone, and is played once the zone is full. */
  const playPeeked = () => {
    if (!peek) return;
    setPeek(undefined);
    if (picking && !staged.includes(peek.uid)) stage(peek.uid);
  };

  // a played card leaves the hand at once and waits in the zone until everyone reveals
  const inZone = view.hand.filter((c) => (view.picked ?? staged).includes(c.uid));
  const inHand = view.hand.filter((c) => !view.picked?.includes(c.uid));
  const dragging = drag?.dragging ? drag : undefined;

  return (
    <section className="hand">
      {(picking || (view.stage === 'pick' && !!view.picked)) && (
        <div ref={zoneRef} className={`play-zone ${dragging ? 'armed' : ''} ${overZone ? 'over' : ''} ${!dragging && !inZone.length ? 'waiting' : ''}`}>
          {inZone.length ? (
            inZone.map((c) => <Card key={c.uid} id={c.id} small onClick={picking ? () => toggle(c.uid) : undefined} />)
          ) : (
            <span className="muted">
              {window.matchMedia('(pointer: coarse)').matches ? (
                <>
                  <i className="ri-hand" /> {need === 1 ? t('Tap a card twice to play it') : t('Tap {n} cards twice to play them', { n: need })}
                </>
              ) : (
                <>
                  <i className="ri-drag-move-2-line" /> {need === 1 ? t('Drag a card here to play it') : t('Drag {n} cards here to play them', { n: need })}
                </>
              )}
            </span>
          )}
          {picking && need > 1 && (
            <span className="zone-count">
              {inZone.length}/{need}
            </span>
          )}
        </div>
      )}
      {/* what to do now is in the status bar at the top */}
      <h2>{t('Your hand')}</h2>
      {/* a new hand each turn slides in from the neighbour it came from: passing left, it comes from the right */}
      <div
        key={`${view.round}-${view.turn}`}
        className={`hand-cards ${view.turn > 1 ? `from-${view.passDirection === 'left' ? 'right' : 'left'}` : ''}`}
        data-zone="hand"
        style={{ '--n': Math.max(inHand.length, 1) } as React.CSSProperties}
      >
        {inHand.map((c) => (
          <Card
            key={c.uid}
            uid={c.uid}
            id={c.id}
            selected={staged.includes(c.uid)}
            dim={!picking || dragging?.uid === c.uid}
            combo={showCombos && picking && view.comboCards.includes(c.uid)}
            metaPoints={picking ? view.metaGains[c.uid] : undefined}
            lifted={drag?.uid === c.uid && drag.held && !drag.dragging}
            onPointerDown={press(c.uid, c.id)}
            onClick={tap(c.uid, c.id)}
          />
        ))}
      </div>
      {picking && staged.length > 0 && staged.length < need && <p className="muted">{t('{n} more to go', { n: need - staged.length })}</p>}
      {picking && need > 0 && staged.length === need && (
        <button className="primary play" onClick={() => play(staged)}>
          {need === 1 ? t('Play {card}', { card: cardName(view.hand.find((c) => c.uid === staged[0])?.id ?? '') }) : t('Play {n} cards', { n: need })}
        </button>
      )}
      {peek && (
        <CardPreview id={peek.id} onClose={() => setPeek(undefined)} onCard={picking ? playPeeked : undefined}>
          {picking && !staged.includes(peek.uid) && (
            <button className="primary" onClick={(e) => (e.stopPropagation(), playPeeked())}>
              {need - staged.length === 1 ? t('Play {card}', { card: cardName(peek.id) }) : t('Add {card} ({n} more to go)', { card: cardName(peek.id), n: need - staged.length - 1 })}
            </button>
          )}
          <span className="preview-hint">{picking ? t('Tap the card again to play it · tap outside to close') : t('Tap anywhere to close')}</span>
        </CardPreview>
      )}
      {dragging && (
        <div className="drag-ghost" style={{ left: dragging.x, top: dragging.y, width: dragging.width, height: dragging.height }}>
          <Card id={dragging.id} />
        </div>
      )}
    </section>
  );
}
