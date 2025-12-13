import { defineStore } from "pinia";
import { pool } from "@/nostr/relays";
import { getRelaysFromStorage } from "@/nostr/relays";
import { useKeyStore } from "@/stores/keys";
import { genSymHex, symEncryptPackage, symDecryptPackage } from "@/nostr/crypto";
import { logger } from "@/utils/logger";
import { backfillEvents } from "@/utils/backfill";

/**
 * Interactions store - handles encrypted likes and comments
 * Uses kind 24243 for encrypted interactions (likes/comments)
 */

/**
 * Decode an encrypted interaction event (kind 24243)
 * Standalone helper function to avoid 'this' binding issues
 * 
 * @param evt - The Nostr event to decode
 * @param myPubkey - The public key of the current user
 * @param keyStore - The key store instance for decryption
 * @returns The decoded Interaction object, or null if decoding failed
 */
async function decodeInteractionEvent(
  evt: any,
  myPubkey: string,
  keyStore: ReturnType<typeof useKeyStore>
): Promise<Interaction | null> {
  try {
    logger.info(`[互动事件] 收到事件 ${evt.id} pubkey=${evt.pubkey} created_at=${evt.created_at}`);
    
    // Parse payload
    let payload: any;
    try {
      payload = JSON.parse(evt.content);
    } catch (e) {
      logger.warn(`[互动事件] 解析失败 ${evt.id}: 无效的JSON内容`, e);
      return null;
    }
    
    if (!payload?.keys || !payload?.pkg) {
      logger.warn(`[互动事件] 解析失败 ${evt.id}: 缺少keys或pkg字段`);
      return null;
    }
    
    // Find our key entry
    const myEntry = payload.keys.find((k: any) => k.to === myPubkey);
    if (!myEntry) {
      logger.debug(`[互动事件] 跳过事件 ${evt.id}: 不是发给当前用户的`);
      return null;
    }
    
    // Decrypt symmetric key
    let symHex: string;
    try {
      symHex = await keyStore.nip04Decrypt(evt.pubkey, myEntry.enc);
    } catch (e) {
      logger.warn(`[互动事件] nip04解密失败 ${evt.id}`, e);
      // Fallback: check if enc is already a hex key
      if (typeof myEntry.enc === "string" && /^[0-9a-fA-F]{64}$/.test(myEntry.enc)) {
        symHex = myEntry.enc;
        logger.debug(`[互动事件] 使用回退方式：enc字段已是hex密钥`);
      } else {
        return null;
      }
    }
    
    // Decrypt interaction payload
    try {
      const plain = await symDecryptPackage(symHex, payload.pkg);
      const interaction: Interaction = JSON.parse(plain);
      
      // Validate interaction structure
      if (!interaction.messageId || !interaction.type) {
        logger.warn(`[互动事件] 解码失败 ${evt.id}: 缺少必需字段 (messageId或type)`);
        return null;
      }
      
      logger.info(`[互动事件] 解码成功 ${evt.id}: type=${interaction.type}, messageId=${interaction.messageId}, author=${interaction.author}`);
      return interaction;
    } catch (e) {
      logger.warn(`[互动事件] 解密包失败 ${evt.id}`, e);
      return null;
    }
  } catch (e) {
    logger.warn(`[互动事件] 解码/处理失败 ${evt.id}`, e);
    return null;
  }
}

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
     * Uses standalone decode helper to avoid 'this' binding issues
     */
    async processInteractionEvent(evt: any, myPubkey: string) {
      try {
        // Avoid processing duplicates
        if (this.processedEvents.has(evt.id)) {
          logger.debug(`[互动事件] 跳过重复事件 ${evt.id}`);
          return;
        }
        this.processedEvents.add(evt.id);
        
        // Decode the interaction using standalone helper
        const key = useKeyStore();
        const interaction = await decodeInteractionEvent(evt, myPubkey, key);
        
        if (!interaction) {
          // Decoding failed or event not relevant - already logged by helper
          return;
        }
        
        // Add to state
        this._addInteraction(interaction.messageId, interaction);
        logger.info(`[互动事件] 已写入store: ${interaction.type} on messageId=${interaction.messageId.substring(0, 8)}... by ${interaction.author.substring(0, 8)}...`);
        
        // Update lastSyncedAt to track the most recent event
        if (evt.created_at && evt.created_at > this.lastSyncedAt) {
          this.lastSyncedAt = evt.created_at;
        }
      } catch (e) {
        logger.warn(`[互动事件] 处理事件失败 ${evt.id}`, e);
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
          logger.debug(`[互动存储] 跳过重复点赞: messageId=${messageId.substring(0, 8)}... author=${interaction.author.substring(0, 8)}...`);
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
          logger.debug(`[互动存储] 跳过重复评论: messageId=${messageId.substring(0, 8)}... author=${interaction.author.substring(0, 8)}...`);
          return;
        }
      }
      
      // Add interaction if no duplicates found
      items.push(interaction);
      this.interactions.set(messageId, items);
      this._saveToStorage();
      logger.debug(`[互动存储] 已保存到Map: ${interaction.type} on messageId=${messageId.substring(0, 8)}..., 该消息共有 ${items.length} 个互动`);
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
     * This method fetches interactions using two filters for comprehensive coverage:
     * 1. Inbox: Interactions targeted at the user (#p tag) - for notifications and comments on user's posts
     * 2. Outbox: Interactions authored by the user - for cross-device sync of own interactions
     * 
     * For comprehensive sync, always fetches the last 3 days of data to ensure no interactions
     * are missed across devices with different online durations.
     * 
     * @returns Object with fetched and processed counts
     */
    async backfillInteractions(options: {
      relays: string[];
      since?: number;
      until?: number;
      maxBatches?: number;
      onProgress?: (fetched: number, processed: number) => void;
    }): Promise<{ fetched: number; processed: number }> {
      const key = useKeyStore();
      if (!key.pkHex) {
        logger.warn("Cannot backfill interactions: not logged in");
        return { fetched: 0, processed: 0 };
      }
      
      const {
        relays,
        since = 0,
        until = Math.floor(Date.now() / 1000),
        maxBatches = 10,
        onProgress
      } = options;
      
      logger.info(`开始回填互动事件: since=${since ? new Date(since * 1000).toLocaleString() : 'beginning'}, until=${new Date(until * 1000).toLocaleString()}`);
      
      let fetchedCount = 0;
      let processedCount = 0;
      let maxTimestamp = this.lastSyncedAt;
      
      try {
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
        
        // Build filters - we fetch interactions in two ways for privacy and comprehensive sync:
        // 1. Inbox: Interactions where user is mentioned (#p tag) - others' interactions sent to us
        // 2. Outbox: Interactions authored by user - our own interactions (for cross-device sync)
        const filters: any[] = [
          {
            kinds: [24243],
            "#p": [key.pkHex], // Inbox: interactions targeted at us
            since,
            until
          },
          {
            kinds: [24243],
            authors: [key.pkHex], // Outbox: our own interactions
            since,
            until
          }
        ];
        
        // Log the filters being used for debugging
        logger.info(`互动回填过滤器详情:`);
        logger.info(`  收件箱 (#p): kinds=[24243], #p=[${key.pkHex.substring(0, 8)}...], since=${new Date(since * 1000).toLocaleString()}, until=${new Date(until * 1000).toLocaleString()}`);
        logger.info(`  发件箱 (authors): kinds=[24243], authors=[${key.pkHex.substring(0, 8)}...], since=${new Date(since * 1000).toLocaleString()}, until=${new Date(until * 1000).toLocaleString()}`);
        
        // Fetch with each filter in parallel for better performance
        const filterPromises = filters.map((filter, i) => {
          const filterType = filter["#p"] ? "收件箱 (#p)" : "发件箱 (authors)";
          logger.debug(`回填互动过滤器 ${i + 1}/${filters.length}: ${filterType}`);
          
          return backfillEvents({
            relays,
            filters: filter,
            onEvent: processEvent,
            onProgress: (stats) => {
              logger.debug(`回填互动进度 (${filterType}): ${stats.totalEvents} 条事件`);
            },
            onComplete: (stats) => {
              logger.info(`互动过滤器 ${filterType} 完成: ${stats.totalEvents} 条事件`);
            },
            batchSize: 500,
            maxBatches,
            timeoutMs: 10000
          });
        });
        
        // Wait for all filters to complete
        await Promise.all(filterPromises);
        
        logger.info(`互动事件回填完成: 获取 ${fetchedCount} 条, 处理 ${processedCount} 条`);
        
        // Update lastSyncedAt after successful sync
        // If we found events, use the max timestamp; otherwise use 'until'
        // to mark this time range as successfully synced and avoid re-fetching
        const newSyncedAt = maxTimestamp > this.lastSyncedAt ? maxTimestamp : until;
        if (newSyncedAt > this.lastSyncedAt) {
          this.lastSyncedAt = newSyncedAt;
          this._saveToStorage();
          logger.info(`更新最后同步时间戳: ${new Date(newSyncedAt * 1000).toLocaleString()}`);
        }
        
        return { fetched: fetchedCount, processed: processedCount };
      } catch (e) {
        logger.error("回填互动事件失败", e);
        return { fetched: fetchedCount, processed: processedCount };
      }
    }
  }
});
