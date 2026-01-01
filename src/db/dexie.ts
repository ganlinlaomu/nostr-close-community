import Dexie, { Table } from "dexie";

export type DBMessage = {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
  sent_at?: number; // for outbox messages
  type?: "inbox" | "outbox"; // distinguish message types
  relayResults?: Array<{ relay: string; ok: boolean; reason?: any; ts?: number }>; // for outbox
  _localMeta?: {
    groupCount: number;
    groups: Array<{ name: string; count: number }>;
  };
};

export type DBFriend = {
  pubkey: string;
  name: string;
  groups?: string[];
  group?: string;
  note?: string;
};

export type DBMeta = {
  key: string;
  value: any;
};

export class ClosedCommunityDB extends Dexie {
  messages!: Table<DBMessage, string>;
  friends!: Table<DBFriend, string>;
  meta!: Table<DBMeta, string>;

  constructor() {
    super("closed_community_db");
    
    this.version(1).stores({
      messages: "id, created_at, pubkey, type",
      friends: "pubkey, name, group",
      meta: "key"
    });
  }
}

export const db = new ClosedCommunityDB();
