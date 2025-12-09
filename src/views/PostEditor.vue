<template>
  <transition name="slide-up">
    <div class="editor-overlay" v-if="visible" @keydown.esc="onClose" tabindex="-1" ref="overlay">
      <div class="editor-card" role="dialog" aria-modal="true">
        <header class="editor-header">
          <div class="title">发帖</div>
        </header>

        <main class="editor-body">
          <textarea
            v-model="content"
            ref="textarea"
            class="editor-textarea"
            placeholder="写点什么...（将加密发送给你的好友）"
            rows="8"
          ></textarea>

          <!-- 图片上传区域 -->
          <div class="upload-panel">
            <div class="upload-controls">
              <label
                class="upload-btn"
                :class="{ disabled: !uploadEnabled || uploadingAny }"
                :title="uploadEnabled ? (uploadingAny ? '上传中...' : '上传图片') : '未配置 blossom_upload_url'"
              >
                <input type="file" accept="image/*" multiple @change="onFilesSelected" :disabled="!uploadEnabled || uploadingAny" />
                上传图片
              </label>

              <div class="upload-config-hint small">
                Blossom:
                <span v-if="uploadEnabled" class="ok">已配置</span>
                <span v-else class="warn">未配置（请在 Settings 中填写 blossom_upload_url）</span>
                <button class="check-btn" type="button" @click="checkBlossom" style="margin-left:8px;">检测配置</button>
              </div>
            </div>

            <div class="previews">
              <div v-for="(item, idx) in uploads" :key="item.id" class="preview">
                <div class="thumb-wrap">
                  <img v-if="item.preview" :src="item.preview" class="thumb" />
                  <div v-else class="thumb placeholder">图片</div>
                </div>
                <div class="meta">
                  <div class="name">{{ item.file.name }}</div>
                  <div class="progress" v-if="item.status === 'uploading'">
                    上传中 {{ item.progress }}%
                  </div>
                  <div class="ok" v-if="item.status === 'done'">已上传</div>
                  <div class="err" v-if="item.status === 'error'">错误：{{ item.errorShort }}</div>
                  <details v-if="item.status === 'error' && item.errorDetails">
                    <summary>查看详细错误信息</summary>
                    <pre style="white-space:pre-wrap; font-size:12px;">{{ item.errorDetails }}</pre>
                  </details>
                  <div class="actions">
                    <button type="button" @click="insertImageUrl(item)" :disabled="item.status !== 'done'">插入</button>
                    <button type="button" @click="removeUpload(idx)">删除</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- recipients chips -->
          <div class="meta-row" style="margin-top:12px;">
            <strong>收件人</strong>
            <div class="small">默认发送给全部好友；使用分组或全部选择。</div>
          </div>

          <div class="meta-row" style="margin-top:12px;">
            <strong>收件人选择</strong>
            <div class="small">默认全部好友；可点击分组进行多选。</div>
          </div>

          <div class="groups">
            <div class="chips-row">
              <button
                class="chip"
                :class="{ 'chip-selected': allFriends }"
                @click="toggleAll()"
                type="button"
                :aria-pressed="String(allFriends)"
              >
                全部好友
                <span class="chip-count">{{ (friends.list || []).length }}</span>
              </button>
              <div class="divider"></div>
              <div class="chips-scroll" role="list">
                <button
                  v-for="g in groups"
                  :key="g"
                  class="chip"
                  :class="{ 'chip-selected': selectedSet.has(g) && !allFriends }"
                  @click="toggleGroup(g)"
                  :disabled="allFriends"
                  role="listitem"
                  type="button"
                >
                  <span class="group-name">{{ gLabel(g) }}</span>
                  <span class="chip-count">{{ countByGroup[g] || 0 }}</span>
                </button>
              </div>
            </div>

            <div class="recips-info">
              目标人数：<strong>{{ recipientsCount }}</strong>
            </div>
          </div>

          <!-- 发送和取消按钮移到这里 -->
          <div class="action-buttons">
            <button class="cancel-btn" @click="onClose">取消</button>
            <button class="send-btn" :disabled="sending || !canSend" @click="onSend">
              {{ sending ? "发送中..." : "发送" }}
            </button>
          </div>

          <div v-if="error" class="error">{{ error }}</div>
        </main>

        <footer class="editor-footer">
          <div class="small">提示：发出的消息会被加密并发布到已配置的 relays。</div>
        </footer>
      </div>
    </div>
  </transition>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, onBeforeUnmount, watch, nextTick, computed } from "vue";
