import { RNG } from '../engine/math';
import { T } from '../world/tiles';
import { Ctx, makeCanvas, RGB, rgb, shade } from './canvas';

/**
 * Texturas de tiles geradas proceduralmente em pixel art 16×16 (assets provisórios originais).
 * Cada tipo tem 4 variações para quebrar a repetição.
 */
const S = 16;
export const VARIANTS = 4;

function px(ctx: Ctx, x: number, y: number, c: RGB, a = 1) {
  ctx.fillStyle = rgb(c, a);
  ctx.fillRect(x, y, 1, 1);
}

function noise(ctx: Ctx, rng: RNG, base: RGB, amt: number) {
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const k = (rng.next() - 0.5) * amt;
      px(ctx, x, y, [base[0] + k, base[1] + k, base[2] + k]);
    }
}

function specks(ctx: Ctx, rng: RNG, c: RGB, n: number) {
  for (let i = 0; i < n; i++) px(ctx, rng.int(0, S - 1), rng.int(0, S - 1), c);
}

const ASPH: RGB = [82, 84, 88];
const GRASS: RGB = [96, 128, 62];
const SIDE: RGB = [168, 162, 150];

function asphalt(ctx: Ctx, rng: RNG) {
  noise(ctx, rng, ASPH, 4);
  specks(ctx, rng, [100, 102, 106], 10);
  specks(ctx, rng, [62, 64, 68], 10);
}

function grass(ctx: Ctx, rng: RNG, base = GRASS) {
  // cor quase lisa com tufos estruturados (estilo pixel art), sem "chuvisco"
  noise(ctx, rng, base, 2.5);
  for (let i = 0; i < 6; i++) {
    const x = rng.int(0, S - 2);
    const y = rng.int(1, S - 1);
    const lite = shade(base, rng.range(0.07, 0.13));
    px(ctx, x, y, lite);
    if (rng.chance(0.5)) px(ctx, x + 1, y - 1, lite);
  }
  for (let i = 0; i < 5; i++) {
    const x = rng.int(0, S - 2);
    const y = rng.int(0, S - 1);
    const d = shade(base, -rng.range(0.1, 0.16));
    px(ctx, x, y, d);
    px(ctx, x + 1, y, d);
  }
  if (rng.chance(0.3)) px(ctx, rng.int(0, S - 1), rng.int(0, S - 1), [150, 146, 84]);
}

function crack(ctx: Ctx, rng: RNG, c: RGB, weed?: RGB) {
  let x = rng.int(2, 13);
  let y = 0;
  while (y < S) {
    px(ctx, x, y, c);
    if (weed && rng.chance(0.25)) px(ctx, x + (rng.chance(0.5) ? 1 : -1), y, weed);
    y++;
    x += rng.int(-1, 1);
    x = Math.max(0, Math.min(S - 1, x));
  }
}

