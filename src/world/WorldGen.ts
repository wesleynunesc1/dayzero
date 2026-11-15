import { TILE } from '../config';
import { createItem, ItemInstance } from '../data/items';
import { RNG } from '../engine/math';
import { BuildKit } from './BuildKit';
import { buildNeighborhood, BuiltWorld, MAP_H, MAP_W } from './MapBuilder';
import { T, TILES, TileId } from './tiles';
import { TileMap } from './TileMap';

/**
 * MUNDO ABERTO (Etapas 3–5). O bairro das Etapas 1–2 continua nas mesmas coordenadas
 * (canto noroeste, dentro da capital Nova Esperança) e o resto do mundo é gerado ao redor,
 * de forma determinística pela semente. Layout fixo e nomeado; detalhes procedurais.
 */
export const WORLD_W = 512;
export const WORLD_H = 384;

export type RegionId = 'oeste' | 'norte' | 'leste' | 'sul';
export const REGION_LABEL: Record<RegionId, string> = { oeste: 'Oeste', norte: 'Norte', leste: 'Leste', sul: 'Sul' };

/** Região de um tile. Oeste: capital e interior oeste; Norte: serras; Leste: aeroporto/litoral; Sul: vale e rio. */
export function regionAt(tx: number, ty: number): RegionId {
  if (tx < 200) return 'oeste';
  if (ty < 128) return 'norte';
  if (tx >= 380) return 'leste';
  return 'sul';
}

export type TownKind = 'capital' | 'cidade_media' | 'cidade_pequena' | 'vilarejo' | 'rural' | 'instalacao';
export interface Town {
  id: string;
  name: string;
  region: RegionId;
  kind: TownKind;
  zones: { x0: number; y0: number; x1: number; y1: number }[];
  population: number;
  districts: { name: string; x: number; y: number }[];
  /** Centro aproximado (tiles) — destino de hordas e referência de missões. */
  cx: number;
  cy: number;
}

export type PoiKind =
  | 'hospital' | 'escola' | 'mercantil' | 'delegacia' | 'base_militar' | 'laboratorio' | 'aeroporto'
  | 'posto' | 'oficina' | 'abrigo' | 'fazenda' | 'farmacia' | 'presidio' | 'torre';
export interface Poi {
  id: string;
  name: string;
  kind: PoiKind;
  x: number;
  y: number;
  w: number;
  h: number;
  town: string;
  region: RegionId;
}

export interface PrisonSite {
  faction: string;
  cells: { x0: number; y0: number; x1: number; y1: number; doorX: number; doorY: number; mattress: string }[];
  stash: string;
  guardPost: { x: number; y: number };
  exit: { x: number; y: number };
}

export interface FactionSite {
  faction: string;
  area: { x0: number; y0: number; x1: number; y1: number };
  restricted: { x0: number; y0: number; x1: number; y1: number }[];
  hq: { x: number; y: number };
  stock?: string;
}

export interface NpcSpawn {
  key: string;
  x: number;
  y: number;
  faction?: string;
  role: 'sobrevivente' | 'lider' | 'guarda' | 'membro' | 'prisioneiro' | 'cientista';
}

export interface WorldExtras {
  towns: Town[];
  pois: Poi[];
  prisons: PrisonSite[];
  factionSites: FactionSite[];
  npcSpawns: NpcSpawn[];
  /** Pontos de partida dos 4 sobreviventes (um por região). */
  starts: { region: RegionId; x: number; y: number; safePoint: string; town: string }[];
  /** Bancada do laboratório funcional (campanha) e gerador. */
  lab: { bench: { x: number; y: number }; generator: { x: number; y: number }; area: { x0: number; y0: number; x1: number; y1: number } };
  /** Estação de rádio de longo alcance (torre do aeroporto). */
  radioTower: { x: number; y: number };
}

const WALLS: TileId[] = [T.WALL_PLASTER, T.WALL_BLUE, T.WALL_SAGE, T.WALL_BRICK];
const ROOFS = ['#6b4a3e', '#4a4f55', '#5a3f36', '#3f4a44', '#5d4a3a', '#4e4640'];

