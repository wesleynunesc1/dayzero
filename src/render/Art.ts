import { TILE } from '../config';
import { RNG } from '../engine/math';
import type { Appearance } from '../entities/Actor';
import type { Building, Tree } from '../world/types';
import { Ctx, ellipse, hex, makeCanvas, rgb, RGB, shade } from './canvas';

/**
 * Direção de arte "vista de cima com leve perspectiva" (3/4), estilo pixel art detalhado.
 * - Personagens com cabeça, tronco, braços, pernas, mochila e roupas; 4 direções;
 *   ciclos de caminhada, corrida e ataque. Contorno escuro de 1 px em volta da silhueta.
 * - Árvores com tronco e copa em volume (frondosas, pinheiros, secas) e arbustos.
 * - Construções com telhado detalhado e FACHADA visível (portas, janelas, placas).
 * Tudo original e gerado por código; 1 unidade = 1 pixel de arte; tile = 16 px.
 */

// ============================================================================ pintor com contorno
type Shape =
  | { k: 'r'; x: number; y: number; w: number; h: number; c: string; o: boolean }
  | { k: 'e'; x: number; y: number; rx: number; ry: number; c: string; o: boolean }
  | { k: 'l'; x1: number; y1: number; x2: number; y2: number; w: number; c: string; o: boolean };

class Painter {
  shapes: Shape[] = [];
  rect(x: number, y: number, w: number, h: number, c: string, o = true) {
    this.shapes.push({ k: 'r', x, y, w, h, c, o });
  }
  ell(x: number, y: number, rx: number, ry: number, c: string, o = true) {
    this.shapes.push({ k: 'e', x, y, rx, ry, c, o });
  }
  line(x1: number, y1: number, x2: number, y2: number, w: number, c: string, o = true) {
    this.shapes.push({ k: 'l', x1, y1, x2, y2, w, c, o });
  }
  /** Desenha: primeiro a silhueta de contorno (1 px maior), depois as peças. */
  flush(ctx: Ctx, outline: string) {
    ctx.fillStyle = outline;
    ctx.strokeStyle = outline;
    ctx.lineCap = 'round';
    for (const s of this.shapes) {
      if (!s.o) continue;
      if (s.k === 'r') ctx.fillRect(s.x - 1, s.y - 1, s.w + 2, s.h + 2);
      else if (s.k === 'e') ellipse(ctx, s.x, s.y, s.rx + 1, s.ry + 1);
      else {
        ctx.lineWidth = s.w + 2;
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
      }
    }
    for (const s of this.shapes) {
      ctx.fillStyle = s.c;
      ctx.strokeStyle = s.c;
      if (s.k === 'r') ctx.fillRect(s.x, s.y, s.w, s.h);
      else if (s.k === 'e') ellipse(ctx, s.x, s.y, s.rx, s.ry);
      else {
        ctx.lineWidth = s.w;
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
      }
    }
    this.shapes.length = 0;
  }
}
const P = new Painter();

const dk = (c: string, k = -0.22) => rgb(shade(hex(c), k));
const lt = (c: string, k = 0.14) => rgb(shade(hex(c), k));

// ============================================================================ personagens
export interface CharPose {
  x: number;
  y: number;
  facing: number;
  look: Appearance;
  walk: number;
  moving: boolean;
  run?: boolean;
  crouch?: boolean;
  /** 0..1 — progresso restante do ataque (1 = início do golpe). */
  attack?: number;
  weapon?: 'none' | 'melee' | 'gun';
  weaponLen?: number;
  weaponColor?: string;
  zombie?: boolean;
  runner?: boolean;
  crawler?: boolean;
  reach?: boolean;
  down?: boolean;
  flash?: number;
  backpack?: string | null;
  seed?: number;
}

/** 0 = de frente (sul), 1 = direita (leste), 2 = de costas (norte), 3 = esquerda (oeste). */
export function dirOf(facing: number): number {
  const a = Math.atan2(Math.sin(facing), Math.cos(facing));
  if (a > -Math.PI / 4 && a <= Math.PI / 4) return 1;
  if (a > Math.PI / 4 && a <= (3 * Math.PI) / 4) return 0;
  if (a > -(3 * Math.PI) / 4 && a <= -Math.PI / 4) return 2;
  return 3;
}

/** Escala dos personagens em relação ao tile (≈1,7 tile de altura). */
export const CHAR_SCALE = 1.12;

const ZSKINS = ['#8f9c7e', '#9aa08a', '#7f8c74', '#a39f8c', '#8a9384'];

