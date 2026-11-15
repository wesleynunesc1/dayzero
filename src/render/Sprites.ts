import { TILE } from '../config';
import { hash2, RNG } from '../engine/math';
import { Appearance } from '../entities/Actor';
import { Door } from '../world/TileMap';
import type { Vehicle } from '../entities/Vehicle';
import { Building, Prop, Tree } from '../world/types';
import { Ctx, ellipse, hex, makeCanvas, rgb, roundRect, shade, shadeHex } from './canvas';

/**
 * Desenho procedural de personagens e objetos (assets provisórios originais, consistentes entre si).
 * Tudo é desenhado em coordenadas de mundo (1 unidade = 1 pixel da arte) e ampliado sem suavização.
 */

// ===================================================================== personagens
export interface HumanPose {
  x: number;
  y: number;
  facing: number;
  look: Appearance;
  walk: number;
  moving: boolean;
  crouch?: boolean;
  /** 0..1 — progresso restante do ataque (1 = início). */
  attack?: number;
  weapon?: 'none' | 'melee' | 'gun';
  weaponLen?: number;
  weaponColor?: string;
  zombie?: boolean;
  crawler?: boolean;
  reach?: boolean;
  down?: boolean;
  flash?: number;
  backpack?: string | null;
  seed?: number;
}

