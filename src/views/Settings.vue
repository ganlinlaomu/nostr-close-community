

<template>
  <div class="settings-container">
    <!-- Sync Status Bar -->
    <div v-if="settings.syncing" class="sync-status syncing">
      <span class="sync-icon">⟳</span> 同步中...
    </div>
    <div v-else-if="settings.syncError" class="sync-status error">
      <span class="sync-icon">⚠</span> 同步失败: {{ settings.syncError }}
    </div>
    <div
      v-else-if="settings.lastSyncTimestamp > 0 && showSyncSuccess"
      class="sync-status success"
      :class="{ 'fade-out': isFadingOut }"
    >
      <span class="sync-icon icon-check-success">✓</span> 已同步
    </div>

    <div class="card">
      <h3 style="margin: 0 0 12px 0;">设置</h3>

      <!-- Relay -->
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
          <span class="small">暂无 relay</span>
        </div>

        <div v-else class="item-list">
          <div
            v-for="relay in relayList"
            :key="relay"
            class="item-card"
          >
            <div class="item-content">
              <div class="item-main">
                <div v-if="editingRelay !== relay" class="item-info">
                  <div class="item-url">{{ shortRelay(relay) }}</div>
                  <div class="item-status">
                    <span
                      class="status-icon"
                      :class="{
                        'icon-check-success': statuses[relay]?.ready,
                        'status-disconnected': !statuses[relay]?.ready
                      }"
                    >
                      {{ statuses[relay]?.ready ? '✓' : '✗' }}
                    </span>
                    <span class="status-text">
                      {{ statuses[relay]?.ready ? '已连接' : '未连接' }}
                    </span>
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
                  <button class="btn-icon btn-edit" @click="startEditRelay(relay)">✎</button>
                  <button class="btn-icon btn-delete" @click="deleteRelay(relay)">🗑</button>
                </template>
                <template v-else>
                  <button class="btn-icon btn-save" @click="saveEditRelay(relay)">✓</button>
                  <button class="btn-icon btn-cancel" @click="cancelEditRelay">✗</button>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Blossom -->
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
          <span class="small">暂无 Blossom 图床</span>
        </div>

        <div v-else class="item-list">
          <div
            v-for="(b, index) in blossomList"
            :key="index"
            class="item-card"
          >
            <div class="item-content">
              <div class="item-main">
                <div v-if="editingBlossom !== index" class="item-info">
                  <div class="item-url">{{ b.url }}</div>
                  <div class="item-status">
                    <span class="status-icon icon-check-success">✓</span>
                    <span class="status-text">
                      {{ b.token ? '已配置 Token' : '无 Token' }}
                    </span>
                  </div>
                </div>

                <div v-else class="edit-form">
                  <input v-model="editedBlossomUrl" class="input input-inline" />
                  <input v-model="editedBlossomToken" class="input input-inline" />
                </div>
              </div>

              <div class="item-actions">
                <template v-if="editingBlossom !== index">
                  <button class="btn-icon btn-edit" @click="startEditBlossom(index)">✎</button>
                  <button class="btn-icon btn-delete" @click="deleteBlossom(index)">🗑</button>
                </template>
                <template v-else>
                  <button class="btn-icon btn-save" @click="saveEditBlossom(index)">✓</button>
                  <button class="btn-icon btn-cancel" @click="cancelEditBlossom">✗</button>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Account -->
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
import { defineComponent, ref, reactive, computed, watch, onMounted } from "vue";
import { inspectRelays, reconnectRelay } from "@/nostr/relays";
import { useKeyStore } from "@/stores/keys";
import { useSettingsStore } from "@/stores/settings";

export default defineComponent({
  name: "Settings",
  setup() {
    const ks = useKeyStore();
    const settings = useSettingsStore();

    const shortPk = computed(() =>
      ks.pkHex ? ks.pkHex.slice(0, 8) + "…" : ""
    );

    const newRelay = ref("");
    const newBlossomUrl = ref("");

    const editingRelay = ref<string | null>(null);
    const editedRelayValue = ref("");

    const editingBlossom = ref<number | null>(null);
    const editedBlossomUrl = ref("");
    const editedBlossomToken = ref("");

    const statuses = reactive<Record<string, any>>({});

    const showSyncSuccess = ref(false);
    const isFadingOut = ref(false);

    watch(
      () => settings.lastSyncTimestamp,
      (v, o) => {
        if (v > 0 && v !== o) {
          showSyncSuccess.value = true;
          setTimeout(() => (isFadingOut.value = true), 2500);
          setTimeout(() => {
            showSyncSuccess.value = false;
            isFadingOut.value = false;
          }, 3000);
        }
      }
    );

    function shortRelay(u: string) {
      return u.replace(/^wss?:\/\//, "").replace(/\/$/, "");
    }

    function refreshStatuses() {
      const info = inspectRelays();
      for (const r of settings.relayList) {
        statuses[r] = info[r] || { ready: false };
      }
    }

    function addRelay() {
      const r = newRelay.value.trim();
      if (!r || settings.relayList.includes(r)) return;
      settings.updateRelays([...settings.relayList, r]);
      newRelay.value = "";
      refreshStatuses();
    }

    function deleteRelay(r: string) {
      settings.updateRelays(settings.relayList.filter(x => x !== r));
    }

    function startEditRelay(r: string) {
      editingRelay.value = r;
      editedRelayValue.value = r;
    }

    function saveEditRelay(old: string) {
      const v = editedRelayValue.value.trim();
      if (!v) return;
      const list = [...settings.relayList];
      const i = list.indexOf(old);
      if (i !== -1) list[i] = v;
      settings.updateRelays(list);
      editingRelay.value = null;
    }

    function cancelEditRelay() {
      editingRelay.value = null;
    }

    function addBlossom() {
      const url = newBlossomUrl.value.trim();
      if (!url) return;
      settings.updateBlossomServers([
        ...settings.blossomList,
        { url, token: "" }
      ]);
      newBlossomUrl.value = "";
    }

    function deleteBlossom(i: number) {
      const list = [...settings.blossomList];
      list.splice(i, 1);
      settings.updateBlossomServers(list);
    }

    function startEditBlossom(i: number) {
      editingBlossom.value = i;
      editedBlossomUrl.value = settings.blossomList[i].url;
      editedBlossomToken.value = settings.blossomList[i].token;
    }

    function saveEditBlossom(i: number) {
      const list = [...settings.blossomList];
      list[i] = {
        url: editedBlossomUrl.value.trim(),
        token: editedBlossomToken.value.trim()
      };
      settings.updateBlossomServers(list);
      editingBlossom.value = null;
    }

    function cancelEditBlossom() {
      editingBlossom.value = null;
    }

    function doLogout() {
      ks.logout();
    }

    onMounted(refreshStatuses);

    return {
      settings,
      shortPk,
      newRelay,
      newBlossomUrl,
      relayList: computed(() => settings.relayList),
      blossomList: computed(() => settings.blossomList),
      statuses,
      editingRelay,
      editedRelayValue,
      editingBlossom,
      editedBlossomUrl,
      editedBlossomToken,
      addRelay,
      deleteRelay,
      startEditRelay,
      saveEditRelay,
      cancelEditRelay,
      addBlossom,
      deleteBlossom,
      startEditBlossom,
      saveEditBlossom,
      cancelEditBlossom,
      shortRelay,
      reconnectRelay,
      showSyncSuccess,
      isFadingOut,
      doLogout
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
