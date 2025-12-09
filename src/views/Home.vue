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
            <span class="muted"> · {{ shortPub(m.pubkey) }} · {{ toLocalTime(m.created_at) }}</span>
          </div>

          <!-- 图片预览（方案 B：直接从内容抽取图片 URL 并渲染） -->
          <PostImagePreview :content="m.content" :showAll="false" style="margin-top:8px;" />

          <!-- 如果仍需显示文本（去除了图片 URL/Markdown），使用 textWithoutImages -->
          <div v-if="textWithoutImages(m.content)" style="margin-top:8px; white-space:pre-wrap;">{{ textWithoutImages(m.content) }}</div>
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
import { envelopeDecryptSym, symDecryptPackage } from "@/nostr/crypto";
import { useMessagesStore } from "@/stores/messages";
import { logger } from "@/utils/logger";
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

    const status = ref("未连接");
    let sub: any = null;

    const messagesRef = ref([] as any[]);

    function updateLocalRefs() {
      messagesRef.value = msgs.inbox;
    }

    const toLocalTime = (ts: number) => new Date(ts * 1000).toLocaleString();
    const shortPub = (s: string) => (s ? s.slice(0, 8) + "..." : "");
    const shortRelay = (r: string) => (r ? r.replace(/^wss?:\/\//, "").replace(/\/$/, "").slice(0, 22) : "");

    function displayName(pubkey: string) {
      if (!pubkey) return "";
      if (keys.pkHex && pubkey === keys.pkHex) return "你";
      const f = (friends.list || []).find((x: any) => x.pubkey === pubkey);
      if (f && f.name && String(f.name).trim().length > 0) return f.name;
      return shortPub(pubkey);
    }

    function addMessageIfNew(evt: any, plain: string) {
      if (!evt || !evt.id) return false;
      if (msgs.inbox.find((m) => m.id === evt.id)) return false;
      const added = { id: evt.id, pubkey: evt.pubkey, created_at: evt.created_at, content: plain };
      msgs.addInbox(added);
      updateLocalRefs();
      return true;
    }

    // Strip image markdown and plain image urls from content, return remaining text trimmed.
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

    async function backfillMessages(friendSet: Set<string>, relays: string[]) {
      try {
        // Get the most recent message timestamp from inbox
        const now = Math.floor(Date.now() / 1000);
        let lastMessageTime = now;
        
        if (msgs.inbox && msgs.inbox.length > 0) {
          // Find the most recent message
          const sorted = [...msgs.inbox].sort((a, b) => b.created_at - a.created_at);
          lastMessageTime = sorted[0].created_at;
        }
        
        // Calculate 3 days ago from the last message time
        const threeDaysInSeconds = 3 * 24 * 60 * 60;
        const since = lastMessageTime - threeDaysInSeconds;
        
        logger.info(`Backfilling messages from ${new Date(since * 1000).toLocaleString()} to ${new Date(lastMessageTime * 1000).toLocaleString()}`);
        
        // Create a filter with time range
        const backfillFilter = {
          kinds: [24242],
          authors: Array.from(friendSet),
          since: since,
          until: lastMessageTime
        };
        
        status.value = "回填历史消息中";
        
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
              symHex = await envelopeDecryptSym(keys.skHex, evt.pubkey, myEntry.enc);
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
          logger.info(`Backfill complete: ${backfillCount} new messages`);
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
        if (!keys.pkHex || !keys.skHex) {
          status.value = "未登录";
          return;
        }
        await msgs.load();
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
                symHex = await envelopeDecryptSym(keys.skHex, evt.pubkey, myEntry.enc);
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
      } catch (e) {
        logger.error("startSub failed", e);
        status.value = "订阅失败";
      }
    }

    onMounted(async () => { await startSub(); });

    onBeforeUnmount(() => {
      if (sub) {
        try { if (typeof sub.close === "function") sub.close(); else if (typeof sub.unsub === "function") sub.unsub(); else if (typeof sub.unsubscribe === "function") sub.unsubscribe(); else if (typeof sub === "function") sub(); } catch {}
      }
    });

    return { messages: messagesRef, toLocalTime, shortPub, status, shortRelay, displayName, textWithoutImages };
  }
});
</script>

<style scoped>
.small { font-size:12px; color:#64748b; }
.card { background: #fff; padding:12px; border-radius:10px; margin-bottom:12px; box-shadow: 0 4px 10px rgba(0,0,0,0.04); }
.list { display:flex; flex-direction:column; gap:8px; }
.muted { color: #94a3b8; font-size: 12px; margin-left:6px; }
</style>
