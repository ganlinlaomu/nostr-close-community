import { defineStore } from "pinia";
import { useKeyStore } from "./keys";
import { getDatabase } from "@/db/dexie"; // 引入工厂

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

export const useMessagesStore = defineStore("messages", {
  state: () => ({
    inbox: [] as InboxItem[],
    outbox: [] as OutboxItem[],
    loadedFor: "" as string
  }),

  actions: {
    // 获取当前账号的专用数据库实例
    getDB() {
      const ks = useKeyStore();
      return getDatabase(this.loadedFor || ks.pkHex);
    },

    async load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;
      
      if (!targetPk) {
        this.reset(false);
        return;
      }
      if (this.loadedFor === targetPk) return;
      this.loadedFor = targetPk;

      const db = this.getDB();

      // 1. 从物理隔离的数据库加载收件箱
      // 这里我们可以按时间倒序排，用户体验更好
      try {
        const storedInbox = await db.messages
          .orderBy("created_at")
          .reverse()
          .limit(1000)
          .toArray();
        this.inbox = storedInbox as unknown as InboxItem[];
      } catch (e) {
        console.error("Failed to load inbox from Dexie", e);
        this.inbox = [];
      }

      // 2. 发件箱暂时可以存放在 meta 表中，或者单独开表
      // 为了简单，我们先把发件箱存在 meta 表的一个 key 里
      try {
        const outboxData = await db.meta.get("outbox_cache");
        this.outbox = outboxData ? outboxData.value : [];
      } catch {
        this.outbox = [];
      }
    },

    async saveInbox() {
      if (!this.loadedFor) return;
      const db = this.getDB();
      
      // Dexie 批量写入比 localStorage 效率高得多
      try {
        await db.transaction('rw', db.messages, async () => {
          await db.messages.clear();
          await db.messages.bulkAdd(this.inbox);
        });
      } catch (e) {
        console.error("Dexie saveInbox error", e);
      }
    },

    async saveOutbox() {
      if (!this.loadedFor) return;
      const db = this.getDB();
      try {
        await db.meta.put({ key: "outbox_cache", value: this.outbox });
      } catch {}
    },

    async addInbox(item: InboxItem) {
      if (!item || !item.id) return;
      
      const existingIndex = this.inbox.findIndex((m) => m.id === item.id);
      if (existingIndex !== -1) {
        const existing = this.inbox[existingIndex];
        if (item._localMeta && !existing._localMeta) {
          this.inbox[existingIndex] = { ...existing, _localMeta: item._localMeta };
          await this.saveInbox();
        }
        return;
      }
      
      this.inbox.unshift(item);
      if (this.inbox.length > 1000) this.inbox.splice(1000);
      
      // 物理写入
      const db = this.getDB();
      await db.messages.put(item as any); 
      // 注意：这里为了保持简单调用了 put，也可以继续调用 saveInbox()
    },

    async addOutbox(item: OutboxItem) {
      if (!item || !item.id) return;
      this.outbox.unshift(item);
      if (this.outbox.length > 500) this.outbox.splice(500);
      await this.saveOutbox();
    },

    reset(removeFromStorage = false) {
      const db = this.getDB();
      const pk = this.loadedFor;
      
      this.inbox = [];
      this.outbox = [];
      this.loadedFor = "";

      if (removeFromStorage && pk) {
        // 如果是彻底删除，则清空该账号的数据库表
        db.messages.clear();
        db.meta.delete("outbox_cache");
      }
    }
  }
});
