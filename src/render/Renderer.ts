import { TILE } from '../config';
import { itemDef } from '../data/items';
import { Camera } from '../engine/Camera';
import { angleDiff, hash2, lerp, RNG, smoothstep } from '../engine/math';
import { Actor } from '../entities/Actor';
import { Ally } from '../entities/Ally';
import { Player } from '../entities/Player';
import { Zombie } from '../entities/Zombie';
import type { Interactable } from '../systems/Interaction';
import { CHUNK } from '../world/TileMap';
import { T, TILES } from '../world/tiles';
import type { World } from '../world/World';
import { CharPose, drawCharacter, drawFacadeDoor, drawFacadeWindow, drawTree, drawTreeShadow3q, FACADE_H, facadeStyle, makeBuildingSprite, ROOF_RISE, treeTop } from './Art';
import { Ctx, ellipse, makeCanvas } from './canvas';
import { drawDecal } from './Decals';
import { drawDoor, drawProp, drawVehicle } from './Sprites';
import { TileTextures } from './Textures';

const CH = CHUNK * TILE;

const WALL_FACE: Record<number, string> = {
  [T.WALL_BRICK]: '#8a5040',
  [T.WALL_PLASTER]: '#a89a80',
  [T.WALL_BLUE]: '#7a8e9a',
  [T.WALL_SAGE]: '#8a9672',
  [T.WALL_CONCRETE]: '#8e8e88',
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
  /** Qualidade gráfica: baixo (celular modesto), medio, alto. */
  quality: 'baixo' | 'medio' | 'alto' = 'alto';
  /** Escala fracionária (telas densas de celular): enquadramento igual em qualquer proporção. */
  fractional = false;

  setQuality(q: 'baixo' | 'medio' | 'alto') {
    this.quality = q;
    this.resize();
  }

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    [this.low, this.lctx] = makeCanvas(320, 180);
    [this.fog, this.fctx] = makeCanvas(320, 180);
    [this.light, this.lictx] = makeCanvas(320, 180);
    this.resize();
  }

  resize() {
    const cw = Math.max(1, window.innerWidth);
    const ch = Math.max(1, window.innerHeight);
    // Enquadramento: ~17 tiles no lado menor e no máximo ~31 no maior. Telas mais largas
    // ampliam mais em vez de revelar mais mundo (sem vantagem para quem tem tela larga).
    const cssZoom = Math.max(Math.min(cw, ch) / 280, Math.max(cw, ch) / 500);
    let w: number;
    let h: number;
    if (this.quality === 'baixo') {
      // baixo: a cena é desenhada já no tamanho final em pixels de jogo e o navegador amplia
      // (sem suavizar). Sem cópia grande por quadro — o modo mais leve para celulares modestos.
      this.dpr = 1 / cssZoom;
      this.zoom = 1;
      w = Math.ceil(cw * this.dpr);
      h = Math.ceil(ch * this.dpr);
    } else {
      this.dpr = Math.min(this.quality === 'medio' ? 1.5 : 2, window.devicePixelRatio || 1);
      w = Math.floor(cw * this.dpr);
      h = Math.floor(ch * this.dpr);
      const zh = Math.min(w, h) / 280;
      const zw = Math.max(w, h) / 500;
      this.zoom = this.fractional ? Math.max(1, zh, zw) : Math.max(2, Math.round(zh), Math.ceil(zw - 0.15));
    }
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;
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
      r = makeBuildingSprite(this.world!.buildings[id]);
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

    // 1b) vida no chão: tufos, flores silvestres, pedrinhas, grama invadindo calçadas e asfalto
    this.groundDecor(ctx, x0, y0);

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
    for (const tr of w.trees) if (tr.x > minX - 20 && tr.x < maxX + 20 && tr.y > minY - 20 && tr.y < maxY + 20) drawTreeShadow3q(ctx, tr);

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
          // cerca em 3/4: tábuas/hastes com altura, sombra no chão
          const same = (dx: number, dy: number) => map.get(x + dx, y + dy) === t;
          const metal = t === T.FENCE_METAL;
          const horiz = same(1, 0) || same(-1, 0) || !(same(0, 1) || same(0, -1));
          const post = metal ? '#5c6064' : '#6e5236';
          const board = metal ? '#8a8e8e' : '#a07a50';
          const dark = metal ? '#3e4244' : '#4a3422';
          ctx.fillStyle = 'rgba(16,24,12,0.25)';
          if (horiz) ctx.fillRect(px, py + 10, TILE, 3);
          else ctx.fillRect(px + 9, py, 3, TILE);
          if (horiz) {
            if (metal) {
              ctx.fillStyle = dark;
              ctx.fillRect(px, py - 1, TILE, 1);
              ctx.fillRect(px, py + 9, TILE, 1);
              ctx.fillStyle = 'rgba(150,156,156,0.55)';
              for (let i = 0; i < TILE; i += 2) ctx.fillRect(px + i, py, 1, 9);
            } else {
              for (let i = 0; i < 4; i++) {
                const bx = px + i * 4;
                const hgt = 11 - (hash2(x * 4 + i, y) % 3 === 0 ? 2 : 0);
                ctx.fillStyle = dark;
                ctx.fillRect(bx, py + 10 - hgt, 3.5, hgt);
                ctx.fillStyle = board;
                ctx.fillRect(bx + 0.5, py + 10.5 - hgt, 2.5, hgt - 1);
                ctx.fillStyle = 'rgba(255,240,210,0.18)';
                ctx.fillRect(bx + 0.5, py + 10.5 - hgt, 1, hgt - 1);
              }
              ctx.fillStyle = dark;
              ctx.fillRect(px, py + 3, TILE, 1.5);
              ctx.fillRect(px, py + 7, TILE, 1.5);
            }
          } else {
            ctx.fillStyle = dark;
            ctx.fillRect(px + 6, py - 4, 4, TILE + 4);
            ctx.fillStyle = metal ? 'rgba(150,156,156,0.7)' : board;
            ctx.fillRect(px + 6.5, py - 3.5, 3, TILE + 3);
          }
          if (!same(-1, 0) || (x + y) % 3 === 0) {
            ctx.fillStyle = dark;
            ctx.fillRect(px + (horiz ? 0 : 6), py - 3, 3, 14);
            ctx.fillStyle = post;
            ctx.fillRect(px + (horiz ? 0.5 : 6.5), py - 2.5, 2, 13);
          }
        } else if (t === T.HEDGE) {
          // sebe com volume: topo iluminado e face frontal sombreada
          const rr = hash2(x, y, 5);
          const front = map.get(x, y + 1) !== T.HEDGE;
          ctx.fillStyle = '#2c4422';
          ctx.fillRect(px - 0.5, py - 5, TILE + 1, TILE + 5);
          ctx.fillStyle = '#4a7a36';
          ctx.fillRect(px, py - 4.5, TILE, TILE + 4);
          for (let i = 0; i < 7; i++) {
            ctx.fillStyle = i % 2 ? '#5e9240' : '#6aa04a';
            ellipse(ctx, px + ((rr >> (i * 3)) & 15), py - 4 + ((rr >> (i * 2 + 1)) & 11), 3, 2.5);
          }
          ctx.fillStyle = '#86b860';
          for (let i = 0; i < 5; i++) ctx.fillRect(px + ((rr >> (i * 4)) & 15), py - 4 + ((rr >> (i + 3)) & 7), 1, 1);
          if (front) {
            ctx.fillStyle = '#365a28';
            ctx.fillRect(px, py + 8, TILE, 8);
            ctx.fillStyle = '#2a4420';
            ctx.fillRect(px, py + 14, TILE, 2);
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
        ellipse(L, k.x + 1, k.y + 1.5, 6, 3.5);
        L.fillStyle = '#6a6052';
        ellipse(L, k.x, k.y, 5.5, 3.6);
        L.fillStyle = '#8a7a62';
        L.fillRect(k.x - 3, k.y - 2, 3, 2);
        L.fillStyle = '#5a6a72';
        L.fillRect(k.x + 0.5, k.y - 1, 2.5, 2);
        continue;
      }
      drawCharacter(L, { x: k.x, y: k.y - 3, facing: k.facing, look: k.look, walk: 0, moving: false, down: true, zombie: k.zombie, seed: hash2(Math.round(k.x), Math.round(k.y)) });
      if (k.isPlayer && k.container.inv.items.length) {
        // mochila/itens espalhados ao lado do próprio corpo
        L.fillStyle = '#1e1a16';
        L.fillRect(k.x + 7, k.y + 1, 6, 5);
        L.fillStyle = '#6a5a40';
        L.fillRect(k.x + 8, k.y + 2, 4, 3);
      }
    }

    // ---- veículos
    for (const v of world.vehicles) if (inView(v.x, v.y, 40)) drawVehicle(L, v, world.nightFactor);

    // ---- cena em profundidade: personagens, árvores e construções ordenados pela base (Y)
    const inside = p.alive && !overview ? map.buildingAtPx(p.x, p.y) : -1;
    const drawables: { y: number; f: () => void }[] = [];
    const push = (y: number, f: () => void) => drawables.push({ y, f });
    for (const z of world.zombies) if (inView(z.x, z.y, 30) && (overview || this.isVisible(world, z))) push(z.y, () => this.drawActor(L, z, world));
    for (const a of world.allies) if (a.state !== 'morto' && inView(a.x, a.y, 30) && (overview || this.isVisible(world, a))) push(a.y, () => this.drawActor(L, a, world));
    for (const n of world.npcs) if (n.state !== 'morto' && inView(n.x, n.y, 30) && (overview || this.isVisible(world, n))) push(n.y, () => this.drawActor(L, n, world));
    // outros sobreviventes: só aparecem se estiverem À VISTA (nenhum marcador de aliado)
    for (const o of world.players) if (o !== p && o.alive && !o.vehicleId && inView(o.x, o.y, 30) && (overview || this.isVisible(world, o))) push(o.y, () => this.drawActor(L, o, world));
    if (p.alive && !overview && !p.vehicleId) push(p.y, () => this.drawActor(L, p, world));
    for (const t of world.trees) {
      if (!inView(t.x, t.y - t.r, t.r * 3 + 20)) continue;
      // quem está atrás da copa continua visível: a árvore fica translúcida
      const hidden = p.alive && Math.abs(p.x - t.x) < t.r + 4 && p.y < t.y && p.y > t.y - treeTop(t) - 6;
      push(t.y, () => drawTree(L, t, hidden ? 0.5 : 1, time));
    }
    for (const bd of world.buildings) {
      const bx = bd.x * TILE;
      const by = bd.y * TILE;
      const bw = bd.w * TILE;
      const bh = bd.h * TILE;
      // dentro: telhado e fachada somem; atrás do prédio: ficam translúcidos para não esconder o jogador
      const behind = p.alive && !overview && inside !== bd.id && p.x > bx - 4 && p.x < bx + bw + 4 && p.y < by + bh && p.y > by - ROOF_RISE - 1;
      const target = bd.id === inside ? 0 : behind ? 0.55 : 1;
      this.roofAlpha[bd.id] += (target - this.roofAlpha[bd.id]) * 0.15;
      const al = this.roofAlpha[bd.id];
      if (al < 0.02) continue;
      if (!inView(bx + bw / 2, by + bh / 2, Math.max(bw, bh) / 2 + 40)) continue;
      push(by + bh - 0.5, () => this.drawBuilding(L, world, bd, al));
    }
    drawables.sort((a2, b2) => a2.y - b2.y);
    for (const d of drawables) d.f();

    // ---- partículas e traçantes
    const pstep = this.quality === 'baixo' ? 2 : 1;
    for (let pi = 0; pi < world.particles.length; pi += pstep) {
      const pt = world.particles[pi];
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
      L.moveTo(tr.x1, tr.y1 - 12);
      L.lineTo(tr.x2, tr.y2 - 12);
      L.stroke();
    }
    if (p.alive && p.muzzleT > 0) {
      const mx = p.x + Math.cos(p.facing) * 11;
      const my = p.y - 10 + Math.sin(p.facing) * 9;
      L.fillStyle = 'rgba(255,230,160,0.95)';
      ellipse(L, mx, my, 3, 2.2);
      L.fillStyle = 'rgba(255,255,230,1)';
      ellipse(L, mx, my, 1.4, 1.2);
    }

    // ---- neblina de visão: escurece de leve o chão que o personagem não vê
    // (telhados e copas ficam fora da neblina; o que está escondido simplesmente não é desenhado)
    if (!overview) {
      const F = this.fctx;
      F.setTransform(1, 0, 0, 1, 0, 0);
      F.globalCompositeOperation = 'source-over';
      F.clearRect(0, 0, this.lowW, this.lowH);
      const night = world.nightFactor;
      F.fillStyle = p.alive ? `rgba(16,20,30,${0.2 + 0.25 * night})` : 'rgba(16,20,30,0.15)';
      F.fillRect(0, 0, this.lowW, this.lowH);
      if (p.alive) {
        F.globalCompositeOperation = 'destination-out';
        F.translate(-left, -top);
        if (this.quality !== 'baixo') F.filter = 'blur(3px)';
        F.fillStyle = '#000';
        F.beginPath();
        const poly = this.visPoly;
        F.moveTo(poly[0], poly[1]);
        for (let i = 2; i < poly.length; i += 2) F.lineTo(poly[i], poly[i + 1]);
        F.closePath();
        F.fill();
        F.filter = 'none';
        for (const bd of world.buildings) {
          const al = this.roofAlpha[bd.id];
          if (al < 0.5) continue;
          const bx = bd.x * TILE;
          const by = bd.y * TILE;
          if (!inView(bx + (bd.w * TILE) / 2, by + (bd.h * TILE) / 2, Math.max(bd.w, bd.h) * TILE)) continue;
          F.fillRect(bx, by - ROOF_RISE, bd.w * TILE, bd.h * TILE + ROOF_RISE);
        }
        F.setTransform(1, 0, 0, 1, 0, 0);
        F.globalCompositeOperation = 'source-over';
      }
      L.setTransform(1, 0, 0, 1, 0, 0);
      L.drawImage(this.fog, 0, 0);
      L.translate(-left, -top);
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

  private styles = new Map<number, ReturnType<typeof facadeStyle>>();

  /** Telhado + fachada (em cache) e, por cima, portas e janelas no estado atual do mapa. */
  private drawBuilding(L: Ctx, world: World, b: World['buildings'][number], alpha: number) {
    const bx = b.x * TILE;
    const by = b.y * TILE;
    L.globalAlpha = alpha * 0.35;
    L.fillStyle = '#10140c';
    L.fillRect(bx + 4, by + b.h * TILE - 3, b.w * TILE, 5); // sombra no chão à frente
    L.globalAlpha = alpha;
    L.drawImage(this.roof(b.id), bx, by - ROOF_RISE);
    let st = this.styles.get(b.id);
    if (!st) this.styles.set(b.id, (st = facadeStyle(b)));
    const row = b.y + b.h - 1;
    const fy = by + b.h * TILE - FACADE_H;
    const map = world.map;
    for (let x = b.x; x < b.x + b.w; x++) {
      const t = map.get(x, row);
      const d = map.doorAt(x, row);
      if (d) drawFacadeDoor(L, x * TILE, fy + 11, d.open, d.broken, st.trim, d.barricades);
      else if (t === T.WINDOW) drawFacadeWindow(L, x * TILE, fy + 6, 'ok', st.trim);
      else if (t === T.WINDOW_BROKEN) drawFacadeWindow(L, x * TILE, fy + 6, 'quebrada', st.trim);
      else if (t === T.WINDOW_BOARDED) drawFacadeWindow(L, x * TILE, fy + 6, 'tabuas', st.trim);
    }
    L.globalAlpha = 1;
  }

  /** Detalhes de chão por tile (determinísticos): o mundo parece vivo mesmo abandonado. */
  private groundDecor(ctx: Ctx, x0: number, y0: number) {
    const map = this.world!.map;
    const isGreen = (t: number) => t === T.GRASS || t === T.GRASS_TALL;
    const hard = (t: number) => t === T.ROCK || t === T.SIDEWALK || t === T.SIDEWALK_WEEDS || t === T.ASPHALT || t === T.ASPHALT_CRACK || t === T.DIRT || t === T.GRAVEL || t === T.PARKING;
    const FLOWERS = ['#e8d070', '#e8e4dc', '#c87aa0', '#8aa0e0', '#e09050'];
    // manchas grandes e suaves de cor (quebram a repetição dos tiles)
    ctx.save();
    ctx.beginPath();
    let any = false;
    for (let y = y0; y < y0 + CHUNK; y++)
      for (let x = x0; x < x0 + CHUNK; x++)
        if (map.inb(x, y) && isGreen(map.get(x, y))) {
          ctx.rect(x * TILE, y * TILE, TILE, TILE);
          any = true;
        }
    if (any) {
      ctx.clip();
      const rr = new RNG(x0 * 7919 + y0 * 104729);
      for (let i = 0; i < 10; i++) {
        const k = rr.next();
        ctx.fillStyle = k < 0.4 ? 'rgba(150,170,80,0.10)' : k < 0.75 ? 'rgba(40,70,30,0.10)' : 'rgba(170,150,90,0.10)';
        ellipse(ctx, x0 * TILE + rr.range(-20, CHUNK * TILE + 20), y0 * TILE + rr.range(-20, CHUNK * TILE + 20), rr.range(18, 48), rr.range(14, 36));
      }
    }
    ctx.restore();
    for (let y = y0; y < y0 + CHUNK; y++)
      for (let x = x0; x < x0 + CHUNK; x++) {
        if (!map.inb(x, y)) continue;
        const t = map.get(x, y);
        const h = hash2(x, y, 41);
        const px = x * TILE;
        const py = y * TILE;
        if (t === T.DIRT || t === T.SAND) {
          // cantos arredondados onde a terra encontra a grama (manchas orgânicas, não quadrados)
          const g = (dx: number, dy: number) => isGreen(map.get(x + dx, y + dy));
          ctx.fillStyle = '#607e3e';
          const R = 6;
          if (g(-1, 0) && g(0, -1)) this.corner(ctx, px, py, R, 0);
          if (g(1, 0) && g(0, -1)) this.corner(ctx, px + TILE, py, R, 1);
          if (g(-1, 0) && g(0, 1)) this.corner(ctx, px, py + TILE, R, 2);
          if (g(1, 0) && g(0, 1)) this.corner(ctx, px + TILE, py + TILE, R, 3);
        } else if (t === T.ROCK && map.get(x, y + 1) !== T.ROCK && !TILES[map.get(x, y + 1)].wall) {
          // face do penhasco virada para o sul
          ctx.fillStyle = '#5e5850';
          ctx.fillRect(px, py + 10, TILE, 6);
          ctx.fillStyle = '#48433c';
          ctx.fillRect(px, py + 14, TILE, 2);
          ctx.fillStyle = '#7a7268';
          for (let i = 0; i < 3; i++) ctx.fillRect(px + ((h >> (i * 3)) & 13), py + 11, 2, 1);
        }
        if (isGreen(t)) {
          const k = h % 100;
          if (k < 7) {
            // flores silvestres
            const c = FLOWERS[(h >> 7) % FLOWERS.length];
            for (let i = 0; i < 4; i++) {
              const fx = px + ((h >> (i * 3)) & 13) + 1;
              const fy2 = py + ((h >> (i * 2 + 5)) & 13) + 1;
              ctx.fillStyle = '#4a7a34';
              ctx.fillRect(fx, fy2 + 1, 1, 1);
              ctx.fillStyle = c;
              ctx.fillRect(fx, fy2, 1, 1);
            }
          } else if (k < 24 || t === T.GRASS_TALL) {
            // tufos de capim
            const n = t === T.GRASS_TALL ? 3 : 1;
            for (let i = 0; i < n; i++) {
              const gx = px + ((h >> (i * 4 + 2)) & 11) + 2;
              const gy = py + ((h >> (i * 3 + 6)) & 9) + 5;
              const dry = ((h >> (i + 9)) & 7) === 0;
              ctx.fillStyle = dry ? '#a89a5a' : '#5e8a3e';
              ctx.fillRect(gx, gy - 3, 1, 3);
              ctx.fillRect(gx + 2, gy - 2, 1, 2);
              ctx.fillStyle = dry ? '#c8b874' : '#7eaa52';
              ctx.fillRect(gx + 1, gy - 4, 1, 4);
            }
          } else if (k < 27) {
            ctx.fillStyle = '#8a867a';
            ctx.fillRect(px + (h & 11) + 2, py + ((h >> 4) & 11) + 2, 2, 1);
            ctx.fillStyle = '#b0aa9a';
            ctx.fillRect(px + (h & 11) + 2, py + ((h >> 4) & 11) + 1, 2, 1);
          }
          // grama invadindo as bordas de calçadas e ruas
          for (const [dx, dy] of [
            [0, 1],
            [0, -1],
            [1, 0],
            [-1, 0],
          ]) {
            if (!hard(map.get(x + dx, y + dy))) continue;
            ctx.fillStyle = '#6a9a44';
            for (let i = 0; i < 6; i++) {
              const o = ((h >> (i * 2)) & 15) as number;
              const d2 = 1 + ((h >> (i + 3)) & 1);
              if (dx === 0) ctx.fillRect(px + o, dy > 0 ? py + TILE : py - d2, 1, d2);
              else ctx.fillRect(dx > 0 ? px + TILE : px - d2, py + o, d2, 1);
            }
          }
        } else if ((t === T.SIDEWALK || t === T.ASPHALT_CRACK || t === T.PARKING) && h % 100 < 9) {
          // mato nascendo nas rachaduras
          const gx = px + (h & 11) + 2;
          const gy = py + ((h >> 4) & 11) + 3;
          ctx.fillStyle = '#5e8a3e';
          ctx.fillRect(gx, gy - 2, 1, 2);
          ctx.fillRect(gx + 2, gy - 1, 1, 1);
          ctx.fillStyle = '#86b058';
          ctx.fillRect(gx + 1, gy - 3, 1, 3);
        }
      }
  }

  /** Preenche um canto de tile com um quarto de círculo "côncavo" (arredonda manchas). */
  private corner(ctx: Ctx, cx: number, cy: number, R: number, q: number) {
    const sx = q === 0 || q === 2 ? 1 : -1;
    const sy = q === 0 || q === 1 ? 1 : -1;
    for (let i = 0; i < R; i++)
      for (let j = 0; j < R; j++) {
        const dx = R - i - 0.5;
        const dy = R - j - 0.5;
        if (dx * dx + dy * dy > R * R) ctx.fillRect(sx > 0 ? cx + i : cx - i - 1, sy > 0 ? cy + j : cy - j - 1, 1, 1);
      }
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
    // dia claro e legível; noite escura mas compreensível (luar azulado), nunca preta
    const amb = Math.min(0.66, 0.02 + 0.6 * night + 0.1 * wx.rain + 0.05 * wx.fog);
    C.fillStyle = `rgba(${Math.round(24 - 10 * night)},${Math.round(30 - 8 * night)},${Math.round(56 + 10 * night)},${amb})`;
    C.fillRect(0, 0, this.lowW, this.lowH);
    C.translate(-left, -top);
    // interiores são mais escuros (luz só pelas janelas e portas)
    for (const b of world.buildings) {
      const a = 1 - this.roofAlpha[b.id];
      if (a < 0.02) continue;
      C.fillStyle = `rgba(10,10,18,${0.18 * a})`;
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
    if (p.alive && !overview) radial(p.x, p.y - 8, (inside >= 0 ? 80 : 70) * (1 - 0.2 * night), inside >= 0 ? 0.6 : 0.35 + 0.3 * night);
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
    g.addColorStop(0, `rgba(255,214,150,${0.12 + 0.4 * Math.max(0, golden)})`);
    g.addColorStop(0.55, 'rgba(160,150,130,0.04)');
    g.addColorStop(1, `rgba(60,80,120,${0.06 + 0.3 * world.nightFactor})`);
    L.fillStyle = g;
    L.fillRect(0, 0, W, H);
    this.weatherFx(world);
    // dessaturação leve (paleta pós-apocalíptica) — dispensável no modo baixo
    if (this.quality !== 'baixo') {
      L.globalCompositeOperation = 'saturation';
      L.fillStyle = 'rgba(128,128,128,0.06)';
      L.fillRect(0, 0, W, H);
    }
    L.globalCompositeOperation = 'source-over';
    // vinheta
    const v = L.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(0,0,0,${0.18 + 0.2 * world.nightFactor})`);
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
      const n = Math.floor(((W * H) / (this.quality === 'baixo' ? 1500 : 600)) * wx.rain);
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
    const base: CharPose = {
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
      drawCharacter(L, {
        ...base,
        zombie: true,
        run: a.ztype === 'rapido' && a.moving && (a.state === 'perseguir' || a.state === 'atacar'),
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
      drawCharacter(L, { ...base, run: Math.hypot(a.vx, a.vy) > 60, backpack: a.state === 'npc' && (a as unknown as { role?: string }).role === 'sobrevivente' ? '#5a5a3a' : null, weapon: wd ? (wd.kind === 'gun' ? 'gun' : 'melee') : isNpc ? 'none' : 'melee', weaponLen: wd?.length ?? 10, weaponColor: '#6a6e70' });
      return;
    }
    if (a instanceof Player) {
      const it = a.weaponItem;
      const d = it ? itemDef(it.defId) : null;
      const wk = d?.weapon?.kind === 'gun' ? 'gun' : d?.weapon?.kind === 'melee' ? 'melee' : 'none';
      const bag = a.item('costas');
      drawCharacter(L, {
        ...base,
        run: a.running && a.moving,
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
