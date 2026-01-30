export interface Env {
  DB: D1Database;
}

export interface Room {
  id: string;
  created_at: number;
  expires_at: number;
  last_activity_at: number;
}

export interface Message {
  id: string;
  room_id: string;
  ciphertext: string;
  iv: string;
  timestamp: number;
}

export interface CreateRoomRequest {
  roomId: string;
}

export interface SendMessageRequest {
  ciphertext: string;
  iv: string;
}

export interface RoomResponse {
  roomId: string;
  createdAt: number;
  expiresAt: number;
  messageCount?: number;
}

export interface MessageResponse {
  id: string;
  ciphertext: string;
  iv: string;
  timestamp: number;
}

export interface MessagesResponse {
  messages: MessageResponse[];
}

export interface ErrorResponse {
  error: string;
}
