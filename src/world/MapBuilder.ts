import { TILE } from '../config';
import { createItem, ItemInstance } from '../data/items';
import { CONTAINER_KINDS, rollLoot } from '../data/loot';
import { hash2, RNG } from '../engine/math';
import { Inventory } from '../systems/Inventory';
import { T, TILES, TileId } from './tiles';
import { TileMap } from './TileMap';
import {
  Building,
  Container,
  Decal,
  LightSource,
  MapLabel,
  Prop,
  SafePoint,
  Tree,
  ZombieSpawn,
} from './types';

export const MAP_W = 128;
export const MAP_H = 96;

export interface BuiltWorld {
  map: TileMap;
  props: Prop[];
  containers: Map<string, Container>;
  /** Índice tile -> id do recipiente. */
  containerAt: Map<number, string>;
  trees: Tree[];
  lights: LightSource[];
  decals: Decal[];
  buildings: Building[];
  safePoints: SafePoint[];
  labels: MapLabel[];
  zombies: ZombieSpawn[];
  playerStart: { x: number; y: number };
  allyStart: { x: number; y: number };
}

/**
 * Constrói o bairro inicial. O layout é escrito à mão (coordenadas em tiles)
 * para garantir coerência: cada estabelecimento tem cômodos, portas, janelas
 * e recipientes em locais lógicos. Os itens aleatórios usam semente fixa.
 */
