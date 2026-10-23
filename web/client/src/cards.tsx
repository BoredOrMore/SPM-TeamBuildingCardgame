// Card faces and the text helpers that name cards, decisions and events.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import cardsJson from '../../../data/cards.json';
import keywordsJson from '../../../data/keywords.json';
import type { CardDef, CardInstance, CardsFile, Choice, GameEvent } from '../../../src/index.js';
import type { DecisionView, GameView } from '../../shared/protocol.js';

const cards = cardsJson as unknown as CardsFile;
type Deck = keyof CardsFile['decks'];

/** Every card definition by id, with the deck it comes from. */
const CARD_DEFS = new Map<string, CardDef & { deck: Deck }>();
for (const deck of Object.keys(cards.decks) as Deck[]) for (const c of cards.decks[deck]) CARD_DEFS.set(c.id, { ...c, deck });

interface IconCode {
  code: string;
  icon: string;
  reminder?: string;
  meaning?: string;
  /** card type whose frame colour tints this icon's chip; keywords have none */
  chip?: string;
}
const ICONS = new Map<string, IconCode>([...keywordsJson.keywords, ...keywordsJson.icons].map((k) => [k.code, k as IconCode]));
const FRAME_COLORS = keywordsJson.frameColors as Record<string, string>;
const ICON_INK = keywordsJson.iconInk;

/** An icon in ink; one that stands for a card sits on a round chip tinted with that card type's frame colour. */
function Icon({ code, className = '' }: { code: IconCode; className?: string }) {
  const icon = <i className={`ri-${code.icon}-line ${className}`} aria-label={code.code} />;
  if (!code.chip) return icon;
  return (
    <span className="chip" style={{ '--chip': FRAME_COLORS[code.chip] ?? ICON_INK } as React.CSSProperties}>
      {icon}
    </span>
  );
}

/** Display name of a card id. */
export function cardName(id: string): string {
  return CARD_DEFS.get(id)?.name ?? id;
}

/** Frame colour of a card: its type, or its deck for Crisis and Meta. */
function frameColor(def: (CardDef & { deck: Deck }) | undefined): string {
  if (!def) return '#888';
  return FRAME_COLORS[def.type ?? def.deck] ?? FRAME_COLORS.meta ?? '#888';
}

/** Card text with every {CODE} drawn as its icon. */
export function CardText({ text }: { text: string }) {
  const parts = text.split(/(\{[A-Z]+\})/);
  return (
    <>
      {parts.map((part, i) => {
        const icon = ICONS.get(part.slice(1, -1));
        if (!part.startsWith('{') || !icon) return <span key={i}>{part}</span>;
        return <Icon key={i} code={icon} className="kw" />;
      })}
    </>
  );
}

/** How long a press must last to count as a hold. */
export const HOLD_MS = 350;
/** How far a pointer may wander, in px, and still count as holding still. */
export const STILL_PX = 8;

/** Opens the big preview of a card; set by PreviewProvider. */
const PreviewContext = createContext<(id: string | undefined) => void>(() => {});
/** Shows or hides the hover tooltip beside a card; set by PreviewProvider. */
const TooltipContext = createContext<(tip: Tip | undefined) => void>(() => {});

interface Tip {
  id: string;
  rect: DOMRect;
}

/** Opens or closes the big card preview (touch hold). */
export const usePreview = () => useContext(PreviewContext);

/** Gap in px between a card and its tooltip, and the tooltip's width. */
const TIP_GAP = 8;
const TIP_WIDTH = 220;

/** Hosts the hover tooltip (mouse) and the big preview (touch hold) for every card on screen. */
export function PreviewProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<string>();
  const [tip, setTip] = useState<Tip>();
  useEffect(() => {
    if (!tip) return;
    // the tooltip is placed from the card's position when hovered, so scrolling would leave it behind
    const close = () => setTip(undefined);
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [tip]);
  useEffect(() => {
    if (!id) return;
    const close = () => setId(undefined);
    window.addEventListener('pointerup', close);
    window.addEventListener('pointercancel', close);
    return () => {
      window.removeEventListener('pointerup', close);
      window.removeEventListener('pointercancel', close);
    };
  }, [id]);
  return (
    <PreviewContext.Provider value={setId}>
      <TooltipContext.Provider value={setTip}>
        {children}
        {tip && <CardTooltip tip={tip} />}
        {id && <CardPreview id={id} />}
      </TooltipContext.Provider>
    </PreviewContext.Provider>
  );
}

/** Keyword and icon codes on a card, in order of first use. */
function codesOf(id: string): IconCode[] {
  const text = CARD_DEFS.get(id)?.cardText ?? '';
  const codes = [...new Set([...text.matchAll(/\{([A-Z]+)\}/g)].map((m) => m[1]!))];
  return codes.map((c) => ICONS.get(c)).filter((k): k is IconCode => !!k);
}

