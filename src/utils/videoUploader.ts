import { bytesToBase64 } from "@/nostr/crypto";
import { uploadImageToBlossom } from "@/utils/blossom";

export async function encryptAndUploadFile(
  file: File,
  options?: {
    signEvent?: (evt:any)=>Promise<any>|any;
    onProgress?: (p:number)=>void;
    timeoutMs?: number;
  }
) {
  // Read file bytes
  const originalMime = file.type || "application/octet-stream";
  const fileBytes = new Uint8Array(await file.arrayBuffer());

  // Generate AES-GCM 256 key and iv
  const encryptionKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    encryptionKey,
    fileBytes
  );

  const encryptedFile = new File(
    [new Uint8Array(encrypted)],
    file.name.replace(/\.[^.]*$/, '') + ".enc",
    { type: "application/octet-stream" }
  );

  // Upload encrypted file using existing blossom uploader
  const descriptor = await uploadImageToBlossom(encryptedFile, {
    signEvent: options?.signEvent,
    onProgress: options?.onProgress,
    timeoutMs: options?.timeoutMs
  });

  // Export raw key bytes to base64 so callers can store metadata if needed
  const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", encryptionKey));
  const keyB64 = bytesToBase64(rawKey);
  const ivB64 = bytesToBase64(iv);

  return {
    descriptor,
    encryption: {
      key: keyB64,
      iv: ivB64,
      mime: originalMime
    }
  };
}
