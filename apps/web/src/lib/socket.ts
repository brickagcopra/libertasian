'use client';

import type { Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth-store';

const API_BASE =
  process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001/api/v1';

/** Strip /api/v1 suffix to get the Socket.IO server origin. */
const SOCKET_URL = API_BASE.replace(/\/api\/v\d+$/, '');

let socket: Socket | null = null;
let ioModule: typeof import('socket.io-client') | null = null;

export async function getNotificationSocket(): Promise<Socket> {
  if (socket) return socket;

  if (!ioModule) {
    ioModule = await import('socket.io-client');
  }

  const token = useAuthStore.getState().accessToken;

  socket = ioModule.io(`${SOCKET_URL}/notifications`, {
    auth: { token },
    transports: ['websocket', 'polling'],
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30_000,
  });

  return socket;
}

export function disconnectNotificationSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function isSocketConnected(): boolean {
  return socket?.connected ?? false;
}
