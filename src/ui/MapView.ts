import { TILE } from '../config';
import { RNG } from '../engine/math';
import { makeCanvas } from '../render/canvas';
import { T, TILES } from '../world/tiles';
import type { World } from '../world/World';
import { REGION_LABEL, REGION_RECT } from '../world/WorldGen';

/**
 * Mapas de papel encontrados no mundo. Desenhados a partir do próprio mapa do jogo,
 * com aparência de papel envelhecido e o ESTADO físico do papel (rasgado, molhado,
 * queimado, desatualizado, parcialmente ilegível).
 * NÃO mostram a posição do jogador, de zumbis ou de aliados — só o que o jogador marcar à mão.
 */
const PX = 6; // pixels por tile no mapa do bairro

export type MapKind = 'rasgado' | 'fragmento' | 'completo';
export type PaperCond = 'completo' | 'rasgado' | 'molhado' | 'queimado' | 'desatualizado' | 'ilegivel';
export const COND_LABEL: Record<PaperCond, string> = {
  completo: 'completo',
  rasgado: 'rasgado',
  molhado: 'molhado',
  queimado: 'queimado',
  desatualizado: 'desatualizado',
  ilegivel: 'parcialmente ilegível',
};

export type MarkerKind = 'abrigo' | 'estabelecimento' | 'base_militar' | 'estrada' | 'perigo' | 'recurso';
export const MARKER_LABEL: Record<MarkerKind, string> = {
  abrigo: 'Abrigo',
  estabelecimento: 'Estabelecimento',
  base_militar: 'Base militar',
  estrada: 'Estrada',
  perigo: 'Local perigoso',
  recurso: 'Recurso importante',
};
const MARKER_GLYPH: Record<MarkerKind, string> = { abrigo: '⌂', estabelecimento: '▣', base_militar: '✪', estrada: '═', perigo: '✖', recurso: '◆' };

export interface PaperState {
  region: keyof typeof REGION_RECT;
  cond: PaperCond;
  pieces: number;
}

type Rect = { x0: number; y0: number; x1: number; y1: number };
const BAIRRO: Rect = { x0: 0, y0: 0, x1: 127, y1: 95 };

