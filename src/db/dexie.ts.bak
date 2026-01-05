import Dexie from "dexie";

export const db = new Dexie("closed_community_db");

// Current app version - should match package.json
export const APP_VERSION = "0.1.0";
export const DB_VERSION = 2;

db.version(1).stores({
  messages: "id, created_at, pubkey",
  friends: "pubkey, name, group",
  meta: "key"
});

// Add version 2 with image cache table
db.version(2).stores({
  messages: "id, created_at, pubkey",
  friends: "pubkey, name, group",
  meta: "key",
  imageCache: "url, timestamp"
});

export type DBMessage = {
  id: string;
  pubkey: string;
  content?: string;
  created_at: number;
};

export type DBFriend = {
  pubkey: string;
  name?: string;
  group?: string;
};

export type DBImageCache = {
  url: string; // Original encrypted image URL
  blob: Blob; // Decrypted image blob
  timestamp: number; // Cache timestamp for expiration
  mime: string; // MIME type
};
