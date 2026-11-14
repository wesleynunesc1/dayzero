import { CONFIG, RespawnMode } from '../config';
import { getUidCounter, ItemInstance, setUidCounter } from '../data/items';
import { Appearance } from '../entities/Actor';
import { EquipSlot } from '../entities/Player';
import { Zombie, ZombieType } from '../entities/Zombie';
import { Health, Wound } from './Health';
import type { WeatherKind } from './Weather';
import type { World } from '../world/World';
import type { Corpse } from '../world/types';

/**
 * Salvamento local. O formato separa "mundo" de "jogadores" (lista com id), já pensando
 * em persistência em servidor no multiplayer. O mapa é reconstruído pela semente e,
 * em seguida, TODO o estado mutável é sobrescrito pelo save — assim nada que foi
 * saqueado reaparece e nenhum item é duplicado (os uids são preservados e verificados).
 */
export const SAVE_VERSION = 2;

interface SavedPlayer {
  id: string;
  x: number;
  y: number;
  facing: number;
  alive: boolean;
  health: { hp: number; wounds: Wound[]; infected: boolean; infectionTimer: number; incapacitated: boolean; dead: boolean; deathCause: string; painkiller: number };
  hunger: number;
  thirst: number;
  fatigue: number;
  stamina: number;
  sickHours: number;
  crouch: boolean;
  inventory: ItemInstance[];
  equipped: Record<EquipSlot, string | null>;
  vehicleId: string | null;
  deaths: number;
  lastSafePos: { x: number; y: number };
}

export interface SaveData {
  version: number;
  savedAt: string;
  seed: number;
  respawnMode: RespawnMode;
  world: {
    time: number;
    uidCounter: number;
    ground: string;
    windowHp: [number, number][];
    boardedFrom: [number, number][];
    doors: { open: boolean; broken: boolean; hp: number; maxHp: number; barricades: number }[];
    containers: Record<string, { items: ItemInstance[]; searched: boolean }>;
    corpses: { id: string; x: number; y: number; facing: number; look: Appearance; name: string; isPlayer: boolean; zombie: boolean; pile?: boolean; searched: boolean; items: ItemInstance[] }[];
    zombies: { type: ZombieType; x: number; y: number; hp: number; home: { x: number; y: number }; horde: number; outfit?: string; look: Appearance; facing: number }[];
    vehicles: { id: string; x: number; y: number; angle: number; fuel: number; hp: number }[];
    propFuel: [number, number][];
    waterSources: [string, number][];
    safePoints: { id: string; discovered: boolean; lastVisit: number }[];
    weather: { kind: WeatherKind; hoursLeft: number; rain: number; fog: number };
    allies: { x: number; y: number; hp: number; mode: string; state: string; inventory: ItemInstance[] }[];
    stats: { zombiesKilled: number; shotsFired: number };
    hordes: [number, { x: number; y: number; t: number }][];
  };
  players: SavedPlayer[];
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function toB64(a: Uint8Array): string {
  let s = '';
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s);
}
function fromB64(s: string, into: Uint8Array) {
  const b = atob(s);
  for (let i = 0; i < b.length && i < into.length; i++) into[i] = b.charCodeAt(i);
}

