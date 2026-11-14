import { TILE } from '../config';
import { T, TILES, TileId } from './tiles';

export interface Door {
  id: number;
  x: number;
  y: number;
  open: boolean;
  broken: boolean;
  hp: number;
  maxHp: number;
  /** Porta em parede vertical (abre no eixo Y). */
  vertical: boolean;
  building: number;
  /** 0 = fechada, 1 = aberta (animação). */
  anim: number;
  label: string;
}

export const CHUNK = 32; // tiles por chunk de renderização

/**
 * Grade do mundo: piso, bloqueios de objetos, opacidade, portas e edifícios.
 * Todo estado aqui é serializável (arrays tipados) para futura persistência/rede.
 */
export class TileMap {
  readonly ground: Uint8Array;
  /** Bloqueio de movimento por objetos (carros, móveis, troncos). */
  readonly block: Uint8Array;
  /** Bloqueio de visão por objetos. */
  readonly blockSight: Uint8Array;
  /** Índice do edifício (-1 = área externa). */
  readonly building: Int16Array;
  readonly doorIndex: Int32Array;
  doors: Door[] = [];
  dirtyChunks = new Set<number>();
  readonly chunksX: number;
  readonly chunksY: number;

  constructor(readonly w: number, readonly h: number) {
    const n = w * h;
    this.ground = new Uint8Array(n);
    this.block = new Uint8Array(n);
    this.blockSight = new Uint8Array(n);
    this.building = new Int16Array(n).fill(-1);
    this.doorIndex = new Int32Array(n).fill(-1);
    this.chunksX = Math.ceil(w / CHUNK);
    this.chunksY = Math.ceil(h / CHUNK);
  }

  get pxW() {
    return this.w * TILE;
  }
  get pxH() {
    return this.h * TILE;
  }

