import { TILE } from '../config';
import { TILES } from '../world/tiles';
import type { World } from '../world/World';

export interface NoiseEvent {
  x: number;
  y: number;
  /** Raio efetivo em tiles. */
  radius: number;
  kind: string;
  byPlayer: boolean;
  sourceId: string | null;
}


/**
 * Propagação de ruído por "inundação" (Dijkstra) na grade: paredes e portas fechadas
 * absorvem som, então um disparo dentro de uma casa é ouvido bem menos longe que na rua.
 */
export class NoiseSystem {
  private cost: Float64Array;
  private stamp: Uint32Array;
  private gen = 1;
  private heap: number[] = [];
  private heapC: number[] = [];

  constructor(private world: World) {
    const n = world.map.w * world.map.h;
    this.cost = new Float64Array(n);
    this.stamp = new Uint32Array(n);
  }

  emit<L extends { x: number; y: number }>(
    n: NoiseEvent,
    listeners: L[],
    hearingMul: (l: L) => number,
    onHear: (l: L, intensity: number) => void,
  ) {
    const w = this.world;
    w.events.emit('noise', { x: n.x, y: n.y, radius: n.radius, kind: n.kind, byPlayer: n.byPlayer });
    if (n.radius >= 6 && n.byPlayer) w.noiseRing(n.x, n.y, n.radius);
    const maxR = n.radius * 1.35; // margem para audição aguçada
    const reach = maxR * TILE;
    const near = listeners.filter((l) => Math.abs(l.x - n.x) <= reach && Math.abs(l.y - n.y) <= reach);
    if (near.length === 0) return;
    this.flood(n.x, n.y, maxR);
    const map = w.map;
    for (const l of near) {
      const tx = Math.floor(l.x / TILE);
      const ty = Math.floor(l.y / TILE);
      if (!map.inb(tx, ty)) continue;
      const i = map.idx(tx, ty);
      if (this.stamp[i] !== this.gen) continue;
      const c = this.cost[i];
      const eff = n.radius * hearingMul(l);
      if (c <= eff) onHear(l, 1 - c / Math.max(1, eff));
    }
  }

  /** Custo de som de cada tile alcançado (consultável em testes). */
  costAt(tx: number, ty: number): number {
    const i = this.world.map.idx(tx, ty);
    return this.stamp[i] === this.gen ? this.cost[i] : Infinity;
  }

  private flood(px: number, py: number, maxCost: number) {
    const map = this.world.map;
    this.gen++;
    const gen = this.gen;
    const W = map.w;
    const sx = Math.floor(px / TILE);
    const sy = Math.floor(py / TILE);
    if (!map.inb(sx, sy)) return;
    const h = this.heap;
    const hc = this.heapC;
    h.length = 0;
    hc.length = 0;
    const s = sy * W + sx;
    this.cost[s] = 0;
    this.stamp[s] = gen;
    const push = (node: number, c: number) => {
      h.push(node);
      hc.push(c);
      let i = h.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hc[p] <= hc[i]) break;
        [h[p], h[i]] = [h[i], h[p]];
        [hc[p], hc[i]] = [hc[i], hc[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = h[0];
      const topC = hc[0];
      const ln = h.pop()!;
      const lc = hc.pop()!;
      if (h.length) {
        h[0] = ln;
        hc[0] = lc;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < h.length && hc[l] < hc[m]) m = l;
          if (r < h.length && hc[r] < hc[m]) m = r;
          if (m === i) break;
          [h[m], h[i]] = [h[i], h[m]];
          [hc[m], hc[i]] = [hc[i], hc[m]];
          i = m;
        }
      }
      return [top, topC] as const;
    };
    push(s, 0);
    while (h.length) {
      const [node, c] = pop();
      if (c > this.cost[node]) continue;
      const x = node % W;
      const y = (node / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (!map.inb(nx, ny)) continue;
        const ni = ny * W + nx;
        let step = TILES[map.ground[ni]].sound;
        const door = map.doorAt(nx, ny);
        if (door && !door.open && !door.broken) step = Math.max(step, 3);
        const nc = c + step;
        if (nc > maxCost) continue;
        if (this.stamp[ni] !== gen || nc < this.cost[ni]) {
          this.stamp[ni] = gen;
          this.cost[ni] = nc;
          push(ni, nc);
        }
      }
    }
  }
}
