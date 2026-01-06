import { defineStore } from "pinia";
import { useKeyStore } from "./keys";
import { getCurrentDatabase } from "@/db/dexie"; // 确保引入了正确的方法

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
     * 核心：按 pk 加载
     * ========================= */

    async load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;

      if (!targetPk) {
        this.reset();
        return;
      }

      if (this.loadedFor !== targetPk) {
        this.inbox = [];
        this.outbox = [];
        this.loadedFor = targetPk;
      } else if (this.inbox.length > 0) {
        return;
      }

      // ✅ 统一使用 getCurrentDatabase
      const db = getCurrentDatabase();

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
     * Inbox
     * ========================= */

    async addInbox(item: InboxItem) {
      if (!item?.id || !this.loadedFor) return;

      const db = getCurrentDatabase(); // ✅ 替换 getDatabase
      const index = this.inbox.findIndex(m => m.id === item.id);

      if (index !== -1) {
        const existing = this.inbox[index];
        if (item._localMeta && !existing._localMeta) {
          this.inbox[index] = { ...existing, _localMeta: item._localMeta };
          // ✅ 存入数据库
          await db.messages.put(this.inbox[index]);
        }
        return;
      }

      this.inbox.unshift(item);
      if (this.inbox.length > 1000) this.inbox.splice(1000);

      // ✅ 存入数据库
      await db.messages.put(item);
    },

    /* =========================
     * Outbox
     * ========================= */

    async addOutbox(item: OutboxItem) {
      if (!item?.id || !this.loadedFor) return;

      const db = getCurrentDatabase(); // ✅ 替换 getDatabase
      this.outbox.unshift(item);
      if (this.outbox.length > 500) this.outbox.splice(500);

      await db.meta.put({
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
        const db = getCurrentDatabase(); // ✅ 替换 getDatabase
        await db.messages.clear();
        await db.meta.delete("outbox_cache");
      }
    }
  }
});