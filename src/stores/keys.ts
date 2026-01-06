import { defineStore } from "pinia";
import * as nostr from "nostr-tools";
import router from "@/router";
import { useFriendsStore } from "./friends";
import { useMessagesStore } from "./messages";
import { useSettingsStore } from "./settings";
import { useInteractionsStore } from "./interactions";
import { useNotificationsStore } from "./notifications";

import { BunkerSigner, parseBunkerInput } from "nostr-tools/nip46";
import { finalizeEvent, nip19 } from "nostr-tools";
import type { EventTemplate, VerifiedEvent } from "nostr-tools/lib/types/core";

import {
  encryptPrivateKey,
  decryptPrivateKey,
  storeEncryptedKey,
  retrieveEncryptedKey,
  removeEncryptedKey,
  hasEncryptedKey,
  uint8ArrayToBase64,
  base64ToUint8Array
} from "@/utils/crypto";

import { openDatabase, closeDatabase } from "@/db/dexie";

/* ------------------------------------------------------------------ */
/* Helpers */
/* ------------------------------------------------------------------ */

async function afterLogin(pk: string) {
  try {
    // 确保数据库优先打开
    await openDatabase(pk);
    // 并行初始化其他 Store 数据
    await Promise.allSettled([
      useFriendsStore().load(pk),
      useMessagesStore().load(pk),
      useSettingsStore().load(pk),
      useInteractionsStore().load(pk),
      useNotificationsStore().load(pk)
    ]);
  } catch (e) {
    console.error("[Store] 登录后同步数据失败:", e);
  }
}

/* ------------------------------------------------------------------ */
/* Store Definition */
/* ------------------------------------------------------------------ */

