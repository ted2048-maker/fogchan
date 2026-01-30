/**
 * Fogchan Crypto for Node.js CLI
 */

import { webcrypto } from 'crypto';

const crypto = webcrypto as unknown as Crypto;

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

export interface EncryptedPayload {
  sender: string;
  content: string;
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