/** Personagem em 3/4 com os pés em (x, y+3). */
export function drawCharacter(ctx: Ctx, p: CharPose) {
  const look = p.look;
  const seed = p.seed ?? 1;
  const zombie = !!p.zombie;
  const skin = zombie ? ZSKINS[seed % ZSKINS.length] : look.skin;
  ctx.save();
  ctx.translate(Math.round(p.x), Math.round(p.y) + 3);
  ctx.scale(CHAR_SCALE, CHAR_SCALE);
  // sombra suave no chão
  ctx.fillStyle = 'rgba(20,24,16,0.28)';
  ellipse(ctx, 1, 0, p.down || p.crawler ? 10 : 6.5, p.down || p.crawler ? 4 : 2.6);
  if (p.down || p.crawler) {
    drawLying(ctx, p, skin);
    ctx.restore();
    return;
  }
  const dir = dirOf(p.facing);
  const side = dir === 1 || dir === 3;
  if (dir === 3) ctx.scale(-1, 1);
  const runK = p.run ? 1.6 : 1;
  const ph = p.walk * (zombie ? 0.8 : 1);
  const sw = p.moving ? Math.sin(ph) : 0;
  const bob = p.moving ? Math.abs(Math.cos(ph)) * (p.run ? 1.2 : 0.6) : 0;
  const crouch = p.crouch ? 3 : 0;
  // zumbi cambaleia: inclinação e cabeça caída
  const lurch = zombie ? Math.sin(ph * 0.5 + seed) * 0.8 : 0;
  const by = -bob + crouch; // deslocamento do corpo
  const pants = look.pants;
  const shoes = look.shoes;
  const shirt = look.shirt;
  const ov = look.overlay;
  const sleeve = ov && (ov.kind === 'jacket' || ov.kind === 'uniform') ? ov.color : shirt;
  const atk = p.attack ?? 0;
  const aim = p.facing;
  // vetor de mira em 3/4 (vertical achatado)
  const ax = Math.cos(aim) * (dir === 3 ? -1 : 1);
  const ay = Math.sin(aim) * 0.8;

  // ---------------- pernas
  const hip = -9 + crouch;
  if (side) {
    const s = sw * 3 * runK;
    const legPoly = (fx: number, color: string, back: boolean) => {
      const lift = p.moving ? Math.max(0, back ? -Math.cos(ph) : Math.cos(ph)) * 1.5 * runK : 0;
      P.line(0, hip + by, fx, -1.5 - lift, 2.6, color);
      P.rect(fx - 1.5, -2 - lift, 4, 2, shoes);
    };
    legPoly(-s, dk(pants, -0.16), true);
    legPoly(s, pants, false);
  } else {
    const l = p.moving ? Math.max(0, sw) * 2 * runK : 0;
    const r = p.moving ? Math.max(0, -sw) * 2 * runK : 0;
    P.rect(-3.5, hip + by, 3, -hip - l - by - 1, pants);
    P.rect(0.5, hip + by, 3, -hip - r - by - 1, dk(pants, -0.08));
    P.rect(-3.8, -2 - l, 3.4, 2, shoes);
    P.rect(0.4, -2 - r, 3.4, 2, shoes);
  }

  // ---------------- braço de trás (perfil) e mochila (frente)
  const shoulderY = -16.5 + by + crouch * 0.3;
  const armSwing = sw * 3 * runK;
  const zArms = zombie && (p.reach || atk > 0);
  if (side) {
    if (p.backpack) {
      P.rect(-7.5, shoulderY - 0.5 + (p.run ? 0.5 : 0), 4, 8, p.backpack);
      P.rect(-7.5, shoulderY + 2.5, 4, 1, dk(p.backpack), false);
    }
    if (zArms) P.line(0, shoulderY + 1, 7 + lurch, shoulderY + 2, 2.2, dk(skin, -0.12));
    else if (p.weapon !== 'gun') P.line(0, shoulderY + 1, -armSwing * 0.8, shoulderY + 7, 2.2, dk(sleeve, -0.14));
  }

  // ---------------- tronco
  const tw = side ? 6 : 9;
  const tx = side ? -3 + (p.run ? 0.6 : 0) : -4.5;
  const ty = -17 + by + crouch * 0.3;
  const th = 9 - crouch * 0.3;
  P.rect(tx, ty, tw, th, shirt);
  if (!side) P.rect(tx - 0.8, ty + 0.5, tw + 1.6, 3, shirt); // ombros
  if (dir === 0) P.rect(-1.5, ty, 3, 1.2, dk(shirt, -0.25), false); // gola
  // sombreamento (luz vem de cima/esquerda)
  P.rect(tx + tw - 1.5, ty, 1.5, th, dk(shirt, -0.18), false);
  P.rect(tx, ty, 1, th, lt(shirt, 0.1), false);
  P.rect(tx, ty + th - 1.5, tw, 1.5, dk(pants, -0.25), false); // cinto
  if (ov) {
    if (ov.kind === 'jacket') {
      if (dir === 0) {
        P.rect(tx, ty, 3, th - 1, ov.color, false);
        P.rect(tx + tw - 3, ty, 3, th - 1, ov.color, false);
        P.rect(tx + tw - 1.5, ty, 1.5, th - 1, dk(ov.color), false);
      } else P.rect(tx, ty, tw, th - 1, ov.color, false);
    } else if (ov.kind === 'vest') {
      P.rect(tx + 0.5, ty + 1, tw - 1, th - 3, ov.color, false);
      if (dir === 0) {
        P.rect(tx + 1.5, ty + 3, 2, 2, dk(ov.color), false);
        P.rect(tx + tw - 3.5, ty + 3, 2, 2, dk(ov.color), false);
      }
    } else if (ov.kind === 'uniform') {
      P.rect(tx, ty, tw, th - 1, ov.color, false);
      P.rect(tx, ty + th - 2.5, tw, 1, '#2b2a24', false);
      if (dir === 0) P.rect(tx + 1.5, ty + 2, 2, 1.5, dk(ov.color), false);
    } else if (ov.kind === 'apron') {
      P.rect(tx + 1, ty + 3, tw - 2, th - 1, ov.color, false);
    }
  }
  if (zombie) {
    // roupa rasgada e manchas de sangue
    const r = new RNG(seed * 13 + 5);
    for (let i = 0; i < 3; i++) P.rect(tx + r.int(0, tw - 2), ty + r.int(0, th - 3), r.int(1, 3), r.int(1, 2), r.chance(0.6) ? '#5a1c18' : dk(shirt, -0.35), false);
    if (dir === 0) P.rect(tx + 2, ty + th - 1, 2, 2, dk(pants, -0.3), false);
  }
  // mochila de costas e alças de frente
  if (p.backpack && dir === 2) {
    P.rect(-4, ty + 0.5, 8, 8.5, p.backpack);
    P.rect(-4, ty + 2.5, 8, 1.2, dk(p.backpack), false);
    P.rect(-2, ty + 5, 4, 2.5, lt(p.backpack, 0.08), false);
  } else if (p.backpack && dir === 0) {
    P.rect(-3.5, ty, 1, 5, dk(p.backpack, -0.1), false);
    P.rect(2.5, ty, 1, 5, dk(p.backpack, -0.1), false);
  }

  // ---------------- cabeça
  const hy = -25 + by + crouch * 0.5 + (zombie ? 1 + Math.abs(lurch) * 0.5 : 0);
  const hx = side ? -3.2 + (p.run ? 1 : 0) + (zombie ? 1 : 0) : -3.5;
  const hw = side ? 6.5 : 7;
  // pescoço, cabeça arredondada e sombra do lado direito
  P.rect(-1.2 + (side ? 0.5 : 0), hy + 6.5, 2.6, 2, dk(skin, -0.1));
  P.ell(hx + hw / 2, hy + 3.7, hw / 2, 3.9, skin);
  P.rect(hx + hw - 1.6, hy + 1.5, 1.2, 5, dk(skin, -0.12), false);
  P.rect(hx + 1, hy + 0.6, 1, 1, lt(skin, 0.12), false);
  hair(P, look, dir, hx, hy, hw, zombie, seed);
  if (dir === 0) {
    P.rect(hx + 1.5, hy + 3.5, 1, 1.2, zombie ? '#d8d0b0' : '#1e1a18', false);
    P.rect(hx + hw - 2.5, hy + 3.5, 1, 1.2, zombie ? '#d8d0b0' : '#1e1a18', false);
    if (zombie) {
      P.rect(hx + 1.5, hy + 4.2, 1, 0.6, '#8a1c14', false);
      P.rect(hx + 2.5, hy + 6, 2, 1, '#3a1612', false);
    }
  } else if (side) {
    P.rect(hx + hw - 2, hy + 3.5, 1, 1.2, zombie ? '#d8d0b0' : '#1e1a18', false);
    P.rect(hx + hw, hy + 4, 0.8, 1.2, dk(skin, -0.1), false);
    if (zombie) P.rect(hx + hw - 2, hy + 6, 2, 1, '#3a1612', false);
  }
  if (look.gore > 0 || zombie) P.rect(hx + (seed % 4), hy + 2 + (seed % 3), 2, 1.5, '#7a1e18', false);

  // ---------------- braços da frente, armas
  const frontArms = () => {
    if (zArms) {
      // braços estendidos para a frente (infectado tentando agarrar)
      const reachLen = 7 + (atk > 0 ? Math.sin(atk * Math.PI) * 3 : 0);
      if (side) P.line(0.5, shoulderY + 1, 1 + reachLen + lurch, shoulderY + 1.5 + Math.sin(ph) * 0.8, 2.2, skin);
      else {
        const dy = dir === 0 ? 4 : -3;
        P.line(-4, shoulderY + 1, -3 + lurch * 0.5, shoulderY + 1 + dy, 2.2, skin);
        P.line(4, shoulderY + 1, 3 + lurch * 0.5, shoulderY + 1 + dy, 2.2, skin);
      }
      return;
    }
    if (p.weapon === 'gun') {
      // duas mãos na arma, apontando na direção real da mira
      const sx = side ? 1 : 0;
      const hxx = sx + ax * 6;
      const hyy = shoulderY + 3 + ay * 5;
      if (!side) {
        P.line(-4, shoulderY + 1, hxx - 0.5, hyy, 2, sleeve);
        P.line(4, shoulderY + 1, hxx + 0.5, hyy, 2, sleeve);
      } else P.line(0, shoulderY + 1, hxx, hyy, 2.2, sleeve);
      const kick = atk > 0 ? atk * 2 : 0;
      const L = p.weaponLen && p.weaponLen > 10 ? 10 : 6;
      P.line(hxx - ax * kick, hyy - ay * kick, hxx + ax * (L - kick), hyy + ay * (L - kick), 1.8, '#26282a');
      P.ell(hxx, hyy, 1.2, 1.2, skin);
      return;
    }
    if (p.weapon === 'melee') {
      const L = Math.min(12, p.weaponLen ?? 9);
      let wa: number;
      let hxx: number;
      let hyy: number;
      if (atk > 0) {
        // golpe: arco ao redor da direção do ataque
        const base = Math.atan2(ay, ax);
        wa = base - 1.3 + (1 - atk) * 2.6;
        hxx = Math.cos(wa) * 5;
        hyy = shoulderY + 3 + Math.sin(wa) * 4;
      } else {
        hxx = side ? 2 + armSwing * 0.4 : 5;
        hyy = shoulderY + 7;
        wa = side ? -0.9 : -1.3;
      }
      P.line(side ? 0 : 4, shoulderY + 1, hxx, hyy, 2.2, sleeve);
      P.line(hxx, hyy, hxx + Math.cos(wa) * L, hyy + Math.sin(wa) * L, 1.8, p.weaponColor ?? '#6b5139');
      P.ell(hxx, hyy, 1.2, 1.2, skin);
      if (!side) {
        P.line(-4, shoulderY + 1, -5 - armSwing * 0.2, shoulderY + 7 - Math.abs(armSwing) * 0.3, 2.2, sleeve);
        P.ell(-5 - armSwing * 0.2, shoulderY + 7.5, 1.1, 1.1, skin);
      }
      return;
    }
    // mãos livres: balançam; soco estende o braço
    const punch = atk > 0 ? Math.sin(atk * Math.PI) : 0;
    if (side) {
      const hx2 = punch > 0 ? 3 + punch * 5 : armSwing * 0.9;
      const hy2 = punch > 0 ? shoulderY + 2 : shoulderY + 7;
      P.line(0, shoulderY + 1, hx2, hy2, 2.2, sleeve);
      P.ell(hx2, hy2 + 0.5, 1.1, 1.1, skin);
    } else {
      const fy = dir === 0 ? 1 : -1;
      const l = shoulderY + 7 - sw * 1.2 * runK;
      const r = shoulderY + 7 + sw * 1.2 * runK - punch * 3;
      P.line(-4.8, shoulderY + 1, -5.5, l, 2.2, sleeve);
      P.line(4.8, shoulderY + 1, 5.5 - punch * 2, r + punch * fy * 2, 2.2, sleeve);
      P.ell(-5.5, l + 0.6, 1.1, 1.1, skin);
      P.ell(5.5 - punch * 2, r + 0.6 + punch * fy * 2, 1.1, 1.1, skin);
    }
  };
  // de costas: arma e braços ficam atrás do corpo
  if (dir === 2) {
    const shapes = P.shapes.splice(0);
    frontArms();
    P.shapes.push(...shapes);
  } else frontArms();
  P.flush(ctx, p.flash && p.flash > 0 ? 'rgba(220,60,40,0.95)' : zombie ? 'rgba(26,28,22,0.9)' : 'rgba(22,18,16,0.88)');
  ctx.restore();
}

