import { defineStore } from "pinia";
import { useKeyStore } from "./keys";
import { db, type DBMessage } from "@/db/dexie";

export type InboxItem = {
  id: string;
  pubkey: string;
  created_at: number;
  content: string;
  _localMeta?: {
    groupCount: number;
    groups: Array<{ name: string; count: number }>;
  };
};

export type OutboxItem = {
  id: string;
  created_at: number;
  sent_at: number;
  content: string;
  relayResults: Array<{ relay: string; ok: boolean; reason?: any; ts?: number }>;
};

function inboxKeyFor(pk: string | null | undefined) {
  if (!pk) return null;
  return `nostr_inbox_${pk}`;
}
function outboxKeyFor(pk: string | null | undefined) {
  if (!pk) return null;
  return `nostr_outbox_${pk}`;
}

// One-time migration from localStorage to Dexie
async function migrateFromLocalStorage(pk: string) {
  const inboxKey = inboxKeyFor(pk);
  const outboxKey = outboxKeyFor(pk);
  
  try {
    // Migrate inbox
    if (inboxKey) {
      const rawInbox = localStorage.getItem(inboxKey);
      if (rawInbox) {
        const inbox: InboxItem[] = JSON.parse(rawInbox);
        console.log(`[Migration] Found ${inbox.length} inbox messages in localStorage for ${pk}`);
        
        // Bulk insert into Dexie (will skip duplicates due to primary key)
        const inboxMessages: DBMessage[] = inbox.map(item => ({
          id: item.id,
          pubkey: item.pubkey,
          content: item.content,
          created_at: item.created_at,
          type: "inbox" as const,
          _localMeta: item._localMeta
        }));
        
        await db.messages.bulkPut(inboxMessages);
        console.log(`[Migration] Migrated ${inbox.length} inbox messages to Dexie`);
        
        // Remove from localStorage after successful migration
        localStorage.removeItem(inboxKey);
        console.log(`[Migration] Removed localStorage key: ${inboxKey}`);
      }
    }
    
    // Migrate outbox
    if (outboxKey) {
      const rawOutbox = localStorage.getItem(outboxKey);
      if (rawOutbox) {
        const outbox: OutboxItem[] = JSON.parse(rawOutbox);
        console.log(`[Migration] Found ${outbox.length} outbox messages in localStorage for ${pk}`);
        
        // Bulk insert into Dexie
        const outboxMessages: DBMessage[] = outbox.map(item => ({
          id: item.id,
          pubkey: pk, // outbox items are from current user
          content: item.content,
          created_at: item.created_at,
          sent_at: item.sent_at,
          type: "outbox" as const,
          relayResults: item.relayResults
        }));
        
        await db.messages.bulkPut(outboxMessages);
        console.log(`[Migration] Migrated ${outbox.length} outbox messages to Dexie`);
        
        // Remove from localStorage after successful migration
        localStorage.removeItem(outboxKey);
        console.log(`[Migration] Removed localStorage key: ${outboxKey}`);
      }
    }
  } catch (error) {
    console.error("[Migration] Failed to migrate messages from localStorage:", error);
  }
}

