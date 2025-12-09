<template>
  <div class="card">
    <h3>设置</h3>

    <div>
      <label>Relays（换行分隔）</label>
      <textarea v-model="relaysText" class="input" rows="4"></textarea>
    </div>

    <div style="margin-top:8px">
      <label>调试模式</label>
      <div style="display:flex; gap:8px; align-items:center;">
        <input type="checkbox" v-model="debugEnabled" id="debug-toggle" />
        <label for="debug-toggle">启用调试输出（console.debug）</label>
      </div>
    </div>

    <div style="margin-top:8px">
      <label>Blossom 图床地址（示例）</label>
      <input v-model="blossom" class="input" placeholder="https://blossom.example/upload" />
    </div>

    <div style="margin-top:8px">
      <label>Blossom Token（可选，若需 Authorization）</label>
      <input v-model="blossomToken" class="input" placeholder="Bearer xxxxx" />
    </div>

    <div style="margin-top:8px">
      <button class="btn" @click="save">保存</button>
    </div>

    <div style="margin-top:12px" class="small">
      注意：设置会保存在 IndexedDB meta（或 localStorage），用于示例。要让 pool 使用新 relays，请刷新页面。
    </div>

    <div style="margin-top:12px" class="card">
      <h4>Relay 状态</h4>
      <div v-if="relayList.length === 0" class="small">没有配置 relay</div>
      <div class="list">
        <div v-for="r in relayList" :key="r" class="card" style="display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div><strong>{{ shortRelay(r) }}</strong></div>
            <div class="small">状态: <span :style="{ color: statuses[r] && statuses[r].ready ? 'green' : '#d00' }">{{ statuses[r] && statuses[r].ready ? '已连接' : '未连接' }}</span></div>
            <div class="small">队列长度: {{ statuses[r] ? statuses[r].queueLength : '-' }}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            <button class="btn" @click="reconnect(r)">重连</button>
          </div>
        </div>
      </div>
      <div style="margin-top:8px;">
        <button class="btn" @click="refreshStatuses">刷新状态</button>
      </div>
    </div>

    <div class="card" style="margin-top:12px;">
      <h4>账户</h4>
      <div style="display:flex; gap:8px; flex-direction:column;">
        <div class="small">已登录：{{ shortPk }}</div>
        <button class="btn" @click="doLogout">退出登录</button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, reactive, onMounted, computed } from "vue";
import { DEFAULT_RELAYS, getRelaysFromStorage, inspectRelays, reconnectRelay } from "@/nostr/relays";
import { useKeyStore } from "@/stores/keys";
import { db } from "@/db/dexie";
import { isDebugEnabled } from "@/utils/logger";

export default defineComponent({
  setup() {
    // load current values (defensive: fallback to defaults)
    const relaysText = ref((localStorage.getItem("custom-relays") as string) || DEFAULT_RELAYS.join("\n"));
    // use the same key PostEditor expects
    const blossom = ref((localStorage.getItem("blossom_upload_url") as string) || "");
    const blossomToken = ref((localStorage.getItem("blossom_token") as string) || "");

    const ks = useKeyStore();
    const shortPk = computed(() => (ks.pkHex ? ks.pkHex.slice(0, 8) + "..." : ""));
    const debugEnabled = ref(isDebugEnabled());

    const relayList = ref<string[]>([]);
    const statuses = reactive<Record<string, any>>({});

    function shortRelay(u: string) {
      return u.replace(/^wss?:\/\//, "").replace(/\/$/, "");
    }

    const save = async () => {
      // persist relays text
      localStorage.setItem("custom-relays", relaysText.value.trim());
      // persist blossom config using the keys PostEditor listens to
      localStorage.setItem("blossom_upload_url", blossom.value.trim());
      localStorage.setItem("blossom_token", blossomToken.value.trim());

      // Notify other components in same tab to pick up the change immediately
      window.dispatchEvent(new Event("blossom-config-updated"));

      // persist to app meta store (optional)
      try {
        await db.table("meta").put({
          key: "settings",
          value: JSON.stringify({ blossom: blossom.value.trim(), blossom_token: blossomToken.value.trim(), relays: relaysText.value.trim() })
        });
      } catch (e) {
        // ignore DB errors
      }

      // save debug flag
      localStorage.setItem("nostr_debug", debugEnabled.value ? "1" : "0");

      alert("已保存（页面需刷新以让 pool 使用新 relays）");
      refreshStatuses();
    };

    function refreshStatuses() {
      relayList.value = getRelaysFromStorage();
      const info = inspectRelays();
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
      refreshStatuses();
    });

    return {
      relaysText,
      blossom,
      blossomToken,
      save,
      shortPk,
      debugEnabled,
      relayList,
      statuses,
      shortRelay,
      refreshStatuses,
      reconnect,
      doLogout
    };
  }
});
</script>

<style scoped>
/* no change */
</style>
