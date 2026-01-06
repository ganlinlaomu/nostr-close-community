import { defineStore } from "pinia";
import { getCurrentDatabase } from "@/db/dexie";

export type DBMessage = {
  id: string;
  pubkey: string;
  content?: string;
  created_at: number;
};

export const useMessagesStore = defineStore("messages", {
  state: () => ({
    list: [] as DBMessage[], // 內存列表
  }),

  actions: {
    // 從 Dexie 載入最近消息
    async loadFromDB(limit = 50) {
      try {
        const db = getCurrentDatabase();
        this.list = await db.messages
          .orderBy("created_at")
          .reverse()
          .limit(limit)
          .toArray();
      } catch (e) {
        console.error("[messagesStore] loadFromDB failed", e);
        this.list = [];
      }
    },

    // 新增一條消息
    async addlist(msg: DBMessage) {
      if (!msg.id) return;

      const db = getCurrentDatabase();

      // 避免重複
      const exists = await db.messages.get(msg.id);
      if (exists) return;

      try {
        await db.messages.put(msg); // 存 Dexie
        this.list.unshift(msg);     // 更新內存
        if (this.list.length > 1000) this.list.splice(1000);
      } catch (e) {
        console.error("[messagesStore] addlist failed", e);
      }
    },

    // 可選：清空消息
    async reset() {
      const db = getCurrentDatabase();
      await db.messages.clear();
      this.list = [];
    }
  }
});
