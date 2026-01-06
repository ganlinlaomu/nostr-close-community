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

async function safeGetPublicKey(skHex: string): Promise<string> {
  return nostr.getPublicKey(skHex);
}

/**
 * 核心初始化逻辑：确保数据库打开后，再并行加载所有子 Store
 */
async function afterLogin(pk: string) {
  try {
    await openDatabase(pk);
    await Promise.allSettled([
      useFriendsStore().load(pk),
      useMessagesStore().load(pk),
      useSettingsStore().load(pk),
      useInteractionsStore().load(pk),
      useNotificationsStore().load(pk)
    ]);
  } catch (e) {
    console.error("初始化数据失败:", e);
  }
}

/* ------------------------------------------------------------------ */
/* Store */
/* ------------------------------------------------------------------ */

export const useKeyStore = defineStore("keys", {
  state: () => ({
    skHex: "",
    pkHex: "",
    loginMethod: "" as "sk" | "nip07" | "nip46" | "",
    bunkerSigner: null as BunkerSigner | null,
    loginTimestamp: 0,
    isEncrypted: false,
    isUnlocked: false,
    isRestored: false // 标记是否完成初始化检查
  }),

  getters: {
    isLoggedIn(): boolean {
      return !!this.pkHex && (this.loginMethod !== "sk" || this.isUnlocked);
    }
  },

  actions: {
    /**
     * 🔥 修复 1: 增加初始化方法 (在 App.vue 挂载时调用)
     * 解决页面刷新后状态丢失的问题
     */
    async init() {
      if (this.isRestored) return;

      const storedMethod = localStorage.getItem("loginMethod") as any;
      const storedPk = localStorage.getItem("pkHex");

      if (!storedMethod || !storedPk) {
        this.isRestored = true;
        return;
      }

      this.pkHex = storedPk;
      this.loginMethod = storedMethod;

      try {
        if (storedMethod === "sk") {
          if (hasEncryptedKey()) {
            this.isEncrypted = true;
            this.isUnlocked = false; // 等待用户输入密码
          } else {
            // 安全起见，非加密私钥不建议存 LocalStorage，若存了则恢复
            const rawSk = localStorage.getItem("skHex");
            if (rawSk) {
              this.skHex = rawSk;
              this.isUnlocked = true;
              await afterLogin(storedPk);
            }
          }
        } else if (storedMethod === "nip07") {
          // NIP-07 刷新页面后可直接恢复，因为插件环境一直存在
          await afterLogin(storedPk);
        } else if (storedMethod === "nip46") {
          // 修复 2: Bunker 自动重连
          const bunkerInput = localStorage.getItem("bunkerInput");
          if (bunkerInput) {
            await this.loginWithBunker(bunkerInput, true);
          }
        }
      } catch (e) {
        console.error("恢复会话失败:", e);
      } finally {
        this.isRestored = true;
      }
    },

    /* --- 加密/签名 代理 --- */

    async nip04Decrypt(senderPubHex: string, ciphertext: string) {
      if (!this.isLoggedIn) throw new Error("未登录或未解锁");
      if (this.loginMethod === "sk") return nostr.nip04.decrypt(this.skHex, senderPubHex, ciphertext);
      if (this.loginMethod === "nip07") return window.nostr!.nip04!.decrypt(senderPubHex, ciphertext);
      return this.bunkerSigner!.nip04Decrypt(senderPubHex, ciphertext);
    },

    async nip04Encrypt(recipientPubHex: string, plaintext: string) {
      if (!this.isLoggedIn) throw new Error("未登录或未解锁");
      if (this.loginMethod === "sk") return nostr.nip04.encrypt(this.skHex, recipientPubHex, plaintext);
      if (this.loginMethod === "nip07") return window.nostr!.nip04!.encrypt(recipientPubHex, plaintext);
      return this.bunkerSigner!.nip04Encrypt(recipientPubHex, plaintext);
    },

    async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
      if (!this.isLoggedIn) throw new Error("未登录或未解锁");
      if (this.loginMethod === "sk") return finalizeEvent(event, this.skHex);
      if (this.loginMethod === "nip07") return window.nostr!.signEvent!(event);
      return this.bunkerSigner!.signEvent(event);
    },

    /* --- 登录逻辑 --- */

    async loginWithNsec(input: string, password?: string) {
      let skHex: string;
      if (input.startsWith("nsec1")) {
        const decoded = nip19.decode(input);
        if (decoded.type !== "nsec") throw new Error("无效的 nsec");
        skHex = decoded.data as string;
      } else {
        skHex = input;
      }

      const pk = await safeGetPublicKey(skHex);
      this.skHex = skHex;
      this.pkHex = pk;
      this.loginMethod = "sk";
      this.isUnlocked = true;

      if (password) {
        const encrypted = await encryptPrivateKey(skHex, password);
        storeEncryptedKey(encrypted);
        this.isEncrypted = true;
        localStorage.removeItem("skHex"); // 修复 3: 加密后移除明文
      } else {
        this.isEncrypted = false;
        localStorage.setItem("skHex", skHex); // 注意：这有安全风险
      }

      localStorage.setItem("pkHex", pk);
      localStorage.setItem("loginMethod", "sk");
      await afterLogin(pk);
    },

    async unlockWithPassword(password: string) {
      const encrypted = retrieveEncryptedKey();
      const skHex = await decryptPrivateKey(encrypted, password);
      const pk = await safeGetPublicKey(skHex);

      this.skHex = skHex;
      this.pkHex = pk;
      this.loginMethod = "sk";
      this.isUnlocked = true;
      this.isEncrypted = true;

      localStorage.setItem("pkHex", pk);
      localStorage.setItem("loginMethod", "sk");
      await afterLogin(pk);
    },

    async loginWithExtension() {
      if (!window.nostr) throw new Error("未检测到 Nostr 扩展");
      const pk = await window.nostr.getPublicKey();
      this.pkHex = pk;
      this.loginMethod = "nip07";
      localStorage.setItem("pkHex", pk);
      localStorage.setItem("loginMethod", "nip07");
      await afterLogin(pk);
    },

    async loginWithBunker(input: string, isRestoring = false) {
      const pointer = await parseBunkerInput(input);
      if (!pointer) throw new Error("无效的 Bunker 地址");

      let clientSecret: Uint8Array;
      const savedSecret = localStorage.getItem("bunkerClientSecretKey");
      
      if (savedSecret) {
        clientSecret = base64ToUint8Array(savedSecret);
      } else {
        clientSecret = crypto.getRandomValues(new Uint8Array(32));
      }

      const signer = BunkerSigner.fromBunker(clientSecret, pointer);
      // 如果不是恢复模式，需要显式连接
      if (!isRestoring) await signer.sendRequest("connect", []);

      this.pkHex = await signer.getPublicKey();
      this.loginMethod = "nip46";
      this.bunkerSigner = signer;

      localStorage.setItem("pkHex", this.pkHex);
      localStorage.setItem("loginMethod", "nip46");
      localStorage.setItem("bunkerInput", input); // 保存以便刷新恢复
      localStorage.setItem("bunkerClientSecretKey", uint8ArrayToBase64(clientSecret));

      await afterLogin(this.pkHex);
    },

    async logout() {
      try {
        this.bunkerSigner?.close();
      } catch (e) {}

      closeDatabase();
      removeEncryptedKey();

      // 修复 4: 彻底重置所有 Store 状态
      this.$reset();
      useFriendsStore().$reset();
      useMessagesStore().$reset();
      useSettingsStore().$reset();
      useInteractionsStore().$reset();
      useNotificationsStore().$reset();

      localStorage.clear(); // 简单粗暴的清理
      await router.replace("/login");
    }
  }
});