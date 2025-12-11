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
  parentCommentId?: string; // Optional: ID of parent comment for replies
}

export type Interaction = Like | Comment;

export const useInteractionsStore = defineStore("interactions", {
  state: () => ({
    // Map of messageId -> array of interactions
    interactions: new Map<string, Interaction[]>(),
    // Map of interaction event id -> interaction (to avoid duplicates)
    processedEvents: new Set<string>(),
    // Latest synced timestamp for incremental backfill
    lastSyncedAt: 0,
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
          
          // Update lastSyncedAt to track the most recent event
          if (evt.created_at && evt.created_at > this.lastSyncedAt) {
            this.lastSyncedAt = evt.created_at;
          }
          
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
          
          // Backward compatibility: check if data has new structure or old structure
          if (data && typeof data === 'object' && 'interactions' in data) {
            // New structure: { interactions: {...}, lastSyncedAt: number }
            this.interactions = new Map(Object.entries(data.interactions || {}));
            this.lastSyncedAt = data.lastSyncedAt || 0;
          } else {
            // Old structure: direct map of messageId -> interactions
            this.interactions = new Map(Object.entries(data));
            this.lastSyncedAt = 0;
          }
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
        const interactionsObj: Record<string, Interaction[]> = {};
        
        this.interactions.forEach((value, key) => {
          interactionsObj[key] = value;
        });
        
        // Save new structure with lastSyncedAt
        const data = {
          interactions: interactionsObj,
          lastSyncedAt: this.lastSyncedAt
        };
        
        localStorage.setItem(storageKey, JSON.stringify(data));
      } catch (e) {
        logger.warn("Failed to save interactions", e);
      }
    },
    
    /**
     * Backfill interactions from relays for multi-device sync
     * 
     * This method implements incremental sync by fetching interactions
     * since the last synced timestamp, ensuring no interactions are missed
     * across devices.
     */
    async backfillInteractions(options: {
      relays: string[];
      since?: number;
      until?: number;
      maxBatches?: number;
      onProgress?: (fetched: number, processed: number) => void;
    }) {
      const key = useKeyStore();
      if (!key.pkHex) {
        logger.warn("Cannot backfill interactions: not logged in");
        return { fetched: 0, processed: 0 };
      }
      
      const {
        relays,
        since = this.lastSyncedAt, // Default to last synced timestamp for incremental sync
        until = Math.floor(Date.now() / 1000),
        maxBatches = 10,
        onProgress
      } = options;
      
      logger.info(`开始回填互动事件: since=${since ? new Date(since * 1000).toLocaleString() : 'beginning'}, until=${new Date(until * 1000).toLocaleString()}`);
      
      let fetchedCount = 0;
      let processedCount = 0;
      let maxTimestamp = this.lastSyncedAt;
      
      try {
        // Import backfillEvents dynamically to avoid circular dependencies
        const { backfillEvents } = await import("@/utils/backfill");
        
        const processEvent = async (evt: any) => {
          fetchedCount++;
          try {
            await this.processInteractionEvent(evt, key.pkHex);
            processedCount++;
            
            // Track the maximum timestamp we've seen
            if (evt.created_at && evt.created_at > maxTimestamp) {
              maxTimestamp = evt.created_at;
            }
            
            if (onProgress) {
              onProgress(fetchedCount, processedCount);
            }
          } catch (e) {
            logger.warn("处理回填互动事件失败", e);
          }
        };
        
        // Use backfill utility with time-based pagination
        await backfillEvents({
          relays,
          filters: {
            kinds: [24243],
            "#p": [key.pkHex], // Only get interactions targeted at us
            since,
            until
          },
          onEvent: processEvent,
          onProgress: (stats) => {
            logger.debug(`回填互动进度: ${stats.totalEvents} 条事件`);
          },
          onComplete: (stats) => {
            logger.info(`互动事件回填完成: 获取 ${fetchedCount} 条, 处理 ${processedCount} 条`);
          },
          batchSize: 500,
          maxBatches,
          timeoutMs: 10000
        });
        
        // Update lastSyncedAt to the maximum timestamp we've seen
        // This ensures we don't re-fetch the same events on next sync
        if (maxTimestamp > this.lastSyncedAt) {
          this.lastSyncedAt = maxTimestamp;
          this._saveToStorage();
          logger.info(`更新最后同步时间戳: ${new Date(maxTimestamp * 1000).toLocaleString()}`);
        }
        
        return { fetched: fetchedCount, processed: processedCount };
      } catch (e) {
        logger.error("回填互动事件失败", e);
        return { fetched: fetchedCount, processed: processedCount };
      }
    }
  }
});
