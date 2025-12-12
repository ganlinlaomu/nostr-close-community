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
            placeholder="输入 relay 地址（例如：wss://relay.example.com）"
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
            placeholder="输入 Blossom 图床地址（例如：https://blossom.example/upload）"
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
import { useKeyStore } from "@/stores/keys";
import { useSettingsStore, type BlossomServer } from "@/stores/settings";
import { useUIStore } from "@/stores/ui";
import { db } from "@/db/dexie";

export default defineComponent({
  setup() {
    const ks = useKeyStore();
    const settings = useSettingsStore();
    const ui = useUIStore();
    const shortPk = computed(() => (ks.pkHex ? ks.pkHex.slice(0, 8) + "..." : ""));

    // Sync success message state
    const showSyncSuccess = ref(false);
    const isFadingOut = ref(false);
    let hideTimeout: ReturnType<typeof setTimeout> | null = null;
    let fadeTimeout: ReturnType<typeof setTimeout> | null = null;

    // Relay management
    const newRelay = ref("");
    const statuses = reactive<Record<string, any>>({});
    const editingRelay = ref<string | null>(null);
    const editedRelayValue = ref("");

    // Blossom management
    const newBlossomUrl = ref("");
    const editingBlossom = ref<number | null>(null);
    const editedBlossomUrl = ref("");
    const editedBlossomToken = ref("");

    // Watch for sync completion to show/hide success message
    watch(() => settings.lastSyncTimestamp, (newVal, oldVal) => {
      if (newVal > 0 && newVal !== oldVal && !settings.syncing && !settings.syncError) {
        // Clear any existing timeouts
        if (hideTimeout) {
          clearTimeout(hideTimeout);
          hideTimeout = null;
        }
        if (fadeTimeout) {
          clearTimeout(fadeTimeout);
          fadeTimeout = null;
        }
        
        // Show the success message
        showSyncSuccess.value = true;
        isFadingOut.value = false;
        
        // Start fade-out after 3 seconds
        hideTimeout = setTimeout(() => {
          isFadingOut.value = true;
          // Hide completely after fade-out animation (0.5s)
          fadeTimeout = setTimeout(() => {
            showSyncSuccess.value = false;
            isFadingOut.value = false;
            fadeTimeout = null;
          }, 500);
          hideTimeout = null;
        }, 3000);
      }
    });

    function shortRelay(u: string) {
      return u.replace(/^wss?:\/\//, "").replace(/\/$/, "");
    }

    // Relay functions - now using settings store
    function loadRelays() {
      // Migration from old localStorage format
      const stored = localStorage.getItem("custom-relays");
      if (stored && settings.relayList.length === 0) {
        const relays = stored.split("\n").filter((r: string) => r.trim());
        if (relays.length > 0) {
          settings.updateRelays(relays);
          // Remove old format
          localStorage.removeItem("custom-relays");
        }
      } else if (settings.relayList.length === 0) {
        // Initialize with defaults
        settings.updateRelays([...DEFAULT_RELAYS]);
      }
    }

    function saveRelaysToStorage() {
      // Also update localStorage for backward compatibility with relay module
      localStorage.setItem("custom-relays", settings.relayList.join("\n"));
    }

    function addRelay() {
      const relay = newRelay.value.trim();
      if (!relay) {
        alert("请输入有效的 relay 地址");
        return;
      }
      if (settings.relayList.includes(relay)) {
        alert("该 relay 已存在");
        return;
      }
      const updated = [...settings.relayList, relay];
      settings.updateRelays(updated);
      // Also update localStorage for backward compatibility
      localStorage.setItem("custom-relays", updated.join("\n"));
      newRelay.value = "";
      refreshStatuses();
    }

    function deleteRelay(relay: string) {
      if (confirm(`确定要删除 ${shortRelay(relay)} 吗？`)) {
        const updated = settings.relayList.filter((r: string) => r !== relay);
        settings.updateRelays(updated);
        // Also update localStorage for backward compatibility
        localStorage.setItem("custom-relays", updated.join("\n"));
        delete statuses[relay];
      }
    }

    function startEditRelay(relay: string) {
      editingRelay.value = relay;
      editedRelayValue.value = relay;
    }

    function saveEditRelay(oldRelay: string) {
      const newRelay = editedRelayValue.value.trim();
      if (!newRelay) {
        alert("请输入有效的 relay 地址");
        return;
      }
      if (newRelay !== oldRelay && settings.relayList.includes(newRelay)) {
        alert("该 relay 已存在");
        return;
      }
      const index = settings.relayList.indexOf(oldRelay);
      if (index !== -1) {
        const updated = [...settings.relayList];
        updated[index] = newRelay;
        settings.updateRelays(updated);
        // Also update localStorage for backward compatibility
        localStorage.setItem("custom-relays", updated.join("\n"));
      }
      editingRelay.value = null;
      refreshStatuses();
    }

    function cancelEditRelay() {
      editingRelay.value = null;
      editedRelayValue.value = "";
    }

    // Blossom functions - now using settings store
    function migrateOldBlossomFormat() {
      const url = localStorage.getItem("blossom_upload_url") || "";
      const token = localStorage.getItem("blossom_token") || "";
      if (url && settings.blossomList.length === 0) {
        settings.updateBlossomServers([{ url, token }]);
      }
    }

    function loadBlossoms() {
      // Migration from old localStorage format
      const stored = localStorage.getItem("blossom_servers");
      if (stored && settings.blossomList.length === 0) {
        try {
          const servers = JSON.parse(stored);
          if (Array.isArray(servers) && servers.length > 0) {
            settings.updateBlossomServers(servers);
          } else {
            migrateOldBlossomFormat();
          }
        } catch (e) {
          migrateOldBlossomFormat();
        }
      } else if (settings.blossomList.length === 0) {
        migrateOldBlossomFormat();
      }
    }

    function saveBlossomsToStorage() {
      // Keep compatibility with PostEditor
      localStorage.setItem("blossom_servers", JSON.stringify(settings.blossomList));
      if (settings.blossomList.length > 0) {
        localStorage.setItem("blossom_upload_url", settings.blossomList[0].url);
        localStorage.setItem("blossom_token", settings.blossomList[0].token);
      } else {
        localStorage.removeItem("blossom_upload_url");
        localStorage.removeItem("blossom_token");
      }
      window.dispatchEvent(new Event("blossom-config-updated"));
    }

    function addBlossom() {
      const url = newBlossomUrl.value.trim();
      if (!url) {
        alert("请输入有效的 Blossom 图床地址");
        return;
      }
      const updated = [...settings.blossomList, { url, token: "" }];
      settings.updateBlossomServers(updated);
      saveBlossomsToStorage();
      newBlossomUrl.value = "";
    }

    function deleteBlossom(index: number) {
      if (confirm("确定要删除该 Blossom 图床吗？")) {
        const updated = [...settings.blossomList];
        updated.splice(index, 1);
        settings.updateBlossomServers(updated);
        saveBlossomsToStorage();
      }
    }

    function startEditBlossom(index: number) {
      editingBlossom.value = index;
      editedBlossomUrl.value = settings.blossomList[index].url;
      editedBlossomToken.value = settings.blossomList[index].token;
    }

    function saveEditBlossom(index: number) {
      const url = editedBlossomUrl.value.trim();
      if (!url) {
        alert("请输入有效的 Blossom 图床地址");
        return;
      }
      const updated = [...settings.blossomList];
      updated[index] = {
        url,
        token: editedBlossomToken.value.trim()
      };
      settings.updateBlossomServers(updated);
      saveBlossomsToStorage();
      editingBlossom.value = null;
    }

    function cancelEditBlossom() {
      editingBlossom.value = null;
      editedBlossomUrl.value = "";
      editedBlossomToken.value = "";
    }

    function refreshStatuses() {
      const info = inspectRelays();
      // Clear old statuses for removed relays
      const currentRelays = new Set(settings.relayList);
      for (const r in statuses) {
        if (!currentRelays.has(r)) {
          delete statuses[r];
        }
      }
      // Update statuses for current relays
      for (const r of settings.relayList) {
        statuses[r] = info[r] || { ready: false, queueLength: 0, subs: 0, okHandlers: 0 };
      }
    }

    function reconnect(url: string) {
      reconnectRelay(url);
      setTimeout(refreshStatuses, 800);
    }

    const doLogout = () => {
      ks.logout();
      location.href = "/#/login";
    };

    onMounted(() => {
      loadRelays();
      loadBlossoms();
      refreshStatuses();
      
      // Auto-refresh statuses every 5 seconds
      const intervalId = setInterval(refreshStatuses, 5000);
      
      return () => {
        clearInterval(intervalId);
      };
    });

    onBeforeUnmount(() => {
      // Clean up timeouts to prevent memory leaks
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }
      if (fadeTimeout) {
        clearTimeout(fadeTimeout);
        fadeTimeout = null;
      }
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
      refreshStatuses,
      reconnect,
      doLogout,
      settings,
      showSyncSuccess,
      isFadingOut
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
  background: #ef4444;
  color: white;
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
