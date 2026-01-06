<template>
  <div class="card login-card">
    <div class="login-center">
      <h1 class="title">海内</h1>

      <div class="login-info">
        <p>纯·知己</p> 
      </div>

      <div v-if="needsUnlock" class="unlock-form">
        <div class="unlock-message">
          <span class="unlock-icon">🔒</span>
          <p>私钥已加密，请输入密码解锁</p>
        </div>

        <input
          ref="unlockPasswordEl"
          v-model="unlockPassword"
          class="input"
          type="password"
          placeholder="输入解锁密码"
          :disabled="loading"
          @keyup.enter="doUnlock"
          style="margin-top:12px;"
        />

        <div style="margin-top:12px;">
          <button
            class="btn btn-primary"
            @click="doUnlock"
            :disabled="loading"
          >
            {{ loading ? "解锁中..." : "解锁" }}
          </button>

          <button
            class="btn btn-cancel"
            style="margin-left:8px"
            @click="cancelUnlock"
            :disabled="loading"
          >
            退出账号
          </button>
        </div>
      </div>

      <div v-else class="login-actions">
        <div v-if="!showNsec && !showBunker" class="main-buttons">
          <button class="btn" @click="loginWithExtension" :disabled="loading">
            <span class="btn-icon">🔌</span> 插件登录 (NIP-07)
          </button>

          <button class="btn" @click="showNsecLogin" :disabled="loading">
            <span class="btn-icon">🔑</span> 私钥登录
          </button>

          <button class="btn" @click="showBunkerLogin" :disabled="loading">
            <span class="btn-icon">🔐</span> Bunker 登录
          </button>
        </div>

        <div v-if="showNsec" class="form card">
          <label>私钥 (nsec 或 hex)</label>
          <input
            ref="nsecInputEl"
            v-model="nsecInput"
            class="input"
            type="password"
            placeholder="nsec1... 或 64位十六进制"
            :disabled="loading"
          />

          <label style="margin-top:12px;">加密密码（可选）</label>
          <input
            v-model="nsecPassword"
            class="input"
            type="password"
            placeholder="设置密码以加密保存私钥"
            :disabled="loading"
            @keyup.enter="doLoginNsec"
          />

          <div class="small-tip">
            设置密码后，私钥将加密保存在本地 IndexedDB 中。
          </div>

          <div class="form-ops">
            <button class="btn btn-primary" @click="doLoginNsec" :disabled="loading">
              {{ loading ? "登录中..." : "确认登录" }}
            </button>
            <button class="btn btn-cancel" @click="cancelNsec" :disabled="loading">取消</button>
          </div>
        </div>

        <div v-if="showBunker" class="form card">
          <label>Bunker URL 或 NIP-05</label>
          <input
            ref="bunkerInputEl"
            v-model="bunkerInput"
            class="input"
            placeholder="bunker://... 或 name@domain.com"
            :disabled="loading"
            @keyup.enter="doLoginBunker"
          />
          <div class="small-tip">输入远程签名器地址或 NIP-05 标识符。</div>

          <div class="form-ops">
            <button class="btn btn-primary" @click="doLoginBunker" :disabled="loading">
              {{ loading ? "连接中..." : "开始连接" }}
            </button>
            <button class="btn btn-cancel" @click="cancelBunker" :disabled="loading">取消</button>
          </div>
        </div>
      </div>

      <transition name="shake">
        <div v-if="errorMessage" class="error-message">
          {{ errorMessage }}
        </div>
      </transition>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, watch, nextTick, computed } from "vue";
import { useKeyStore } from "@/stores/keys";
import { useRouter } from "vue-router";
import { logger } from "@/utils/logger";

