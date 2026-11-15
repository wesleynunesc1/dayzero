/** Identificadores de tiles do mapa. */
export const T = {
  GRASS: 0,
  GRASS_TALL: 1,
  DIRT: 2,
  ASPHALT: 3,
  LINE_H: 4,
  LINE_V: 5,
  ASPHALT_CRACK: 6,
  SIDEWALK: 7,
  SIDEWALK_WEEDS: 8,
  PARKING: 9,
  FLOOR_WOOD: 10,
  FLOOR_MARKET: 11,
  FLOOR_CONCRETE: 12,
  FLOOR_CARPET: 13,
  FLOOR_KITCHEN: 14,
  FLOOR_LINO: 15,
  WALL_BRICK: 16,
  WALL_PLASTER: 17,
  WALL_CONCRETE: 18,
  WINDOW: 19,
  WINDOW_BROKEN: 20,
  FENCE_WOOD: 21,
  FENCE_METAL: 22,
  HEDGE: 23,
  RUBBLE: 24,
  GRAVEL: 25,
  WALL_BLUE: 26,
  WALL_SAGE: 27,
  FLOOR_BATH: 28,
  WINDOW_BOARDED: 29,
  WATER: 30,
  ROCK: 31,
  CROP: 32,
  RUNWAY: 33,
  BRIDGE: 34,
  SAND: 35,
  FLOOR_CLINIC: 36,
} as const;

export type TileId = number;
export type StepSurface = 'grass' | 'hard' | 'wood' | 'glass' | 'soft';

export interface TileDef {
  key: string;
  /** Bloqueia movimento. */
  solid: boolean;
  /** Bloqueia visão. */
  opaque: boolean;
  /** É parede (renderizada com altura). */
  wall: boolean;
  /** Custo de propagação de som ao atravessar o tile. */
  sound: number;
  step: StepSurface;
  /** Multiplicador de velocidade ao atravessar (ex.: janela quebrada). */
  slow?: number;
  /** Cerca/sebe que conecta com vizinhos ao renderizar. */
  fence?: boolean;
}

function def(key: string, o: Partial<TileDef> = {}): TileDef {
  return { key, solid: false, opaque: false, wall: false, sound: 1, step: 'hard', ...o };
}

const WALL = { solid: true, opaque: true, wall: true, sound: 6 };

export const TILES: TileDef[] = [];
TILES[T.GRASS] = def('grass', { step: 'grass' });
TILES[T.GRASS_TALL] = def('grass_tall', { step: 'grass' });
TILES[T.DIRT] = def('dirt', { step: 'grass' });
TILES[T.ASPHALT] = def('asphalt');
TILES[T.LINE_H] = def('line_h');
TILES[T.LINE_V] = def('line_v');
TILES[T.ASPHALT_CRACK] = def('asphalt_crack');
TILES[T.SIDEWALK] = def('sidewalk');
TILES[T.SIDEWALK_WEEDS] = def('sidewalk_weeds');
TILES[T.PARKING] = def('parking');
TILES[T.FLOOR_WOOD] = def('floor_wood', { step: 'wood' });
TILES[T.FLOOR_MARKET] = def('floor_market');
TILES[T.FLOOR_CONCRETE] = def('floor_concrete');
TILES[T.FLOOR_CARPET] = def('floor_carpet', { step: 'soft' });
TILES[T.FLOOR_KITCHEN] = def('floor_kitchen');
TILES[T.FLOOR_LINO] = def('floor_lino');
TILES[T.FLOOR_BATH] = def('floor_bath');
TILES[T.WALL_BRICK] = def('wall_brick', WALL);
TILES[T.WALL_PLASTER] = def('wall_plaster', WALL);
TILES[T.WALL_BLUE] = def('wall_blue', WALL);
TILES[T.WALL_SAGE] = def('wall_sage', WALL);
TILES[T.WALL_CONCRETE] = def('wall_concrete', WALL);
TILES[T.WINDOW] = def('window', { solid: true, opaque: false, wall: true, sound: 2 });
TILES[T.WINDOW_BROKEN] = def('window_broken', { solid: false, opaque: false, sound: 1, slow: 0.45, step: 'glass' });
TILES[T.WINDOW_BOARDED] = def('window_boarded', { solid: true, opaque: true, wall: true, sound: 3 });
TILES[T.WATER] = def('water', { solid: true, opaque: false, sound: 0.8 });
TILES[T.ROCK] = def('rock', { solid: true, opaque: true, sound: 4 });
TILES[T.CROP] = def('crop', { opaque: true, step: 'grass', slow: 0.75, sound: 1.3 });
TILES[T.RUNWAY] = def('runway');
TILES[T.BRIDGE] = def('bridge', { step: 'wood' });
TILES[T.SAND] = def('sand', { step: 'grass' });
TILES[T.FLOOR_CLINIC] = def('floor_clinic');
TILES[T.FENCE_WOOD] = def('fence_wood', { solid: true, opaque: false, sound: 1.2, fence: true });
TILES[T.FENCE_METAL] = def('fence_metal', { solid: true, opaque: false, sound: 1, fence: true });
TILES[T.HEDGE] = def('hedge', { solid: true, opaque: true, sound: 1.6, fence: true, step: 'grass' });
TILES[T.RUBBLE] = def('rubble', { solid: true, opaque: false, sound: 1.5 });
TILES[T.GRAVEL] = def('gravel');

export const isWallLike = (t: TileId) => TILES[t].wall;
