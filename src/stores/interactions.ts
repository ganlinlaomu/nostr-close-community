import { defineStore } from "pinia";
import { pool } from "@/nostr/relays";
import { getRelaysFromStorage } from "@/nostr/relays";
import { useKeyStore } from "@/stores/keys";
import { logger } from "@/utils/logger";
import { backfillEvents } from "@/utils/backfill";

/**
 * Interaction types
 */
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

/**
 * Decode NIP-44 encrypted interaction
 */
async function decodeInteractionEvent(
  evt: any,
  myPubkey: string
): Promise<Interaction | null> {
  const key = useKeyStore();

  try {
    if (!evt.content) return null;

    // 🔐 NIP-44 decrypt (sender pubkey is evt.pubkey)
    const plain = await key.nip44Decrypt(evt.pubkey, evt.content);
    const interaction: Interaction = JSON.parse(plain);

    if (!interaction?.type || !interaction?.messageId) {
      logger.warn("[interaction] invalid payload", evt.id);
      return null;
    }

    return interaction;
  } catch (e) {
    logger.debug("[interaction] decrypt failed", evt.id);
    return null;
  }
}

export const useInteractionsStore = defineStore("interactions", {
  state: () => ({
    interactions: new Map<string, Interaction[]>(),
    processedEvents: new Set<string>(),
    lastSyncedAt: 0
  }),

  getters: {
    getLikes: (state) => (messageId: string) =>
      (state.interactions.get(messageId) || []).filter(i => i.type === "like") as Like[],

    getComments: (state) => (messageId: string) =>
      (state.interactions.get(messageId) || []).filter(i => i.type === "comment") as Comment[],

    getLikeCount: (state) => (messageId: string) =>
      (state.interactions.get(messageId) || []).filter(i => i.type === "like").length,

    isLikedByUser: (state) => (messageId: string, pubkey: string) =>
      (state.interactions.get(messageId) || []).some(
        i => i.type === "like" && i.author === pubkey
      )
  },

  actions: {
    async sendLike(messageId: string, messageAuthor: string) {
      const key = useKeyStore();
      if (!key.isLoggedIn) throw new Error("未登录");

      const interaction: Like = {
        id: crypto.randomUUID(),
        messageId,
        author: key.pkHex,
        timestamp: Math.floor(Date.now() / 1000),
        type: "like"
      };

      await this._sendInteraction(interaction, messageAuthor);
      this._addInteraction(messageId, interaction);
    },

    async sendComment(
      messageId: string,
      messageAuthor: string,
      text: string,
      parentCommentId?: string
    ) {
      const key = useKeyStore();
      if (!key.isLoggedIn) throw new Error("未登录");

      const interaction: Comment = {
        id: crypto.randomUUID(),
        messageId,
        author: key.pkHex,
        text,
        timestamp: Math.floor(Date.now() / 1000),
        type: "comment",
        parentCommentId
      };

      await this._sendInteraction(interaction, messageAuthor);
      this._addInteraction(messageId, interaction);
    },

    async _sendInteraction(interaction: Interaction, recipientPubkey: string) {
      const key = useKeyStore();

      const plaintext = JSON.stringify(interaction);

      // 🔐 NIP-44 encrypt
      const encrypted = await key.nip44Encrypt(recipientPubkey, plaintext);

      const event = {
        kind: 8965,
        pubkey: key.pkHex,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["e", interaction.messageId],
          ["p", recipientPubkey]
        ],
        content: encrypted
      };

      const signed = await key.signEvent(event);
      await pool.publish(getRelaysFromStorage(), signed);
    },

    async processInteractionEvent(evt: any, myPubkey: string) {
      if (this.processedEvents.has(evt.id)) return;

      const interaction = await decodeInteractionEvent(evt, myPubkey);
      if (!interaction) return;

      this.processedEvents.add(evt.id);
      this._addInteraction(interaction.messageId, interaction);

      if (evt.created_at > this.lastSyncedAt) {
        this.lastSyncedAt = evt.created_at;
      }
    },

    _addInteraction(messageId: string, interaction: Interaction) {
      const list = this.interactions.get(messageId) || [];

      if (
        interaction.type === "like" &&
        list.some(i => i.type === "like" && i.author === interaction.author)
      ) {
        return;
      }

      list.push(interaction);
      this.interactions.set(messageId, list);
      this._save();
    },

    load() {
      const key = useKeyStore();
      if (!key.pkHex) return;

      const raw = localStorage.getItem(`interactions_${key.pkHex}`);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      this.interactions = new Map(Object.entries(parsed.interactions || {}));
      this.lastSyncedAt = parsed.lastSyncedAt || 0;
    },

    _save() {
      const key = useKeyStore();
      if (!key.pkHex) return;

      const obj: any = {};
      this.interactions.forEach((v, k) => (obj[k] = v));

      localStorage.setItem(
        `interactions_${key.pkHex}`,
        JSON.stringify({
          interactions: obj,
          lastSyncedAt: this.lastSyncedAt
        })
      );
    }
  }
});