export const useMessagesStore = defineStore("messages", {
  state: () => ({
    inbox: [] as InboxItem[],
    outbox: [] as OutboxItem[],
    loadedFor: "" as string
  }),
  actions: {
    async load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;
      if (!targetPk) {
        this.inbox = [];
        this.outbox = [];
        this.loadedFor = "";
        return;
      }
      if (this.loadedFor === targetPk) return;
      this.loadedFor = targetPk;

      // First, check for and migrate any localStorage data
      await migrateFromLocalStorage(targetPk);

      // Load inbox from Dexie (limit to recent 200 messages, sorted by created_at descending)
      try {
        const inboxMessages = await db.messages
          .where("type")
          .equals("inbox")
          .and(msg => msg.pubkey !== targetPk) // exclude own messages
          .reverse()
          .sortBy("created_at");
        
        this.inbox = inboxMessages.slice(0, 200).map(msg => ({
          id: msg.id,
          pubkey: msg.pubkey,
          content: msg.content,
          created_at: msg.created_at,
          _localMeta: msg._localMeta
        }));
        
        console.log(`[Messages] Loaded ${this.inbox.length} inbox messages from Dexie`);
      } catch (error) {
        console.error("[Messages] Failed to load inbox from Dexie:", error);
        this.inbox = [];
      }

      // Load outbox from Dexie (limit to recent 500 messages)
      try {
        const outboxMessages = await db.messages
          .where("type")
          .equals("outbox")
          .reverse()
          .sortBy("created_at");
        
        this.outbox = outboxMessages.slice(0, 500).map(msg => ({
          id: msg.id,
          created_at: msg.created_at,
          sent_at: msg.sent_at || msg.created_at,
          content: msg.content,
          relayResults: msg.relayResults || []
        }));
        
        console.log(`[Messages] Loaded ${this.outbox.length} outbox messages from Dexie`);
      } catch (error) {
        console.error("[Messages] Failed to load outbox from Dexie:", error);
        this.outbox = [];
      }
    },

    async saveInbox() {
      // Save to Dexie instead of localStorage
      try {
        const messages: DBMessage[] = this.inbox.map(item => ({
          id: item.id,
          pubkey: item.pubkey,
          content: item.content,
          created_at: item.created_at,
          type: "inbox" as const,
          _localMeta: item._localMeta
        }));
        
        await db.messages.bulkPut(messages);
      } catch (error) {
        console.error("[Messages] Failed to save inbox to Dexie:", error);
      }
    },

    async saveOutbox() {
      // Save to Dexie instead of localStorage
      try {
        const messages: DBMessage[] = this.outbox.map(item => ({
          id: item.id,
          pubkey: this.loadedFor || "", // current user's pubkey
          content: item.content,
          created_at: item.created_at,
          sent_at: item.sent_at,
          type: "outbox" as const,
          relayResults: item.relayResults
        }));
        
        await db.messages.bulkPut(messages);
      } catch (error) {
        console.error("[Messages] Failed to save outbox to Dexie:", error);
      }
    },

    async addInbox(item: InboxItem) {
      if (!item || !item.id) return;
      
      // Check if message already exists
      const existingIndex = this.inbox.findIndex((m) => m.id === item.id);
      if (existingIndex !== -1) {
        // Message already exists - handle _localMeta intelligently:
        // - If new item has _localMeta but existing doesn't: add it (relay echo arrived first)
        // - If both have _localMeta: keep existing (already correct, locally created version)
        // - If only existing has _localMeta: keep existing (preserve local metadata)
        // - If neither has _localMeta: no update needed
        const existing = this.inbox[existingIndex];
        
        if (item._localMeta && !existing._localMeta) {
          // Only case where we update: new has metadata but existing doesn't
          // Create a new object to ensure Vue reactivity
          this.inbox[existingIndex] = {
            ...existing,
            _localMeta: item._localMeta
          };
          await this.saveInbox();
        }
        // All other cases: keep existing as-is
        return;
      }
      
      // Add new message
      this.inbox.unshift(item);
      // keep bounded history
      if (this.inbox.length > 1000) this.inbox.splice(1000);
      
      // Save to Dexie
      await this.saveInbox();
    },

    async addOutbox(item: OutboxItem) {
      if (!item || !item.id) return;
      this.outbox.unshift(item);
      if (this.outbox.length > 500) this.outbox.splice(500);
      
      // Save to Dexie
      await this.saveOutbox();
    },

    // remove in-memory lists for current user, optionally remove persisted storage
    async reset(removeFromStorage = false) {
      const pk = this.loadedFor || "";
      this.inbox = [];
      this.outbox = [];
      this.loadedFor = "";
      
      if (removeFromStorage && pk) {
        try {
          // Remove from Dexie
          await db.messages.where("type").equals("inbox").delete();
          await db.messages.where("type").equals("outbox").delete();
        } catch (error) {
          console.error("[Messages] Failed to remove from Dexie:", error);
        }
        
        // Also clean up any remaining localStorage keys
        const ik = inboxKeyFor(pk);
        const ok = outboxKeyFor(pk);
        try { if (ik) localStorage.removeItem(ik); } catch {}
        try { if (ok) localStorage.removeItem(ok); } catch {}
      }
    },

    // debug: list stored pks that have inbox/outbox saved
    storedPks(): string[] {
      // This is now less useful since Dexie doesn't store by pk-based keys
      // But we keep it for backward compatibility
      try {
        const out: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k) continue;
          if (k.startsWith("nostr_inbox_") || k.startsWith("nostr_outbox_")) {
            const pk = k.split("_").slice(2).join("_");
            if (!out.includes(pk)) out.push(pk);
          }
        }
        return out;
      } catch {
        return [];
      }
    }
  }
});