function hair(P: Painter, look: Appearance, dir: number, hx: number, hy: number, hw: number, zombie: boolean, seed: number) {
  const c = zombie ? dk(look.hair, -0.1) : look.hair;
  const s = look.hairStyle;
  if (s === 2 && !zombie) {
    // raspado
    P.rect(hx, hy, hw, 1.5, c, false);
    return;
  }
  if (dir === 2) {
    P.rect(hx, hy - 0.5, hw, s === 1 ? 8 : 5.5, c, false);
  } else if (dir === 0) {
    P.rect(hx, hy - 0.8, hw, 2.6, c, false);
    if (s === 1) {
      P.rect(hx - 0.5, hy, 1.5, 7, c, false);
      P.rect(hx + hw - 1, hy, 1.5, 7, c, false);
    }
  } else {
    P.rect(hx - 0.5, hy - 0.8, hw * 0.75, 2.6, c, false);
    P.rect(hx - 0.5, hy, 2.5, s === 1 ? 8 : 5, c, false);
  }
  if (s === 3) P.rect(hx - 0.5, hy - 1.5, hw + 1, 1.5, c, false); // volume (cacheado)
  P.rect(hx + 1.5, hy - 0.5, 2.5, 0.8, lt(c, 0.18), false); // brilho do cabelo
  if (zombie && seed % 3 === 0) P.rect(hx + 2, hy - 0.5, 2, 1.5, '#9a8f84', false); // falha no couro cabeludo
}

