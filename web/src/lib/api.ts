/**
 * Fogchan API Client
 */

export interface RoomInfo {
  roomId: string;
  createdAt: number;
  expiresAt: number;
  messageCount: number;
}

export interface EncryptedMessageResponse {
  id: string;
  ciphertext: string;
  iv: string;
  timestamp: number;
}

export interface SendMessageResponse {
  id: string;
  timestamp: number;
}

const API_BASE = 'https://fogchan.aimail.workers.dev/api';

export async function createRoom(roomId: string): Promise<RoomInfo> {
  const response = await fetch(`${API_BASE}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create room');
  }

  return response.json();
}

export async function getRoomInfo(roomId: string): Promise<RoomInfo> {
  const response = await fetch(`${API_BASE}/rooms/${roomId}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get room info');
  }

  return response.json();
}

export async function sendMessage(
  roomId: string,
  ciphertext: string,
  iv: string
): Promise<SendMessageResponse> {
  const response = await fetch(`${API_BASE}/rooms/${roomId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ciphertext, iv }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to send message');
  }

  return response.json();
}

export interface GetMessagesResponse {
  messages: EncryptedMessageResponse[];
  messageCount: number;
}

export async function getMessages(
  roomId: string,
  after: number = 0,
  limit: number = 100
): Promise<GetMessagesResponse> {
  const response = await fetch(
    `${API_BASE}/rooms/${roomId}/messages?after=${after}&limit=${limit}`
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get messages');
  }

  return response.json();
}

export async function clearMessages(roomId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/rooms/${roomId}/messages`, {
    method: 'DELETE',
  });

  if (!response.ok && response.status !== 204) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to clear messages');
  }
}
