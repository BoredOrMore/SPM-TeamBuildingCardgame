// Card faces and the text helpers that name cards, decisions and events.

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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

/** Decks that have a printed card back. */
export type BackDeck = 'main' | 'crisis' | 'meta';

/** Remix icon in the round badge of each deck's card back, as on the printed backs. */
const BACK_ICONS: Record<BackDeck, string> = { main: 'ri-stack-line', crisis: 'ri-alarm-warning-line', meta: 'ri-global-line' };
/** Card types whose frame colours make the stripe on the Main deck back. */
const MAIN_STRIPE = ['role', 'event', 'action', 'defense', 'boost'];

/** The back of a card from one deck: hides which card it is, only its deck shows. `mini` drops the badge for small rows. */
export function CardBack({ deck, mini = false }: { deck: BackDeck; mini?: boolean }) {
  const colour = deck === 'main' ? ICON_INK : FRAME_COLORS[deck];
  if (!colour) throw new Error(`No frame colour for the ${deck} deck`);
  return (
    <div className={`card-back ${mini ? 'mini' : ''}`} style={{ '--back': colour } as React.CSSProperties} aria-hidden="true">
      {!mini && (
        <>
          <span className="back-badge" style={deck === 'main' ? { boxShadow: `0 0 0 2px ${FRAME_COLORS.role}` } : undefined}>
            <i className={BACK_ICONS[deck]} />
          </span>
          {deck === 'main' && (
            <span className="back-stripe">
              {MAIN_STRIPE.map((t) => (
                <span key={t} style={{ background: FRAME_COLORS[t] }} />
              ))}
            </span>
          )}
        </>
      )}
    </div>
  );
}

/** Decks whose cards have art; the rest (rule card, turn tracker) are never shown as a card. */
const hasArt = (deck: Deck) => deck !== 'support';
/** Where a card's art lives, exported from Figma as `<card id>.webp`. */
export const artUrl = (id: string) => `${import.meta.env.BASE_URL}cards/art/${id}.webp`;

/** Display name of a card id. */
export function cardName(id: string): string {
  return CARD_DEFS.get(id)?.name ?? id;
}

/** Whether a card comes from the Crisis deck. */
export function isCrisis(id: string): boolean {
  return CARD_DEFS.get(id)?.deck === 'crisis';
}

/** Whether a card is an Action card, which goes to the discard pile once played. */
export function isAction(id: string): boolean {
  return CARD_DEFS.get(id)?.type === 'action';
}

/** Frame colour of a card: its type, or its deck for Crisis and Meta. */
/** Type badge icons for cards that have no icon code of their own (CARD_SPEC.md, Type badge icon). */
const TYPE_BADGE_ICONS: Record<string, string> = { action: 'magic', defense: 'shield-check', boost: 'arrow-up-circle', crisis: 'alarm-warning', meta: 'global' };

/** The Remix icon name in a card's type badge: a Role or Event card's own icon code, otherwise its type's icon. */
function badgeIcon(def: CardDef & { deck: Deck }): string {
  const kind = def.type ?? def.deck;
  if (kind === 'role' || kind === 'event') {
    const own = [...ICONS.values()].find((k) => k.meaning === def.name);
    if (!own) throw new Error(`No icon code for ${def.type} card ${def.id}`);
    return own.icon;
  }
  const icon = TYPE_BADGE_ICONS[kind];
  if (!icon) throw new Error(`No type badge icon for ${def.id} (${kind})`);
  return icon;
}

/** The timing keyword in a card's top-right badge, from its data; none for Role and Event cards (CARD_SPEC.md, Timing). */
function timingCode(def: CardDef & { deck: Deck }): IconCode | undefined {
  const code =
    def.deck === 'meta' ? 'PAYDAY'
    : def.deck === 'crisis' ? (def.persistent ? 'ONGOING' : 'ONBOARD')
    : def.timing === 'on_reveal' ? 'ONBOARD'
    : def.timing === 'scoring' ? 'PAYDAY'
    : undefined;
  return code ? ICONS.get(code) : undefined;
}