/** Caído, morto, dormindo ou rastejando: corpo deitado na direção em que estava. */
function drawLying(ctx: Ctx, p: CharPose, skin: string) {
  const look = p.look;
  ctx.save();
  const a = Math.cos(p.facing) >= 0 ? 0 : Math.PI;
  ctx.rotate(a);
  const crawl = p.crawler && p.moving ? Math.sin(p.walk * 1.3) : 0;
  P.rect(-11, -3, 7, 2.6, look.pants);
  P.rect(-11, 0.4, 7 + crawl, 2.6, dk(look.pants, -0.1));
  P.rect(-12.5, -3, 2, 2.6, look.shoes);
  P.rect(-12.5, 0.4, 2, 2.6, look.shoes);
  P.rect(-4.5, -4, 9, 8, look.overlay?.color && look.overlay.kind !== 'apron' ? look.overlay.color : look.shirt);
  if (p.zombie) P.rect(-2, -2, 3, 2, '#5a1c18', false);
  if (p.crawler) {
    P.line(3, -3.5, 9 + crawl * 2, -4.5, 2.2, skin);
    P.line(3, 3.5, 9 - crawl * 2, 4.5, 2.2, skin);
  } else {
    P.line(1, -4.5, 4, -6.5, 2.2, look.overlay?.kind === 'jacket' ? look.overlay.color : look.shirt);
    P.line(1, 4.5, 3, 6.5, 2.2, look.overlay?.kind === 'jacket' ? look.overlay.color : look.shirt);
  }
  P.rect(4.5, -3.5, 7, 7, skin);
  P.rect(8.5, -3.5, 3, 7, p.zombie ? dk(look.hair, -0.1) : look.hair, false);
  P.flush(ctx, p.flash && p.flash > 0 ? 'rgba(220,60,40,0.95)' : 'rgba(22,18,16,0.85)');
  ctx.restore();
}

// ============================================================================ vegetação
export type TreeKind = 'frondosa' | 'pinheiro' | 'seca' | 'arbusto';

export function treeKind(t: Tree): TreeKind {
  if (t.r < 10) return 'arbusto';
  if (t.y < 128 * TILE && t.x > 160 * TILE) return t.variant === 3 ? 'seca' : 'pinheiro'; // serra ao norte
  if (t.variant === 3) return 'seca';
  if (t.variant === 2) return 'pinheiro';
  return 'frondosa';
}

/** Altura visual da árvore acima da base (para ordenação e oclusão). */
export function treeTop(t: Tree) {
  const k = treeKind(t);
  return k === 'pinheiro' ? t.r * 2.4 + 6 : k === 'arbusto' ? t.r : t.r * 1.7 + 10;
}

const LEAF: Record<string, RGB[]> = {
  frondosa: [
    [58, 96, 52],
    [72, 116, 58],
    [92, 138, 66],
    [124, 164, 82],
  ],
  pinheiro: [
    [40, 74, 56],
    [50, 90, 64],
    [64, 110, 74],
    [92, 136, 90],
  ],
  seca: [
    [104, 92, 56],
    [126, 110, 64],
    [146, 128, 74],
    [170, 152, 96],
  ],
};