export function serializeWorld(world: World): SaveData {
  const p = world.player;
  const containers: SaveData['world']['containers'] = {};
  for (const [id, c] of world.containers) containers[id] = { items: clone(c.inv.items), searched: c.searched };
  return {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    seed: world.seed,
    respawnMode: CONFIG.respawnMode,
    world: {
      time: world.time,
      uidCounter: getUidCounter(),
      ground: toB64(world.map.ground),
      windowHp: [...world.windowHp],
      boardedFrom: [...world.boardedFrom],
      doors: world.map.doors.map((d) => ({ open: d.open, broken: d.broken, hp: d.hp, maxHp: d.maxHp, barricades: d.barricades })),
      containers,
      corpses: world.corpses.map((k) => ({
        id: k.id,
        x: k.x,
        y: k.y,
        facing: k.facing,
        look: k.look,
        name: k.name,
        isPlayer: k.isPlayer,
        zombie: k.zombie,
        pile: k.pile,
        searched: k.container.searched,
        items: clone(k.container.inv.items),
      })),
      zombies: world.zombies.map((z) => ({ type: z.ztype, x: z.x, y: z.y, hp: z.hp, home: z.home, horde: z.horde, outfit: (z as Zombie & { outfit?: string }).outfit, look: z.look, facing: z.facing })),
      vehicles: world.vehicles.map((v) => ({ id: v.id, x: v.x, y: v.y, angle: v.angle, fuel: v.fuel, hp: v.hp })),
      propFuel: world.props.map((pr, i) => [i, pr.fuel] as [number, number | undefined]).filter((e): e is [number, number] => e[1] !== undefined),
      waterSources: world.waterSources.map((w) => [w.id, w.liters]),
      safePoints: world.safePoints.map((s) => ({ id: s.id, discovered: s.discovered, lastVisit: s.lastVisit })),
      weather: { kind: world.weather.kind, hoursLeft: world.weather.hoursLeft, rain: world.weather.rain, fog: world.weather.fog },
      allies: world.allies.map((a) => ({ x: a.x, y: a.y, hp: a.hp, mode: a.mode, state: a.state, inventory: clone(a.inv.items) })),
      stats: { ...world.stats },
      hordes: [...world.hordes],
    },
    players: [
      {
        id: 'local',
        x: p.x,
        y: p.y,
        facing: p.facing,
        alive: p.alive,
        health: {
          hp: p.health.hp,
          wounds: clone(p.health.wounds),
          infected: p.health.infected,
          infectionTimer: p.health.infectionTimer,
          incapacitated: p.health.incapacitated,
          dead: p.health.dead,
          deathCause: p.health.deathCause,
          painkiller: p.health.painkiller,
        },
        hunger: p.hunger,
        thirst: p.thirst,
        fatigue: p.fatigue,
        stamina: p.stamina,
        sickHours: p.sickHours,
        crouch: p.crouch,
        inventory: clone(p.inv.items),
        equipped: { ...p.equipped },
        vehicleId: p.vehicleId,
        deaths: p.deaths,
        lastSafePos: { ...p.lastSafePos },
      },
    ],
  };
}

/** Lista todos os uids do save; lança erro se houver duplicados. */
export function auditUids(data: SaveData): { total: number; duplicates: string[] } {
  const seen = new Set<string>();
  const dup: string[] = [];
  const add = (items: ItemInstance[]) => {
    for (const it of items) {
      if (seen.has(it.uid)) dup.push(it.uid);
      seen.add(it.uid);
    }
  };
  for (const c of Object.values(data.world.containers)) add(c.items);
  for (const k of data.world.corpses) add(k.items);
  for (const a of data.world.allies) add(a.inventory);
  for (const p of data.players) add(p.inventory);
  return { total: seen.size, duplicates: dup };
}

