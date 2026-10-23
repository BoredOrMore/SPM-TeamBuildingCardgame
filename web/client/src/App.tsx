// Screens: home (create or join), lobby, game table, and final scores.

import { useEffect, useRef, useState } from 'react';
import type { GameView, LobbyView, View } from '../../shared/protocol.js';
import { Card, CardText, cardName, choiceLabel, decisionTitle, eventLine, idOfUid } from './cards.js';
import { createRoom, joinRoom, rejoin, type Connection, type Handlers } from './net.js';

const NAME_KEY = 'hh_name';
/** How long an error toast stays on screen. */
const TOAST_MS = 3500;

export function App() {
  const [conn, setConn] = useState<Connection>();
  const [view, setView] = useState<View>();
  const [toast, setToast] = useState<string>();
  const handlers = useRef<Handlers>({
    onView: setView,
    onError: setToast,
    onLeave: () => {
      setConn(undefined);
      setView(undefined);
    },
  });

  useEffect(() => {
    void rejoin(handlers.current).then((c) => c && setConn(c));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  /** Runs a create or join, showing any failure as a toast. */
  const connect = async (open: () => Promise<Connection>) => {
    try {
      setConn(await open());
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="app">
      {!conn || !view ? (
        <Home busy={!!conn} onCreate={(name) => connect(() => createRoom(name, handlers.current))} onJoin={(code, name) => connect(() => joinRoom(code, name, handlers.current))} />
      ) : view.phase === 'lobby' ? (
        <Lobby view={view} conn={conn} />
      ) : (
        <Game view={view} conn={conn} />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/** Name entry plus create-room and join-by-code. */
function Home(props: { busy: boolean; onCreate: (name: string) => void; onJoin: (code: string, name: string) => void }) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [code, setCode] = useState('');
  const remember = () => localStorage.setItem(NAME_KEY, name);
  return (
    <main className="home">
      <h1>Head Hunter</h1>
      <p className="muted">Build the best software team before the deadline.</p>
      <label>
        Your name
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bored" />
      </label>
      <button className="primary" disabled={props.busy || !name.trim()} onClick={() => (remember(), props.onCreate(name))}>
        Create a room
      </button>
      <div className="join-row">
        <input value={code} maxLength={4} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE" aria-label="Room code" />
        <button disabled={props.busy || !name.trim() || code.length !== 4} onClick={() => (remember(), props.onJoin(code, name))}>
          Join
        </button>
      </div>
    </main>
  );
}

/** Who is in the room; the host adds bots and starts. */
function Lobby({ view, conn }: { view: LobbyView; conn: Connection }) {
  const isHost = view.seats[view.you]?.isHost ?? false;
  const canStart = view.seats.length >= view.minPlayers;
  return (
    <main className="lobby">
      <p className="muted">Room code</p>
      <div className="code">{view.code}</div>
      <p className="muted">Share this code. {view.minPlayers}–{view.maxPlayers} players.</p>
      <ul className="seats">
        {view.seats.map((s) => (
          <li key={s.seat}>
            <i className={s.isBot ? 'ri-robot-2-line' : 'ri-user-line'} /> {s.name}
            {s.seat === view.you && <span className="tag">you</span>}
            {s.isHost && <span className="tag">host</span>}
            {!s.connected && <span className="tag warn">offline</span>}
            {isHost && s.isBot && (
              <button className="link" onClick={() => conn.send('remove_bot', { seat: s.seat })}>
                remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {isHost ? (
        <div className="row">
          <button disabled={view.seats.length >= view.maxPlayers} onClick={() => conn.send('add_bot', {})}>
            <i className="ri-robot-2-line" /> Add bot
          </button>
          <button className="primary" disabled={!canStart} onClick={() => conn.send('start', {})}>
            Start game
          </button>
        </div>
      ) : (
        <p className="muted">Waiting for the host to start…</p>
      )}
      <button className="link" onClick={() => conn.leave()}>
        Leave room
      </button>
    </main>
  );
}

/** The table: crisis and goals, other players, your team, your hand, and the current decision. */
function Game({ view, conn }: { view: GameView; conn: Connection }) {
  const [selected, setSelected] = useState<string[]>([]);
  const me = view.players[view.you]!;
  const need = Math.min(view.picksRequired, view.hand.length);
  const picking = view.stage === 'pick' && !view.picked;
  const myDecision = view.decision?.player === view.you ? view.decision : undefined;

  // a new turn or a new hand clears any half-made selection
  const handKey = view.hand.map((c) => c.uid).join();
  useEffect(() => setSelected([]), [handKey, view.turn]);

  const toggle = (uid: string) =>
    setSelected((s) => (s.includes(uid) ? s.filter((x) => x !== uid) : need === 1 ? [uid] : s.length < need ? [...s, uid] : s));

  if (view.result) return <Results view={view} conn={conn} />;

  return (
    <main className="game">
      <header className="topbar">
        <span>
          Turn {view.turn}/{view.totalTurns}
        </span>
        <span className="muted">Room {view.code}</span>
        <span className="score">
          <i className="ri-trophy-line" /> {view.yourScore.total}
        </span>
      </header>

      <section className="goals">
        {view.visibleCrisis.map((c) => (
          <Card key={c.uid} id={c.id} small />
        ))}
        {view.activeMeta.map((id) => (
          <Card key={id} id={id} small />
        ))}
        {view.privateMeta.map((id) => (
          <Card key={id} id={id} small />
        ))}
        <span className="muted deck-count">
          Deck {view.mainRemaining} · Crisis {view.crisisRemaining}
        </span>
      </section>

      <section className="opponents">
        {view.players
          .filter((p) => p.seat !== view.you)
          .map((p) => (
            <div key={p.seat} className={`opponent ${view.decision?.player === p.seat ? 'acting' : ''}`}>
              <div className="opp-head">
                <i className={p.isBot ? 'ri-robot-2-line' : 'ri-user-line'} /> {p.name}
                {!p.connected && <span className="tag warn">offline</span>}
                <span className="muted">
                  {' '}
                  <i className="ri-stack-line" /> {p.handCount}
                </span>
                {view.stage === 'pick' && <span className="tag">{p.hasPicked ? 'ready' : 'picking…'}</span>}
              </div>
              <div className="mini-team">
                {p.team.map((c) => (
                  <Card key={c.uid} id={c.id} small shield={p.protected.includes(c.uid)} />
                ))}
              </div>
            </div>
          ))}
      </section>

      <section className="my-team">
        <h2>Your team</h2>
        <div className="mini-team">
          {me.team.length ? me.team.map((c) => <Card key={c.uid} id={c.id} small shield={me.protected.includes(c.uid)} />) : <span className="muted">No one hired yet</span>}
        </div>
      </section>

      {myDecision?.options ? (
        <section className="decision">
          <h2>{decisionTitle(myDecision)}</h2>
          {cardName(idOfUid(view, myDecision.source)) !== myDecision.source && <p className="muted">From {cardName(idOfUid(view, myDecision.source))}</p>}
          <div className="options">
            {myDecision.options.map((o, i) => (
              <button key={i} onClick={() => conn.send('choose', { decisionId: myDecision.id, option: i })}>
                {choiceLabel(view, o)}
              </button>
            ))}
          </div>
        </section>
      ) : (
        view.decision && (
          <section className="decision waiting">
            Waiting for {view.players[view.decision.player]?.name}: {decisionTitle(view.decision)}
          </section>
        )
      )}

      <section className="hand">
        <h2>
          Your hand{' '}
          {picking ? (
            <span className="muted">
              pick {need} ({selected.length}/{need})
            </span>
          ) : view.stage === 'pick' ? (
            <span className="muted">waiting for others…</span>
          ) : null}
        </h2>
        <div className="hand-cards">
          {view.hand.map((c) => (
            <Card
              key={c.uid}
              id={c.id}
              selected={selected.includes(c.uid) || !!view.picked?.includes(c.uid)}
              dim={!picking && !view.picked?.includes(c.uid)}
              onClick={picking ? () => toggle(c.uid) : undefined}
            />
          ))}
        </div>
        {picking && (
          <button className="primary play" disabled={selected.length !== need} onClick={() => conn.send('pick', { cards: selected })}>
            Play {selected.length === 1 ? cardName(view.hand.find((c) => c.uid === selected[0])?.id ?? '') : `${selected.length} cards`}
          </button>
        )}
      </section>

      <Log view={view} />
    </main>
  );
}

/** Recent public (and your private) events, newest first. */
function Log({ view }: { view: GameView }) {
  const lines = view.events
    .map((e) => eventLine(view, e))
    .filter((l): l is string => !!l)
    .reverse();
  return (
    <details className="log" open>
      <summary>What happened</summary>
      <ul>
        {lines.slice(0, 12).map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </details>
  );
}

/** Final scores with each player's breakdown. */
function Results({ view, conn }: { view: GameView; conn: Connection }) {
  const isHost = view.players[view.you]?.isHost;
  const scores = [...view.result!.scores].sort((a, b) => b.total - a.total);
  return (
    <main className="results">
      <h1>Game over</h1>
      {scores.map((s) => (
        <div key={s.seat} className={`result ${view.result!.winners.includes(s.seat) ? 'winner' : ''}`}>
          <h2>
            {view.result!.winners.includes(s.seat) && <i className="ri-trophy-line" />} {view.players[s.seat]?.name} · {s.total}
          </h2>
          <ul>
            {s.lines.map((l, i) => (
              <li key={i}>
                <CardText text={l.label} /> <b>{l.points}</b>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {isHost ? <button className="primary" onClick={() => conn.send('play_again', {})}>Back to lobby</button> : <p className="muted">The host can start another game.</p>}
      <button className="link" onClick={() => conn.leave()}>
        Leave room
      </button>
    </main>
  );
}
