```vue
<template>
  <div>
    <div class="card">
      <h3>好友</h3>

      <form @submit.prevent="onAdd">
        <div>
          <label>好友公钥（hex）</label>
          <input v-model="pubkey" class="input" placeholder="好友公钥 64 hex" />
        </div>

        <div style="margin-top:8px;">
          <label>显示名（可选）</label>
          <input v-model="name" class="input" placeholder="昵称" />
        </div>

        <div style="margin-top:8px;">
          <label>分组（可选）</label>
          <input v-model="group" class="input" placeholder="例如 family / work" />
        </div>

        <div style="margin-top:12px;">
          <button class="btn" :disabled="adding">{{ adding ? "添加中..." : "添加好友" }}</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h4>已添加好友（{{ friends.list.length }}）</h4>
      <div v-if="friends.list.length === 0" class="small">还没有好友</div>
      <div class="list" v-else>
        <div v-for="f in friends.list" :key="f.pubkey" class="card" style="display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div><strong>{{ f.name || shortPub(f.pubkey) }}</strong></div>
            <div class="small">{{ shortPub(f.pubkey) }} · {{ f.group || "未分组" }}</div>
          </div>
          <div>
            <button class="btn" @click="removeFriend(f.pubkey)">移除</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted } from "vue";
import { useFriendsStore } from "@/stores/friends";
import { useUIStore } from "@/stores/ui";
import { useKeyStore } from "@/stores/keys";

export default defineComponent({
  setup() {
    const friends = useFriendsStore();
    const ui = useUIStore();
    const keys = useKeyStore();

    const pubkey = ref("");
    const name = ref("");
    const group = ref("");
    const adding = ref(false);

    const shortPub = (s: string) => (s ? s.slice(0, 8) + "..." : "");

    onMounted(async () => {
      // ensure we load friends for current logged-in key
      await friends.load();
    });

    const onAdd = async () => {
      if (!keys.isLoggedIn) {
        ui.addToast("请先登录", 2000, "error");
        return;
      }
      adding.value = true;
      try {
        const pk = (pubkey.value || "").trim();
        if (!pk) {
          ui.addToast("请输入好友公钥", 2000, "error");
          return;
        }
        // validate basic hex form
        if (!/^[0-9a-fA-F]{64}$/.test(pk)) {
          ui.addToast("公钥格式错误，应为 64 位十六进制字符串", 3000, "error");
          return;
        }
        // ensure store loaded for current account
        await friends.load();
        const ok = friends.add({ pubkey: pk, name: name.value.trim(), group: group.value.trim() });
        if (ok) {
          ui.addToast("好友已添加", 2000, "success");
          // clear form
          pubkey.value = "";
          name.value = "";
          group.value = "";
        } else {
          ui.addToast("添加失败：可能已存在或格式不对", 2400, "error");
        }
      } catch (e) {
        ui.addToast("添加好友出错", 2000, "error");
      } finally {
        adding.value = false;
      }
    };

    const removeFriend = (pk: string) => {
      const ok = friends.remove(pk);
      if (ok) ui.addToast("已移除", 1500, "info");
      else ui.addToast("移除失败", 1500, "error");
    };

    return { friends, pubkey, name, group, onAdd, adding, shortPub, removeFriend };
  }
});
</script>

<style scoped>
/* minimal styling - keep consistent with app styles */
.input { width: 100%; padding:8px; border-radius:6px; border:1px solid #e2e8f0; }
.btn { background: #1976d2; color: #fff; padding:8px 12px; border-radius:8px; border:none; cursor:pointer; }
.card { background: #fff; padding:12px; border-radius:10px; margin-bottom:12px; box-shadow: 0 4px 10px rgba(0,0,0,0.04); }
.small { font-size:12px; color:#64748b; }
</style>
```
