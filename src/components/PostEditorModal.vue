<template>
  <transition name="slide-up">
    <div class="editor-overlay" v-if="visible" @keydown.esc="onClose" @click.self="onClose" tabindex="-1" ref="overlay">
      <div class="editor-card" role="dialog" aria-modal="true" @click.stop>
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
              <div v-for="(item, idx) in uploads" :key="item.id" class="preview-item">
                <div class="thumb-container">
                  <img v-if="item.preview" :src="item.preview" class="thumb-image" />
                  <div v-else class="thumb-placeholder">图片</div>
                  
                  <!-- Upload progress overlay -->
                  <div v-if="item.status === 'uploading'" class="upload-overlay">
                    <div class="progress-ring">
                      <svg viewBox="0 0 36 36" class="progress-circle">
                        <circle cx="18" cy="18" r="16" fill="none" stroke="#e5e7eb" stroke-width="3"/>
                        <circle cx="18" cy="18" r="16" fill="none" stroke="#3b82f6" stroke-width="3" 
                                :stroke-dasharray="`${item.progress} ${100 - item.progress}`"
                                stroke-dashoffset="25"
                                stroke-linecap="round"/>
                      </svg>
                      <span class="progress-text">{{ item.progress }}%</span>
                    </div>
                  </div>
                  
                  <!-- Error overlay -->
                  <div v-if="item.status === 'error'" class="error-overlay" :title="item.errorShort">
                    ⚠️
                  </div>
                  
                  <!-- Remove button -->
                  <button type="button" class="remove-btn" @click="removeUpload(idx)" :aria-label="`删除图片 ${item.file.name}`" :title="item.file.name">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- recipients chips -->
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

          <!-- 发送和取消按钮 -->
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
import { defineComponent, ref, onBeforeUnmount, watch, nextTick, computed } from "vue";
import { useRouter } from "vue-router";
import { useKeyStore } from "@/stores/keys";
import { useFriendsStore } from "@/stores/friends";
import { usePostsStore } from "@/stores/posts";
import { useMessagesStore } from "@/stores/messages";
import { useUIStore } from "@/stores/ui";
import { uploadImageToBlossom, getBlossomConfig } from "@/utils/blossom";
import { resizeImageFile } from "@/utils/imageResize";
import { deriveImageKey } from "@/nostr/crypto";
import { encryptImageBytes } from "@/utils/imageCrypto";

type UploadItem = {
  id: string;
  file: File;
  preview: string | null;
  status: "pending" | "uploading" | "done" | "error";
  progress: number;
  url?: string;
  errorShort?: string;
  errorDetails?: string;
  index?: number;
};