function limb(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, w: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function head(ctx: Ctx, look: Appearance, zombie: boolean, hx: number) {
  const skin = look.skin;
  if (look.hairStyle === 2) {
    ctx.fillStyle = skin;
    ellipse(ctx, hx, 0, 2.7, 2.7);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ellipse(ctx, hx - 0.8, 0, 1.6, 2.2);
  } else if (look.hairStyle === 3) {
    ctx.fillStyle = look.hair;
    ellipse(ctx, hx, 0, 2.8, 2.8);
    ctx.fillStyle = shadeHex(look.hair, -0.2);
    roundRect(ctx, hx + 1.4, -2, 2.4, 4, 1);
    ctx.fill();
  } else {
    ctx.fillStyle = look.hair;
    if (look.hairStyle === 1) ellipse(ctx, hx - 1, 0, 3.5, 3.1);
    else ellipse(ctx, hx - 0.2, 0, 2.9, 2.8);
    ctx.fillStyle = skin;
    ellipse(ctx, hx + 1.1, 0, 1.7, 2.2);
  }
  if (zombie) {
    ctx.fillStyle = '#1d1414';
    ctx.fillRect(hx + 1.7, -1.3, 0.8, 0.8);
    ctx.fillRect(hx + 1.7, 0.5, 0.8, 0.8);
  }
}

function torso(ctx: Ctx, look: Appearance, seed: number) {
  ctx.fillStyle = look.shirt;
  ellipse(ctx, 0, 0, 3.3, 5.1);
  const o = look.overlay;
  if (o) {
    ctx.fillStyle = o.color;
    if (o.kind === 'vest') ellipse(ctx, 0.2, 0, 2.6, 4.2);
    else if (o.kind === 'apron') {
      roundRect(ctx, 0.2, -3.2, 3, 6.4, 1);
      ctx.fill();
    } else if (o.kind === 'jacket') {
      ellipse(ctx, 0, 0, 3.4, 5.2);
      ctx.fillStyle = shadeHex(o.color, -0.25);
      ctx.fillRect(1.2, -0.4, 2, 0.8);
    }
  }
  if (look.gore > 0) {
    const r = new RNG(seed);
    const n = Math.round(look.gore * 4);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = r.chance(0.5) ? 'rgba(74,22,18,0.85)' : 'rgba(52,16,14,0.8)';
      ellipse(ctx, r.range(-2.5, 2.5), r.range(-4, 4), r.range(0.7, 1.5), r.range(0.6, 1.3));
    }
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.ellipse(0, 0, 3.3, 5.1, 0, 0, Math.PI * 2);
  ctx.stroke();
}

export const HUMAN_SCALE = 1.3;

export function drawHuman(ctx: Ctx, p: HumanPose) {
  const look = p.look;
  ctx.save();
  ctx.translate(p.x, p.y);
  // escala visual (proporção humana em relação aos tiles de 16 px)
  ctx.scale(HUMAN_SCALE, HUMAN_SCALE);
  // sombra
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ellipse(ctx, 1, 1.6, p.down || p.crawler ? 8 : 5.6, p.down || p.crawler ? 5 : 4.6);
  ctx.rotate(p.facing);
  const seed = p.seed ?? 1;

  if (p.down) {
    drawLying(ctx, look, !!p.zombie, seed);
    if (p.flash) flash(ctx, p.flash, 6);
    ctx.restore();
    return;
  }
  if (p.crawler) {
    const sw = p.moving ? Math.sin(p.walk * 1.4) : 0;
    limb(ctx, -6, 1.6, -11, 2.4 + sw, 2.3, look.pants);
    limb(ctx, -6, -1.6, -11, -2.6 - sw * 0.5, 2.3, look.pants);
    ctx.save();
    ctx.translate(-2, 0);
    ctx.scale(1.25, 0.85);
    torso(ctx, look, seed);
    ctx.restore();
    limb(ctx, 1, 3.4, 6 + sw * 2, 3.6, 1.8, look.skin);
    limb(ctx, 1, -3.4, 6 - sw * 2, -3.6, 1.8, look.skin);
    head(ctx, look, true, 4.2);
    if (p.flash) flash(ctx, p.flash, 6);
    ctx.restore();
    return;
  }

  const sc = p.crouch ? 0.86 : 1;
  ctx.scale(sc, sc);
  const sw = p.moving ? Math.sin(p.walk) : 0;
  // pernas
  if (p.crouch) {
    limb(ctx, 0, 2.2, 3.6, 2.6, 2.4, look.pants);
    limb(ctx, 0, -2.2, 3.2, -2.6, 2.4, look.pants);
  } else if (p.moving) {
    for (const side of [-1, 1]) {
      const off = sw * 3.4 * side;
      limb(ctx, 0, side * 2.1, off, side * 2.1, 2.6, look.pants);
      ctx.fillStyle = look.shoes;
      ellipse(ctx, off + Math.sign(off || 1) * 0.6, side * 2.1, 1.3, 1.1);
    }
  }
  // mochila
  if (p.backpack) {
    ctx.fillStyle = p.backpack;
    roundRect(ctx, -5.4, -3.2, 3.2, 6.4, 1.2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-5.2, -0.3, 2.8, 0.6);
  }
  // braços
  const sleeve = look.overlay?.kind === 'jacket' ? look.overlay.color : look.shirt;
  const atk = p.attack ?? 0;
  if (p.zombie && p.reach) {
    const r = Math.sin(p.walk * 0.8) * 0.8;
    limb(ctx, 0.5, 3.9, 7.5 + r, 2.8, 1.9, look.skin);
    limb(ctx, 0.5, -3.9, 7.5 - r, -2.8, 1.9, look.skin);
    limb(ctx, 0.2, 4.2, 2.5, 3.7, 2.2, sleeve);
    limb(ctx, 0.2, -4.2, 2.5, -3.7, 2.2, sleeve);
    if (atk > 0) {
      ctx.fillStyle = 'rgba(30,10,10,0.5)';
      ellipse(ctx, 9, 0, 1.5, 2.5);
    }
  } else if (p.weapon === 'gun') {
    limb(ctx, 0.2, 4.3, 6.4, 1.0, 1.9, sleeve);
    limb(ctx, 0.2, -4.3, 6.2, -0.4, 1.9, sleeve);
    ctx.fillStyle = look.skin;
    ellipse(ctx, 6.8, 0.3, 1.3, 1.3);
    ctx.fillStyle = '#222324';
    ctx.fillRect(6.6 - atk * 6, -0.7, 4.8, 1.6);
    ctx.fillStyle = '#3a3c3e';
    ctx.fillRect(6.6 - atk * 6, -0.7, 4.8, 0.5);
  } else if (p.weapon === 'melee') {
    // golpe: varredura do lado direito para o esquerdo
    const swing = atk > 0 ? 1.5 - (1 - atk) * 3.2 : 0.9;
    const hx = 3.6 + (atk > 0 ? Math.cos(swing) * 1.8 : 0);
    const hy = atk > 0 ? Math.sin(swing) * 4 : 4.2;
    limb(ctx, 0.2, 4.3, hx, hy, 1.9, sleeve);
    limb(ctx, 0.2, -4.3, 2.4 + sw * -1.5, -4.8, 1.9, sleeve);
    ctx.fillStyle = look.skin;
    ellipse(ctx, 2.6 + sw * -1.5, -4.8, 1.1, 1.1);
    const L = p.weaponLen ?? 9;
    const wa = atk > 0 ? swing - 0.9 : -0.35;
    limb(ctx, hx, hy, hx + Math.cos(wa) * L, hy + Math.sin(wa) * L, 1.6, p.weaponColor ?? '#6b5139');
    ctx.fillStyle = look.skin;
    ellipse(ctx, hx, hy, 1.2, 1.2);
  } else {
    // mãos livres (soco = braço direito estendido)
    const punch = atk > 0 ? Math.sin(atk * Math.PI) : 0;
    const rx = punch > 0 ? 2 + punch * 6 : -sw * 2.2 + 0.6;
    const ry = punch > 0 ? 3.2 - punch * 2 : 4.6;
    limb(ctx, 0, 4.3, rx, ry, 2, sleeve);
    ctx.fillStyle = look.skin;
    ellipse(ctx, rx + 0.6, ry, 1.15, 1.15);
    const lx = sw * 2.2 + 0.6;
    limb(ctx, 0, -4.3, lx, -4.6, 2, sleeve);
    ctx.fillStyle = look.skin;
    ellipse(ctx, lx + 0.6, -4.6, 1.15, 1.15);
  }
  torso(ctx, look, seed);
  head(ctx, look, !!p.zombie, 0.6);
  if (p.flash) flash(ctx, p.flash, 5.5);
  ctx.restore();
}

function flash(ctx: Ctx, f: number, r: number) {
  ctx.fillStyle = `rgba(255,230,220,${Math.min(0.75, f * 4)})`;
  ellipse(ctx, 0, 0, r, r);
}

function drawLying(ctx: Ctx, look: Appearance, zombie: boolean, seed: number) {
  // corpo estendido ao longo do eixo X (cabeça à frente)
  limb(ctx, -4, 1.8, -11, 2.6, 2.6, look.pants);
  limb(ctx, -4, -1.8, -11, -1.6, 2.6, look.pants);
  ctx.fillStyle = look.shoes;
  ellipse(ctx, -11.6, 2.6, 1.3, 1.2);
  ellipse(ctx, -11.6, -1.6, 1.3, 1.2);
  limb(ctx, 2, 4.2, -1, 7.5, 1.8, look.skin);
  limb(ctx, 2, -4.2, 5, -7, 1.8, look.skin);
  ctx.save();
  ctx.scale(1.2, 0.95);
  torso(ctx, look, seed);
  ctx.restore();
  ctx.save();
  ctx.translate(6.2, 0);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = look.hairStyle === 2 ? look.skin : look.hair;
  ellipse(ctx, 0, 0, 2.7, 2.7);
  ctx.fillStyle = look.skin;
  ellipse(ctx, 0, 0.6, 1.9, 1.6);
  if (zombie) {
    ctx.fillStyle = '#1d1414';
    ctx.fillRect(-1, 0.4, 0.7, 0.7);
    ctx.fillRect(0.5, 0.4, 0.7, 0.7);
  }
  ctx.restore();
}

// ===================================================================== árvores
export function drawCanopy(ctx: Ctx, t: Tree, alpha: number, time: number) {
  const r = new RNG(t.variant * 977 + Math.round(t.x));
  const greens = [
    [56, 70, 44],
    [64, 78, 48],
    [48, 61, 40],
    [72, 82, 52],
  ];
  if (t.variant === 3) greens[3] = [96, 88, 56]; // folhagem seca
  const sway = Math.sin(time * 0.8 + t.x * 0.05) * 0.6;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let i = 0; i < 9; i++) {
    const a = r.range(0, Math.PI * 2);
    const d = r.range(0, t.r * 0.55);
    const rr = r.range(t.r * 0.35, t.r * 0.6);
    const g = greens[i % greens.length];
    ctx.fillStyle = rgb(shade(g as [number, number, number], -0.15));
    ellipse(ctx, t.x + Math.cos(a) * d + sway, t.y + Math.sin(a) * d + 1, rr, rr);
  }
  for (let i = 0; i < 9; i++) {
    const a = r.range(0, Math.PI * 2);
    const d = r.range(0, t.r * 0.5);
    const rr = r.range(t.r * 0.25, t.r * 0.45);
    const g = greens[(i + 1) % greens.length];
    ctx.fillStyle = rgb(g as [number, number, number]);
    ellipse(ctx, t.x + Math.cos(a) * d - 1 + sway, t.y + Math.sin(a) * d - 1.5, rr, rr);
  }
  // luz vinda do leste (amanhecer)
  ctx.fillStyle = 'rgba(170,150,90,0.12)';
  ellipse(ctx, t.x + t.r * 0.3 + sway, t.y - t.r * 0.25, t.r * 0.45, t.r * 0.4);
  ctx.restore();
}