  idx(x: number, y: number) {
    return y * this.w + x;
  }
  inb(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  get(x: number, y: number): TileId {
    return this.inb(x, y) ? this.ground[this.idx(x, y)] : T.RUBBLE;
  }
  set(x: number, y: number, t: TileId) {
    if (!this.inb(x, y)) return;
    this.ground[this.idx(x, y)] = t;
    this.markDirty(x, y);
  }
  markDirty(x: number, y: number) {
    this.dirtyChunks.add(Math.floor(y / CHUNK) * this.chunksX + Math.floor(x / CHUNK));
  }

  doorAt(x: number, y: number): Door | undefined {
    if (!this.inb(x, y)) return undefined;
    const d = this.doorIndex[this.idx(x, y)];
    return d >= 0 ? this.doors[d] : undefined;
  }

  addDoor(x: number, y: number, building: number, label = 'Porta', hp = 70): Door {
    const vertical = TILES[this.get(x, y - 1)].wall && TILES[this.get(x, y + 1)].wall;
    const door: Door = {
      id: this.doors.length,
      x,
      y,
      open: false,
      broken: false,
      hp,
      maxHp: hp,
      vertical,
      building,
      anim: 0,
      label,
    };
    this.doors.push(door);
    this.doorIndex[this.idx(x, y)] = door.id;
    return door;
  }

  /** Bloqueia movimento? (fora do mapa = sólido) */
  solid(x: number, y: number): boolean {
    if (!this.inb(x, y)) return true;
    const i = this.idx(x, y);
    if (TILES[this.ground[i]].solid || this.block[i]) return true;
    const d = this.doorIndex[i];
    if (d >= 0) {
      const door = this.doors[d];
      return !door.open && !door.broken;
    }
    return false;
  }

  opaque(x: number, y: number): boolean {
    if (!this.inb(x, y)) return true;
    const i = this.idx(x, y);
    if (TILES[this.ground[i]].opaque || this.blockSight[i]) return true;
    const d = this.doorIndex[i];
    if (d >= 0) {
      const door = this.doors[d];
      return !door.open && !door.broken;
    }
    return false;
  }

  solidPx(px: number, py: number) {
    return this.solid(Math.floor(px / TILE), Math.floor(py / TILE));
  }

  buildingAtPx(px: number, py: number): number {
    const x = Math.floor(px / TILE);
    const y = Math.floor(py / TILE);
    return this.inb(x, y) ? this.building[this.idx(x, y)] : -1;
  }

  /**
   * Raycast DDA em pixels. Retorna a distância até o primeiro tile em que `test` é verdadeiro
   * (ou maxDist). `visit` é chamado para cada tile atravessado.
   */
  cast(
    ox: number,
    oy: number,
    dx: number,
    dy: number,
    maxDist: number,
    test: (tx: number, ty: number) => boolean,
    visit?: (tx: number, ty: number) => void,
  ): number {
    let tx = Math.floor(ox / TILE);
    let ty = Math.floor(oy / TILE);
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(TILE / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(TILE / dy) : Infinity;
    let tMaxX = dx > 0 ? ((tx + 1) * TILE - ox) / dx : dx < 0 ? (tx * TILE - ox) / dx : Infinity;
    let tMaxY = dy > 0 ? ((ty + 1) * TILE - oy) / dy : dy < 0 ? (ty * TILE - oy) / dy : Infinity;
    let t = 0;
    if (visit) visit(tx, ty);
    for (let guard = 0; guard < 512; guard++) {
      if (tMaxX < tMaxY) {
        tx += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
      } else {
        ty += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
      }
      if (t >= maxDist) return maxDist;
      if (visit) visit(tx, ty);
      if (test(tx, ty)) return t;
    }
    return maxDist;
  }

  /** Linha de visão entre dois pontos (paredes, portas fechadas, sebes bloqueiam). */
  los(ax: number, ay: number, bx: number, by: number): boolean {
    const d = Math.hypot(bx - ax, by - ay);
    if (d < 1) return true;
    const t = this.cast(ax, ay, (bx - ax) / d, (by - ay) / d, d, (x, y) => this.opaque(x, y));
    return t >= d - 0.5;
  }

  /** Caminho reto livre para um círculo de raio r (amostragem). */
  clearPath(ax: number, ay: number, bx: number, by: number, r: number): boolean {
    const d = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(d / 4));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      if (
        this.solidPx(x - r, y - r) ||
        this.solidPx(x + r, y - r) ||
        this.solidPx(x - r, y + r) ||
        this.solidPx(x + r, y + r)
      )
        return false;
    }
    return true;
  }

  /** Resolve sobreposição de um círculo com tiles sólidos (deslizamento em paredes). */
  resolveCircle(p: { x: number; y: number }, r: number, isBlocked: (x: number, y: number) => boolean = (x, y) => this.solid(x, y)) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const minX = Math.floor((p.x - r) / TILE);
      const maxX = Math.floor((p.x + r) / TILE);
      const minY = Math.floor((p.y - r) / TILE);
      const maxY = Math.floor((p.y + r) / TILE);
      for (let ty = minY; ty <= maxY; ty++) {
        for (let tx = minX; tx <= maxX; tx++) {
          if (!isBlocked(tx, ty)) continue;
          const rx = tx * TILE;
          const ry = ty * TILE;
          const cx = Math.max(rx, Math.min(p.x, rx + TILE));
          const cy = Math.max(ry, Math.min(p.y, ry + TILE));
          let dx = p.x - cx;
          let dy = p.y - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          if (d2 > 1e-6) {
            const d = Math.sqrt(d2);
            p.x += (dx / d) * (r - d);
            p.y += (dy / d) * (r - d);
          } else {
            // centro dentro do tile: empurra pelo menor eixo
            const left = p.x - rx;
            const right = rx + TILE - p.x;
            const up = p.y - ry;
            const down = ry + TILE - p.y;
            const m = Math.min(left, right, up, down);
            if (m === left) p.x = rx - r;
            else if (m === right) p.x = rx + TILE + r;
            else if (m === up) p.y = ry - r;
            else p.y = ry + TILE + r;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
  }
}
