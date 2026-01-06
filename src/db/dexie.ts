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
export type DBInteraction = {
  id: string;
  messageId: string;
  author: string;
  type: "like" | "comment";
  timestamp: number;
  text?: string; // 评论内容
};

export type DBNotification = {
  id: string;
  type: string;
  from: string;
  messageId: string;
  created_at: number;
  read: boolean;
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
/* 2. Database Definition */
/* ------------------------------------------------------------------ */

const DB_VERSION = 3; // 升级版本号以应用新表结构

export class NostrDatabase extends Dexie {
  messages!: Table<DBMessage, string>;
  interactions!: Table<DBInteraction, string>; // 独立交互表
  friends!: Table<any, string>;
  meta!: Table<{ key: string; value: any }, string>;
  imageCache!: Table<any, string>;
  notifications!: Table<DBNotification, string>; // 独立通知表

  constructor(pk: string) {
    const name = pk ? `cc_db_${pk}` : "cc_db_guest";
    super(name);

    this.version(DB_VERSION).stores({
      // 索引建议：
      // [pubkey+created_at] 用于快速加载某个好友的聊天流
      messages: "id, created_at, pubkey, [pubkey+created_at]",
      
      // messageId 用于快速加载某篇帖子的所有评论/点赞
      interactions: "id, messageId, author, type, timestamp",
      
      friends: "pubkey, name, group",
      meta: "key",
      imageCache: "url, timestamp",
      
      // created_at 用于通知列表倒序排列
      notifications: "id, created_at, read, type"
    });
  }
}

/* ------------------------------------------------------------------ */
/* 3. Lifecycle Management (Singleton) */
/* ------------------------------------------------------------------ */

let currentDB: NostrDatabase | null = null;
let currentPk: string | null = null;

/**
 * 核心：打开（或切换）当前账号数据库
 * 改进：改为异步函数，确保数据库 ready 后再返回
 */
export async function openDatabase(pk: string): Promise<NostrDatabase> {
  if (currentDB && currentPk === pk) {
    if (!currentDB.isOpen()) await currentDB.open();
    return currentDB;
  }

  if (currentDB) {
    currentDB.close();
  }

  currentPk = pk;
  currentDB = new NostrDatabase(pk);
  
  await currentDB.open(); // 显式等待打开，防止后续 Store 加载报错
  return currentDB;
}

/**
 * 安全获取当前实例
 * 修正：所有的 Store 应该调用这个方法
 */
export function getCurrentDatabase(): NostrDatabase {
  if (!currentDB) {
    throw new Error("[dexie] Database not initialized. Call openDatabase(pk) first.");
  }
  return currentDB;
}

/**
 * 登出清理
 */
export function closeDatabase() {
  if (currentDB) {
    currentDB.close();
  }
  currentDB = null;
  currentPk = null;
}
