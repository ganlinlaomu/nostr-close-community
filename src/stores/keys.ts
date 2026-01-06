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
/* helpers */
/* ------------------------------------------------------------------ */

declare global {
  interface Window {
    nostr?: WindowNostr;
  }
}

async function safeGetPublicKey(skHex: string): Promise<string> {
  if ((nostr as any)?.getPublicKey) {
    return (nostr as any).getPublicKey(skHex);
  }
  if ((nostr as any)?.secp256k1?.getPublicKey) {
    return (nostr as any).secp256k1.getPublicKey(skHex);
  }
  throw new Error("无法从私钥派生公钥");
}

async function afterLogin(pk: string) {
  openDatabase(pk);

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

    async nip04Decrypt(senderPubHex: string, ciphertext: string) {
      if (!this.isLoggedIn) throw new Error("未登录");

      if (this.loginMethod === "sk") {
        return nostr.nip04.decrypt(this.skHex, senderPubHex, ciphertext);
      }
      if (this.loginMethod === "nip07") {
        return window.nostr!.nip04!.decrypt(senderPubHex, ciphertext);
      }
      return this.bunkerSigner!.nip04Decrypt(senderPubHex, ciphertext);
    },

    async nip04Encrypt(recipientPubHex: string, plaintext: string) {
      if (!this.isLoggedIn) throw new Error("未登录");

      if (this.loginMethod === "sk") {
        return nostr.nip04.encrypt(this.skHex, recipientPubHex, plaintext);
      }
      if (this.loginMethod === "nip07") {
        return window.nostr!.nip04!.encrypt(recipientPubHex, plaintext);
      }
      return this.bunkerSigner!.nip04Encrypt(recipientPubHex, plaintext);
    },

    async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
      if (!this.isLoggedIn) throw new Error("未登录");

      if (this.loginMethod === "sk") {
        return finalizeEvent(event, this.skHex);
      }
      if (this.loginMethod === "nip07") {
        return window.nostr!.signEvent!(event);
      }
      return this.bunkerSigner!.signEvent(event);
    },

    /* -------------------------------------------------------------- */
    /* 🔑 私钥登录（Login.vue 调用的关键方法） */
    /* -------------------------------------------------------------- */

    async loginWithNsec(input: string, password?: string) {
      let skHex: string;

      if (input.startsWith("nsec1")) {
        const decoded = nip19.decode(input);
        if (decoded.type !== "nsec") {
          throw new Error("无效的 nsec 私钥");
        }
        skHex = decoded.data as string;
      } else if (/^[0-9a-fA-F]{64}$/.test(input)) {
        skHex = input;
      } else {
        throw new Error("私钥格式不正确");
      }

      const pk = await safeGetPublicKey(skHex);

      this.skHex = skHex;
      this.pkHex = pk;
      this.loginMethod = "sk";
      this.loginTimestamp = Math.floor(Date.now() / 1000);

      if (password) {
        const encrypted = await encryptPrivateKey(skHex, password);
        storeEncryptedKey(encrypted);
        this.isEncrypted = true;
        this.isUnlocked = true;
      } else {
        this.isEncrypted = false;
        this.isUnlocked = true;
        localStorage.setItem("skHex", skHex);
      }

      localStorage.setItem("pkHex", pk);
      localStorage.setItem("loginMethod", "sk");
      localStorage.setItem("loginTimestamp", String(this.loginTimestamp));

      await afterLogin(pk);
    },

    /* -------------------------------------------------------------- */
    /* 🔓 解锁加密私钥（Login.vue needsUnlock 用） */
    /* -------------------------------------------------------------- */

    async unlockWithPassword(password: string) {
      if (!hasEncryptedKey()) {
        throw new Error("没有已加密的私钥");
      }

      const encrypted = retrieveEncryptedKey();
      const skHex = await decryptPrivateKey(encrypted, password);
      const pk = await safeGetPublicKey(skHex);

      this.skHex = skHex;
      this.pkHex = pk;
      this.loginMethod = "sk";
      this.isEncrypted = true;
      this.isUnlocked = true;

      localStorage.setItem("pkHex", pk);
      localStorage.setItem("loginMethod", "sk");

      await afterLogin(pk);
    },

    /* -------------------------------------------------------------- */
    /* 其它登录方式（你原本就有的） */
    /* -------------------------------------------------------------- */

    async loginWithExtension() {
      if (!window.nostr) throw new Error("未检测到 Nostr 插件");

      this.pkHex = await window.nostr.getPublicKey();
      this.loginMethod = "nip07";
      this.loginTimestamp = Math.floor(Date.now() / 1000);

      localStorage.setItem("pkHex", this.pkHex);
      localStorage.setItem("loginMethod", "nip07");
      localStorage.setItem("loginTimestamp", String(this.loginTimestamp));

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
      this.loginTimestamp = Math.floor(Date.now() / 1000);

      localStorage.setItem("pkHex", this.pkHex);
      localStorage.setItem("loginMethod", "nip46");
      localStorage.setItem("loginTimestamp", String(this.loginTimestamp));
      localStorage.setItem("bunkerClientSecretKey", uint8ArrayToBase64(clientKey));

      await afterLogin(this.pkHex);
    },

    /* -------------------------------------------------------------- */
    /* logout */
    /* -------------------------------------------------------------- */

    logout() {
      try {
        this.bunkerSigner?.close();
      } catch {}

      closeDatabase();
      removeEncryptedKey();
      this.$reset();

      [
        "skHex",
        "pkHex",
        "loginMethod",
        "loginTimestamp",
        "bunkerClientSecretKey"
      ].forEach((k) => localStorage.removeItem(k));

      useRouter().replace("/login");
    }
  }
});