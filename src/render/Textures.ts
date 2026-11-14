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

const ASPH: RGB = [58, 59, 61];
const GRASS: RGB = [77, 88, 57];
const SIDE: RGB = [104, 102, 95];

function asphalt(ctx: Ctx, rng: RNG) {
  noise(ctx, rng, ASPH, 7);
  specks(ctx, rng, [74, 74, 76], 10);
  specks(ctx, rng, [44, 44, 46], 10);
}

function grass(ctx: Ctx, rng: RNG, base = GRASS) {
  noise(ctx, rng, base, 9);
  for (let i = 0; i < 14; i++) {
    const x = rng.int(0, S - 1);
    const y = rng.int(1, S - 1);
    const c: RGB = rng.chance(0.25) ? [104, 99, 64] : shade(base, rng.range(0.1, 0.25));
    px(ctx, x, y, c);
    px(ctx, x, y - 1, shade(c, 0.08), 0.7);
  }
  specks(ctx, rng, shade(base, -0.2), 8);
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
    grass(c, r, [66, 78, 48]);
    for (let i = 0; i < 10; i++) {
      const x = r.int(0, S - 1);
      const y = r.int(3, S - 1);
      const col: RGB = r.chance(0.3) ? [110, 104, 66] : [88, 102, 62];
      for (let k = 0; k < 3; k++) px(c, x + (k === 2 ? r.int(-1, 1) : 0), y - k, col);
    }
  },
  [T.DIRT]: (c, r) => {
    noise(c, r, [92, 81, 66], 10);
    specks(c, r, [118, 108, 92], 8);
    specks(c, r, [72, 63, 52], 8);
  },
  [T.GRAVEL]: (c, r) => {
    noise(c, r, [104, 100, 92], 16);
    specks(c, r, [130, 126, 118], 18);
    specks(c, r, [78, 75, 70], 14);
  },
  [T.ASPHALT]: asphalt,
  [T.ASPHALT_CRACK]: (c, r) => {
    asphalt(c, r);
    crack(c, r, [34, 34, 35], [76, 92, 56]);
  },
  [T.LINE_H]: (c, r) => {
    asphalt(c, r);
    for (let x = 1; x < 15; x++) for (let y = 7; y < 9; y++) if (r.chance(0.8)) px(c, x, y, [146, 132, 80]);
  },
  [T.LINE_V]: (c, r) => {
    asphalt(c, r);
    for (let y = 1; y < 15; y++) for (let x = 7; x < 9; x++) if (r.chance(0.8)) px(c, x, y, [146, 132, 80]);
  },
  [T.PARKING]: (c, r) => {
    asphalt(c, r);
    for (let y = 0; y < S; y++) for (let x = 0; x < 2; x++) if (r.chance(0.75)) px(c, x + 7, y, [138, 138, 132]);
  },
  [T.SIDEWALK]: (c, r) => {
    noise(c, r, SIDE, 7);
    for (let i = 0; i < S; i++) {
      if (r.chance(0.85)) px(c, i, 0, [94, 92, 86]);
      if (r.chance(0.85)) px(c, 0, i, [94, 92, 86]);
    }
    specks(c, r, [86, 84, 78], 8);
    specks(c, r, [116, 113, 106], 5);
  },
  [T.SIDEWALK_WEEDS]: (c, r) => {
    painters[T.SIDEWALK](c, r);
    for (let i = 0; i < 9; i++) {
      const onX = r.chance(0.5);
      const a = r.int(0, S - 1);
      const b = r.chance(0.5) ? 0 : 8;
      px(c, onX ? a : b, onX ? b : a, r.chance(0.5) ? [82, 98, 58] : [96, 108, 66]);
    }
    if (r.chance(0.5)) crack(c, r, [88, 86, 80], [82, 98, 58]);
  },
  [T.FLOOR_WOOD]: (c, r) => {
    const cols: RGB[] = [
      [104, 79, 56],
      [112, 85, 62],
      [97, 73, 50],
    ];
    for (let row = 0; row < 4; row++) {
      const base = r.pick(cols);
      const cut = r.int(2, 13);
      for (let y = row * 4; y < row * 4 + 4; y++)
        for (let x = 0; x < S; x++) {
          const k = (r.next() - 0.5) * 6;
          let col: RGB = [base[0] + k, base[1] + k, base[2] + k];
          if (y === row * 4 + 3) col = [76, 57, 40];
          if (x === cut) col = shade(base, -0.25);
          px(c, x, y, col);
        }
    }
  },
  [T.FLOOR_MARKET]: (c, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const odd = ((x >> 3) + (y >> 3)) & 1;
        const base: RGB = odd ? [128, 126, 118] : [112, 110, 104];
        const k = (r.next() - 0.5) * 6;
        px(c, x, y, [base[0] + k, base[1] + k, base[2] + k]);
      }
    specks(c, r, [86, 84, 78], 6);
  },
  [T.FLOOR_CONCRETE]: (c, r) => {
    noise(c, r, [100, 98, 93], 7);
    if (r.chance(0.4)) for (let i = 0; i < 10; i++) px(c, 6 + r.int(-3, 3), 6 + r.int(-3, 3), [84, 82, 78], 0.7);
    specks(c, r, [116, 114, 108], 5);
  },
  [T.FLOOR_CARPET]: (c, r) => {
    noise(c, r, [86, 70, 74], 8);
    specks(c, r, [72, 58, 62], 10);
  },
  [T.FLOOR_KITCHEN]: (c, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const odd = ((x >> 2) + (y >> 2)) & 1;
        const base: RGB = odd ? [150, 146, 134] : [126, 122, 112];
        const k = (r.next() - 0.5) * 6;
        px(c, x, y, [base[0] + k, base[1] + k, base[2] + k]);
      }
  },
  [T.FLOOR_LINO]: (c, r) => {
    noise(c, r, [90, 98, 106], 6);
    for (let i = 0; i < 3; i++) {
      const x = r.int(0, 12);
      const y = r.int(0, 15);
      for (let k = 0; k < 4; k++) px(c, x + k, y, [78, 86, 94]);
    }
  },
  [T.FLOOR_BATH]: (c, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const grout = x % 4 === 0 || y % 4 === 0;
        const k = (r.next() - 0.5) * 6;
        const base: RGB = grout ? [112, 118, 118] : [146, 152, 152];
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
        const base: RGB = mortar ? [118, 100, 88] : [106, 70, 56];
        px(c, x, y, [base[0] + k, base[1] + k, base[2] + k]);
      }
  },
  [T.WALL_PLASTER]: (c, r) => wallPlain(c, r, [138, 128, 110]),
  [T.WALL_BLUE]: (c, r) => wallPlain(c, r, [104, 118, 126]),
  [T.WALL_SAGE]: (c, r) => wallPlain(c, r, [114, 122, 100]),
  [T.WALL_CONCRETE]: (c, r) => {
    wallPlain(c, r, [118, 118, 114]);
    for (let x = 0; x < S; x++) px(c, x, 8, [104, 104, 100]);
  },
  [T.WINDOW]: (c, r) => noise(c, r, [70, 70, 68], 4),
  [T.WINDOW_BROKEN]: (c, r) => {
    noise(c, r, [74, 72, 68], 6);
    specks(c, r, [150, 170, 178], 7);
  },
  [T.FENCE_WOOD]: (c, r) => grass(c, r),
  [T.FENCE_METAL]: (c, r) => painters[T.GRAVEL](c, r),
  [T.HEDGE]: (c, r) => grass(c, r, [66, 78, 48]),
  [T.RUBBLE]: (c, r) => asphalt(c, r),
};

function wallPlain(c: Ctx, r: RNG, base: RGB) {
  noise(c, r, base, 6);
  if (r.chance(0.5)) crack(c, r, shade(base, -0.25));
  if (r.chance(0.35)) for (let i = 0; i < 6; i++) px(c, r.int(0, 15), r.int(10, 15), [86, 98, 66], 0.8); // musgo
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