export default defineComponent({
  name: "PostEditorModal",
  setup() {
    const router = useRouter();
    const keys = useKeyStore();
    const friends = useFriendsStore();
    const posts = usePostsStore();
    const msgs = useMessagesStore();
    const ui = useUIStore();

    const visible = computed(() => ui.showPostEditor);
    const content = ref("");
    const sending = ref(false);
    const error = ref<string | null>(null);
    const textarea = ref<HTMLTextAreaElement | null>(null);
    const overlay = ref<HTMLElement | null>(null);

    // 当前帖子 ID
    const currentPostId = ref<string | null>(null);
    function initPost(id?: string) {
      if (id) currentPostId.value = id;
      else currentPostId.value = crypto.randomUUID();
      // 可选同步到 store
      posts.setCurrentPostId && posts.setCurrentPostId(currentPostId.value);
    }

    // recipients selection state
    const allFriends = ref(true);
    const selectedGroups = ref<Array<string>>([]);

    const canSend = computed(() => {
      const hasText = content.value.trim().length > 0;
      const hasUploadedImages = uploads.value.some(u => u.status === 'done' && u.url);
      return hasText || hasUploadedImages;
    });

    const groups = computed(() => {
      const list = friends.list || [];
      const order: string[] = [];
      const seen = new Set<string>();
      for (const f of list) {
        const tags = getFriendTags(f);
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
        const tags = getFriendTags(f);
        for (const g of tags) {
          map[g] = (map[g] || 0) + 1;
        }
      }
      return map;
    });

    const selectedSet = computed(() => new Set(selectedGroups.value || []));

    function getFriendTags(friend: { groups?: string[]; group?: string }): string[] {
      return friend.groups && Array.isArray(friend.groups) && friend.groups.length > 0 
        ? friend.groups 
        : (friend.group ? [friend.group] : ["未分组"]);
    }

    const recipients = computed(() => {
      const list = friends.list || [];
      if (list.length === 0) return [] as string[];
      if (allFriends.value) return list.map((f: any) => f.pubkey).filter(Boolean);
      const sel = selectedSet.value;
      const uniquePubkeys = new Set<string>();
      for (const f of list) {
        const tags = getFriendTags(f);
        if (tags.some(tag => sel.has(tag))) uniquePubkeys.add(f.pubkey);
      }
      return Array.from(uniquePubkeys);
    });

    const recipientsCount = computed(() => {
      const set = new Set(recipients.value);
      if (keys.pkHex) set.add(keys.pkHex);
      return set.size;
    });

    function gLabel(g: string) { return g === "未分组" ? "未分组" : g; }
    function toggleAll() { allFriends.value = !allFriends.value; if (allFriends.value) selectedGroups.value = []; }
    function toggleGroup(g: string) { if (allFriends.value) return; const idx = selectedGroups.value.indexOf(g); if (idx === -1) selectedGroups.value.push(g); else selectedGroups.value.splice(idx, 1); }

    const uploads = ref<UploadItem[]>([]);
    const uploadEnabled = ref(false);
    const uploadingAny = computed(() => uploads.value.some(u => u.status === "uploading"));

    function updateUploadItem(id: string, patch: Partial<UploadItem>) {
      const idx = uploads.value.findIndex(u => u.id === id);
      if (idx === -1) return;
      uploads.value.splice(idx, 1, { ...uploads.value[idx], ...patch });
    }

    async function checkBlossom() { const cfg = await getBlossomConfig(); uploadEnabled.value = !!cfg.url; }
    function toId() { return Math.random().toString(36).slice(2, 9); }
    function makePreview(file: File): string | null { try { return URL.createObjectURL(file); } catch { return null; } }

    function onFilesSelected(e: Event) {
      const input = e.target as HTMLInputElement;
      const files = input.files;
      if (!files || files.length === 0) return;
      if (!currentPostId.value) initPost();
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const item: UploadItem = { id: toId(), file: f, preview: makePreview(f), status: "pending", progress: 0, index: i };
        uploads.value.push(item);
        void startUpload(item, currentPostId.value!);
      }
      input.value = "";
    }

    async function startUpload(item: UploadItem, postId: string) {
      updateUploadItem(item.id, { status: "uploading", progress: 0, errorShort: undefined, errorDetails: undefined });
      try {
        const resizedFile = await resizeImageFile(item.file, { maxSize: 1920, quality: 0.82 });
        const { encryptedFile, imageKey } = await encryptImageBytes(resizedFile, { postId, imageIndex: item.index });
        const descriptor = await uploadImageToBlossom(encryptedFile, { signEvent: signEventWrapper, onProgress: (p) => updateUploadItem(item.id, { progress: p }) });
        updateUploadItem(item.id, { url: descriptor.url, status: "done", progress: 100, imageKey });
      } catch (err: any) {
        const errorShort = err?.message ?? "上传失败";
        let errorDetails: string;
        try { errorDetails = err?.details ? JSON.stringify(err.details, null, 2) : JSON.stringify(err, Object.getOwnPropertyNames(err), 2); } catch { errorDetails = String(err); }
        updateUploadItem(item.id, { status: "error", errorShort, errorDetails });
        ui.addToast(`上传失败: ${errorShort}`, 3000, "error");
      }
    }

    async function signEventWrapper(evt: any) {
      if ((keys as any).signEvent) return await (keys as any).signEvent(evt);
      if ((window as any).nostr?.signEvent) return await (window as any).nostr.signEvent(evt);
      if ((keys as any).skHex) {
        try {
          const nt = await import("nostr-tools");
          const sk = (keys as any).skHex as string;
          evt.pubkey = nt.getPublicKey(sk);
          evt.id = nt.getEventHash(evt);
          if (nt.signEvent) return await nt.signEvent(evt, sk);
          if (nt.schnorr) { const sig = await nt.schnorr.sign(evt.id, sk); evt.sig = typeof sig === "string" ? sig : Array.from(sig).map((b:number)=>b.toString(16).padStart(2,"0")).join(""); return evt; }
          if (nt.secp256k1) { const r = await nt.secp256k1.sign(evt.id, sk); evt.sig = (typeof r === "string" ? r : (r as any).signature || String(r)); return evt; }
        } catch (e:any) { throw new Error("本地签名失败: " + (e?.message||String(e))); }
      }
      throw new Error("未找到可用签名器（keys.signEvent / window.nostr / 本地 skHex）");
    }

    function removeUpload(idx:number) {
      const item = uploads.value[idx];
      if (item && item.preview) { try { URL.revokeObjectURL(item.preview); } catch {} }
      uploads.value.splice(idx, 1);
    }

    function onClose() {
      ui.closePostEditor();
      content.value = ""; error.value = null; allFriends.value = true; selectedGroups.value = [];
      for (const item of uploads.value) { if (item.preview) { try { URL.revokeObjectURL(item.preview) } catch {} } }
      uploads.value = [];
    }

    let triggerElement: HTMLElement | null = null;

    watch(() => ui.showPostEditor, async (show) => {
      if (show) {
        triggerElement = document.activeElement as HTMLElement;
        if (!currentPostId.value) initPost();
        await checkBlossom();
        if (!keys.pkHex) { ui.closePostEditor(); ui.addToast("请先登录", 2000, "error"); return; }
        await friends.load();
        await msgs.load();
        allFriends.value = true; selectedGroups.value = [];
        await nextTick(); overlay.value?.focus(); textarea.value?.focus();
      } else {
        if (triggerElement?.focus) setTimeout(() => { triggerElement?.focus(); }, 100);
      }
    });

    onBeforeUnmount(()=>{
      for (const it of uploads.value) { if (it.preview) { try { URL.revokeObjectURL(it.preview) } catch {} } }
    });

    watch(()=>groups.value, (g)=>{ if (g.length===0) { allFriends.value = true; selectedGroups.value = [] } });

    async function onSend() {
      if (!keys.pkHex) { error.value = "请先登录"; return; }
      if (!canSend.value) { error.value = "请输入内容"; return; }
      sending.value = true; error.value = null;

      let recips = recipients.value.slice();
      if (keys.pkHex && !recips.includes(keys.pkHex)) recips.push(keys.pkHex);
      recips = Array.from(new Set(recips.filter(Boolean)));
      if (recips.length === 0) { error.value = "未指定收件人"; sending.value = false; return; }

      try {
        let fullContent = content.value;
        const uploadedImages = uploads.value.filter(u => u.status === 'done' && u.url);
        if (uploadedImages.length > 0) {
          if (fullContent.length > 0 && !fullContent.endsWith("\n")) fullContent += "\n";
          for (const img of uploadedImages) { fullContent += `![](${img.url})\n`; }
        }

        const { signed } = await posts.publishNip44PerMessage(recips, fullContent);
        try { await msgs.load(); msgs.addInbox({ id: signed.id, pubkey: keys.pkHex, created_at: signed.created_at, content: fullContent }); } catch {}
        ui.addToast("发送成功", 1200, "success");
        onClose();
        setTimeout(()=>{ router.push('/'); }, 220);
      } catch (e:any) {
        console.error("publish error", e);
        error.value = e?.message ?? "发送失败";
        ui.addToast("发送失败", 2000, "error");
      } finally { sending.value = false; }
    }

    return {
      visible, content, sending, allFriends, selectedGroups, groups, countByGroup,
      canSend, textarea, overlay, error, onSend, onClose, toggleAll, toggleGroup,
      recipientsCount, selectedSet, gLabel, friends, uploads, uploadEnabled, uploadingAny,
      onFilesSelected, removeUpload, checkBlossom
    };
  }
});
</script>


