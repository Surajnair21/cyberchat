import type { CryptoIdentity, UserKeyVault } from './types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const VAULT_ITERATIONS = 250000;

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function hashInviteCode(code: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(code.trim()));
  return bytesToBase64(new Uint8Array(digest));
}

async function deriveVaultKey(passphrase: string, salt: Uint8Array, iterations = VAULT_ITERATIONS) {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function generateUserKeyPair() {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey'],
  ) as Promise<CryptoKeyPair>;
}

export async function createUserVault(passphrase: string, userId: string) {
  const keyPair = await generateUserKeyPair();
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const vaultKey = await deriveVaultKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    vaultKey,
    toArrayBuffer(encoder.encode(JSON.stringify(privateJwk))),
  );

  const vault: UserKeyVault = {
    user_id: userId,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    wrapped_private_key: bytesToBase64(new Uint8Array(ciphertext)),
    public_key_jwk: publicJwk,
    kdf: 'PBKDF2-SHA-256',
    iterations: VAULT_ITERATIONS,
  };

  return {
    vault,
    identity: {
      privateKey: keyPair.privateKey,
      publicKey: publicJwk,
    },
  };
}

export async function unlockUserVault(vault: UserKeyVault, passphrase: string): Promise<CryptoIdentity> {
  const salt = base64ToBytes(vault.salt);
  const iv = base64ToBytes(vault.iv);
  const vaultKey = await deriveVaultKey(passphrase, salt, vault.iterations);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    vaultKey,
    base64ToBytes(vault.wrapped_private_key),
  );
  const privateJwk = JSON.parse(decoder.decode(plaintext)) as JsonWebKey;
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey'],
  );

  return {
    privateKey,
    publicKey: vault.public_key_jwk,
  };
}

export async function generateRoomKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function encryptText(roomKey: CryptoKey, plaintext: string) {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    roomKey,
    toArrayBuffer(encoder.encode(plaintext)),
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptText(roomKey: CryptoKey, ciphertext: string, iv: string) {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) },
    roomKey,
    base64ToBytes(ciphertext),
  );
  return decoder.decode(plaintext);
}

async function deriveShareKey(privateKey: CryptoKey, publicKey: CryptoKey) {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: publicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function wrapRoomKey(roomKey: CryptoKey, recipientPublicJwk: JsonWebKey) {
  const recipientPublicKey = await crypto.subtle.importKey(
    'jwk',
    recipientPublicJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
  const ephemeral = await generateUserKeyPair();
  const shareKey = await deriveShareKey(ephemeral.privateKey, recipientPublicKey);
  const rawRoomKey = new Uint8Array(await crypto.subtle.exportKey('raw', roomKey));
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, shareKey, rawRoomKey);
  const ephemeralPublicKey = await crypto.subtle.exportKey('jwk', ephemeral.publicKey);

  return {
    wrapped_room_key: JSON.stringify({
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
      ephemeralPublicKey,
    }),
    iv: bytesToBase64(iv),
  };
}

export async function unwrapRoomKey(
  identity: CryptoIdentity,
  wrappedRoomKey: string,
  iv: string,
) {
  const payload = JSON.parse(wrappedRoomKey) as {
    ciphertext: string;
    ephemeralPublicKey: JsonWebKey;
  };
  const ephemeralPublicKey = await crypto.subtle.importKey(
    'jwk',
    payload.ephemeralPublicKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
  const shareKey = await deriveShareKey(identity.privateKey, ephemeralPublicKey);
  const rawRoomKey = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) },
    shareKey,
    base64ToBytes(payload.ciphertext),
  );

  return crypto.subtle.importKey('raw', rawRoomKey, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

export function makeInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(18);
  let output = '';
  bytes.forEach((byte, index) => {
    if (index > 0 && index % 6 === 0) output += '-';
    output += alphabet[byte % alphabet.length];
  });
  return output;
}

export function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `room-${Date.now()}`;
}