/** One box per keyword: icon, name, and what it means. */
function KeywordBoxes({ id }: { id: string }) {
  return (
    <>
      {codesOf(id).map((k) => (
        <div key={k.code} className="kw-box" style={{ '--box': k.chip ? (FRAME_COLORS[k.chip] ?? ICON_INK) : ICON_INK } as React.CSSProperties}>
          {/* keywords show their name and rule; icons (roles, events) are named by what they stand for */}
          <div className="kw-title">
            <Icon code={k} /> {k.reminder ? k.code.charAt(0) + k.code.slice(1).toLowerCase() : k.meaning}
          </div>
          {k.reminder && <div className="kw-text">{k.reminder}</div>}
        </div>
      ))}
    </>
  );
}

/** Keyword boxes beside the hovered card: on its right, or its left when there is no room. */
function CardTooltip({ tip }: { tip: Tip }) {
  if (!codesOf(tip.id).length) return null;
  const right = tip.rect.right + TIP_GAP + TIP_WIDTH <= window.innerWidth;
  const left = right ? tip.rect.right + TIP_GAP : Math.max(TIP_GAP, tip.rect.left - TIP_GAP - TIP_WIDTH);
  return (
    <div className="card-tooltip" role="tooltip" style={{ left, top: tip.rect.top, width: TIP_WIDTH }}>
      <KeywordBoxes id={tip.id} />
    </div>
  );
}

/** The big card and its keyword boxes, shown while a card is held on a touch screen. */
function CardPreview({ id }: { id: string }) {
  const def = CARD_DEFS.get(id);
  return (
    <div className="preview" aria-live="polite">
      <div className="preview-card" style={{ '--frame': frameColor(def) } as React.CSSProperties}>
        <CardFace id={id} />
      </div>
      {codesOf(id).length > 0 && (
        <div className="preview-keywords">
          <KeywordBoxes id={id} />
        </div>
      )}
    </div>
  );
}

/** Name bar and text of a card, without any behaviour. */
function CardFace({ id, small, shield }: { id: string; small?: boolean; shield?: boolean }) {
  const def = CARD_DEFS.get(id);
  return (
    <>
      <span className="card-name">
        {def?.name ?? id}
        {shield && <i className="ri-shield-line" aria-label="protected" />}
      </span>
      {!small && <span className="card-text">{def?.cardText ? <CardText text={def.cardText} /> : def?.text}</span>}
    </>
  );
}

/**
 * One card face. With a mouse, hovering shows its keyword tooltip; on touch, holding it still
 * opens the big preview, unless `onPointerDown` is given: then the caller owns the press (the hand uses this for drag-and-hold).
 */
export function Card(props: {
  id: string;
  selected?: boolean;
  dim?: boolean;
  small?: boolean;
  shield?: boolean;
  lifted?: boolean;
  onClick?: () => void;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const preview = usePreview();
  const tooltip = useContext(TooltipContext);
  const hovered = useRef(false);
  // a card that leaves the table while hovered (played, taken) never gets pointerleave
  useEffect(() => () => void (hovered.current && tooltip(undefined)), [tooltip]);
  const hold = useRef<{ timer: number; x: number; y: number; fired: boolean }>(undefined);
  const def = CARD_DEFS.get(props.id);
  const classes = ['card', props.small && 'small', props.selected && 'selected', props.dim && 'dim', props.lifted && 'lifted', props.onClick && 'clickable']
    .filter(Boolean)
    .join(' ');

  const cancelHold = () => {
    if (hold.current) clearTimeout(hold.current.timer);
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    tooltip(undefined);
    if (props.onPointerDown) return props.onPointerDown(e);
    cancelHold();
    if (e.pointerType === 'mouse') return;
    const h = { x: e.clientX, y: e.clientY, fired: false, timer: 0 };
    h.timer = window.setTimeout(() => {
      h.fired = true;
      preview(props.id);
    }, HOLD_MS);
    hold.current = h;
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const h = hold.current;
    if (h && !h.fired && Math.hypot(e.clientX - h.x, e.clientY - h.y) > STILL_PX) cancelHold();
  };

  return (
    <div
      role={props.onClick ? 'button' : undefined}
      tabIndex={props.onClick ? 0 : undefined}
      className={classes}
      style={{ '--frame': frameColor(def) } as React.CSSProperties}
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse' || e.buttons !== 0) return;
        hovered.current = true;
        tooltip({ id: props.id, rect: e.currentTarget.getBoundingClientRect() });
      }}
      onPointerLeave={() => {
        hovered.current = false;
        tooltip(undefined);
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        // a hold that opened the preview is not also a tap
        if (hold.current?.fired) return void (hold.current = undefined);
        props.onClick?.();
      }}
      onKeyDown={(e) => {
        if (props.onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          props.onClick();
        }
      }}
    >
      <CardFace id={props.id} small={props.small} shield={props.shield} />
    </div>
  );
}

