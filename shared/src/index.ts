/**
 * Fogchan Crypto Library
 * AES-256-GCM encryption for client-side encrypted chat
 */

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits for GCM

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
  roomId: string;
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

// Utility functions
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function base64UrlToBytes(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export function base64ToBytes(str: string): Uint8Array {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

// Get crypto object (works in both browser and Node.js)
function getCrypto(): Crypto {
  if (typeof globalThis.crypto !== 'undefined') {
    return globalThis.crypto;
  }
  // Node.js environment
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('crypto').webcrypto;
}

/**
 * Generate room credentials (roomId + secretKey)
 */
export async function generateCredentials(): Promise<Credentials> {
  const crypto = getCrypto();

  // Room ID: 128-bit random identifier (32 hex chars)
  const roomIdBytes = crypto.getRandomValues(new Uint8Array(16));
  const roomId = bytesToHex(roomIdBytes);

  // Secret Key: AES-256 key
  const key = await crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
  const keyBytes = await crypto.subtle.exportKey('raw', key);
  const secretKey = bytesToBase64Url(new Uint8Array(keyBytes));

  return { roomId, secretKey };
}

/**
 * Import a secret key from URL-safe Base64 string
 */
export async function importKey(secretKey: string): Promise<CryptoKey> {
  const crypto = getCrypto();
  const keyBytes = base64UrlToBytes(secretKey);
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a message payload
 */
export async function encryptMessage(
  payload: EncryptedPayload,
  secretKey: string
): Promise<EncryptResult> {
  const crypto = getCrypto();
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

/**
 * Decrypt a message
 */
export async function decryptMessage(
  ciphertext: string,
  iv: string,
  secretKey: string
): Promise<EncryptedPayload> {
  const crypto = getCrypto();
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
 * Parse a Fogchan URL into roomId and secretKey
 * Supports both new hash format and old path format
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
 * Build a Fogchan URL from roomId and secretKey
 */
export function buildUrl(baseUrl: string, roomId: string, secretKey: string): string {
  return `${baseUrl}/#/chat/${roomId}/${secretKey}`;
}

// CryptoUtils namespace for SDK compatibility
export const CryptoUtils = {
  generateCredentials,
  encrypt: encryptMessage,
  decrypt: decryptMessage,
  parseUrl,
  buildUrl,
};

export default {
  generateCredentials,
  importKey,
  encryptMessage,
  decryptMessage,
  parseUrl,
  buildUrl,
  bytesToHex,
  hexToBytes,
  bytesToBase64,
  base64ToBytes,
  bytesToBase64Url,
  base64UrlToBytes,
};
