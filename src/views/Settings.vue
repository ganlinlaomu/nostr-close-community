<template>
  <div class="settings-page">
    <h2>设置</h2>

    <!-- Account Info -->
    <section class="settings-section">
      <h3>当前账号</h3>
      <div class="account-info">
        <div class="pubkey">
          <label>公钥</label>
          <code>{{ ks.pkHex }}</code>
        </div>
      </div>
    </section>

    <!-- Actions -->
    <section class="settings-section danger">
      <h3>账号操作</h3>
      <button class="logout-btn" @click="doLogout">
        登出当前账号
      </button>
    </section>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useKeyStore } from "@/stores/keys";
import { closeDatabase } from "@/db/dexie";

export default defineComponent({
  name: "Settings",
  setup() {
    const ks = useKeyStore();

    const doLogout = () => {
      /**
       * ⚠️ 关键修复点
       * - 关闭当前账号 Dexie 实例
       * - 防止切账号后串库 / 读到旧数据
       */
      try {
        closeDatabase();
      } catch (e) {
        console.warn("[Settings] closeDatabase failed", e);
      }

      ks.logout();

      // 强制回到登录页，清理 keep-alive 组件状态
      location.href = "/#/login";
    };

    return {
      ks,
      doLogout
    };
  }
});
</script>

<style scoped>
.settings-page {
  padding: 16px;
}

.settings-section {
  margin-bottom: 24px;
}

.settings-section h3 {
  margin-bottom: 8px;
}

.account-info code {
  display: block;
  word-break: break-all;
  background: #f5f5f5;
  padding: 8px;
  border-radius: 6px;
}

.danger .logout-btn {
  background: #e53935;
  color: white;
  border: none;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 16px;
}
</style>