/** Aplica o save em um mundo recém-construído com a mesma semente. */
export function applySave(world: World, data: SaveData) {
  if (data.version !== SAVE_VERSION) throw new Error(`Versão de save incompatível (${data.version}).`);
  if (data.seed !== world.seed) throw new Error('A semente do save não corresponde ao mundo.');
  const audit = auditUids(data);
  if (audit.duplicates.length) throw new Error(`Save corrompido: itens duplicados (${audit.duplicates.slice(0, 3).join(', ')}).`);
  const W = data.world;
  CONFIG.respawnMode = data.respawnMode;
  world.time = W.time;
  setUidCounter(W.uidCounter);

  // mapa
  const map = world.map;
  fromB64(W.ground, map.ground);
  for (let cy = 0; cy < map.chunksY; cy++) for (let cx = 0; cx < map.chunksX; cx++) map.dirtyChunks.add(cy * map.chunksX + cx);
  world.windowHp = new Map(W.windowHp);
  world.boardedFrom = new Map(W.boardedFrom);
  W.doors.forEach((s, i) => {
    const d = map.doors[i];
    if (!d) return;
    Object.assign(d, s);
    d.anim = d.open || d.broken ? 1 : 0;
  });

  // recipientes: substitui o loot gerado pela semente pelo estado salvo
  for (const [id, c] of world.containers) {
    const s = W.containers[id];
    if (!s) continue;
    c.inv.items = clone(s.items);
    c.searched = s.searched;
  }

  // corpos e itens no chão
  world.corpses = [];
  for (const k of W.corpses) {
    const c: Corpse = world.createCorpse(k.x, k.y, k.facing, k.look, k.name, clone(k.items), k.isPlayer, k.zombie);
    c.pile = k.pile;
    c.container.searched = k.searched;
  }

  // zumbis (os mortos continuam mortos)
  world.zombies = [];
  for (const z of W.zombies) {
    const nz = world.spawnZombie(z.x, z.y, z.type, z.outfit, z.horde);
    nz.look = z.look;
    nz.hp = z.hp;
    nz.home = { ...z.home };
    nz.facing = z.facing;
  }
  world.hordes = new Map(W.hordes);

  // veículos
  for (const sv of W.vehicles) {
    const v = world.vehicles.find((x) => x.id === sv.id);
    if (!v) continue;
    Object.assign(v, { x: sv.x, y: sv.y, angle: sv.angle, fuel: sv.fuel, hp: sv.hp, speed: 0, engineOn: false, occupant: null });
  }
  for (const [i, f] of W.propFuel) if (world.props[i]) world.props[i].fuel = f;
  for (const [id, l] of W.waterSources) {
    const s = world.waterSources.find((x) => x.id === id);
    if (s) s.liters = l;
  }
  for (const s of W.safePoints) {
    const sp = world.safePoints.find((x) => x.id === s.id);
    if (sp) Object.assign(sp, s);
  }
  world.weather.kind = W.weather.kind;
  world.weather.hoursLeft = W.weather.hoursLeft;
  world.weather.rain = W.weather.rain;
  world.weather.fog = W.weather.fog;
  W.allies.forEach((s, i) => {
    const a = world.allies[i];
    if (!a) return;
    Object.assign(a, { x: s.x, y: s.y, hp: s.hp, mode: s.mode, state: s.state });
    a.alive = s.state !== 'morto';
    a.inv.items = clone(s.inventory);
  });
  Object.assign(world.stats, W.stats);

  // jogador
  const sp = data.players[0];
  const p = world.player;
  p.x = sp.x;
  p.y = sp.y;
  p.facing = sp.facing;
  p.alive = sp.alive;
  const h = new Health();
  Object.assign(h, sp.health);
  p.health = h;
  p.hunger = sp.hunger;
  p.thirst = sp.thirst;
  p.fatigue = sp.fatigue;
  p.stamina = sp.stamina;
  p.sickHours = sp.sickHours;
  p.crouch = sp.crouch;
  p.inv.items = clone(sp.inventory);
  p.equipped = { ...sp.equipped };
  p.deaths = sp.deaths;
  p.lastSafePos = { ...sp.lastSafePos };
  p.sleep = null;
  p.action = null;
  p.openContainer = null;
  p.validateEquipment();
  p.vehicleId = null;
  if (sp.vehicleId) {
    const v = world.vehicleById(sp.vehicleId);
    if (v) {
      p.vehicleId = v.id;
      v.occupant = p.id;
    }
  }
}

// --------------------------------------------------------------- armazenamento local
export function saveToStorage(world: World): boolean {
  try {
    localStorage.setItem(CONFIG.save.key, JSON.stringify(serializeWorld(world)));
    return true;
  } catch {
    return false;
  }
}

export function loadFromStorage(): SaveData | null {
  try {
    const s = localStorage.getItem(CONFIG.save.key);
    return s ? (JSON.parse(s) as SaveData) : null;
  } catch {
    return null;
  }
}

export function hasSave(): boolean {
  return !!loadFromStorage();
}

export function deleteSave() {
  try {
    localStorage.removeItem(CONFIG.save.key);
  } catch {
    /* sem armazenamento */
  }
}