/** Árvore inteira (tronco + copa), ancorada na base do tronco. */
export function drawTree(ctx: Ctx, t: Tree, alpha: number, time: number) {
  const kind = treeKind(t);
  const r = new RNG(t.variant * 977 + Math.round(t.x) * 7 + Math.round(t.y));
  const sway = Math.sin(time * 0.9 + t.x * 0.05) * 0.7;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(Math.round(t.x), Math.round(t.y));
  if (kind === 'arbusto') {
    bush(ctx, r, t.r, sway);
    ctx.restore();
    return;
  }
  // tronco com raízes
  const trunkH = kind === 'pinheiro' ? 9 : 12;
  ctx.fillStyle = '#2b2017';
  ctx.fillRect(-3, -trunkH - 1, 6, trunkH + 2);
  ctx.fillStyle = '#5a4130';
  ctx.fillRect(-2, -trunkH, 4, trunkH + 1);
  ctx.fillStyle = '#74563e';
  ctx.fillRect(-2, -trunkH, 1.5, trunkH + 1);
  ctx.fillStyle = '#3e2d20';
  ctx.fillRect(-4, -1, 2, 2);
  ctx.fillRect(2, -1, 2, 2);
  if (kind === 'seca') {
    // galhos secos e poucas folhas
    ctx.strokeStyle = '#3e2d20';
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + r.range(-1.1, 1.1);
      const len = r.range(t.r * 0.6, t.r * 1.1);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -trunkH + 2);
      ctx.lineTo(Math.cos(a) * len + sway, -trunkH + Math.sin(a) * len);
      ctx.stroke();
    }
    leafBlob(ctx, r, 0, -trunkH - t.r * 0.7, t.r * 0.8, LEAF.seca, sway, 7, 0.55);
    ctx.restore();
    return;
  }
  if (kind === 'pinheiro') {
    const cols = LEAF.pinheiro;
    const tiers = 4;
    const H = t.r * 2.4;
    for (let i = 0; i < tiers; i++) {
      const k = i / tiers;
      const w = t.r * (1.05 - k * 0.7);
      const y0 = -trunkH + 3 - k * H * 0.78;
      const y1 = y0 - H * 0.42;
      const sx = sway * (0.4 + k);
      tri(ctx, sx, y0, y1, w + 1, '#1c2e22');
      tri(ctx, sx, y0 - 0.5, y1 + 0.5, w, rgb(cols[1]));
      // luz do lado esquerdo, sombra à direita
      ctx.fillStyle = rgb(cols[2]);
      ctx.beginPath();
      ctx.moveTo(sx, y1 + 1);
      ctx.lineTo(sx - w + 1.5, y0 - 1);
      ctx.lineTo(sx - 1, y0 - 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgb(cols[0]);
      ctx.fillRect(sx - w + 1, y0 - 1.5, w * 2 - 2, 1.5);
      for (let j = 0; j < 3; j++) {
        ctx.fillStyle = rgb(cols[3]);
        ctx.fillRect(sx - w * 0.5 + r.range(-2, 2), y0 - r.range(2, H * 0.3), 1, 1);
      }
    }
    ctx.restore();
    return;
  }
  // frondosa: copa em cachos com volume
  const cy = -trunkH - t.r * 0.62;
  leafBlob(ctx, r, sway, cy, t.r, LEAF.frondosa, sway, 11, 1);
  ctx.restore();
}

function tri(ctx: Ctx, x: number, yb: number, yt: number, w: number, c: string) {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.moveTo(x, yt);
  ctx.lineTo(x + w, yb);
  ctx.lineTo(x - w, yb);
  ctx.closePath();
  ctx.fill();
}

function leafBlob(ctx: Ctx, r: RNG, cx: number, cy: number, R: number, cols: RGB[], sway: number, n: number, density: number) {
  const blobs: { x: number; y: number; rr: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = r.range(0, Math.PI * 2);
    const d = r.range(0, R * 0.55);
    blobs.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d * 0.8, rr: r.range(R * 0.38, R * 0.6) * density + 1 });
  }
  // contorno
  ctx.fillStyle = 'rgba(24,36,22,0.95)';
  for (const b of blobs) ellipse(ctx, b.x, b.y, b.rr + 1, b.rr * 0.92 + 1);
  // base sombreada
  ctx.fillStyle = rgb(cols[0]);
  for (const b of blobs) ellipse(ctx, b.x, b.y, b.rr, b.rr * 0.92);
  // meio-tom deslocado para cima/esquerda (luz)
  ctx.fillStyle = rgb(cols[1]);
  for (const b of blobs) ellipse(ctx, b.x - b.rr * 0.15, b.y - b.rr * 0.2, b.rr * 0.8, b.rr * 0.72);
  ctx.fillStyle = rgb(cols[2]);
  for (const b of blobs) ellipse(ctx, b.x - b.rr * 0.3, b.y - b.rr * 0.38, b.rr * 0.5, b.rr * 0.42);
  // brilhos e folhas soltas
  ctx.fillStyle = rgb(cols[3]);
  for (let i = 0; i < n * 2; i++) {
    const b = blobs[i % blobs.length];
    ctx.fillRect(Math.round(b.x - b.rr * 0.4 + r.range(-2, 2)), Math.round(b.y - b.rr * 0.5 + r.range(-2, 2)), 1, 1);
  }
  void sway;
}

function bush(ctx: Ctx, r: RNG, R: number, sway: number) {
  const cols = LEAF.frondosa;
  ctx.fillStyle = 'rgba(20,28,16,0.25)';
  ellipse(ctx, 1, 0.5, R + 1, R * 0.45);
  leafBlob(ctx, r, sway * 0.3, -R * 0.55, R, cols, 0, 6, 0.95);
  if (r.chance(0.4)) {
    ctx.fillStyle = r.chance(0.5) ? '#d8c060' : '#c87a8a';
    for (let i = 0; i < 4; i++) ctx.fillRect(Math.round(r.range(-R * 0.6, R * 0.6)), Math.round(-R * 0.6 + r.range(-R * 0.4, R * 0.3)), 1, 1);
  }
}

/** Sombra projetada da árvore no chão (sol alto, levemente a sudeste). */
export function drawTreeShadow3q(ctx: Ctx, t: Tree) {
  const k = treeKind(t);
  if (k === 'arbusto') return;
  ctx.fillStyle = 'rgba(16,26,12,0.22)';
  ellipse(ctx, t.x + t.r * 0.35, t.y + 2, t.r * (k === 'pinheiro' ? 0.7 : 0.95), t.r * 0.42);
}

// ============================================================================ construções
/** Altura (px) da fachada visível e quanto o telhado sobe acima da planta. */
export const FACADE_H = 30;
export const ROOF_RISE = 10;

