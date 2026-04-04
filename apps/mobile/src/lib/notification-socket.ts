import { io, Socket } from 'socket.io-client';
import Constants from 'expo-constants';
import { authStorage } from '../storage/auth-storage';

const API_BASE_URL =
  (Constants.expoConfig?.extra?.['apiUrl'] as string | undefined) ??
  'http://localhost:3001/api/v1';

/** Strip /api/v1 suffix to get the Socket.IO server origin. */
const SOCKET_URL = API_BASE_URL.replace(/\/api\/v\d+$/, '');

let socket: Socket | null = null;

export async function connectNotificationSocket(): Promise<Socket> {
  if (socket?.connected) return socket;

  const token = await authStorage.getAccessToken();

  if (socket) {
    // Update auth token and reconnect
    socket.auth = { token };
    socket.connect();
    return socket;
  }

  socket = io(`${SOCKET_URL}/notifications`, {
    auth: { token },
    transports: ['websocket'],
    autoConnect: true,
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

export function getNotificationSocket(): Socket | null {
  return socket;
}

export function isSocketConnected(): boolean {
  return socket?.connected ?? false;
}
