import { TILE } from '../config';
import { createItem, ItemInstance } from '../data/items';
import { CONTAINER_KINDS, rollLoot } from '../data/loot';
import { hash2, RNG } from '../engine/math';
import { Inventory } from '../systems/Inventory';
import type { BuiltWorld } from './MapBuilder';
import { T, TILES, TileId } from './tiles';
import { Building, Container, Prop } from './types';

/**
 * Ferramentas de construção do mundo (mesma semântica do construtor do bairro),
 * reutilizadas pelo gerador do mundo aberto. Todas as coordenadas em tiles.
 */
export class BuildKit {
  private cid = 0;
  constructor(readonly b: BuiltWorld, readonly rng: RNG, private prefix = 'w') {}

  get map() {
    return this.b.map;
  }

  inb(x: number, y: number) {
    return this.map.inb(x, y);
  }

  fill(x0: number, y0: number, x1: number, y1: number, t: TileId) {
    for (let y = Math.max(0, y0); y <= Math.min(this.map.h - 1, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(this.map.w - 1, x1); x++) this.map.set(x, y, t);
  }

  /** Preenche apenas onde o tile atual é "terreno natural" (não sobrescreve construções/ruas). */
  fillNatural(x0: number, y0: number, x1: number, y1: number, t: TileId, p = 1) {
    for (let y = Math.max(0, y0); y <= Math.min(this.map.h - 1, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(this.map.w - 1, x1); x++) {
        if (!this.isNatural(x, y)) continue;
        if (p < 1 && !this.rng.chance(p)) continue;
        this.map.set(x, y, t);
      }
  }

  isNatural(x: number, y: number) {
    if (!this.inb(x, y)) return false;
    const t = this.map.get(x, y);
    const i = this.map.idx(x, y);
    return (t === T.GRASS || t === T.GRASS_TALL || t === T.DIRT || t === T.SAND) && this.map.building[i] < 0 && !this.map.block[i];
  }

  /** Área livre (natural) para construir? */
  areaFree(x0: number, y0: number, x1: number, y1: number) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!this.isNatural(x, y)) return false;
    return true;
  }

  rect(x0: number, y0: number, x1: number, y1: number, t: TileId) {
    for (let x = x0; x <= x1; x++) {
      this.map.set(x, y0, t);
      this.map.set(x, y1, t);
    }
    for (let y = y0; y <= y1; y++) {
      this.map.set(x0, y, t);
      this.map.set(x1, y, t);
    }
  }

  building(name: string, kind: Building['kind'], x0: number, y0: number, x1: number, y1: number, wall: TileId, floor: TileId, roof: string, roofKind: Building['roofKind'] = 'gable'): number {
    const id = this.b.buildings.length;
    this.b.buildings.push({ id, name, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, roof, roofKind, kind });
    this.fill(x0, y0, x1, y1, floor);
    this.rect(x0, y0, x1, y1, wall);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.map.building[this.map.idx(x, y)] = id;
    return id;
  }