<style scoped>
/* Global box-sizing for all elements to prevent width issues */
* {
  box-sizing: border-box;
}

/* overlay and modal */
.editor-overlay {
  position: fixed;
  inset: 0;
  /* Reserve space for bottom navigation (80px height) */
  bottom: 80px;
  display: flex;
  align-items: flex-end; /* start from bottom */
  justify-content: center;
  background: rgba(0, 0, 0, 0.15);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  z-index: 2000;
  outline: none;
}

.editor-card {
  width: 100%;
  max-width: 720px;
  background: #fff;
  border-top-left-radius: 12px;
  border-top-right-radius: 12px;
  box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.12);
  transform: translateY(0);
  box-sizing: border-box;
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
  max-height: 70vh;
  overflow-y: auto;
  box-sizing: border-box;
}
.editor-textarea {
  width: 100%;
  min-height: 140px;
  padding: 10px;
  border: 1px solid #e6edf3;
  border-radius: 8px;
  resize: vertical;
  font-size: 16px;
  box-sizing: border-box;
  /* Better mobile input handling */
  -webkit-appearance: none;
  touch-action: manipulation;
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
  flex-wrap: wrap;
}
.upload-btn {
  background: transparent;
  color: #3b82f6;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  display: inline-block;
  border: 1px solid #3b82f6;
  transition: all 0.2s ease;
}
.upload-btn:hover {
  background: #3b82f6;
  color: white;
  transform: translateY(-1px);
}
.upload-btn input { display: none; }
.upload-btn.disabled { 
  background: transparent; 
  color: #9ca3af; 
  border: 1px solid #cbd5e1; 
  cursor: not-allowed; 
}
.upload-btn.disabled:hover {
  background: transparent;
  color: #9ca3af;
  transform: none;
}
.check-btn {
  background: transparent;
  color: #3b82f6;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #3b82f6;
  cursor: pointer;
  transition: all 0.2s ease;
}
.check-btn:hover {
  background: #3b82f6;
  color: white;
  transform: translateY(-1px);
}
.upload-config-hint .ok { color:#16a34a; }
.upload-config-hint .warn { color:#d97706; }

/* previews - horizontal thumbnail layout */
.previews { 
  margin-top: 12px;
  display: flex;
  flex-direction: row;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 8px;
  -webkit-overflow-scrolling: touch;
}

.preview-item {
  flex-shrink: 0;
}

.thumb-container {
  position: relative;
  width: 100px;
  height: 100px;
  border-radius: 12px;
  overflow: hidden;
  background: #f3f4f6;
  border: 2px solid #e5e7eb;
  transition: all 0.2s ease;
}

.thumb-container:hover {
  border-color: #3b82f6;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
}

.thumb-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9ca3af;
  font-size: 14px;
}

.upload-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
}