export default defineComponent({
  name: "LoginView",
  setup() {
    const ks = useKeyStore();
    const router = useRouter();

    // 状态控制
    const showBunker = ref(false);
    const showNsec = ref(false);
    const loading = ref(false);
    const errorMessage = ref("");

    // 输入绑定
    const bunkerInput = ref("");
    const nsecInput = ref("");
    const nsecPassword = ref("");
    const unlockPassword = ref("");

    // 元素引用
    const bunkerInputEl = ref<HTMLInputElement | null>(null);
    const nsecInputEl = ref<HTMLInputElement | null>(null);
    const unlockPasswordEl = ref<HTMLInputElement | null>(null);

    // 计算属性：判断是否处于“已记住所选账号但未解锁私钥”的状态
    const needsUnlock = computed(() => {
      // 逻辑：LocalStorage 有 pkHex 且标记为 isEncrypted，但内存中没有 skHex
      return ks.pkHex && ks.isEncrypted && !ks.isUnlocked;
    });

    onMounted(async () => {
      // 1. 如果完全登录且解锁，直接去首页
      if (ks.isLoggedIn && ks.isUnlocked) {
        router.replace("/");
        return;
      }
      
      // 2. 如果需要解锁，自动聚焦
      if (needsUnlock.value) {
        await nextTick();
        unlockPasswordEl.value?.focus();
      }
    });

    // 自动聚焦监听
    watch(showBunker, async (v) => v && (await nextTick(), bunkerInputEl.value?.focus()));
    watch(showNsec, async (v) => v && (await nextTick(), nsecInputEl.value?.focus()));

    /**
     * 核心登录/解锁处理包装器
     */
    async function handleLoginAction(task: () => Promise<void>) {
      errorMessage.value = "";
      loading.value = true;
      try {
        await task();
        // 登录成功后跳转。注意：Store 内部的 afterLogin 已确保数据库打开
        router.replace("/");
      } catch (e: any) {
        logger.error("[Login] Action failed", e);
        errorMessage.value = e.message || "操作失败，请重试";
      } finally {
        loading.value = false;
      }
    }

    // --- 登录逻辑 ---

    const loginWithExtension = () => handleLoginAction(() => ks.loginWithExtension());

    const doLoginNsec = () => {
      const sk = nsecInput.value.trim();
      if (!sk) return (errorMessage.value = "请输入私钥");
      handleLoginAction(() => ks.loginWithNsec(sk, nsecPassword.value.trim() || undefined));
    };

    const doLoginBunker = () => {
      const input = bunkerInput.value.trim();
      if (!input) return (errorMessage.value = "请输入地址");
      handleLoginAction(() => ks.loginWithBunker(input));
    };

    const doUnlock = () => {
      const pwd = unlockPassword.value.trim();
      if (!pwd) return (errorMessage.value = "请输入密码");
      handleLoginAction(() => ks.unlockWithPassword(pwd));
    };

    // --- 取消/重置逻辑 ---

    const cancelNsec = () => (showNsec.value = false, nsecInput.value = "", nsecPassword.value = "");
    const cancelBunker = () => (showBunker.value = false, bunkerInput.value = "");
    const cancelUnlock = () => {
      ks.logout(); // 清理本地存储的账号信息，回到初始登录页
      unlockPassword.value = "";
    };

    const showNsecLogin = () => (showNsec.value = true, showBunker.value = false);
    const showBunkerLogin = () => (showBunker.value = true, showNsec.value = false);

    return {
      ks, needsUnlock, showBunker, showNsec, loading, errorMessage,
      bunkerInput, nsecInput, nsecPassword, unlockPassword,
      bunkerInputEl, nsecInputEl, unlockPasswordEl,
      loginWithExtension, doLoginNsec, doLoginBunker, doUnlock,
      cancelNsec, cancelBunker, cancelUnlock, showNsecLogin, showBunkerLogin
    };
  }
});
</script>

<style scoped>
.login-card {
  min-height: 90vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.login-center {
  width: 100%;
  max-width: 400px;
  padding: 2rem;
}

.title {
  font-family: "Source Han Serif SC", "Songti SC", serif;
  font-size: 3rem;
  font-weight: 400;
  letter-spacing: 0.1em;
  color: #d6d9e0;
  margin-bottom: 0.5rem;
  text-align: center;
}

.login-info {
  text-align: center;
  color: #9aa1ac;
  letter-spacing: 0.2em;
  margin-bottom: 2.5rem;
}

.login-actions, .main-buttons {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.btn {
  width: 100%;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid #2a3342;
  background: transparent;
  color: #c7cbd1;
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.btn:hover:not(:disabled) {
  background: #151b26;
  border-color: #3a4458;
}

.btn-primary {
  background: #151b26;
  border-color: #4a5568;
  color: #fff;
}

.btn-cancel {
  border: none;
  color: #718096;
  font-size: 0.9rem;
}

.form {
  text-align: left;
  animation: slideUp 0.3s ease-out;
}

.form label {
  font-size: 0.85rem;
  color: #9aa1ac;
  margin-left: 4px;
}

.input {
  width: 100%;
  margin-top: 0.4rem;
  margin-bottom: 1rem;
  padding: 12px;
  background: #0f141c;
  border: 1px solid #2a3342;
  border-radius: 10px;
  color: #e5e7eb;
}

.small-tip {
  font-size: 0.75rem;
  color: #64748b;
  line-height: 1.4;
  margin-bottom: 1.5rem;
}

.error-message {
  margin-top: 1.5rem;
  padding: 12px;
  border-radius: 10px;
  background: rgba(220, 38, 38, 0.1);
  border: 1px solid rgba(220, 38, 38, 0.2);
  color: #f87171;
  font-size: 0.9rem;
  text-align: center;
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 抖动动画 */
.shake-enter-active {
  animation: shake 0.4s;
}
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-5px); }
  75% { transform: translateX(5px); }
}
</style>