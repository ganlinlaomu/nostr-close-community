<template>
  <div class="settings-container">
    <div class="card">
      <h3>设置</h3>

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
                      :class="{ 'status-connected': statuses[relay]?.ready, 'status-disconnected': !statuses[relay]?.ready }"
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
                    <span class="status-icon status-default">✓</span>
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
import { defineComponent, ref, reactive, onMounted, computed } from "vue";
import { DEFAULT_RELAYS, getRelaysFromStorage, inspectRelays, reconnectRelay } from "@/nostr/relays";
import { useKeyStore } from "@/stores/keys";
import { db } from "@/db/dexie";

interface BlossomServer {
  url: string;
  token: string;
}

export default defineComponent({
  setup() {
    const ks = useKeyStore();
    const shortPk = computed(() => (ks.pkHex ? ks.pkHex.slice(0, 8) + "..." : ""));

    // Relay management
    const newRelay = ref("");
    const relayList = ref<string[]>([]);
    const statuses = reactive<Record<string, any>>({});
    const editingRelay = ref<string | null>(null);
    const editedRelayValue = ref("");

    // Blossom management
    const newBlossomUrl = ref("");
    const blossomList = ref<BlossomServer[]>([]);
    const editingBlossom = ref<number | null>(null);
    const editedBlossomUrl = ref("");
    const editedBlossomToken = ref("");

    function shortRelay(u: string) {
      return u.replace(/^wss?:\/\//, "").replace(/\/$/, "");
    }

    // Relay functions
    function loadRelays() {
      const stored = localStorage.getItem("custom-relays");
      if (stored) {
        relayList.value = stored.split("\n").filter((r: string) => r.trim());
      } else {
        relayList.value = [...DEFAULT_RELAYS];
      }
    }

    function saveRelaysToStorage() {
      localStorage.setItem("custom-relays", relayList.value.join("\n"));
    }

    function addRelay() {
      const relay = newRelay.value.trim();
      if (!relay) {
        alert("请输入有效的 relay 地址");
        return;
      }
      if (relayList.value.includes(relay)) {
        alert("该 relay 已存在");
        return;
      }
      relayList.value.push(relay);
      saveRelaysToStorage();
      newRelay.value = "";
      refreshStatuses();
    }

    function deleteRelay(relay: string) {
      if (confirm(`确定要删除 ${shortRelay(relay)} 吗？`)) {
        relayList.value = relayList.value.filter((r: string) => r !== relay);
        saveRelaysToStorage();
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
      if (newRelay !== oldRelay && relayList.value.includes(newRelay)) {
        alert("该 relay 已存在");
        return;
      }
      const index = relayList.value.indexOf(oldRelay);
      if (index !== -1) {
        relayList.value[index] = newRelay;
        saveRelaysToStorage();
      }
      editingRelay.value = null;
      refreshStatuses();
    }

    function cancelEditRelay() {
      editingRelay.value = null;
      editedRelayValue.value = "";
    }

    // Blossom functions
    function migrateOldBlossomFormat() {
      const url = localStorage.getItem("blossom_upload_url") || "";
      const token = localStorage.getItem("blossom_token") || "";
      if (url) {
        blossomList.value = [{ url, token }];
        saveBlossomsToStorage();
      } else {
        blossomList.value = [];
      }
    }

    function loadBlossoms() {
      const stored = localStorage.getItem("blossom_servers");
      if (stored) {
        try {
          blossomList.value = JSON.parse(stored);
        } catch (e) {
          // Migration from old format
          migrateOldBlossomFormat();
        }
      } else {
        // Migration from old format
        migrateOldBlossomFormat();
      }
    }

    function saveBlossomsToStorage() {
      localStorage.setItem("blossom_servers", JSON.stringify(blossomList.value));
      // Keep compatibility with PostEditor
      if (blossomList.value.length > 0) {
        localStorage.setItem("blossom_upload_url", blossomList.value[0].url);
        localStorage.setItem("blossom_token", blossomList.value[0].token);
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
      blossomList.value.push({ url, token: "" });
      saveBlossomsToStorage();
      newBlossomUrl.value = "";
    }

    function deleteBlossom(index: number) {
      if (confirm("确定要删除该 Blossom 图床吗？")) {
        blossomList.value.splice(index, 1);
        saveBlossomsToStorage();
      }
    }

    function startEditBlossom(index: number) {
      editingBlossom.value = index;
      editedBlossomUrl.value = blossomList.value[index].url;
      editedBlossomToken.value = blossomList.value[index].token;
    }

    function saveEditBlossom(index: number) {
      const url = editedBlossomUrl.value.trim();
      if (!url) {
        alert("请输入有效的 Blossom 图床地址");
        return;
      }
      blossomList.value[index] = {
        url,
        token: editedBlossomToken.value.trim()
      };
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
      const currentRelays = new Set(relayList.value);
      for (const r in statuses) {
        if (!currentRelays.has(r)) {
          delete statuses[r];
        }
      }
      // Update statuses for current relays
      for (const r of relayList.value) {
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

    return {
      shortPk,
      newRelay,
      relayList,
      statuses,
      editingRelay,
      editedRelayValue,
      addRelay,
      deleteRelay,
      startEditRelay,
      saveEditRelay,
      cancelEditRelay,
      newBlossomUrl,
      blossomList,
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
      doLogout
    };
  }
});
</script>

<style scoped>
.settings-container {
  max-width: 100%;
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
  background: var(--accent);
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.btn-primary:hover {
  background: #1565c0;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(25, 118, 210, 0.3);
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
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: bold;
}

.status-connected {
  background: #10b981;
  color: white;
}

.status-disconnected {
  background: #ef4444;
  color: white;
}

.status-default {
  background: #3b82f6;
  color: white;
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
  color: #64748b;
  border: 1px solid #cbd5e1;
}

.btn-cancel:hover {
  background: #64748b;
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
  background: #ef4444;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
  max-width: 150px;
}

.btn-danger:hover {
  background: #dc2626;
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
