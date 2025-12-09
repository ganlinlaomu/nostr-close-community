import Dexie from "dexie";

export const db = new Dexie("closed_community_db");

db.version(1).stores({
  messages: "id, created_at, pubkey",
  friends: "pubkey, name, group",
  meta: "key"
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
