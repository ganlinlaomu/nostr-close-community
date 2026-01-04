<template>
  <div class="settings-container">
    <!-- Sync Status Bar -->
    <div v-if="settings.syncing" class="sync-status syncing">
      <span class="sync-icon">⟳</span> 同步中...
    </div>
    <div v-else-if="settings.syncError" class="sync-status error">
      <span class="sync-icon">⚠</span> 同步失败: {{ settings.syncError }}
    </div>
    <div v-else-if="settings.lastSyncTimestamp > 0 && showSyncSuccess" class="sync-status success" :class="{ 'fade-out': isFadingOut }">
      <span class="sync-icon icon-check-success">✓</span> 已同步
    </div>

    <div class="card">
      <h3 style="margin: 0 0 12px 0;">设置</h3>

      <!-- Relay Management Section -->
      <div class="section">
        <h4>Relay 管理</h4>
        <div class="add-form">
          <input 
            v-model="newRelay" 
            class="input" 
            placeholder="例如：wss://relay.example.com"
            @keyup.enter="addRelay"
          />
          <button class="btn btn-primary" @click="addRelay">添加</button>
        </div>
        
        <div v-if="relayList.length === 0" class="empty-message">
          <span class="small">暂无 relay，请添加</span>
        </div>
        
        <div class="item-list" v-else>
          <div v-for="(relay, index) in relayList" :key="relay" class="item-card">
            <div class="item-content">
              <div class="item-main">
                <div v-if="editingRelay !== relay" class="item-info">
                  <div class="item-url">{{ shortRelay(relay) }}</div>
                  <div class="item-status">
                    <span 
                      class="status-icon" 
                      :class="{ 'icon-check-success': statuses[relay]?.ready, 'status-disconnected': !statuses[relay]?.ready }"
                    >
                      {{ statuses[relay]?.ready ? '✓' : '✗' }}
                    </span>
                    <span class="status-text">{{ statuses[relay]?.ready ? '已连接' : '未连接' }}</span>
                  </div>
                </div>
                <input 
                  v-else
                  v-model="editedRelayValue"
                  class="input input-inline"
                  @keyup.enter="saveEditRelay(relay)"
                  @keyup.esc="cancelEditRelay"
                />
              </div>
              <div class="item-actions">
                <template v-if="editingRelay !== relay">
                  <button class="btn-icon btn-edit" @click="startEditRelay(relay)" title="编辑">✎</button>
                  <button class="btn-icon btn-delete" @click="deleteRelay(relay)" title="删除">🗑</button>
                </template>
                <template v-else>
                  <button class="btn-icon btn-save" @click="saveEditRelay(relay)" title="保存">✓</button>
                  <button class="btn-icon btn-cancel" @click="cancelEditRelay" title="取消">✗</button>
                </template>
              </div>
            </div>
          </div>
        </div>
        
        <div v-if="relayList.length > 0" class="section-note">
          <span class="small">注意：修改 relay 后需刷新页面以应用更改</span>
        </div>
      </div>

      <!-- Blossom Management Section -->
      <div class="section">
        <h4>Blossom 图床管理</h4>
        <div class="add-form">
          <input 
            v-model="newBlossomUrl" 
            class="input" 
            placeholder="例如：https://blossom.example"
            @keyup.enter="addBlossom"
          />
          <button class="btn btn-primary" @click="addBlossom">添加</button>
        </div>
        
        <div v-if="blossomList.length === 0" class="empty-message">
          <span class="small">暂无 Blossom 图床，请添加</span>
        </div>
        
        <div class="item-list" v-else>
          <div v-for="(blossom, index) in blossomList" :key="index" class="item-card">
            <div class="item-content">
              <div class="item-main">
                <div v-if="editingBlossom !== index" class="item-info">
                  <div class="item-url">{{ blossom.url }}</div>
                  <div class="item-status">
                    <span class="status-icon icon-check-success">✓</span>
                    <span class="status-text">{{ blossom.token ? '已配置 Token' : '无 Token' }}</span>
                  </div>
                </div>
                <div v-else class="edit-form">
                  <input 
                    v-model="editedBlossomUrl"
                    class="input input-inline"
                    placeholder="图床地址"
                  />
                  <input 
                    v-model="editedBlossomToken"
                    class="input input-inline"
                    placeholder="Token（可选）"
                  />
                </div>
              </div>
              <div class="item-actions">
                <template v-if="editingBlossom !== index">
                  <button class="btn-icon btn-edit" @click="startEditBlossom(index)" title="编辑">✎</button>
                  <button class="btn-icon btn-delete" @click="deleteBlossom(index)" title="删除">🗑</button>
                </template>
                <template v-else>
                  <button class="btn-icon btn-save" @click="saveEditBlossom(index)" title="保存">✓</button>
                  <button class="btn-icon btn-cancel" @click="cancelEditBlossom" title="取消">✗</button>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Cache Management Section -->
      <div class="section">
        <h4>缓存管理</h4>
        <div class="cache-info">
          <div class="small">
            <div>图片缓存: {{ cacheStats.count }} 个文件</div>
            <div>缓存大小: {{ formatSize(cacheStats.size) }}</div>
            <div v-if="cacheStats.oldestTimestamp > 0">
              最早缓存: {{ new Date(cacheStats.oldestTimestamp).toLocaleDateString() }}
            </div>
          </div>
          <div class="cache-actions">
            <button class="btn btn-secondary" @click="refreshCacheStats" :disabled="loadingCache">
              {{ loadingCache ? '加载中...' : '刷新统计' }}
            </button>
            <button class="btn btn-warning" @click="clearCache" :disabled="clearingCache">
              {{ clearingCache ? '清理中...' : '清空缓存' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Account Section -->
      <div class="section">
        <h4>账户</h4>
        <div class="account-info">
          <div class="small">已登录：{{ shortPk }}</div>
          <button class="btn btn-danger" @click="doLogout">退出登录</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, reactive, onMounted, onBeforeUnmount, computed, watch } from "vue";
import { DEFAULT_RELAYS, getRelaysFromStorage, inspectRelays, reconnectRelay } from "@/nostr/relays";
import { DEFAULT_BLOSSOM_SERVERS } from "@/utils/blossom";
import { useKeyStore } from "@/stores/keys";
import { useSettingsStore, type BlossomServer } from "@/stores/settings";
import { useUIStore } from "@/stores/ui";
import { db } from "@/db/dexie";
import { getCacheStats, clearAllCache } from "@/utils/imageCache";

export default defineComponent({
  name: "Settings",
  setup() {
    const ks = useKeyStore();
    const settings = useSettingsStore();
    const ui = useUIStore();
    const shortPk = computed(() => (ks.pkHex ? ks.pkHex.slice(0, 8) + "..." : ""));

    /* ================= sync ui ================= */

    const showSyncSuccess = ref(false);
    const isFadingOut = ref(false);
    let hideTimeout: ReturnType<typeof setTimeout> | null = null;
    let fadeTimeout: ReturnType<typeof setTimeout> | null = null;

    watch(() => settings.lastSyncTimestamp, (newVal, oldVal) => {
      if (newVal > 0 && newVal !== oldVal && !settings.syncing && !settings.syncError) {
        if (hideTimeout) clearTimeout(hideTimeout);
        if (fadeTimeout) clearTimeout(fadeTimeout);

        showSyncSuccess.value = true;
        isFadingOut.value = false;

        hideTimeout = setTimeout(() => {
          isFadingOut.value = true;
          fadeTimeout = setTimeout(() => {
            showSyncSuccess.value = false;
            isFadingOut.value = false;
          }, 500);
        }, 3000);
      }
    });

    /* ================= relay ================= */

    const newRelay = ref("");
    const statuses = reactive<Record<string, any>>({});
    const editingRelay = ref<string | null>(null);
    const editedRelayValue = ref("");

    function shortRelay(u: string) {
      return u.replace(/^wss?:\/\//, "").replace(/\/$/, "");
    }

    function loadRelays() {
      // 仅做一次旧数据迁移
      const stored = localStorage.getItem("custom-relays");
      if (stored && settings.relayList.length === 0) {
        const relays = stored.split("\n").filter(Boolean);
        if (relays.length) {
          settings.updateRelays(relays);
          localStorage.removeItem("custom-relays");
        }
      } else if (settings.relayList.length === 0) {
        settings.updateRelays([...DEFAULT_RELAYS]);
      }
    }

    function addRelay() {
      const relay = newRelay.value.trim();
      if (!relay || settings.relayList.includes(relay)) return;
      settings.updateRelays([...settings.relayList, relay]);
      newRelay.value = "";
      refreshStatuses();
    }

    function deleteRelay(relay: string) {
      if (!confirm(`确定要删除 ${shortRelay(relay)} 吗？`)) return;
      settings.updateRelays(settings.relayList.filter(r => r !== relay));
      delete statuses[relay];
    }

    function startEditRelay(relay: string) {
      editingRelay.value = relay;
      editedRelayValue.value = relay;
    }

    function saveEditRelay(oldRelay: string) {
      const next = editedRelayValue.value.trim();
      if (!next) return;

      const list = [...settings.relayList];
      const idx = list.indexOf(oldRelay);
      if (idx !== -1) {
        list[idx] = next;
        settings.updateRelays(list);
      }
      editingRelay.value = null;
      refreshStatuses();
    }

    function cancelEditRelay() {
      editingRelay.value = null;
      editedRelayValue.value = "";
    }

    function refreshStatuses() {
      const info = inspectRelays();
      const current = new Set(settings.relayList);

      for (const r in statuses) {
        if (!current.has(r)) delete statuses[r];
      }

      for (const r of settings.relayList) {
        statuses[r] = info[r] || { ready: false };
      }
    }

    /* ================= blossom ================= */

    const newBlossomUrl = ref("");
    const editingBlossom = ref<number | null>(null);
    const editedBlossomUrl = ref("");
    const editedBlossomToken = ref("");

    function migrateOldBlossomFormat() {
      const url = localStorage.getItem("blossom_upload_url") || "";
      const token = localStorage.getItem("blossom_token") || "";
      if (url && settings.blossomList.length === 0) {
        settings.updateBlossomServers([{ url, token }]);
      }
    }

    function loadBlossoms() {
      const stored = localStorage.getItem("blossom_servers");
      if (stored && settings.blossomList.length === 0) {
        try {
          const servers = JSON.parse(stored);
          if (Array.isArray(servers)) settings.updateBlossomServers(servers);
        } catch {
          migrateOldBlossomFormat();
        }
      }
      if (settings.blossomList.length === 0) {
        settings.updateBlossomServers([...DEFAULT_BLOSSOM_SERVERS]);
      }
    }

    function addBlossom() {
      const url = newBlossomUrl.value.trim();
      if (!url) return;
      settings.updateBlossomServers([...settings.blossomList, { url, token: "" }]);
      newBlossomUrl.value = "";
    }

    function deleteBlossom(index: number) {
      if (!confirm("确定要删除该 Blossom 图床吗？")) return;
      const list = [...settings.blossomList];
      list.splice(index, 1);
      settings.updateBlossomServers(list);
    }

    function startEditBlossom(index: number) {
      editingBlossom.value = index;
      editedBlossomUrl.value = settings.blossomList[index].url;
      editedBlossomToken.value = settings.blossomList[index].token;
    }

    function saveEditBlossom(index: number) {
      const url = editedBlossomUrl.value.trim();
      if (!url) return;
      const list = [...settings.blossomList];
      list[index] = { url, token: editedBlossomToken.value.trim() };
      settings.updateBlossomServers(list);
      editingBlossom.value = null;
    }

    function cancelEditBlossom() {
      editingBlossom.value = null;
      editedBlossomUrl.value = "";
      editedBlossomToken.value = "";
    }

    /* ================= cache / account ================= */

    const cacheStats = reactive({ count: 0, size: 0, oldestTimestamp: 0 });
    const loadingCache = ref(false);
    const clearingCache = ref(false);

    async function refreshCacheStats() {
      loadingCache.value = true;
      Object.assign(cacheStats, await getCacheStats());
      loadingCache.value = false;
    }

    async function clearCache() {
      if (!confirm("确定要清空所有图片缓存吗？")) return;
      clearingCache.value = true;
      await clearAllCache();
      await refreshCacheStats();
      clearingCache.value = false;
    }

    function formatSize(bytes: number) {
      if (!bytes) return "0 B";
      const k = 1024;
      const sizes = ["B", "KB", "MB", "GB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return (bytes / Math.pow(k, i)).toFixed(2) + " " + sizes[i];
    }

    const doLogout = () => {
      ks.logout();
      location.href = "/#/login";
    };

    onMounted(() => {
      loadRelays();
      loadBlossoms();
      refreshStatuses();
      refreshCacheStats();
      const id = setInterval(refreshStatuses, 5000);
      onBeforeUnmount(() => clearInterval(id));
    });

    return {
      shortPk,
      newRelay,
      relayList: computed(() => settings.relayList),
      statuses,
      editingRelay,
      editedRelayValue,
      addRelay,
      deleteRelay,
      startEditRelay,
      saveEditRelay,
      cancelEditRelay,
      newBlossomUrl,
      blossomList: computed(() => settings.blossomList),
      editingBlossom,
      editedBlossomUrl,
      editedBlossomToken,
      addBlossom,
      deleteBlossom,
      startEditBlossom,
      saveEditBlossom,
      cancelEditBlossom,
      shortRelay,
      doLogout,
      settings,
      showSyncSuccess,
      isFadingOut,
      cacheStats,
      loadingCache,
      clearingCache,
      refreshCacheStats,
      clearCache,
      formatSize
    };
  }
});
</script>


<style scoped>
.sync-status {
  padding: 10px 16px;
  margin-bottom: 12px;
  border-radius: 8px;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: opacity 0.5s ease-out;
}

.sync-status.fade-out {
  opacity: 0;
}

.sync-status.syncing {
  background: #dbeafe;
  color: #1e40af;
}

.sync-status.success {
  background: #dcfce7;
  color: #15803d;
  border: 2px solid #10b981;
}

.sync-status.error {
  background: #fee2e2;
  color: #991b1b;
}

.sync-icon {
  font-size: 16px;
  font-weight: bold;
}

.icon-check-success {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid #10b981;
  color: #10b981;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  background: transparent;
}

.settings-container {
  max-width: 100%;
  padding-bottom: calc(var(--bottom-nav-height) + env(safe-area-inset-bottom));
}

.section {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid #e2e8f0;
}

.section:first-child {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}

.section h4 {
  margin: 0 0 16px 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--primary);
}

.add-form {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.add-form .input {
  flex: 1;
  margin-top: 0;
}

.btn-primary {
  background: transparent;
  color: #3b82f6;
  border: 1px solid #3b82f6;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.btn-primary:hover {
  background: #3b82f6;
  color: white;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
}

.btn-primary:active {
  transform: translateY(0);
}

.empty-message {
  padding: 24px;
  text-align: center;
  color: #94a3b8;
  background: #f8fafc;
  border-radius: 8px;
  border: 1px dashed #cbd5e1;
}

.item-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.item-card {
  background: #f8fafc;
  border-radius: 8px;
  padding: 12px;
  transition: all 0.2s;
  border: 1px solid #e2e8f0;
}

.item-card:hover {
  background: #f1f5f9;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
}

.item-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.item-main {
  flex: 1;
  min-width: 0;
}

.item-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.item-url {
  font-weight: 500;
  color: var(--primary);
  word-break: break-all;
}

.item-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.status-icon {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: bold;
}

.status-disconnected {
  background: transparent;
  color: #ef4444;
  border: 1px solid #ef4444;
}

.status-text {
  color: #64748b;
}

.item-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.btn-icon {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  transition: all 0.2s;
  background: white;
}

.btn-edit {
  color: #3b82f6;
  border: 1px solid #3b82f6;
}

.btn-edit:hover {
  background: #3b82f6;
  color: white;
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(59, 130, 246, 0.3);
}

.btn-delete {
  color: #ef4444;
  border: 1px solid #ef4444;
}

.btn-delete:hover {
  background: #ef4444;
  color: white;
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(239, 68, 68, 0.3);
}

.btn-save {
  color: #10b981;
  border: 1px solid #10b981;
}

.btn-save:hover {
  background: #10b981;
  color: white;
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(16, 185, 129, 0.3);
}

.btn-cancel {
  color: #ef4444;
  border: 1px solid #ef4444;
}

.btn-cancel:hover {
  background: #ef4444;
  color: white;
  transform: translateY(-1px);
}

.edit-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.input-inline {
  margin-top: 0;
  font-size: 14px;
}

.section-note {
  margin-top: 12px;
  padding: 8px 12px;
  background: #fef3c7;
  border-left: 3px solid #f59e0b;
  border-radius: 4px;
}

.account-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cache-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cache-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.btn-secondary {
  background: transparent;
  color: #64748b;
  border: 1px solid #cbd5e1;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.btn-secondary:hover:not(:disabled) {
  background: #f8fafc;
  border-color: #94a3b8;
  color: #475569;
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-warning {
  background: transparent;
  color: #f59e0b;
  border: 1px solid #f59e0b;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.btn-warning:hover:not(:disabled) {
  background: #f59e0b;
  color: white;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(245, 158, 11, 0.3);
}

.btn-warning:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-danger {
  background: transparent;
  color: #ef4444;
  border: 1px solid #ef4444;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
  max-width: 150px;
}

.btn-danger:hover {
  background: #ef4444;
  color: white;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);
}

.btn-danger:active {
  transform: translateY(0);
}

@media (max-width: 640px) {
  .add-form {
    flex-direction: column;
  }
  
  .item-content {
    flex-direction: column;
    align-items: stretch;
  }
  
  .item-actions {
    justify-content: flex-end;
  }
}
</style>
