/**
 * Fogchan Crypto Library (Browser Version)
 */

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

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

export interface Credentials {
  roomId: string;
  secretKey: string;
}

export interface EncryptResult {
  ciphertext: string;
  iv: string;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlToBytes(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(str: string): Uint8Array {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

export async function generateCredentials(): Promise<Credentials> {
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

async function importKey(secretKey: string): Promise<CryptoKey> {
  const keyBytes = base64UrlToBytes(secretKey);
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptMessage(
  payload: EncryptedPayload,
  secretKey: string
): Promise<EncryptResult> {
  const key = await importKey(secretKey);
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

export async function decryptMessage(
  ciphertext: string,
  iv: string,
  secretKey: string
): Promise<EncryptedPayload> {
  const key = await importKey(secretKey);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: base64ToBytes(iv) },
    key,
    base64ToBytes(ciphertext)
  );

  const plaintext = new TextDecoder().decode(decrypted);
  return JSON.parse(plaintext);
}

/**
 * Parse hash URL: #/chat/{roomId}/{secretKey}
 */
export function parseHashRoute(): { roomId: string; secretKey: string } | null {
  const hash = window.location.hash;
  const match = hash.match(/^#\/chat\/([a-f0-9]{32})\/(.+)$/);
  if (!match) return null;

  return {
    roomId: match[1],
    secretKey: match[2],
  };
}

/**
 * Parse a full URL (for joining via pasted link)
 * Supports both old format and new hash format
 */
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

/**
 * Build hash URL for chat room
 */
export function buildUrl(roomId: string, secretKey: string): string {
  return `${window.location.origin}${window.location.pathname}#/chat/${roomId}/${secretKey}`;
}

/**
 * Navigate to chat room
 */
export function navigateToChat(roomId: string, secretKey: string): void {
  window.location.hash = `/chat/${roomId}/${secretKey}`;
}

/**
 * Navigate to home
 */
export function navigateToHome(): void {
  window.location.hash = '/';
}