export function buildNeighborhood(seed: number): BuiltWorld {
  const rng = new RNG(seed);
  const map = new TileMap(MAP_W, MAP_H);
  const props: Prop[] = [];
  const containers = new Map<string, Container>();
  const containerAt = new Map<number, string>();
  const trees: Tree[] = [];
  const lights: LightSource[] = [];
  const decals: Decal[] = [];
  const buildings: Building[] = [];
  const safePoints: SafePoint[] = [];
  const labels: MapLabel[] = [];
  const zombies: ZombieSpawn[] = [];
  let cid = 0;

  // ---------------------------------------------------------------- helpers
  const fill = (x0: number, y0: number, x1: number, y1: number, t: TileId) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) map.set(x, y, t);
  };
  const scatter = (x0: number, y0: number, x1: number, y1: number, from: TileId, to: TileId, p: number) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) if (map.get(x, y) === from && rng.chance(p)) map.set(x, y, to);
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, t: TileId) => {
    for (let x = x0; x <= x1; x++) {
      map.set(x, y0, t);
      map.set(x, y1, t);
    }
    for (let y = y0; y <= y1; y++) {
      map.set(x0, y, t);
      map.set(x1, y, t);
    }
  };

  const building = (
    name: string,
    kind: Building['kind'],
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    wall: TileId,
    floor: TileId,
    roof: string,
    roofKind: Building['roofKind'] = 'gable',
  ): number => {
    const id = buildings.length;
    buildings.push({ id, name, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, roof, roofKind, kind });
    fill(x0, y0, x1, y1, floor);
    rect(x0, y0, x1, y1, wall);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) map.building[map.idx(x, y)] = id;
    return id;
  };
  const room = (x0: number, y0: number, x1: number, y1: number, floor: TileId) => fill(x0, y0, x1, y1, floor);
  const hwall = (x0: number, x1: number, y: number, t: TileId) => {
    for (let x = x0; x <= x1; x++) map.set(x, y, t);
  };
  const vwall = (x: number, y0: number, y1: number, t: TileId) => {
    for (let y = y0; y <= y1; y++) map.set(x, y, t);
  };
  const door = (x: number, y: number, b: number, label = 'Porta', hp = 70) => {
    // piso da porta = piso de um vizinho interno
    let f: TileId = T.FLOOR_WOOD;
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]) {
      const t = map.get(x + dx, y + dy);
      if (!TILES[t].wall && map.building[map.idx(x + dx, y + dy)] === b) {
        f = t;
        break;
      }
    }
    map.set(x, y, f);
    map.addDoor(x, y, b, label, hp);
  };
  const win = (x: number, y: number) => map.set(x, y, T.WINDOW);

  const prop = (kind: string, x: number, y: number, w = 1, h = 1, o: Partial<Prop> = {}): Prop => {
    const p: Prop = { kind, x, y, w, h, solid: true, variant: hash2(x, y, 7) % 4, ...o };
    props.push(p);
    if (p.solid)
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) {
          if (!map.inb(xx, yy)) continue;
          map.block[map.idx(xx, yy)] = 1;
        }
    return p;
  };

  const container = (
    kind: string,
    x: number,
    y: number,
    w: number,
    h: number,
    visual: string,
    o: { name?: string; items?: ItemInstance[]; loot?: boolean; color?: string } = {},
  ): Container => {
    const k = CONTAINER_KINDS[kind];
    const id = `c${cid++}`;
    const inv = new Inventory(k.capacity);
    const c: Container = {
      id,
      kind,
      name: o.name ?? k.name,
      x,
      y,
      w,
      h,
      inv,
      searched: false,
      building: map.building[map.idx(x, y)],
    };
    if (o.loot !== false) for (const it of rollLoot(kind, rng)) inv.add(it);
    for (const it of o.items ?? []) inv.add(it);
    containers.set(id, c);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) containerAt.set(map.idx(xx, yy), id);
    prop(visual, x, y, w, h, { containerId: id, name: c.name, color: o.color });
    return c;
  };

  const tree = (x: number, y: number, r?: number) => {
    // tronco ocupa 1 tile sólido; copa desenhada por cima
    trees.push({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2, r: r ?? rng.range(15, 22), variant: rng.int(0, 3) });
    map.block[map.idx(x, y)] = 1;
  };

  const carColors = ['#6d3b33', '#40505e', '#8a8a83', '#3d4a3c', '#2c2d30', '#7c6a4a', '#5b5f66'];
  const car = (
    x: number,
    y: number,
    vertical: boolean,
    o: { trunk?: boolean; burned?: boolean; police?: boolean; kind?: string; color?: string } = {},
  ) => {
    const kind = o.kind ?? (o.police ? 'car_police' : 'car');
    const len = kind === 'bus' ? 9 : kind === 'van' ? 5 : 4;
    const w = vertical ? 2 : len;
    const h = vertical ? len : 2;
    const color = o.color ?? (o.police ? '#cfcfc8' : rng.pick(carColors));
    const name = kind === 'bus' ? 'Ônibus abandonado' : o.police ? 'Viatura policial' : kind === 'van' ? 'Van abandonada' : 'Carro abandonado';
    const desc = o.burned
      ? 'Carcaça queimada. O cheiro de borracha ainda está no ar.'
      : kind === 'bus'
        ? 'Um ônibus atravessado na pista. Os vidros estão estilhaçados.'
        : 'Vidros quebrados, pneus murchos. Alguém saiu às pressas.';
    decals.push({ x: (x + w / 2) * TILE, y: (y + h / 2) * TILE, kind: 'oil', r: 10, rot: rng.range(0, 6), seed: rng.int(0, 9999) });
    if (o.trunk) {
      const c = container('porta_malas', x, y, w, h, kind, { name: 'Porta-malas', color });
      const p = props[props.length - 1];
      Object.assign(p, { vertical, burned: !!o.burned, color, desc, name: `${name} (porta-malas)` });
      return c;
    }
    prop(kind, x, y, w, h, { vertical, burned: !!o.burned, color, name, desc });
    return null;
  };

  const lamp = (x: number, y: number, lit = false) => {
    prop('lamp', x, y, 1, 1, { name: 'Poste de iluminação', desc: lit ? 'A lâmpada ainda pisca, alimentada por algum gerador.' : 'Lâmpada apagada. Sem energia há semanas.' });
    if (lit) lights.push({ x: x * TILE + 8, y: y * TILE + 4, r: 80, color: '255,214,150', flicker: 0.5, kind: 'lamp' });
  };

  const decal = (x: number, y: number, kind: Decal['kind'], r = 6) =>
    decals.push({ x, y, kind, r, rot: rng.range(0, Math.PI * 2), seed: rng.int(0, 99999) });

  // ---------------------------------------------------------------- terreno base
  fill(0, 0, MAP_W - 1, MAP_H - 1, T.GRASS);
  scatter(0, 0, MAP_W - 1, MAP_H - 1, T.GRASS, T.GRASS_TALL, 0.18);
  for (let i = 0; i < 40; i++) {
    const cx = rng.int(2, MAP_W - 3);
    const cy = rng.int(2, MAP_H - 3);
    const r = rng.int(1, 2);
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (rng.chance(0.7)) map.set(x, y, T.DIRT);
  }

  // ---------------------------------------------------------------- ruas
  // Avenida (horizontal): calçadas 41..43 e 49..51, asfalto 44..48
  fill(0, 41, MAP_W - 1, 43, T.SIDEWALK);
  fill(0, 49, MAP_W - 1, 51, T.SIDEWALK);
  fill(0, 44, MAP_W - 1, 48, T.ASPHALT);
  // Rua do Comércio (vertical): calçadas 57..59 e 65..67, asfalto 60..64
  fill(57, 0, 59, MAP_H - 1, T.SIDEWALK);
  fill(65, 0, 67, MAP_H - 1, T.SIDEWALK);
  fill(60, 0, 64, MAP_H - 1, T.ASPHALT);
  fill(57, 44, 67, 48, T.ASPHALT);
  fill(60, 41, 64, 51, T.ASPHALT);
  for (let x = 0; x < MAP_W; x++) if ((x < 56 || x > 68) && x % 3 !== 2) map.set(x, 46, T.LINE_H);
  for (let y = 0; y < MAP_H; y++) if ((y < 40 || y > 52) && y % 3 !== 2) map.set(62, y, T.LINE_V);
  scatter(0, 0, MAP_W - 1, MAP_H - 1, T.SIDEWALK, T.SIDEWALK_WEEDS, 0.22);
  scatter(0, 0, MAP_W - 1, MAP_H - 1, T.ASPHALT, T.ASPHALT_CRACK, 0.1);

  // ---------------------------------------------------------------- Casa 1 (abrigo inicial)
  {
    // quintal com cerca de madeira e portão
    rect(5, 10, 24, 37, T.FENCE_WOOD);
    fill(11, 37, 12, 37, T.DIRT);
    fill(17, 37, 19, 37, T.GRAVEL);
    fill(11, 26, 12, 40, T.DIRT);
    fill(17, 26, 19, 40, T.GRAVEL);
    const b = building('Casa 1', 'casa', 8, 14, 21, 25, T.WALL_PLASTER, T.FLOOR_WOOD, '#6b4a3e');
    room(16, 15, 20, 18, T.FLOOR_KITCHEN);
    room(16, 20, 20, 24, T.FLOOR_CARPET);
    vwall(15, 15, 24, T.WALL_PLASTER);
    hwall(16, 20, 19, T.WALL_PLASTER);
    door(15, 17, b, 'Porta da cozinha', 50);
    door(15, 22, b, 'Porta do quarto', 50);
    door(11, 25, b, 'Porta da frente', 90);
    door(21, 17, b, 'Porta dos fundos', 80);
    win(12, 14);
    win(8, 17);
    win(8, 22);
    win(21, 22);
    win(18, 25);
    win(14, 25);
    prop('sofa', 9, 19, 1, 3, { name: 'Sofá', desc: 'Um sofá rasgado. Alguém dormiu aqui recentemente.' });
    prop('table_small', 11, 20);
    container('estante', 9, 15, 2, 1, 'shelf_home', { items: [createItem('velas', 2)] });
    prop('plant', 14, 24, 1, 1, { solid: false });
    decals.push({ x: 11.5 * TILE, y: 21 * TILE, kind: 'rug', r: 18, rot: 0, seed: 3, color: '#5b3f3a' });
    container('armario_cozinha', 16, 15, 2, 1, 'counter_cab', { items: [createItem('faca_cozinha', 1, 0.8), createItem('biscoito', 1)] });
    prop('stove', 18, 15);
    prop('sink', 19, 15);
    container('geladeira', 20, 15, 1, 1, 'fridge', { loot: false, items: [createItem('agua')] });
    prop('table', 18, 17, 2, 1, { name: 'Mesa da cozinha' });
    prop('bed', 19, 23, 2, 2, { name: 'Cama' });
    container('guarda_roupa', 16, 20, 2, 1, 'wardrobe', { loot: false, items: [createItem('taco_beisebol', 1, 0.9), createItem('moletom'), createItem('camiseta')] });
    container('comoda', 20, 20, 1, 1, 'dresser', { loot: false, items: [createItem('bandagem', 1), createItem('fotografia')] });
    // quintal
    tree(6, 12);
    tree(23, 30);
    tree(7, 33);
    tree(22, 12);
    car(17, 29, true, { trunk: true });
    safePoints.push({ id: 'sp_casa1', name: 'Casa 1 (abrigo)', x: 12.5 * TILE, y: 22.5 * TILE, building: b, discovered: true, lastVisit: 0 });
    labels.push({ text: 'casa', x: 14, y: 20 });
  }

  // ---------------------------------------------------------------- Casa 2 (mapa rasgado)
  {
    rect(27, 9, 48, 29, T.HEDGE);
    fill(33, 29, 34, 29, T.DIRT);
    fill(33, 25, 34, 40, T.DIRT);
    const b = building('Casa 2', 'casa', 30, 12, 45, 24, T.WALL_BLUE, T.FLOOR_WOOD, '#4a4f55');
    room(31, 13, 36, 16, T.FLOOR_KITCHEN);
    room(38, 13, 44, 17, T.FLOOR_CARPET);
    vwall(37, 13, 23, T.WALL_BLUE);
    hwall(31, 36, 17, T.WALL_BLUE);
    hwall(38, 44, 18, T.WALL_BLUE);
    door(34, 17, b, 'Porta', 50);
    door(37, 16, b, 'Porta do quarto', 50);
    door(37, 21, b, 'Porta do quarto', 50);
    door(33, 24, b, 'Porta da frente', 90);
    door(30, 15, b, 'Porta dos fundos', 80);
    win(31, 24);
    win(36, 24);
    win(41, 24);
    win(30, 20);
    win(45, 15);
    win(45, 21);
    win(40, 12);
    win(43, 12);
    container('armario_cozinha', 31, 13, 2, 1, 'counter_cab');
    prop('stove', 33, 13);
    prop('sink', 34, 13);
    container('geladeira', 36, 13, 1, 1, 'fridge');
    prop('sofa', 31, 19, 1, 3, { name: 'Sofá' });
    prop('table_small', 33, 20);
    container('estante', 35, 23, 2, 1, 'shelf_home');
    container('comoda', 38, 13, 1, 1, 'dresser', { loot: false, items: [createItem('mapa_rasgado'), createItem('pilhas', 1)] });
    container('guarda_roupa', 40, 13, 2, 1, 'wardrobe');
    prop('bed', 43, 13, 2, 2, { name: 'Cama' });
    container('guarda_roupa', 38, 19, 2, 1, 'wardrobe', { items: [createItem('mochila_escolar')] });
    prop('bed', 43, 22, 2, 2, { name: 'Cama' });
    decal(39 * TILE, 21 * TILE, 'blood_dry', 9);
    tree(28, 27);
    tree(46, 11);
    tree(47, 26);
    safePoints.push({ id: 'sp_casa2', name: 'Casa 2', x: 34.5 * TILE, y: 20.5 * TILE, building: b, discovered: false, lastVisit: 0 });
  }

  // ---------------------------------------------------------------- Casa 3 (kit médico)
  {
    rect(5, 54, 24, 76, T.FENCE_WOOD);
    fill(12, 54, 13, 54, T.DIRT);
    fill(12, 52, 13, 59, T.DIRT);
    const b = building('Casa 3', 'casa', 8, 60, 21, 71, T.WALL_SAGE, T.FLOOR_WOOD, '#5a3f36');
    room(15, 61, 20, 64, T.FLOOR_KITCHEN);
    room(15, 66, 20, 70, T.FLOOR_CARPET);
    room(9, 69, 13, 70, T.FLOOR_BATH);
    vwall(14, 61, 70, T.WALL_SAGE);
    hwall(15, 20, 65, T.WALL_SAGE);
    hwall(9, 13, 68, T.WALL_SAGE);
    door(12, 60, b, 'Porta da frente', 90);
    door(14, 63, b, 'Porta da cozinha', 50);
    door(14, 67, b, 'Porta do quarto', 50);
    door(11, 68, b, 'Porta do banheiro', 40);
    door(16, 71, b, 'Porta dos fundos', 80);
    win(10, 60);
    win(17, 60);
    win(8, 63);
    win(8, 66);
    win(21, 62);
    win(21, 68);
    win(19, 71);
    prop('sofa', 9, 62, 1, 3, { name: 'Sofá' });
    container('estante', 9, 61, 1, 1, 'shelf_home');
    prop('table_small', 11, 65);
    prop('toilet', 9, 69, 1, 1, { name: 'Vaso sanitário' });
    container('armario_banheiro', 13, 69, 1, 1, 'bath_cab', { items: [createItem('kit_medico')] });
    prop('bathtub', 12, 70, 2, 1, { name: 'Banheira' });
    container('armario_cozinha', 15, 61, 2, 1, 'counter_cab');
    prop('stove', 17, 61);
    prop('sink', 18, 61);
    container('geladeira', 20, 61, 1, 1, 'fridge');
    prop('bed', 19, 69, 2, 2, { name: 'Cama' });
    container('guarda_roupa', 17, 66, 2, 1, 'wardrobe', { items: [createItem('jaqueta_couro', 1)] });
    container('comoda', 20, 66, 1, 1, 'dresser');
    decal(11 * TILE, 63 * TILE, 'blood', 10);
    tree(6, 57);
    tree(22, 74);
    tree(7, 74);
    safePoints.push({ id: 'sp_casa3', name: 'Casa 3', x: 11.5 * TILE, y: 64.5 * TILE, building: b, discovered: false, lastVisit: 0 });
    zombies.push({ x: 10.5, y: 66.5, type: 'debilitado', outfit: 'casual' });
  }

  // ---------------------------------------------------------------- Casa 4 (fragmento do mapa)
  {
    rect(29, 54, 48, 78, T.HEDGE);
    fill(38, 54, 39, 54, T.DIRT);
    fill(38, 52, 39, 59, T.DIRT);
    const b = building('Casa 4', 'casa', 32, 60, 45, 73, T.WALL_PLASTER, T.FLOOR_WOOD, '#3f4a44');
    room(33, 61, 37, 65, T.FLOOR_KITCHEN);
    room(33, 67, 37, 72, T.FLOOR_CARPET);
    hwall(33, 44, 66, T.WALL_PLASTER);
    vwall(38, 67, 72, T.WALL_PLASTER);
    door(38, 60, b, 'Porta da frente', 90);
    door(35, 66, b, 'Porta do quarto', 50);
    door(41, 66, b, 'Porta do escritório', 50);
    win(34, 60);
    win(42, 60);
    win(32, 63);
    win(32, 69);
    win(45, 63);
    win(45, 70);
    win(35, 73);
    win(42, 73);
    container('armario_cozinha', 33, 61, 2, 1, 'counter_cab');
    prop('stove', 35, 61);
    container('geladeira', 37, 61, 1, 1, 'fridge');
    prop('table', 35, 63, 2, 1, { name: 'Mesa' });
    prop('sofa', 44, 61, 1, 3, { name: 'Sofá' });
    container('estante', 43, 65, 2, 1, 'shelf_home');
    prop('bed', 33, 71, 2, 2, { name: 'Cama' });
    container('guarda_roupa', 36, 67, 2, 1, 'wardrobe', { items: [createItem('mochila_trilha')] });
    container('comoda', 33, 67, 1, 1, 'dresser');
    container('mesa', 42, 68, 2, 1, 'desk', { name: 'Escrivaninha', loot: false, items: [createItem('fragmento_mapa'), createItem('caderno')] });
    container('armario_arquivo', 44, 71, 1, 2, 'filing');
    container('estante', 39, 72, 2, 1, 'shelf_home');
    decal(40 * TILE, 63 * TILE, 'blood', 8);
    tree(30, 56);
    tree(47, 76);
    tree(31, 76);
    safePoints.push({ id: 'sp_casa4', name: 'Casa 4', x: 40.5 * TILE, y: 63.5 * TILE, building: b, discovered: false, lastVisit: 0 });
    zombies.push({ x: 36.5, y: 69.5, type: 'comum', outfit: 'casual' });
  }

  // ---------------------------------------------------------------- Mercantil
  {
    // estacionamento frontal
    fill(70, 34, 99, 40, T.ASPHALT);
    for (let x = 71; x <= 98; x += 3) fill(x, 37, x, 40, T.PARKING);
    fill(74, 3, 99, 15, T.GRAVEL);
    const b = building('Mercantil', 'mercantil', 74, 16, 95, 33, T.WALL_BRICK, T.FLOOR_MARKET, '#5d5a55', 'flat');
    room(75, 17, 94, 21, T.FLOOR_CONCRETE);
    hwall(75, 94, 22, T.WALL_BRICK);
    door(90, 22, b, 'Porta do estoque', 50);
    door(84, 33, b, 'Porta de vidro', 45);
    door(85, 33, b, 'Porta de vidro', 45);
    door(80, 16, b, 'Porta dos fundos', 100);
    for (const x of [76, 77, 78, 79, 81, 82, 87, 88, 89, 91, 92, 93]) win(x, 33);
    win(74, 26);
    win(74, 29);
    win(95, 26);
    win(95, 29);
    container('prateleira_mercado', 77, 25, 4, 1, 'gondola', { name: 'Prateleira de mercearia' });
    container('prateleira_mercado', 82, 25, 4, 1, 'gondola', { name: 'Prateleira de enlatados' });
    container('prateleira_mercado', 77, 28, 4, 1, 'gondola', { name: 'Prateleira de mercearia' });
    container('prateleira_mercado', 82, 28, 4, 1, 'gondola', { name: 'Prateleira de higiene', items: [createItem('sabonete', 2)] });
    container('prateleira_mercado', 75, 24, 1, 4, 'gondola_v', { name: 'Prateleira lateral' });
    container('refrigerador', 94, 24, 1, 5, 'fridge_v', { items: [createItem('agua'), createItem('agua')] });
    prop('counter', 88, 30, 2, 1, { name: 'Balcão do caixa' });
    container('caixa_registradora', 90, 30, 1, 1, 'register', { items: [createItem('pilhas', 2)] });
    prop('cart', 92, 31, 1, 1, { name: 'Carrinho de compras', desc: 'Um carrinho com uma roda torta.' });
    container('estoque', 76, 17, 4, 1, 'rack', { items: [createItem('feijao_lata', 2)] });
    container('estoque', 83, 17, 4, 1, 'rack');
    container('caixote', 92, 19, 2, 2, 'crate', { name: 'Caixotes' });
    prop('pallet', 86, 20, 2, 1, { solid: false });
    decal(86 * TILE, 31 * TILE, 'blood', 11);
    decal(80 * TILE, 30 * TILE, 'trash', 8);
    decal(84.5 * TILE, 34.5 * TILE, 'glass', 9);
    car(72, 36, true, { trunk: true });
    car(81, 36, true);
    car(93, 37, true, { burned: true });
    prop('dumpster', 97, 13, 2, 1, { name: 'Caçamba', desc: 'Caçamba de lixo transbordando.' });
    container('lixeira', 76, 13, 2, 1, 'dumpster', { name: 'Caçamba de lixo' });
    zombies.push({ x: 80.5, y: 26.5, type: 'comum', outfit: 'mercado' });
    zombies.push({ x: 90.5, y: 28.5, type: 'comum', outfit: 'casual' });
    zombies.push({ x: 86.5, y: 19.5, type: 'comum', outfit: 'mercado' });
    zombies.push({ x: 77.5, y: 31.5, type: 'debilitado', outfit: 'casual' });
    labels.push({ text: 'Mercantil', x: 84, y: 24 });
  }

  // ---------------------------------------------------------------- Depósito
  {
    rect(101, 3, 124, 24, T.FENCE_METAL);
    fill(110, 24, 113, 24, T.GRAVEL);
    fill(102, 4, 123, 23, T.GRAVEL);
    fill(110, 24, 113, 40, T.GRAVEL);
    const b = building('Depósito', 'deposito', 104, 6, 121, 21, T.WALL_BRICK, T.FLOOR_CONCRETE, '#4f5357', 'flat');
    room(117, 7, 120, 11, T.FLOOR_LINO);
    vwall(116, 7, 12, T.WALL_BRICK);
    hwall(117, 120, 12, T.WALL_BRICK);
    door(118, 12, b, 'Porta do escritório', 50);
    door(111, 21, b, 'Portão de enrolar', 130);
    door(112, 21, b, 'Portão de enrolar', 130);
    door(121, 16, b, 'Porta lateral', 90);
    win(104, 10);
    win(104, 16);
    win(108, 6);
    win(113, 6);
    win(119, 6);
    container('estante_ferramentas', 105, 8, 1, 4, 'rack_v');
    container('estante_ferramentas', 105, 14, 1, 4, 'rack_v');
    container('bancada', 108, 7, 4, 1, 'workbench', { items: [createItem('pe_de_cabra', 1, 0.8)] });
    container('caixa_ferramentas', 113, 7, 1, 1, 'toolbox');
    container('caixote', 108, 15, 2, 2, 'crate', { name: 'Caixotes' });
    container('caixote', 114, 17, 2, 2, 'crate', { name: 'Caixotes' });
    prop('pallet', 110, 11, 2, 2, { solid: false });
    container('mesa', 118, 8, 2, 1, 'desk', { name: 'Mesa do escritório', items: [createItem('lanterna')] });
    container('armario_arquivo', 120, 10, 1, 2, 'filing');
    decal(112 * TILE, 18 * TILE, 'oil', 12);
    car(106, 26, false, { kind: 'van', trunk: true, color: '#7a7d78' });
    zombies.push({ x: 110.5, y: 13.5, type: 'comum', outfit: 'operario' });
    zombies.push({ x: 117.5, y: 18.5, type: 'comum', outfit: 'operario' });
    labels.push({ text: 'Depósito', x: 112, y: 13 });
  }

  // ---------------------------------------------------------------- Delegacia
  {
    rect(75, 54, 106, 95, T.FENCE_METAL);
    fill(76, 55, 105, 59, T.SIDEWALK);
    fill(88, 54, 93, 54, T.SIDEWALK);
    fill(76, 80, 105, 94, T.ASPHALT);
    for (let x = 78; x <= 104; x += 3) fill(x, 82, x, 85, T.PARKING);
    for (let x = 78; x <= 104; x += 3) fill(x, 90, x, 93, T.PARKING);
    fill(96, 95, 101, 95, T.ASPHALT); // saída do estacionamento
    const b = building('Delegacia', 'delegacia', 78, 60, 103, 79, T.WALL_CONCRETE, T.FLOOR_LINO, '#55585a', 'flat');
    room(79, 68, 87, 78, T.FLOOR_BATH);
    room(97, 68, 102, 78, T.FLOOR_CONCRETE);
    hwall(79, 102, 67, T.WALL_CONCRETE);
    vwall(96, 61, 66, T.WALL_CONCRETE);
    vwall(88, 68, 78, T.WALL_CONCRETE);
    vwall(96, 68, 78, T.WALL_CONCRETE);
    door(90, 60, b, 'Porta da delegacia', 100);
    door(91, 60, b, 'Porta da delegacia', 100);
    door(96, 63, b, 'Porta do despacho', 60);
    door(83, 67, b, 'Porta do vestiário', 60);
    door(92, 67, b, 'Porta do escritório', 60);
    door(96, 72, b, 'Porta do arsenal', 120);
    door(84, 79, b, 'Porta dos fundos', 100);
    for (const x of [81, 85, 94, 99]) win(x, 60);
    win(78, 64);
    win(78, 72);
    win(103, 64);
    win(92, 79);
    prop('counter', 81, 64, 6, 1, { name: 'Balcão da recepção' });
    container('primeiros_socorros', 79, 61, 1, 1, 'firstaid', { items: [createItem('kit_medico')] });
    prop('bench', 92, 65, 3, 1, { name: 'Banco' });
    prop('plant', 95, 61, 1, 1, { solid: false });
    container('mesa', 99, 62, 3, 1, 'desk', {
      name: 'Mesa do despacho',
      loot: false,
      items: [(() => {
        const r = createItem('radio');
        r.state = { on: false, battery: 35, freq: 104.5 };
        return r;
      })()],
    });
    container('armario_arquivo', 102, 65, 1, 1, 'filing');
    container('armario_pessoal', 79, 68, 1, 1, 'locker', { items: [createItem('lanterna')] });
    container('armario_pessoal', 80, 68, 1, 1, 'locker');
    container('armario_pessoal', 81, 68, 1, 1, 'locker');
    container('armario_pessoal', 85, 68, 1, 1, 'locker');
    container('armario_pessoal', 86, 68, 1, 1, 'locker');
    prop('bench', 81, 72, 4, 1, { name: 'Banco do vestiário' });
    container('armario_evidencias', 79, 76, 1, 2, 'locker_tall');
    container('mesa', 90, 70, 2, 1, 'desk');
    container('mesa', 93, 70, 2, 1, 'desk');
    container('mesa', 90, 74, 2, 1, 'desk');
    container('armario_arquivo', 95, 77, 1, 1, 'filing');
    const pistol = createItem('pistola', 1, 0.9);
    pistol.state = { ammo: 6 };
    container('armario_armas', 102, 69, 1, 3, 'gun_cab', { name: 'Armário de armas', items: [pistol, createItem('municao_9mm', 14)] });
    container('armario_armas', 97, 78, 2, 1, 'locker_wide', { name: 'Armário de equipamentos', loot: false, items: [createItem('colete'), createItem('cassetete', 1, 0.8)] });
    decal(87 * TILE, 63 * TILE, 'blood', 12);
    decal(99 * TILE, 74 * TILE, 'blood_dry', 10);
    decal(90 * TILE, 72 * TILE, 'paper', 8);
    car(80, 82, true, { police: true, trunk: true });
    car(89, 82, true, { police: true, burned: true });
    car(98, 90, true, { police: true });
    prop('sandbags', 85, 56, 3, 1, { name: 'Sacos de areia', desc: 'Uma barricada improvisada. Não segurou.' });
    prop('sandbags', 94, 56, 3, 1, { name: 'Sacos de areia', desc: 'Uma barricada improvisada. Não segurou.' });
    prop('barrier', 89, 52, 2, 1, { name: 'Barreira policial', desc: 'Barreira de trânsito tombada.' });
    safePoints.push({ id: 'sp_delegacia', name: 'Delegacia (recepção)', x: 88.5 * TILE, y: 62.5 * TILE, building: b, discovered: false, lastVisit: 0 });
    zombies.push({ x: 85.5, y: 62.5, type: 'comum', outfit: 'policia' });
    zombies.push({ x: 84.5, y: 74.5, type: 'comum', outfit: 'policia' });
    zombies.push({ x: 99.5, y: 75.5, type: 'comum', outfit: 'policia' });
    zombies.push({ x: 92.5, y: 76.5, type: 'rapido', outfit: 'casual' });
    zombies.push({ x: 86.5, y: 88.5, type: 'comum', outfit: 'policia' });
    zombies.push({ x: 95.5, y: 86.5, type: 'comum', outfit: 'casual' });
    labels.push({ text: 'Delegacia', x: 90, y: 70 });
  }

  // ---------------------------------------------------------------- bordas e ruas bloqueadas
  for (let x = 0; x < MAP_W; x++) {
    if (map.get(x, 0) !== T.ASPHALT && map.get(x, 0) !== T.SIDEWALK && map.get(x, 0) !== T.LINE_V) map.set(x, 0, T.HEDGE);
    if (map.get(x, MAP_H - 1) !== T.ASPHALT && map.get(x, MAP_H - 1) !== T.SIDEWALK && map.get(x, MAP_H - 1) !== T.LINE_V) map.set(x, MAP_H - 1, T.HEDGE);
  }
  for (let y = 0; y < MAP_H; y++) {
    for (const x of [0, MAP_W - 1]) {
      const t = map.get(x, y);
      if (t !== T.ASPHALT && t !== T.SIDEWALK && t !== T.SIDEWALK_WEEDS && t !== T.LINE_H && t !== T.ASPHALT_CRACK) map.set(x, y, T.HEDGE);
    }
  }
  // destroços fechando as saídas do bairro
  const debris = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) map.set(x, y, T.RUBBLE);
  };
  debris(0, 41, 1, 51);
  car(2, 43, true, { burned: true });
  car(2, 47, true);
  debris(MAP_W - 2, 41, MAP_W - 1, 51);
  car(118, 44, false, { kind: 'bus', burned: false, color: '#6e7357' });
  debris(116, 49, 117, 51);
  debris(57, 0, 67, 1);
  car(60, 2, false, { burned: true });
  debris(57, MAP_H - 2, 67, MAP_H - 1);
  car(61, 91, false, {});
  // barricada parcial na Rua do Comércio (passagem estreita à direita)
  debris(57, 70, 63, 71);
  car(58, 72, false, { burned: true });
  for (const [x, y] of [
    [57, 2],
    [67, 3],
    [64, 92],
  ])
    prop('debris', x, y, 1, 1, { name: 'Destroços', desc: 'Entulho e ferragens bloqueiam a passagem.' });

  // ---------------------------------------------------------------- carros e objetos da rua
  car(24, 44, false, { trunk: true });
  car(40, 47, false, { burned: true });
  car(50, 44, false);
  car(70, 47, false, { trunk: true });
  car(84, 44, false);
  car(99, 47, false, { kind: 'van', trunk: true });
  car(61, 15, true, { trunk: true });
  car(63, 28, true, { burned: true });
  car(60, 58, true);
  car(63, 80, true, { trunk: true });
  prop('bus_stop', 30, 50, 3, 1, { name: 'Ponto de ônibus', desc: 'O banco ainda tem cartazes de "DESAPARECIDOS" colados.' });
  prop('bench', 46, 42, 2, 1, { name: 'Banco' });
  prop('trash_bags', 52, 42, 1, 1, { solid: false });
  prop('trash_bags', 69, 52, 1, 1, { solid: false });
  prop('trash_bags', 26, 50, 1, 1, { solid: false });
  prop('mailbox', 14, 41, 1, 1, { name: 'Caixa de correio' });
  prop('barrel_fire', 66, 38, 1, 1, { name: 'Tambor com fogo', desc: 'Alguém acendeu isto há pouco tempo. Não está sozinho por aqui?' });
  lights.push({ x: 66 * TILE + 8, y: 38 * TILE + 8, r: 70, color: '255,140,60', flicker: 1, kind: 'fire' });
  prop('barrel_fire', 104, 57, 1, 1, { name: 'Tambor com fogo', desc: 'O fogo está baixo. Há cinzas de papéis queimados.' });
  lights.push({ x: 104 * TILE + 8, y: 57 * TILE + 8, r: 64, color: '255,140,60', flicker: 1, kind: 'fire' });
  prop('tires', 54, 52, 1, 1, { name: 'Pneus', desc: 'Pilha de pneus velhos.' });
  container('lixeira', 52, 55, 2, 1, 'dumpster', { name: 'Caçamba de lixo' });

  // postes
  for (const x of [6, 20, 34, 48, 76, 90, 104]) lamp(x, 42, x === 48);
  for (const x of [13, 27, 41, 83, 97, 111]) lamp(x, 50, false);
  for (const y of [8, 22, 34, 58, 76, 88]) lamp(58, y, y === 76);
  for (const y of [14, 28, 64, 84]) lamp(66, y, false);

  // árvores de rua e vegetação
  for (const [x, y] of [
    [3, 6],
    [10, 4],
    [16, 6],
    [26, 4],
    [35, 6],
    [50, 5],
    [53, 14],
    [52, 26],
    [54, 34],
    [3, 30],
    [2, 20],
    [50, 37],
    [70, 6],
    [71, 26],
    [99, 30],
    [126, 30],
    [125, 8],
    [124, 38],
    [3, 58],
    [3, 70],
    [3, 86],
    [14, 82],
    [26, 88],
    [40, 86],
    [52, 66],
    [53, 80],
    [70, 62],
    [71, 78],
    [110, 60],
    [118, 66],
    [123, 78],
    [112, 88],
    [120, 92],
    [72, 90],
    [26, 66],
    [50, 90],
  ])
    tree(x, y);

  // jardins do quarteirão sudeste (área aberta)
  rect(108, 56, 124, 94, T.FENCE_WOOD);
  fill(108, 70, 108, 72, T.GRASS_TALL);
  scatter(109, 57, 123, 93, T.GRASS, T.GRASS_TALL, 0.4);

  // decalques de atmosfera
  for (let i = 0; i < 70; i++) {
    const x = rng.range(2, MAP_W - 2) * TILE;
    const y = rng.range(2, MAP_H - 2) * TILE;
    const kinds: Decal['kind'][] = ['leaves', 'leaves', 'trash', 'paper', 'blood_dry', 'cracks'];
    decal(x, y, rng.pick(kinds), rng.range(4, 9));
  }
  for (let i = 0; i < 18; i++) decal(rng.range(5, 120) * TILE, rng.range(44, 49) * TILE, 'blood_dry', rng.range(6, 12));

  // ---------------------------------------------------------------- zumbis de rua
  zombies.push({ x: 26.5, y: 46.5, type: 'comum' });
  zombies.push({ x: 36.5, y: 45.5, type: 'comum' });
  zombies.push({ x: 46.5, y: 47.5, type: 'comum' });
  zombies.push({ x: 30.5, y: 33.5, type: 'comum' });
  zombies.push({ x: 62.5, y: 20.5, type: 'comum' });
  zombies.push({ x: 63.5, y: 32.5, type: 'comum' });
  zombies.push({ x: 61.5, y: 8.5, type: 'rapido' });
  zombies.push({ x: 41.5, y: 33.5, type: 'comum' });
  zombies.push({ x: 41.5, y: 20.5, type: 'comum', outfit: 'casual' }); // dentro da Casa 2
  zombies.push({ x: 62.5, y: 66.5, type: 'comum' });
  zombies.push({ x: 63.5, y: 84.5, type: 'comum' });
  zombies.push({ x: 59.5, y: 56.5, type: 'debilitado' });
  zombies.push({ x: 40.5, y: 82.5, type: 'rapido' });
  zombies.push({ x: 18.5, y: 85.5, type: 'comum' });
  zombies.push({ x: 115.5, y: 80.5, type: 'comum' });
  zombies.push({ x: 120.5, y: 30.5, type: 'comum' });
  // pequena horda de teste na avenida leste
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    zombies.push({
      x: 109.5 + Math.cos(a) * rng.range(1, 4),
      y: 46.5 + Math.sin(a) * rng.range(0.5, 2),
      type: i === 5 ? 'rapido' : 'comum',
      horde: 1,
    });
  }

  labels.push({ text: 'Av. das Acácias', x: 26, y: 46 });
  labels.push({ text: 'R. do Comércio', x: 62, y: 60 });

  return {
    map,
    props,
    containers,
    containerAt,
    trees,
    lights,
    decals,
    buildings,
    safePoints,
    labels,
    zombies,
    playerStart: { x: 11.5 * TILE, y: 21.5 * TILE },
    allyStart: { x: 13 * TILE, y: 17.5 * TILE },
  };
}
