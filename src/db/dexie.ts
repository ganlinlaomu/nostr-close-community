import Dexie, { type Table } from "dexie";

// 定义表结构接口
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

// 继承 Dexie 创建数据库类
export class NostrDatabase extends Dexie {
  messages!: Table<DBMessage, string>;
  friends!: Table<DBFriend, string>;
  meta!: Table<{ key: string; value: any }, string>;
  imageCache!: Table<DBImageCache, string>;

  constructor(pk: string) {
    // 关键：根据公钥前缀创建不同的数据库文件，实现物理隔离
    // 如果没有 pk（未登录），使用 guest 库
    const dbName = pk ? `cc_db_${pk.slice(0, 10)}` : "cc_db_guest";
    super(dbName);

    // 定义版本逻辑（保持你原有的版本号）
    this.version(1).stores({
      messages: "id, created_at, pubkey",
      friends: "pubkey, name, group",
      meta: "key"
    });

    this.version(2).stores({
      messages: "id, created_at, pubkey",
      friends: "pubkey, name, group",
      meta: "key",
      imageCache: "url, timestamp"
    });
  }
}

// 缓存实例，防止同一个账号多次创建实例浪费资源
const instances: Record<string, NostrDatabase> = {};

export function getDatabase(pk: string): NostrDatabase {
  if (!instances[pk]) {
    instances[pk] = new NostrDatabase(pk);
  }
  return instances[pk];
}

// 常量定义
export const APP_VERSION = "0.1.0";
export const DB_VERSION = 2;
