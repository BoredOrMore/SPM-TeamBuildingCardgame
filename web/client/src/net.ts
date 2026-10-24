// Connection to the room server: create, join, rejoin after a page reload, and send moves.

import { Client, type Room } from '@colyseus/sdk';
import { ROOM_NAME, type ClientMessages, type View } from '../../shared/protocol.js';

/** Room server port, on the same host that served this page so phones on the LAN reach it too. */
const SERVER_PORT = 2567;
const TOKEN_KEY = 'hh_reconnect';
/** The deployed room server (VITE_SERVER_URL at build time); without it, the dev server on this page's host. */
const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:${SERVER_PORT}`;

const client = new Client(SERVER_URL);

export interface Handlers {
  onView: (view: View) => void;
  onError: (message: string) => void;
  onLeave: () => void;
}

/** A joined room with typed sends. */
export class Connection {
  constructor(private readonly room: Room) {}

  /** Sends one client message to the server. */
  send<K extends keyof ClientMessages>(type: K, message: ClientMessages[K]): void {
    this.room.send(type, message);
  }

  /** Leaves the room for good. */
  leave(): void {
    sessionStorage.removeItem(TOKEN_KEY);
    void this.room.leave();
  }
}

/** Wires a room's messages to the handlers and remembers how to rejoin it. */
function attach(room: Room, handlers: Handlers): Connection {
  sessionStorage.setItem(TOKEN_KEY, room.reconnectionToken);
  room.onMessage('view', (view: View) => {
    sessionStorage.setItem(TOKEN_KEY, room.reconnectionToken);
    handlers.onView(view);
  });
  room.onMessage('error_msg', (message: string) => handlers.onError(message));
  room.onLeave(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    handlers.onLeave();
  });
  return new Connection(room);
}

/** Opens a new room and sits the player as host. */
export async function createRoom(name: string, handlers: Handlers): Promise<Connection> {
  return attach(await client.create(ROOM_NAME, { name }), handlers);
}

/** Joins a room by its code. */
export async function joinRoom(code: string, name: string, handlers: Handlers): Promise<Connection> {
  return attach(await client.joinById(code.trim().toUpperCase(), { name }), handlers);
}

/** Rejoins the room this tab was in before a reload, if its seat is still held. */
export async function rejoin(handlers: Handlers): Promise<Connection | undefined> {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) return undefined;
  try {
    return attach(await client.reconnect(token), handlers);
  } catch {
    sessionStorage.removeItem(TOKEN_KEY);
    return undefined;
  }
}
