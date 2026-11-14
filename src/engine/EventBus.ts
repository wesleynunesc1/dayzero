/** Barramento de eventos tipado. Desacopla simulação e interface (e, no futuro, rede). */
export class EventBus<E extends object> {
  private handlers = new Map<keyof E, Set<(p: any) => void>>();

  on<K extends keyof E>(event: K, handler: (payload: E[K]) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of set) h(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
