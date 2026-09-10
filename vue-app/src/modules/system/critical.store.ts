import { defineStore } from "pinia";
import { computed, ref } from "vue";
export const CRITICAL_LOCK = "geeksium-pos-critical";
/** Future sale/payment/cash-close modules must hold this lease until durable completion. */
export const useCriticalStore = defineStore("critical", () => {
  const reasons = ref<Record<string, string>>({});
  const blocked = computed(() => Object.keys(reasons.value).length > 0);
  function enter(reason: string): () => void {
    const id = crypto.randomUUID();
    reasons.value[id] = reason;
    let release!: () => void;
    const done = new Promise<void>((resolve) => { release = resolve; });
    if (navigator.locks) {
      void navigator.locks.request(CRITICAL_LOCK, { mode: "shared" }, () => done);
    }
    return () => { delete reasons.value[id]; release(); };
  }
  return { reasons, blocked, enter };
});