// ===================================================================== portas
export function drawDoor(ctx: Ctx, d: Door) {
  const x = d.x * TILE;
  const y = d.y * TILE;
  const wood = d.label.includes('vidro') ? '#7d97a3' : d.label.includes('Portão') ? '#6a6e70' : d.label.includes('arsenal') || d.label.includes('delegacia') ? '#4d5257' : '#6b4f37';
  if (d.broken) {
    ctx.fillStyle = 'rgba(70,52,36,0.9)';
    if (d.vertical) {
      ctx.fillRect(x + 2, y + 2, 3, 7);
      ctx.fillRect(x + 9, y + 9, 4, 3);
    } else {
      ctx.fillRect(x + 1, y + 10, 7, 3);
      ctx.fillRect(x + 10, y + 3, 3, 4);
    }
    return;
  }
  const t = d.anim; // 0 fechada → 1 aberta (gira 90°)
  ctx.save();
  if (d.vertical) {
    ctx.translate(x + 8, y);
    ctx.rotate(-t * (Math.PI / 2));
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(-1, 1, 4, TILE);
    ctx.fillStyle = wood;
    ctx.fillRect(-1.5, 0, 3, TILE);
    ctx.fillStyle = shadeHex(wood, 0.15);
    ctx.fillRect(-1.5, 0, 1, TILE);
    ctx.fillStyle = '#b8a77a';
    ctx.fillRect(0.5, TILE - 4, 1, 1.5);
  } else {
    ctx.translate(x, y + 8);
    ctx.rotate(t * (Math.PI / 2));
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(1, -1, TILE, 4);
    ctx.fillStyle = wood;
    ctx.fillRect(0, -1.5, TILE, 3);
    ctx.fillStyle = shadeHex(wood, 0.15);
    ctx.fillRect(0, -1.5, TILE, 1);
    ctx.fillStyle = '#b8a77a';
    ctx.fillRect(TILE - 4, 0.5, 1.5, 1);
  }
  ctx.restore();
  if (d.barricades > 0) {
    // tábuas pregadas por cima da porta
    ctx.save();
    ctx.translate(x + 8, y + 8);
    if (d.vertical) ctx.rotate(Math.PI / 2);
    for (let i = 0; i < d.barricades * 2; i++) {
      ctx.save();
      ctx.rotate(i % 2 ? -0.35 : 0.35);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(-10, -2 + (i - 1) * 2.5 + 1, 20, 3.2);
      ctx.fillStyle = i % 2 ? '#7a6040' : '#86694a';
      ctx.fillRect(-10, -2 + (i - 1) * 2.5, 20, 3.2);
      ctx.fillStyle = '#4a3a26';
      ctx.fillRect(-8, -1 + (i - 1) * 2.5, 1, 1);
      ctx.fillRect(7, -1 + (i - 1) * 2.5, 1, 1);
      ctx.restore();
    }
    ctx.restore();
  }
}

// ===================================================================== veículo dirigível
/** Caminhonete vista de cima (cabine + caçamba). */
export function drawVehicle(ctx: Ctx, v: Vehicle, night: number) {
  const L = v.def.length;
  const W = v.def.width;
  ctx.save();
  ctx.translate(v.x, v.y);
  ctx.rotate(v.angle);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, -L / 2 + 3, -W / 2 + 3, L, W, 5);
  ctx.fill();
  // rodas
  ctx.fillStyle = '#161617';
  for (const wx of [-L * 0.3, L * 0.28]) {
    const st = wx > 0 ? v.steer * 0.35 : 0;
    for (const sy of [-1, 1]) {
      ctx.save();
      ctx.translate(wx, sy * (W / 2 - 1));
      ctx.rotate(st);
      ctx.fillRect(-4.5, -2, 9, 4);
      ctx.restore();
    }
  }
  const body = v.hp <= 0 ? '#3a3632' : v.def.color;
  ctx.fillStyle = body;
  roundRect(ctx, -L / 2, -W / 2 + 2, L, W - 4, 5);
  ctx.fill();
  // caçamba (traseira)
  ctx.fillStyle = shadeHex(body, -0.35);
  ctx.fillRect(-L / 2 + 3, -W / 2 + 5, L * 0.42, W - 10);
  ctx.strokeStyle = shadeHex(body, -0.5);
  ctx.lineWidth = 0.8;
  for (let i = 1; i < 4; i++) {
    const yy = -W / 2 + 5 + ((W - 10) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(-L / 2 + 4, yy);
    ctx.lineTo(-L / 2 + 3 + L * 0.42, yy);
    ctx.stroke();
  }
  // cabine
  ctx.fillStyle = shadeHex(body, 0.08);
  roundRect(ctx, -L * 0.05, -W / 2 + 3.5, L * 0.32, W - 7, 3);
  ctx.fill();
  ctx.fillStyle = '#34444c';
  ctx.fillRect(L * 0.24, -W / 2 + 5, 4, W - 10);
  ctx.fillRect(-L * 0.05 - 1, -W / 2 + 5.5, 2.5, W - 11);
  // capô e faróis
  ctx.fillStyle = shadeHex(body, -0.08);
  ctx.fillRect(L * 0.3, -W / 2 + 4, L * 0.17, W - 8);
  ctx.fillStyle = v.engineOn ? 'rgba(255,240,190,1)' : '#c8c0a0';
  ctx.fillRect(L / 2 - 2, -W / 2 + 4, 1.8, 3);
  ctx.fillRect(L / 2 - 2, W / 2 - 7, 1.8, 3);
  ctx.fillStyle = v.engineOn && v.throttle < 0 ? '#e04030' : '#6a2a24';
  ctx.fillRect(-L / 2, -W / 2 + 4, 1.5, 3);
  ctx.fillRect(-L / 2, W / 2 - 7, 1.5, 3);
  // ferrugem
  const r = new RNG(7);
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = 'rgba(110,70,40,0.55)';
    ctx.fillRect(r.range(-L / 2 + 2, L / 2 - 4), r.range(-W / 2 + 3, W / 2 - 5), r.range(1, 3), 1);
  }
  if (v.engineOn) {
    // vibração/fumaça do escapamento
    ctx.fillStyle = 'rgba(120,120,120,0.25)';
    ellipse(ctx, -L / 2 - 3 - Math.random() * 3, W / 2 - 6, 2.5, 2);
  }
  ctx.restore();
  if (v.engineOn && night > 0.2) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const hx = v.x + Math.cos(v.angle) * (L / 2);
    const hy = v.y + Math.sin(v.angle) * (L / 2);
    const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 120);
    g.addColorStop(0, `rgba(255,236,190,${0.25 * night})`);
    g.addColorStop(1, 'rgba(255,236,190,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.arc(hx, hy, 120, v.angle - 0.4, v.angle + 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// ===================================================================== telhados
export function makeRoof(b: Building): HTMLCanvasElement {
  const W = b.w * TILE;
  const H = b.h * TILE;
  const [c, ctx] = makeCanvas(W + 2, H + 2);
  const base = hex(b.roof);
  const r = new RNG(b.id * 31 + 7);
  if (b.roofKind === 'gable') {
    const horizontalRidge = W >= H;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const half = horizontalRidge ? (y < H / 2 ? 0 : 1) : x < W / 2 ? 1 : 0;
        const along = horizontalRidge ? y : x;
        const row = along % 4 === 0;
        const seam = (horizontalRidge ? x + ((along >> 2) & 1) * 3 : y + ((along >> 2) & 1) * 3) % 6 === 0;
        let k = half ? -0.18 : 0.06;
        if (row) k -= 0.12;
        else if (seam) k -= 0.06;
        k += (r.next() - 0.5) * 0.06;
        ctx.fillStyle = rgb(shade(base, k));
        ctx.fillRect(x, y, 1, 1);
      }
    // cumeeira
    ctx.fillStyle = rgb(shade(base, 0.18));
    if (horizontalRidge) ctx.fillRect(0, Math.floor(H / 2) - 1, W, 2);
    else ctx.fillRect(Math.floor(W / 2) - 1, 0, 2, H);
    // telhas faltando e musgo
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = r.chance(0.5) ? 'rgba(30,26,24,0.8)' : 'rgba(76,92,58,0.7)';
      ctx.fillRect(r.int(4, W - 8), r.int(4, H - 8), r.int(2, 5), r.int(2, 4));
    }
  } else {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const k = (r.next() - 0.5) * 0.08;
        ctx.fillStyle = rgb(shade(base, k));
        ctx.fillRect(x, y, 1, 1);
      }
    // platibanda
    ctx.fillStyle = rgb(shade(base, 0.15));
    ctx.fillRect(0, 0, W, 3);
    ctx.fillRect(0, 0, 3, H);
    ctx.fillStyle = rgb(shade(base, -0.25));
    ctx.fillRect(0, H - 3, W, 3);
    ctx.fillRect(W - 3, 0, 3, H);
    // manchas de água
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = 'rgba(40,44,46,0.25)';
      ellipse(ctx, r.range(10, W - 10), r.range(10, H - 10), r.range(6, 16), r.range(4, 10));
    }
    // condensadoras / caixas d'água
    for (let i = 0; i < Math.max(2, Math.floor((W * H) / 9000)); i++) {
      const x = r.int(8, W - 26);
      const y = r.int(8, H - 22);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x + 2, y + 3, 16, 12);
      ctx.fillStyle = '#7e8180';
      ctx.fillRect(x, y, 16, 12);
      ctx.fillStyle = '#5e6160';
      ellipse(ctx, x + 8, y + 6, 4, 4);
      ctx.fillStyle = '#4a4c4b';
      ellipse(ctx, x + 8, y + 6, 1.5, 1.5);
    }
    if (b.kind === 'delegacia') {
      ctx.strokeStyle = '#3a3c3e';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(W - 30, 20);
      ctx.lineTo(W - 18, 8);
      ctx.stroke();
      ctx.fillStyle = '#3a3c3e';
      ellipse(ctx, W - 30, 20, 2, 2);
    }
  }
  ctx.strokeStyle = rgb(shade(base, -0.35));
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  return c;
}

