import { TILE } from '../config';
import { itemDef } from '../data/items';
import { Camera } from '../engine/Camera';
import { angleDiff, hash2, lerp, smoothstep } from '../engine/math';
import { Actor } from '../entities/Actor';
import { Ally } from '../entities/Ally';
import { Player } from '../entities/Player';
import { Zombie } from '../entities/Zombie';
import type { Interactable } from '../systems/Interaction';
import { CHUNK } from '../world/TileMap';
import { T, TILES } from '../world/tiles';
import type { World } from '../world/World';
import { Ctx, ellipse, makeCanvas } from './canvas';
import { drawDecal } from './Decals';
import { drawCanopy, drawDoor, drawHuman, drawProp, drawTreeShadow, drawVehicle, HumanPose, makeRoof } from './Sprites';
import { TileTextures } from './Textures';

const CH = CHUNK * TILE;

const WALL_FACE: Record<number, string> = {
  [T.WALL_BRICK]: '#4f342b',
  [T.WALL_PLASTER]: '#6f6554',
  [T.WALL_BLUE]: '#515e66',
  [T.WALL_SAGE]: '#58604c',
  [T.WALL_CONCRETE]: '#5f5f5b',
};

export interface RenderOptions {
  target: Interactable | null;
  mouseX: number;
  mouseY: number;
  showCursor: boolean;
  /** Visão completa sem neblina (tela de título). */
  overview?: boolean;
}

/**
 * Renderiza o mundo em baixa resolução (pixel art) e amplia por um fator inteiro.
 * Camadas: cenário estático em chunks → personagens visíveis → neblina de visão →
 * copas e telhados → iluminação de amanhecer → pós-processamento.
 */
export class Renderer {
  readonly ctx: Ctx;
  private low: HTMLCanvasElement;
  private lctx: Ctx;
  private fog: HTMLCanvasElement;
  private fctx: Ctx;
  private light: HTMLCanvasElement;
  private lictx: Ctx;
  private tex = new TileTextures();
  private chunks = new Map<number, HTMLCanvasElement>();
  private roofs = new Map<number, HTMLCanvasElement>();
  private roofAlpha: number[] = [];
  private world: World | null = null;
  zoom = 3;
  lowW = 0;
  lowH = 0;
  dpr = 1;
  private visStamp = new Uint32Array(0);
  private visGen = 1;
  private visPoly: number[] = [];
  /** Tempo de renderização médio (ms). */
  frameMs = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    [this.low, this.lctx] = makeCanvas(320, 180);
    [this.fog, this.fctx] = makeCanvas(320, 180);
    [this.light, this.lictx] = makeCanvas(320, 180);
    this.resize();
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(window.innerWidth * this.dpr);
    const h = Math.floor(window.innerHeight * this.dpr);
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    // fator inteiro para manter os pixels quadrados (~17 tiles de altura visíveis)
    this.zoom = Math.max(2, Math.round(h / 280));
    this.lowW = Math.ceil(w / this.zoom) + 2;
    this.lowH = Math.ceil(h / this.zoom) + 2;
    for (const c of [this.low, this.fog, this.light]) {
      c.width = this.lowW;
      c.height = this.lowH;
    }
    this.lctx.imageSmoothingEnabled = false;
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Tamanho da área visível em unidades de mundo. */
  get viewW() {
    return this.lowW - 2;
  }
  get viewH() {
    return this.lowH - 2;
  }

  setWorld(world: World) {
    this.world = world;
    this.chunks.clear();
    world.map.dirtyChunks.clear();
    this.roofs.clear();
    this.roofAlpha = world.buildings.map(() => 1);
    this.visStamp = new Uint32Array(world.map.w * world.map.h);
    world.pendingDecals.length = 0;
  }

  // ================================================================ chunks estáticos
  /** Chunks são gerados sob demanda e descartados (LRU) — o mundo grande não fica todo em memória. */
  private chunk(cx: number, cy: number): HTMLCanvasElement {
    const key = cy * 1000 + cx;
    let c = this.chunks.get(key);
    if (!c) {
      c = this.buildChunk(cx, cy);
      if (this.chunks.size >= 36) {
        const oldest = this.chunks.keys().next().value as number;
        this.chunks.delete(oldest);
      }
    } else this.chunks.delete(key);
    this.chunks.set(key, c);
    return c;
  }

  private roof(id: number): HTMLCanvasElement {
    let r = this.roofs.get(id);
    if (!r) {
      r = makeRoof(this.world!.buildings[id]);
      if (this.roofs.size >= 80) this.roofs.delete(this.roofs.keys().next().value as number);
    } else this.roofs.delete(id);
    this.roofs.set(id, r);
    return r;
  }