const painters: Record<number, (ctx: Ctx, rng: RNG) => void> = {
  [T.GRASS]: (c, r) => grass(c, r),
  [T.GRASS_TALL]: (c, r) => {
    grass(c, r);
    for (let i = 0; i < 10; i++) {
      const x = r.int(0, S - 1);
      const y = r.int(3, S - 1);
      const col: RGB = r.chance(0.3) ? [160, 150, 88] : [112, 146, 70];
      for (let k = 0; k < 3; k++) px(c, x + (k === 2 ? r.int(-1, 1) : 0), y - k, col);
    }
  },
  [T.DIRT]: (c, r) => {
    noise(c, r, [138, 112, 80], 9);
    specks(c, r, [160, 136, 102], 8);
    specks(c, r, [112, 90, 64], 8);
  },
  [T.GRAVEL]: (c, r) => {
    noise(c, r, [150, 144, 130], 14);
    specks(c, r, [180, 174, 160], 18);
    specks(c, r, [116, 110, 100], 14);
  },
  [T.ASPHALT]: asphalt,
  [T.ASPHALT_CRACK]: (c, r) => {
    asphalt(c, r);
    crack(c, r, [52, 54, 56], [96, 132, 62]);
  },
  [T.LINE_H]: (c, r) => {
    asphalt(c, r);
    for (let x = 1; x < 15; x++) for (let y = 7; y < 9; y++) if (r.chance(0.8)) px(c, x, y, [214, 190, 96]);
  },
  [T.LINE_V]: (c, r) => {
    asphalt(c, r);
    for (let y = 1; y < 15; y++) for (let x = 7; x < 9; x++) if (r.chance(0.8)) px(c, x, y, [214, 190, 96]);
  },
  [T.PARKING]: (c, r) => {
    asphalt(c, r);
    for (let y = 0; y < S; y++) for (let x = 0; x < 2; x++) if (r.chance(0.75)) px(c, x + 7, y, [204, 204, 196]);
  },
  [T.SIDEWALK]: (c, r) => {
    noise(c, r, SIDE, 7);
    for (let i = 0; i < S; i++) {
      if (r.chance(0.9)) px(c, i, 0, [132, 126, 116]);
      if (r.chance(0.9)) px(c, 0, i, [132, 126, 116]);
      if (r.chance(0.9)) px(c, i, 8, [146, 140, 130]);
    }
    specks(c, r, [140, 134, 124], 8);
    specks(c, r, [188, 182, 170], 6);
  },
  [T.SIDEWALK_WEEDS]: (c, r) => {
    painters[T.SIDEWALK](c, r);
    for (let i = 0; i < 9; i++) {
      const onX = r.chance(0.5);
      const a = r.int(0, S - 1);
      const b = r.chance(0.5) ? 0 : 8;
      px(c, onX ? a : b, onX ? b : a, r.chance(0.5) ? [92, 132, 60] : [118, 152, 70]);
    }
    if (r.chance(0.5)) crack(c, r, [128, 122, 112], [92, 132, 60]);
  },
  [T.FLOOR_WOOD]: (c, r) => {
    const cols: RGB[] = [
      [150, 110, 74],
      [162, 120, 82],
      [140, 102, 68],
    ];
    for (let row = 0; row < 4; row++) {
      const base = r.pick(cols);
      const cut = r.int(2, 13);
      for (let y = row * 4; y < row * 4 + 4; y++)
        for (let x = 0; x < S; x++) {
          const k = (r.next() - 0.5) * 6;
          let col: RGB = [base[0] + k, base[1] + k, base[2] + k];
          if (y === row * 4 + 3) col = [108, 78, 52];
          if (x === cut) col = shade(base, -0.25);
          px(c, x, y, col);
        }
    }
  },
  [T.FLOOR_MARKET]: (c, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const odd = ((x >> 3) + (y >> 3)) & 1;
        const base: RGB = odd ? [184, 180, 168] : [160, 156, 146];
        const k = (r.next() - 0.5) * 6;
        px(c, x, y, [base[0] + k, base[1] + k, base[2] + k]);
      }
    specks(c, r, [86, 84, 78], 6);
  },
  [T.FLOOR_CONCRETE]: (c, r) => {
    noise(c, r, [150, 148, 140], 6);
    if (r.chance(0.4)) for (let i = 0; i < 10; i++) px(c, 6 + r.int(-3, 3), 6 + r.int(-3, 3), [84, 82, 78], 0.7);
    specks(c, r, [116, 114, 108], 5);
  },
  [T.FLOOR_CARPET]: (c, r) => {
    noise(c, r, [132, 92, 96], 7);
    specks(c, r, [112, 76, 80], 10);
  },
  [T.FLOOR_KITCHEN]: (c, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const odd = ((x >> 2) + (y >> 2)) & 1;
        const base: RGB = odd ? [206, 200, 184] : [176, 170, 156];
        const k = (r.next() - 0.5) * 6;
        px(c, x, y, [base[0] + k, base[1] + k, base[2] + k]);
      }
  },
  [T.FLOOR_LINO]: (c, r) => {
    noise(c, r, [134, 150, 160], 5);
    for (let i = 0; i < 3; i++) {
      const x = r.int(0, 12);
      const y = r.int(0, 15);
      for (let k = 0; k < 4; k++) px(c, x + k, y, [116, 130, 140]);
    }
  },
  [T.FLOOR_BATH]: (c, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const grout = x % 4 === 0 || y % 4 === 0;
        const k = (r.next() - 0.5) * 6;
        const base: RGB = grout ? [160, 168, 168] : [200, 208, 208];
        px(c, x, y, [base[0] + k, base[1] + k, base[2] + k]);
      }
  },
  [T.WALL_BRICK]: (c, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const row = y >> 2;
        const off = row & 1 ? 4 : 0;
        const mortar = y % 4 === 3 || (x + off) % 8 === 7;
        const k = (r.next() - 0.5) * 10;
        const base: RGB = mortar ? [176, 158, 138] : [156, 96, 74];
        px(c, x, y, [base[0] + k, base[1] + k, base[2] + k]);
      }
  },
  [T.WALL_PLASTER]: (c, r) => wallPlain(c, r, [184, 172, 148]),
  [T.WALL_BLUE]: (c, r) => wallPlain(c, r, [140, 160, 170]),
  [T.WALL_SAGE]: (c, r) => wallPlain(c, r, [152, 164, 132]),
  [T.WALL_CONCRETE]: (c, r) => {
    wallPlain(c, r, [156, 156, 150]);
    for (let x = 0; x < S; x++) px(c, x, 8, [136, 136, 130]);
  },
  [T.WINDOW]: (c, r) => noise(c, r, [110, 108, 104], 4),
  [T.WINDOW_BROKEN]: (c, r) => {
    noise(c, r, [110, 106, 100], 6);
    specks(c, r, [190, 214, 222], 7);
  },
  [T.WATER]: (c, r) => {
    noise(c, r, [58, 112, 140], 5);
    for (let i = 0; i < 5; i++) {
      const x = r.int(0, 12);
      const y = r.int(0, 15);
      for (let k = 0; k < 4; k++) px(c, x + k, y, k === 1 ? [168, 210, 222] : [96, 152, 176]);
    }
  },
  [T.ROCK]: (c, r) => {
    // afloramento rochoso: blocos arredondados com luz em cima e sombra embaixo
    noise(c, r, [112, 106, 96], 5);
    for (let i = 0; i < 4; i++) {
      const cx = r.int(2, 13);
      const cy = r.int(2, 13);
      const rad = r.int(3, 5);
      for (let y = -rad; y <= rad; y++)
        for (let x = -rad; x <= rad; x++) {
          if (x * x + y * y > rad * rad) continue;
          const xx = cx + x;
          const yy = cy + y;
          if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
          const k = y < -rad * 0.3 ? 0.16 : y > rad * 0.4 ? -0.18 : 0.02;
          px(c, xx, yy, shade([136, 128, 116], k + (r.next() - 0.5) * 0.04));
        }
    }
    if (r.chance(0.3)) for (let i = 0; i < 4; i++) px(c, r.int(0, 15), r.int(0, 15), [96, 128, 62]);
  },
  [T.CROP]: (c, r) => {
    noise(c, r, [118, 92, 62], 7);
    for (let x = 1; x < S; x += 4)
      for (let y = 0; y < S; y++) {
        if (r.chance(0.85)) px(c, x, y, r.chance(0.5) ? [112, 152, 66] : [92, 130, 56]);
        if (r.chance(0.5)) px(c, x + 1, y, [150, 176, 84]);
      }
  },
  [T.RUNWAY]: (c, r) => {
    noise(c, r, [100, 100, 98], 5);
    specks(c, r, [120, 120, 118], 8);
  },
  [T.BRIDGE]: (c, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const k = (r.next() - 0.5) * 8;
        const seam = x % 4 === 3;
        px(c, x, y, seam ? [96, 72, 50] : [150 + k, 116 + k, 80 + k]);
      }
  },
  [T.SAND]: (c, r) => {
    noise(c, r, [198, 180, 136], 8);
    specks(c, r, [170, 152, 112], 8);
  },
  [T.FLOOR_CLINIC]: (c, r) => {
    noise(c, r, [192, 200, 200], 4);
    for (let i = 0; i < S; i += 8) for (let k = 0; k < S; k++) px(c, i, k, [166, 174, 174]);
  },
  [T.FENCE_WOOD]: (c, r) => grass(c, r),
  [T.FENCE_METAL]: (c, r) => painters[T.GRAVEL](c, r),
  [T.HEDGE]: (c, r) => grass(c, r, [84, 114, 54]),
  [T.RUBBLE]: (c, r) => asphalt(c, r),
};

function wallPlain(c: Ctx, r: RNG, base: RGB) {
  noise(c, r, base, 6);
  if (r.chance(0.5)) crack(c, r, shade(base, -0.25));
  if (r.chance(0.35)) for (let i = 0; i < 6; i++) px(c, r.int(0, 15), r.int(10, 15), [100, 132, 70], 0.8); // musgo
}

export class TileTextures {
  private tex = new Map<number, HTMLCanvasElement[]>();

  constructor(seed = 99) {
    const rng = new RNG(seed);
    for (const key of Object.keys(painters)) {
      const id = Number(key);
      const arr: HTMLCanvasElement[] = [];
      for (let v = 0; v < VARIANTS; v++) {
        const [cv, ctx] = makeCanvas(S, S);
        painters[id](ctx, rng);
        arr.push(cv);
      }
      this.tex.set(id, arr);
    }
  }

  get(id: number, variant: number): HTMLCanvasElement {
    const arr = this.tex.get(id) ?? this.tex.get(T.GRASS)!;
    return arr[variant % arr.length];
  }
}
