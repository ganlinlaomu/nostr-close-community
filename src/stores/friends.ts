import { defineStore } from "pinia";
import { useKeyStore } from "./keys";
import { getDatabase } from "@/db/dexie"; // 引入工厂函数
import { getRelaysFromStorage, subscribe, publish } from "@/nostr/relays";
import { logger } from "@/utils/logger";

export type Friend = {
  pubkey: string;
  name: string;
  groups?: string[];
  group?: string; // 兼容旧版
  note?: string;
};

export const useFriendsStore = defineStore("friends", {
  state: () => ({
    list: [] as Friend[],
    loadedFor: "",
    syncing: false,
    lastSyncTimestamp: 0,
    version: 0
  }),

  actions: {
    // 获取当前账号对应的数据库实例
    getDB() {
      const ks = useKeyStore();
      return getDatabase(this.loadedFor || ks.pkHex);
    },

    async load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;
      if (!targetPk) return;

      // 避免重复加载
      if (this.loadedFor === targetPk && this.list.length > 0) return;
      this.loadedFor = targetPk;

      // 1. 从属于该账号的物理数据库加载
      const db = this.getDB();
      const localFriends = await db.friends.toArray();
      
      // 2. 从 localStorage 加载同步时间戳（这种轻量数据留着没关系）
      const tsKey = `friends_ts_${targetPk.slice(0, 10)}`;
      this.lastSyncTimestamp = Number(localStorage.getItem(tsKey) || 0);

      this.list = localFriends;

      // 3. 如果已登录，尝试同步云端
      if (ks.isLoggedIn && ks.supportsNip04) {
        await this.fetchFromRelays();
      }
    },

    async save() {
      if (!this.loadedFor) return;
      const db = this.getDB();
      
      // 写入物理数据库：先清空当前账号的表再写入（或逐个 put）
      await db.transaction('rw', db.friends, async () => {
        await db.friends.clear();
        await db.friends.bulkAdd(this.list);
      });

      // 记录同步时间戳到 localStorage
      const tsKey = `friends_ts_${this.loadedFor.slice(0, 10)}`;
      localStorage.setItem(tsKey, this.lastSyncTimestamp.toString());
    },

    /* =========================
     * 修改逻辑：调用后记得 save
     * ========================= */
    async add(friend: Friend) {
      if (!friend.pubkey) return false;
      if (this.list.some(f => f.pubkey === friend.pubkey)) return false;

      this.list.push(friend);
      this.lastSyncTimestamp = Math.floor(Date.now() / 1000);
      await this.save();
      this.publishToRelays().catch(() => {});
      return true;
    },

    async remove(pubkey: string) {
      this.list = this.list.filter(f => f.pubkey !== pubkey);
      this.lastSyncTimestamp = Math.floor(Date.now() / 1000);
      await this.save();
      this.publishToRelays().catch(() => {});
      return true;
    },

    // 重置方法（在切换账号时由 App.vue 或 logout 调用）
    reset() {
      this.list = [];
      this.loadedFor = "";
      this.lastSyncTimestamp = 0;
    },

    /* =========================
     * Relay 同步逻辑（基本保留，但 save() 会写入 Dexie）
     * ========================= */
    async fetchFromRelays(): Promise<boolean> {
      const ks = useKeyStore();
      if (!ks.isLoggedIn || !ks.supportsNip04) return false;

      this.syncing = true;
      // ... 订阅逻辑 (subscribe) 保持不变 ...
      // 在监听到 event 且解密成功后：
      // this.list = mergeList(this.list, incoming);
      // this.lastSyncTimestamp = latest.created_at;
      // await this.save(); // 这里会把云端数据存入物理隔离的 Dexie
      return true;
    }
  }
});