/** The card id behind a uid anywhere on the table you can see. */
export function idOfUid(view: GameView, uid: string): string {
  const all: CardInstance[] = [...view.hand, ...view.discard, ...view.visibleCrisis, ...view.players.flatMap((p) => [...p.team, ...p.revealed])];
  return all.find((c) => c.uid === uid)?.id ?? uid;
}

const DECISION_TITLES: Record<DecisionView['kind'], string> = {
  headhunt: 'Headhunt: swap one of your cards for one of theirs',
  phone_screen: 'Phone Screen: look at a player’s hand',
  refactor: 'Refactor: choose how to clean up',
  nda: 'NDA: protect one card',
  burnout: 'Burnout: discard one employee',
  layoff: 'Layoff: discard',
  poaching: 'Poaching: take a card',
  hostile_takeover: 'Hostile Takeover: take a card',
  steal_best_card: 'Take a card',
  funding_round: 'Funding Round: choose',
  pivot_or_persevere: 'Pivot or Persevere',
  merger_propose: 'Merger: propose a swap',
  merger_respond: 'Merger: accept the offer?',
};

/** Heading for a decision. */
export function decisionTitle(d: DecisionView): string {
  return DECISION_TITLES[d.kind] ?? d.kind;
}

/** One-line label for a decision option. */
export function choiceLabel(view: GameView, c: Choice): string {
  const name = (uid: string) => cardName(idOfUid(view, uid));
  const who = (seat: number) => view.players[seat]?.name ?? `Seat ${seat + 1}`;
  switch (c.kind) {
    case 'headhunt':
      return `Give ${name(c.give)}, take ${name(c.take)} from ${who(c.opponent)}`;
    case 'phone_screen':
      return `Look at ${who(c.opponent)}’s hand`;
    case 'refactor':
      return { bug_to_qa: 'Turn a Bug into a QA Tester', juniors_to_senior: 'Turn Juniors into a Senior', points: 'Take the points' }[c.mode];
    case 'nda':
      return `Protect ${name(c.protect)}`;
    case 'discard':
      return `Discard ${name(c.uid)}`;
    case 'take':
      return `Take ${name(c.uid)} from ${who(c.opponent)}`;
    case 'give':
      return `Give ${c.uids.map(name).join(', ')} to ${who(c.to)}`;
    case 'take_discard':
      return `Take ${name(c.uid)} from the discard pile`;
    case 'draw_main':
      return 'Draw from the deck';
    case 'persevere':
      return 'Persevere: keep your team';
    case 'pivot':
      return c.discard.length ? `Pivot: discard ${c.discard.map(name).join(', ')}` : 'Pivot';
    case 'merger_decline':
      return 'No merger';
    case 'merger_offer':
      return `Offer ${name(c.give)} to ${who(c.target)} for ${name(c.take)}`;
    case 'merger_accept':
      return 'Accept';
    case 'merger_reject':
      return 'Reject';
  }
}

/** One line for the play log, or undefined for events not worth showing. */
export function eventLine(view: GameView, e: GameEvent): string | undefined {
  const who = (seat: unknown) => (seat === view.you ? 'You' : (view.players[seat as number]?.name ?? '?'));
  const card = (c: unknown) => cardName((c as CardInstance).id);
  switch (e.type) {
    case 'turn_started':
      return `Turn ${e.turn} starts: pick ${e.picksRequired} card(s)`;
    case 'card_gained':
      return `${who(e.player)} added ${card(e.card)}`;
    case 'card_stolen':
      return `${who(e.to)} took ${card(e.card)} from ${who(e.from)}`;
    case 'card_given':
      return `${who(e.from)} gave ${card(e.card)} to ${who(e.to)}`;
    case 'card_discarded':
      return `${who(e.player)} discarded ${card(e.card)}`;
    case 'card_protected':
      return `${who(e.player)} protected a card`;
    case 'cards_swapped': {
      const [a, b] = e.players as number[];
      const [x, y] = e.cards as CardInstance[];
      return `${who(a)} swapped ${card(x)} for ${who(b)}’s ${card(y)}`;
    }
    case 'bonus_gained':
      return `${who(e.player)} gained ${e.points} point(s) from ${cardName(String(e.source))}`;
    case 'crisis_drawn':
      return `Crisis: ${card(e.card)}`;
    case 'crisis_previewed':
      return `Next crisis: ${card(e.card)}`;
    case 'hands_passed':
      return `Everyone passed their hand ${e.direction}`;
    case 'hands_swapped':
      return `${who((e.players as number[])[0])} and ${who((e.players as number[])[1])} swapped hands`;
    case 'hand_revealed':
      return `${who(e.player)}’s hand: ${(e.cards as CardInstance[]).map(card).join(', ')}`;
    case 'private_meta_dealt':
      return `Your secret goal: ${(e.meta as string[]).map(cardName).join(', ')}`;
    case 'no_effect':
      return `${cardName(String(e.source))} had no effect`;
    case 'game_ended':
      return 'Game over';
    default:
      return undefined;
  }
}
