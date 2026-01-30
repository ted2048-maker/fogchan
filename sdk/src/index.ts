/**
 * Fogchan SDK
 * JavaScript SDK for client-side encrypted ephemeral chat
 */

import { EventEmitter } from 'events';

// Crypto constants
const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

// Types
export interface EncryptedPayload {
  sender: string;
  content: string;
  type: 'text' | 'system';
}

export interface PlaintextMessage {
  id: string;
  sender: string;
  content: string;
  timestamp: number;
  type: 'text' | 'system';
}

export interface EncryptedMessage {
  id: string;
  ciphertext: string;
  iv: string;
  timestamp: number;
}

export interface Credentials {
  roomId: string;
  secretKey: string;
}

export interface EncryptResult {
  ciphertext: string;
  iv: string;
}

export interface RoomInfo {
  roomId: string;
  createdAt: number;
  expiresAt: number;
  messageCount: number;
}

export interface EphemeralChatConfig {
  serverUrl: string;
  timeout?: number;
}

export interface JoinOptions {
  roomId: string;
  secretKey: string;
  name?: string;
  pollInterval?: number;
}

export interface HistoryOptions {
  limit?: number;
  after?: number;
}

// Get crypto object (works in both browser and Node.js)
function getCrypto(): Crypto {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    return globalThis.crypto;
  }
  // Node.js environment
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('crypto');
  return nodeCrypto.webcrypto;
}

// Utility functions
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBase64Url(bytes: Uint8Array): string {
  if (typeof btoa !== 'undefined') {
    const base64 = btoa(String.fromCharCode(...bytes));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }
  // Node.js
  const base64 = Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlToBytes(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);

  if (typeof atob !== 'undefined') {
    return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
  }
  // Node.js
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa !== 'undefined') {
    return btoa(String.fromCharCode(...bytes));
  }
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(str: string): Uint8Array {
  if (typeof atob !== 'undefined') {
    return Uint8Array.from(atob(str), c => c.charCodeAt(0));
  }
  return new Uint8Array(Buffer.from(str, 'base64'));
}

/**
 * Crypto utilities for key generation and encryption
 */
export namespace CryptoUtils {
  export async function generateCredentials(): Promise<Credentials> {
    const crypto = getCrypto();

    const roomIdBytes = crypto.getRandomValues(new Uint8Array(16));
    const roomId = bytesToHex(roomIdBytes);

    const key = await crypto.subtle.generateKey(
      { name: ALGORITHM, length: KEY_LENGTH },
      true,
      ['encrypt', 'decrypt']
    );
    const keyBytes = await crypto.subtle.exportKey('raw', key);
    const secretKey = bytesToBase64Url(new Uint8Array(keyBytes));

    return { roomId, secretKey };
  }

  export async function encrypt(
    payload: EncryptedPayload,
    secretKey: string
  ): Promise<EncryptResult> {
    const crypto = getCrypto();
    const keyBytes = base64UrlToBytes(secretKey);
    const key = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: ALGORITHM, length: KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );

    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));

    const encrypted = await crypto.subtle.encrypt(
      { name: ALGORITHM, iv },
      key,
      plaintext
    );

    return {
      ciphertext: bytesToBase64(new Uint8Array(encrypted)),
      iv: bytesToBase64(iv),
    };
  }

  export async function decrypt(
    ciphertext: string,
    iv: string,
    secretKey: string
  ): Promise<EncryptedPayload> {
    const crypto = getCrypto();
    const keyBytes = base64UrlToBytes(secretKey);
    const key = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: ALGORITHM, length: KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: base64ToBytes(iv) },
      key,
      base64ToBytes(ciphertext)
    );

    const plaintext = new TextDecoder().decode(decrypted);
    return JSON.parse(plaintext);
  }

  export function parseUrl(url: string): { roomId: string; secretKey: string } | null {
    try {
      const parsed = new URL(url);

      // New hash format: #/chat/{roomId}/{secretKey}
      const hashMatch = parsed.hash.match(/^#\/chat\/([a-f0-9]{32})\/(.+)$/);
      if (hashMatch) {
        return { roomId: hashMatch[1], secretKey: hashMatch[2] };
      }

      // Old format: /chat/{roomId}#{secretKey}
      const pathMatch = parsed.pathname.match(/\/chat\/([a-f0-9]{32})/);
      if (pathMatch && parsed.hash) {
        return { roomId: pathMatch[1], secretKey: parsed.hash.slice(1) };
      }

      return null;
    } catch {
      return null;
    }
  }

  export function buildUrl(baseUrl: string, roomId: string, secretKey: string): string {
    return `${baseUrl}/#/chat/${roomId}/${secretKey}`;
  }
}

/**
 * Session for interacting with a chat room
 */