interface FacadeStyle {
  wall: string;
  trim: string;
  sign?: { text: string; bg: string; fg: string };
  stripe?: string;
  cross?: boolean;
  brick?: boolean;
  siding?: boolean;
}

export function facadeStyle(b: Building): FacadeStyle {
  const n = b.name.toLowerCase();
  const r = new RNG(b.id * 17 + 3);
  if (n.includes('hospital') || n.includes('clínica') || n.includes('posto de saúde')) return { wall: '#d9d6cc', trim: '#9aa6a8', sign: { text: 'HOSPITAL', bg: '#e8e4da', fg: '#a8302a' }, cross: true, stripe: '#a8302a' };
  if (n.includes('farmácia')) return { wall: '#d6d2c4', trim: '#4a8a5a', sign: { text: 'FARMÁCIA', bg: '#3d7a4c', fg: '#e8efe0' } };
  if (n.includes('delegacia') || b.kind === 'delegacia') return { wall: '#c8c6be', trim: '#2c4a78', sign: { text: 'POLÍCIA', bg: '#2c4a78', fg: '#f0f0e6' }, stripe: '#2c4a78' };
  if (n.includes('mercantil') || n.includes('mercado') || n.includes('mercearia') || n.includes('mercadinho') || b.kind === 'mercantil') return { wall: '#b8a68a', trim: '#7a3a2a', sign: { text: n.includes('mercearia') ? 'MERCEARIA' : 'MERCANTIL', bg: '#a8442e', fg: '#f4e6c8' }, brick: true };
  if (n.includes('escola') || n.includes('comunidade')) return { wall: '#d8c79c', trim: '#6a5a3a', sign: { text: 'ESCOLA', bg: '#3a5a7a', fg: '#f0ead8' } };
  if (n.includes('igreja') || n.includes('capela')) return { wall: '#e2dccb', trim: '#7a6a4a' };
  if (n.includes('posto') || n.includes('conveniência')) return { wall: '#d4d0c4', trim: '#c8a02a', sign: { text: 'POSTO', bg: '#c8a02a', fg: '#2a2620' } };
  if (n.includes('oficina') || n.includes('garagem') || n.includes('hangar')) return { wall: '#8e918c', trim: '#5a5c58', sign: { text: n.includes('hangar') ? 'HANGAR' : 'OFICINA', bg: '#3a3c3a', fg: '#e0c060' } };
  if (n.includes('quartel') || n.includes('base') || n.includes('comando') || n.includes('paiol') || n.includes('detenção') || n.includes('almoxarifado')) return { wall: '#7c8466', trim: '#4a5038', stripe: '#4a5038' };
  if (n.includes('presídio') || n.includes('cela') || n.includes('guarita')) return { wall: '#9a9890', trim: '#5a5852' };
  if (n.includes('instituto') || n.includes('laborat')) return { wall: '#dfe2e0', trim: '#4a7a8a', sign: { text: 'VITALIS', bg: '#2a5a6a', fg: '#e8f4f4' } };
  if (n.includes('terminal') || n.includes('torre')) return { wall: '#c8ccd0', trim: '#5a6a7a' };
  if (n.includes('celeiro') || n.includes('fazenda')) return { wall: '#9a4a36', trim: '#e8e0d0', siding: true };
  if (b.kind === 'deposito') return { wall: '#a8a49a', trim: '#6a6860' };
  const walls = ['#d8c8a8', '#c8b898', '#b8c4b0', '#d0b8a0', '#a8b8c0', '#d8d0b8', '#c0a890'];
  return { wall: walls[r.int(0, walls.length - 1)], trim: '#f0e8d8', siding: r.chance(0.35), brick: r.chance(0.2) };
}

/**
 * Telhado + fachada de uma construção, vistos em 3/4. O canvas cobre a planta inteira
 * e sobe ROOF_RISE pixels acima dela. A fachada (sem as aberturas) ocupa a faixa inferior;
 * portas e janelas são desenhadas por cima a cada quadro (podem quebrar/abrir).
 */
