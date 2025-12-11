// 统一的对称加密 / 解密工具
import { nip04 } from "nostr-tools";

const enc = new TextEncoder();
const dec = new TextDecoder();

export function hexToBytes(hex: string) {
  if (hex.length % 2) hex = "0" + hex;
  const len = hex.length / 2;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}
export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
export function base64ToBytes(b64: string) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export function genSymHex() {
  const arr = crypto.getRandomValues(new Uint8Array(32));
  return bytesToHex(arr); // 64 chars hex
}

/**
 * normalizeSymKey: Normalize a symmetric key to hex string format (64 characters)
 * Accepts: hex string (64 chars), base64 string, or Uint8Array (32 bytes)
 * Returns: hex string (64 characters)
 */
export function normalizeSymKey(key: string | Uint8Array): string {
  // If already Uint8Array, convert to hex
  if (key instanceof Uint8Array) {
    if (key.length !== 32) {
      throw new Error(`Invalid symmetric key length: expected 32 bytes, got ${key.length}`);
    }
    return bytesToHex(key);
  }
  
  // If string, determine if it's hex or base64
  if (typeof key === 'string') {
    // Remove whitespace
    key = key.trim();
    
    // Check if it's a valid hex string (64 characters)
    if (/^[0-9a-fA-F]{64}$/.test(key)) {
      return key.toLowerCase();
    }
    
    // Try to decode as base64 (44 characters for 32 bytes in base64)
    if (key.length >= 40 && key.length <= 48) {
      try {
        const bytes = base64ToBytes(key);
        if (bytes.length === 32) {
          return bytesToHex(bytes);
        }
      } catch (e) {
        // Not valid base64, continue to error
      }
    }
    
    throw new Error(`Invalid symmetric key format: expected 64-char hex or 32-byte base64, got string of length ${key.length}`);
  }
  
  throw new Error(`Invalid symmetric key type: expected string or Uint8Array, got ${typeof key}`);
}

async function importAesKeyFromHex(symHex: string) {
  const raw = hexToBytes(symHex);
  return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function symEncryptPackage(symKey: string | Uint8Array, plaintext: string) {
  // Normalize the symmetric key to hex format
  let symHex: string;
  try {
    symHex = normalizeSymKey(symKey);
  } catch (e) {
    throw new Error(`Failed to normalize symmetric key: ${e instanceof Error ? e.message : e}. Key type: ${typeof symKey}, Key length: ${symKey instanceof Uint8Array ? symKey.length : (symKey as string).length}`);
  }
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importAesKeyFromHex(symHex);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  const ivb = new Uint8Array(iv);
  const ctb = new Uint8Array(ct);
  return {
    iv: bytesToBase64(ivb),
    ct: bytesToBase64(ctb)
  };
}

export async function symDecryptPackage(symKey: string | Uint8Array, pkg: { iv: string; ct: string }) {
  // Normalize the symmetric key to hex format
  let symHex: string;
  try {
    symHex = normalizeSymKey(symKey);
  } catch (e) {
    throw new Error(`Failed to normalize symmetric key: ${e instanceof Error ? e.message : e}. Key type: ${typeof symKey}, Key length: ${symKey instanceof Uint8Array ? symKey.length : (symKey as string).length}`);
  }
  
  const iv = base64ToBytes(pkg.iv);
  const ct = base64ToBytes(pkg.ct);
  const key = await importAesKeyFromHex(symHex);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return dec.decode(plain);
}

/**
 * envelopeEncryptSym(authorSkHex, recipientPubHex, symHex)
 * - 返回 Promise<string>（nip04.encrypt 返回值）
 */
export async function envelopeEncryptSym(authorSkHex: string, recipientPubHex: string, symHex: string) {
  // nip04.encrypt returns Promise<string>
  return await nip04.encrypt(authorSkHex, recipientPubHex, symHex);
}

/**
 * envelopeDecryptSym(recipientSkHex, senderPubHex, enc)
 * - wrapper around nip04.decrypt
 */
export async function envelopeDecryptSym(recipientSkHex: string, senderPubHex: string, enc: string) {
  return await nip04.decrypt(recipientSkHex, senderPubHex, enc);
}
