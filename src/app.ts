import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import { registerHandlers } from './socket/handlers.js';
import type { SplendorServer, SplendorSocket } from './socket/handlers.js';
import { roomCount } from './rooms/roomManager.js';

/** `*` allows any origin; otherwise a comma-separated allow list. */
export function parseCorsOrigin(raw: string): string | string[] {
  return raw === '*' ? '*' : raw.split(',').map((origin) => origin.trim());
}

export interface AppOptions {
  corsOrigin?: string;
}

export function createApp(options: AppOptions = {}) {
  const corsOrigin = parseCorsOrigin(options.corsOrigin ?? process.env.CORS_ORIGIN ?? '*');

  const app = express();
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true, rooms: roomCount() });
  });

  const httpServer = http.createServer(app);
  const io: SplendorServer = new Server(httpServer, {
    cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
  });

  io.on('connection', (socket: SplendorSocket) => {
    registerHandlers(io, socket);
  });

  return { app, httpServer, io };
}