export function makeBuildingSprite(b: Building): HTMLCanvasElement {
  const W = b.w * TILE;
  const H = b.h * TILE + ROOF_RISE;
  const [c, ctx] = makeCanvas(W, H);
  const r = new RNG(b.id * 31 + 7);
  const st = facadeStyle(b);
  const roofH = H - FACADE_H;
  // ----- fachada
  const fy = roofH;
  ctx.fillStyle = st.wall;
  ctx.fillRect(0, fy, W, FACADE_H);
  if (st.brick) {
    for (let y = fy + 2; y < H; y += 3)
      for (let x = ((y / 3) | 0) % 2 ? 0 : 3; x < W; x += 6) {
        ctx.fillStyle = 'rgba(80,40,30,0.18)';
        ctx.fillRect(x, y, 5, 2);
      }
  } else if (st.siding) {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = fy + 2; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  } else {
    for (let i = 0; i < (W * FACADE_H) / 12; i++) {
      ctx.fillStyle = r.chance(0.5) ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
      ctx.fillRect(r.int(0, W - 1), r.int(fy, H - 1), 1, 1);
    }
  }
  if (st.stripe) {
    ctx.fillStyle = st.stripe;
    ctx.fillRect(0, H - 6, W, 2);
  }
  // rodapé e sombra do beiral
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, H - 2, W, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, fy, W, 3);
  // laterais (cantos da parede)
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(W - 3, fy, 3, FACADE_H);
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(0, fy, 2, FACADE_H);
  // sujeira, rachaduras, trepadeiras (abandono)
  for (let i = 0; i < Math.max(2, W / 24); i++) {
    const x = r.int(2, W - 6);
    ctx.strokeStyle = 'rgba(40,30,24,0.4)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, fy + 4);
    ctx.lineTo(x + r.range(-3, 3), fy + 9);
    ctx.lineTo(x + r.range(-4, 4), fy + 13);
    ctx.stroke();
  }
  const vines = r.int(1, 3);
  for (let v = 0; v < vines; v++) {
    const x = r.chance(0.5) ? r.int(0, 6) : r.int(W - 10, W - 2);
    for (let y = H - 1; y > fy + r.int(2, 10); y--) {
      const xx = x + Math.round(Math.sin(y * 0.6 + v) * 1.5);
      ctx.fillStyle = (y + v) % 3 === 0 ? '#5a8a40' : '#456e34';
      ctx.fillRect(xx, y, 2, 1);
      if (r.chance(0.3)) ctx.fillRect(xx + r.int(-2, 2), y, 1, 1);
    }
  }
  // placa
  if (st.sign && W >= 48) {
    const tw = Math.min(W - 12, st.sign.text.length * 5 + 10);
    const sx = Math.round((W - tw) / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(sx + 1, fy + 3, tw, 7);
    ctx.fillStyle = st.sign.bg;
    ctx.fillRect(sx, fy + 2, tw, 7);
    pixelText(ctx, st.sign.text, sx + 5, fy + 3, st.sign.fg);
    if (r.chance(0.5)) {
      ctx.fillStyle = 'rgba(30,24,20,0.5)';
      ctx.fillRect(sx + r.int(0, tw - 6), fy + 2, r.int(3, 6), 2);
    }
  }
  if (st.cross && W >= 64) {
    ctx.fillStyle = '#a8302a';
    const cx = 8;
    ctx.fillRect(cx, fy + 3, 2, 6);
    ctx.fillRect(cx - 2, fy + 5, 6, 2);
  }

  // ----- telhado
  const base = hex(b.roof);
  const grime = (k: number) => rgb(shade(base, k));
  if (b.roofKind === 'gable') {
    // telhado de quatro águas: cumeeira, espigões nas quinas e planos com luz diferente
    const ridgeY = Math.round(roofH * 0.44);
    const inset = Math.min(Math.round(roofH * 0.42), Math.round(W * 0.32));
    const xl = (y: number) => (y <= ridgeY ? (inset * y) / ridgeY : (inset * (roofH - y)) / (roofH - ridgeY));
    for (let y = 0; y < roofH; y++) {
      const edge = xl(y);
      for (let x = 0; x < W; x++) {
        let plane: number; // 0 trás, 1 frente, 2 esquerda, 3 direita
        if (x < edge) plane = 2;
        else if (x > W - 1 - edge) plane = 3;
        else plane = y < ridgeY ? 0 : 1;
        let k = [0.16, 0.0, 0.08, -0.2][plane];
        const side = plane >= 2;
        const along = side ? x : y;
        const step = plane === 1 ? 4 : 3;
        if (along % step === step - 1) k -= 0.15;
        else if (((side ? y : x) + (Math.floor(along / step) % 2) * 3) % 6 === 0) k -= 0.07;
        k += (r.next() - 0.5) * 0.06;
        ctx.fillStyle = grime(k);
        ctx.fillRect(x, y, 1, 1);
      }
    }
    // espigões (quinas) e cumeeira
    ctx.strokeStyle = grime(0.28);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(inset, ridgeY);
    ctx.lineTo(W - inset, ridgeY);
    ctx.lineTo(W, 0);
    ctx.moveTo(inset, ridgeY);
    ctx.lineTo(0, roofH);
    ctx.moveTo(W - inset, ridgeY);
    ctx.lineTo(W, roofH);
    ctx.stroke();
    ctx.fillStyle = grime(0.32);
    ctx.fillRect(inset, ridgeY - 1, W - inset * 2, 2);
    // beiral com calha
    ctx.fillStyle = grime(-0.42);
    ctx.fillRect(0, roofH - 3, W, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, roofH - 3, W, 1);
    // chaminé
    if (r.chance(0.55) && W > 48) {
      const x = r.int(inset + 4, Math.max(inset + 5, W - inset - 12));
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x + 3, ridgeY - 2, 8, 6);
      ctx.fillStyle = '#8a5a46';
      ctx.fillRect(x, ridgeY - 11, 8, 11);
      ctx.fillStyle = '#6a4234';
      ctx.fillRect(x + 6, ridgeY - 11, 2, 11);
      ctx.fillStyle = '#5a3a30';
      ctx.fillRect(x - 1, ridgeY - 12, 10, 2);
      ctx.fillStyle = '#1e1814';
      ctx.fillRect(x + 1, ridgeY - 12, 6, 1);
    }
  } else {
    // laje/telhado plano com platibanda
    for (let y = 0; y < roofH; y++)
      for (let x = 0; x < W; x++) {
        ctx.fillStyle = grime((r.next() - 0.5) * 0.08 + 0.04);
        ctx.fillRect(x, y, 1, 1);
      }
    ctx.fillStyle = grime(0.2);
    ctx.fillRect(0, 0, W, 3);
    ctx.fillRect(0, 0, 3, roofH);
    ctx.fillRect(W - 3, 0, 3, roofH);
    ctx.fillStyle = grime(-0.3);
    ctx.fillRect(0, roofH - 4, W, 4);
    ctx.fillRect(3, 3, W - 6, 1);
    for (let i = 0; i < Math.max(2, (W * roofH) / 5000); i++) {
      ctx.fillStyle = 'rgba(40,46,50,0.22)';
      ellipse(ctx, r.range(10, W - 10), r.range(8, roofH - 8), r.range(5, 14), r.range(3, 8));
    }
    for (let i = 0; i < Math.max(1, Math.floor((W * roofH) / 7000)); i++) {
      const x = r.int(8, Math.max(9, W - 24));
      const y = r.int(6, Math.max(7, roofH - 20));
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x + 2, y + 4, 14, 10);
      ctx.fillStyle = '#9a9e9c';
      ctx.fillRect(x, y, 14, 10);
      ctx.fillStyle = '#7a7e7c';
      ctx.fillRect(x, y + 7, 14, 3);
      ctx.fillStyle = '#5e6260';
      ellipse(ctx, x + 7, y + 4, 3.5, 2.5);
    }
  }
  // musgo, telhas faltando, buracos (abandono) — vegetação crescendo
  for (let i = 0; i < Math.max(3, (W * roofH) / 900); i++) {
    const x = r.int(2, W - 6);
    const y = r.int(2, roofH - 6);
    const k = r.next();
    if (k < 0.45) {
      ctx.fillStyle = r.chance(0.5) ? 'rgba(92,124,62,0.75)' : 'rgba(110,140,70,0.6)';
      ellipse(ctx, x, y, r.range(1.5, 4), r.range(1, 2.5));
    } else if (k < 0.75) {
      ctx.fillStyle = grime(-0.3);
      ctx.fillRect(x, y, r.int(2, 5), r.int(1, 3));
    } else if (k < 0.85 && b.roofKind === 'gable') {
      ctx.fillStyle = '#1c1612';
      ctx.fillRect(x, y, r.int(3, 6), r.int(2, 4));
      ctx.fillStyle = '#5a4434';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // contorno geral
  ctx.strokeStyle = 'rgba(28,22,18,0.85)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  ctx.beginPath();
  ctx.moveTo(0, roofH + 0.5);
  ctx.lineTo(W, roofH + 0.5);
  ctx.stroke();
  return c;
}

/** Fonte de pixel 3×5 para placas (somente maiúsculas usadas nas fachadas). */
const GLYPHS: Record<string, string> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100',
  G: '011100101101011', H: '101101111101101', I: '111010010010111', L: '100100100100111', M: '101111111101101', N: '110101101101101',
  O: '010101101101010', P: '110101110100100', R: '110101110101101', S: '011100010001110', T: '111010010010010', U: '101101101101111',
  V: '101101101101010', Í: '010000111010111', Á: '010000010101111', Ã: '011000010101111', 'Ç': '011100100011010',
};

