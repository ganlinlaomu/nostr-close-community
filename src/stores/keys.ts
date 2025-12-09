import { defineStore } from "pinia";
import * as nostr from "nostr-tools";
import { useRouter } from "vue-router";
import { useFriendsStore } from "./friends";
import { useMessagesStore } from "./messages";

/**
 * keys store with robust nostr-tools feature detection.
 * - Adds `register()` to create/register an account (wrapper around generateTemp/loginWithSk).
 * - Keeps generate/login/logout functionality resilient to different nostr-tools builds.
 */

function toHex(u8: Uint8Array) {
  return Array.from(u8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function genRandomSkHex(): string {
  const arr = crypto.getRandomValues(new Uint8Array(32));
  return toHex(arr);
}
function safeGeneratePrivateKey(): string {
  if (nostr && typeof (nostr as any).generatePrivateKey === "function") {
    try { return (nostr as any).generatePrivateKey(); } catch {}
  }
  return genRandomSkHex();
}
async function safeGetPublicKey(skHex: string): Promise<string> {
  if (nostr && typeof (nostr as any).getPublicKey === "function") {
    try { return (nostr as any).getPublicKey(skHex); } catch (e) { throw e; }
  }
  if (nostr && (nostr as any).secp256k1 && typeof (nostr as any).secp256k1.getPublicKey === "function") {
    try { return (nostr as any).secp256k1.getPublicKey(skHex); } catch (e) { throw e; }
  }
  throw new Error("当前 nostr-tools 构建不支持从私钥派生公钥，请提供兼容的 nostr-tools，或在登录时输入公钥。");
}

export const useKeyStore = defineStore("keys", {
  state: () => ({
    skHex: "" as string,
    pkHex: "" as string
  }),
  actions: {
    async loginWithSk(sk: string) {
      this.skHex = sk;
      try {
        const pk = await safeGetPublicKey(sk);
        this.pkHex = pk;
      } catch (e) {
        this.skHex = "";
        this.pkHex = "";
        throw e;
      }
      try {
        localStorage.setItem("skHex", this.skHex);
        localStorage.setItem("pkHex", this.pkHex);
      } catch {}
      // load account-scoped stores
      try {
        const friends = useFriendsStore();
        await friends.load(this.pkHex);
      } catch {}
      try {
        const msgs = useMessagesStore();
        await msgs.load(this.pkHex);
      } catch {}
    },

    async generateTemp() {
      const sk = safeGeneratePrivateKey();
      await this.loginWithSk(sk);
    },

    /**
     * register(options?)
     * - Creates a new keypair (or uses provided skHex) and logs in the user.
     * - This function exists because some parts of the UI call ks.register(...).
     * - If you need server-side registration or additional metadata storage, extend this method.
     */
    async register(skHex?: string) {
      // If caller provided a specific skHex, try to use it, otherwise generate a fresh one.
      const sk = skHex && typeof skHex === "string" && skHex.trim() ? skHex.trim() : safeGeneratePrivateKey();
      await this.loginWithSk(sk);
      // Mark as registered locally (useful if UI expects a flag)
      try {
        const regsRaw = localStorage.getItem("nostr_registered_accounts") || "[]";
        const regs = JSON.parse(regsRaw);
        if (!Array.isArray(regs)) regs.length = 0;
        if (!regs.includes(this.pkHex)) {
          regs.push(this.pkHex);
          localStorage.setItem("nostr_registered_accounts", JSON.stringify(regs));
        }
      } catch {
        // ignore storage errors
      }
      return { skHex: this.skHex, pkHex: this.pkHex };
    },

    logout() {
      const currentPk = this.pkHex;
      this.skHex = "";
      this.pkHex = "";
      try {
        localStorage.removeItem("skHex");
        localStorage.removeItem("pkHex");
      } catch {}
      // clear in-memory stores (do not delete persisted storage by default)
      try {
        const friends = useFriendsStore();
        friends.reset(false);
      } catch {}
      try {
        const msgs = useMessagesStore();
        msgs.reset(false);
      } catch {}
      // navigate to login
      try {
        const router = useRouter();
        router.push("/login");
      } catch {
        window.location.href = "/#/login";
      }
    }
  }
});
