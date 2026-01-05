import { defineStore } from "pinia";
import { pool } from "@/nostr/relays";
import { getRelaysFromStorage } from "@/nostr/relays";
import { useKeyStore } from "@/stores/keys";
import { genSymHex, symEncryptPackage, symDecryptPackage } from "@/nostr/crypto";
import { useNotificationsStore } from "@/stores/notifications";
import { logger } from "@/utils/logger";
import { backfillEvents } from "@/utils/backfill";

/* ------------------------------------------------------------------ */
/* Types & Interfaces */
/* ------------------------------------------------------------------ */

export interface Like {
  id: string;
  messageId: string;
  author: string;
  timestamp: number;
  type: 'like';
}

export interface Comment {
  id: string;
  messageId: string;
  author: string;
  text: string;
  timestamp: number;
  type: 'comment';
  parentCommentId?: string;
}

export type Interaction = Like | Comment;

/* ------------------------------------------------------------------ */
/* Helper: Decode Event (kind 8965) */
/* ------------------------------------------------------------------ */

async function decodeInteractionEvent(
  evt: any,
  myPubkey: string,
  keyStore: any
): Promise<Interaction | null> {
  try {
    let payload: any;
    try {
      payload = JSON.parse(evt.content);
    } catch (e) { return null; }

    if (!payload?.keys || !payload?.pkg) return null;

    const myEntry = payload.keys.find((k: any) => k.to === myPubkey);
    if (!myEntry) return null;

    let symHex: string;
    try {
      symHex = await keyStore.nip04Decrypt(evt.pubkey, myEntry.enc);
    } catch (e) {
      if (typeof myEntry.enc === "string" && /^[0-9a-fA-F]{64}$/.test(myEntry.enc)) {
        symHex = myEntry.enc;
      } else { return null; }
    }

    const plain = await symDecryptPackage(symHex, payload.pkg);
    const interaction: Interaction = JSON.parse(plain);

    if (!interaction.messageId || !interaction.type) return null;
    return interaction;
  } catch (e) {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Store Definition */
/* ------------------------------------------------------------------ */

export const useInteractionsStore = defineStore("interactions", {
  state: () => ({
    interactions: new Map<string, Interaction[]>(),
    processedEvents: new Set<string>(),
    lastSyncedAt: 0,
    loadedFor: "", // 核心：记录当前加载的公钥
  }),

  getters: {
    getLikes: (state) => (messageId: string): Like[] => {
      return (state.interactions.get(messageId) || []).filter(i => i.type === 'like') as Like[];
    },
    getComments: (state) => (messageId: string): Comment[] => {
      return (state.interactions.get(messageId) || []).filter(i => i.type === 'comment') as Comment[];
    },
    getCommentCount: (state) => (messageId: string): number => {
      return (state.interactions.get(messageId) || []).filter(i => i.type === 'comment').length;
    },
    isLikedByUser: (state) => (messageId: string, userPubkey: string): boolean => {
      return (state.interactions.get(messageId) || []).some(i => i.type === 'like' && i.author === userPubkey);
    },
  },

  actions: {
    /**
     * 加载数据（带账号隔离保护）
     */
    async load() {
      const ks = useKeyStore();
      const targetPk = ks.pkHex;
      if (!targetPk) return;

      // 如果已加载该账号，直接返回
      if (this.loadedFor === targetPk) return;

      try {
        const storageKey = `interactions_${targetPk}`;
        const stored = localStorage.getItem(storageKey);

        // 切换账号时清空旧内存
        this.interactions.clear();
        this.processedEvents.clear();

        if (stored) {
          const data = JSON.parse(stored);
          if (data?.interactions) {
            this.interactions = new Map(Object.entries(data.interactions));
            this.lastSyncedAt = data.lastSyncedAt || 0;
          } else {
            this.interactions = new Map(Object.entries(data || {}));
          }
        }
        this.loadedFor = targetPk;
        logger.debug(`[Interactions] Loaded for ${targetPk.slice(0, 8)}`);
      } catch (e) {
        logger.error("[Interactions] Load failed", e);
      }
    },

    /**
     * 保存到本地存储
     */
    _saveToStorage() {
      if (!this.loadedFor) return;
      try {
        const obj: any = {};
        this.interactions.forEach((v, k) => { obj[k] = v; });
        localStorage.setItem(`interactions_${this.loadedFor}`, JSON.stringify({
          interactions: obj,
          lastSyncedAt: this.lastSyncedAt
        }));
      } catch (e) {
        logger.warn("[Interactions] Save failed", e);
      }
    },

    /**
     * 发送评论
     */
    async sendComment(messageId: string, messageAuthor: string, text: string, parentCommentId?: string) {
      const ks = useKeyStore();
      if (!ks.isLoggedIn) throw new Error("未登录");

      const interaction: Comment = {
        id: crypto.randomUUID?.() || Math.random().toString(36),
        messageId,
        author: ks.pkHex,
        text: text.trim(),
        timestamp: Math.floor(Date.now() / 1000),
        type: 'comment',
        parentCommentId
      };

      await this._sendInteraction(interaction, messageAuthor);
      this._addInteraction(messageId, interaction);
    },

    /**
     * 处理收到的 Nostr 事件
     */
    async processInteractionEvent(evt: any, myPubkey: string) {
      if (this.processedEvents.has(evt.id)) return;

      const ks = useKeyStore();
      const interaction = await decodeInteractionEvent(evt, myPubkey, ks);

      if (interaction) {
        this.processedEvents.add(evt.id);
        this._emitNotificationFromInteraction(evt, interaction, myPubkey);
        this._addInteraction(interaction.messageId, interaction);
        
        if (evt.created_at > this.lastSyncedAt) {
          this.lastSyncedAt = evt.created_at;
        }
      }
    },

    _addInteraction(messageId: string, interaction: Interaction) {
      const items = this.interactions.get(messageId) || [];
      // 简单去重逻辑
      const isDup = items.some(i => i.id === interaction.id || (i.type === interaction.type && i.author === interaction.author && i.timestamp === interaction.timestamp));
      if (isDup) return;

      items.push(interaction);
      this.interactions.set(messageId, items);
      this._saveToStorage();
    },

    _emitNotificationFromInteraction(evt: any, interaction: Interaction, myPubkey: string) {
      if (interaction.author === myPubkey) return;
      const notifications = useNotificationsStore();
      notifications.addNotification({
        id: evt.id,
        type: interaction.type,
        from: interaction.author,
        messageId: interaction.messageId,
        commentId: interaction.type === "comment" ? interaction.id : undefined,
        created_at: interaction.timestamp,
        read: false,
      });
    },

    async _sendInteraction(interaction: Interaction, recipientPubkey: string) {
      const ks = useKeyStore();
      const plaintext = JSON.stringify(interaction);
      const symHex = genSymHex();
      const pkg = await symEncryptPackage(symHex, plaintext);

      // 给对方和自己都加密一份对称密钥
      const recipients = Array.from(new Set([recipientPubkey, ks.pkHex]));
      const keysArr = [];
      for (const r of recipients) {
        const enc = await ks.nip04Encrypt(r, symHex);
        keysArr.push({ to: r, enc });
      }

      const event = {
        kind: 8965,
        pubkey: ks.pkHex,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["e", interaction.messageId], ["p", recipientPubkey]],
        content: JSON.stringify({ version: "nip-44-interaction-v1", keys: keysArr, pkg })
      };

      const signed = await ks.signEvent(event);
      await pool.publish(getRelaysFromStorage(), signed);
    },

    reset(removeFromStorage = false) {
      const pk = this.loadedFor;
      this.interactions.clear();
      this.processedEvents.clear();
      this.lastSyncedAt = 0;
      this.loadedFor = "";
      if (removeFromStorage && pk) {
        localStorage.removeItem(`interactions_${pk}`);
      }
    }
  }
});
