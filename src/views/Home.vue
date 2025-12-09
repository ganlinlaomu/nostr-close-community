<template>
  <div>
    <div class="card">
      <h3>信息流（时间线）</h3>
      <div class="small">已自动订阅你添加的好友，实时解密可读消息</div>
      <div class="small" style="margin-top:6px;">订阅状态: {{ status }}</div>
    </div>

    <div class="card">
      <h4>消息</h4>
      <div v-if="messages.length === 0" class="small">还没有消息</div>
      <div class="list">
        <div v-for="m in messages" :key="m.id" class="card">
          <div class="small">
            {{ displayName(m.pubkey) }}
            <span class="muted"> · {{ toLocalTime(m.created_at) }}</span>
          </div>

          <!-- 图片预览（方案 B：直接从内容抽取图片 URL 并渲染） -->
          <PostImagePreview :content="m.content" :showAll="false" style="margin-top:8px;" />

          <!-- 如果仍需显示文本（去除了图片 URL/Markdown），使用 textWithoutImages -->
          <div v-if="textWithoutImages(m.content)" class="message-text">{{ textWithoutImages(m.content) }}</div>
          
          <!-- 操作按钮：点赞和评论 -->
          <div class="message-actions">
            <button class="action-btn" @click="toggleLike(m)" :class="{ 'liked': isLiked(m.id) }">
              <span class="action-icon">{{ isLiked(m.id) ? '❤️' : '🤍' }}</span>
              <span class="action-text">{{ getLikeCount(m.id) }}</span>
            </button>
            <button class="action-btn" @click="toggleComments(m.id)">
              <span class="action-icon">💬</span>
              <span class="action-text">{{ getCommentCount(m.id) }}</span>
            </button>
          </div>

          <!-- 评论区域 -->
          <div v-if="showingComments.has(m.id)" class="comments-section">
            <div class="comments-list">
              <div v-for="comment in getComments(m.id)" :key="comment.id" class="comment-item">
                <div class="comment-header small">
                  <strong>{{ displayName(comment.author) }}</strong>
                  <span class="muted"> · {{ toLocalTime(comment.timestamp) }}</span>
                </div>
                <div class="comment-text">{{ comment.text }}</div>
              </div>
              <div v-if="getComments(m.id).length === 0" class="small muted">暂无评论</div>
            </div>
            
            <!-- 评论输入框 -->
            <div class="comment-input-container">
              <input 
                v-model="commentInputs[m.id]" 
                class="comment-input" 
                placeholder="写下你的评论..."
                @keyup.enter="addComment(m.id)"
              />
              <button class="comment-submit" @click="addComment(m.id)" :disabled="!commentInputs[m.id]?.trim()">
                发送
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, onBeforeUnmount } from "vue";
import { useFriendsStore } from "@/stores/friends";
import { useKeyStore } from "@/stores/keys";
import { getRelaysFromStorage, subscribe } from "@/nostr/relays";
import { symDecryptPackage } from "@/nostr/crypto";
import { useMessagesStore } from "@/stores/messages";
import { useInteractionsStore } from "@/stores/interactions";
import { logger } from "@/utils/logger";
import { formatRelativeTime } from "@/utils/format";
import PostImagePreview from "@/components/PostImagePreview.vue";

// reuse the regex logic from extractImageUrls to strip out image markdown and plain image URLs
const mdImageRE = /!\[[^\]]*?\]\(\s*(https?:\/\/[^\s)]+)\s*\)/gi;
const plainImgUrlRE = /(https?:\/\/[^\s)]+?\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?[^\s)]*)?)/gi;

