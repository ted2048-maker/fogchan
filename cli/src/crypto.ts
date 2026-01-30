/**
 * Fogchan Crypto for Node.js CLI
 */

import { webcrypto } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const crypto = webcrypto as unknown as Crypto;

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
  const base64 = Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlToBytes(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'base64'));
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
// Key Storage (for CLI persistence)
// ============================================

function getKeyStorePath(): string {
  const configDir = path.join(os.homedir(), '.fogchan');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { mode: 0o700 });
  }
  return path.join(configDir, 'identity.json');
}

export function loadIdentityKeyPair(): IdentityKeyPair | null {
  const keyPath = getKeyStorePath();
  if (fs.existsSync(keyPath)) {
    try {
      const data = fs.readFileSync(keyPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return null;
}

export function saveIdentityKeyPair(keyPair: IdentityKeyPair): void {
  const keyPath = getKeyStorePath();
  fs.writeFileSync(keyPath, JSON.stringify(keyPair, null, 2), { mode: 0o600 });
}

export async function getOrCreateIdentityKeyPair(): Promise<IdentityKeyPair> {
  let keyPair = loadIdentityKeyPair();
  if (!keyPair) {
    keyPair = await generateIdentityKeyPair();
    saveIdentityKeyPair(keyPair);
  }
  return keyPair;
}
