import { bytesToBase64, base64ToBytes } from "@/nostr/crypto";
import type { EncryptedVideoMetadata } from "./videoCrypto";

/**
 * Encode encrypted video metadata into a reference string
 * Format: blossom+aesgcm+video:<base64(json)>
 */
export function encodeEncryptedVideoRef(metadata: EncryptedVideoMetadata): string {
  const json = JSON.stringify(metadata);
  const bytes = new TextEncoder().encode(json);
  const b64 = bytesToBase64(bytes);
  return `blossom+aesgcm+video:${b64}`;
}

/**
 * Decode an encrypted video reference string
 * Returns null if the format is invalid
 */
export function decodeEncryptedVideoRef(ref: string): EncryptedVideoMetadata | null {
  if (!ref || !ref.startsWith("blossom+aesgcm+video:")) {
    return null;
  }
  
  try {
    const b64 = ref.slice("blossom+aesgcm+video:".length);
    const bytes = base64ToBytes(b64);
    const json = new TextDecoder().decode(bytes);
    const metadata = JSON.parse(json) as EncryptedVideoMetadata;
    
    // Basic validation
    if (
      metadata.v !== 1 ||
      metadata.type !== "video" ||
      metadata.alg !== "AES-GCM" ||
      !metadata.baseIv ||
      !metadata.key ||
      !metadata.parts ||
      !Array.isArray(metadata.parts)
    ) {
      console.error("Invalid encrypted video metadata:", metadata);
      return null;
    }
    
    return metadata;
  } catch (e) {
    console.error("Failed to decode encrypted video reference:", ref, e);
    return null;
  }
}

/**
 * Check if a string is an encrypted video reference
 */
export function isEncryptedVideoRef(str: string): boolean {
  return str && str.startsWith("blossom+aesgcm+video:");
}
