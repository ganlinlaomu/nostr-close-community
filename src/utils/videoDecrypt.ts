import { base64ToBytes } from "@/nostr/crypto";
import type { EncryptedVideoMetadata, EncryptedChunkMetadata } from "./videoCrypto";
import { deriveChunkIV } from "./videoCrypto";

/**
 * Decrypt a single video chunk
 */
export async function decryptVideoChunk(
  key: CryptoKey,
  encryptedData: Uint8Array,
  iv: Uint8Array
): Promise<Uint8Array> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    encryptedData
  );
  
  return new Uint8Array(decrypted);
}

/**
 * Download and decrypt a single chunk
 */
async function downloadAndDecryptChunk(
  chunkMeta: EncryptedChunkMetadata,
  key: CryptoKey,
  baseIv: Uint8Array,
  onProgress?: (chunkIndex: number, progress: number) => void
): Promise<Uint8Array> {
  // Download chunk
  const response = await fetch(chunkMeta.storageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download chunk ${chunkMeta.index}: ${response.statusText}`);
  }
  
  const encryptedData = new Uint8Array(await response.arrayBuffer());
  
  if (onProgress) {
    onProgress(chunkMeta.index, 50); // Download complete
  }
  
  // Derive IV for this chunk
  const chunkIv = deriveChunkIV(baseIv, chunkMeta.index);
  
  // Decrypt chunk
  const decryptedData = await decryptVideoChunk(key, encryptedData, chunkIv);
  
  if (onProgress) {
    onProgress(chunkMeta.index, 100); // Decryption complete
  }
  
  return decryptedData;
}

/**
 * Download and decrypt all chunks, then assemble into a single Blob
 */
export async function downloadAndDecryptVideo(
  metadata: EncryptedVideoMetadata,
  onProgress?: (overall: number, status: string) => void
): Promise<Blob> {
  // Import key from metadata
  const keyBytes = base64ToBytes(metadata.key);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  
  const baseIv = base64ToBytes(metadata.baseIv);
  const totalChunks = metadata.parts.length;
  const decryptedChunks: Uint8Array[] = [];
  
  // Download and decrypt each chunk
  for (let i = 0; i < metadata.parts.length; i++) {
    const part = metadata.parts[i];
    
    if (onProgress) {
      const progress = (i / totalChunks) * 90; // 0-90% for download/decrypt
      onProgress(progress, `解密分片 ${i + 1}/${totalChunks}...`);
    }
    
    const decryptedChunk = await downloadAndDecryptChunk(
      part,
      key,
      baseIv,
      (chunkIndex, chunkProgress) => {
        if (onProgress) {
          const baseProgress = (i / totalChunks) * 90;
          const chunkContribution = (chunkProgress / 100) * (90 / totalChunks);
          onProgress(baseProgress + chunkContribution, `解密分片 ${i + 1}/${totalChunks}...`);
        }
      }
    );
    
    decryptedChunks.push(decryptedChunk);
  }
  
  if (onProgress) {
    onProgress(95, "组装视频...");
  }
  
  // Assemble all chunks into a single Blob
  const videoBlob = new Blob(decryptedChunks, { type: metadata.mime });
  
  if (onProgress) {
    onProgress(100, "完成");
  }
  
  return videoBlob;
}

/**
 * Decrypt a single-shot encrypted video (small files)
 */
export async function decryptVideoBytes(
  key: CryptoKey,
  pkg: { iv: string; ct: string }
): Promise<Uint8Array> {
  const iv = base64ToBytes(pkg.iv);
  const ct = base64ToBytes(pkg.ct);
  
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ct
  );
  
  return new Uint8Array(decrypted);
}