  private buildChunk(cx: number, cy: number): HTMLCanvasElement {
    const w = this.world!;
    const map = w.map;
    const [c, ctx] = makeCanvas(CH, CH);
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    ctx.translate(-x0 * TILE, -y0 * TILE);
    const wallLike = (x: number, y: number) => TILES[map.get(x, y)].wall;

    // 1) piso
    for (let y = y0; y < y0 + CHUNK; y++)
      for (let x = x0; x < x0 + CHUNK; x++) {
        if (!map.inb(x, y)) continue;
        const t = map.get(x, y);
        if (TILES[t].wall && t !== T.WINDOW) continue;
        ctx.drawImage(this.tex.get(t, hash2(x, y) % 4), x * TILE, y * TILE);
        // oclusão ambiente junto a paredes
        if (!TILES[t].wall) {
          if (wallLike(x, y - 1)) {
            const g = ctx.createLinearGradient(0, y * TILE, 0, y * TILE + 5);
            g.addColorStop(0, 'rgba(0,0,0,0.32)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.fillRect(x * TILE, y * TILE, TILE, 5);
          }
          if (wallLike(x - 1, y)) {
            ctx.fillStyle = 'rgba(0,0,0,0.16)';
            ctx.fillRect(x * TILE, y * TILE, 2, TILE);
          }
          if (wallLike(x + 1, y)) {
            ctx.fillStyle = 'rgba(0,0,0,0.1)';
            ctx.fillRect(x * TILE + TILE - 1, y * TILE, 1, TILE);
          }
        }
      }

    // 2) decalques
    const minX = x0 * TILE - 24;
    const maxX = (x0 + CHUNK) * TILE + 24;
    const minY = y0 * TILE - 24;
    const maxY = (y0 + CHUNK) * TILE + 24;
    for (const d of w.decals) if (d.x > minX && d.x < maxX && d.y > minY && d.y < maxY) drawDecal(ctx, d);

    // 3) sombras (paredes, sebes, copas)
    const [mask, mctx] = makeCanvas(CH + 32, CH + 32);
    mctx.translate(-x0 * TILE + 16, -y0 * TILE + 16);
    mctx.fillStyle = '#000';
    for (let y = y0 - 1; y < y0 + CHUNK; y++)
      for (let x = x0 - 1; x < x0 + CHUNK; x++) {
        const t = map.get(x, y);
        if (!map.inb(x, y)) continue;
        if (TILES[t].wall || t === T.HEDGE) mctx.fillRect(x * TILE + 3, y * TILE + 5, TILE, TILE);
      }
    ctx.globalAlpha = 0.24;
    ctx.drawImage(mask, x0 * TILE - 16, y0 * TILE - 16);
    ctx.globalAlpha = 1;
    for (const tr of w.trees) if (tr.x > minX - 20 && tr.x < maxX + 20 && tr.y > minY - 20 && tr.y < maxY + 20) drawTreeShadow(ctx, tr);

    // 4) paredes, janelas, cercas, sebes, entulho
    for (let y = y0; y < y0 + CHUNK; y++)
      for (let x = x0; x < x0 + CHUNK; x++) {
        if (!map.inb(x, y)) continue;
        const t = map.get(x, y);
        const px = x * TILE;
        const py = y * TILE;
        const below = map.get(x, y + 1);
        const faceBelow = !TILES[below].wall;
        if (TILES[t].wall && t !== T.WINDOW) {
          ctx.drawImage(this.tex.get(t, hash2(x, y) % 4), px, py);
          if (!wallLike(x, y - 1)) {
            ctx.fillStyle = 'rgba(255,240,210,0.12)';
            ctx.fillRect(px, py, TILE, 1);
          }
          if (faceBelow) {
            ctx.fillStyle = WALL_FACE[t] ?? '#555';
            ctx.fillRect(px, py + 11, TILE, 5);
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fillRect(px, py + 11, TILE, 1);
            ctx.fillStyle = 'rgba(0,0,0,0.18)';
            ctx.fillRect(px, py + 14, TILE, 2);
          }
        } else if (t === T.WINDOW || t === T.WINDOW_BROKEN || t === T.WINDOW_BOARDED) {
          // usa a parede vizinha como moldura
          let wt: number = T.WALL_PLASTER;
          for (const [dx, dy] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ]) {
            const n = map.get(x + dx, y + dy);
            if (TILES[n].wall && n !== T.WINDOW) {
              wt = n;
              break;
            }
          }
          const horiz = wallLike(x - 1, y) || wallLike(x + 1, y) || (map.doorAt(x - 1, y) ?? map.doorAt(x + 1, y)) !== undefined;
          if (t === T.WINDOW_BOARDED) {
            ctx.drawImage(this.tex.get(wt, hash2(x, y) % 4), px, py);
            ctx.fillStyle = '#4c5a60';
            if (horiz) ctx.fillRect(px, py + 5, TILE, 5);
            else ctx.fillRect(px + 5, py, 5, TILE);
            // tábuas pregadas
            ctx.fillStyle = '#7a6040';
            ctx.save();
            ctx.translate(px + 8, py + 8);
            for (const [a, o] of [
              [0.35, -3],
              [-0.3, 3],
            ]) {
              ctx.save();
              ctx.rotate(horiz ? a : a + Math.PI / 2);
              ctx.fillRect(-9, o - 1.5, 18, 3);
              ctx.fillStyle = '#5a4428';
              ctx.fillRect(-7, o - 0.5, 1, 1);
              ctx.fillRect(6, o - 0.5, 1, 1);
              ctx.fillStyle = '#7a6040';
              ctx.restore();
            }
            ctx.restore();
          } else if (t === T.WINDOW) {
            ctx.drawImage(this.tex.get(wt, hash2(x, y) % 4), px, py);
            ctx.fillStyle = '#4c5a60';
            if (horiz) ctx.fillRect(px, py + 5, TILE, 5);
            else ctx.fillRect(px + 5, py, 5, TILE);
            ctx.fillStyle = '#6f8a96';
            if (horiz) ctx.fillRect(px + 1, py + 6, TILE - 2, 3);
            else ctx.fillRect(px + 6, py + 1, 3, TILE - 2);
            ctx.fillStyle = 'rgba(200,220,228,0.55)';
            if (horiz) ctx.fillRect(px + 3, py + 6, 4, 1);
            else ctx.fillRect(px + 6, py + 3, 1, 4);
            if (faceBelow && horiz) {
              ctx.fillStyle = WALL_FACE[wt] ?? '#555';
              ctx.fillRect(px, py + 11, TILE, 5);
              ctx.fillStyle = 'rgba(111,138,150,0.6)';
              ctx.fillRect(px + 2, py + 12, TILE - 4, 2);
            }
          } else {
            // janela quebrada: moldura nas pontas, passagem livre
            ctx.fillStyle = WALL_FACE[wt] ?? '#555';
            if (horiz) {
              ctx.fillRect(px, py + 5, 2, 5);
              ctx.fillRect(px + TILE - 2, py + 5, 2, 5);
            } else {
              ctx.fillRect(px + 5, py, 5, 2);
              ctx.fillRect(px + 5, py + TILE - 2, 5, 2);
            }
            ctx.fillStyle = 'rgba(160,185,195,0.8)';
            for (let i = 0; i < 6; i++) ctx.fillRect(px + 2 + ((i * 5) % 12), py + 3 + ((i * 7) % 10), 1, 1);
          }
        } else if (t === T.FENCE_WOOD || t === T.FENCE_METAL) {
          const same = (dx: number, dy: number) => map.get(x + dx, y + dy) === t;
          const metal = t === T.FENCE_METAL;
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.fillRect(px + 7, py + 9, 4, 4);
          ctx.fillStyle = metal ? '#7e817e' : '#6d5a3d';
          const lw = metal ? 1 : 2;
          if (same(1, 0)) ctx.fillRect(px + 8, py + 7, 8, lw);
          if (same(-1, 0)) ctx.fillRect(px, py + 7, 8, lw);
          if (same(0, 1)) ctx.fillRect(px + 7, py + 8, lw, 8);
          if (same(0, -1)) ctx.fillRect(px + 7, py, lw, 8);
          if (metal) {
            ctx.fillStyle = 'rgba(150,154,150,0.35)';
            if (same(1, 0) || same(-1, 0)) for (let i = 0; i < TILE; i += 2) ctx.fillRect(px + i, py + 5 + (i % 4 === 0 ? 0 : 1), 1, 4);
            else for (let i = 0; i < TILE; i += 2) ctx.fillRect(px + 5 + (i % 4 === 0 ? 0 : 1), py + i, 4, 1);
          } else {
            ctx.fillStyle = '#5e4c33';
            if (same(1, 0) || same(-1, 0)) ctx.fillRect(px, py + 10, TILE, 1.5);
            else ctx.fillRect(px + 10, py, 1.5, TILE);
          }
          ctx.fillStyle = metal ? '#5a5c5e' : '#4e3a28';
          ctx.fillRect(px + 6.5, py + 6.5, 3, 3);
        } else if (t === T.HEDGE) {
          ctx.fillStyle = '#3b4a2f';
          ctx.fillRect(px, py, TILE, TILE);
          const rr = hash2(x, y, 5);
          for (let i = 0; i < 6; i++) {
            ctx.fillStyle = i % 2 ? '#4d5d3a' : '#44532f';
            ellipse(ctx, px + ((rr >> (i * 3)) & 15), py + ((rr >> (i * 2 + 1)) & 15), 3.5, 3);
          }
          ctx.fillStyle = 'rgba(120,130,80,0.25)';
          ellipse(ctx, px + 10, py + 4, 3, 2);
          if (map.get(x, y + 1) !== T.HEDGE) {
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fillRect(px, py + 13, TILE, 3);
          }
        } else if (t === T.RUBBLE) {
          const rr = hash2(x, y, 9);
          for (let i = 0; i < 7; i++) {
            const cx2 = px + ((rr >> (i * 2)) & 13);
            const cy2 = py + ((rr >> (i * 3 + 1)) & 13);
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(cx2 + 1, cy2 + 1, 5, 4);
            ctx.fillStyle = ['#5a5650', '#6e6a62', '#4a4642', '#6a5a4a', '#7a7468'][i % 5];
            ctx.fillRect(cx2, cy2, 5, 4);
          }
          ctx.strokeStyle = '#5a3a2a';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(px + 1, py + (rr & 7) + 4);
          ctx.lineTo(px + 15, py + ((rr >> 4) & 7) + 4);
          ctx.stroke();
        }
      }

    // 5) objetos estáticos
    const props = w.props.filter((p) => (p.x + p.w) * TILE > minX && p.x * TILE < maxX && (p.y + p.h) * TILE > minY && p.y * TILE < maxY);
    props.sort((a, b) => a.y + a.h - (b.y + b.h));
    for (const p of props) drawProp(ctx, p);
    return c;
  }