export class Session extends EventEmitter {
  private roomId: string;
  private secretKey: string;
  private serverUrl: string;
  private name: string;
  private pollInterval: number;
  private lastTimestamp: number = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private seenIds: Set<string> = new Set();
  private timeout: number;

  constructor(
    serverUrl: string,
    roomId: string,
    secretKey: string,
    name: string,
    pollInterval: number,
    timeout: number
  ) {
    super();
    this.serverUrl = serverUrl;
    this.roomId = roomId;
    this.secretKey = secretKey;
    this.name = name;
    this.pollInterval = pollInterval;
    this.timeout = timeout;
  }

  /**
   * Start polling for new messages
   */
  start(): void {
    this.poll();
    this.intervalId = setInterval(() => this.poll(), this.pollInterval);
  }

  /**
   * Stop polling
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Send a message
   */
  async send(content: string): Promise<void> {
    const payload: EncryptedPayload = {
      sender: this.name,
      content,
      type: 'text',
    };

    const { ciphertext, iv } = await CryptoUtils.encrypt(payload, this.secretKey);

    const response = await this.fetch(`/api/rooms/${this.roomId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ciphertext, iv }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to send message');
    }
  }

  /**
   * Get message history
   */
  async getHistory(opts: HistoryOptions = {}): Promise<PlaintextMessage[]> {
    const { limit = 100, after = 0 } = opts;

    const response = await this.fetch(
      `/api/rooms/${this.roomId}/messages?after=${after}&limit=${limit}`
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get history');
    }

    const data = await response.json();
    const messages: PlaintextMessage[] = [];

    for (const msg of data.messages) {
      try {
        const payload = await CryptoUtils.decrypt(msg.ciphertext, msg.iv, this.secretKey);
        messages.push({
          id: msg.id,
          sender: payload.sender,
          content: payload.content,
          timestamp: msg.timestamp,
          type: payload.type,
        });
      } catch (e) {
        this.emit('decrypt_error', msg.id, e);
      }
    }

    return messages;
  }

  /**
   * Clear all messages in the room
   */
  async clearMessages(): Promise<void> {
    const response = await this.fetch(`/api/rooms/${this.roomId}/messages`, {
      method: 'DELETE',
    });

    if (!response.ok && response.status !== 204) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to clear messages');
    }

    this.seenIds.clear();
    this.lastTimestamp = 0;
  }

  private async poll(): Promise<void> {
    try {
      const response = await this.fetch(
        `/api/rooms/${this.roomId}/messages?after=${this.lastTimestamp}`
      );

      if (!response.ok) return;

      const data = await response.json();

      for (const msg of data.messages) {
        if (this.seenIds.has(msg.id)) continue;

        try {
          const payload = await CryptoUtils.decrypt(msg.ciphertext, msg.iv, this.secretKey);
          const message: PlaintextMessage = {
            id: msg.id,
            sender: payload.sender,
            content: payload.content,
            timestamp: msg.timestamp,
            type: payload.type,
          };

          this.emit('message', message);
        } catch (e) {
          this.emit('decrypt_error', msg.id, e);
        }

        this.seenIds.add(msg.id);
        if (msg.timestamp > this.lastTimestamp) {
          this.lastTimestamp = msg.timestamp;
        }
      }
    } catch (e) {
      this.emit('error', e);
    }
  }

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      return await fetch(`${this.serverUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Main client for Fogchan
 */
export class EphemeralChat {
  private serverUrl: string;
  private timeout: number;

  constructor(config: EphemeralChatConfig) {
    this.serverUrl = config.serverUrl.replace(/\/$/, '');
    this.timeout = config.timeout || 10000;
  }

  /**
   * Create a new room
   */
  async createRoom(roomId: string): Promise<RoomInfo> {
    const response = await this.fetch('/api/rooms', {
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

  /**
   * Get room information
   */
  async getRoomInfo(roomId: string): Promise<RoomInfo> {
    const response = await this.fetch(`/api/rooms/${roomId}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get room info');
    }

    return response.json();
  }

  /**
   * Delete a room
   */
  async deleteRoom(roomId: string): Promise<void> {
    const response = await this.fetch(`/api/rooms/${roomId}`, {
      method: 'DELETE',
    });

    if (!response.ok && response.status !== 204) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete room');
    }
  }

  /**
   * Join a room and start a session
   */
  async join(options: JoinOptions): Promise<Session> {
    const { roomId, secretKey, name = 'Anonymous', pollInterval = 5000 } = options;

    // Verify room exists
    await this.getRoomInfo(roomId);

    const session = new Session(
      this.serverUrl,
      roomId,
      secretKey,
      name,
      pollInterval,
      this.timeout
    );

    session.start();
    return session;
  }

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      return await fetch(`${this.serverUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export default EphemeralChat;
