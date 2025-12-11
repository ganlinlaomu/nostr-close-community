import { defineStore } from "pinia";
import * as nostr from "nostr-tools";
import { useRouter } from "vue-router";
import { useFriendsStore } from "./friends";
import { useMessagesStore } from "./messages";
import { useSettingsStore } from "./settings";
import type { WindowNostr } from "nostr-tools/lib/types/nip07";
import { BunkerSigner, type BunkerPointer, parseBunkerInput } from "nostr-tools/nip46";
import { finalizeEvent } from "nostr-tools";
import type { EventTemplate, VerifiedEvent } from "nostr-tools/lib/types/core";

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
    bunkerSigner: null as BunkerSigner | null,
    loginTimestamp: 0 as number, // Unix timestamp when user logged in
    bunkerConnectionStatus: "disconnected" as "connected" | "connecting" | "disconnected" | "error",
    bunkerLastError: "" as string
  }),
  getters: {
    /**
     * Check if user is logged in with any method
     */
    isLoggedIn(): boolean {
      return !!this.pkHex && !!this.loginMethod;
    },
    /**
     * Check if the current login method supports NIP-04 encryption/decryption
     */
    supportsNip04(): boolean {
      if (!this.isLoggedIn) return false;
      
      switch (this.loginMethod) {
        case "sk":
          return !!this.skHex;
        case "nip07":
          return !!(window.nostr?.nip04?.encrypt && window.nostr?.nip04?.decrypt);
        case "nip46":
          return !!this.bunkerSigner;
        default:
          return false;
      }
    },
    /**
     * Get bunker input from localStorage (for reconnection)
     */
    bunkerInput(): string {
      try {
        return localStorage.getItem("bunkerInput") || "";
      } catch {
        return "";
      }
    }
  },
  actions: {
    /**
     * Helper to execute bunker operation with timeout
     * @param operation - Async operation to execute
     * @param timeoutMs - Timeout in milliseconds
     * @param operationName - Name for error messages
     */
    async withBunkerTimeout<T>(
      operation: () => Promise<T>,
      timeoutMs: number = 10000,
      operationName: string = "bunker operation"
    ): Promise<T> {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      
      try {
        return await Promise.race([
          operation(),
          new Promise<T>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error(`${operationName}操作超时 (${timeoutMs}ms)`)), timeoutMs);
          })
        ]);
      } finally {
        // Clean up timeout if operation completed first
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
      }
    },

    /**
     * Check bunker connection status and attempt to reconnect if needed
     */
    async ensureBunkerConnection(): Promise<boolean> {
      if (this.loginMethod !== "nip46") {
        return true; // Not using bunker
      }

      if (!this.bunkerSigner) {
        this.bunkerConnectionStatus = "disconnected";
        return false;
      }

      // If already connected, return true
      if (this.bunkerConnectionStatus === "connected") {
        return true;
      }

      // Try to ping the bunker to verify connection
      try {
        this.bunkerConnectionStatus = "connecting";
        // Test connection by getting public key with short timeout
        await this.withBunkerTimeout(
          () => this.bunkerSigner!.getPublicKey(),
          3000,
          "bunker连接检查"
        );
        this.bunkerConnectionStatus = "connected";
        this.bunkerLastError = "";
        return true;
      } catch (e: any) {
        this.bunkerConnectionStatus = "error";
        this.bunkerLastError = e.message || "连接失败";
        console.warn("Bunker connection check failed:", e);
        return false;
      }
    },

    /**
     * Unified NIP-04 decryption that works with all login methods
     * @param senderPubHex - The public key of the sender
     * @param ciphertext - The encrypted content
     * @returns Promise<string> - The decrypted plaintext
     */
    async nip04Decrypt(senderPubHex: string, ciphertext: string): Promise<string> {
      if (!this.pkHex || !this.loginMethod) {
        throw new Error("未登录，无法解密消息");
      }

      switch (this.loginMethod) {
        case "sk":
          // Direct decryption with private key
          if (!this.skHex) {
            throw new Error("私钥登录但未找到私钥");
          }
          return await nostr.nip04.decrypt(this.skHex, senderPubHex, ciphertext);

        case "nip07":
          // Use browser extension
          if (!window.nostr?.nip04?.decrypt) {
            throw new Error("浏览器插件不支持 NIP-04 解密");
          }
          return await window.nostr.nip04.decrypt(senderPubHex, ciphertext);

        case "nip46":
          // Use bunker signer with timeout and retry
          if (!this.bunkerSigner) {
            throw new Error("Bunker 签名器未初始化，请重新登录");
          }
          
          // Try decryption with timeout
          try {
            const result = await this.withBunkerTimeout(
              () => this.bunkerSigner!.nip04Decrypt(senderPubHex, ciphertext),
              10000,
              "NIP-04解密"
            );
            this.bunkerConnectionStatus = "connected";
            this.bunkerLastError = "";
            return result;
          } catch (e: any) {
            this.bunkerConnectionStatus = "error";
            this.bunkerLastError = e.message || "解密失败";
            throw new Error(`Bunker解密失败: ${e.message || e}。可能是网络连接问题或签名器离线。`);
          }

        default:
          throw new Error(`未知的登录方式: ${this.loginMethod}`);
      }
    },

    /**
     * Unified NIP-04 encryption that works with all login methods
     * @param recipientPubHex - The public key of the recipient
     * @param plaintext - The plaintext to encrypt
     * @returns Promise<string> - The encrypted ciphertext
     */
    async nip04Encrypt(recipientPubHex: string, plaintext: string): Promise<string> {
      if (!this.pkHex || !this.loginMethod) {
        throw new Error("未登录，无法加密消息");
      }

      switch (this.loginMethod) {
        case "sk":
          // Direct encryption with private key
          if (!this.skHex) {
            throw new Error("私钥登录但未找到私钥");
          }
          return await nostr.nip04.encrypt(this.skHex, recipientPubHex, plaintext);

        case "nip07":
          // Use browser extension
          if (!window.nostr?.nip04?.encrypt) {
            throw new Error("浏览器插件不支持 NIP-04 加密");
          }
          return await window.nostr.nip04.encrypt(recipientPubHex, plaintext);

        case "nip46":
          // Use bunker signer with timeout
          if (!this.bunkerSigner) {
            throw new Error("Bunker 签名器未初始化，请重新登录");
          }
          
          try {
            const result = await this.withBunkerTimeout(
              () => this.bunkerSigner!.nip04Encrypt(recipientPubHex, plaintext),
              10000,
              "NIP-04加密"
            );
            this.bunkerConnectionStatus = "connected";
            this.bunkerLastError = "";
            return result;
          } catch (e: any) {
            this.bunkerConnectionStatus = "error";
            this.bunkerLastError = e.message || "加密失败";
            throw new Error(`Bunker加密失败: ${e.message || e}。可能是网络连接问题或签名器离线。`);
          }

        default:
          throw new Error(`未知的登录方式: ${this.loginMethod}`);
      }
    },

    /**
     * Unified event signing that works with all login methods
     * @param event - The event template to sign
     * @returns Promise<VerifiedEvent> - The signed event
     */
    async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
      if (!this.pkHex || !this.loginMethod) {
        throw new Error("未登录，无法签名事件");
      }

      switch (this.loginMethod) {
        case "sk":
          // Direct signing with private key
          if (!this.skHex) {
            throw new Error("私钥登录但未找到私钥");
          }
          return finalizeEvent(event, this.skHex);

        case "nip07":
          // Use browser extension
          if (!window.nostr?.signEvent) {
            throw new Error("浏览器插件不支持事件签名");
          }
          return await window.nostr.signEvent(event);

        case "nip46":
          // Use bunker signer with timeout
          if (!this.bunkerSigner) {
            throw new Error("Bunker 签名器未初始化，请重新登录");
          }
          
          try {
            const result = await this.withBunkerTimeout(
              () => this.bunkerSigner!.signEvent(event),
              15000,
              "事件签名"
            );
            this.bunkerConnectionStatus = "connected";
            this.bunkerLastError = "";
            return result;
          } catch (e: any) {
            this.bunkerConnectionStatus = "error";
            this.bunkerLastError = e.message || "签名失败";
            throw new Error(`Bunker签名失败: ${e.message || e}。可能是网络连接问题或签名器离线。`);
          }

        default:
          throw new Error(`未知的登录方式: ${this.loginMethod}`);
      }
    },
    async loginWithSk(sk: string) {
      this.skHex = sk;
      this.loginMethod = "sk";
      this.loginTimestamp = Math.floor(Date.now() / 1000);
      try {
        const pk = await safeGetPublicKey(sk);
        this.pkHex = pk;
      } catch (e) {
        this.skHex = "";
        this.pkHex = "";
        this.loginMethod = "";
        this.loginTimestamp = 0;
        throw e;
      }
      try {
        localStorage.setItem("skHex", this.skHex);
        localStorage.setItem("pkHex", this.pkHex);
        localStorage.setItem("loginMethod", this.loginMethod);
        localStorage.setItem("loginTimestamp", String(this.loginTimestamp));
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
      try {
        const settings = useSettingsStore();
        await settings.load(this.pkHex);
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
        this.loginTimestamp = Math.floor(Date.now() / 1000);

        try {
          localStorage.setItem("pkHex", this.pkHex);
          localStorage.setItem("loginMethod", this.loginMethod);
          localStorage.setItem("loginTimestamp", String(this.loginTimestamp));
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
        try {
          const settings = useSettingsStore();
          await settings.load(this.pkHex);
        } catch {}
      } catch (e: any) {
        this.pkHex = "";
        this.loginMethod = "";
        this.loginTimestamp = 0;
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
        this.loginTimestamp = Math.floor(Date.now() / 1000);
        this.bunkerSigner = signer;
        this.bunkerConnectionStatus = "connected";
        this.bunkerLastError = "";

        try {
          localStorage.setItem("pkHex", this.pkHex);
          localStorage.setItem("loginMethod", this.loginMethod);
          localStorage.setItem("loginTimestamp", String(this.loginTimestamp));
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
        try {
          const settings = useSettingsStore();
          await settings.load(this.pkHex);
        } catch {}
      } catch (e: any) {
        this.pkHex = "";
        this.loginMethod = "";
        this.loginTimestamp = 0;
        this.bunkerSigner = null;
        this.bunkerConnectionStatus = "disconnected";
        this.bunkerLastError = e.message || "登录失败";
        
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
      this.loginTimestamp = 0;
      
      // Close bunker signer if exists
      if (this.bunkerSigner) {
        try {
          this.bunkerSigner.close();
        } catch {}
        this.bunkerSigner = null;
      }
      
      // Reset bunker connection status
      this.bunkerConnectionStatus = "disconnected";
      this.bunkerLastError = "";
      
      try {
        localStorage.removeItem("skHex");
        localStorage.removeItem("pkHex");
        localStorage.removeItem("loginMethod");
        localStorage.removeItem("loginTimestamp");
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
      try {
        const settings = useSettingsStore();
        settings.reset(false);
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
