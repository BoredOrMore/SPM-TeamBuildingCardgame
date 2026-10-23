// Starts the room server.

import { defineRoom, defineServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME } from '../shared/protocol.js';
import { GameRoom } from './GameRoom.js';

const PORT = Number(process.env.PORT ?? 2567);

const server = defineServer({
  transport: new WebSocketTransport(),
  rooms: { [ROOM_NAME]: defineRoom(GameRoom) },
});

await server.listen(PORT);
console.log(`Head Hunter room server on ws://localhost:${PORT}`);
