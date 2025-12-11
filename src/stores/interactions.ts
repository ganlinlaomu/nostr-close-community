import { defineStore } from "pinia";
import { pool } from "@/nostr/relays";
import { getRelaysFromStorage } from "@/nostr/relays";
import { useKeyStore } from "@/stores/keys";
import { genSymHex, symEncryptPackage, symDecryptPackage, normalizeSymKey } from "@/nostr/crypto";
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
  parentCommentId?: string; // Optional: ID of parent comment for replies
}

export type Interaction = Like | Comment;

// Debounce timer for saving timestamp
let saveTimestampTimer: number | null = null;

export const useInteractionsStore = defineStore("interactions", {
  state: () => ({
    // Map of messageId -> array of interactions
    interactions: new Map<string, Interaction[]>(),
    // Map of interaction event id -> interaction (to avoid duplicates)
    processedEvents: new Set<string>(),
    // Track the latest interaction event timestamp for backfill
    latestInteractionTimestamp: 0,
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
    
    getReplies: (state) => (messageId: string, parentCommentId: string): Comment[] => {
      const items = state.interactions.get(messageId) || [];
      return items.filter(i => 
        i.type === 'comment' && (i as Comment).parentCommentId === parentCommentId
      ) as Comment[];
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
        id: typeof crypto !== 'undefined' && crypto.randomUUID 
          ? crypto.randomUUID() 
          : Date.now().toString() + '-' + Math.random().toString(36).slice(2, 11),
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
    async sendComment(messageId: string, messageAuthor: string, text: string, parentCommentId?: string) {
      const key = useKeyStore();
      if (!key.isLoggedIn) throw new Error("未登录");
      
      const interaction: Comment = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID 
          ? crypto.randomUUID() 
          : Date.now().toString() + '-' + Math.random().toString(36).slice(2, 11),
        messageId,
        author: key.pkHex,
        text: text.trim(),
        timestamp: Math.floor(Date.now() / 1000),
        type: 'comment',
        parentCommentId // Add parent comment ID if this is a reply
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
        
        // Track latest timestamp for backfill checkpoint
        if (evt.created_at && evt.created_at > this.latestInteractionTimestamp) {
          this.latestInteractionTimestamp = evt.created_at;
          this._saveLatestTimestampDebounced();
        }
        
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
          const normalizedKey = normalizeSymKey(symHex);
          const plain = await symDecryptPackage(normalizedKey, payload.pkg);
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
      
      // For likes: prevent duplicate likes from same user on same message
      if (interaction.type === 'like') {
        const existingLike = items.find(i => 
          i.type === 'like' && i.author === interaction.author
        );
        
        if (existingLike) {
          // User has already liked this message, don't add duplicate
          return;
        }
      } else if (interaction.type === 'comment') {
        // For comments: check for duplicates (same author, same text, same timestamp within 5 seconds)
        const isDuplicate = items.some(i => 
          i.type === 'comment' &&
          i.author === interaction.author &&
          (i as Comment).text === (interaction as Comment).text &&
          Math.abs(i.timestamp - interaction.timestamp) < 5
        );
        
        if (isDuplicate) {
          return;
        }
      }
      
      // Add interaction if no duplicates found
      items.push(interaction);
      this.interactions.set(messageId, items);
      this._saveToStorage();
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
        
        // Load latest timestamp
        this._loadLatestTimestamp();
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
    },
    
    /**
     * Save the latest interaction timestamp
     */
    _saveLatestTimestamp() {
      try {
        const key = useKeyStore();
        if (!key.pkHex) return;
        
        const storageKey = `interactions_timestamp_${key.pkHex}`;
        localStorage.setItem(storageKey, String(this.latestInteractionTimestamp));
      } catch (e) {
        logger.warn("Failed to save latest interaction timestamp", e);
      }
    },
    
    /**
     * Save the latest interaction timestamp with debouncing to reduce I/O
     */
    _saveLatestTimestampDebounced() {
      // Clear any pending save
      if (saveTimestampTimer !== null) {
        clearTimeout(saveTimestampTimer);
      }
      
      // Schedule a new save after 1 second of inactivity
      saveTimestampTimer = window.setTimeout(() => {
        this._saveLatestTimestamp();
        saveTimestampTimer = null;
      }, 1000);
    },
    
    /**
     * Load the latest interaction timestamp
     */
    _loadLatestTimestamp() {
      try {
        const key = useKeyStore();
        if (!key.pkHex) return;
        
        const storageKey = `interactions_timestamp_${key.pkHex}`;
        const stored = localStorage.getItem(storageKey);
        
        if (stored) {
          const ts = parseInt(stored, 10);
          if (!isNaN(ts)) {
            this.latestInteractionTimestamp = ts;
          }
        }
      } catch (e) {
        logger.warn("Failed to load latest interaction timestamp", e);
      }
    }
  }
});
