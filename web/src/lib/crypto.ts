/**
 * Fogchan Crypto Library (Browser Version)
 */

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

const ECDSA_ALGORITHM = {
  name: 'ECDSA',
  namedCurve: 'P-256',
};

const ECDSA_SIGN_ALGORITHM = {
  name: 'ECDSA',
  hash: 'SHA-256',
};

export interface EncryptedPayload {
  sender: string;
  content: string;
  type: 'text' | 'system';
  publicKey?: string;
  signature?: string;
}

export interface PlaintextMessage {
  id: string;
  sender: string;
  content: string;
  timestamp: number;
  type: 'text' | 'system';
  publicKey?: string;
  fingerprint?: string;
  verified?: boolean;
}

export interface Credentials {
  roomId: string;
  secretKey: string;
}

export interface EncryptResult {
  ciphertext: string;
  iv: string;
}

export interface IdentityKeyPair {
  publicKey: string;
  privateKey: string;
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

// ============================================
// AES Encryption
// ============================================

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

// ============================================
// ECDSA Identity & Signing
// ============================================

export async function generateIdentityKeyPair(): Promise<IdentityKeyPair> {
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

async function importPublicKey(publicKeyBase64: string): Promise<CryptoKey> {
  const keyBytes = base64ToBytes(publicKeyBase64);
  return crypto.subtle.importKey(
    'spki',
    keyBytes,
    ECDSA_ALGORITHM,
    false,
    ['verify']
  );
}

async function importPrivateKey(privateKeyBase64: string): Promise<CryptoKey> {
  const keyBytes = base64ToBytes(privateKeyBase64);
  return crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    ECDSA_ALGORITHM,
    false,
    ['sign']
  );
}

export async function signMessage(
  content: string,
  privateKeyBase64: string
): Promise<string> {
  const privateKey = await importPrivateKey(privateKeyBase64);
  const data = new TextEncoder().encode(content);

  const signature = await crypto.subtle.sign(
    ECDSA_SIGN_ALGORITHM,
    privateKey,
    data
  );

  return bytesToBase64(new Uint8Array(signature));
}

export async function verifySignature(
  content: string,
  signatureBase64: string,
  publicKeyBase64: string
): Promise<boolean> {
  try {
    const publicKey = await importPublicKey(publicKeyBase64);
    const data = new TextEncoder().encode(content);
    const signature = base64ToBytes(signatureBase64);

    return crypto.subtle.verify(
      ECDSA_SIGN_ALGORITHM,
      publicKey,
      signature,
      data
    );
  } catch {
    return false;
  }
}

export async function getPublicKeyFingerprint(publicKeyBase64: string): Promise<string> {
  const keyBytes = base64ToBytes(publicKeyBase64);
  const hashBuffer = await crypto.subtle.digest('SHA-256', keyBytes);
  const hashHex = bytesToHex(new Uint8Array(hashBuffer));
  return hashHex.slice(0, 4);
}

export async function createSignedPayload(
  sender: string,
  content: string,
  type: 'text' | 'system',
  privateKeyBase64: string,
  publicKeyBase64: string
): Promise<EncryptedPayload> {
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
// Identity Storage (localStorage)
// ============================================

const IDENTITY_STORAGE_KEY = 'fogchan_identity';

export function loadIdentityKeyPair(): IdentityKeyPair | null {
  const stored = localStorage.getItem(IDENTITY_STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }
  return null;
}

export function saveIdentityKeyPair(keyPair: IdentityKeyPair): void {
  localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(keyPair));
}

export async function getOrCreateIdentityKeyPair(): Promise<IdentityKeyPair> {
  let keyPair = loadIdentityKeyPair();
  if (!keyPair) {
    keyPair = await generateIdentityKeyPair();
    saveIdentityKeyPair(keyPair);
  }
  return keyPair;
}

// ============================================
// URL Utilities
// ============================================

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
