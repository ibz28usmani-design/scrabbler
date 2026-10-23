/**
 * Everything sync sends is encrypted here first, with a key stretched from a
 * passphrase that never leaves the device. The server (your own Worker)
 * stores only ciphertext; without the passphrase it can't read a word.
 *
 * AES-GCM, 256-bit, a fresh 12-byte nonce per value; the key comes from
 * PBKDF2-SHA-256 over the passphrase and a random salt the server keeps.
 * Text is gzipped before encryption where the browser can.
 */

export const ITERATIONS = 310_000;

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function deriveKey(passphrase: string, saltB64: string, iterations = ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64) as BufferSource, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as TransformStream<Uint8Array, Uint8Array>));
  return new Uint8Array(await out.arrayBuffer());
}

const canGzip = () => typeof CompressionStream !== 'undefined';

/** Encrypts bytes: nonce, then ciphertext. */
export async function encryptBytes(key: CryptoKey, bytes: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes as BufferSource));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

export async function decryptBytes(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12) as BufferSource }, key, data.subarray(12) as BufferSource));
  } catch {
    throw new WrongPassphrase();
  }
}

export class WrongPassphrase extends Error {
  constructor() {
    super('Synced data can’t be read with this passphrase. Use the same passphrase as on your other devices.');
  }
}

/** A value as encrypted text: a flag byte (1 = gzipped JSON, 0 = plain JSON), then the JSON. */
export async function sealJson(key: CryptoKey, value: unknown): Promise<string> {
  const json = enc.encode(JSON.stringify(value));
  const zip = canGzip() && json.length > 200;
  const body = zip ? await pipe(json, new CompressionStream('gzip')) : json;
  const flagged = new Uint8Array(body.length + 1);
  flagged[0] = zip ? 1 : 0;
  flagged.set(body, 1);
  return toB64(await encryptBytes(key, flagged));
}

export async function openJson<T = unknown>(key: CryptoKey, sealed: string): Promise<T> {
  const plain = await decryptBytes(key, fromB64(sealed));
  const body = plain.subarray(1);
  const json = plain[0] === 1 ? await pipe(body, new DecompressionStream('gzip')) : body;
  return JSON.parse(dec.decode(json)) as T;
}
