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
  publicKey?: string;   // Sender's ECDSA public key (base64)
  signature?: string;   // ECDSA signature of (sender + content) (base64)
}

export interface PlaintextMessage {
  id: string;
  sender: string;
  content: string;
  timestamp: number;
  type: 'text' | 'system';
  publicKey?: string;     // Sender's public key
  fingerprint?: string;   // Short hash of public key (4 hex chars)
  verified?: boolean;     // Whether signature was verified
}

export interface IdentityKeyPair {
  publicKey: string;   // Base64 encoded
  privateKey: string;  // Base64 encoded
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
    keyBytes.buffer as ArrayBuffer,
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

  const ivBytes = base64ToBytes(iv);
  const ciphertextBytes = base64ToBytes(ciphertext);
  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: ivBytes.buffer as ArrayBuffer },
    key,
    ciphertextBytes.buffer as ArrayBuffer
  );

  const plaintext = new TextDecoder().decode(decrypted);
  return JSON.parse(plaintext);
}

// ============================================
// ECDSA Identity & Signing (for non-repudiation)
// ============================================

const ECDSA_ALGORITHM = {
  name: 'ECDSA',
  namedCurve: 'P-256',
};

const ECDSA_SIGN_ALGORITHM = {
  name: 'ECDSA',
  hash: 'SHA-256',
};

/**
 * Generate an ECDSA P-256 key pair for identity
 */
export async function generateIdentityKeyPair(): Promise<IdentityKeyPair> {
  const crypto = getCrypto();

  const keyPair = await crypto.subtle.generateKey(
    ECDSA_ALGORITHM,
    true,
    ['sign', 'verify']
  );

  const publicKeyBuffer = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

  return {
    publicKey: bytesToBase64(new Uint8Array(publicKeyBuffer)),
    privateKey: bytesToBase64(new Uint8Array(privateKeyBuffer)),
  };
}

/**
 * Import a public key from base64 string
 */
export async function importPublicKey(publicKeyBase64: string): Promise<CryptoKey> {
  const crypto = getCrypto();
  const keyBytes = base64ToBytes(publicKeyBase64);

  return crypto.subtle.importKey(
    'spki',
    keyBytes.buffer as ArrayBuffer,
    ECDSA_ALGORITHM,
    false,
    ['verify']
  );
}

/**
 * Import a private key from base64 string
 */
export async function importPrivateKey(privateKeyBase64: string): Promise<CryptoKey> {
  const crypto = getCrypto();
  const keyBytes = base64ToBytes(privateKeyBase64);

  return crypto.subtle.importKey(
    'pkcs8',
    keyBytes.buffer as ArrayBuffer,
    ECDSA_ALGORITHM,
    false,
    ['sign']
  );
}

/**
 * Sign a message with private key
 */
export async function signMessage(
  content: string,
  privateKeyBase64: string
): Promise<string> {
  const crypto = getCrypto();
  const privateKey = await importPrivateKey(privateKeyBase64);
  const data = new TextEncoder().encode(content);

  const signature = await crypto.subtle.sign(
    ECDSA_SIGN_ALGORITHM,
    privateKey,
    data
  );

  return bytesToBase64(new Uint8Array(signature));
}

/**
 * Verify a signature with public key
 */
export async function verifySignature(
  content: string,
  signatureBase64: string,
  publicKeyBase64: string
): Promise<boolean> {
  try {
    const crypto = getCrypto();
    const publicKey = await importPublicKey(publicKeyBase64);
    const data = new TextEncoder().encode(content);
    const signature = base64ToBytes(signatureBase64);

    return crypto.subtle.verify(
      ECDSA_SIGN_ALGORITHM,
      publicKey,
      signature.buffer as ArrayBuffer,
      data.buffer as ArrayBuffer
    );
  } catch {
    return false;
  }
}

/**
 * Get a short fingerprint (4 hex chars) from a public key
 */
export async function getPublicKeyFingerprint(publicKeyBase64: string): Promise<string> {
  const crypto = getCrypto();
  const keyBytes = base64ToBytes(publicKeyBase64);
  const hashBuffer = await crypto.subtle.digest('SHA-256', keyBytes.buffer as ArrayBuffer);
  const hashHex = bytesToHex(new Uint8Array(hashBuffer));
  return hashHex.slice(0, 4);
}

/**
 * Create a signed payload
 */
export async function createSignedPayload(
  sender: string,
  content: string,
  type: 'text' | 'system',
  privateKeyBase64: string,
  publicKeyBase64: string
): Promise<EncryptedPayload> {
  // Sign the combination of sender and content
  const dataToSign = `${sender}:${content}`;
  const signature = await signMessage(dataToSign, privateKeyBase64);

  return {
    sender,
    content,
    type,
    publicKey: publicKeyBase64,
    signature,
  };
}

/**
 * Verify a signed payload and return plaintext message with verification status
 */
export async function verifyPayload(
  payload: EncryptedPayload,
  messageId: string,
  timestamp: number
): Promise<PlaintextMessage> {
  let verified = false;
  let fingerprint: string | undefined;

  if (payload.publicKey && payload.signature) {
    const dataToVerify = `${payload.sender}:${payload.content}`;
    verified = await verifySignature(dataToVerify, payload.signature, payload.publicKey);
    fingerprint = await getPublicKeyFingerprint(payload.publicKey);
  }

  return {
    id: messageId,
    sender: payload.sender,
    content: payload.content,
    timestamp,
    type: payload.type,
    publicKey: payload.publicKey,
    fingerprint,
    verified,
  };
}

// ============================================
// URL Utilities
// ============================================

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
  // Identity functions
  generateIdentityKeyPair,
  signMessage,
  verifySignature,
  getPublicKeyFingerprint,
  createSignedPayload,
  verifyPayload,
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
  // Identity functions
  generateIdentityKeyPair,
  importPublicKey,
  importPrivateKey,
  signMessage,
  verifySignature,
  getPublicKeyFingerprint,
  createSignedPayload,
  verifyPayload,
};