function frameColor(def: (CardDef & { deck: Deck }) | undefined): string {
  if (!def) return '#888';
  return FRAME_COLORS[def.type ?? def.deck] ?? FRAME_COLORS.meta ?? '#888';
}

/** Card text with every {CODE} drawn as its icon. */
export function CardText({ text }: { text: string }) {
  return (
    <>
      {text.split(' · ').map((line, l) => (
        <span key={l} className="text-line">
          {line.split(/(\{[A-Z]+\})/).map((part, i) => {
            const icon = ICONS.get(part.slice(1, -1));
            if (part.startsWith('{') && icon) return <Icon key={i} code={icon} className="kw" />;
            return part.split(POINTS).map((bit, j) => (j % 2 ? <b key={`${i}-${j}`}>{bit}</b> : bit));
          })}
        </span>
      ))}
    </>
  );
}

/** How small a card's text may shrink, as a share of its normal size, and how much each try shrinks it. */
const MIN_TEXT_SCALE = 0.3;
const TEXT_SCALE_STEP = 0.05;

/**
 * The points in a card's text, shown bold so they stand apart from the conditions: signed numbers (+3, -2),
 * a value after "=" (= 0), and point tiers (2/5/12) but not count tiers (1/2/3+).
 */
const POINTS = /([+-]\d+|(?<== )-?\d+(?:\/\d+)*|\b\d+(?:\/\d+)+\b(?![+/\d]))/;

/** Shrinks a card's text until it fits the space the card leaves for it, so a card never grows to fit its words. */
function useFitText() {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      let scale = 1;
      el.style.setProperty('--fit', '1');
      // hidden text (a phone's hand) has no height to fit into
      while (el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1 && scale > MIN_TEXT_SCALE) {
        scale -= TEXT_SCALE_STEP;
        el.style.setProperty('--fit', String(scale));
      }
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    // the icon font and web fonts change how much room the text takes once they load
    let live = true;
    void document.fonts.ready.then(() => live && fit());
    return () => {
      live = false;
      watch.disconnect();
    };
  }, []);
  return ref;
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

/** Gap in px between a card and its tooltip, and between the tooltip and the window edge. */
const TIP_GAP = 12;
/** Smallest scale the tooltip shrinks to beside the card; below it, it may cover the card rather than shrink further. */
const TIP_MIN_SCALE = 0.6;

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

/** Keyword and icon codes on a card, in order of first use, then the timing in its top-right badge. */
function codesOf(id: string): IconCode[] {
  const def = CARD_DEFS.get(id);
  const text = def?.cardText ?? '';
  const codes = [...new Set([...text.matchAll(/\{([A-Z]+)\}/g)].map((m) => m[1]!))];
  const timing = def && def.deck !== 'support' ? timingCode(def) : undefined;
  return [...codes.map((c) => ICONS.get(c)).filter((k): k is IconCode => !!k), ...(timing ? [timing] : [])];
}