.progress-ring {
  position: relative;
  width: 40px;
  height: 40px;
}

.progress-circle {
  transform: rotate(-90deg);
}

.progress-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: white;
  font-size: 11px;
  font-weight: 600;
}

.error-overlay {
  position: absolute;
  inset: 0;
  background: rgba(239, 68, 68, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
}

.remove-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all 0.2s ease;
  padding: 4px;
}

.remove-btn svg {
  width: 16px;
  height: 16px;
  stroke: currentColor;
}

.thumb-container:hover .remove-btn {
  opacity: 1;
}

.remove-btn:hover {
  background: #ef4444;
  transform: scale(1.1);
}

/* chips UI */
.groups { margin-top:12px; }
.chips-row { 
  display:flex; 
  align-items:center; 
  gap:8px; 
  flex-wrap:nowrap;
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
  background: transparent;
  color: #ef4444;
  padding: 8px 20px;
  border-radius: 8px;
  border: 1px solid #ef4444;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s ease;
}

.cancel-btn:hover {
  background: #ef4444;
  color: white;
  transform: translateY(-1px);
}

.send-btn {
  background: transparent;
  color: #3b82f6;
  padding: 8px 20px;
  border-radius: 8px;
  border: 1px solid #3b82f6;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s ease;
}
.send-btn:hover {
  background: #3b82f6;
  color: white;
  transform: translateY(-1px);
}
.send-btn[disabled] {
  cursor: not-allowed;
  background: transparent;
  color: #9ca3af;
  border-color: #cbd5e1;
}
.send-btn[disabled]:hover {
  background: transparent;
  color: #9ca3af;
  transform: none;
}

/* footer */
.editor-footer { padding:10px 12px 20px; border-top:1px solid #f3f6f8; }

/* slide up animation - slower and smoother */
.slide-up-enter-active {
  transition: all 400ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.slide-up-leave-active {
  transition: all 300ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.slide-up-enter-from {
  transform: translateY(100%);
  opacity: 0;
}

.slide-up-leave-to {
  transform: translateY(100%);
  opacity: 0;
}

.slide-up-enter-to, .slide-up-leave-from {
  transform: translateY(0%);
  opacity: 1;
}

/* responsive */
@media (min-width:720px) {
  .editor-overlay { align-items:center; }
  .editor-card { 
    border-radius:12px; 
    max-height:80vh;
  }
}
.error { margin-top:8px; color:#d00; font-size:13px; }
.small { color:#64748b; font-size:12px; }
</style>
