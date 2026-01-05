import { computed } from "vue";
import { useKeyStore } from "@/stores/keys";
import { getDatabase } from "@/db/dexie";

export function useDB() {
  const ks = useKeyStore();
  
  // 响应式获取当前账号对应的数据库
  const db = computed(() => {
    // 假设你的 KeyStore 中存储公钥的字段是 pkHex
    return getDatabase(ks.pkHex || "");
  });

  return {
    db
  };
}
