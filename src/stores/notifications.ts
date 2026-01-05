import { defineStore } from "pinia";
import { pool } from "@/nostr/relays";
import { getRelaysFromStorage } from "@/nostr/relays";
import { useKeyStore } from "@/stores/keys";
import { genSymHex, symEncryptPackage, symDecryptPackage } from "@/nostr/crypto";
import { useNotificationsStore } from "@/stores/notifications";
import { getDatabase } from "@/db/dexie"; // 1. 引入工厂
import { logger } from "@/utils/logger";
import { backfillEvents } from "@/utils/backfill";

// ... (decodeInteractionEvent, Like, Comment, Interaction 定义保持不变)

export const useInteractionsStore = defineStore("interactions", {
  state: () => ({
    // 依然保留内存中的 Map 方便 UI 快速读取，但数据源改为 Dexie
    interactions: new Map<string, Interaction[]>(),
    processedEvents: new Set<string>(),
    lastSyncedAt: 0,
    loadedFor: "" as string,
  }),

  actions: {
    // 2. 获取当前账号对应的物理库
    getDB() {
      const ks = useKeyStore();
      return getDatabase(this.loadedFor || ks.pkHex);
    },

    /**
     * 加载逻辑：从物理隔离的数据库读取
     */
    async load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;
      if (!targetPk) return;

      if (this.loadedFor === targetPk) return;
      this.loadedFor = targetPk;

      const db = this.getDB();

      try {
        // 1. 加载所有互动数据
        const allInteractions = await db.interactions.toArray();
        const newMap = new Map<string, Interaction[]>();
        
        allInteractions.forEach((item: any) => {
          const list = newMap.get(item.messageId) || [];
          list.push(item);
          newMap.set(item.messageId, list);
        });
        this.interactions = newMap;

        // 2. 加载元数据 (lastSyncedAt 和 processedEvents)
        const metaData = await db.meta.get("interactions_meta");
        if (metaData) {
          this.lastSyncedAt = metaData.value.lastSyncedAt || 0;
          this.processedEvents = new Set(metaData.value.processedEvents || []);
        } else {
          this.lastSyncedAt = 0;
          this.processedEvents = new Set();
        }
      } catch (e) {
        logger.error("Failed to load interactions from Dexie", e);
      }
    },

    /**
     * 核心写入：存入物理库
     */
    async _saveInteractionToDb(interaction: Interaction) {
      const db = this.getDB();
      await db.interactions.put(interaction as any);
      
      // 更新元数据
      await db.meta.put({
        key: "interactions_meta",
        value: {
          lastSyncedAt: this.lastSyncedAt,
          processedEvents: [...this.processedEvents]
        }
      });
    },

    async sendLike(messageId: string, messageAuthor: string) {
      const key = useKeyStore();
      if (!key.isLoggedIn) throw new Error("未登录");
      
      const interaction: Like = {
        id: crypto.randomUUID(),
        messageId,
        author: key.pkHex,
        timestamp: Math.floor(Date.now() / 1000),
        type: 'like'
      };
      
      await this._sendInteraction(interaction, messageAuthor);
      await this._addInteraction(messageId, interaction); // 内部会调用 DB 保存
    },

    async sendComment(messageId: string, messageAuthor: string, text: string, parentCommentId?: string) {
      const key = useKeyStore();
      if (!key.isLoggedIn) throw new Error("未登录");
      
      const interaction: Comment = {
        id: crypto.randomUUID(),
        messageId,
        author: key.pkHex,
        text: text.trim(),
        timestamp: Math.floor(Date.now() / 1000),
        type: 'comment',
        parentCommentId
      };
      
      await this._sendInteraction(interaction, messageAuthor);
      await this._addInteraction(messageId, interaction);
    },

    async _addInteraction(messageId: string, interaction: Interaction) {
      const items = this.interactions.get(messageId) || [];
      
      // 去重逻辑 (保持不变)
      if (interaction.type === 'like') {
        if (items.some(i => i.type === 'like' && i.author === interaction.author)) return;
      } else if (interaction.type === 'comment') {
        if (items.some(i => i.type === 'comment' && i.id === interaction.id)) return;
      }
      
      items.push(interaction);
      this.interactions.set(messageId, items);

      // 物理保存到当前账号的数据库
      await this._saveInteractionToDb(interaction);
    },

    // 修改：将 processedEvents 同步保存
    async processInteractionEvent(evt: any, myPubkey: string) {
      if (this.processedEvents.has(evt.id)) return;

      const key = useKeyStore();
      const interaction = await decodeInteractionEvent(evt, myPubkey, key);
      if (!interaction) return;

      this.processedEvents.add(evt.id);
      this._emitNotificationFromInteraction(evt, interaction, myPubkey);
      await this._addInteraction(interaction.messageId, interaction);

      if (evt.created_at && evt.created_at > this.lastSyncedAt) {
        this.lastSyncedAt = evt.created_at;
      }
    },

    reset(removeFromStorage = false) {
      const db = this.getDB();
      const pk = this.loadedFor;

      this.interactions.clear();
      this.processedEvents.clear();
      this.lastSyncedAt = 0;
      this.loadedFor = "";

      if (removeFromStorage && pk) {
        db.interactions.clear();
        db.meta.delete("interactions_meta");
      }
    }
  }
});
