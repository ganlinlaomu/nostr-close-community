import { defineStore } from "pinia";
import { pool } from "@/nostr/relays";
import { getRelaysFromStorage } from "@/nostr/relays";
import { useKeyStore } from "@/stores/keys";
import { genSymHex, symEncryptPackage, symDecryptPackage } from "@/nostr/crypto";
import { useNotificationsStore } from "@/stores/notifications";
import { logger } from "@/utils/logger";
import { getCurrentDatabase } from "@/db/dexie";

/* ------------------------------------------------------------------ */
/* Types */
/* ------------------------------------------------------------------ */

export interface Like {
  id: string;
  messageId: string;
  author: string;
  timestamp: number;
  type: "like";
}

export interface Comment {
  id: string;
  messageId: string;
  author: string;
  text: string;
  timestamp: number;
  type: "comment";
  parentCommentId?: string;
}

export type Interaction = Like | Comment;

/* ------------------------------------------------------------------ */
/* Decode Event */
/* ------------------------------------------------------------------ */

async function decodeInteractionEvent(evt: any, myPubkey: string, keyStore: any) {
  try {
    const payload = JSON.parse(evt.content);
    if (!payload?.keys || !payload?.pkg) return null;

    const myEntry = payload.keys.find((k: any) => k.to === myPubkey);
    if (!myEntry) return null;

    let symHex: string;
    try {
      symHex = await keyStore.nip04Decrypt(evt.pubkey, myEntry.enc);
    } catch {
      if (/^[0-9a-fA-F]{64}$/.test(myEntry.enc)) symHex = myEntry.enc;
      else return null;
    }

    const plain = await symDecryptPackage(symHex, payload.pkg);
    const interaction: Interaction = JSON.parse(plain);
    if (!interaction.messageId || !interaction.type) return null;

    return interaction;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Store */
/* ------------------------------------------------------------------ */

export const useInteractionsStore = defineStore("interactions", {
  state: () => ({
    interactions: new Map<string, Interaction[]>(),
    processedEvents: new Set<string>(),
    lastSyncedAt: 0,
    loadedFor: ""
  }),

  getters: {
    getLikes: s => (id: string) =>
      (s.interactions.get(id) || []).filter(i => i.type === "like") as Like[],
    getComments: s => (id: string) =>
      (s.interactions.get(id) || []).filter(i => i.type === "comment") as Comment[],
    getCommentCount: s => (id: string) =>
      (s.interactions.get(id) || []).filter(i => i.type === "comment").length,
    isLikedByUser: s => (id: string, pk: string) =>
      (s.interactions.get(id) || []).some(i => i.type === "like" && i.author === pk)
  },

  actions: {
    /* =========================
     * Load (Dexie, pk isolated)
     * ========================= */

    async load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;
      if (!targetPk) return;

      if (this.loadedFor !== targetPk) {
        this.$reset();
        this.loadedFor = targetPk;
      }

      const db = getCurrentDatabase();

      try {
        const rows = await db.messages.toArray();
        this.interactions.clear();

        for (const r of rows) {
          const arr = this.interactions.get((r as any).messageId) || [];
          arr.push(r as any);
          this.interactions.set((r as any).messageId, arr);
        }

        const meta = await db.meta.get("interactions_meta");
        if (meta?.value) {
          this.lastSyncedAt = meta.value.lastSyncedAt || 0;
          this.processedEvents = new Set(meta.value.processedEvents || []);
        }
      } catch (e) {
        logger.error("[Interactions] load failed", e);
      }
    },

    async _persistMeta() {
      if (!this.loadedFor) return;
      const db = getDatabase(this.loadedFor);
      await db.meta.put({
        key: "interactions_meta",
        value: {
          lastSyncedAt: this.lastSyncedAt,
          processedEvents: Array.from(this.processedEvents)
        }
      });
    },

    /* =========================
     * Send comment
     * ========================= */

    async sendComment(messageId: string, messageAuthor: string, text: string, parentCommentId?: string) {
      const ks = useKeyStore();
      if (!ks.isLoggedIn) throw new Error("未登录");

      const interaction: Comment = {
        id: crypto.randomUUID(),
        messageId,
        author: ks.pkHex,
        text: text.trim(),
        timestamp: Math.floor(Date.now() / 1000),
        type: "comment",
        parentCommentId
      };

      await this._sendInteraction(interaction, messageAuthor);
      this._addInteraction(interaction);
    },

    async processInteractionEvent(evt: any, myPubkey: string) {
      if (this.processedEvents.has(evt.id)) return;

      const ks = useKeyStore();
      const interaction = await decodeInteractionEvent(evt, myPubkey, ks);
      if (!interaction) return;

      this.processedEvents.add(evt.id);
      this._emitNotificationFromInteraction(evt, interaction, myPubkey);
      this._addInteraction(interaction);

      this.lastSyncedAt = Math.max(this.lastSyncedAt, evt.created_at);
      await this._persistMeta();
    },

    _addInteraction(interaction: Interaction) {
      const arr = this.interactions.get(interaction.messageId) || [];
      if (arr.some(i => i.id === interaction.id)) return;

      arr.push(interaction);
      this.interactions.set(interaction.messageId, arr);

      const db = getDatabase(this.loadedFor);
      db.messages.put(interaction as any);
    },

    _emitNotificationFromInteraction(evt: any, interaction: Interaction, myPubkey: string) {
      if (interaction.author === myPubkey) return;
      useNotificationsStore().addNotification({
        id: evt.id,
        type: interaction.type,
        from: interaction.author,
        messageId: interaction.messageId,
        commentId: interaction.type === "comment" ? interaction.id : undefined,
        created_at: interaction.timestamp,
        read: false
      });
    },

    async _sendInteraction(interaction: Interaction, recipientPubkey: string) {
      const ks = useKeyStore();
      const symHex = genSymHex();
      const pkg = await symEncryptPackage(symHex, JSON.stringify(interaction));

      const recipients = Array.from(new Set([recipientPubkey, ks.pkHex]));
      const keys = [];
      for (const r of recipients) {
        keys.push({ to: r, enc: await ks.nip04Encrypt(r, symHex) });
      }

      const event = await ks.signEvent({
        kind: 8965,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["e", interaction.messageId], ["p", recipientPubkey]],
        content: JSON.stringify({ version: "nip-44-interaction-v1", keys, pkg })
      });

      await pool.publish(getRelaysFromStorage(), event);
    },

    reset() {
      this.$reset();
    }
  }
});
