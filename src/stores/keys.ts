import { defineStore } from "pinia";
import * as nostr from "nostr-tools";
import { useRouter } from "vue-router";
import { useFriendsStore } from "./friends";
import { useMessagesStore } from "./messages";
import type { WindowNostr } from "nostr-tools/lib/types/nip07";
import { BunkerSigner, type BunkerPointer, parseBunkerInput } from "nostr-tools/nip46";

/**
 * keys store with robust nostr-tools feature detection.
 * - Supports NIP-07 (browser extension) login
 * - Supports NIP-46 (bunker/remote signer) login
 * - Adds `register()` to create/register an account (wrapper around generateTemp/loginWithSk).
 * - Keeps generate/login/logout functionality resilient to different nostr-tools builds.
 */

// Extend window with nostr property
declare global {
  interface Window {
    nostr?: WindowNostr;
  }
}

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
    pkHex: "" as string,
    loginMethod: "" as "sk" | "nip07" | "nip46" | "",
    bunkerSigner: null as BunkerSigner | null
  }),
  actions: {
    async loginWithSk(sk: string) {
      this.skHex = sk;
      this.loginMethod = "sk";
      try {
        const pk = await safeGetPublicKey(sk);
        this.pkHex = pk;
      } catch (e) {
        this.skHex = "";
        this.pkHex = "";
        this.loginMethod = "";
        throw e;
      }
      try {
        localStorage.setItem("skHex", this.skHex);
        localStorage.setItem("pkHex", this.pkHex);
        localStorage.setItem("loginMethod", this.loginMethod);
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

    /**
     * Login with NIP-07 browser extension
     */
    async loginWithExtension() {
      if (!window.nostr) {
        throw new Error("未检测到 Nostr 浏览器插件。请安装如 Alby, nos2x 等插件。");
      }

      try {
        const pk = await window.nostr.getPublicKey();
        this.pkHex = pk;
        this.skHex = ""; // No private key with extension
        this.loginMethod = "nip07";

        try {
          localStorage.setItem("pkHex", this.pkHex);
          localStorage.setItem("loginMethod", this.loginMethod);
          localStorage.removeItem("skHex"); // Ensure no private key is stored
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
      } catch (e: any) {
        this.pkHex = "";
        this.loginMethod = "";
        throw new Error(`浏览器插件登录失败: ${e.message || e}`);
      }
    },

    /**
     * Login with NIP-46 bunker/remote signer
     * @param bunkerInput - bunker:// URL or name@domain NIP-05
     */
    async loginWithBunker(bunkerInput: string) {
      try {
        // Parse bunker input (bunker:// URL or NIP-05)
        const bunkerPointer = await parseBunkerInput(bunkerInput.trim());
        
        if (!bunkerPointer) {
          throw new Error("无效的 bunker URL 或 NIP-05 地址。请检查输入格式。");
        }

        // Generate client secret key for bunker communication
        const clientSecretKey = crypto.getRandomValues(new Uint8Array(32));
        
        // Create bunker signer with timeout handling
        const signer = BunkerSigner.fromBunker(clientSecretKey, bunkerPointer, {
          onauth: (url: string) => {
            console.log("Bunker authentication required:", url);
          }
        });
        
        // Connect to the bunker with timeout
        try {
          await signer.sendRequest("connect", []);
        } catch (connectError: any) {
          throw new Error(`无法连接到远程签名器。请确保 bunker 服务可用并且您已授权连接。详情: ${connectError.message || connectError}`);
        }
        
        // Get public key from bunker
        const pk = await signer.getPublicKey();
        
        this.pkHex = pk;
        this.skHex = ""; // No private key with bunker
        this.loginMethod = "nip46";
        this.bunkerSigner = signer;

        try {
          localStorage.setItem("pkHex", this.pkHex);
          localStorage.setItem("loginMethod", this.loginMethod);
          localStorage.setItem("bunkerInput", bunkerInput);
          localStorage.removeItem("skHex"); // Ensure no private key is stored
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
      } catch (e: any) {
        this.pkHex = "";
        this.loginMethod = "";
        this.bunkerSigner = null;
        
        // Re-throw with a user-friendly message if not already handled
        if (e.message && e.message.includes("无法连接")) {
          throw e;
        }
        throw new Error(`Bunker 登录失败: ${e.message || e}`);
      }
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
      this.loginMethod = "";
      
      // Close bunker signer if exists
      if (this.bunkerSigner) {
        try {
          this.bunkerSigner.close();
        } catch {}
        this.bunkerSigner = null;
      }
      
      try {
        localStorage.removeItem("skHex");
        localStorage.removeItem("pkHex");
        localStorage.removeItem("loginMethod");
        localStorage.removeItem("bunkerInput");
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