// ===================================================================== objetos estáticos
function shadowRect(ctx: Ctx, x: number, y: number, w: number, h: number, r = 2) {
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  roundRect(ctx, x + 2, y + 2.5, w, h, r);
  ctx.fill();
}

function box(ctx: Ctx, x: number, y: number, w: number, h: number, color: string, r = 1.5) {
  ctx.fillStyle = color;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.fillStyle = shadeHex(color, 0.12);
  ctx.fillRect(x + 1, y + 0.5, w - 2, 1);
  ctx.fillStyle = shadeHex(color, -0.3);
  ctx.fillRect(x + 0.5, y + h - 1.2, w - 1, 1);
}

const PRODUCT = ['#8a5a3a', '#5a6a7a', '#7a7a5a', '#6a4a4a', '#5a7a5a', '#8a7a5a', '#7a6a8a', '#9a8a6a'];

export function drawProp(ctx: Ctx, p: Prop) {
  const x = p.x * TILE;
  const y = p.y * TILE;
  const w = p.w * TILE;
  const h = p.h * TILE;
  const r = new RNG(hash2(p.x, p.y, 3));
  switch (p.kind) {
    case 'sofa': {
      const c = ['#5c4a42', '#4b5560', '#5f5a46', '#6a4842'][p.variant];
      shadowRect(ctx, x + 1, y + 1, w - 2, h - 2, 3);
      box(ctx, x + 1, y + 1, w - 2, h - 2, c, 3);
      ctx.fillStyle = shadeHex(c, -0.2);
      if (h > w) {
        ctx.fillRect(x + 1, y + 1, 4, h - 2);
        for (let i = 1; i < p.h; i++) ctx.fillRect(x + 6, y + i * TILE - 0.5, w - 8, 1);
      } else {
        ctx.fillRect(x + 1, y + 1, w - 2, 4);
      }
      ctx.fillStyle = 'rgba(40,30,25,0.5)';
      ctx.fillRect(x + 8, y + h / 2, 3, 2);
      break;
    }
    case 'table_small':
    case 'table': {
      shadowRect(ctx, x + 2, y + 2, w - 4, h - 4);
      box(ctx, x + 2, y + 2, w - 4, h - 4, '#6e5640', 1);
      ctx.fillStyle = '#c8c2b4';
      ellipse(ctx, x + w / 2 - 2, y + h / 2, 1.5, 1.5);
      if (p.kind === 'table') {
        ctx.fillStyle = '#4e3c2c';
        ctx.fillRect(x + 4, y - 2, 4, 3);
        ctx.fillRect(x + w - 8, y + h - 1, 4, 3);
      }
      break;
    }
    case 'shelf_home': {
      shadowRect(ctx, x, y + 1, w, h - 3);
      box(ctx, x, y + 1, w, h - 4, '#4f3c2c', 0.5);
      for (let i = 2; i < w - 2; i += 2) {
        ctx.fillStyle = r.pick(PRODUCT);
        ctx.fillRect(x + i, y + 3, 1.6, h - 9 + r.int(-1, 1));
      }
      break;
    }
    case 'plant': {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ellipse(ctx, x + 9, y + 10, 5, 4);
      ctx.fillStyle = '#7a4a36';
      ellipse(ctx, x + 8, y + 8, 4.5, 4.5);
      ctx.fillStyle = '#5a6a3a';
      for (let i = 0; i < 6; i++) ellipse(ctx, x + 8 + r.range(-4, 4), y + 8 + r.range(-4, 4), 2.3, 1.6);
      ctx.fillStyle = '#7a6a3a';
      ellipse(ctx, x + 10, y + 6, 1.5, 1.2);
      break;
    }
    case 'counter_cab':
    case 'sink':
    case 'stove': {
      shadowRect(ctx, x, y, w, h - 2, 0.5);
      box(ctx, x, y, w, h - 3, '#8d8a80', 0.5);
      ctx.fillStyle = '#5e4a38';
      ctx.fillRect(x, y + h - 5, w, 2);
      if (p.kind === 'stove') {
        box(ctx, x + 1, y + 1, w - 2, h - 6, '#a9a69c', 0.5);
        ctx.fillStyle = '#2e2e30';
        for (const [a, b] of [
          [4, 4],
          [11, 4],
          [4, 9],
          [11, 9],
        ])
          ellipse(ctx, x + a, y + b, 2, 2);
      } else if (p.kind === 'sink') {
        ctx.fillStyle = '#6f7c80';
        roundRect(ctx, x + 3, y + 3, w - 6, h - 9, 2);
        ctx.fill();
        ctx.fillStyle = '#9aa6a8';
        ctx.fillRect(x + w / 2 - 0.5, y + 1, 1, 3);
      } else {
        ctx.fillStyle = '#6a675e';
        for (let i = TILE; i < w; i += TILE) ctx.fillRect(x + i, y, 0.6, h - 5);
        ctx.fillStyle = '#c0b8a0';
        for (let i = 0; i < w; i += TILE) ctx.fillRect(x + i + 7, y + h - 6, 2, 0.8);
      }
      break;
    }
    case 'fridge':
    case 'fridge_v': {
      shadowRect(ctx, x + 1, y, w - 2, h - 1, 1);
      if (p.kind === 'fridge') {
        box(ctx, x + 1, y, w - 2, h - 2, '#b5b2a8', 1);
        ctx.fillStyle = '#8a877e';
        ctx.fillRect(x + 1, y + 6, w - 2, 0.7);
        ctx.fillRect(x + w - 4, y + 2, 1, 3);
      } else {
        box(ctx, x + 1, y, w - 2, h - 1, '#7c8386', 1);
        for (let i = 0; i < p.h; i++) {
          ctx.fillStyle = '#5d7480';
          ctx.fillRect(x + 3, y + i * TILE + 2, w - 6, TILE - 4);
          ctx.fillStyle = r.pick(['#7a9aaa', '#8a7a5a', '#5a6a8a', '#9a9aa0']);
          ctx.fillRect(x + 4, y + i * TILE + 4, 2, 7);
          ctx.fillRect(x + 8, y + i * TILE + 5, 2, 6);
        }
      }
      break;
    }
    case 'bed': {
      shadowRect(ctx, x + 1, y + 1, w - 2, h - 2, 2);
      box(ctx, x + 1, y + 1, w - 2, h - 2, '#5a4330', 2);
      ctx.fillStyle = '#a7a093';
      roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 2);
      ctx.fill();
      ctx.fillStyle = '#c2bdb2';
      roundRect(ctx, x + 4, y + 3, w - 8, 6, 2);
      ctx.fill();
      ctx.fillStyle = ['#5d6b7a', '#7a5d5d', '#5d7a62', '#6e6a55'][p.variant];
      roundRect(ctx, x + 2, y + 11, w - 4, h - 13, 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(x + 2, y + 18, w - 4, 1);
      break;
    }
    case 'wardrobe':
    case 'dresser': {
      const c = p.kind === 'wardrobe' ? '#5a4330' : '#6b5038';
      shadowRect(ctx, x, y, w, h - 2, 0.5);
      box(ctx, x, y, w, h - 3, c, 0.5);
      ctx.fillStyle = shadeHex(c, -0.3);
      if (p.kind === 'wardrobe') {
        ctx.fillRect(x + w / 2 - 0.4, y + 1, 0.8, h - 5);
        ctx.fillStyle = '#b8a77a';
        ctx.fillRect(x + w / 2 - 2.5, y + h - 8, 1, 2);
        ctx.fillRect(x + w / 2 + 1.5, y + h - 8, 1, 2);
      } else {
        ctx.fillRect(x + 1, y + 5, w - 2, 0.7);
        ctx.fillRect(x + 1, y + 9, w - 2, 0.7);
        ctx.fillStyle = '#b8a77a';
        ctx.fillRect(x + w / 2 - 1, y + 3, 2, 0.8);
        ctx.fillRect(x + w / 2 - 1, y + 7, 2, 0.8);
      }
      break;
    }
    case 'toilet': {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ellipse(ctx, x + 9, y + 10, 5, 5);
      ctx.fillStyle = '#c8c8c0';
      ctx.fillRect(x + 3, y + 1, 10, 4);
      ellipse(ctx, x + 8, y + 9, 4, 5);
      ctx.fillStyle = '#8a9a9e';
      ellipse(ctx, x + 8, y + 9.5, 2.3, 3);
      break;
    }
    case 'bathtub': {
      shadowRect(ctx, x, y + 1, w, h - 2, 3);
      box(ctx, x, y + 1, w, h - 2, '#c4c4bc', 3);
      ctx.fillStyle = '#8fa0a6';
      roundRect(ctx, x + 2, y + 3, w - 4, h - 6, 3);
      ctx.fill();
      break;
    }
    case 'bath_cab':
    case 'firstaid': {
      shadowRect(ctx, x + 2, y, w - 4, 8);
      box(ctx, x + 2, y, w - 4, 8, p.kind === 'firstaid' ? '#c8c4b8' : '#9a968c', 0.5);
      if (p.kind === 'firstaid') {
        ctx.fillStyle = '#a03a30';
        ctx.fillRect(x + 7, y + 1.5, 2, 5);
        ctx.fillRect(x + 5.5, y + 3, 5, 2);
      } else {
        ctx.fillStyle = '#b8c4c8';
        ctx.fillRect(x + 4, y + 1.5, w - 8, 4);
      }
      break;
    }
    case 'gondola':
    case 'gondola_v': {
      const vert = p.kind === 'gondola_v';
      shadowRect(ctx, x + (vert ? 2 : 0), y + (vert ? 0 : 2), vert ? w - 4 : w, vert ? h : h - 4, 1);
      box(ctx, x + (vert ? 2 : 0), y + (vert ? 0 : 2), vert ? w - 4 : w, vert ? h : h - 4, '#6f7470', 1);
      const n = vert ? h : w;
      for (let i = 2; i < n - 2; i += 3) {
        if (r.chance(0.35)) continue; // saqueado
        ctx.fillStyle = r.pick(PRODUCT);
        if (vert) ctx.fillRect(x + 4, y + i, w - 8, 2);
        else ctx.fillRect(x + i, y + 4, 2, h - 8);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      if (vert) ctx.fillRect(x + w / 2 - 0.3, y + 1, 0.6, h - 2);
      else ctx.fillRect(x + 1, y + h / 2 - 0.3, w - 2, 0.6);
      break;
    }
    case 'counter':
    case 'register': {
      shadowRect(ctx, x, y + 2, w, h - 4, 1);
      box(ctx, x, y + 2, w, h - 4, '#5a4a3a', 1);
      ctx.fillStyle = '#7a6a56';
      ctx.fillRect(x, y + 2, w, 2);
      if (p.kind === 'register') {
        box(ctx, x + 3, y + 4, 10, 7, '#3a3a3c', 1);
        ctx.fillStyle = '#5a7a6a';
        ctx.fillRect(x + 5, y + 5, 6, 2);
      }
      break;
    }
    case 'cart': {
      ctx.strokeStyle = '#8a8c88';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(x + 3.5, y + 2.5, 9, 11);
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(x + 4, y + 5 + i * 2.5);
        ctx.lineTo(x + 12, y + 5 + i * 2.5);
        ctx.stroke();
      }
      break;
    }
    case 'rack':
    case 'rack_v': {
      shadowRect(ctx, x, y, w, h, 0.5);
      box(ctx, x, y, w, h, '#555a5c', 0.5);
      const vert = p.kind === 'rack_v';
      const n = vert ? p.h : p.w;
      for (let i = 0; i < n; i++) {
        if (r.chance(0.25)) continue;
        const bx = vert ? x + 2 : x + i * TILE + 2;
        const by = vert ? y + i * TILE + 2 : y + 2;
        ctx.fillStyle = r.chance(0.6) ? '#8a7350' : '#7a6a4a';
        ctx.fillRect(bx, by, TILE - 4, TILE - 4);
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(bx, by + (TILE - 4) / 2, TILE - 4, 0.7);
      }
      break;
    }
    case 'crate': {
      shadowRect(ctx, x + 1, y + 1, w - 2, h - 2, 0.5);
      for (let i = 0; i < p.w; i++)
        for (let j = 0; j < p.h; j++) {
          if (i + j === 2 && r.chance(0.5)) continue;
          const bx = x + i * TILE + 1;
          const by = y + j * TILE + 1;
          box(ctx, bx, by, TILE - 2, TILE - 2, '#7a6040', 0.5);
          ctx.strokeStyle = '#5a4428';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(bx + 1, by + 1);
          ctx.lineTo(bx + TILE - 3, by + TILE - 3);
          ctx.moveTo(bx + TILE - 3, by + 1);
          ctx.lineTo(bx + 1, by + TILE - 3);
          ctx.stroke();
        }
      break;
    }
    case 'pallet': {
      ctx.fillStyle = '#6d5a3d';
      for (let i = 1; i < w; i += 4) ctx.fillRect(x + i, y + 1, 2.5, h - 2);
      ctx.fillStyle = '#5a4a32';
      ctx.fillRect(x + 1, y + 2, w - 2, 1);
      ctx.fillRect(x + 1, y + h - 3, w - 2, 1);
      break;
    }
    case 'dumpster': {
      shadowRect(ctx, x, y + 1, w, h - 1, 1);
      box(ctx, x, y + 1, w, h - 2, '#3d4f42', 1);
      ctx.fillStyle = '#2f3d33';
      ctx.fillRect(x + w / 2 - 0.4, y + 2, 0.8, h - 4);
      ctx.fillStyle = '#6a4a32';
      for (let i = 0; i < 4; i++) ctx.fillRect(x + r.int(2, w - 4), y + r.int(3, h - 4), 2, 1);
      break;
    }
    case 'workbench': {
      shadowRect(ctx, x, y, w, h - 2, 0.5);
      box(ctx, x, y, w, h - 3, '#7a6040', 0.5);
      ctx.fillStyle = '#4a4c4e';
      ctx.fillRect(x + 6, y + 4, 8, 2);
      ctx.fillRect(x + 22, y + 3, 2, 7);
      ctx.fillStyle = '#7a3530';
      ctx.fillRect(x + 40, y + 4, 6, 4);
      break;
    }
    case 'toolbox': {
      shadowRect(ctx, x + 3, y + 4, 10, 8, 1);
      box(ctx, x + 3, y + 4, 10, 8, '#7a3530', 1);
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(x + 6, y + 3, 4, 1.5);
      break;
    }
    case 'desk': {
      shadowRect(ctx, x, y + 1, w, h - 3, 1);
      box(ctx, x, y + 1, w, h - 4, '#5e4a38', 1);
      ctx.fillStyle = '#c8c2b4';
      ctx.fillRect(x + 4, y + 4, 5, 4);
      ctx.fillRect(x + 6, y + 3, 4, 4);
      ctx.fillStyle = '#2a2c2e';
      ctx.fillRect(x + w - 12, y + 3, 7, 5);
      break;
    }
    case 'filing': {
      shadowRect(ctx, x + 2, y, w - 4, h - 1, 0.5);
      box(ctx, x + 2, y, w - 4, h - 2, '#6a6e70', 0.5);
      ctx.fillStyle = '#4a4e50';
      for (let i = 4; i < h - 2; i += 4) ctx.fillRect(x + 3, y + i, w - 6, 0.6);
      break;
    }
    case 'locker':
    case 'locker_tall':
    case 'locker_wide': {
      shadowRect(ctx, x + 1, y, w - 2, h - 2, 0.5);
      box(ctx, x + 1, y, w - 2, h - 3, '#56616b', 0.5);
      ctx.fillStyle = '#3e4850';
      for (let i = 0; i < p.w; i++) {
        ctx.fillRect(x + i * TILE + 4, y + 3, 7, 0.6);
        ctx.fillRect(x + i * TILE + 4, y + 5, 7, 0.6);
        ctx.fillRect(x + i * TILE + 1, y, 0.6, h - 3);
      }
      break;
    }
    case 'gun_cab': {
      shadowRect(ctx, x + 1, y, w - 2, h, 0.5);
      box(ctx, x + 1, y, w - 2, h - 1, '#3e4448', 0.5);
      ctx.fillStyle = '#2a2e30';
      for (let i = 3; i < h - 3; i += 5) ctx.fillRect(x + 3, y + i, w - 6, 2);
      ctx.fillStyle = '#9a8a5a';
      ctx.fillRect(x + 4, y + h / 2, 1.5, 2);
      break;
    }
    case 'bench':
    case 'bus_stop': {
      if (p.kind === 'bus_stop') {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x + 2, y + 2, w, h);
        ctx.fillStyle = 'rgba(70,80,84,0.85)';
        ctx.fillRect(x, y - 4, w, 8);
        ctx.fillStyle = '#8a9a9e';
        ctx.fillRect(x, y - 4, w, 1);
      }
      ctx.fillStyle = '#6d5a3d';
      for (let i = 0; i < 3; i++) ctx.fillRect(x + 1, y + 5 + i * 2.5, w - 2, 1.6);
      ctx.fillStyle = '#3a3c3e';
      ctx.fillRect(x + 2, y + 4, 1, 8);
      ctx.fillRect(x + w - 3, y + 4, 1, 8);
      break;
    }
    case 'sandbags': {
      for (let i = 0; i < p.w * 2; i++) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ellipse(ctx, x + 5 + i * 8 + 1, y + 9, 5, 4);
        ctx.fillStyle = i % 2 ? '#8a7d5c' : '#7d7154';
        ellipse(ctx, x + 5 + i * 8, y + 8, 5, 3.6);
      }
      break;
    }
    case 'barrier': {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x + 2, y + 7, w, 5);
      for (let i = 0; i < w; i += 4) {
        ctx.fillStyle = (i / 4) % 2 ? '#b8b0a0' : '#8a3a30';
        ctx.fillRect(x + i, y + 5, 4, 5);
      }
      break;
    }
    case 'trash_bags': {
      for (let i = 0; i < 3; i++) {
        const bx = x + 4 + r.range(0, 8);
        const by = y + 4 + r.range(0, 8);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ellipse(ctx, bx + 1, by + 1, 3.6, 3);
        ctx.fillStyle = '#262626';
        ellipse(ctx, bx, by, 3.5, 3);
        ctx.fillStyle = '#4a4a4c';
        ellipse(ctx, bx - 1, by - 1, 1, 0.7);
      }
      break;
    }
    case 'mailbox': {
      shadowRect(ctx, x + 4, y + 4, 8, 8, 1);
      box(ctx, x + 4, y + 4, 8, 8, '#6a3a32', 2);
      break;
    }
    case 'barrel_fire': {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ellipse(ctx, x + 9, y + 9.5, 6, 5);
      ctx.fillStyle = '#5a3d2e';
      ellipse(ctx, x + 8, y + 8, 5.5, 5.5);
      ctx.fillStyle = '#2a1f1a';
      ellipse(ctx, x + 8, y + 8, 4.2, 4.2);
      break;
    }
    case 'tires': {
      for (const [a, b] of [
        [5, 6],
        [11, 8],
        [7, 11],
      ]) {
        ctx.fillStyle = '#1e1e1f';
        ellipse(ctx, x + a, y + b, 4, 4);
        ctx.fillStyle = '#3a3a3c';
        ellipse(ctx, x + a, y + b, 1.8, 1.8);
      }
      break;
    }
    case 'debris': {
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = r.pick(['#5a5650', '#6e6a62', '#4a4642', '#6a5a4a']);
        ctx.fillRect(x + r.int(0, 11), y + r.int(0, 11), r.int(3, 6), r.int(3, 5));
      }
      ctx.strokeStyle = '#5a3a2a';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(x + 2, y + 3);
      ctx.lineTo(x + 14, y + 11);
      ctx.stroke();
      break;
    }
    case 'lamp': {
      // poste visto de cima: base, braço e luminária (sombra longa projetada pelo sol nascente)
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.save();
      ctx.translate(x + 8, y + 8);
      ctx.rotate(2.6);
      ctx.fillRect(0, -1, 26, 2);
      ctx.restore();
      ctx.fillStyle = '#2e3032';
      ellipse(ctx, x + 8, y + 8, 2.6, 2.6);
      ctx.fillStyle = '#55585a';
      ellipse(ctx, x + 8, y + 8, 1.5, 1.5);
      ctx.fillStyle = '#44474a';
      ctx.fillRect(x + 7.4, y - 3, 1.2, 10);
      ctx.fillStyle = '#6a6c6a';
      roundRect(ctx, x + 5, y - 6, 6, 4, 1.5);
      ctx.fill();
      ctx.fillStyle = '#8f8c80';
      ctx.fillRect(x + 6, y - 5, 4, 1.5);
      break;
    }
    case 'fuel_tank': {
      ctx.fillStyle = '#4a4c4a';
      roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 3);
      ctx.fill();
      ctx.fillStyle = '#6a6c66';
      ellipse(ctx, x + w / 2, y + h / 2, 5, 5);
      ctx.fillStyle = '#8a3a2a';
      ellipse(ctx, x + w / 2, y + h / 2, 2, 2);
      break;
    }
    case 'fuel_pump': {
      shadowRect(ctx, x + 4, y + 3, 8, 10, 1);
      box(ctx, x + 4, y + 3, 8, 10, '#8a3a30', 1);
      ctx.fillStyle = '#c8c4b8';
      ctx.fillRect(x + 5.5, y + 5, 5, 3);
      ctx.fillStyle = '#222';
      ctx.fillRect(x + 11, y + 6, 2, 1);
      break;
    }
    case 'radio_station': {
      shadowRect(ctx, x, y + 1, w, h - 2, 1);
      box(ctx, x, y + 1, w, h - 3, '#3e4448', 1);
      ctx.fillStyle = '#5a7a5a';
      ctx.fillRect(x + 3, y + 3, 6, 3);
      ctx.fillStyle = '#c8b860';
      for (let i = 0; i < 4; i++) ctx.fillRect(x + 12 + i * 4, y + 4, 2, 2);
      ctx.strokeStyle = '#2a2c2e';
      ctx.beginPath();
      ctx.moveTo(x + w - 4, y + 2);
      ctx.lineTo(x + w - 2, y - 6);
      ctx.stroke();
      break;
    }
    case 'lab_bench': {
      shadowRect(ctx, x, y + 1, w, h - 2, 1);
      box(ctx, x, y + 1, w, h - 3, '#9aa0a0', 1);
      ctx.fillStyle = '#5a7a8a';
      for (let i = 0; i < 5; i++) ellipse(ctx, x + 6 + i * 8, y + 6, 1.6, 1.6);
      ctx.fillStyle = '#3a3c3e';
      ctx.fillRect(x + w - 12, y + 3, 8, 6);
      break;
    }
    case 'generator': {
      shadowRect(ctx, x + 1, y + 2, w - 2, h - 3, 2);
      box(ctx, x + 1, y + 2, w - 2, h - 4, '#a08a3a', 2);
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(x + 4, y + 5, w - 8, 4);
      break;
    }
    case 'chest': {
      shadowRect(ctx, x + 1, y + 2, w - 2, h - 4, 1);
      box(ctx, x + 1, y + 2, w - 2, h - 4, '#6a4e34', 1);
      ctx.fillStyle = '#3e3a36';
      ctx.fillRect(x + 6, y + 2, 2, h - 4);
      ctx.fillRect(x + w - 8, y + 2, 2, h - 4);
      ctx.fillStyle = '#b8a77a';
      ctx.fillRect(x + w / 2 - 1, y + h / 2 - 1, 2, 3);
      break;
    }
    case 'rain_barrel': {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ellipse(ctx, x + 9, y + 9.5, 6.5, 5.5);
      ctx.fillStyle = '#3e5a6e';
      ellipse(ctx, x + 8, y + 8, 6, 6);
      ctx.fillStyle = '#2a3e4c';
      ellipse(ctx, x + 8, y + 8, 4.5, 4.5);
      ctx.fillStyle = 'rgba(120,150,165,0.7)';
      ellipse(ctx, x + 7, y + 7, 2, 1.5);
      break;
    }
    case 'water_tank': {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ellipse(ctx, x + w / 2 + 2, y + h / 2 + 3, w / 2, h / 2 - 1);
      ctx.fillStyle = '#3d5d78';
      ellipse(ctx, x + w / 2, y + h / 2, w / 2 - 1, h / 2 - 1);
      ctx.fillStyle = '#4a6e8c';
      ellipse(ctx, x + w / 2, y + h / 2, w / 2 - 5, h / 2 - 5);
      ctx.fillStyle = '#2e4658';
      ellipse(ctx, x + w / 2, y + h / 2, 4, 4);
      break;
    }
    case 'produce': {
      shadowRect(ctx, x, y + 2, w, h - 4, 1);
      box(ctx, x, y + 2, w, h - 4, '#6d5a3d', 1);
      for (let i = 0; i < p.w; i++)
        for (let k = 0; k < 6; k++) {
          if (r.chance(0.3)) continue;
          ctx.fillStyle = r.pick(['#8a3a2e', '#a08a3a', '#6a7a3a', '#9a5a2a']);
          ellipse(ctx, x + i * TILE + 3 + (k % 3) * 4.5, y + 6 + Math.floor(k / 3) * 4, 1.8, 1.8);
        }
      break;
    }
    case 'freezer': {
      shadowRect(ctx, x + 1, y, w - 2, h, 1);
      box(ctx, x + 1, y, w - 2, h - 1, '#b8b6ae', 1);
      ctx.fillStyle = '#8f8d86';
      ctx.fillRect(x + 2, y + h / 2 - 0.5, w - 4, 1);
      ctx.fillStyle = 'rgba(70,40,30,0.35)';
      ctx.fillRect(x + 3, y + h - 6, w - 6, 3);
      break;
    }
    case 'car':
    case 'car_police':
    case 'van':
    case 'bus':
      drawCar(ctx, p, r);
      break;
  }
}

