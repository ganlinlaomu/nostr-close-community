<template>
  <div class="card login-card">
    <div class="login-center">
      <h1 class="title">海内</h1>

      <div class="login-info">
        <p>纯·知己</p> 
      </div>

      <!-- Login Actions -->
      <div class="login-actions">
        <!-- Browser Extension Login (NIP-07) -->
        <button
          class="btn"
          @click="loginWithExtension"
          :disabled="loading"
          aria-label="Login with browser extension"
        >
          <span class="btn-icon" role="img" aria-label="plugin icon">🔌</span>
          {{ loading ? "处理中..." : "插件登录" }}
        </button>

        <!-- Bunker Login -->
        <button
          class="btn"
          @click="showBunker = true"
          :disabled="loading"
          aria-label="Login with remote signer"
        >
          <span class="btn-icon" role="img" aria-label="lock icon">🔐</span>
          Bunker登录
        </button>
      </div>

      <!-- Bunker Login Form -->
      <div v-if="showBunker" class="form card" style="margin-top:12px;">
        <label>Bunker URL 或 NIP-05</label>

        <input
          ref="bunkerInputEl"
          v-model="bunkerInput"
          class="input"
          placeholder="bunker://... 或 name@domain.com"
          :disabled="loading"
          @keyup.enter="doLoginBunker"
        />

        <div class="small" style="margin-top:8px; text-align:left;">
          输入 bunker:// URL 或 NIP-05 地址（如 user@nsec.app）
        </div>

        <div style="margin-top:12px;">
          <button
            class="btn"
            @click="doLoginBunker"
            :disabled="loading"
            :aria-label="loading ? 'Connecting to remote signer' : 'Connect to remote signer'"
          >
            {{ loading ? "连接中..." : "连接" }}
          </button>

          <button
            class="btn btn-cancel"
            style="margin-left:8px"
            @click="cancelBunker"
            :disabled="loading"
          >
            取消
          </button>
        </div>
      </div>

      <!-- Error Message -->
      <div v-if="errorMessage" class="error-message" style="margin-top:12px;">
        {{ errorMessage }}
      </div>

      <!-- Help Text -->
      <div class="help-text" style="margin-top:24px;">
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, watch, nextTick } from "vue";
import { useKeyStore } from "@/stores/keys";
import { useRouter } from "vue-router";

export default defineComponent({
  setup() {
    const ks = useKeyStore();
    const router = useRouter();

    const showBunker = ref(false);
    const bunkerInput = ref("");
    const errorMessage = ref("");
    const loading = ref(false);

    const bunkerInputEl = ref<HTMLInputElement | null>(null);

    /* ---------------------------
     * 自动跳转（已登录）
     * --------------------------- */
    onMounted(() => {
      if (ks.isLoggedIn) {
        router.replace("/");
      }
    });

    /* ---------------------------
     * Bunker 展开自动 focus
     * --------------------------- */
    watch(showBunker, async (v) => {
      if (v) {
        await nextTick();
        bunkerInputEl.value?.focus();
      }
    });

    /* ---------------------------
     * 通用登录处理器
     * --------------------------- */
    async function handleLogin(fn: () => Promise<void>) {
      errorMessage.value = "";
      loading.value = true;

      try {
        await fn();

        if (!ks.isLoggedIn) {
          throw new Error("登录未完成");
        }

        router.replace("/");
      } catch (e: any) {
        if (e?.name === "TimeoutError") {
          errorMessage.value = "远程签名器无响应";
        } else if (e?.message?.includes("reject")) {
          errorMessage.value = "用户拒绝签名";
        } else {
          errorMessage.value = e?.message || "登录失败";
        }
      } finally {
        loading.value = false;
      }
    }

    /* ---------------------------
     * 登录方式
     * --------------------------- */
    const loginWithExtension = () =>
      handleLogin(() => ks.loginWithExtension());

    function isValidBunkerInput(v: string) {
      return v.startsWith("bunker://") || v.includes("@");
    }

    const doLoginBunker = () => {
      const v = bunkerInput.value.trim();

      if (!v) {
        errorMessage.value = "请输入 Bunker URL 或 NIP-05 地址";
        return;
      }

      if (!isValidBunkerInput(v)) {
        errorMessage.value = "格式不正确，请输入 bunker:// 或 NIP-05";
        return;
      }

      handleLogin(() => ks.loginWithBunker(v));
    };

    const cancelBunker = () => {
      if (loading.value) return;
      showBunker.value = false;
      bunkerInput.value = "";
      errorMessage.value = "";
    };

    return {
      showBunker,
      bunkerInput,
      bunkerInputEl,
      errorMessage,
      loading,
      loginWithExtension,
      doLoginBunker,
      cancelBunker
    };
  }
});
</script>

<style scoped>
.login-card {
  min-height: calc(100vh - 88px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.login-center {
  width: 100%;
  max-width: 420px;
  text-align: center;
  padding: 24px;
}

.title {
  /* 字体 */
  font-family:
    "Source Han Serif SC",
    "Noto Serif SC",
    "Songti SC",
    "STSong",
    serif;

  /* 字号 */
  font-size: 2.6rem;

  /* 字重：关键，不要太粗 */
  font-weight: 400;

  /* 字距：宋体一定要松一点 */
  letter-spacing: 0.08em;

  /* 行高 */
  line-height: 1.1;

  /* 颜色（暗色模式专用） */
  color: #D6D9E0;

  /* 去装饰 */
  margin: 0;
  padding: 0;

  /* 抗锯齿 */
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.login-info {
  margin-top: 12px;
  font-size: 15px;
  color: #9AA1AC; /* 冷灰，不抢标题 */
  letter-spacing: 0.12em;
}

.login-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 24px;
}

.login-actions .btn {
  width: 100%;
  padding: 12px;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

:is(.login-actions .btn, .form .btn) {
  background: transparent;
  color: #C7CBD1;
  border: 1px solid #2A3342;
  border-radius: 10px;
  transition: background-color 0.2s ease, border-color 0.2s ease;
}

:is(.login-actions .btn, .form .btn):hover:not(:disabled) {
  background: #151B26;
  border-color: #3A4458;
  color: #E5E7EB;
  transform: none;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-icon {
  font-size: 20px;
}

.btn-cancel {
  color: #9AA1AC;
  border-color: #2A3342;
}

.btn-cancel:hover:not(:disabled) {
  background: #151B26;
  color: #E5E7EB;
}

.form {
  background: transparent;
  border: none;
  padding: 0;
}

.form label {
  display: block;
  font-size: 14px;
  color: #9AA1AC;
  margin-bottom: 4px;
}

.form .input {
  width: 100%;
  background: #0F141C;
  border: 1px solid #2A3342;
  color: #E5E7EB;
  padding: 10px 12px;
  border-radius: 8px;
}

.form .input::placeholder {
  color: #6B7280;
}

.form .input:focus {
  outline: none;
  border-color: #3A4458;
}

.error-message {
  background: rgba(153, 27, 27, 0.12);
  color: #FCA5A5;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(252, 165, 165, 0.3);
  font-size: 14px;
}
</style>

