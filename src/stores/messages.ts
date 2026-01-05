import { defineStore } from "pinia";
import { useKeyStore } from "./keys";
import { getDatabase } from "@/db/dexie";

/* =========================
 * Types
 * ========================= */

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
  relayResults: Array<{
    relay: string;
    ok: boolean;
    reason?: any;
    ts?: number;
  }>;
};

/* =========================
 * Store
 * ========================= */

export const useMessagesStore = defineStore("messages", {
  state: () => ({
    inbox: [] as InboxItem[],
    outbox: [] as OutboxItem[],
    loadedFor: "" as string
  }),

  actions: {
    /* =========================
     * 核心：按 pk 加载（物理隔离）
     * ========================= */

    async load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;

      if (!targetPk) {
        this.reset();
        return;
      }

      // 切账号 → 强制清空内存
      if (this.loadedFor !== targetPk) {
        this.inbox = [];
        this.outbox = [];
        this.loadedFor = targetPk;
      } else {
        return;
      }

      const db = getDatabase(targetPk);

      /* 收件箱 */
      try {
        const rows = await db.messages
          .orderBy("created_at")
          .reverse()
          .limit(1000)
          .toArray();

        this.inbox = rows as InboxItem[];
      } catch (e) {
        console.error("Failed to load inbox", e);
        this.inbox = [];
      }

      /* 发件箱 */
      try {
        const cached = await db.meta.get("outbox_cache");
        this.outbox = cached?.value ?? [];
      } catch {
        this.outbox = [];
      }
    },

    /* =========================
     * Inbox（增量安全）
     * ========================= */

    async addInbox(item: InboxItem) {
      if (!item?.id || !this.loadedFor) return;

      const index = this.inbox.findIndex(m => m.id === item.id);

      if (index !== -1) {
        const existing = this.inbox[index];
        if (item._localMeta && !existing._localMeta) {
          this.inbox[index] = { ...existing, _localMeta: item._localMeta };
          await getDatabase(this.loadedFor).messages.put(this.inbox[index] as any);
        }
        return;
      }

      this.inbox.unshift(item);
      if (this.inbox.length > 1000) this.inbox.splice(1000);

      await getDatabase(this.loadedFor).messages.put(item as any);
    },

    /* =========================
     * Outbox
     * ========================= */

    async addOutbox(item: OutboxItem) {
      if (!item?.id || !this.loadedFor) return;

      this.outbox.unshift(item);
      if (this.outbox.length > 500) this.outbox.splice(500);

      await getDatabase(this.loadedFor).meta.put({
        key: "outbox_cache",
        value: this.outbox
      });
    },

    /* =========================
     * Reset
     * ========================= */

    async reset(removeFromStorage = false) {
      const pk = this.loadedFor;

      this.inbox = [];
      this.outbox = [];
      this.loadedFor = "";

      if (removeFromStorage && pk) {
        const db = getDatabase(pk);
        await db.messages.clear();
        await db.meta.delete("outbox_cache");
      }
    }
  }
});