export default defineComponent({
  name: "Home",
  components: { PostImagePreview },
  setup() {
    const friends = useFriendsStore();
    const keys = useKeyStore();
    const msgs = useMessagesStore();
    const interactions = useInteractionsStore();

    const status = ref("未连接");
    let sub: any = null;
    let interactionsSub: any = null;

    const messagesRef = ref([] as any[]);
    
    // State for comments UI
    const showingComments = ref<Set<string>>(new Set());
    const commentInputs = ref<Record<string, string>>({});

    function updateLocalRefs() {
      messagesRef.value = msgs.inbox;
    }

    const toLocalTime = (ts: number) => formatRelativeTime(ts);
    const shortPub = (s: string) => (s ? s.slice(0, 8) + "..." : "");
    const shortRelay = (r: string) => (r ? r.replace(/^wss?:\/\//, "").replace(/\/$/, "").slice(0, 22) : "");

    function displayName(pubkey: string) {
      if (!pubkey) return "未知用户";
      if (keys.pkHex && pubkey === keys.pkHex) return "自己";
      const f = (friends.list || []).find((x: any) => x.pubkey === pubkey);
      if (f && f.name && String(f.name).trim().length > 0) return f.name;
      // Return shortened public key as fallback
      return pubkey.slice(0, 8) + "...";
    }

    function addMessageIfNew(evt: any, plain: string) {
      if (!evt || !evt.id) return false;
      if (msgs.inbox.find((m) => m.id === evt.id)) return false;
      const added = { id: evt.id, pubkey: evt.pubkey, created_at: evt.created_at, content: plain };
      msgs.addInbox(added);
      updateLocalRefs();
      return true;
    }

    function textWithoutImages(content: string): string {
      if (!content) return "";
      // remove markdown image ![alt](url)
      let s = content.replace(mdImageRE, "");
      // remove plain image urls
      s = s.replace(plainImgUrlRE, "");
      // collapse multiple blank lines and trim
      s = s.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      return s;
    }

    // Like functionality
    async function toggleLike(message: any) {
      if (!keys.pkHex) return;
      
      const messageId = message.id;
      const isCurrentlyLiked = interactions.isLikedByUser(messageId, keys.pkHex);
      
      try {
        if (isCurrentlyLiked) {
          await interactions.removeLike(messageId, message.pubkey);
        } else {
          await interactions.sendLike(messageId, message.pubkey);
        }
      } catch (e: any) {
        logger.error("Toggle like failed", e);
      }
    }

    function isLiked(messageId: string): boolean {
      if (!keys.pkHex) return false;
      return interactions.isLikedByUser(messageId, keys.pkHex);
    }

    function getLikeCount(messageId: string): number {
      return interactions.getLikeCount(messageId);
    }

    // Comment functionality
    function toggleComments(messageId: string) {
      if (showingComments.value.has(messageId)) {
        showingComments.value.delete(messageId);
      } else {
        showingComments.value.add(messageId);
      }
      // Trigger reactivity
      showingComments.value = new Set(showingComments.value);
    }

    async function addComment(messageId: string) {
      if (!keys.pkHex) return;
      const text = commentInputs.value[messageId]?.trim();
      if (!text) return;

      // Find the message to get the author
      const message = msgs.inbox.find((m) => m.id === messageId);
      if (!message) return;

      try {
        await interactions.sendComment(messageId, message.pubkey, text);
        // Clear input
        commentInputs.value[messageId] = "";
      } catch (e: any) {
        logger.error("Add comment failed", e);
      }
    }

    function getComments(messageId: string) {
      return interactions.getComments(messageId);
    }

    function getCommentCount(messageId: string): number {
      return interactions.getCommentCount(messageId);
    }

    async function backfillMessages(friendSet: Set<string>, relays: string[]) {
      try {
        // Get the most recent message timestamp from inbox
        const now = Math.floor(Date.now() / 1000);
        let lastMessageTime = 0; // Start from epoch if no messages
        
        if (msgs.inbox && msgs.inbox.length > 0) {
          // Find the most recent message
          const sorted = [...msgs.inbox].sort((a, b) => b.created_at - a.created_at);
          lastMessageTime = sorted[0].created_at;
          logger.info(`最后一条消息时间: ${new Date(lastMessageTime * 1000).toLocaleString()}`);
        } else {
          // If no messages, fetch from 7 days ago to bootstrap
          lastMessageTime = now - (7 * 24 * 60 * 60);
          logger.info(`没有找到消息，从7天前开始获取`);
        }
        
        // If last message is recent (within 1 hour), extend the window back 1 day to catch missed messages
        const oneHourAgo = now - 3600;
        let since = lastMessageTime;
        if (lastMessageTime > oneHourAgo) {
          since = Math.max(lastMessageTime - (24 * 60 * 60), 0);
          logger.info(`检测到最近活动，将获取窗口扩展到最后一条消息之前1天`);
        }
        
        logger.info(`从 ${new Date(since * 1000).toLocaleString()} 获取消息到现在`);
        
        // Create a filter with time range - fetch from last message to now
        const backfillFilter = {
          kinds: [24242],
          authors: Array.from(friendSet),
          since: since
          // No 'until' - fetch up to current time
        };
        
        status.value = "获取最新消息中";
        
        // Subscribe to historical events
        const backfillSub = subscribe(relays, [backfillFilter]);
        let backfillCount = 0;
        
        backfillSub.on("event", async (evt: any) => {
          try {
            if (!friendSet.has(evt.pubkey)) return;
            let payload: any;
            try { payload = JSON.parse(evt.content); } catch { return; }
            if (!payload?.keys || !payload?.pkg) return;
            const myEntry = payload.keys.find((k: any) => k.to === keys.pkHex);
            if (!myEntry) return;
            let symHex: string | null = null;
            try {
              symHex = await keys.nip04Decrypt(evt.pubkey, myEntry.enc);
            } catch (e) {
              logger.warn("nip04.decrypt failed", e);
              if (typeof myEntry.enc === "string" && /^[0-9a-fA-F]{64}$/.test(myEntry.enc)) {
                symHex = myEntry.enc;
              } else {
                return;
              }
            }
            try {
              const plain = await symDecryptPackage(symHex, payload.pkg);
              const added = addMessageIfNew(evt, plain);
              if (added) backfillCount++;
            } catch (e) {
              logger.warn("symDecryptPackage failed", e);
            }
          } catch (e) {
            logger.warn("handle backfill event fail", e);
          }
        });
        
        backfillSub.on("eose", () => {
          logger.info(`获取完成: ${backfillCount} 条新消息`);
          status.value = backfillCount > 0 ? `获取到 ${backfillCount} 条新消息` : "已是最新";
          // Close the backfill subscription
          try {
            if (typeof backfillSub.unsub === "function") backfillSub.unsub();
          } catch (e) {
            logger.warn("close backfill sub error", e);
          }
        });
      } catch (e) {
        logger.error("backfill failed", e);
      }
    }

    async function startSub() {
      try {
        await friends.load();
        if (!keys.isLoggedIn) {
          status.value = "未登录";
          return;
        }
        await msgs.load();
        await interactions.load(); // Load interactions
        updateLocalRefs();

        const friendSet = new Set<string>((friends.list || []).map((f: any) => f.pubkey));
        if (keys.pkHex) friendSet.add(keys.pkHex);
        if (friendSet.size === 0) {
          status.value = "好友为空";
          return;
        }

        const relays = getRelaysFromStorage();
        
        // First, backfill historical messages
        await backfillMessages(friendSet, relays);

        const filters = { kinds: [24242], authors: Array.from(friendSet) };
        status.value = "连接中";

        try {
          if (sub) {
            if (typeof sub.close === "function") sub.close();
            else if (typeof sub.unsub === "function") sub.unsub();
            else if (typeof sub.unsubscribe === "function") sub.unsubscribe();
            else if (typeof sub === "function") sub();
          }
        } catch (e) {
          logger.warn("close prev sub error", e);
        }
        sub = null;

        try {
          const adapterSub = subscribe(relays, [filters]);
          sub = adapterSub;
          adapterSub.on("event", async (evt: any) => {
            try {
              if (!friendSet.has(evt.pubkey)) return;
              let payload: any;
              try { payload = JSON.parse(evt.content); } catch { return; }
              if (!payload?.keys || !payload?.pkg) return;
              const myEntry = payload.keys.find((k: any) => k.to === keys.pkHex);
              if (!myEntry) return;
              let symHex: string | null = null;
              try {
                symHex = await keys.nip04Decrypt(evt.pubkey, myEntry.enc);
              } catch (e) {
                logger.warn("nip04.decrypt failed", e);
                if (typeof myEntry.enc === "string" && /^[0-9a-fA-F]{64}$/.test(myEntry.enc)) {
                  symHex = myEntry.enc;
                } else {
                  return;
                }
              }
              try {
                const plain = await symDecryptPackage(symHex, payload.pkg);
                addMessageIfNew(evt, plain);
              } catch (e) {
                logger.warn("symDecryptPackage failed", e);
              }
            } catch (e) {
              logger.warn("handle event fail", e);
            }
          });
          adapterSub.on("eose", () => { status.value = "同步完成"; });

          setTimeout(() => { if (status.value === "连接中") status.value = "已订阅"; }, 800);
        } catch (e) {
          logger.warn("subscribe adapter failed", e);
          status.value = "订阅失败";
        }
        
        // Subscribe to interactions (kind 24243)
        try {
          const interactionsFilter = {
            kinds: [24243],
            "#p": [keys.pkHex] // Only get interactions targeted at us
          };
          
          interactionsSub = subscribe(relays, [interactionsFilter]);
          
          interactionsSub.on("event", async (evt: any) => {
            await interactions.processInteractionEvent(evt, keys.pkHex);
          });
          
          logger.debug("已订阅互动事件");
        } catch (e) {
          logger.warn("subscribe to interactions failed", e);
        }
      } catch (e) {
        logger.error("startSub failed", e);
        status.value = "订阅失败";
      }
    }

    onMounted(async () => { 
      await startSub(); 
    });

    onBeforeUnmount(() => {
      if (sub) {
        try { if (typeof sub.close === "function") sub.close(); else if (typeof sub.unsub === "function") sub.unsub(); else if (typeof sub.unsubscribe === "function") sub.unsubscribe(); else if (typeof sub === "function") sub(); } catch {}
      }
      if (interactionsSub) {
        try { if (typeof interactionsSub.close === "function") interactionsSub.close(); else if (typeof interactionsSub.unsub === "function") interactionsSub.unsub(); else if (typeof interactionsSub.unsubscribe === "function") interactionsSub.unsubscribe(); else if (typeof interactionsSub === "function") interactionsSub(); } catch {}
      }
    });

    return { 
      messages: messagesRef, 
      toLocalTime, 
      shortPub, 
      status, 
      shortRelay, 
      displayName, 
      textWithoutImages,
      // Like and comment functions
      toggleLike,
      isLiked,
      getLikeCount,
      toggleComments,
      addComment,
      getComments,
      getCommentCount,
      showingComments,
      commentInputs
    };
  }
});
</script>

<style scoped>
.small { font-size:12px; color:#64748b; }
.card { background: #fff; padding:12px; border-radius:10px; margin-bottom:12px; box-shadow: 0 4px 10px rgba(0,0,0,0.04); }
.list { display:flex; flex-direction:column; gap:8px; }
.muted { color: #94a3b8; font-size: 12px; margin-left:6px; }
.message-text {
  margin-top: 8px;
  white-space: pre-wrap;
  word-wrap: break-word;
  word-break: break-word;
  overflow-wrap: break-word;
  max-width: 100%;
}

.message-actions {
  display: flex;
  gap: 16px;
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid #f1f5f9;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 8px;
  transition: all 0.2s;
  font-size: 14px;
  color: #64748b;
}

.action-btn:hover {
  background: #f8fafc;
}

.action-btn.liked {
  color: #ef4444;
}

.action-icon {
  font-size: 16px;
}

.action-text {
  font-size: 13px;
}

.comments-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f1f5f9;
}

.comments-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
  max-height: 300px;
  overflow-y: auto;
}

.comment-item {
  background: #f8fafc;
  padding: 8px;
  border-radius: 6px;
}

.comment-header {
  margin-bottom: 4px;
}

.comment-text {
  font-size: 13px;
  color: #1e293b;
  word-wrap: break-word;
  word-break: break-word;
  overflow-wrap: break-word;
}

.comment-input-container {
  display: flex;
  gap: 8px;
}

.comment-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 13px;
  box-sizing: border-box;
}

.comment-input:focus {
  outline: none;
  border-color: #1976d2;
}

.comment-submit {
  background: #1976d2;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.comment-submit:hover:not(:disabled) {
  background: #1565c0;
}

.comment-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