function drawCar(ctx: Ctx, p: Prop, r: RNG) {
  const x = p.x * TILE;
  const y = p.y * TILE;
  const w = p.w * TILE;
  const h = p.h * TILE;
  ctx.save();
  // desenha sempre na horizontal e gira se for vertical
  if (p.vertical) {
    ctx.translate(x + w, y);
    ctx.rotate(Math.PI / 2);
  } else ctx.translate(x, y);
  const L = p.vertical ? h : w;
  const Wd = p.vertical ? w : h;
  const burned = !!p.burned;
  const body = burned ? '#2a2826' : p.color ?? '#6d3b33';
  // sombra
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, 3, 3.5, L - 2, Wd - 3, 4);
  ctx.fill();
  // pneus
  ctx.fillStyle = '#161617';
  for (const tx of [L * 0.18, L * 0.78]) {
    ctx.fillRect(tx - 3, 1, 6, 3);
    ctx.fillRect(tx - 3, Wd - 4, 6, 3);
  }
  // carroceria
  ctx.fillStyle = body;
  roundRect(ctx, 1, 2.5, L - 2, Wd - 5, p.kind === 'bus' ? 2 : 5);
  ctx.fill();
  ctx.fillStyle = shadeHex(body, 0.12);
  ctx.fillRect(4, 3.5, L - 8, 1.2);
  ctx.fillStyle = shadeHex(body, -0.3);
  ctx.fillRect(4, Wd - 4.5, L - 8, 1.2);
  if (p.kind === 'car_police' && !burned) {
    ctx.fillStyle = '#2b2d30';
    ctx.fillRect(L * 0.32, 2.5, L * 0.36, Wd - 5);
  }
  // vidros / teto
  const glass = burned ? '#141414' : '#3a4a52';
  if (p.kind === 'bus') {
    ctx.fillStyle = shadeHex(body, -0.15);
    ctx.fillRect(4, 5, L - 8, Wd - 10);
    ctx.fillStyle = glass;
    for (let i = 8; i < L - 10; i += 12) ctx.fillRect(i, 3, 8, 1.6);
    ctx.fillRect(L - 6, 5, 3, Wd - 10);
  } else {
    const isVan = p.kind === 'van';
    const ws = isVan ? L * 0.72 : L * 0.62;
    const rs = isVan ? L * 0.08 : L * 0.28;
    ctx.fillStyle = glass;
    ctx.fillRect(ws, 5, isVan ? 5 : 6, Wd - 10);
    if (!isVan) ctx.fillRect(rs - 4, 5.5, 4, Wd - 11);
    ctx.fillStyle = shadeHex(body, burned ? 0.05 : -0.08);
    ctx.fillRect(rs, 5, ws - rs, Wd - 10);
    // rachaduras
    ctx.strokeStyle = 'rgba(200,210,215,0.5)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(ws + 1, 7);
    ctx.lineTo(ws + 4, Wd - 9);
    ctx.stroke();
    if (p.kind === 'car_police' && !burned) {
      ctx.fillStyle = '#7a2a28';
      ctx.fillRect(L * 0.48, 6, 2, (Wd - 12) / 2);
      ctx.fillStyle = '#2a3a6a';
      ctx.fillRect(L * 0.48, Wd / 2, 2, (Wd - 12) / 2);
    }
  }
  // farol / lanterna
  ctx.fillStyle = burned ? '#222' : '#c8c0a0';
  ctx.fillRect(L - 3, 4, 1.5, 2.5);
  ctx.fillRect(L - 3, Wd - 6.5, 1.5, 2.5);
  ctx.fillStyle = burned ? '#222' : '#6a2a24';
  ctx.fillRect(1.5, 4, 1.2, 2.5);
  ctx.fillRect(1.5, Wd - 6.5, 1.2, 2.5);
  // ferrugem / fuligem
  for (let i = 0; i < (burned ? 14 : 5); i++) {
    ctx.fillStyle = burned ? (r.chance(0.5) ? '#3a2a20' : '#4a4642') : 'rgba(110,70,40,0.6)';
    ctx.fillRect(r.range(3, L - 6), r.range(3, Wd - 5), r.range(1, 3), r.range(1, 2));
  }
  ctx.restore();
}

/** Copa de árvore: sombra estática no chão. */
export function drawTreeShadow(ctx: Ctx, t: Tree) {
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ellipse(ctx, t.x + 6, t.y + 7, t.r * 0.95, t.r * 0.8);
  ctx.fillStyle = '#3a2c20';
  ellipse(ctx, t.x, t.y, 2.5, 2.5);
}

export { hex };