export const useKeyStore = defineStore("keys", {
  state: () => ({
    skHex: "",
    pkHex: "",
    loginMethod: "" as "sk" | "nip07" | "nip46" | "",
    bunkerSigner: null as BunkerSigner | null,
    isEncrypted: false,
    isUnlocked: false,
    isRestored: false // 关键：标记 App.vue 是否完成初始化检查
  }),

  getters: {
    // 只有已解锁或者是扩展/Bunker登录才算真正登录
    isLoggedIn(): boolean {
      if (!this.pkHex || !this.loginMethod) return false;
      if (this.loginMethod === "sk") return this.isUnlocked;
      return true;
    }
  },

  actions: {
    /**
     * 🔥 核心修复：App.vue 启动时调用，恢复所有状态
     */
    async init() {
      if (this.isRestored) return;

      const method = localStorage.getItem("loginMethod") as any;
      const pk = localStorage.getItem("pkHex");

      if (!method || !pk) {
        this.isRestored = true;
        return;
      }

      this.pkHex = pk;
      this.loginMethod = method;

      try {
        if (method === "sk") {
          if (hasEncryptedKey()) {
            this.isEncrypted = true;
            this.isUnlocked = false; // 需要用户在 UI 输入密码解锁
          } else {
            const rawSk = localStorage.getItem("skHex");
            if (rawSk) {
              this.skHex = rawSk;
              this.isUnlocked = true;
              await afterLogin(pk);
            }
          }
        } else if (method === "nip07") {
          // 浏览器扩展无需重连，直接加载数据
          await afterLogin(pk);
        } else if (method === "nip46") {
          // 恢复 Bunker 连接
          const bunkerInput = localStorage.getItem("bunkerInput");
          if (bunkerInput) {
            await this.loginWithBunker(bunkerInput, true);
          }
        }
      } catch (e) {
        console.error("[Store] 恢复会话失败:", e);
      } finally {
        this.isRestored = true;
      }
    },

    /* --- 签名代理方法 --- */

    async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
      if (!this.isLoggedIn) throw new Error("未登录或未解锁");
      if (this.loginMethod === "sk") return finalizeEvent(event, this.skHex);
      if (this.loginMethod === "nip07") return window.nostr!.signEvent!(event);
      if (this.loginMethod === "nip46") return this.bunkerSigner!.signEvent(event);
      throw new Error("未知签名方式");
    },

    async nip04Decrypt(pubkey: string, ciphertext: string) {
      if (!this.isLoggedIn) throw new Error("未登录");
      if (this.loginMethod === "sk") return nostr.nip04.decrypt(this.skHex, pubkey, ciphertext);
      if (this.loginMethod === "nip07") return window.nostr!.nip04!.decrypt(pubkey, ciphertext);
      return this.bunkerSigner!.nip04Decrypt(pubkey, ciphertext);
    },

    /* --- 登录 Actions --- */

    async loginWithNsec(input: string, password?: string) {
      let sk: string;
      if (input.startsWith("nsec1")) {
        const decoded = nip19.decode(input);
        if (decoded.type !== "nsec") throw new Error("无效的 nsec");
        sk = decoded.data as string;
      } else {
        sk = input;
      }

      const pk = nostr.getPublicKey(sk);
      this.skHex = sk;
      this.pkHex = pk;
      this.loginMethod = "sk";
      this.isUnlocked = true;

      if (password) {
        const encrypted = await encryptPrivateKey(sk, password);
        storeEncryptedKey(encrypted);
        this.isEncrypted = true;
        localStorage.removeItem("skHex"); // 加密后不存明文
      } else {
        this.isEncrypted = false;
        localStorage.setItem("skHex", sk);
      }

      localStorage.setItem("pkHex", pk);
      localStorage.setItem("loginMethod", "sk");
      await afterLogin(pk);
    },

    async unlockWithPassword(password: string) {
      const encrypted = retrieveEncryptedKey();
      const sk = await decryptPrivateKey(encrypted, password);
      const pk = nostr.getPublicKey(sk);

      this.skHex = sk;
      this.pkHex = pk;
      this.loginMethod = "sk";
      this.isUnlocked = true;
      this.isEncrypted = true;

      localStorage.setItem("pkHex", pk);
      localStorage.setItem("loginMethod", "sk");
      await afterLogin(pk);
    },

    async loginWithBunker(input: string, isRestoring = false) {
      const pointer = await parseBunkerInput(input);
      if (!pointer) throw new Error("无效的 Bunker 格式");

      let clientSecret: Uint8Array;
      const savedSecret = localStorage.getItem("bunkerClientSecretKey");
      if (savedSecret) {
        clientSecret = base64ToUint8Array(savedSecret);
      } else {
        clientSecret = crypto.getRandomValues(new Uint8Array(32));
      }

      const signer = BunkerSigner.fromBunker(clientSecret, pointer);
      if (!isRestoring) await signer.sendRequest("connect", []);

      this.pkHex = await signer.getPublicKey();
      this.loginMethod = "nip46";
      this.bunkerSigner = signer;

      localStorage.setItem("pkHex", this.pkHex);
      localStorage.setItem("loginMethod", "nip46");
      localStorage.setItem("bunkerInput", input);
      localStorage.setItem("bunkerClientSecretKey", uint8ArrayToBase64(clientSecret));

      await afterLogin(this.pkHex);
    },

    async loginWithExtension() {
      if (!window.nostr) throw new Error("未检测到 Nostr 插件");
      const pk = await window.nostr.getPublicKey();
      this.pkHex = pk;
      this.loginMethod = "nip07";
      localStorage.setItem("pkHex", pk);
      localStorage.setItem("loginMethod", "nip07");
      await afterLogin(pk);
    },

    async logout() {
      try { this.bunkerSigner?.close(); } catch (e) {}
      closeDatabase();
      removeEncryptedKey();
      
      // 重置所有 Store
      this.$reset();
      useFriendsStore().$reset();
      useMessagesStore().$reset();
      useSettingsStore().$reset();
      useInteractionsStore().$reset();
      useNotificationsStore().$reset();

      localStorage.clear();
      await router.replace("/login");
    }
  }
});