import { useRouter } from "vue-router";
import { useKeyStore } from "@/stores/keys";
import { useFriendsStore } from "@/stores/friends";
import { usePostsStore } from "@/stores/posts";
import { useMessagesStore } from "@/stores/messages";
import { useUIStore } from "@/stores/ui";
import { uploadImageToBlossom, getBlossomConfig } from "@/utils/blossom";

type UploadItem = {
  id: string;
  file: File;
  preview: string | null;
  status: "pending" | "uploading" | "done" | "error";
  progress: number;
  url?: string;
  errorShort?: string;
  errorDetails?: string;
};

export default defineComponent({
  name: "PostEditor",
  setup() {
    const router = useRouter();
    const keys = useKeyStore();
    const friends = useFriendsStore();
    const posts = usePostsStore();
    const msgs = useMessagesStore();
    const ui = useUIStore();

    const visible = ref(true);
    const content = ref("");
    const sending = ref(false);
    const error = ref<string | null>(null);
    const textarea = ref<HTMLTextAreaElement | null>(null);
    const overlay = ref<HTMLElement | null>(null);

    // recipients selection state
    const allFriends = ref(true);
    const selectedGroups = ref<Array<string>>([]);

    const canSend = computed(() => content.value.trim().length > 0);

    // groups derived from friends list
    const groups = computed(() => {
      const list = friends.list || [];
      const order: string[] = [];
      const seen = new Set<string>();
      for (const f of list) {
        // 支持 groups 数组（多标签）
        const tags = f.groups && Array.isArray(f.groups) && f.groups.length > 0 
          ? f.groups 
          : (f.group ? [f.group] : ["未分组"]);
        for (const g of tags) {
          if (!seen.has(g)) {
            seen.add(g);
            order.push(g);
          }
        }
      }
      return order;
    });

    const countByGroup = computed(() => {
      const map: Record<string, number> = {};
      const list = friends.list || [];
      for (const f of list) {
        // 支持 groups 数组（多标签）
        const tags = f.groups && Array.isArray(f.groups) && f.groups.length > 0 
          ? f.groups 
          : (f.group ? [f.group] : ["未分组"]);
        for (const g of tags) {
          map[g] = (map[g] || 0) + 1;
        }
      }
      return map;
    });

    const selectedSet = computed(() => new Set(selectedGroups.value || []));

    const recipients = computed(() => {
      const list = friends.list || [];
      if (list.length === 0) return [] as string[];
      if (allFriends.value) return list.map((f: any) => f.pubkey).filter(Boolean);
      const sel = selectedSet.value;
      // 收集所有匹配的好友，但使用 Set 确保每个人只计数一次
      const uniquePubkeys = new Set<string>();
      for (const f of list) {
        const tags = f.groups && Array.isArray(f.groups) && f.groups.length > 0 
          ? f.groups 
          : (f.group ? [f.group] : ["未分组"]);
        // 如果好友的任何一个标签被选中，就包含这个好友
        if (tags.some((tag: string) => sel.has(tag))) {
          uniquePubkeys.add(f.pubkey);
        }
      }
      return Array.from(uniquePubkeys);
    });

    const recipientsCount = computed(() => {
      const set = new Set(recipients.value);
      if (keys.pkHex) set.add(keys.pkHex);
      return set.size;
    });

    function gLabel(g: string) {
      return g === "未分组" ? "未分组" : g;
    }

    function toggleAll() {
      allFriends.value = !allFriends.value;
      if (allFriends.value) selectedGroups.value = [];
    }

    function toggleGroup(g: string) {
      if (allFriends.value) return;
      const idx = selectedGroups.value.indexOf(g);
      if (idx === -1) selectedGroups.value.push(g);
      else selectedGroups.value.splice(idx, 1);
    }

    const uploads = ref<UploadItem[]>([]);
    const uploadEnabled = ref(false);
    const uploadingAny = computed(() => uploads.value.some(u => u.status === "uploading"));

    async function checkBlossom() {
      const cfg = await getBlossomConfig();
      uploadEnabled.value = !!cfg.url;
    }

    function toId() {
      return Math.random().toString(36).slice(2, 9);
    }

    function makePreview(file: File): string | null {
      try { return URL.createObjectURL(file); } catch { return null; }
    }

    function onFilesSelected(e: Event) {
      const input = e.target as HTMLInputElement;
      const files = input.files;
      if (!files || files.length === 0) return;
      for (let i=0;i<files.length;i++){
        const f = files[i];
        const item: UploadItem = { id: toId(), file: f, preview: makePreview(f), status: "pending", progress: 0 };
        uploads.value.push(item);
        void startUpload(item);
      }
      input.value = "";
    }

    // signEvent wrapper: prefer keys.signEvent -> window.nostr.signEvent -> nostr-tools v2 local signing (skHex)
    async function signEventWrapper(evt: any) {
      // prefer keys store
      if ((keys as any).signEvent && typeof (keys as any).signEvent === "function") {
        return await (keys as any).signEvent(evt);
      }
      // try injected extension
      if ((window as any).nostr && typeof (window as any).nostr.signEvent === "function") {
        return await (window as any).nostr.signEvent(evt);
      }
      // fallback: local nostr-tools v2 using skHex (not recommended on public sites)
      if ((keys as any).skHex && typeof (keys as any).skHex === "string" && (keys as any).skHex.trim().length === 64) {
        try {
          const nt = await import("nostr-tools");
          const sk = (keys as any).skHex as string;
          if (typeof nt.getPublicKey === "function") evt.pubkey = nt.getPublicKey(sk);
          if (typeof nt.getEventHash === "function") evt.id = nt.getEventHash(evt);
          // prefer nt.signEvent if available
          if (typeof nt.signEvent === "function") {
            const maybe = nt.signEvent(evt, sk);
            if (maybe && typeof maybe.then === "function") {
              const res = await maybe;
              return res;
            }
            return maybe;
          }
          // try nt.schnorr.sign (v2)
          if (nt.schnorr && typeof nt.schnorr.sign === "function") {
            const msgHex = evt.id || nt.getEventHash(evt);
            const sig = await nt.schnorr.sign(msgHex, sk);
            evt.sig = typeof sig === "string" ? sig : Array.from(sig).map((b:number)=>b.toString(16).padStart(2,"0")).join("");
            return evt;
          }
          // try nt.secp256k1.sign
          if (nt.secp256k1 && typeof nt.secp256k1.sign === "function") {
            const idHex = evt.id || nt.getEventHash(evt);
            const r = await nt.secp256k1.sign(idHex, sk);
            if (r && typeof r === "object" && (r as any).signature) evt.sig = (r as any).signature;
            else if (typeof r === "string") evt.sig = r;
            else evt.sig = String(r);
            return evt;
          }
          throw new Error("nostr-tools v2 没有可用签名函数");
        } catch (e: any) {
          throw new Error("本地签名失败: " + (e && e.message ? e.message : String(e)));
        }
      }
      throw new Error("未找到可用签名器（keys.signEvent / window.nostr / 本地 skHex）");
    }

    async function startUpload(item: UploadItem) {
      item.status = "uploading";
      item.progress = 0;
      item.errorShort = undefined;
      item.errorDetails = undefined;

      try {
        const descriptor = await uploadImageToBlossom(item.file, {
          includeAuthIfRequired: true,
          signEvent: signEventWrapper,
          onProgress: (p:number) => { item.progress = p; }
        });
        item.url = descriptor.url;
        item.status = "done";
        item.progress = 100;
        if (content.value.length>0 && !content.value.endsWith("\n")) content.value += "\n";
        content.value += `![](${item.url})\n`;
        // 移除自动聚焦，避免光标跳动
        // nextTick(()=>{ try{ textarea.value?.focus() } catch{} });
      } catch (err:any) {
        console.error("upload error raw:", err);
        item.status = "error";
        item.errorShort = err && err.message ? String(err.message) : "上传失败";
        try { item.errorDetails = err && err.details ? JSON.stringify(err.details, null, 2) : JSON.stringify(err, Object.getOwnPropertyNames(err), 2); } catch { item.errorDetails = String(err); }
        ui.addToast(`上传失败: ${item.errorShort}`, 3000, "error");
      }
    }

    function insertImageUrl(item: UploadItem) {
      if (item.status === "done" && item.url) {
        if (content.value.length>0 && !content.value.endsWith("\n")) content.value += "\n";
        content.value += `![](${item.url})\n`;
      }
    }

    function removeUpload(idx:number) {
      const item = uploads.value[idx];
      if (item && item.preview) { try { URL.revokeObjectURL(item.preview) } catch {} }
      uploads.value.splice(idx, 1);
    }

    function onClose() {
      visible.value = false;
      setTimeout(() => {
        try { router.replace("/"); } catch {}
      }, 220);
    }

    onMounted(async ()=>{
      await checkBlossom();
      if (!keys.isLoggedIn) {
        router.replace({ path: "/login", query: { redirect: "/post" } });
        return;
      }
      await friends.load();
      await msgs.load();
      allFriends.value = true;
      selectedGroups.value = [];
      await nextTick();
      // 移除自动聚焦，避免光标跳动和键盘自动弹出
      // try { textarea.value?.focus() } catch {}
    });

    onBeforeUnmount(()=>{
      for (const it of uploads.value) {
        if (it.preview) { try { URL.revokeObjectURL(it.preview) } catch {} }
      }
    });

    watch(()=>groups.value, (g)=>{ if (g.length===0) { allFriends.value = true; selectedGroups.value = [] } });

    async function onSend() {
      if (!keys.isLoggedIn) { error.value = "请先登录"; return; }
      if (!canSend.value) { error.value = "请输入内容"; return; }
      sending.value = true;
      error.value = null;

      let recips = recipients.value.slice();
      if (keys.pkHex && !recips.includes(keys.pkHex)) recips.push(keys.pkHex);
      recips = Array.from(new Set(recips.filter(Boolean)));

      if (recips.length === 0) { error.value = "未指定收件人"; sending.value = false; return; }

      try {
        const { signed } = await posts.publishNip44PerMessage(recips, content.value);
        try { await msgs.load(); msgs.addInbox({ id: signed.id, pubkey: keys.pkHex, created_at: signed.created_at, content: content.value }); } catch {}
        ui.addToast("发送成功", 1200, "success");
        setTimeout(()=>{ visible.value = false; router.replace("/"); }, 220);
      } catch (e:any) {
        console.error("publish error", e);
        error.value = e && e.message ? e.message : "发送失败";
        ui.addToast("发送失败", 2000, "error");
      } finally {
        sending.value = false;
      }
    }

    return {
      visible, content, sending, allFriends, selectedGroups, groups, countByGroup,
      canSend, textarea, overlay, error, onSend, onClose, toggleAll, toggleGroup,
      recipientsCount, selectedSet, gLabel, friends, uploads, uploadEnabled, uploadingAny,
      onFilesSelected, insertImageUrl, removeUpload, checkBlossom
    };
  }
});
</script>