  // ================================================================ visibilidade
  /** Calcula o polígono de visão do jogador e marca os tiles visíveis. */
  private computeVisibility(world: World, px: number, py: number, facing: number, down: boolean) {
    const map = world.map;
    this.visGen++;
    const gen = this.visGen;
    const vis = this.visStamp;
    const poly = this.visPoly;
    poly.length = 0;
    const night = world.nightFactor * (world.player.flashlight ? 0.3 : 1);
    const R = Math.max(this.viewW, this.viewH) * 0.8 * (down ? 0.6 : 1) * Math.max(0.35, world.weather.visionMul * (1 - 0.35 * night));
    const Rb = 64;
    const N = 280;
    const sx = Math.floor(px / TILE);
    const sy = Math.floor(py / TILE);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const diff = Math.abs(angleDiff(facing, a));
      const range = lerp(R, Rb, smoothstep(1.7, 2.5, diff));
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const t = map.cast(
        px,
        py,
        dx,
        dy,
        range,
        (x, y) => !(x === sx && y === sy) && map.opaque(x, y),
        (x, y) => {
          if (map.inb(x, y)) vis[map.idx(x, y)] = gen;
        },
      );
      const ext = t < range ? Math.min(t + 6, range) : t;
      poly.push(px + dx * ext, py + dy * ext);
    }
    // tiles sob/ao redor do jogador
    for (let y = sy - 1; y <= sy + 1; y++) for (let x = sx - 1; x <= sx + 1; x++) if (map.inb(x, y) && !map.opaque(x, y)) vis[map.idx(x, y)] = gen;
  }

  private isVisible(world: World, a: { x: number; y: number }): boolean {
    const m = world.map;
    const x = Math.floor(a.x / TILE);
    const y = Math.floor(a.y / TILE);
    if (!m.inb(x, y)) return false;
    return this.visStamp[m.idx(x, y)] === this.visGen;
  }

  // ================================================================ quadro
  render(world: World, cam: Camera, opt: RenderOptions) {
    const t0 = performance.now();
    if (world !== this.world) this.setWorld(world);
    const map = world.map;
    const L = this.lctx;
    const time = world.time;
    const p = world.player;

    // reconstrói chunks alterados (ex.: janela quebrada)
    if (map.dirtyChunks.size) {
      for (const k of map.dirtyChunks) {
        const cx = k % map.chunksX;
        const cy = Math.floor(k / map.chunksX);
        this.chunks.delete(cy * 1000 + cx);
      }
      map.dirtyChunks.clear();
    }
    // novos decalques: pinta direto nos chunks já existentes
    if (world.pendingDecals.length) {
      for (const d of world.pendingDecals) {
        const cx0 = Math.floor((d.x - 12) / CH);
        const cx1 = Math.floor((d.x + 12) / CH);
        const cy0 = Math.floor((d.y - 12) / CH);
        const cy1 = Math.floor((d.y + 12) / CH);
        for (let cy = cy0; cy <= cy1; cy++)
          for (let cx = cx0; cx <= cx1; cx++) {
            const c = this.chunks.get(cy * 1000 + cx);
            if (!c) continue;
            const g = c.getContext('2d')!;
            g.save();
            g.translate(-cx * CH, -cy * CH);
            drawDecal(g, d);
            g.restore();
          }
      }
      world.pendingDecals.length = 0;
    }

    const left = Math.floor(cam.left);
    const top = Math.floor(cam.top);
    const fracX = cam.left - left;
    const fracY = cam.top - top;
    L.setTransform(1, 0, 0, 1, 0, 0);
    L.fillStyle = '#0d0e0f';
    L.fillRect(0, 0, this.lowW, this.lowH);
    L.translate(-left, -top);

    // ---- cenário estático
    const cx0 = Math.max(0, Math.floor(left / CH));
    const cy0 = Math.max(0, Math.floor(top / CH));
    const cx1 = Math.min(map.chunksX - 1, Math.floor((left + this.lowW) / CH));
    const cy1 = Math.min(map.chunksY - 1, Math.floor((top + this.lowH) / CH));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) L.drawImage(this.chunk(cx, cy), cx * CH, cy * CH);

    const inView = (x: number, y: number, m = 24) => x > left - m && x < left + this.lowW + m && y > top - m && y < top + this.lowH + m;

    // ---- portas e fogo
    for (const d of map.doors) if (inView(d.x * TILE, d.y * TILE)) drawDoor(L, d);
    for (const pr of world.props) {
      if (pr.kind !== 'barrel_fire' || !inView(pr.x * TILE, pr.y * TILE)) continue;
      const fx = pr.x * TILE + 8;
      const fy = pr.y * TILE + 8;
      for (let i = 0; i < 5; i++) {
        const f = Math.sin(time * 9 + i * 1.7) * 0.5 + 0.5;
        L.fillStyle = i < 2 ? `rgba(255,${150 + f * 60},60,0.9)` : `rgba(255,${200 + f * 40},120,0.8)`;
        ellipse(L, fx + Math.sin(time * 5 + i) * 1.6, fy - f * 2, 2.6 - i * 0.35, 2.4 - i * 0.3);
      }
    }

    // ---- visibilidade
    const overview = !!opt.overview;
    if (!overview) this.computeVisibility(world, p.x, p.y, p.facing, p.isDown);

    // ---- corpos e pilhas
    for (const k of world.corpses) {
      if (!inView(k.x, k.y)) continue;
      if (k.pile) {
        L.fillStyle = 'rgba(0,0,0,0.3)';
        ellipse(L, k.x + 1, k.y + 1.5, 5, 3.5);
        L.fillStyle = '#5a5246';
        ellipse(L, k.x, k.y, 4.5, 3.2);
        L.fillStyle = '#7a6a52';
        L.fillRect(k.x - 3, k.y - 2, 3, 2);
        L.fillStyle = '#4a5a62';
        L.fillRect(k.x + 0.5, k.y - 1, 2.5, 2);
        continue;
      }
      drawHuman(L, { x: k.x, y: k.y, facing: k.facing, look: k.look, walk: 0, moving: false, down: true, zombie: k.zombie, seed: hash2(Math.round(k.x), Math.round(k.y)) });
      if (k.isPlayer && k.container.inv.items.length) {
        // mochila/itens espalhados ao lado do próprio corpo
        L.fillStyle = '#5a4a36';
        L.fillRect(k.x + 5, k.y + 4, 4, 3);
      }
    }

    // ---- veículos
    for (const v of world.vehicles) if (inView(v.x, v.y, 40)) drawVehicle(L, v, world.nightFactor);

    // ---- personagens (ordenados por Y)
    const actors: Actor[] = [];
    for (const z of world.zombies) if (inView(z.x, z.y) && (overview || this.isVisible(world, z))) actors.push(z);
    for (const a of world.allies) if (a.state !== 'morto' && inView(a.x, a.y) && (overview || this.isVisible(world, a))) actors.push(a);
    for (const n of world.npcs) if (n.state !== 'morto' && inView(n.x, n.y) && (overview || this.isVisible(world, n))) actors.push(n);
    // outros sobreviventes: só aparecem se estiverem À VISTA (nenhum marcador de aliado)
    for (const o of world.players) if (o !== p && o.alive && !o.vehicleId && inView(o.x, o.y) && (overview || this.isVisible(world, o))) actors.push(o);
    if (p.alive && !overview && !p.vehicleId) actors.push(p);
    actors.sort((a, b) => a.y - b.y);
    for (const a of actors) this.drawActor(L, a, world);

    // ---- partículas e traçantes
    for (const pt of world.particles) {
      if (!inView(pt.x, pt.y, 4)) continue;
      L.globalAlpha = Math.min(1, pt.life / (pt.max * 0.5));
      L.fillStyle = pt.color;
      L.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    L.globalAlpha = 1;
    for (const tr of world.tracers) {
      L.strokeStyle = `rgba(255,232,170,${tr.t / 0.07})`;
      L.lineWidth = 0.8;
      L.beginPath();
      L.moveTo(tr.x1, tr.y1);
      L.lineTo(tr.x2, tr.y2);
      L.stroke();
    }
    if (p.alive && p.muzzleT > 0) {
      const mx = p.x + Math.cos(p.facing) * 12;
      const my = p.y + Math.sin(p.facing) * 12;
      L.fillStyle = 'rgba(255,230,160,0.95)';
      ellipse(L, mx, my, 3, 2.2);
      L.fillStyle = 'rgba(255,255,230,1)';
      ellipse(L, mx, my, 1.4, 1.2);
    }

    // ---- neblina de visão (o que o personagem não vê)
    if (!overview) {
      const F = this.fctx;
      F.setTransform(1, 0, 0, 1, 0, 0);
      F.globalCompositeOperation = 'source-over';
      F.clearRect(0, 0, this.lowW, this.lowH);
      F.fillStyle = p.alive ? 'rgba(7,9,13,0.62)' : 'rgba(7,9,13,0.35)';
      F.fillRect(0, 0, this.lowW, this.lowH);
      if (p.alive) {
        F.globalCompositeOperation = 'destination-out';
        F.translate(-left, -top);
        F.filter = 'blur(1.5px)';
        F.fillStyle = '#000';
        F.beginPath();
        const poly = this.visPoly;
        F.moveTo(poly[0], poly[1]);
        for (let i = 2; i < poly.length; i += 2) F.lineTo(poly[i], poly[i + 1]);
        F.closePath();
        F.fill();
        F.filter = 'none';
        F.setTransform(1, 0, 0, 1, 0, 0);
        F.globalCompositeOperation = 'source-over';
      }
      L.setTransform(1, 0, 0, 1, 0, 0);
      L.drawImage(this.fog, 0, 0);
      L.translate(-left, -top);
    }

    // ---- copas de árvores
    for (const t of world.trees) {
      if (!inView(t.x, t.y, 30)) continue;
      const under = p.alive && Math.hypot(p.x - t.x, p.y - t.y) < t.r;
      drawCanopy(L, t, under ? 0.45 : 0.95, time);
    }

    // ---- telhados (somem quando o jogador entra no edifício)
    const inside = p.alive && !overview ? map.buildingAtPx(p.x, p.y) : -1;
    for (const b of world.buildings) {
      const target = b.id === inside ? 0 : 1;
      this.roofAlpha[b.id] += (target - this.roofAlpha[b.id]) * 0.15;
      const a = this.roofAlpha[b.id];
      if (a < 0.02) continue;
      const bx = b.x * TILE;
      const by = b.y * TILE;
      if (!inView(bx + (b.w * TILE) / 2, by + (b.h * TILE) / 2, Math.max(b.w, b.h) * TILE)) continue;
      L.globalAlpha = a * 0.4;
      L.fillStyle = '#000';
      L.fillRect(bx + 4, by + 6, b.w * TILE, b.h * TILE);
      L.globalAlpha = a;
      L.drawImage(this.roof(b.id), bx, by);
      L.globalAlpha = 1;
    }

    // ---- iluminação (amanhecer + escuridão interna + fontes de luz)
    this.renderLighting(world, left, top, time, inside, overview);
    L.setTransform(1, 0, 0, 1, 0, 0);
    L.drawImage(this.light, 0, 0);
    L.translate(-left, -top);
    // brilho aditivo das fontes quentes
    L.globalCompositeOperation = 'lighter';
    for (const l of world.lights) {
      if (!inView(l.x, l.y, l.r)) continue;
      const f = l.kind === 'fire' ? 0.85 + Math.sin(time * 11 + l.x) * 0.1 : this.lampFlicker(l.x, time);
      if (f <= 0.05) continue;
      const g = L.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r * 0.7);
      g.addColorStop(0, `rgba(${l.color},${0.22 * f})`);
      g.addColorStop(1, `rgba(${l.color},0)`);
      L.fillStyle = g;
      L.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    if (p.alive && p.muzzleT > 0) {
      const g = L.createRadialGradient(p.x, p.y, 0, p.x, p.y, 70);
      g.addColorStop(0, 'rgba(255,200,120,0.35)');
      g.addColorStop(1, 'rgba(255,200,120,0)');
      L.fillStyle = g;
      L.fillRect(p.x - 70, p.y - 70, 140, 140);
    }
    L.globalCompositeOperation = 'source-over';

    // ---- indicadores no mundo: anel de ruído e destaque de interação
    for (const r of world.noiseRings) {
      const k = r.t / r.max;
      L.strokeStyle = `rgba(226,206,160,${(1 - k) * 0.35})`;
      L.lineWidth = 1;
      L.beginPath();
      L.arc(r.x, r.y, r.r * (0.2 + 0.8 * k), 0, Math.PI * 2);
      L.stroke();
    }
    if (opt.target && p.alive) this.drawTargetMarker(L, world, opt.target, time);

    // ---- pós-processamento em espaço de tela
    L.setTransform(1, 0, 0, 1, 0, 0);
    this.postFx(world);

    // ---- amplia para a tela
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const z = this.zoom;
    ctx.drawImage(this.low, -fracX * z, -fracY * z, this.lowW * z, this.lowH * z);

    if (opt.showCursor && p.alive && !p.vehicleId && !p.sleep) this.drawCursor(world, cam, opt.mouseX * this.dpr, opt.mouseY * this.dpr);
    const ms = performance.now() - t0;
    this.frameMs = this.frameMs * 0.92 + ms * 0.08;
  }

  private lampFlicker(seed: number, time: number) {
    const n = Math.sin(time * 13 + seed) * Math.sin(time * 3.1 + seed * 0.3);
    if (Math.sin(time * 0.7 + seed) > 0.93) return 0.1;
    return 0.75 + n * 0.2;
  }

  private renderLighting(world: World, left: number, top: number, time: number, inside: number, overview: boolean) {
    const C = this.lictx;
    const p = world.player;
    C.setTransform(1, 0, 0, 1, 0, 0);
    C.globalCompositeOperation = 'source-over';
    C.clearRect(0, 0, this.lowW, this.lowH);
    const night = world.nightFactor;
    const wx = world.weather;
    const amb = Math.min(0.82, 0.18 + 0.56 * night + 0.08 * wx.rain + 0.05 * wx.fog);
    C.fillStyle = `rgba(${Math.round(20 - 10 * night)},${Math.round(24 - 8 * night)},${Math.round(44 + 6 * night)},${amb})`;
    C.fillRect(0, 0, this.lowW, this.lowH);
    C.translate(-left, -top);
    // interiores são mais escuros (luz só pelas janelas e portas)
    for (const b of world.buildings) {
      const a = 1 - this.roofAlpha[b.id];
      if (a < 0.02) continue;
      C.fillStyle = `rgba(4,5,10,${0.36 * a})`;
      C.fillRect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE);
    }
    C.globalCompositeOperation = 'destination-out';
    const radial = (x: number, y: number, r: number, k: number) => {
      const g = C.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${k})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      C.fillStyle = g;
      C.fillRect(x - r, y - r, r * 2, r * 2);
    };
    if (p.alive && !overview) radial(p.x, p.y, (inside >= 0 ? 72 : 48) * (1 - 0.35 * night), inside >= 0 ? 0.6 : 0.4 + 0.25 * night);
    // faróis da caminhonete (cone de luz à frente)
    for (const v of world.vehicles) {
      if (!v.engineOn) continue;
      const hx = v.x + Math.cos(v.angle) * (v.def.length / 2);
      const hy = v.y + Math.sin(v.angle) * (v.def.length / 2);
      const g = C.createRadialGradient(hx, hy, 2, hx, hy, 150);
      g.addColorStop(0, 'rgba(0,0,0,0.9)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      C.fillStyle = g;
      C.beginPath();
      C.moveTo(hx, hy);
      C.arc(hx, hy, 150, v.angle - 0.4, v.angle + 0.4);
      C.closePath();
      C.fill();
    }
    for (const l of world.lights) {
      const f = l.kind === 'fire' ? 0.85 + Math.sin(time * 11 + l.x) * 0.12 : this.lampFlicker(l.x, time);
      if (f > 0.05) radial(l.x, l.y, l.r, 0.85 * f);
    }
    if (p.alive && p.muzzleT > 0) radial(p.x, p.y, 90, 0.9);
    // lanterna: cone bloqueado por paredes
    if (p.alive && !overview && p.flashlight) {
      const it = p.flashlight;
      const range = itemDef(it.defId).light?.radius ?? 140;
      const half = 0.42;
      C.beginPath();
      C.moveTo(p.x, p.y);
      const map = world.map;
      const sx = Math.floor(p.x / TILE);
      const sy = Math.floor(p.y / TILE);
      for (let i = 0; i <= 28; i++) {
        const a = p.facing - half + (i / 28) * half * 2;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        const t = map.cast(p.x, p.y, dx, dy, range, (x, y) => !(x === sx && y === sy) && map.opaque(x, y));
        C.lineTo(p.x + dx * Math.min(range, t + 3), p.y + dy * Math.min(range, t + 3));
      }
      C.closePath();
      const g = C.createRadialGradient(p.x, p.y, 4, p.x, p.y, range);
      g.addColorStop(0, 'rgba(0,0,0,0.95)');
      g.addColorStop(0.6, 'rgba(0,0,0,0.7)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      C.fillStyle = g;
      C.fill();
    }
    C.globalCompositeOperation = 'source-over';
    C.setTransform(1, 0, 0, 1, 0, 0);
  }

  private postFx(world: World) {
    const L = this.lctx;
    const W = this.lowW;
    const H = this.lowH;
    const p = world.player;
    // gradação de cor conforme a hora: amanhecer/entardecer alaranjados, noite fria
    const hr = world.hour;
    const golden = hr >= 5 && hr < 8.5 ? 1 - Math.abs(hr - 6.5) / 2 : hr >= 16.5 && hr < 19.5 ? 1 - Math.abs(hr - 18) / 1.5 : 0;
    const morning = hr < 12;
    L.globalCompositeOperation = 'soft-light';
    const g = morning ? L.createLinearGradient(W, 0, 0, H) : L.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, `rgba(255,170,110,${0.15 + 0.4 * Math.max(0, golden)})`);
    g.addColorStop(0.55, 'rgba(150,140,130,0.15)');
    g.addColorStop(1, `rgba(60,80,120,${0.3 + 0.3 * world.nightFactor})`);
    L.fillStyle = g;
    L.fillRect(0, 0, W, H);
    this.weatherFx(world);
    // dessaturação leve (paleta pós-apocalíptica)
    L.globalCompositeOperation = 'saturation';
    L.fillStyle = 'rgba(128,128,128,0.18)';
    L.fillRect(0, 0, W, H);
    L.globalCompositeOperation = 'source-over';
    // vinheta
    const v = L.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.42)');
    L.fillStyle = v;
    L.fillRect(0, 0, W, H);
    if (!p.alive) return;
    // dano / saúde baixa / febre
    const hp = p.health.hp;
    let red = p.hurtFlash * 2.2;
    if (hp < 40) red += (1 - hp / 40) * (0.25 + Math.sin(world.time * 4) * 0.1);
    if (p.isDown) red += 0.3;
    if (red > 0.01) {
      const rg = L.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.7);
      rg.addColorStop(0, 'rgba(120,0,0,0)');
      rg.addColorStop(1, `rgba(110,8,6,${Math.min(0.7, red)})`);
      L.fillStyle = rg;
      L.fillRect(0, 0, W, H);
    }
    if (p.sickHours > 0 || p.health.infected || p.fatigue >= 90) {
      const k = p.health.infected ? 0.55 : 0.25;
      L.globalCompositeOperation = 'saturation';
      L.fillStyle = `rgba(128,128,128,${k})`;
      L.fillRect(0, 0, W, H);
      L.globalCompositeOperation = 'source-over';
      L.fillStyle = `rgba(90,110,40,${0.05 + Math.sin(world.time * 1.3) * 0.03})`;
      L.fillRect(0, 0, W, H);
    }
  }

  /** Chuva (riscos e respingos) e neblina (névoa que engole a distância). */
  private weatherFx(world: World) {
    const L = this.lctx;
    const W = this.lowW;
    const H = this.lowH;
    const wx = world.weather;
    const t = performance.now() / 1000;
    if (wx.rain > 0.02) {
      L.fillStyle = `rgba(40,50,70,${0.12 * wx.rain})`;
      L.fillRect(0, 0, W, H);
      const n = Math.floor(((W * H) / 600) * wx.rain);
      L.strokeStyle = `rgba(185,200,220,${0.5 * wx.rain})`;
      L.lineWidth = 1;
      L.beginPath();
      for (let i = 0; i < n; i++) {
        const sx = (hash2(i, 7) % 1000) / 1000;
        const sy = (hash2(i, 13) % 1000) / 1000;
        const sp = 0.8 + (hash2(i, 3) % 100) / 200;
        const x = ((sx * W + t * 60 * sp) % (W + 20)) - 10;
        const y = (sy * H + t * 260 * sp) % (H + 20) - 10;
        L.moveTo(x, y);
        L.lineTo(x - 2, y + 6);
      }
      L.stroke();
      // respingos no chão
      L.fillStyle = `rgba(190,205,220,${0.35 * wx.rain})`;
      for (let i = 0; i < n / 3; i++) {
        const k = Math.floor(t * 8) + i;
        L.fillRect(hash2(k, 5) % W, hash2(k, 9) % H, 1, 1);
      }
    }
    if (wx.fog > 0.02) {
      const cx = W / 2;
      const cy = H / 2;
      const fg = L.createRadialGradient(cx, cy, 30, cx, cy, Math.max(W, H) * 0.6);
      fg.addColorStop(0, `rgba(170,176,180,${0.08 * wx.fog})`);
      fg.addColorStop(0.45, `rgba(170,176,180,${0.45 * wx.fog})`);
      fg.addColorStop(1, `rgba(176,182,186,${0.8 * wx.fog})`);
      L.fillStyle = fg;
      L.fillRect(0, 0, W, H);
    }
  }

  private drawActor(L: Ctx, a: Actor, world: World) {
    const base: HumanPose = {
      x: a.x,
      y: a.y,
      facing: a.facing,
      look: a.look,
      walk: a.walkPhase,
      moving: a.moving,
      flash: a.hurtFlash,
      attack: a.attackAnim > 0 ? a.attackAnim / Math.max(0.05, a.attackDur) : 0,
      seed: hash2(a.id.length, a.id.charCodeAt(1) || 0, a.id.length > 2 ? a.id.charCodeAt(2) : 0),
    };
    if (a instanceof Zombie) {
      drawHuman(L, {
        ...base,
        zombie: true,
        crawler: a.crawler,
        down: a.knockedDown > 0,
        reach: a.state === 'perseguir' || a.state === 'atacar' || (a.state === 'identificar' && a.stateT > 0.2),
        attack: a.attackWind > 0 ? Math.min(1, a.attackWind / a.stats.windup) : a.attackAnim > 0 ? 1 : 0,
      });
      return;
    }
    if (a instanceof Ally) {
      const wit = a.inv.get(a.weaponUid);
      const wd = wit ? itemDef(wit.defId).weapon : null;
      const isNpc = a.state === 'npc';
      drawHuman(L, { ...base, weapon: wd ? (wd.kind === 'gun' ? 'gun' : 'melee') : isNpc ? 'none' : 'melee', weaponLen: wd?.length ?? 10, weaponColor: '#6a6e70' });
      return;
    }
    if (a instanceof Player) {
      const it = a.weaponItem;
      const d = it ? itemDef(it.defId) : null;
      const wk = d?.weapon?.kind === 'gun' ? 'gun' : d?.weapon?.kind === 'melee' ? 'melee' : 'none';
      const bag = a.item('costas');
      drawHuman(L, {
        ...base,
        crouch: a.crouch,
        down: a.isDown || !!a.sleep,
        weapon: wk,
        weaponLen: d?.weapon?.length,
        weaponColor: d?.id === 'pe_de_cabra' || d?.id === 'cano_ferro' || d?.id === 'martelo' ? '#6a6e70' : d?.id === 'cassetete' ? '#232426' : d?.id === 'faca_cozinha' ? '#a8acac' : '#7a5a3a',
        backpack: bag ? (bag.defId === 'mochila_trilha' ? '#4a5a3a' : bag.defId === 'bolsa_lona' ? '#7a6a4a' : '#3a4a6a') : null,
        look: a.item('corpo') ? { ...a.look, overlay: overlayFor(a.item('corpo')!.defId) } : a.look,
      });
    }
  }

  private drawTargetMarker(L: Ctx, world: World, t: Interactable, time: number) {
    let x = t.x;
    let y = t.y;
    let w = 14;
    let h = 14;
    if (t.kind === 'container') {
      const c = t.container;
      x = c.x * TILE + (c.w * TILE) / 2;
      y = c.y * TILE + (c.h * TILE) / 2;
      w = c.w * TILE + 2;
      h = c.h * TILE + 2;
    } else if (t.kind === 'examine') {
      w = t.prop.w * TILE + 2;
      h = t.prop.h * TILE + 2;
    } else if (t.kind === 'shout') return;
    const a = 0.55 + Math.sin(time * 5) * 0.2;
    L.strokeStyle = `rgba(232,214,170,${a})`;
    L.lineWidth = 1;
    const x0 = Math.round(x - w / 2) + 0.5;
    const y0 = Math.round(y - h / 2) + 0.5;
    const s = 3;
    L.beginPath();
    for (const [cx, cy, dx, dy] of [
      [x0, y0, 1, 1],
      [x0 + w, y0, -1, 1],
      [x0, y0 + h, 1, -1],
      [x0 + w, y0 + h, -1, -1],
    ]) {
      L.moveTo(cx, cy + dy * s);
      L.lineTo(cx, cy);
      L.lineTo(cx + dx * s, cy);
    }
    L.stroke();
  }

  private drawCursor(world: World, cam: Camera, mx: number, my: number) {
    const ctx = this.ctx;
    const p = world.player;
    const w = p.weapon;
    ctx.save();
    ctx.strokeStyle = 'rgba(230,220,200,0.85)';
    ctx.lineWidth = Math.max(1, this.dpr);
    if (w.kind === 'gun') {
      const dist = Math.hypot(p.aimX - p.x, p.aimY - p.y);
      const moving = Math.hypot(p.vx, p.vy) > 5;
      const spread = (w.spread ?? 0.1) * (p.aiming ? 0.35 : 1) * (moving ? 1.6 : 1) * (p.running ? 2 : 1);
      const r = Math.max(4, Math.tan(spread / 2) * dist * this.zoom);
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    const s = 5 * this.dpr;
    ctx.beginPath();
    ctx.moveTo(mx - s * 2, my);
    ctx.lineTo(mx - s, my);
    ctx.moveTo(mx + s, my);
    ctx.lineTo(mx + s * 2, my);
    ctx.moveTo(mx, my - s * 2);
    ctx.lineTo(mx, my - s);
    ctx.moveTo(mx, my + s);
    ctx.lineTo(mx, my + s * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Converte coordenadas de tela (px CSS) para mundo. */
  screenToWorld(cam: Camera, sx: number, sy: number) {
    return { x: cam.left + (sx * this.dpr) / this.zoom, y: cam.top + (sy * this.dpr) / this.zoom };
  }
}

function overlayFor(defId: string): import('../entities/Actor').Appearance['overlay'] {
  switch (defId) {
    case 'jaqueta_couro':
      return { color: '#3e2f26', kind: 'jacket' };
    case 'moletom':
      return { color: '#5a5f66', kind: 'jacket' };
    case 'colete':
      return { color: '#2a2e33', kind: 'vest' };
    default:
      return undefined;
  }
}
