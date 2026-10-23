// Your hand and the play zone: hold a card to pick it up and see it large, drag it onto the zone to play it.

import { useEffect, useRef, useState } from 'react';
import type { GameView } from '../../shared/protocol.js';
import { Card, HOLD_MS, STILL_PX, cardName, usePreview } from './cards.js';

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
  timer: number;
}

/** Hand cards with drag-and-hold onto a play zone; tap-to-select plus a Play button still works. */
export function Hand({ view, onPlay }: { view: GameView; onPlay: (uids: string[]) => void }) {
  const preview = usePreview();
  const [staged, setStaged] = useState<string[]>([]);
  const [drag, setDrag] = useState<Drag>();
  const [overZone, setOverZone] = useState(false);
  const dragRef = useRef<Drag>(undefined);
  const zoneRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);

  const need = Math.min(view.picksRequired, view.hand.length);
  const picking = view.stage === 'pick' && !view.picked;

  // a new turn or a new hand clears anything half-staged
  const handKey = view.hand.map((c) => c.uid).join();
  useEffect(() => setStaged([]), [handKey, view.turn]);

  /** Adds a card to the zone and plays as soon as the zone is full. */
  const stage = (uid: string) => {
    const next = staged.includes(uid) ? staged : need === 1 ? [uid] : [...staged, uid].slice(0, need);
    setStaged(next);
    if (next.length === need) onPlay(next);
  };

  /** Tap: toggle a card in or out of the zone without playing. */
  const toggle = (uid: string) => setStaged((s) => (s.includes(uid) ? s.filter((x) => x !== uid) : need === 1 ? [uid] : s.length < need ? [...s, uid] : s));

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
    };
    d.timer = window.setTimeout(() => {
      const cur = dragRef.current;
      if (cur !== d || cur.dragging) return;
      cur.held = true;
      navigator.vibrate?.(10);
      // a mouse sees keywords by hovering, so only touch opens the big preview
      if (cur.isTouch) preview(cur.id);
      update(cur);
    }, HOLD_MS);
    update(d);
  };

  /** Tap on a hand card, ignored right after a hold or a drag. */
  const tap = (uid: string) => () => {
    if (suppressClick.current) return void (suppressClick.current = false);
    if (picking) toggle(uid);
  };

  const inZone = view.hand.filter((c) => staged.includes(c.uid));
  const dragging = drag?.dragging ? drag : undefined;

  return (
    <section className="hand">
      {picking && (
        <div ref={zoneRef} className={`play-zone ${dragging ? 'armed' : ''} ${overZone ? 'over' : ''}`}>
          {inZone.length ? (
            inZone.map((c) => <Card key={c.uid} id={c.id} small onClick={() => toggle(c.uid)} />)
          ) : (
            <span className="muted">
              <i className="ri-drag-move-2-line" /> {need === 1 ? 'Drag a card here to play it' : `Drag ${need} cards here to play them`}
            </span>
          )}
          {need > 1 && (
            <span className="zone-count">
              {inZone.length}/{need}
            </span>
          )}
        </div>
      )}
      {/* what to do now is in the status bar at the top */}
      <h2>Your hand</h2>
      <div className="hand-cards" data-zone="hand">
        {view.hand.map((c) => (
          <Card
            key={c.uid}
            uid={c.uid}
            id={c.id}
            selected={staged.includes(c.uid) || !!view.picked?.includes(c.uid)}
            dim={(!picking && !view.picked?.includes(c.uid)) || dragging?.uid === c.uid}
            lifted={drag?.uid === c.uid && drag.held && !drag.dragging}
            onPointerDown={press(c.uid, c.id)}
            onClick={tap(c.uid)}
          />
        ))}
      </div>
      {picking && staged.length > 0 && staged.length < need && <p className="muted">{need - staged.length} more to go</p>}
      {picking && need > 0 && staged.length === need && (
        <button className="primary play" onClick={() => onPlay(staged)}>
          Play {need === 1 ? cardName(view.hand.find((c) => c.uid === staged[0])?.id ?? '') : `${need} cards`}
        </button>
      )}
      {dragging && (
        <div className="drag-ghost" style={{ left: dragging.x, top: dragging.y }}>
          <Card id={dragging.id} />
        </div>
      )}
    </section>
  );
}