  door(x: number, y: number, b: number, label = 'Porta', hp = 70) {
    let f: TileId = T.FLOOR_WOOD;
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]) {
      const t = this.map.get(x + dx, y + dy);
      if (!TILES[t].wall && this.map.building[this.map.idx(x + dx, y + dy)] === b) {
        f = t;
        break;
      }
    }
    this.map.set(x, y, f);
    return this.map.addDoor(x, y, b, label, hp);
  }

  win(x: number, y: number) {
    if (TILES[this.map.get(x, y)].wall && !this.map.doorAt(x, y)) this.map.set(x, y, T.WINDOW);
  }

  prop(kind: string, x: number, y: number, w = 1, h = 1, o: Partial<Prop> = {}): Prop {
    const p: Prop = { kind, x, y, w, h, solid: true, variant: hash2(x, y, 7) % 4, ...o };
    this.b.props.push(p);
    if (p.solid) for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (this.inb(xx, yy)) this.map.block[this.map.idx(xx, yy)] = 1;
    return p;
  }

  container(kind: string, x: number, y: number, w: number, h: number, visual: string, o: { name?: string; items?: ItemInstance[]; loot?: boolean; owner?: string } = {}): Container {
    const k = CONTAINER_KINDS[kind] ?? CONTAINER_KINDS.caixote;
    const id = `${this.prefix}${this.cid++}`;
    const c: Container = { id, kind, name: o.name ?? k.name, x, y, w, h, inv: new Inventory(k.capacity), searched: false, building: this.map.building[this.map.idx(x, y)], owner: o.owner };
    if (o.loot !== false) for (const it of rollLoot(kind, this.rng)) c.inv.add(it);
    for (const it of o.items ?? []) c.inv.add(it);
    this.b.containers.set(id, c);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.b.containerAt.set(this.map.idx(xx, yy), id);
    this.prop(visual, x, y, w, h, { containerId: id, name: c.name });
    return c;
  }

  tree(x: number, y: number, r?: number) {
    if (!this.isNatural(x, y)) return;
    this.b.trees.push({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2, r: r ?? this.rng.range(14, 22), variant: this.rng.int(0, 3) });
    this.map.block[this.map.idx(x, y)] = 1;
  }

  car(x: number, y: number, vertical: boolean, o: { burned?: boolean; kind?: string; color?: string; trunk?: boolean; police?: boolean; military?: boolean } = {}) {
    const kind = o.kind ?? (o.police ? 'car_police' : 'car');
    const len = kind === 'bus' ? 9 : kind === 'van' ? 5 : 4;
    const w = vertical ? 2 : len;
    const h = vertical ? len : 2;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (!this.inb(xx, yy) || this.map.block[this.map.idx(xx, yy)] || TILES[this.map.get(xx, yy)].solid) return;
    const colors = ['#6d3b33', '#40505e', '#8a8a83', '#3d4a3c', '#2c2d30', '#7c6a4a', '#5b5f66'];
    const color = o.color ?? (o.military ? '#4a5238' : o.police ? '#cfcfc8' : this.rng.pick(colors));
    const name = o.military ? 'Veículo militar abandonado' : kind === 'bus' ? 'Ônibus abandonado' : kind === 'van' ? 'Van abandonada' : 'Carro abandonado';
    const fuel = o.burned || kind === 'bus' ? 0 : this.rng.chance(0.55) ? Math.round(this.rng.range(1.5, 8) * 10) / 10 : 0;
    const desc = o.burned ? 'Carcaça queimada.' : 'Abandonado às pressas. Vidros quebrados.';
    if (o.trunk) {
      this.container('porta_malas', x, y, w, h, kind, { name: 'Porta-malas' });
      Object.assign(this.b.props[this.b.props.length - 1], { vertical, burned: !!o.burned, color, desc, name: `${name} (porta-malas)`, fuel });
      return;
    }
    this.prop(kind, x, y, w, h, { vertical, burned: !!o.burned, color, name, desc, fuel });
  }

  decal(x: number, y: number, kind: BuiltWorld['decals'][number]['kind'], r = 6) {
    this.b.decals.push({ x: x * TILE, y: y * TILE, kind, r, rot: this.rng.range(0, 6.28), seed: this.rng.int(0, 99999) });
  }

  label(text: string, x: number, y: number) {
    this.b.labels.push({ text, x, y });
  }

  zombie(x: number, y: number, type: 'comum' | 'rapido' | 'debilitado' = 'comum', outfit?: 'policia' | 'mercado' | 'operario' | 'casual' | 'militar' | 'medico' | 'cientista', horde?: number) {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (!this.inb(tx, ty) || this.map.solid(tx, ty)) return;
    this.b.zombies.push({ x, y, type, outfit: outfit as never, horde });
  }

  item(id: string, qty = 1, state?: ItemInstance['state']) {
    const it = createItem(id, qty);
    if (state) it.state = { ...it.state, ...state };
    return it;
  }
}