<style scoped>
/* overlay and modal */
.editor-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: flex-end; /* start from bottom */
  justify-content: center;
  background: rgba(0, 0, 0, 0.28);
  z-index: 2000;
  outline: none;
}

.editor-card {
  width: 100%;
  max-width: 100vw; /* 防止超出视口宽度 */
  background: #fff;
  border-top-left-radius: 12px;
  border-top-right-radius: 12px;
  box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.12);
  transform: translateY(0);
  overflow-x: hidden; /* 防止内容撑开页面 */
}

/* header */
.editor-header {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 12px;
  border-bottom: 1px solid #eee;
}
.icon-btn {
  background: transparent;
  border: none;
  font-size: 18px;
  cursor: pointer;
}
.title {
  font-weight: 600;
}

/* body */
.editor-body {
  padding: 12px;
  max-width: 100%;
  overflow-x: hidden; /* 防止内容撑开页面 */
}
.editor-textarea {
  width: 100%;
  max-width: 100%; /* 确保不超出父容器 */
  min-height: 140px;
  padding: 10px;
  border: 1px solid #e6edf3;
  border-radius: 8px;
  resize: vertical;
  font-size: 14px;
  box-sizing: border-box; /* 确保 padding 包含在宽度内 */
}
.meta-row {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}

/* upload panel */
.upload-panel {
  margin-top: 12px;
}
.upload-controls {
  display:flex;
  align-items:center;
  gap:12px;
  flex-wrap: wrap; /* 允许换行 */
}
.upload-btn {
  background:#1976d2;
  color:white;
  padding:8px 10px;
  border-radius:8px;
  cursor:pointer;
  display:inline-block;
}
.upload-btn input { display:none; }
.upload-btn.disabled { background:#bbb; cursor:not-allowed; }
.upload-config-hint .ok { color:#16a34a; }
.upload-config-hint .warn { color:#d97706; }

/* previews */
.previews { margin-top:12px; display:flex; flex-direction:column; gap:8px; }
.preview { 
  display:flex; 
  gap:10px; 
  align-items:center; 
  background:#fafafa; 
  padding:8px; 
  border-radius:8px; 
  border:1px solid rgba(0,0,0,0.04);
  max-width: 100%;
  overflow: hidden;
}
.thumb-wrap { 
  width:64px; 
  height:64px; 
  min-width: 64px;
  display:flex; 
  align-items:center; 
  justify-content:center; 
  background:#fff; 
  border-radius:6px; 
  overflow:hidden; 
}
.thumb { width:100%; height:100%; object-fit:cover; display:block; }
.thumb.placeholder { display:flex; align-items:center; justify-content:center; color:#94a3b8; }
.meta { flex:1; display:flex; flex-direction:column; gap:6px; min-width: 0; }
.name { font-size:13px; color:#111827; word-break: break-all; }
.progress { color:#2563eb; font-size:13px; }
.ok { color:#16a34a; }
.err { color:#dc2626; word-break: break-word; }
.actions { display:flex; gap:8px; }
.actions button { background:transparent; border:1px solid #e6edf3; padding:6px 8px; border-radius:6px; cursor:pointer; }

/* chips UI */
.groups { margin-top:12px; }
.chips-row { 
  display:flex; 
  align-items:center; 
  gap:8px; 
  flex-wrap:nowrap;
  max-width: 100%;
  overflow: hidden;
}
.chips-scroll { 
  display:flex; 
  gap:8px; 
  overflow-x:auto; 
  padding-bottom:4px;
  flex: 1;
  min-width: 0;
}
.chip { 
  display:inline-flex; 
  align-items:center; 
  gap:8px; 
  padding:6px 10px; 
  background:#f3f6f9; 
  border-radius:999px; 
  border:1px solid transparent; 
  cursor:pointer; 
  font-size:13px; 
  color:#374151; 
  white-space:nowrap;
  flex-shrink: 0;
}
.chip:disabled { opacity:0.5; cursor:default; }
.chip-selected { background: linear-gradient(90deg,#1976d2 0%, #2a9df4 100%); color:white; box-shadow:0 6px 18px rgba(25,118,210,0.12); }
.chip-count { background: rgba(0,0,0,0.06); padding:2px 6px; border-radius:999px; font-size:12px; margin-left:6px; }
.divider { width:1px; height:28px; background: rgba(0,0,0,0.06); margin:0 6px; flex-shrink: 0; }
.recips-info { margin-top:8px; color:#374151; font-size:13px; }

/* action buttons */
.action-buttons {
  display: flex;
  gap: 12px;
  margin-top: 16px;
  justify-content: flex-end;
}

.cancel-btn {
  background: #f3f6f9;
  color: #374151;
  padding: 8px 20px;
  border-radius: 8px;
  border: 1px solid #e6edf3;
  cursor: pointer;
  font-size: 14px;
}

.cancel-btn:hover {
  background: #e6edf3;
}

.send-btn {
  background: #1976d2;
  color: white;
  padding: 8px 20px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  font-size: 14px;
}
.send-btn[disabled] {
  opacity: 0.5;
  cursor: default;
}

/* footer */
.editor-footer { padding:10px 12px 20px; border-top:1px solid #f3f6f8; }

/* slide up animation */
.slide-up-enter-active, .slide-up-leave-active { transition: transform 200ms ease, opacity 200ms ease; }
.slide-up-enter-from, .slide-up-leave-to { transform: translateY(100%); opacity:0; }
.slide-up-enter-to, .slide-up-leave-from { transform: translateY(0%); opacity:1; }

/* responsive */
@media (min-width:720px) {
  .editor-overlay { align-items:center; }
  .editor-card { 
    border-radius:12px; 
    max-height:80vh;
    max-width: 720px; /* 在大屏幕上限制最大宽度 */
  }
}
.error { margin-top:8px; color:#d00; font-size:13px; }
.small { color:#64748b; font-size:12px; }
</style>