export function pixelText(ctx: Ctx, text: string, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS[ch.normalize('NFD')[0]];
    if (g) for (let i = 0; i < 15; i++) if (g[i] === '1') ctx.fillRect(cx + (i % 3), y + Math.floor(i / 3), 1, 1);
    cx += 4;
  }
}

/** Janela vista na fachada (estado vem do mapa: inteira, quebrada, com tábuas). */
export function drawFacadeWindow(ctx: Ctx, x: number, y: number, state: 'ok' | 'quebrada' | 'tabuas', trim: string) {
  ctx.fillStyle = trim;
  ctx.fillRect(x + 2, y + 5, 12, 11);
  ctx.fillStyle = state === 'quebrada' ? '#1c1f22' : '#3a4e5a';
  ctx.fillRect(x + 3, y + 6, 10, 9);
  if (state === 'ok') {
    ctx.fillStyle = 'rgba(190,220,232,0.55)';
    ctx.fillRect(x + 4, y + 7, 2, 4);
    ctx.fillRect(x + 7, y + 7, 1, 2);
    ctx.fillStyle = trim;
    ctx.fillRect(x + 7.5, y + 6, 1, 9);
  } else if (state === 'quebrada') {
    ctx.fillStyle = 'rgba(190,220,232,0.6)';
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 6);
    ctx.lineTo(x + 7, y + 6);
    ctx.lineTo(x + 3, y + 11);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 13, y + 15);
    ctx.lineTo(x + 13, y + 11);
    ctx.lineTo(x + 10, y + 15);
    ctx.fill();
  } else {
    ctx.fillStyle = '#7a5a38';
    ctx.fillRect(x + 1, y + 7, 14, 3);
    ctx.fillRect(x + 1, y + 11.5, 14, 3);
    ctx.fillStyle = '#5a4026';
    ctx.fillRect(x + 1, y + 9, 14, 1);
    ctx.fillRect(x + 1, y + 13.5, 14, 1);
    ctx.fillStyle = '#2a2420';
    ctx.fillRect(x + 2, y + 8, 1, 1);
    ctx.fillRect(x + 13, y + 12.5, 1, 1);
  }
  // peitoril
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 2, y + 16, 12, 1);
}

/** Porta na fachada: fechada, aberta (vão escuro) ou arrombada, com degrau. */
export function drawFacadeDoor(ctx: Ctx, x: number, y: number, open: boolean, broken: boolean, trim: string, barricades: number) {
  ctx.fillStyle = trim;
  ctx.fillRect(x + 2, y + 1, 12, 15);
  if (open || broken) {
    ctx.fillStyle = '#16120f';
    ctx.fillRect(x + 3, y + 2, 10, 14);
    if (broken) {
      ctx.fillStyle = '#6a4a30';
      ctx.fillRect(x + 3, y + 12, 6, 2);
      ctx.fillRect(x + 9, y + 9, 3, 1.5);
    }
  } else {
    ctx.fillStyle = '#6e4c32';
    ctx.fillRect(x + 3, y + 2, 10, 14);
    ctx.fillStyle = '#5a3c26';
    ctx.fillRect(x + 4, y + 3, 3.5, 5);
    ctx.fillRect(x + 8.5, y + 3, 3.5, 5);
    ctx.fillRect(x + 4, y + 9.5, 3.5, 5);
    ctx.fillRect(x + 8.5, y + 9.5, 3.5, 5);
    ctx.fillStyle = '#d0b060';
    ctx.fillRect(x + 11, y + 9, 1, 1);
  }
  for (let i = 0; i < barricades; i++) {
    ctx.fillStyle = '#8a6a44';
    ctx.save();
    ctx.translate(x + 8, y + 5 + i * 4);
    ctx.rotate(i % 2 ? 0.25 : -0.25);
    ctx.fillRect(-8, -1.5, 16, 3);
    ctx.restore();
  }
  // degrau
  ctx.fillStyle = '#9a968c';
  ctx.fillRect(x + 1, y + 16, 14, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 1, y + 18, 14, 1);
}
