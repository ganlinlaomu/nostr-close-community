<template>
  <div class="card login-card">
    <div class="login-center">
      <h1 class="title">STAY</h1>

      <div class="login-actions">
        <button class="btn" @click="showLogin = true; showRegister = false">私要登入</button>
        <button class="btn" @click="showRegister = true; showLogin = false">注册</button>
      </div>

      <!-- 登录表单（点击“私要登入”显示）-->
      <div v-if="showLogin" class="form card" style="margin-top:12px;">
        <label>私钥 (hex)</label>
        <input v-model="sk" class="input" placeholder="输入你的私钥 hex" />
        <div style="margin-top:8px;">
          <button class="btn" @click="doLogin">登录</button>
          <button class="btn" style="margin-left:8px" @click="genTemp">生成临时</button>
        </div>
        <div class="small" style="margin-top:8px;">
          （示例）私钥会用来登录并保存在本地，仅用于开发。生产请使用安全存储。
        </div>
      </div>

      <!-- 注册表单（点击“注册”显示）-->
      <div v-if="showRegister" class="form card" style="margin-top:12px;">
        <label>昵称（可选）</label>
        <input v-model="displayName" class="input" placeholder="显示名（可选）" />

        <div style="margin-top:8px;">
          <label>备份密码（可选，用于生成并保存本地加密备份）</label>
          <input v-model="regPassword" type="password" class="input" placeholder="备份密码（建议）" />
        </div>

        <div style="margin-top:8px;">
          <label><input type="checkbox" v-model="publishProfile" /> 注册后自动发布 profile（kind=0）到 relays</label>
        </div>

        <div style="margin-top:8px;">
          <button class="btn" @click="doRegister">生成并注册</button>
        </div>

        <div v-if="generated" class="card" style="margin-top:12px;">
          <h4>已生成密钥（请妥善备份）</h4>
          <div><strong>私钥</strong></div>
          <div class="small">{{ skGenerated }}</div>
          <div style="margin-top:8px;"><strong>公钥</strong></div>
          <div class="small">{{ pkGenerated }}</div>

          <div style="margin-top:8px;">
            <button class="btn" @click="copy(skGenerated)">复制私钥</button>
            <button class="btn" style="margin-left:8px" @click="copy(pkGenerated)">复制公钥</button>
          </div>

          <div class="small" style="margin-top:8px;">
            已为私钥生成本地加密备份（如你输入了密码）。请导出并妥善保存。
          </div>
        </div>
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

    const showLogin = ref(false);
    const showRegister = ref(false);

    const sk = ref("");
    const displayName = ref("");
    const regPassword = ref("");
    const publishProfile = ref(false);

    const generated = ref(false);
    const skGenerated = ref("");
    const pkGenerated = ref("");

    const doLogin = () => {
      try {
        ks.loginWithSk(sk.value.trim());
        router.push("/");
      } catch (e: any) {
        alert(e.message || "登录失败");
      }
    };

    const genTemp = () => {
      ks.generateTemp();
      router.push("/");
    };

    const doRegister = async () => {
      try {
        const res = await ks.register(displayName.value.trim(), publishProfile.value, regPassword.value);
        skGenerated.value = res.sk;
        pkGenerated.value = res.pk;
        generated.value = true;
        // short delay so user can copy keys
        setTimeout(() => router.push("/"), 800);
      } catch (e: any) {
        alert(e.message || "注册失败");
      }
    };

    const copy = (text: string) => {
      try {
        navigator.clipboard.writeText(text);
        alert("已复制到剪贴板");
      } catch {
        alert("复制失败，请手动复制");
      }
    };

    return {
      showLogin, showRegister, sk, doLogin, genTemp,
      displayName, regPassword, publishProfile, doRegister,
      generated, skGenerated, pkGenerated, copy
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
.login-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 18px;
}
.form .input {
  margin-top: 8px;
}
</style>