export function buildWorld(seed: number): BuiltWorld & WorldExtras {
  const map = new TileMap(WORLD_W, WORLD_H);
  // 1) o bairro original, nas mesmas coordenadas, com saídas abertas
  const base = buildNeighborhood(seed, map);
  const rng = new RNG(seed ^ 0x5eed);
  const k = new BuildKit(base, rng);
  const ex: WorldExtras = {
    towns: [],
    pois: [],
    prisons: [],
    factionSites: [],
    npcSpawns: [],
    starts: [],
    lab: { bench: { x: 0, y: 0 }, generator: { x: 0, y: 0 }, area: { x0: 0, y0: 0, x1: 0, y1: 0 } },
    radioTower: { x: 0, y: 0 },
  };
  const inBairro = (x: number, y: number) => x < MAP_W && y < MAP_H;
  const poi = (kind: PoiKind, name: string, x: number, y: number, w: number, h: number, town: string) =>
    ex.pois.push({ id: `poi${ex.pois.length}`, name, kind, x, y, w, h, town, region: regionAt(x + (w >> 1), y + (h >> 1)) });

  // ------------------------------------------------------------ 2) terreno base
  for (let y = 0; y < WORLD_H; y++)
    for (let x = 0; x < WORLD_W; x++) {
      if (inBairro(x, y)) continue;
      const r = rng.next();
      map.set(x, y, r < 0.16 ? T.GRASS_TALL : r < 0.2 ? T.DIRT : T.GRASS);
    }
  // bordas do mundo: sebe/serra (ninguém sai do mapa)
  for (let x = 0; x < WORLD_W; x++) {
    if (!inBairro(x, 0)) map.set(x, 0, T.ROCK);
    map.set(x, WORLD_H - 1, T.HEDGE);
  }
  for (let y = 0; y < WORLD_H; y++) {
    if (!inBairro(0, y)) map.set(0, y, T.HEDGE);
    map.set(WORLD_W - 1, y, T.HEDGE);
  }

  // ------------------------------------------------------------ 3) serras do Norte
  for (let x = 200; x < WORLD_W; x++) {
    const depth = 6 + Math.round(4 * Math.sin(x / 13) + 3 * Math.sin(x / 5.3));
    for (let y = 0; y < depth; y++) map.set(x, y, T.ROCK);
  }
  // maciço da Serra Alta (com passagem pela estrada da cidade)
  for (let y = 12; y < 40; y++)
    for (let x = 200; x < 290; x++) {
      const d = Math.hypot((x - 245) / 40, (y - 18) / 18);
      if (d < 1 + 0.15 * Math.sin(x * 0.7 + y)) map.set(x, y, T.ROCK);
    }

  // ------------------------------------------------------------ 4) rio
  const riverY = (x: number) => Math.round(279 + 3 * Math.sin(x / 40) + 1.5 * Math.sin(x / 11));
  for (let x = 1; x < WORLD_W - 1; x++) {
    const c = riverY(x);
    for (let y = c - 2; y <= c + 2; y++) map.set(x, y, T.WATER);
    if (map.get(x, c - 3) !== T.WATER) map.set(x, c - 3, T.SAND);
    if (map.get(x, c + 3) !== T.WATER) map.set(x, c + 3, T.SAND);
  }

  // ------------------------------------------------------------ 5) rodovias e estradas
  const roadH = (y0: number, x0: number, x1: number, lanes = 5) => {
    for (let x = x0; x <= x1; x++) {
      if (inBairro(x, y0)) continue;
      for (let y = y0; y < y0 + lanes; y++) map.set(x, y, map.get(x, y) === T.WATER ? T.BRIDGE : y === y0 + (lanes >> 1) && x % 3 !== 2 ? T.LINE_H : rng.chance(0.08) ? T.ASPHALT_CRACK : T.ASPHALT);
      for (const sy of [y0 - 1, y0 + lanes]) {
        const t = map.get(x, sy);
        if (t === T.WATER) map.set(x, sy, T.BRIDGE);
        else if (t !== T.ASPHALT && t !== T.LINE_H && t !== T.LINE_V && t !== T.BRIDGE) map.set(x, sy, T.GRAVEL);
      }
    }
  };
  const roadV = (x0: number, y0: number, y1: number, lanes = 5) => {
    for (let y = y0; y <= y1; y++) {
      if (inBairro(x0, y)) continue;
      for (let x = x0; x < x0 + lanes; x++) map.set(x, y, map.get(x, y) === T.WATER ? T.BRIDGE : x === x0 + (lanes >> 1) && y % 3 !== 2 ? T.LINE_V : rng.chance(0.08) ? T.ASPHALT_CRACK : T.ASPHALT);
      for (const sx of [x0 - 1, x0 + lanes]) {
        const t = map.get(sx, y);
        if (t === T.WATER) map.set(sx, y, T.BRIDGE);
        else if (t !== T.ASPHALT && t !== T.LINE_H && t !== T.LINE_V && t !== T.BRIDGE) map.set(sx, y, T.GRAVEL);
      }
    }
  };
  roadH(44, 128, WORLD_W - 2); // BR-101 (continua a avenida do bairro)
  roadV(60, 96, WORLD_H - 2); // BR-232 (continua a Rua do Comércio)
  roadH(198, 65, WORLD_W - 2); // Estrada do Vale
  roadV(408, 49, 352); // Rodovia Leste
  roadV(278, 49, 197, 4); // acesso a Santa Aurora
  roadV(328, 16, 43, 4); // subida da Serra Alta
  roadV(270, 203, 358, 4); // estrada de Vale Sombrio
  roadH(88, 413, 431, 4); // acesso à Base Sentinela
  roadH(170, 413, 431, 4); // acesso ao aeroporto
  // bloqueios parciais (destroços) nas rodovias
  for (const [x, y] of [
    [230, 44], [231, 45], [232, 44], [380, 47], [381, 48], [62, 150], [61, 151], [409, 260], [410, 261], [300, 200], [301, 201],
  ])
    map.set(x, y, T.RUBBLE);

  // ------------------------------------------------------------ 6) construtores de edifícios
  const freeCell = (x: number, y: number) => {
    if (map.solid(x, y)) return false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (map.doorAt(x + dx, y + dy)) return false;
    return true;
  };
  /** Coloca um móvel/recipiente encostado numa linha livre do cômodo. */
  const furnish = (x0: number, y0: number, x1: number, y1: number, items: { w: number; place: (x: number, y: number) => void }[]) => {
    const rows = [y0, y1, ...Array.from({ length: Math.max(0, y1 - y0 - 1) }, (_, i) => y0 + 1 + i)];
    for (const it of items) {
      let done = false;
      for (const y of rows) {
        for (let x = x0; x + it.w - 1 <= x1 && !done; x++) {
          let ok = true;
          for (let i = 0; i < it.w; i++) if (!freeCell(x + i, y)) ok = false;
          // não fecha a passagem: mantém a linha do meio livre em cômodos estreitos
          if (ok && y !== y0 && y !== y1 && y1 - y0 < 4) ok = false;
          if (ok) {
            it.place(x, y);
            done = true;
          }
        }
        if (done) break;
      }
    }
  };
  const C = (kind: string, visual: string, w = 1, o: Parameters<BuildKit['container']>[6] = {}) => ({ w, place: (x: number, y: number) => k.container(kind, x, y, w, 1, visual, o) });
  const P = (kind: string, w = 1, h = 1, o = {}) => ({ w, place: (x: number, y: number) => k.prop(kind, x, y, w, h, o) });
  const doorSide = (x0: number, y0: number, x1: number, y1: number): 'S' | 'N' | 'E' | 'W' => {
    const road = (x: number, y: number) => {
      const t = map.get(x, y);
      return t === T.SIDEWALK || t === T.ASPHALT || t === T.GRAVEL || t === T.LINE_H || t === T.LINE_V || t === T.SIDEWALK_WEEDS;
    };
    const score = { S: 0, N: 0, E: 0, W: 0 };
    for (let d = 1; d <= 4; d++) {
      for (let x = x0; x <= x1; x++) {
        if (road(x, y1 + d)) score.S++;
        if (road(x, y0 - d)) score.N++;
      }
      for (let y = y0; y <= y1; y++) {
        if (road(x1 + d, y)) score.E++;
        if (road(x0 - d, y)) score.W++;
      }
    }
    return (Object.entries(score).sort((a, b) => b[1] - a[1])[0][0] as 'S') ?? 'S';
  };
  const windows = (x0: number, y0: number, x1: number, y1: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const side = rng.int(0, 3);
      const x = side < 2 ? rng.int(x0 + 2, x1 - 2) : side === 2 ? x0 : x1;
      const y = side >= 2 ? rng.int(y0 + 2, y1 - 2) : side === 0 ? y0 : y1;
      if (!map.doorAt(x - 1, y) && !map.doorAt(x + 1, y) && !map.doorAt(x, y - 1) && !map.doorAt(x, y + 1)) k.win(x, y);
    }
  };
  const frontDoor = (b: number, x0: number, y0: number, x1: number, y1: number, side: string, at = 0.3, label = 'Porta da frente', hp = 90) => {
    const fx = side === 'S' || side === 'N' ? Math.max(x0 + 1, Math.min(x1 - 1, Math.round(x0 + (x1 - x0) * at))) : side === 'E' ? x1 : x0;
    const fy = side === 'E' || side === 'W' ? Math.max(y0 + 1, Math.min(y1 - 1, Math.round(y0 + (y1 - y0) * (1 - at)))) : side === 'S' ? y1 : y0;
    k.door(fx, fy, b, label, hp);
    // caminho até a rua
    const [dx, dy] = side === 'S' ? [0, 1] : side === 'N' ? [0, -1] : side === 'E' ? [1, 0] : [-1, 0];
    for (let i = 1; i <= 4; i++) {
      const px = fx + dx * i;
      const py = fy + dy * i;
      if (k.isNatural(px, py)) map.set(px, py, T.DIRT);
      else break;
    }
    return { fx, fy };
  };

  /** Casa com sala, cozinha e quarto. Retorna o id do edifício e um ponto interno. */
  const house = (name: string, x0: number, y0: number, w: number, h: number, town: string, extra: ItemInstance[] = []) => {
    const x1 = x0 + w - 1;
    const y1 = y0 + h - 1;
    const wall = rng.pick(WALLS);
    const b = k.building(name, 'casa', x0, y0, x1, y1, wall, T.FLOOR_WOOD, rng.pick(ROOFS));
    const vx = x0 + Math.floor(w * 0.52);
    const hy = y0 + Math.floor(h / 2);
    for (let y = y0 + 1; y < y1; y++) map.set(vx, y, wall);
    for (let x = vx + 1; x < x1; x++) map.set(x, hy, wall);
    k.fill(vx + 1, y0 + 1, x1 - 1, hy - 1, T.FLOOR_KITCHEN);
    k.fill(vx + 1, hy + 1, x1 - 1, y1 - 1, T.FLOOR_CARPET);
    k.door(vx, y0 + 2 <= hy - 1 ? y0 + 2 : y0 + 1, b, 'Porta da cozinha', 50);
    k.door(vx, Math.min(y1 - 1, hy + 2), b, 'Porta do quarto', 50);
    const side = doorSide(x0, y0, x1, y1);
    if (side === 'E') frontDoor(b, x0, hy, x1, y1, 'E', 0.5);
    else frontDoor(b, x0, y0, vx, y1, side, 0.4);
    windows(x0, y0, x1, y1, 4);
    furnish(x0 + 1, y0 + 1, vx - 1, y1 - 1, [C('estante', 'shelf_home', 2), P('sofa', 1, 1, { name: 'Sofá' })]);
    furnish(vx + 1, y0 + 1, x1 - 1, hy - 1, [C('armario_cozinha', 'counter_cab', 2), C('geladeira', 'fridge'), P('stove')]);
    furnish(vx + 1, hy + 1, x1 - 1, y1 - 1, [P('bed', 2, 1, { name: 'Cama' }), C('guarda_roupa', 'wardrobe', 2), C('comoda', 'dresser', 1, { items: extra })]);
    return { b, ix: x0 + 2, iy: y1 - 2 };
  };

  /** Edifício grande com corredor central e salas dos dois lados. */
  const hallBuilding = (
    name: string,
    kind: 'casa' | 'mercantil' | 'delegacia' | 'deposito',
    x0: number,
    y0: number,
    w: number,
    h: number,
    floor: TileId,
    wall: TileId,
    roomW: number,
    fillRoom: (i: number, rx0: number, ry0: number, rx1: number, ry1: number, top: boolean) => void,
    roof = '#55585a',
  ) => {
    const x1 = x0 + w - 1;
    const y1 = y0 + h - 1;
    const b = k.building(name, kind, x0, y0, x1, y1, wall, floor, roof, 'flat');
    const cy = y0 + Math.floor(h / 2) - 1;
    for (let x = x0 + 1; x < x1; x++) {
      map.set(x, cy - 1, wall);
      map.set(x, cy + 3, wall);
    }
    let i = 0;
    for (let rx = x0 + 1; rx < x1 - 2; rx += roomW) {
      const rx1 = Math.min(x1 - 1, rx + roomW - 2);
      if (rx1 + 1 < x1) {
        for (let y = y0 + 1; y < cy - 1; y++) map.set(rx1 + 1, y, wall);
        for (let y = cy + 4; y < y1; y++) map.set(rx1 + 1, y, wall);
      }
      const dx = rx + Math.floor((rx1 - rx) / 2);
      if (cy - 2 > y0) {
        k.door(dx, cy - 1, b, 'Porta', 55);
        fillRoom(i++, rx, y0 + 1, rx1, cy - 2, true);
      }
      if (cy + 4 < y1) {
        k.door(dx, cy + 3, b, 'Porta', 55);
        fillRoom(i++, rx, cy + 4, rx1, y1 - 1, false);
      }
    }
    k.door(x0, cy + 1, b, 'Entrada', 90);
    k.door(x1, cy + 1, b, 'Entrada', 90);
    windows(x0, y0, x1, y1, Math.floor(w / 3));
    return b;
  };

  const store = (name: string, x0: number, y0: number, w: number, h: number, kind: 'mercantil' | 'farmacia', town: string) => {
    const x1 = x0 + w - 1;
    const y1 = y0 + h - 1;
    const b = k.building(name, 'mercantil', x0, y0, x1, y1, T.WALL_BRICK, T.FLOOR_MARKET, '#5d5a55', 'flat');
    const side = doorSide(x0, y0, x1, y1);
    frontDoor(b, x0, y0, x1, y1, side, 0.5, 'Porta de vidro', 50);
    windows(x0, y0, x1, y1, 6);
    if (kind === 'mercantil') {
      for (let y = y0 + 2; y < y1 - 2; y += 3) for (let x = x0 + 2; x + 3 < x1 - 1; x += 5) if ([0, 1, 2, 3].every((i) => freeCell(x + i, y))) k.container('prateleira_mercado', x, y, 4, 1, 'gondola');
      furnish(x0 + 1, y0 + 1, x1 - 1, y1 - 1, [C('refrigerador', 'fridge'), C('caixa_registradora', 'register'), C('hortifruti', 'produce', 2)]);
    } else {
      for (let y = y0 + 2; y < y1 - 1; y += 3) for (let x = x0 + 2; x + 2 < x1 - 1; x += 4) if ([0, 1, 2].every((i) => freeCell(x + i, y))) k.container('farmacia', x, y, 3, 1, 'gondola', { name: 'Prateleira da farmácia' });
    }
    poi(kind, name, x0, y0, w, h, town);
    return b;
  };

  const lots = (zx0: number, zy0: number, zx1: number, zy1: number, town: string, density: number, shopChance = 0.12) => {
    // ruas em grade (só em terreno natural, sem cortar construções)
    const step = 22;
    for (let gx = zx0; gx <= zx1; gx += step) {
      k.fillNatural(gx - 1, zy0, gx - 1, zy1, T.SIDEWALK);
      k.fillNatural(gx, zy0, gx + 3, zy1, T.ASPHALT);
      k.fillNatural(gx + 4, zy0, gx + 4, zy1, T.SIDEWALK);
    }
    for (let gy = zy0; gy <= zy1; gy += step) {
      k.fillNatural(zx0, gy - 1, zx1, gy - 1, T.SIDEWALK);
      k.fillNatural(zx0, gy, zx1, gy + 3, T.ASPHALT);
      k.fillNatural(zx0, gy + 4, zx1, gy + 4, T.SIDEWALK);
    }
    // um edifício por quadra (lote com quintal ao redor)
    for (let gy = zy0; gy + step <= zy1 + 4; gy += step)
      for (let gx = zx0; gx + step <= zx1 + 4; gx += step) {
        if (!rng.chance(density)) continue;
        const bx0 = gx + 6;
        const by0 = gy + 6;
        const bw = step - 9;
        const w = rng.int(10, Math.min(13, bw));
        const h = rng.int(9, Math.min(11, bw));
        const x = bx0 + rng.int(0, Math.max(0, bw - w));
        const y = by0 + rng.int(0, Math.max(0, bw - h));
        if (x + w > zx1 || y + h > zy1) continue;
        if (!k.areaFree(x - 1, y - 1, x + w, y + h)) continue;
        if (rng.chance(shopChance)) store(`Loja (${town})`, x, y, w, h, rng.chance(0.5) ? 'farmacia' : 'mercantil', town);
        else house(`Casa (${town})`, x, y, w, h, town);
        // quintal: árvores e cerca baixa
        if (rng.chance(0.5)) k.tree(x - 1 + rng.int(0, w), y + h + 1);
      }
  };

  const fence = (x0: number, y0: number, x1: number, y1: number, t: TileId, gates: [number, number][]) => {
    for (let x = x0; x <= x1; x++)
      for (const y of [y0, y1]) if (k.isNatural(x, y) || map.get(x, y) === T.GRAVEL) map.set(x, y, t);
    for (let y = y0; y <= y1; y++)
      for (const x of [x0, x1]) if (k.isNatural(x, y) || map.get(x, y) === T.GRAVEL) map.set(x, y, t);
    for (const [gx, gy] of gates) map.set(gx, gy, T.GRAVEL);
  };

  const town = (t: Omit<Town, 'cx' | 'cy'>) => {
    const z = t.zones[0];
    const town: Town = { ...t, cx: Math.round((z.x0 + z.x1) / 2), cy: Math.round((z.y0 + z.y1) / 2) };
    ex.towns.push(town);
    for (const d of t.districts) k.label(d.name, d.x, d.y);
    return town;
  };
  const safe = (id: string, name: string, x: number, y: number, b: number, discovered = false) =>
    base.safePoints.push({ id, name, x: x * TILE + 8, y: y * TILE + 8, building: b, discovered, lastVisit: 0 });

  // ============================================================ NOVA ESPERANÇA (capital, Oeste)
  {
    const tn = 'Nova Esperança';
    // Hospital Central
    hallBuilding('Hospital Central', 'delegacia', 140, 60, 30, 20, T.FLOOR_CLINIC, T.WALL_CONCRETE, 6, (i, x0, y0, x1, y1) => {
      furnish(x0, y0, x1, y1, [P('bed', 2, 1, { name: 'Leito' }), C('hospital', 'bath_cab'), i % 3 === 0 ? C('hospital', 'filing') : P('table_small')]);
    }, '#7a7c78');
    poi('hospital', 'Hospital Central', 140, 60, 30, 20, tn);
    // Escola Municipal (abrigo improvisado)
    const esc = hallBuilding('Escola Municipal', 'casa', 182, 60, 24, 16, T.FLOOR_LINO, T.WALL_PLASTER, 6, (i, x0, y0, x1, y1) => {
      furnish(x0, y0, x1, y1, [P('desk', 2), P('desk', 2), i === 0 ? C('escritorio', 'filing', 1, { items: [createItem('mapa_regional', 1)] }) : C('estante', 'shelf_home', 2)]);
    }, '#6a5a4a');
    poi('escola', 'Escola Municipal', 182, 60, 24, 16, tn);
    safe('sp_escola_ne', 'Escola Municipal (Nova Esperança)', 185, 67, esc);
    // mapa desatualizado do mundo na diretoria
    const escCont = [...base.containers.values()].reverse().find((c) => c.building === esc && c.kind === 'escritorio');
    if (escCont) escCont.inv.items.forEach((it) => it.defId === 'mapa_regional' && (it.state = { region: 'mundo', cond: 'desatualizado', pieces: 15 }));
    // Oficina
    {
      const b = k.building('Oficina Central', 'deposito', 20, 110, 35, 121, T.WALL_BRICK, T.FLOOR_CONCRETE, '#4f5357', 'flat');
      frontDoor(b, 20, 110, 35, 121, doorSide(20, 110, 35, 121), 0.5, 'Portão da oficina', 120);
      windows(20, 110, 35, 121, 4);
      furnish(21, 111, 34, 120, [C('bancada', 'workbench', 4), C('caixa_ferramentas', 'toolbox'), C('estante_ferramentas', 'rack', 3), C('caixote', 'crate', 1, { items: [k.item('galao_gasolina', 1, { fuel: 3 })] })]);
      poi('oficina', 'Oficina Central', 20, 110, 16, 12, tn);
    }
    // Posto Rodovia (BR-101)
    {
      const b = k.building('Posto Rodovia — conveniência', 'mercantil', 150, 32, 159, 40, T.WALL_PLASTER, T.FLOOR_MARKET, '#7a3a30', 'flat');
      k.door(154, 40, b, 'Porta de vidro', 50);
      windows(150, 32, 159, 40, 3);
      furnish(151, 33, 158, 39, [C('prateleira_mercado', 'gondola', 3), C('caixa_registradora', 'register', 1, { items: [createItem('mapa_regional', 1)] }), C('refrigerador', 'fridge')]);
      const reg = [...base.containers.values()].reverse().find((c) => c.building === b && c.kind === 'caixa_registradora');
      reg?.inv.items.forEach((it) => it.defId === 'mapa_regional' && (it.state = { region: 'oeste', cond: 'completo', pieces: 15 }));
      k.prop('fuel_tank', 162, 34, 2, 2, { name: 'Tanque subterrâneo do posto', desc: 'Tampa do tanque de combustível. Sem energia, as bombas não funcionam — mas uma mangueira alcança o fundo.', fuel: 140 });
      for (const x of [151, 155, 159]) k.prop('fuel_pump', x, 42, 1, 1, { name: 'Bomba de combustível', desc: 'Sem energia elétrica, a bomba não funciona.' });
      poi('posto', 'Posto Rodovia', 150, 32, 14, 11, tn);
    }
    store('Mercantil do Centro', 184, 100, 18, 14, 'mercantil', tn);
    store('Farmácia Popular', 140, 100, 11, 9, 'farmacia', tn);
    lots(130, 2, 225, 42, tn, 0.92);
    lots(130, 52, 225, 168, tn, 0.92);
    lots(2, 100, 57, 168, tn, 0.92);
    lots(68, 100, 127, 168, tn, 0.92);
    town({
      id: 'nova_esperanca', name: 'Nova Esperança', region: 'oeste', kind: 'capital',
      zones: [{ x0: 0, y0: 0, x1: 225, y1: 168 }], population: 480000,
      districts: [{ name: 'Bairro das Acácias', x: 40, y: 8 }, { name: 'Centro', x: 165, y: 52 }, { name: 'Vila Operária', x: 40, y: 104 }],
    });
  }

  // ============================================================ SANTA AURORA (Sul)
  {
    const tn = 'Santa Aurora';
    const hb = hallBuilding('Hospital Santa Aurora', 'delegacia', 290, 158, 30, 20, T.FLOOR_CLINIC, T.WALL_CONCRETE, 6, (i, x0, y0, x1, y1) => {
      const extra: ItemInstance[] = [];
      if (i === 1) extra.push(createItem('prontuario_zero'));
      if (i === 4) extra.push(createItem('amostra_viral'));
      furnish(x0, y0, x1, y1, [P('bed', 2, 1, { name: 'Leito' }), C('hospital', i === 4 ? 'freezer' : 'bath_cab', 1, { items: extra, name: i === 4 ? 'Geladeira de amostras' : i === 1 ? 'Arquivo médico' : undefined })]);
    }, '#7a7c78');
    poi('hospital', 'Hospital Santa Aurora', 290, 158, 30, 20, tn);
    void hb;
    // Comunidade Aurora: escola cercada
    fence(226, 210, 264, 242, T.FENCE_METAL, [[244, 210], [245, 210]]);
    const sch = hallBuilding('Escola Estadual (Comunidade Aurora)', 'casa', 230, 215, 30, 22, T.FLOOR_LINO, T.WALL_PLASTER, 7, (i, x0, y0, x1, y1) => {
      if (i === 0) k.container('estoque_faccao', x0, y0, 3, 1, 'rack', { name: 'Estoque da comunidade', owner: 'aurora' });
      furnish(x0, y0, x1, y1, [P('bed', 2, 1, { name: 'Colchonete' }), P('bed', 2, 1, { name: 'Colchonete' }), C('comoda', 'dresser', 1, { owner: 'aurora' })]);
    }, '#6a5a4a');
    poi('escola', 'Escola Estadual (Comunidade Aurora)', 230, 215, 30, 22, tn);
    poi('abrigo', 'Comunidade Aurora', 226, 210, 39, 33, tn);
    ex.factionSites.push({ faction: 'aurora', area: { x0: 226, y0: 210, x1: 264, y1: 242 }, restricted: [{ x0: 231, y0: 216, x1: 236, y1: 224 }], hq: { x: 245, y: 227 }, stock: [...base.containers.values()].reverse().find((c) => c.owner === 'aurora' && c.kind === 'estoque_faccao')?.id });
    void sch;
    store('Mercantil Aurora', 236, 162, 18, 13, 'mercantil', tn);
    store('Farmácia Santa Aurora', 260, 180, 10, 9, 'farmacia', tn);
    // delegacia
    hallBuilding('Delegacia de Santa Aurora', 'delegacia', 300, 214, 18, 12, T.FLOOR_LINO, T.WALL_CONCRETE, 6, (i, x0, y0, x1, y1) => {
      furnish(x0, y0, x1, y1, [i === 0 ? C('armario_armas', 'gun_cab', 1) : C('armario_pessoal', 'locker', 1, i === 1 ? { items: [createItem('radio'), createItem('pilhas', 2)] } : {}), C('mesa', 'desk', 2)]);
    });
    poi('delegacia', 'Delegacia de Santa Aurora', 300, 214, 18, 12, tn);
    // casa inicial do sobrevivente do Sul
    const st = house('Casa dos Moura', 300, 236, 12, 10, tn, [createItem('agua'), createItem('biscoito', 2)]);
    safe('sp_sul', 'Casa dos Moura (Santa Aurora)', st.ix, st.iy, st.b, true);
    ex.starts.push({ region: 'sul', x: st.ix, y: st.iy, safePoint: 'sp_sul', town: tn });
    lots(222, 150, 340, 256, tn, 0.92);
    // mapa rasgado do Sul + pedaços espalhados
    const sm = [...base.containers.values()].find((c) => c.building >= 0 && base.buildings[c.building].name === 'Mercantil Aurora' && c.kind === 'caixa_registradora');
    sm?.inv.items.push(Object.assign(createItem('mapa_regional'), { state: { region: 'sul', cond: 'rasgado', pieces: 3 } }));
    town({
      id: 'santa_aurora', name: 'Santa Aurora', region: 'sul', kind: 'cidade_media',
      zones: [{ x0: 222, y0: 150, x1: 340, y1: 256 }], population: 160000,
      districts: [{ name: 'Santa Aurora', x: 281, y: 150 }, { name: 'Jardim das Flores', x: 250, y: 250 }],
    });
  }

  // ============================================================ VALE SOMBRIO (Sul) — Os Abutres
  {
    const tn = 'Vale Sombrio';
    fence(284, 316, 320, 354, T.FENCE_METAL, [[284, 335], [284, 336]]);
    const pb = k.building('Presídio Regional de Vale Sombrio', 'delegacia', 289, 321, 316, 349, T.WALL_CONCRETE, T.FLOOR_CONCRETE, '#4e5052', 'flat');
    k.door(289, 335, pb, 'Portão do presídio', 140);
    windows(289, 321, 316, 349, 6);
    // celas (ala norte) — porta trancada pela facção
    const cells: PrisonSite['cells'] = [];
    for (let i = 0; i < 4; i++) {
      const cx0 = 291 + i * 6;
      for (let y = 322; y <= 327; y++) map.set(cx0 + 4, y, T.WALL_CONCRETE);
      for (let x = cx0; x <= cx0 + 4; x++) map.set(x, 328, T.WALL_CONCRETE);
      const d = k.door(cx0 + 2, 328, pb, 'Porta da cela', 160);
      d.locked = 'abutres';
      const m = k.container('colchao', cx0, 322, 2, 1, 'bed', { name: 'Colchão da cela', items: i === 1 ? [createItem('grampo')] : [] });
      cells.push({ x0: cx0, y0: 322, x1: cx0 + 3, y1: 327, doorX: cx0 + 2, doorY: 328, mattress: m.id });
    }
    const stash = k.container('apreensoes', 308, 345, 3, 1, 'locker_wide', { name: 'Depósito de apreensões', owner: 'abutres' });
    k.container('estoque_faccao', 300, 345, 3, 1, 'rack', { name: 'Estoque dos Abutres', owner: 'abutres' });
    k.container('armario_armas', 312, 340, 1, 2, 'gun_cab', { name: 'Arsenal dos Abutres', owner: 'abutres', items: [createItem('municao_9mm', 12)] });
    ex.prisons.push({ faction: 'abutres', cells, stash: stash.id, guardPost: { x: 300, y: 331 }, exit: { x: 280, y: 336 } });
    ex.factionSites.push({ faction: 'abutres', area: { x0: 284, y0: 316, x1: 320, y1: 354 }, restricted: [{ x0: 284, y0: 316, x1: 320, y1: 354 }], hq: { x: 302, y: 340 }, stock: [...base.containers.values()].reverse().find((c) => c.owner === 'abutres' && c.kind === 'estoque_faccao')?.id });
    poi('presidio', 'Presídio Regional (Os Abutres)', 284, 316, 37, 39, tn);
    store('Mercearia do Vale', 246, 306, 14, 11, 'mercantil', tn);
    lots(236, 300, 282, 358, tn, 0.92);
    town({ id: 'vale_sombrio', name: 'Vale Sombrio', region: 'sul', kind: 'cidade_pequena', zones: [{ x0: 236, y0: 300, x1: 320, y1: 358 }], population: 28000, districts: [{ name: 'Vale Sombrio', x: 262, y: 298 }] });
  }

  // ============================================================ SERRA ALTA (Norte)
  {
    const tn = 'Serra Alta';
    const ig = k.building('Igreja da Serra (abrigo)', 'casa', 340, 18, 351, 30, T.WALL_PLASTER, T.FLOOR_WOOD, '#5a4a3e');
    frontDoor(ig, 340, 18, 351, 30, 'S', 0.5, 'Porta da igreja', 100);
    for (let y = 21; y < 29; y += 2) k.prop('bench', 342, y, 3, 1, { name: 'Banco da igreja' }), k.prop('bench', 347, y, 3, 1, { name: 'Banco da igreja' });
    k.container('bau', 341, 19, 2, 1, 'chest', { name: 'Baú da paróquia', items: [createItem('velas', 3), createItem('agua'), createItem('radio'), createItem('pilhas', 1)] });
    safe('sp_igreja', 'Igreja da Serra (abrigo)', 345, 28, ig);
    poi('abrigo', 'Igreja da Serra', 340, 18, 12, 13, tn);
    store('Mercearia da Serra', 357, 20, 13, 10, 'mercantil', tn);
    const st = house('Casa dos Andrade', 307, 22, 12, 10, tn, [createItem('agua'), createItem('sardinha', 2), Object.assign(createItem('mapa_regional'), { state: { region: 'norte', cond: 'molhado', pieces: 15 } })]);
    safe('sp_norte', 'Casa dos Andrade (Serra Alta)', st.ix, st.iy, st.b, true);
    ex.starts.push({ region: 'norte', x: st.ix, y: st.iy, safePoint: 'sp_norte', town: tn });
    lots(296, 16, 392, 42, tn, 0.92);
    town({ id: 'serra_alta', name: 'Serra Alta', region: 'norte', kind: 'cidade_pequena', zones: [{ x0: 296, y0: 14, x1: 392, y1: 42 }], population: 22000, districts: [{ name: 'Serra Alta', x: 345, y: 13 }] });
  }

  // ============================================================ BASE MILITAR SENTINELA (Norte)
  {
    fence(430, 54, 506, 124, T.FENCE_METAL, [[430, 89], [430, 90]]);
    k.fillNatural(431, 55, 505, 123, T.GRAVEL);
    const q = hallBuilding('Quartel Sentinela', 'deposito', 438, 60, 28, 16, T.FLOOR_CONCRETE, T.WALL_CONCRETE, 7, (i, x0, y0, x1, y1) => {
      furnish(x0, y0, x1, y1, [P('bed', 2, 1, { name: 'Beliche' }), C('militar', 'locker', 1, { owner: 'sentinela' }), C('militar', 'locker', 1, { owner: 'sentinela' })]);
    }, '#4a5040');
    void q;
    // comando + paiol (restrito)
    const cmd = k.building('Comando Sentinela', 'deposito', 472, 60, 498, 78, T.WALL_CONCRETE, T.FLOOR_LINO, '#4a5040', 'flat');
    k.door(472, 70, cmd, 'Porta do comando', 120);
    for (let y = 61; y < 78; y++) map.set(486, y, T.WALL_CONCRETE);
    const pd = k.door(486, 70, cmd, 'Porta do paiol', 200);
    pd.locked = 'sentinela';
    windows(472, 60, 498, 78, 5);
    k.container('armario_armas', 495, 62, 1, 3, 'gun_cab', { name: 'Paiol (R-4)', owner: 'sentinela', loot: false, items: [createItem('reagente_r4'), createItem('ordem_militar'), createItem('rifle', 1, 0.9), createItem('municao_308', 10)] });
    k.container('escritorio', 474, 62, 2, 1, 'desk', { name: 'Mesa do comandante', owner: 'sentinela', items: [Object.assign(createItem('mapa_regional'), { state: { region: 'mundo', cond: 'completo', pieces: 15 } })] });
    k.prop('radio_station', 478, 62, 2, 1, { name: 'Estação de rádio da base', desc: 'Rádio de longo alcance da base. Só funciona com autorização (e energia).' });
    // bloco de celas
    const pb = k.building('Bloco de detenção', 'delegacia', 440, 92, 468, 112, T.WALL_CONCRETE, T.FLOOR_CONCRETE, '#4a5040', 'flat');
    k.door(454, 112, pb, 'Porta do bloco', 150);
    const cells: PrisonSite['cells'] = [];
    for (let i = 0; i < 4; i++) {
      const cx0 = 441 + i * 7;
      for (let y = 93; y <= 99; y++) map.set(cx0 + 5, y, T.WALL_CONCRETE);
      for (let x = cx0; x <= cx0 + 5; x++) map.set(x, 100, T.WALL_CONCRETE);
      const d = k.door(cx0 + 2, 100, pb, 'Porta da cela', 180);
      d.locked = 'sentinela';
      const m = k.container('colchao', cx0, 93, 2, 1, 'bed', { name: 'Colchão da cela', items: i === 2 ? [createItem('grampo')] : [] });
      cells.push({ x0: cx0, y0: 93, x1: cx0 + 4, y1: 99, doorX: cx0 + 2, doorY: 100, mattress: m.id });
    }
    const stash = k.container('apreensoes', 460, 108, 3, 1, 'locker_wide', { name: 'Depósito de apreensões', owner: 'sentinela' });
    k.container('armario_pessoal', 443, 108, 1, 1, 'locker', { name: 'Armário do carcereiro', owner: 'sentinela', items: [createItem('chave_celas')] });
    ex.prisons.push({ faction: 'sentinela', cells, stash: stash.id, guardPost: { x: 452, y: 104 }, exit: { x: 425, y: 90 } });
    k.container('estoque_faccao', 480, 90, 4, 1, 'rack', { name: 'Almoxarifado da base', owner: 'sentinela' });
    for (const [x, y] of [[480, 100], [490, 100]]) k.car(x, y, true, { military: true, trunk: true });
    ex.factionSites.push({ faction: 'sentinela', area: { x0: 430, y0: 54, x1: 506, y1: 124 }, restricted: [{ x0: 472, y0: 60, x1: 498, y1: 78 }, { x0: 440, y0: 92, x1: 468, y1: 112 }], hq: { x: 478, y: 70 }, stock: [...base.containers.values()].reverse().find((c) => c.owner === 'sentinela' && c.kind === 'estoque_faccao')?.id });
    poi('base_militar', 'Base Militar Sentinela', 430, 54, 77, 71, 'Base Sentinela');
    k.label('Base Sentinela', 468, 52);
    town({ id: 'base_sentinela', name: 'Base Sentinela', region: 'norte', kind: 'instalacao', zones: [{ x0: 430, y0: 54, x1: 506, y1: 124 }], population: 900, districts: [] });
  }

  // ============================================================ AEROPORTO (Leste)
  {
    k.fill(420, 150, 505, 156, T.RUNWAY);
    for (let x = 422; x < 504; x += 4) map.set(x, 153, T.LINE_H);
    const term = hallBuilding('Terminal do Aeroporto', 'mercantil', 430, 162, 26, 14, T.FLOOR_MARKET, T.WALL_CONCRETE, 6, (i, x0, y0, x1, y1) => {
      furnish(x0, y0, x1, y1, [P('bench', 3), i === 2 ? C('escritorio', 'desk', 2, { items: [Object.assign(createItem('mapa_regional'), { state: { region: 'leste', cond: 'queimado', pieces: 15 } })] }) : C('caixote', 'crate')]);
    });
    void term;
    poi('aeroporto', 'Aeroporto Regional', 420, 135, 86, 52, 'Aeroporto');
    const hg = k.building('Hangar (Equipe Vitalis)', 'deposito', 466, 160, 495, 184, T.WALL_CONCRETE, T.FLOOR_CONCRETE, '#4f5357', 'flat');
    k.door(480, 160, hg, 'Portão do hangar', 140);
    k.door(466, 172, hg, 'Porta lateral', 90);
    k.container('estoque_faccao', 470, 180, 4, 1, 'rack', { name: 'Suprimentos da Equipe Vitalis', owner: 'vitalis' });
    k.container('laboratorio', 486, 164, 3, 1, 'workbench', { name: 'Bancada improvisada', owner: 'vitalis', items: [createItem('relatorio_vitalis')] });
    for (let i = 0; i < 4; i++) k.prop('bed', 470 + i * 5, 166, 2, 1, { name: 'Catre' });
    ex.factionSites.push({ faction: 'vitalis', area: { x0: 466, y0: 160, x1: 495, y1: 184 }, restricted: [{ x0: 484, y0: 162, x1: 494, y1: 168 }], hq: { x: 478, y: 174 } });
    // torre de controle com rádio de longo alcance
    const tw = k.building('Torre de controle', 'casa', 458, 136, 464, 142, T.WALL_CONCRETE, T.FLOOR_LINO, '#55585a', 'flat');
    k.door(461, 142, tw, 'Porta da torre', 100);
    k.prop('radio_station', 459, 137, 2, 1, { name: 'Rádio da torre', desc: 'Transmissor de longo alcance. Precisa de bateria ou gerador.' });
    ex.radioTower = { x: 461, y: 139 };
    poi('torre', 'Torre de controle', 458, 136, 7, 7, 'Aeroporto');
    k.label('Aeroporto Regional', 462, 132);
    town({ id: 'aeroporto', name: 'Aeroporto Regional', region: 'leste', kind: 'instalacao', zones: [{ x0: 420, y0: 132, x1: 505, y1: 190 }], population: 3000, districts: [] });
  }

  // ============================================================ INSTITUTO VITALIS (Leste) — laboratório
  {
    fence(425, 208, 470, 250, T.FENCE_METAL, [[447, 208], [448, 208]]);
    const lb = hallBuilding('Instituto Vitalis', 'deposito', 430, 214, 34, 30, T.FLOOR_CLINIC, T.WALL_CONCRETE, 8, (i, x0, y0, x1, y1) => {
      const extra: ItemInstance[] = [];
      if (i === 3) extra.push(createItem('centrifuga'));
      furnish(x0, y0, x1, y1, [C('laboratorio', 'workbench', 3, { items: extra, name: i === 3 ? 'Almoxarifado do laboratório' : undefined }), C('escritorio', 'filing')]);
    }, '#7a7c78');
    void lb;
    ex.lab = { bench: { x: 436, y: 222 }, generator: { x: 452, y: 248 }, area: { x0: 430, y0: 214, x1: 463, y1: 243 } };
    k.prop('lab_bench', 436, 222, 3, 1, { name: 'Bancada de síntese', desc: 'Equipamento de síntese do Instituto. Precisa de energia do gerador.' });
    k.prop('generator', 452, 247, 2, 1, { name: 'Gerador do Instituto', desc: 'Gerador a diesel/gasolina que alimenta o laboratório.' });
    poi('laboratorio', 'Instituto Vitalis', 425, 208, 46, 43, 'Instituto Vitalis');
    k.label('Instituto Vitalis', 447, 205);
    town({ id: 'vitalis', name: 'Instituto Vitalis', region: 'leste', kind: 'instalacao', zones: [{ x0: 425, y0: 208, x1: 470, y1: 250 }], population: 400, districts: [] });
  }

  // ============================================================ PORTO LESTE (vilarejo, Leste)
  {
    const tn = 'Porto Leste';
    const st = house('Casa dos Lima', 430, 312, 12, 10, tn, [createItem('agua'), createItem('feijao_lata')]);
    safe('sp_leste', 'Casa dos Lima (Porto Leste)', st.ix, st.iy, st.b, true);
    ex.starts.push({ region: 'leste', x: st.ix, y: st.iy, safePoint: 'sp_leste', town: tn });
    {
      const b = k.building('Oficina do Porto', 'deposito', 470, 300, 485, 311, T.WALL_BRICK, T.FLOOR_CONCRETE, '#4f5357', 'flat');
      frontDoor(b, 470, 300, 485, 311, doorSide(470, 300, 485, 311), 0.5, 'Portão da oficina', 120);
      furnish(471, 301, 484, 310, [C('bancada', 'workbench', 4), C('caixa_ferramentas', 'toolbox', 1, { items: [createItem('radio'), createItem('pilhas', 1)] }), C('caixote', 'crate', 1, { items: [k.item('galao_gasolina', 1, { fuel: 5 })] })]);
      poi('oficina', 'Oficina do Porto', 470, 300, 16, 12, tn);
    }
    store('Mercadinho do Porto', 450, 330, 14, 10, 'mercantil', tn);
    lots(416, 296, 505, 352, tn, 0.92);
    town({ id: 'porto_leste', name: 'Porto Leste', region: 'leste', kind: 'vilarejo', zones: [{ x0: 416, y0: 296, x1: 505, y1: 352 }], population: 9000, districts: [{ name: 'Porto Leste', x: 460, y: 294 }] });
  }

  // ============================================================ PEDRA BRANCA (vilarejo, Oeste) + Posto Sul
  {
    const tn = 'Pedra Branca';
    store('Armazém Pedra Branca', 20, 302, 14, 10, 'mercantil', tn);
    lots(6, 296, 56, 346, tn, 0.92);
    town({ id: 'pedra_branca', name: 'Pedra Branca', region: 'oeste', kind: 'vilarejo', zones: [{ x0: 6, y0: 296, x1: 56, y1: 346 }], population: 6000, districts: [{ name: 'Pedra Branca', x: 30, y: 294 }] });
    const b = k.building('Posto Sul — conveniência', 'mercantil', 67, 232, 76, 240, T.WALL_PLASTER, T.FLOOR_MARKET, '#7a3a30', 'flat');
    k.door(67, 236, b, 'Porta de vidro', 50);
    furnish(68, 233, 75, 239, [C('prateleira_mercado', 'gondola', 3), C('refrigerador', 'fridge')]);
    k.prop('fuel_tank', 72, 243, 2, 2, { name: 'Tanque subterrâneo do posto', desc: 'Ainda há combustível no fundo do tanque.', fuel: 90 });
    poi('posto', 'Posto Sul', 66, 232, 12, 14, 'BR-232');
  }

  // ============================================================ Posto Vale (Estrada do Vale)
  {
    const b = k.building('Posto do Vale — conveniência', 'mercantil', 355, 188, 364, 195, T.WALL_PLASTER, T.FLOOR_MARKET, '#7a3a30', 'flat');
    k.door(359, 195, b, 'Porta de vidro', 50);
    furnish(356, 189, 363, 194, [C('prateleira_mercado', 'gondola', 3)]);
    k.prop('fuel_tank', 367, 192, 2, 2, { name: 'Tanque subterrâneo do posto', desc: 'Combustível no tanque subterrâneo.', fuel: 110 });
    poi('posto', 'Posto do Vale', 355, 188, 15, 9, 'Estrada do Vale');
  }

  // ============================================================ FAZENDAS
  const farm = (name: string, x0: number, y0: number, x1: number, y1: number, region: RegionId) => {
    fence(x0, y0, x1, y1, T.FENCE_WOOD, [[x0 + 2, y0], [x0 + 3, y0], [x0 + 2, y1], [x0 + 3, y1]]);
    const hx = x0 + 3;
    const hy = y0 + 3;
    house(`Sede da ${name}`, hx, hy, 12, 10, name);
    const cb = k.building(`Celeiro da ${name}`, 'deposito', hx + 16, hy, hx + 29, hy + 10, T.WALL_BRICK, T.DIRT, '#6a3a2e');
    k.door(hx + 22, hy + 10, cb, 'Portão do celeiro', 100);
    furnish(hx + 17, hy + 1, hx + 28, hy + 9, [C('celeiro', 'crate', 2), C('celeiro', 'crate', 2), C('caixa_ferramentas', 'toolbox')]);
    for (let y = hy + 14; y < y1 - 2; y++) for (let x = x0 + 2; x < x1 - 2; x++) if (k.isNatural(x, y) && (x - x0) % 9 !== 0) map.set(x, y, T.CROP);
    poi('fazenda', name, x0, y0, x1 - x0 + 1, y1 - y0 + 1, name);
    k.label(name, (x0 + x1) >> 1, y0 - 2);
    ex.towns.push({ id: name.toLowerCase().replace(/\s+/g, '_'), name, region, kind: 'rural', zones: [{ x0, y0, x1, y1 }], population: 40, districts: [], cx: (x0 + x1) >> 1, cy: (y0 + y1) >> 1 });
  };
  farm('Fazenda Boa Vista', 80, 206, 140, 262, 'oeste');
  farm('Fazenda Três Rios', 330, 296, 392, 350, 'sul');
  farm('Fazenda São Jorge', 210, 60, 262, 112, 'norte');

  // ============================================================ florestas e vegetação
  const forest = (x0: number, y0: number, x1: number, y1: number, d: number) => {
    for (let y = y0; y <= y1; y += 2)
      for (let x = x0; x <= x1; x += 2) if (rng.chance(d)) k.tree(x + rng.int(0, 1), y + rng.int(0, 1));
  };
  forest(200, 14, 300, 44, 0.35);
  forest(392, 14, 428, 42, 0.4);
  forest(268, 60, 420, 125, 0.18);
  forest(2, 175, 56, 290, 0.25);
  forest(140, 175, 215, 270, 0.15);
  forest(2, 350, 230, 382, 0.3);
  forest(470, 252, 508, 292, 0.3);
  forest(330, 210, 405, 270, 0.12);
  for (let i = 0; i < 900; i++) {
    const x = rng.int(130, WORLD_W - 2);
    const y = rng.int(2, WORLD_H - 2);
    if (k.isNatural(x, y) && rng.chance(0.3)) map.set(x, y, T.GRASS_TALL);
  }

  // ============================================================ veículos abandonados e postes nas rodovias
  for (let x = 140; x < WORLD_W - 12; x += rng.int(18, 40)) k.car(x, rng.chance(0.5) ? 44 : 47, false, { burned: rng.chance(0.2), trunk: rng.chance(0.3) });
  for (let y = 110; y < WORLD_H - 12; y += rng.int(20, 45)) k.car(rng.chance(0.5) ? 60 : 63, y, true, { burned: rng.chance(0.2), trunk: rng.chance(0.3) });
  for (let x = 80; x < WORLD_W - 12; x += rng.int(22, 45)) k.car(x, rng.chance(0.5) ? 198 : 201, false, { burned: rng.chance(0.25), trunk: rng.chance(0.3) });
  for (let y = 60; y < 340; y += rng.int(25, 50)) k.car(rng.chance(0.5) ? 408 : 411, y, true, { burned: rng.chance(0.2) });
  for (let x = 140; x < WORLD_W; x += 28) if (k.isNatural(x, 42)) k.prop('lamp', x, 42, 1, 1, { name: 'Poste de iluminação', desc: 'Apagado.' });

  // ============================================================ zumbis por densidade populacional
  const startsXY = [base.playerStart, ...ex.starts.map((s) => ({ x: s.x * TILE, y: s.y * TILE }))];
  const farFromStarts = (x: number, y: number) => startsXY.every((s) => Math.hypot(s.x / TILE - x, s.y / TILE - y) > 10);
  const populate = (z: { x0: number; y0: number; x1: number; y1: number }, n: number, outfit?: Parameters<BuildKit['zombie']>[3]) => {
    let placed = 0;
    for (let tries = 0; tries < n * 20 && placed < n; tries++) {
      const x = rng.int(z.x0, z.x1);
      const y = rng.int(z.y0, z.y1);
      if (inBairro(x, y) || map.solid(x, y) || !farFromStarts(x, y)) continue;
      const r = rng.next();
      k.zombie(x + 0.5, y + 0.5, r < 0.08 ? 'rapido' : r < 0.16 ? 'debilitado' : 'comum', outfit);
      placed++;
    }
  };
  // capital: alta densidade (o bairro já tem os seus)
  populate({ x0: 130, y0: 2, x1: 225, y1: 168 }, 95);
  populate({ x0: 2, y0: 98, x1: 127, y1: 168 }, 45);
  populate({ x0: 140, y0: 60, x1: 169, y1: 79 }, 10, 'medico');
  populate({ x0: 222, y0: 150, x1: 340, y1: 256 }, 60);
  populate({ x0: 290, y0: 158, x1: 319, y1: 177 }, 8, 'medico');
  populate({ x0: 236, y0: 300, x1: 282, y1: 358 }, 22);
  populate({ x0: 296, y0: 16, x1: 392, y1: 42 }, 22);
  populate({ x0: 416, y0: 296, x1: 505, y1: 352 }, 18);
  populate({ x0: 6, y0: 296, x1: 56, y1: 346 }, 12);
  populate({ x0: 420, y0: 132, x1: 505, y1: 158 }, 12);
  populate({ x0: 430, y0: 214, x1: 463, y1: 243 }, 14, 'cientista');
  populate({ x0: 395, y0: 125, x1: 428, y1: 135 }, 6, 'militar');
  // área rural: poucos, mas nunca zero
  populate({ x0: 130, y0: 170, x1: 510, y1: 382 }, 40);
  populate({ x0: 200, y0: 44, x1: 428, y1: 140 }, 22);
  populate({ x0: 2, y0: 170, x1: 128, y1: 382 }, 20);
  // hordas itinerantes (migram entre cidades pela simulação de hordas)
  const horde = (id: number, cx: number, cy: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0.5, 3.5);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (!map.solid(Math.floor(x), Math.floor(y))) k.zombie(x, y, i % 7 === 3 ? 'rapido' : 'comum', undefined, id);
    }
  };
  horde(2, 250, 46.5, 14);
  horde(3, 280, 200.5, 12);
  horde(4, 62.5, 200, 12);
  horde(5, 410.5, 240, 10);

  // ============================================================ rótulos do mapa físico
  k.label('BR-101', 300, 41);
  k.label('BR-232', 66, 175);
  k.label('Estrada do Vale', 360, 205);
  k.label('Rio Sombrio', 160, 285);
  k.label('Serra do Norte', 400, 6);

  // ============================================================ NPCs (consumidos pelo módulo de NPCs/facções)
  ex.npcSpawns.push(
    { key: 'sgt_ramos', x: 478.5, y: 72.5, faction: 'sentinela', role: 'lider' },
    { key: 'cabo_lins', x: 433.5, y: 90.5, faction: 'sentinela', role: 'guarda' },
    { key: 'sold_teles', x: 452.5, y: 104.5, faction: 'sentinela', role: 'guarda' },
    { key: 'sold_paiva', x: 460.5, y: 85.5, faction: 'sentinela', role: 'membro' },
    { key: 'dona_celia', x: 245.5, y: 227.5, faction: 'aurora', role: 'lider' },
    { key: 'tiago', x: 244.5, y: 212.5, faction: 'aurora', role: 'guarda' },
    { key: 'rosa', x: 238.5, y: 230.5, faction: 'aurora', role: 'membro' },
    { key: 'caveira', x: 302.5, y: 340.5, faction: 'abutres', role: 'lider' },
    { key: 'navalha', x: 282.5, y: 335.5, faction: 'abutres', role: 'guarda' },
    { key: 'brito', x: 300.5, y: 331.5, faction: 'abutres', role: 'guarda' },
    { key: 'dra_helena', x: 478.5, y: 174.5, faction: 'vitalis', role: 'lider' },
    { key: 'marcos_vitalis', x: 474.5, y: 176.5, faction: 'vitalis', role: 'cientista' },
    { key: 'prisioneiro_joao', x: 304.5, y: 325.5, role: 'prisioneiro', faction: 'abutres' },
    { key: 'lucia', x: 150.5, y: 110.5, role: 'sobrevivente' },
    { key: 'beto', x: 270.5, y: 175.5, role: 'sobrevivente' },
    { key: 'irmao_davi', x: 345.5, y: 26.5, role: 'sobrevivente' },
    { key: 'nina', x: 440.5, y: 330.5, role: 'sobrevivente' },
  );

  // ============================================================ pedaços de mapa regional espalhados
  {
    const frag = (region: RegionId, piece: number) => Object.assign(createItem('fragmento_regional'), { state: { region, cond: 'rasgado', pieces: piece } });
    const intoBuilding = (name: string, it: ReturnType<typeof createItem>) => {
      const bi = base.buildings.find((bb) => bb.name === name);
      const c = bi ? [...base.containers.values()].find((cc) => cc.building === bi.id) : undefined;
      c?.inv.items.push(it);
    };
    intoBuilding('Posto Sul — conveniência', frag('sul', 4));
    intoBuilding('Delegacia de Santa Aurora', frag('sul', 8));
    intoBuilding('Mercearia da Serra', frag('leste', 1));
    intoBuilding('Oficina do Porto', frag('norte', 2));
  }

  // marca células visíveis como "naturais" restantes: nada a fazer; força mapa sujo para o renderizador
  map.dirtyChunks.clear();
  return { ...base, ...ex };
}

/** Mapa regional: retângulo coberto por cada região (para o mapa físico). */
export const REGION_RECT: Record<RegionId | 'mundo', { x0: number; y0: number; x1: number; y1: number }> = {
  oeste: { x0: 0, y0: 0, x1: 199, y1: WORLD_H - 1 },
  norte: { x0: 200, y0: 0, x1: WORLD_W - 1, y1: 127 },
  leste: { x0: 380, y0: 128, x1: WORLD_W - 1, y1: WORLD_H - 1 },
  sul: { x0: 200, y0: 128, x1: 379, y1: WORLD_H - 1 },
  mundo: { x0: 0, y0: 0, x1: WORLD_W - 1, y1: WORLD_H - 1 },
};

export const isWater = (t: TileId) => t === T.WATER;
export { TILES };