/** One box per keyword: icon, name, and what it means. */
function KeywordBoxes({ codes }: { codes: IconCode[] }) {
  return (
    <>
      {codes.map((k) => (
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

/** Every keyword and icon code with what it means, for the rulebook. */
export function IconGlossary() {
  return <KeywordBoxes codes={[...ICONS.values()]} />;
}

/** Where the tooltip goes and how much it shrinks so all of it is on screen. */
interface TipPlace {
  left: number;
  top: number;
  scale: number;
  flip: boolean;
}

/**
 * The hovered card at full size with its keyword boxes, on top of everything: on its right, or its left when there is more room,
 * shrunk to fit the window when it would not fit whole.
 */
function CardTooltip({ tip }: { tip: Tip }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<TipPlace>();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) throw new Error('Tooltip not rendered');
    // offset sizes ignore the scale transform, so this is the tooltip at full size
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const roomRight = window.innerWidth - tip.rect.right - 2 * TIP_GAP;
    const roomLeft = tip.rect.left - 2 * TIP_GAP;
    const flip = roomRight < width && roomLeft > roomRight;
    const fitHeight = (window.innerHeight - 2 * TIP_GAP) / height;
    const beside = Math.min(1, Math.max(roomRight, roomLeft) / width, fitHeight);
    const scale = beside >= TIP_MIN_SCALE ? beside : Math.min(1, (window.innerWidth - 2 * TIP_GAP) / width, fitHeight);
    const left = flip ? tip.rect.left - TIP_GAP - width * scale : tip.rect.right + TIP_GAP;
    setPlace({
      left: Math.max(TIP_GAP, Math.min(left, window.innerWidth - TIP_GAP - width * scale)),
      top: Math.max(TIP_GAP, Math.min(tip.rect.top, window.innerHeight - TIP_GAP - height * scale)),
      scale,
      flip,
    });
  }, [tip]);
  return (
    <div
      ref={ref}
      className={`card-tooltip ${place?.flip ? 'flip' : ''}`}
      role="tooltip"
      style={place ? { left: place.left, top: place.top, transform: `scale(${place.scale})` } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      <FullCard id={tip.id} />
      {codesOf(tip.id).length > 0 && (
        <div className="preview-keywords">
          <KeywordBoxes codes={codesOf(tip.id)} />
        </div>
      )}
    </div>
  );
}

/** A card face at full size, with no handlers of its own. */
function FullCard({ id }: { id: string }) {
  return (
    <div className="card preview-card" style={{ '--frame': frameColor(CARD_DEFS.get(id)) } as React.CSSProperties}>
      <CardFace id={id} />
    </div>
  );
}

/** The big card and its keyword boxes, shown while a card is held on a touch screen. */
function CardPreview({ id }: { id: string }) {
  return (
    <div className="preview" aria-live="polite">
      <FullCard id={id} />
      {codesOf(id).length > 0 && (
        <div className="preview-keywords">
          <KeywordBoxes codes={codesOf(id)} />
        </div>
      )}
    </div>
  );
}

/** Name bar and text of a card, without any behaviour. */
function CardFace({ id, small, chip, shield }: { id: string; small?: boolean; chip?: boolean; shield?: boolean }) {
  const def = CARD_DEFS.get(id);
  const art = def && hasArt(def.deck) ? artUrl(id) : undefined;
  if (chip) {
    if (!art) throw new Error(`No art for team chip ${id}`);
    return (
      <>
        <img className="card-art" src={art} alt={def?.name ?? id} draggable={false} />
        {def && <i className={`chip-type ri-${badgeIcon(def)}-line`} aria-hidden />}
        {shield && <i className="chip-shield ri-shield-line" aria-label="protected" />}
      </>
    );
  }
  if (small || !def || def.deck === 'support') {
    return (
      <>
        {!small && art && <img className="card-art" src={art} alt="" draggable={false} />}
        <span className="card-name">
          {def?.name ?? id}
          {shield && <i className="ri-shield-line" aria-label="protected" />}
        </span>
        {!small && <span className="card-text">{def?.cardText ? <CardText text={def.cardText} /> : def?.text}</span>}
      </>
    );
  }
  return <PrintedFace def={def} art={art} shield={shield} />;
}

/** The printed card (CARD_SPEC.md): fixed shape, so its text shrinks rather than the card growing. */
function PrintedFace({ def, art, shield }: { def: CardDef & { deck: Deck }; art: string | undefined; shield?: boolean }) {
  const textRef = useFitText();
  // the printed card: art with a type badge top left and a timing badge top right, the name on the art's edge, text, type label
  const timing = timingCode(def);
  return (
    <>
      <span className="card-top">
        {art && <img className="card-art" src={art} alt="" draggable={false} />}
        <i className={`card-badge type ri-${badgeIcon(def)}-line`} aria-hidden />
        {timing && <i className={`card-badge timing ri-${timing.icon}-line`} aria-label={timing.code} />}
      </span>
      <span className="card-name">
        {def.name}
        {shield && <i className="ri-shield-line" aria-label="protected" />}
      </span>
      <span ref={textRef} className="card-text">
        {def.cardText ? <CardText text={def.cardText} /> : def.text}
      </span>
      <span className="card-footer">{(def.type ?? def.deck).toUpperCase()}</span>
    </>
  );
}

/**
 * One card face. With a mouse, hovering shows its keyword tooltip; on touch, holding it still
 * opens the big preview, unless `onPointerDown` is given: then the caller owns the press (the hand uses this for drag-and-hold).
 */
export function Card(props: {
  id: string;
  /** marks the element so animations can find where this card is */
  uid?: string;
  selected?: boolean;
  dim?: boolean;
  small?: boolean;
  /** a round art face only, for team rows */
  chip?: boolean;
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
  const classes = ['card', props.small && 'small', props.chip && 'chip', props.selected && 'selected', props.dim && 'dim', props.lifted && 'lifted', props.onClick && 'clickable']
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
      data-uid={props.uid}
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
      <CardFace id={props.id} small={props.small} chip={props.chip} shield={props.shield} />
    </div>
  );
}

/** The card id behind a uid anywhere on the table you can see. */
export function idOfUid(view: GameView, uid: string): string {
  const all: CardInstance[] = [...view.hand, ...view.discard, ...view.visibleCrisis, ...view.players.flatMap((p) => [...p.team, ...p.revealed])];
  // a played Action card leaves the table, but the reveal that showed it is still in the recent events
  for (const e of view.events) if (e.type === 'cards_revealed') for (const r of e.cards as Array<{ cards: CardInstance[] }>) all.push(...r.cards);
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
  // the same person after a verb or preposition
  const whom = (seat: unknown) => (seat === view.you ? 'you' : who(seat));
  const plural = (n: unknown) => (n === 1 ? '1 card' : `${n} cards`);
  const card = (c: unknown) => cardName((c as CardInstance).id);
  switch (e.type) {
    case 'turn_started':
      return `Turn ${e.turn}: pick ${plural(e.picksRequired)}`;
    case 'cards_revealed':
      return (e.cards as Array<{ player: number; cards: CardInstance[] }>)
        .map((r) => `${who(r.player)} played ${r.cards.map(card).join(' + ')}`)
        .join(' · ');
    case 'card_gained':
      return `${who(e.player)} added ${card(e.card)}`;
    case 'card_stolen':
      return `${who(e.to)} took ${card(e.card)} from ${whom(e.from)}`;
    case 'card_given':
      return `${who(e.from)} gave ${card(e.card)} to ${whom(e.to)}`;
    case 'card_discarded':
      return `${who(e.player)} discarded ${card(e.card)}`;
    case 'card_protected':
      return `${who(e.player)} protected a card`;
    case 'cards_swapped': {
      const [a, b] = e.players as number[];
      const [x, y] = e.cards as CardInstance[];
      return `${who(a)} swapped ${card(x)} for ${b === view.you ? 'your' : `${who(b)}’s`} ${card(y)}`;
    }
    case 'bonus_gained':
      return `${who(e.player)} gained ${e.points} point(s) from ${cardName(String(e.source))}`;
    case 'crisis_drawn':
      return `Crisis: ${card(e.card)}`;
    case 'crisis_previewed':
      return `Next crisis: ${card(e.card)}`;
    case 'hands_passed':
      return `Everyone passed their hand ${e.direction}`;
    case 'round_started':
      return `Round ${e.round}: new hands, passing ${e.direction}`;
    case 'round_ended':
      return `Round ${e.round} over`;
    case 'hands_swapped':
      return `${who((e.players as number[])[0])} and ${whom((e.players as number[])[1])} swapped hands`;
    case 'hand_revealed':
      return `${e.player === view.you ? 'Your' : `${who(e.player)}’s`} hand: ${(e.cards as CardInstance[]).map(card).join(', ')}`;
    case 'private_meta_dealt':
      return `Your secret goal: ${(e.meta as string[]).map(cardName).join(', ')}`;
    case 'no_effect':
      return `${cardName(idOfUid(view, String(e.source)))} had no effect`;
    case 'game_ended':
      return 'Game over';
    default:
      return undefined;
  }
}
