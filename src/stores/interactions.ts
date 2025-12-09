import { defineStore } from "pinia";
import { pool } from "@/nostr/relays";
import { getRelaysFromStorage } from "@/nostr/relays";
import { useKeyStore } from "@/stores/keys";
import { genSymHex, symEncryptPackage, symDecryptPackage } from "@/nostr/crypto";
import { logger } from "@/utils/logger";

/**
 * Interactions store - handles encrypted likes and comments
 * Uses kind 24243 for encrypted interactions (likes/comments)
 */

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
}

export type Interaction = Like | Comment;

export const useInteractionsStore = defineStore("interactions", {
  state: () => ({
    // Map of messageId -> array of interactions
    interactions: new Map<string, Interaction[]>(),
    // Map of interaction event id -> interaction (to avoid duplicates)
    processedEvents: new Set<string>(),
  }),
  
  getters: {
    getLikes: (state) => (messageId: string): Like[] => {
      const items = state.interactions.get(messageId) || [];
      return items.filter(i => i.type === 'like') as Like[];
    },
    
    getComments: (state) => (messageId: string): Comment[] => {
      const items = state.interactions.get(messageId) || [];
      return items.filter(i => i.type === 'comment') as Comment[];
    },
    
    getLikeCount: (state) => (messageId: string): number => {
      const items = state.interactions.get(messageId) || [];
      return items.filter(i => i.type === 'like').length;
    },
    
    getCommentCount: (state) => (messageId: string): number => {
      const items = state.interactions.get(messageId) || [];
      return items.filter(i => i.type === 'comment').length;
    },
    
    isLikedByUser: (state) => (messageId: string, userPubkey: string): boolean => {
      const items = state.interactions.get(messageId) || [];
      return items.some(i => i.type === 'like' && i.author === userPubkey);
    },
  },
  
  actions: {
    /**
     * Send an encrypted like to the message author
     */
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
      
      // Add to local state immediately for instant feedback
      this._addInteraction(messageId, interaction);
    },
    
    /**
     * Send an encrypted comment to the message author
     */
    async sendComment(messageId: string, messageAuthor: string, text: string) {
      const key = useKeyStore();
      if (!key.isLoggedIn) throw new Error("未登录");
      
      const interaction: Comment = {
        id: crypto.randomUUID(),
        messageId,
        author: key.pkHex,
        text: text.trim(),
        timestamp: Math.floor(Date.now() / 1000),
        type: 'comment'
      };
      
      await this._sendInteraction(interaction, messageAuthor);
      
      // Add to local state immediately for instant feedback
      this._addInteraction(messageId, interaction);
    },
    
    /**
     * Remove a like (unlike)
     */
    async removeLike(messageId: string, messageAuthor: string) {
      const key = useKeyStore();
      if (!key.isLoggedIn) return;
      
      const items = this.interactions.get(messageId) || [];
      const likeIndex = items.findIndex(i => i.type === 'like' && i.author === key.pkHex);
      
      if (likeIndex !== -1) {
        items.splice(likeIndex, 1);
        this.interactions.set(messageId, items);
        this._saveToStorage();
        
        // Note: In a full implementation, we'd send a "remove like" event
        // For now, we just remove it locally
      }
    },
    
    /**
     * Private: Send encrypted interaction event
     */
    async _sendInteraction(interaction: Interaction, recipientPubkey: string) {
      const key = useKeyStore();
      if (!key.isLoggedIn) throw new Error("未登录");
      
      // Create encrypted payload
      const plaintext = JSON.stringify(interaction);
      const symHex = genSymHex();
      const pkg = await symEncryptPackage(symHex, plaintext);
      
      // Encrypt the symmetric key for the recipient and self
      const recipients = [recipientPubkey];
      if (key.pkHex !== recipientPubkey) {
        recipients.push(key.pkHex); // Include self to see own interactions
      }
      
      const keysArr: Array<{ to: string; enc: string }> = [];
      for (const r of recipients) {
        try {
          const enc = await key.nip04Encrypt(r, symHex);
          keysArr.push({ to: r, enc });
        } catch (e) {
          logger.warn("envelope encrypt failed for", r, e);
          keysArr.push({ to: r, enc: "" });
        }
      }
      
      const payload = {
        version: "nip-44-interaction-v1",
        keys: keysArr,
        pkg
      };
      
      const contentStr = JSON.stringify(payload);
      
      // Create event with kind 24243 for interactions
      const event: any = {
        kind: 24243,
        pubkey: key.pkHex,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["e", interaction.messageId], // Reference to the message
          ["p", recipientPubkey] // Target user
        ],
        content: contentStr
      };
      
      const signed = await key.signEvent(event);
      
      const relays = getRelaysFromStorage();
      
      try {
        await pool.publish(relays, signed);
        logger.debug("published interaction", { interaction, signed });
      } catch (e) {
        logger.warn("publish interaction failed", e);
        throw e;
      }
    },
    
    /**
     * Process received interaction event
     */
    async processInteractionEvent(evt: any, myPubkey: string) {
      try {
        // Avoid processing duplicates
        if (this.processedEvents.has(evt.id)) return;
        this.processedEvents.add(evt.id);
        
        // Parse payload
        let payload: any;
        try {
          payload = JSON.parse(evt.content);
        } catch {
          return;
        }
        
        if (!payload?.keys || !payload?.pkg) return;
        
        // Find our key entry
        const myEntry = payload.keys.find((k: any) => k.to === myPubkey);
        if (!myEntry) return;
        
        // Decrypt symmetric key
        const key = useKeyStore();
        let symHex: string | null = null;
        try {
          symHex = await key.nip04Decrypt(evt.pubkey, myEntry.enc);
        } catch (e) {
          logger.warn("nip04.decrypt failed", e);
          if (typeof myEntry.enc === "string" && /^[0-9a-fA-F]{64}$/.test(myEntry.enc)) {
            symHex = myEntry.enc;
          } else {
            return;
          }
        }
        
        // Decrypt interaction
        try {
          const plain = await symDecryptPackage(symHex, payload.pkg);
          const interaction: Interaction = JSON.parse(plain);
          
          // Validate interaction
          if (!interaction.messageId || !interaction.type) return;
          
          // Add to state
          this._addInteraction(interaction.messageId, interaction);
          
          logger.debug("processed interaction", { interaction });
        } catch (e) {
          logger.warn("symDecryptPackage failed", e);
        }
      } catch (e) {
        logger.warn("process interaction event failed", e);
      }
    },
    
    /**
     * Private: Add interaction to state
     */
    _addInteraction(messageId: string, interaction: Interaction) {
      const items = this.interactions.get(messageId) || [];
      
      // Check for duplicates (same author, same type, same timestamp within 5 seconds)
      const isDuplicate = items.some(i => 
        i.author === interaction.author &&
        i.type === interaction.type &&
        Math.abs(i.timestamp - interaction.timestamp) < 5
      );
      
      if (!isDuplicate) {
        items.push(interaction);
        this.interactions.set(messageId, items);
        this._saveToStorage();
      }
    },
    
    /**
     * Load interactions from localStorage
     */
    load() {
      try {
        const key = useKeyStore();
        if (!key.pkHex) return;
        
        const storageKey = `interactions_${key.pkHex}`;
        const stored = localStorage.getItem(storageKey);
        
        if (stored) {
          const data = JSON.parse(stored);
          this.interactions = new Map(Object.entries(data));
        }
      } catch (e) {
        logger.warn("Failed to load interactions", e);
      }
    },
    
    /**
     * Save interactions to localStorage
     */
    _saveToStorage() {
      try {
        const key = useKeyStore();
        if (!key.pkHex) return;
        
        const storageKey = `interactions_${key.pkHex}`;
        const data: Record<string, Interaction[]> = {};
        
        this.interactions.forEach((value, key) => {
          data[key] = value;
        });
        
        localStorage.setItem(storageKey, JSON.stringify(data));
      } catch (e) {
        logger.warn("Failed to save interactions", e);
      }
    }
  }
});
