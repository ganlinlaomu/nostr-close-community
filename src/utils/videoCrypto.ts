import { bytesToBase64, base64ToBytes } from "@/nostr/crypto";

/**
 * Video encryption with chunking support for large files
 * - Small files (<20MB): single-shot encryption like images
 * - Large files (≥20MB): chunked with unique IV per chunk
 */

export const VIDEO_SIZE_THRESHOLD = 20 * 1024 * 1024; // 20MB
export const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB

export interface EncryptedChunkMetadata {
  index: number;
  iv: string; // base64-encoded IV for this chunk
  size: number; // encrypted chunk size
  storageUrl: string; // Blossom URL for this chunk
}

export interface EncryptedVideoMetadata {
  v: number; // version (1)
  type: "video";
  alg: "AES-GCM";
  baseIv: string; // base64-encoded base IV (12 bytes)
  key: string; // base64-encoded key (32 bytes)
  chunkSize: number; // chunk size in bytes (10485760)
  totalSize: number; // original video size
  mime: string; // original mime type
  parts: EncryptedChunkMetadata[];
}

/**
 * Derive a unique IV for a chunk from base IV and chunk index
 * IV format: base_iv[0:8] || uint32_be(chunk_index)
 */
export function deriveChunkIV(baseIv: Uint8Array, chunkIndex: number): Uint8Array {
  if (baseIv.length !== 12) {
    throw new Error("Base IV must be 12 bytes for AES-GCM");
  }
  
  const chunkIv = new Uint8Array(12);
  // Copy first 8 bytes from base IV
  chunkIv.set(baseIv.subarray(0, 8), 0);
  
  // Set last 4 bytes to chunk index (big-endian uint32)
  const view = new DataView(chunkIv.buffer);
  view.setUint32(8, chunkIndex, false); // false = big-endian
  
  return chunkIv;
}

/**
 * Encrypt a single chunk of video data
 */
export async function encryptVideoChunk(
  key: CryptoKey,
  chunkData: Uint8Array,
  chunkIv: Uint8Array
): Promise<Uint8Array> {
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: chunkIv },
    key,
    chunkData
  );
  
  return new Uint8Array(encrypted);
}

/**
 * Encrypt entire video file (single-shot for small files)
 */
export async function encryptVideoBytes(
  key: CryptoKey,
  plainBytes: Uint8Array
): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plainBytes
  );
  
  return {
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(encrypted))
  };
}

/**
 * Split file into chunks for chunked encryption
 */
export function* chunkFile(file: File, chunkSize: number): Generator<{ data: Blob; index: number; offset: number }> {
  let offset = 0;
  let index = 0;
  
  while (offset < file.size) {
    const end = Math.min(offset + chunkSize, file.size);
    const chunk = file.slice(offset, end);
    yield { data: chunk, index, offset };
    offset = end;
    index++;
  }
}

/**
 * Generate encryption key for video
 */
export async function generateVideoEncryptionKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true, // extractable
    ["encrypt", "decrypt"]
  );
}
