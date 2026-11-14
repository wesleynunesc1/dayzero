import { TILE } from '../config';
import { TileMap } from './TileMap';

export interface PathPoint {
  x: number;
  y: number;
}

/** Custo para entrar no tile: Infinity = intransponível; >= 1 caso contrário. */
export type CostFn = (x: number, y: number) => number;

const SQRT2 = Math.SQRT2;
const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

/**
 * A* em grade com movimentos em 8 direções (sem cortar quinas).
 * Usa arrays tipados com "geração" para não precisar limpar memória a cada busca.
 */
export class Pathfinder {
  private g: Float64Array;
  private from: Int32Array;
  private seen: Uint32Array;
  private closed: Uint32Array;
  private gen = 1;
  private heap: number[] = [];
  private heapF: number[] = [];
  searchesThisTick = 0;

  constructor(private map: TileMap) {
    const n = map.w * map.h;
    this.g = new Float64Array(n);
    this.from = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
  }

  private push(node: number, f: number) {
    const h = this.heap;
    const hf = this.heapF;
    h.push(node);
    hf.push(f);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] <= hf[i]) break;
      [h[p], h[i]] = [h[i], h[p]];
      [hf[p], hf[i]] = [hf[i], hf[p]];
      i = p;
    }
  }

  private pop(): number {
    const h = this.heap;
    const hf = this.heapF;
    const top = h[0];
    const lastN = h.pop()!;
    const lastF = hf.pop()!;
    if (h.length > 0) {
      h[0] = lastN;
      hf[0] = lastF;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && hf[l] < hf[m]) m = l;
        if (r < h.length && hf[r] < hf[m]) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]];
        [hf[m], hf[i]] = [hf[i], hf[m]];
        i = m;
      }
    }
    return top;
  }

  /** Busca caminho entre tiles. Se não alcançar o objetivo, retorna o trecho até o nó mais próximo. */
  find(sx: number, sy: number, gx: number, gy: number, cost: CostFn, maxExpand = 4000): PathPoint[] | null {
    const map = this.map;
    if (!map.inb(sx, sy) || !map.inb(gx, gy)) return null;
    this.searchesThisTick++;
    // se o objetivo for intransponível, procura vizinho livre
    if (!isFinite(cost(gx, gy))) {
      let best: [number, number] | null = null;
      let bd = Infinity;
      for (let r = 1; r <= 2 && !best; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const nx = gx + dx;
            const ny = gy + dy;
            if (!map.inb(nx, ny) || !isFinite(cost(nx, ny))) continue;
            const d = Math.hypot(nx - sx, ny - sy);
            if (d < bd) {
              bd = d;
              best = [nx, ny];
            }
          }
      if (!best) return null;
      gx = best[0];
      gy = best[1];
    }
    this.gen++;
    const gen = this.gen;
    const W = map.w;
    const start = sy * W + sx;
    const goal = gy * W + gx;
    this.heap.length = 0;
    this.heapF.length = 0;
    this.g[start] = 0;
    this.seen[start] = gen;
    this.from[start] = -1;
    const hfn = (x: number, y: number) => {
      const dx = Math.abs(x - gx);
      const dy = Math.abs(y - gy);
      return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
    };
    this.push(start, hfn(sx, sy));
    let bestNode = start;
    let bestH = hfn(sx, sy);
    let expanded = 0;
    while (this.heap.length > 0) {
      const cur = this.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === goal) {
        bestNode = cur;
        break;
      }
      const cx = cur % W;
      const cy = (cur / W) | 0;
      const ch = hfn(cx, cy);
      if (ch < bestH) {
        bestH = ch;
        bestNode = cur;
      }
      if (++expanded > maxExpand) break;
      for (const [dx, dy, base] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!map.inb(nx, ny)) continue;
        const c = cost(nx, ny);
        if (!isFinite(c)) continue;
        if (dx !== 0 && dy !== 0) {
          // não cortar quinas
          if (!isFinite(cost(cx + dx, cy)) || !isFinite(cost(cx, cy + dy))) continue;
          if (cost(cx + dx, cy) > 1.5 || cost(cx, cy + dy) > 1.5) continue;
        }
        const ni = ny * W + nx;
        if (this.closed[ni] === gen) continue;
        const ng = this.g[cur] + base * c;
        if (this.seen[ni] !== gen || ng < this.g[ni]) {
          this.seen[ni] = gen;
          this.g[ni] = ng;
          this.from[ni] = cur;
          this.push(ni, ng + hfn(nx, ny));
        }
      }
    }
    if (bestNode === start) return [];
    const out: PathPoint[] = [];
    let n = bestNode;
    while (n !== start && n !== -1) {
      out.push({ x: (n % W) * TILE + TILE / 2, y: ((n / W) | 0) * TILE + TILE / 2 });
      n = this.from[n];
    }
    out.reverse();
    return out;
  }
}
