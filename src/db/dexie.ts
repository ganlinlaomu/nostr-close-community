import Dexie, { type Table } from "dexie";

/* ------------------------------------------------------------------ */
/* types */
/* ------------------------------------------------------------------ */

export type DBMessage = {
  id: string;
  pubkey: string;
  content?: string;
  created_at: number;
};

export type DBFriend = {
  pubkey: string;
  name?: string;
  group?: string;
};

export type DBImageCache = {
  url: string;
  blob: Blob;
  timestamp: number;
  mime: string;
};

/* ------------------------------------------------------------------ */
/* database */
/* ------------------------------------------------------------------ */

const DB_VERSION = 2;

export class NostrDatabase extends Dexie {
  messages!: Table<DBMessage, string>;
  friends!: Table<DBFriend, string>;
  meta!: Table<{ key: string; value: any }, string>;
  imageCache!: Table<DBImageCache, string>;

  constructor(pk: string) {
    // ✅ 使用完整 pubkey，绝不截断
    const name = pk ? `cc_db_${pk}` : "cc_db_guest";
    super(name);

    this.version(DB_VERSION).stores({
      messages: "id, created_at, pubkey",
      friends: "pubkey, name, group",
      meta: "key",
      imageCache: "url, timestamp"
    });
  }
}

/* ------------------------------------------------------------------ */
/* lifecycle (CRITICAL) */
/* ------------------------------------------------------------------ */

// ⚠️ 全 App 只允许一个活跃 DB
let currentDB: NostrDatabase | null = null;
let currentPk: string | null = null;

/**
 * 打开（或切换）当前账号数据库
 * - 若 pk 相同，复用
 * - 若 pk 不同，关闭旧库并新建
 */
export function openDatabase(pk: string): NostrDatabase {
  if (currentDB && currentPk === pk) {
    return currentDB;
  }

  if (currentDB) {
    try {
      currentDB.close();
    } catch {}
  }

  currentPk = pk;
  currentDB = new NostrDatabase(pk);
  return currentDB;
}

/**
 * 获取当前已打开的数据库
 * ❗ 所有 store / service 只能用这个
 */
export function getCurrentDatabase(): NostrDatabase {
  if (!currentDB) {
    throw new Error(
      "[dexie] Database not initialized. Call openDatabase(pk) first."
    );
  }
  return currentDB;
}

/**
 * 登出 / 切账号时调用
 */
export function closeDatabase() {
  if (currentDB) {
    try {
      currentDB.close();
    } catch {}
  }
  currentDB = null;
  currentPk = null;
}