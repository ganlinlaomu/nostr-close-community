import { defineStore } from "pinia";
import * as nostr from "nostr-tools";
import { useRouter } from "vue-router";

import { useFriendsStore } from "./friends";
import { useMessagesStore } from "./messages";
import { useSettingsStore } from "./settings";
import { useInteractionsStore } from "./interactions";
import { useNotificationsStore } from "./notifications";

import type { WindowNostr } from "nostr-tools/lib/types/nip07";
import { BunkerSigner, parseBunkerInput } from "nostr-tools/nip46";
import { finalizeEvent } from "nostr-tools";
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
/* helpers */
/* ------------------------------------------------------------------ */

declare global {
  interface Window {
    nostr?: WindowNostr;
  }
}

function toHex(u8: Uint8Array) {
  return Array.from(u8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function genRandomSkHex(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

function safeGeneratePrivateKey(): string {
  if ((nostr as any)?.generatePrivateKey) {
    try {
      return (nostr as any).generatePrivateKey();
    } catch {}
  }
  return genRandomSkHex();
}

async function safeGetPublicKey(skHex: string): Promise<string> {
  if ((nostr as any)?.getPublicKey) {
    return (nostr as any).getPublicKey(skHex);
  }
  if ((nostr as any)?.secp256k1?.getPublicKey) {
    return (nostr as any).secp256k1.getPublicKey(skHex);
  }
  throw new Error("当前 nostr-tools 不支持从私钥派生公钥");
}

/**
 * 登录成功后的统一处理（🔥 核心）
 */
async function afterLogin(pk: string) {
  // 1. 切换 Dexie（关闭旧库 + 打开新库）
  openDatabase(pk);

  // 2. 加载账号相关 store
  await Promise.allSettled([
    useFriendsStore().load(pk),
    useMessagesStore().load(pk),
    useSettingsStore().load(pk),
    useInteractionsStore().load(),
    useNotificationsStore().load(pk)
  ]);
}

/* ------------------------------------------------------------------ */
/* store */
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

    bunkerClientSecretKey: null as Uint8Array | null,

    isRestoring: false,
    isRestored: false
  }),

  getters: {
    isLoggedIn(): boolean {
      return !!this.pkHex && !!this.loginMethod;
    }
  },

  actions: {
    /* -------------------------------------------------------------- */
    /* crypto wrappers */
    /* -------------------------------------------------------------- */

    async nip04Decrypt(senderPubHex: string, ciphertext: string): Promise<string> {
      if (!this.isLoggedIn) throw new Error("未登录");

      switch (this.loginMethod) {
        case "sk":
          return nostr.nip04.decrypt(this.skHex, senderPubHex, ciphertext);
        case "nip07":
          return window.nostr!.nip04!.decrypt(senderPubHex, ciphertext);
        case "nip46":
          return this.bunkerSigner!.nip04Decrypt(senderPubHex, ciphertext);
      }
    },

    async nip04Encrypt(recipientPubHex: string, plaintext: string): Promise<string> {
      if (!this.isLoggedIn) throw new Error("未登录");

      switch (this.loginMethod) {
        case "sk":
          return nostr.nip04.encrypt(this.skHex, recipientPubHex, plaintext);
        case "nip07":
          return window.nostr!.nip04!.encrypt(recipientPubHex, plaintext);
        case "nip46":
          return this.bunkerSigner!.nip04Encrypt(recipientPubHex, plaintext);
      }
    },

    async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
      if (!this.isLoggedIn) throw new Error("未登录");

      switch (this.loginMethod) {
        case "sk":
          return finalizeEvent(event, this.skHex);
        case "nip07":
          return window.nostr!.signEvent!(event);
        case "nip46":
          return this.bunkerSigner!.signEvent(event);
      }
    },

    /* -------------------------------------------------------------- */
    /* login */
    /* -------------------------------------------------------------- */

    async loginWithSk(sk: string) {
      this.skHex = sk;
      this.loginMethod = "sk";
      this.loginTimestamp = Math.floor(Date.now() / 1000);

      try {
        this.pkHex = await safeGetPublicKey(sk);
      } catch (e) {
        this.$reset();
        throw e;
      }

      localStorage.setItem("skHex", this.skHex);
      localStorage.setItem("pkHex", this.pkHex);
      localStorage.setItem("loginMethod", this.loginMethod);
      localStorage.setItem("loginTimestamp", String(this.loginTimestamp));

      await afterLogin(this.pkHex);
    },

    async loginWithExtension() {
      if (!window.nostr) throw new Error("未检测到 Nostr 插件");

      this.pkHex = await window.nostr.getPublicKey();
      this.skHex = "";
      this.loginMethod = "nip07";
      this.loginTimestamp = Math.floor(Date.now() / 1000);

      localStorage.setItem("pkHex", this.pkHex);
      localStorage.setItem("loginMethod", this.loginMethod);
      localStorage.setItem("loginTimestamp", String(this.loginTimestamp));
      localStorage.removeItem("skHex");

      await afterLogin(this.pkHex);
    },

    async loginWithBunker(input: string) {
      const pointer = await parseBunkerInput(input);
      if (!pointer) throw new Error("无效 bunker 输入");

      const clientKey =
        localStorage.getItem("bunkerClientSecretKey")
          ? base64ToUint8Array(localStorage.getItem("bunkerClientSecretKey")!)
          : crypto.getRandomValues(new Uint8Array(32));

      const signer = BunkerSigner.fromBunker(clientKey, pointer);
      await signer.sendRequest("connect", []);

      this.pkHex = await signer.getPublicKey();
      this.loginMethod = "nip46";
      this.bunkerSigner = signer;
      this.bunkerClientSecretKey = clientKey;
      this.loginTimestamp = Math.floor(Date.now() / 1000);

      localStorage.setItem("pkHex", this.pkHex);
      localStorage.setItem("loginMethod", this.loginMethod);
      localStorage.setItem("loginTimestamp", String(this.loginTimestamp));
      localStorage.setItem("bunkerClientSecretKey", uint8ArrayToBase64(clientKey));

      await afterLogin(this.pkHex);
    },

    async generateTemp() {
      await this.loginWithSk(safeGeneratePrivateKey());
    },

    /* -------------------------------------------------------------- */
    /* restore */
    /* -------------------------------------------------------------- */

    async restoreSession() {
      this.isRestoring = true;

      try {
        const method = localStorage.getItem("loginMethod") as any;
        const pk = localStorage.getItem("pkHex");

        if (!method || !pk) {
          this.isRestored = true;
          return;
        }

        this.loginMethod = method;
        this.pkHex = pk;
        this.loginTimestamp = Number(localStorage.getItem("loginTimestamp") || 0);

        openDatabase(pk);

        if (method === "sk") {
          const sk = localStorage.getItem("skHex");
          if (sk) {
            this.skHex = sk;
            await afterLogin(pk);
          }
        } else if (method === "nip07") {
          await afterLogin(pk);
        } else if (method === "nip46") {
          const bunkerKey = localStorage.getItem("bunkerClientSecretKey");
          const bunkerInput = localStorage.getItem("bunkerInput");
          if (!bunkerInput || !bunkerKey) throw new Error("bunker restore failed");

          const signer = BunkerSigner.fromBunker(
            base64ToUint8Array(bunkerKey),
            await parseBunkerInput(bunkerInput)
          );
          await signer.sendRequest("connect", []);
          this.bunkerSigner = signer;

          await afterLogin(pk);
        }

        this.isRestored = true;
      } catch (e) {
        console.error("[keys] restore failed", e);
        this.logout();
      } finally {
        this.isRestoring = false;
      }
    },

    /* -------------------------------------------------------------- */
    /* logout */
    /* -------------------------------------------------------------- */

    logout() {
      try {
        this.bunkerSigner?.close();
      } catch {}

      closeDatabase();
      this.$reset();

      [
        "skHex",
        "pkHex",
        "loginMethod",
        "loginTimestamp",
        "bunkerInput",
        "bunkerClientSecretKey",
        "isEncrypted"
      ].forEach((k) => localStorage.removeItem(k));

      useRouter().replace("/login");
    }
  }
});