/** Desenha a base de um mapa (papel + geografia) para um retângulo do mundo. */
function drawBase(world: World, rect: Rect, px: number, title: string, sub: string, outdated: boolean, seed: number): HTMLCanvasElement {
  const map = world.map;
  const W = (rect.x1 - rect.x0 + 1) * px;
  const H = (rect.y1 - rect.y0 + 1) * px;
  const [c, ctx] = makeCanvas(W, H);
  const r = new RNG(seed);
  ctx.fillStyle = '#d6c9a8';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < (W * H) / 700; i++) {
    ctx.fillStyle = r.chance(0.5) ? 'rgba(120,100,60,0.05)' : 'rgba(255,250,230,0.06)';
    ctx.fillRect(r.range(0, W), r.range(0, H), r.range(1, 4), r.range(1, 4));
  }
  for (let y = rect.y0; y <= rect.y1; y++)
    for (let x = rect.x0; x <= rect.x1; x++) {
      const t = map.get(x, y);
      let col: string | null = null;
      if (t === T.ASPHALT || t === T.LINE_H || t === T.LINE_V || t === T.ASPHALT_CRACK || t === T.PARKING || t === T.BRIDGE) col = 'rgba(96,88,72,0.42)';
      else if (t === T.RUNWAY) col = 'rgba(80,76,70,0.5)';
      else if (t === T.SIDEWALK || t === T.SIDEWALK_WEEDS) col = 'rgba(120,108,86,0.2)';
      else if (t === T.GRAVEL || t === T.DIRT) col = 'rgba(130,110,80,0.14)';
      else if (t === T.HEDGE) col = 'rgba(70,96,60,0.4)';
      else if (t === T.WATER) col = 'rgba(70,110,130,0.45)';
      else if (t === T.ROCK) col = 'rgba(90,82,70,0.45)';
      else if (t === T.CROP) col = 'rgba(110,130,70,0.25)';
      else if (t === T.SAND) col = 'rgba(190,170,120,0.35)';
      // mapa desatualizado: não sabe dos bloqueios recentes (entulho) — as estradas parecem livres
      else if (t === T.RUBBLE) col = outdated ? 'rgba(96,88,72,0.42)' : 'rgba(60,50,40,0.6)';
      if (col) {
        ctx.fillStyle = col;
        ctx.fillRect((x - rect.x0) * px, (y - rect.y0) * px, px, px);
      }
      if (px >= 4 && (t === T.FENCE_WOOD || t === T.FENCE_METAL)) {
        ctx.fillStyle = 'rgba(80,70,55,0.5)';
        ctx.fillRect((x - rect.x0) * px + px / 3, (y - rect.y0) * px + px / 3, px / 3, px / 3);
      }
    }
  for (const b of world.buildings) {
    if (b.x + b.w < rect.x0 || b.x > rect.x1 || b.y + b.h < rect.y0 || b.y > rect.y1) continue;
    const x = (b.x - rect.x0) * px;
    const y = (b.y - rect.y0) * px;
    const w = b.w * px;
    const h = b.h * px;
    ctx.fillStyle = 'rgba(140,120,90,0.35)';
    ctx.fillRect(x, y, w, h);
    if (px >= 4) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.strokeStyle = 'rgba(70,60,45,0.35)';
      ctx.lineWidth = 1;
      for (let k = -h; k < w; k += 6) {
        ctx.beginPath();
        ctx.moveTo(x + k, y + h);
        ctx.lineTo(x + k + h, y);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(50,40,30,0.85)';
    ctx.lineWidth = px >= 4 ? 1.6 : 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
  if (px >= 5) {
    for (let y = rect.y0; y <= rect.y1; y++)
      for (let x = rect.x0; x <= rect.x1; x++) {
        if (TILES[map.get(x, y)].wall && map.building[map.idx(x, y)] >= 0) {
          ctx.fillStyle = 'rgba(60,50,38,0.25)';
          ctx.fillRect((x - rect.x0) * px + 1, (y - rect.y0) * px + 1, px - 2, px - 2);
        }
      }
  }
  ctx.strokeStyle = 'rgba(70,96,60,0.5)';
  ctx.lineWidth = 1;
  for (const t of world.trees) {
    const tx = t.x / TILE;
    const ty = t.y / TILE;
    if (tx < rect.x0 || tx > rect.x1 || ty < rect.y0 || ty > rect.y1) continue;
    ctx.beginPath();
    ctx.arc((tx - rect.x0) * px, (ty - rect.y0) * px, Math.max(1.5, px * 0.6), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(40,32,24,0.9)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const towns = new Set(world.towns.map((t) => t.name));
  for (const l of world.labels) {
    if (l.x < rect.x0 || l.x > rect.x1 || l.y < rect.y0 || l.y > rect.y1) continue;
    const street = l.text.startsWith('Av.') || l.text.startsWith('R.');
    if (street && px < 5) continue;
    const big = towns.has(l.text);
    ctx.font = `italic ${big ? (px >= 5 ? 19 : 15) : px >= 5 ? (street ? 13 : 15) : 10}px Georgia, serif`;
    ctx.save();
    ctx.translate((l.x - rect.x0) * px, (l.y - rect.y0) * px);
    if (l.text.startsWith('R.')) ctx.rotate(-Math.PI / 2);
    ctx.fillText(l.text, 0, 0);
    ctx.restore();
  }
  ctx.font = 'bold 15px Georgia, serif';
  ctx.textAlign = 'left';
  ctx.fillText(title, 16, 20);
  ctx.font = 'italic 11px Georgia, serif';
  ctx.fillText(sub, 16, 36);
  // rosa dos ventos
  ctx.save();
  ctx.translate(W - 34, H - 40);
  ctx.strokeStyle = 'rgba(40,32,24,0.8)';
  ctx.beginPath();
  ctx.moveTo(0, -18);
  ctx.lineTo(5, 0);
  ctx.lineTo(0, 18);
  ctx.lineTo(-5, 0);
  ctx.closePath();
  ctx.stroke();
  ctx.font = 'bold 12px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', 0, -26);
  ctx.restore();
  // dobras e desgaste
  ctx.strokeStyle = 'rgba(90,70,40,0.22)';
  ctx.lineWidth = 2;
  for (const fx of [W / 3, (2 * W) / 3]) {
    ctx.beginPath();
    ctx.moveTo(fx, 0);
    ctx.lineTo(fx, H);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(90,60,20,0.35)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  return c;
}

export class MapView {
  private bairro: HTMLCanvasElement | null = null;
  private tearPath: [number, number][] = [];
  private cache = new Map<string, HTMLCanvasElement>();
  /** Último mapa desenhado: retângulo e escala (para converter cliques em marcações). */
  view: { rect: Rect; px: number; ox: number; oy: number } | null = null;

  private buildBairro(world: World) {
    this.bairro = drawBase(world, BAIRRO, PX, 'BAIRRO DAS ACÁCIAS', 'mapa do comércio local — distribuição gratuita', false, 4242);
    const H = this.bairro.height;
    const tr = new RNG(77);
    const path: [number, number][] = [];
    let x = 71 * PX;
    for (let y = 0; y <= H; y += 8) {
      x += tr.range(-7, 7);
      x = Math.max(66 * PX, Math.min(76 * PX, x));
      path.push([x, y]);
    }
    this.tearPath = path;
  }

  /** Mapa do bairro (Etapa 1): rasgado / fragmento / remendado. */
  render(world: World, target: HTMLCanvasElement, kind: MapKind, markers: World['player']['markers'] = []) {
    if (!this.bairro) this.buildBairro(world);
    const base = this.bairro!;
    const W = base.width;
    const H = base.height;
    target.width = W + 40;
    target.height = H + 40;
    const ctx = target.getContext('2d')!;
    ctx.clearRect(0, 0, target.width, target.height);
    const clipSide = (west: boolean) => {
      ctx.beginPath();
      if (west) {
        ctx.moveTo(0, 0);
        for (const [x, y] of this.tearPath) ctx.lineTo(x, y);
        ctx.lineTo(0, H);
      } else {
        ctx.moveTo(W, 0);
        for (const [x, y] of this.tearPath) ctx.lineTo(x, y);
        ctx.lineTo(W, H);
      }
      ctx.closePath();
    };
    const piece = (west: boolean, dx: number, dy: number, rot: number) => {
      ctx.save();
      ctx.translate(dx + W / 2, dy + H / 2);
      ctx.rotate(rot);
      ctx.translate(-W / 2, -H / 2);
      clipSide(west);
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = '#d6c9a8';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.clip();
      ctx.drawImage(base, 0, 0);
      ctx.strokeStyle = 'rgba(240,230,205,0.9)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      this.tearPath.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.restore();
    };
    if (kind === 'rasgado') piece(true, 20, 20, -0.006);
    else if (kind === 'fragmento') piece(false, 20, 20, 0.01);
    else {
      piece(true, 20, 20, 0);
      piece(false, 22, 20, 0.004);
      ctx.fillStyle = 'rgba(200,196,170,0.55)';
      for (let i = 0; i < 4; i++) {
        const [x, y] = this.tearPath[Math.floor(((i + 0.5) / 4) * this.tearPath.length)];
        ctx.save();
        ctx.translate(20 + x, 20 + y);
        ctx.rotate(-0.2 + i * 0.13);
        ctx.fillRect(-26, -9, 52, 18);
        ctx.restore();
      }
    }
    this.view = { rect: BAIRRO, px: PX, ox: 20, oy: 20 };
    this.drawMarkers(ctx, markers);
  }

  /** Mapa regional/mundial com o estado do papel e os pedaços que existem. */
  renderPaper(world: World, target: HTMLCanvasElement, st: PaperState, markers: World['player']['markers'] = []) {
    const rect = REGION_RECT[st.region];
    const px = st.region === 'mundo' ? 2 : 3;
    const outdated = st.cond === 'desatualizado';
    const key = `${st.region}|${outdated}`;
    let base = this.cache.get(key);
    if (!base) {
      const title = st.region === 'mundo' ? 'MAPA RODOVIÁRIO DO ESTADO' : `REGIÃO ${REGION_LABEL[st.region as keyof typeof REGION_LABEL].toUpperCase()}`;
      base = drawBase(world, rect, px, title, outdated ? 'edição 2019 — pode estar desatualizado' : 'mapa rodoviário — escala aproximada', outdated, 900 + rect.x0 + rect.y0);
      this.cache.set(key, base);
    }
    const W = base.width;
    const H = base.height;
    target.width = W + 40;
    target.height = H + 40;
    const ctx = target.getContext('2d')!;
    ctx.clearRect(0, 0, target.width, target.height);
    const pieces = st.pieces || 15;
    const q = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ];
    for (let i = 0; i < 4; i++) {
      if (!(pieces & (1 << i))) continue;
      const [qx, qy] = q[i];
      ctx.save();
      ctx.translate(20 + qx * 3 * (pieces === 15 ? 0 : 1), 20 + qy * 3 * (pieces === 15 ? 0 : 1));
      ctx.beginPath();
      // borda irregular quando o mapa está em pedaços
      const jag = pieces === 15 ? 0 : 4;
      const r = new RNG(31 + i);
      const x0 = (qx * W) / 2;
      const y0 = (qy * H) / 2;
      const x1 = x0 + W / 2;
      const y1 = y0 + H / 2;
      ctx.moveTo(x0, y0);
      for (let x = x0; x <= x1; x += 10) ctx.lineTo(x, y0 + (qy ? r.range(-jag, jag) : 0));
      for (let y = y0; y <= y1; y += 10) ctx.lineTo(x1 + (qx ? 0 : r.range(-jag, jag)), y);
      for (let x = x1; x >= x0; x -= 10) ctx.lineTo(x, y1 + (qy ? 0 : r.range(-jag, jag)));
      for (let y = y1; y >= y0; y -= 10) ctx.lineTo(x0 + (qx ? r.range(-jag, jag) : 0), y);
      ctx.closePath();
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#d6c9a8';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.clip();
      ctx.drawImage(base, 0, 0);
      ctx.restore();
    }
    this.applyCondition(ctx, st, W, H);
    if (pieces !== 15) {
      ctx.fillStyle = 'rgba(230,220,190,0.9)';
      ctx.font = 'italic 13px Georgia, serif';
      ctx.textAlign = 'left';
      ctx.fillText(`Faltam ${4 - countBits(pieces)} pedaço(s) deste mapa.`, 24, H + 34);
    }
    this.view = { rect, px, ox: 20, oy: 20 };
    this.drawMarkers(ctx, markers);
  }

  private applyCondition(ctx: CanvasRenderingContext2D, st: PaperState, W: number, H: number) {
    const r = new RNG(st.region.length * 97 + st.cond.length);
    ctx.save();
    ctx.translate(20, 20);
    if (st.cond === 'molhado') {
      // a tinta escorreu: manchas que apagam parte do desenho
      for (let i = 0; i < 9; i++) {
        const x = r.range(0, W);
        const y = r.range(0, H);
        const rad = r.range(30, 90);
        const g = ctx.createRadialGradient(x, y, rad * 0.2, x, y, rad);
        g.addColorStop(0, 'rgba(206,196,170,0.92)');
        g.addColorStop(0.8, 'rgba(200,188,160,0.7)');
        g.addColorStop(1, 'rgba(120,96,60,0.35)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (st.cond === 'queimado') {
      for (let i = 0; i < 6; i++) {
        const x = r.range(0, W);
        const y = r.range(0, H);
        const rad = r.range(25, 70);
        const g = ctx.createRadialGradient(x, y, rad * 0.55, x, y, rad);
        g.addColorStop(0, 'rgba(20,14,10,1)');
        g.addColorStop(0.7, 'rgba(60,35,15,0.9)');
        g.addColorStop(1, 'rgba(120,80,30,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(x, y, rad * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    } else if (st.cond === 'ilegivel') {
      // borrões de lápis/graxa cobrindo nomes
      for (let i = 0; i < 28; i++) {
        ctx.fillStyle = r.chance(0.5) ? 'rgba(70,60,48,0.55)' : 'rgba(206,196,170,0.85)';
        ctx.save();
        ctx.translate(r.range(0, W), r.range(0, H));
        ctx.rotate(r.range(-0.4, 0.4));
        ctx.fillRect(-r.range(20, 60), -7, r.range(40, 120), 14);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  private drawMarkers(ctx: CanvasRenderingContext2D, markers: World['player']['markers']) {
    const v = this.view!;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const m of markers) {
      if (m.x < v.rect.x0 || m.x > v.rect.x1 || m.y < v.rect.y0 || m.y > v.rect.y1) continue;
      const x = v.ox + (m.x - v.rect.x0) * v.px;
      const y = v.oy + (m.y - v.rect.y0) * v.px;
      ctx.font = 'bold 18px Georgia, serif';
      ctx.fillStyle = m.kind === 'perigo' ? 'rgba(150,30,20,0.95)' : 'rgba(30,40,110,0.9)';
      ctx.fillText(MARKER_GLYPH[m.kind as MarkerKind] ?? '•', x, y);
      if (m.note) {
        ctx.font = 'italic 11px Georgia, serif';
        ctx.fillText(m.note, x, y + 14);
      }
    }
    ctx.restore();
  }

  /** Converte um clique no canvas em coordenadas de tile do mundo (para marcar). */
  toTile(cx: number, cy: number): { x: number; y: number } | null {
    const v = this.view;
    if (!v) return null;
    const x = v.rect.x0 + (cx - v.ox) / v.px;
    const y = v.rect.y0 + (cy - v.oy) / v.px;
    if (x < v.rect.x0 || x > v.rect.x1 || y < v.rect.y0 || y > v.rect.y1) return null;
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  }
}

function countBits(n: number) {
  let c = 0;
  for (let i = 0; i < 4; i++) if (n & (1 << i)) c++;
  return c;
}
