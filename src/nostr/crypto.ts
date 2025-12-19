import { nip44 } from "nostr-tools";

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ========================
 * 基础工具
 * ======================== */

export function bytesToBase64(bytes: Uint8Array) {
  let bin = "";
  bytes.forEach(b => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

export function base64ToBytes(b64: string) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/* ========================
 * NIP-44 文本加密
 * ======================== */

export async function nip44EncryptText(
  senderSkHex: string,
  recipientPubHex: string,
  plaintext: string
): Promise<string> {
  return nip44.encrypt(senderSkHex, recipientPubHex, plaintext);
}

export async function nip44DecryptText(
  recipientSkHex: string,
  senderPubHex: string,
  ciphertext: string
): Promise<string> {
  return nip44.decrypt(recipientSkHex, senderPubHex, ciphertext);
}

/* ========================
 * 图片 key 派生（HKDF）
 * ======================== */

export async function deriveImageKey(
  sharedSecret: Uint8Array,
  postId: string,
  imageIndex: number
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    "HKDF",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: enc.encode(postId),
      info: enc.encode("image:" + imageIndex)
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
