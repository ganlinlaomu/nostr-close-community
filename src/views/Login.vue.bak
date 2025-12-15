<template>
  <div class="card login-card">
    <div class="login-center">
      <h1 class="title">STAY</h1>

      <div class="login-info">
        <p>與家人同樂</p>
      </div>

      <div class="login-actions">
        <!-- Browser Extension Login (NIP-07) -->
        <button class="btn" @click="loginWithExtension" aria-label="Login with browser extension">
          <span class="btn-icon" role="img" aria-label="plugin icon">🔌</span>
          浏览器插件登录
        </button>

        <!-- Bunker Remote Signer Login (NIP-46) -->
        <button class="btn" @click="showBunker = true" aria-label="Login with remote signer">
          <span class="btn-icon" role="img" aria-label="lock icon">🔐</span>
          远程签名器 (Bunker)
        </button>
      </div>

      <!-- Bunker Login Form -->
      <div v-if="showBunker" class="form card" style="margin-top:12px;">
        <label>Bunker URL 或 NIP-05</label>
        <input 
          v-model="bunkerInput" 
          class="input" 
          placeholder="bunker://... 或 name@domain.com" 
        />
        <div class="small" style="margin-top:8px; text-align: left;">
          输入 bunker:// URL 或 NIP-05 地址 (例如: user@nsec.app)
        </div>
        <div style="margin-top:12px;">
          <button 
            class="btn" 
            @click="doLoginBunker" 
            :disabled="loading"
            :aria-label="loading ? 'Connecting to remote signer' : 'Connect to remote signer'"
          >
            {{ loading ? '连接中...' : '连接' }}
          </button>
          <button class="btn btn-cancel" style="margin-left:8px" @click="showBunker = false" :disabled="loading">取消</button>
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
import { defineComponent, ref } from "vue";
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

    const loginWithExtension = async () => {
      errorMessage.value = "";
      loading.value = true;
      
      try {
        await ks.loginWithExtension();
        router.push("/");
      } catch (e: any) {
        errorMessage.value = e.message || "浏览器插件登录失败";
      } finally {
        loading.value = false;
      }
    };

    const doLoginBunker = async () => {
      if (!bunkerInput.value.trim()) {
        errorMessage.value = "请输入 Bunker URL 或 NIP-05 地址";
        return;
      }

      errorMessage.value = "";
      loading.value = true;

      try {
        await ks.loginWithBunker(bunkerInput.value);
        router.push("/");
      } catch (e: any) {
        errorMessage.value = e.message || "Bunker 登录失败";
      } finally {
        loading.value = false;
      }
    };

    return {
      showBunker,
      bunkerInput,
      errorMessage,
      loading,
      loginWithExtension,
      doLoginBunker
    };
  }
});
</script>

<style scoped>
.login-card {
  min-height: calc(100vh - 88px); /* leave room for bottom nav */
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
  font-size: 48px;
  margin: 0;
  letter-spacing: 6px;
}
.login-info {
  margin-top: 12px;
  font-size: 16px;
  color: #666;
}
.login-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  justify-content: center;
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
  color: #3b82f6;
  border: 1px solid #3b82f6;
  border-radius: 8px;
  transition: all 0.2s ease;
}
:is(.login-actions .btn, .form .btn):hover {
  background: #3b82f6;
  color: white;
  transform: translateY(-1px);
}
.btn-icon {
  font-size: 20px;
}
.btn-cancel {
  color: #ef4444;
  border-color: #ef4444;
}
.btn-cancel:hover {
  background: #ef4444;
  color: white;
}
.form .input {
  margin-top: 8px;
}
.error-message {
  background: #fee2e2;
  color: #991b1b;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #fca5a5;
}
.help-text {
  font-size: 14px;
  color: #666;
  text-align: left;
  line-height: 1.6;
}
.help-text p {
  margin: 8px 0;
}
.help-text strong {
  color: #333;
}
</style>
