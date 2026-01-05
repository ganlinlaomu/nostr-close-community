import { defineStore } from "pinia";
import { useKeyStore } from "./keys";
import { getDatabase } from "@/db/dexie"; 
import { getRelaysFromStorage, subscribe, publish } from "@/nostr/relays";
import { logger } from "@/utils/logger";

export type Friend = {
  pubkey: string;
  name: string;
  groups?: string[];
  group?: string; 
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

  getters: {
    // 增加一个排序后的列表 getter，方便 UI 调用
    sortedList: (state) => {
      return [...state.list].sort((a, b) => a.name.localeCompare(b.name));
    }
  },

  actions: {
    /**
     * 获取数据库实例（增加空判断）
     */
    getDB() {
      const ks = useKeyStore();
      const pk = this.loadedFor || ks.pkHex;
      if (!pk) return null; // ⭐ 关键：无公钥返回 null
      return getDatabase(pk);
    },

    /**
     * 加载数据
     */
    async load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;
      
      // 1. 防御：无公钥不执行
      if (!targetPk) {
        logger.debug("[Friends] Load skipped: no pkHex");
        return;
      }

      // 避免重复加载
      if (this.loadedFor === targetPk && this.list.length > 0) return;
      this.loadedFor = targetPk;

      const db = this.getDB();
      // 2. 防御：db 为 null 不执行，防止 toArray() 报错
      if (!db) return;

      try {
        // 从物理库加载
        const localFriends = await db.friends.toArray();
        
        const tsKey = `friends_ts_${targetPk.slice(0, 10)}`;
        this.lastSyncTimestamp = Number(localStorage.getItem(tsKey) || 0);

        this.list = localFriends;
        logger.info(`[Friends] Loaded ${localFriends.length} friends for ${targetPk.slice(0, 8)}`);

        // 3. 同步云端
        if (ks.isLoggedIn && ks.supportsNip04) {
          await this.fetchFromRelays();
        }
      } catch (e) {
        logger.error("[Friends] Load failed", e);
      }
    },

    /**
     * 保存数据到物理库
     */
    async save() {
      if (!this.loadedFor) return;
      const db = this.getDB();
      if (!db) return; // ⭐ 关键：防御
      
      try {
        await db.transaction('rw', db.friends, async () => {
          await db.friends.clear();
          await db.friends.bulkAdd(this.list);
        });

        const tsKey = `friends_ts_${this.loadedFor.slice(0, 10)}`;
        localStorage.setItem(tsKey, this.lastSyncTimestamp.toString());
      } catch (e) {
        logger.error("[Friends] Save failed", e);
      }
    },

    /* =========================
     * 业务操作
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

    reset() {
      this.list = [];
      this.loadedFor = "";
      this.lastSyncTimestamp = 0;
    },

    /* =========================
     * 同步逻辑 (简版)
     * ========================= */
    async fetchFromRelays(): Promise<boolean> {
      const ks = useKeyStore();
      if (!ks.isLoggedIn || !ks.supportsNip04) return false;

      this.syncing = true;
      // 这里应该包含具体的 subscribe 逻辑...
      // 成功拉取并解密后调用 await this.save()
      this.syncing = false;
      return true;
    },

    async publishToRelays() {
        // ... 具体发布逻辑
    }
  }
});
