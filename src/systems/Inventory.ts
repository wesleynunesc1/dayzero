import { createItem, itemDef, ItemInstance, itemWeight } from '../data/items';

export interface AddResult {
  ok: boolean;
  reason?: string;
  /** Quantidade efetivamente adicionada. */
  added: number;
}

/**
 * Inventário com limite de peso e de espaços (pilhas distintas).
 * Usado pelo jogador, NPCs, recipientes e corpos.
 */
export class Inventory {
  items: ItemInstance[] = [];
  extraWeight = 0;
  extraSlots = 0;

  constructor(public baseWeight: number, public baseSlots: number = Infinity) {}

  get maxWeight() {
    return this.baseWeight + this.extraWeight;
  }
  get maxSlots() {
    return this.baseSlots + this.extraSlots;
  }

  weight(): number {
    let w = 0;
    for (const it of this.items) w += itemWeight(it);
    return w;
  }

  slotsUsed() {
    return this.items.length;
  }

  get(uid: string): ItemInstance | undefined {
    return this.items.find((i) => i.uid === uid);
  }

  findDef(defId: string): ItemInstance | undefined {
    return this.items.find((i) => i.defId === defId);
  }

  count(defId: string): number {
    let n = 0;
    for (const i of this.items) if (i.defId === defId) n += i.qty;
    return n;
  }

  /** Verifica se cabe (peso e espaço) e quanto cabe. */
  canAdd(item: ItemInstance, qty = item.qty): AddResult {
    const d = itemDef(item.defId);
    const unitW = itemWeight({ ...item, qty: 1 });
    const free = this.maxWeight - this.weight();
    let fit = unitW > 0 ? Math.floor((free + 1e-6) / unitW) : qty;
    fit = Math.min(fit, qty);
    if (fit <= 0) return { ok: false, reason: 'Peso acima da capacidade disponível.', added: 0 };
    const stackMax = d.stack ?? 1;
    if (stackMax > 1) {
      // espaço em pilhas existentes
      let room = 0;
      for (const i of this.items) if (i.defId === item.defId) room += stackMax - i.qty;
      const freeSlots = this.maxSlots - this.items.length;
      room += Math.max(0, freeSlots) * stackMax;
      fit = Math.min(fit, room);
      if (fit <= 0) return { ok: false, reason: 'Sem espaço livre.', added: 0 };
    } else if (this.items.length >= this.maxSlots) {
      return { ok: false, reason: 'Sem espaço livre.', added: 0 };
    }
    return { ok: true, added: fit };
  }

  /** Adiciona respeitando limites. Retorna quanto foi adicionado. O item original tem sua quantidade reduzida. */
  add(item: ItemInstance, qty = item.qty): AddResult {
    const check = this.canAdd(item, qty);
    if (!check.ok) return check;
    let n = check.added;
    const d = itemDef(item.defId);
    const stackMax = d.stack ?? 1;
    if (stackMax > 1) {
      for (const i of this.items) {
        if (n <= 0) break;
        if (i.defId !== item.defId || i.qty >= stackMax) continue;
        const k = Math.min(n, stackMax - i.qty);
        i.qty += k;
        n -= k;
      }
      while (n > 0) {
        const k = Math.min(n, stackMax);
        if (k === item.qty && !this.items.includes(item)) {
          this.items.push(item);
        } else {
          const copy = createItem(item.defId, k);
          copy.condition = item.condition;
          this.items.push(copy);
        }
        n -= k;
      }
    } else {
      this.items.push(item);
    }
    return { ok: true, added: check.added };
  }

  /** Remove (total ou parcial). Retorna a parte removida como instância própria. */
  remove(uid: string, qty?: number): ItemInstance | null {
    const idx = this.items.findIndex((i) => i.uid === uid);
    if (idx < 0) return null;
    const it = this.items[idx];
    const n = qty === undefined ? it.qty : Math.min(qty, it.qty);
    if (n >= it.qty) {
      this.items.splice(idx, 1);
      return it;
    }
    it.qty -= n;
    const part = createItem(it.defId, n);
    part.condition = it.condition;
    return part;
  }

  /** Consome N unidades de um tipo (ex.: munição). Retorna quanto consumiu. */
  take(defId: string, qty: number): number {
    let left = qty;
    for (let i = this.items.length - 1; i >= 0 && left > 0; i--) {
      const it = this.items[i];
      if (it.defId !== defId) continue;
      const k = Math.min(left, it.qty);
      it.qty -= k;
      left -= k;
      if (it.qty <= 0) this.items.splice(i, 1);
    }
    return qty - left;
  }

  /** Transfere de um inventário para outro respeitando os limites do destino. */
  static transfer(from: Inventory, to: Inventory, uid: string, qty?: number): AddResult {
    const it = from.get(uid);
    if (!it) return { ok: false, reason: 'Item não encontrado.', added: 0 };
    const want = qty ?? it.qty;
    const check = to.canAdd(it, want);
    if (!check.ok) return check;
    const part = from.remove(uid, check.added);
    if (!part) return { ok: false, reason: 'Item não encontrado.', added: 0 };
    return to.add(part);
  }
}
