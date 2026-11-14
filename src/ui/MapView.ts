import { RNG } from '../engine/math';
import { T, TILES } from '../world/tiles';
import type { World } from '../world/World';
import { makeCanvas } from '../render/canvas';

/**
 * Mapa de papel encontrado no mundo. Desenhado a partir do próprio mapa do jogo,
 * com aparência de papel envelhecido. NÃO mostra a posição do jogador, zumbis ou aliados.
 */
const PX = 6; // pixels por tile no papel

export type MapKind = 'rasgado' | 'fragmento' | 'completo';

export class MapView {
  private base: HTMLCanvasElement | null = null;
  private tearPath: [number, number][] = [];

  private build(world: World) {
    const map = world.map;
    const W = map.w * PX;
    const H = map.h * PX;
    const [c, ctx] = makeCanvas(W, H);
    ctx.imageSmoothingEnabled = true;
    const r = new RNG(4242);
    // papel
    ctx.fillStyle = '#d6c9a8';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = r.chance(0.5) ? 'rgba(120,100,60,0.05)' : 'rgba(255,250,230,0.06)';
      ctx.fillRect(r.range(0, W), r.range(0, H), r.range(1, 4), r.range(1, 4));
    }
    // ruas e calçadas
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) {
        const t = map.get(x, y);
        let col: string | null = null;
        if (t === T.ASPHALT || t === T.LINE_H || t === T.LINE_V || t === T.ASPHALT_CRACK || t === T.PARKING) col = 'rgba(96,88,72,0.42)';
        else if (t === T.SIDEWALK || t === T.SIDEWALK_WEEDS) col = 'rgba(120,108,86,0.2)';
        else if (t === T.GRAVEL || t === T.DIRT) col = 'rgba(130,110,80,0.14)';
        else if (t === T.HEDGE) col = 'rgba(70,96,60,0.4)';
        else if (t === T.RUBBLE) col = 'rgba(60,50,40,0.55)';
        if (col) {
          ctx.fillStyle = col;
          ctx.fillRect(x * PX, y * PX, PX, PX);
        }
        if (t === T.FENCE_WOOD || t === T.FENCE_METAL) {
          ctx.fillStyle = 'rgba(80,70,55,0.5)';
          ctx.fillRect(x * PX + 2, y * PX + 2, 2, 2);
        }
      }
    // edifícios: hachura + contorno a tinta
    for (const b of world.buildings) {
      const x = b.x * PX;
      const y = b.y * PX;
      const w = b.w * PX;
      const h = b.h * PX;
      ctx.fillStyle = 'rgba(140,120,90,0.35)';
      ctx.fillRect(x, y, w, h);
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
      ctx.strokeStyle = 'rgba(50,40,30,0.85)';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
    // paredes internas leves
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++) {
        if (TILES[map.get(x, y)].wall && map.building[map.idx(x, y)] >= 0) {
          ctx.fillStyle = 'rgba(60,50,38,0.25)';
          ctx.fillRect(x * PX + 1, y * PX + 1, PX - 2, PX - 2);
        }
      }
    // árvores
    for (const t of world.trees) {
      ctx.strokeStyle = 'rgba(70,96,60,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc((t.x / 16) * PX, (t.y / 16) * PX, 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    // rótulos à mão
    ctx.fillStyle = 'rgba(40,32,24,0.9)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const l of world.labels) {
      const big = !l.text.startsWith('Av.') && !l.text.startsWith('R.');
      ctx.font = `italic ${big ? 17 : 13}px Georgia, serif`;
      ctx.save();
      ctx.translate(l.x * PX, l.y * PX);
      if (l.text.startsWith('R.')) ctx.rotate(-Math.PI / 2);
      ctx.fillText(l.text, 0, 0);
      ctx.restore();
    }
    ctx.font = 'bold 15px Georgia, serif';
    ctx.textAlign = 'left';
    ctx.fillText('BAIRRO DAS ACÁCIAS', 18, 22);
    ctx.font = 'italic 11px Georgia, serif';
    ctx.fillText('mapa do comércio local — distribuição gratuita', 18, 38);
    // rosa dos ventos
    ctx.save();
    ctx.translate(W - 40, H - 44);
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
    // dobras, mancha de café e desgaste
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
    ctx.strokeStyle = 'rgba(110,70,30,0.25)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(W * 0.22, H * 0.78, 34, 0.3, 5.6);
    ctx.stroke();
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(90,60,20,0.35)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    this.base = c;

    // linha do rasgo (lado leste está faltando no mapa principal)
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

  /** Desenha o mapa no canvas de destino. */
  render(world: World, target: HTMLCanvasElement, kind: MapKind) {
    if (!this.base) this.build(world);
    const base = this.base!;
    const W = base.width;
    const H = base.height;
    target.width = W + 40;
    target.height = H + 40;
    const ctx = target.getContext('2d')!;
    ctx.clearRect(0, 0, target.width, target.height);
    const clipSide = (west: boolean, dx: number, dy: number) => {
      ctx.beginPath();
      if (west) {
        ctx.moveTo(dx, dy);
        for (const [x, y] of this.tearPath) ctx.lineTo(dx + x, dy + y);
        ctx.lineTo(dx, dy + H);
      } else {
        ctx.moveTo(dx + W, dy);
        for (const [x, y] of this.tearPath) ctx.lineTo(dx + x, dy + y);
        ctx.lineTo(dx + W, dy + H);
      }
      ctx.closePath();
    };
    const piece = (west: boolean, dx: number, dy: number, rot: number) => {
      ctx.save();
      ctx.translate(dx + W / 2, dy + H / 2);
      ctx.rotate(rot);
      ctx.translate(-W / 2, -H / 2);
      clipSide(west, 0, 0);
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = '#d6c9a8';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.clip();
      ctx.drawImage(base, 0, 0);
      // borda rasgada mais clara (fibras do papel)
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
      // fita adesiva remendando
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
  }
}
