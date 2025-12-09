export function isDebugEnabled(): boolean {
  try {
    return localStorage.getItem("nostr_debug") === "1";
  } catch {
    return false;
  }
}

export const logger = {
  debug: (...args: any[]) => {
    if (isDebugEnabled()) {
      // keep debug messages quiet unless explicitly enabled
      console.debug("[debug]", ...args);
    }
  },
  info: (...args: any[]) => {
    console.info("[info]", ...args);
  },
  warn: (...args: any[]) => {
    if (isDebugEnabled()) {
      console.warn("[warn]", ...args);
    }
  },
  error: (...args: any[]) => {
    console.error("[error]", ...args);
  }
};
