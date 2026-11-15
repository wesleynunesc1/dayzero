import { CONFIG, RespawnMode } from '../config';
import { getUidCounter, ItemInstance, setUidCounter } from '../data/items';
import { Appearance } from '../entities/Actor';
import { EquipSlot, Player } from '../entities/Player';
import type { Npc } from '../entities/Npc';
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
export const SAVE_VERSION = 3;

export interface SavedPlayer {
  id: string;
  slot?: number;
  controller?: 'humano' | 'ia';
  owner?: string | null;
  connected?: boolean;
  vaccinated?: boolean;
  captive?: Player['captive'];
  markers?: Player['markers'];
  contacts?: string[];
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
    doors: { open: boolean; broken: boolean; hp: number; maxHp: number; barricades: number; locked?: string }[];
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
    /** Etapa 3+ */
    npcs?: SavedNpc[];
    factions?: Record<string, { reputation: Record<string, number>; resources: Record<string, number>; relations: Record<string, number>; members: string[] }>;
    missions?: { chapter: number; finished: boolean; flags: Record<string, boolean | number | string>; done: string[]; side: unknown[]; log: unknown[]; lab: { fuel: number; on: boolean; synth: number; noiseT: number }; rendezvous: { name: string; x: number; y: number } | null };
    radio?: { baseContact: string[]; broadcasts: [number, number][] };
    hordeSim?: [number, { x: number; y: number; destX: number; destY: number; destName: string; restHours: number }][];
  };
  players: SavedPlayer[];
}

export interface SavedNpc {
  id: string;
  x: number;
  y: number;
  facing: number;
  hp: number;
  state: string;
  activity: string;
  role: string;
  faction: string | null;
  emotions: Record<string, number>;
  memory: Npc['memory'];
  relations: [string, Npc extends { relations: Map<string, infer R> } ? R : never][];
  hunger: number;
  thirst: number;
  home: { x: number; y: number };
  followId: string | null;
  requests: Npc['requests'];
  goalIdx: number;
  goalDone: boolean;
  cell: number | null;
  hostileTo: string[];
  inventory: ItemInstance[];
  weaponUid: string;
  deadAt: number;
  lastAttacker: string | null;
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

export function serializePlayer(p: Player): SavedPlayer {
  return {
    id: p.id,
    slot: p.slot,
    controller: p.controller,
    owner: p.owner,
    connected: p.connected,
    vaccinated: p.health.vaccinated,
    captive: p.captive ? { ...p.captive } : null,
    markers: clone(p.markers),
    contacts: [...p.contacts],
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
  };
}

export function serializeNpc(n: Npc): SavedNpc {
  return {
    id: n.id, x: n.x, y: n.y, facing: n.facing, hp: n.hp, state: n.state, activity: n.activity, role: n.role, faction: n.faction,
    emotions: { ...n.emotions }, memory: clone(n.memory), relations: [...n.relations].map(([k, r]) => [k, { ...r }]),
    hunger: n.hunger, thirst: n.thirst, home: { ...n.home }, followId: n.followId, requests: clone(n.requests), goalIdx: n.goalIdx,
    goalDone: n.goalDone, cell: n.cell, hostileTo: [...n.hostileTo], inventory: clone(n.inv.items), weaponUid: n.weaponUid, deadAt: n.deadAt, lastAttacker: n.lastAttacker,
  };
}

export function applyNpc(n: Npc, s: SavedNpc) {
  Object.assign(n, {
    x: s.x, y: s.y, facing: s.facing, hp: s.hp, state: s.state, activity: s.activity, role: s.role, faction: s.faction,
    hunger: s.hunger, thirst: s.thirst, home: { ...s.home }, followId: s.followId, goalIdx: s.goalIdx, goalDone: s.goalDone, cell: s.cell,
    weaponUid: s.weaponUid, deadAt: s.deadAt, lastAttacker: s.lastAttacker,
  });
  n.alive = s.state !== 'morto';
  n.emotions = { ...(s.emotions as Npc['emotions']) };
  n.memory = clone(s.memory);
  n.relations = new Map(s.relations.map(([k, r]) => [k, { ...r }]));
  n.requests = clone(s.requests);
  n.hostileTo = new Set(s.hostileTo);
  n.inv.items = clone(s.inventory);
}

/** Aplica o estado salvo de um sobrevivente (também usado na sincronização de rede). */
export function applyPlayer(world: World, p: Player, sp: SavedPlayer) {
  p.x = sp.x;
  p.y = sp.y;
  p.facing = sp.facing;
  p.alive = sp.alive;
  const h = new Health();
  Object.assign(h, sp.health);
  h.vaccinated = !!sp.vaccinated;
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
  if (sp.controller) p.controller = sp.controller;
  if (sp.owner !== undefined) p.owner = sp.owner;
  if (sp.connected !== undefined) p.connected = sp.connected;
  p.captive = sp.captive ? { ...sp.captive } : null;
  p.markers = clone(sp.markers ?? []);
  p.contacts = new Set(sp.contacts ?? []);
  p.validateEquipment();
  if (p.vehicleId && p.vehicleId !== sp.vehicleId) {
    const old = world.vehicleById(p.vehicleId);
    if (old && old.occupant === p.id) old.occupant = null;
  }
  p.vehicleId = null;
  if (sp.vehicleId) {
    const v = world.vehicleById(sp.vehicleId);
    if (v) {
      p.vehicleId = v.id;
      v.occupant = p.id;
    }
  }
}

export function serializeWorld(world: World): SaveData {
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
      doors: world.map.doors.map((d) => ({ open: d.open, broken: d.broken, hp: d.hp, maxHp: d.maxHp, barricades: d.barricades, locked: d.locked })),
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
      npcs: world.npcs.map(serializeNpc),
      factions: Object.fromEntries([...world.factions].map(([id, f]) => [id, { reputation: { ...f.reputation }, resources: { ...f.resources }, relations: { ...f.relations }, members: [...f.members] }])),
      missions: world.missions
        ? { chapter: world.missions.chapter, finished: world.missions.finished, flags: { ...world.missions.flags }, done: [...world.missions.done], side: clone(world.missions.side), log: clone(world.missions.log), lab: { ...world.missions.lab }, rendezvous: world.missions.rendezvous }
        : undefined,
      radio: world.radio ? { baseContact: [...world.radio.baseContact], broadcasts: world.radio.broadcasts.map((b) => [b.idx, b.t] as [number, number]) } : undefined,
      hordeSim: world.hordeSim ? [...world.hordeSim].map(([k, v]) => [k, { ...v }]) : undefined,
    },
    players: world.players.map(serializePlayer),
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
  for (const n of data.world.npcs ?? []) add(n.inventory);
  return { total: seen.size, duplicates: dup };
}

/** Aplica o save em um mundo recém-construído com a mesma semente. */
export function applySave(world: World, data: SaveData) {
  if (data.version !== SAVE_VERSION && data.version !== 2) throw new Error(`Versão de save incompatível (${data.version}).`);
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

  // sobreviventes (save da Etapa 2 tem um só jogador: vai para a vaga 0)
  for (const sp of data.players) {
    const p = sp.id === 'local' ? world.players[0] : world.playerById(sp.id);
    if (!p) continue;
    p.sleep = null;
    p.action = null;
    p.openContainer = null;
    applyPlayer(world, p, sp);
  }

  // Etapa 3+: NPCs, facções, campanha, rádio, hordas
  for (const sn of W.npcs ?? []) {
    const n = world.npcs.find((x) => x.id === sn.id);
    if (n) applyNpc(n, sn);
  }
  for (const [id, sf] of Object.entries(W.factions ?? {})) {
    const f = world.factions.get(id);
    if (!f) continue;
    f.reputation = { ...sf.reputation };
    f.resources = { ...(sf.resources as typeof f.resources) };
    f.relations = { ...sf.relations };
    f.members = [...sf.members];
  }
  if (W.missions && world.missions) {
    const m = world.missions;
    m.chapter = W.missions.chapter;
    m.finished = W.missions.finished;
    m.flags = { ...W.missions.flags };
    m.done = new Set(W.missions.done);
    m.side = clone(W.missions.side) as typeof m.side;
    m.log = clone(W.missions.log) as typeof m.log;
    m.lab = { ...W.missions.lab };
    m.rendezvous = W.missions.rendezvous;
  }
  if (W.radio && world.radio) {
    world.radio.baseContact = new Set(W.radio.baseContact);
    W.radio.broadcasts.forEach(([idx, t], i) => {
      const b = world.radio!.broadcasts[i];
      if (b) Object.assign(b, { idx, t });
    });
  }
  if (W.hordeSim && world.hordeSim) for (const [k, v] of W.hordeSim) world.hordeSim.set(k, { id: k, ...v });
}

// --------------------------------------------------------------- armazenamento local
export function saveToStorage(world: World): boolean {
  try {
    localStorage.setItem(CONFIG.save.key, JSON.stringify(serializeWorld(world)));
    localStorage.removeItem(CONFIG.save.legacyKey);
    return true;
  } catch {
    return false;
  }
}

export function loadFromStorage(): SaveData | null {
  try {
    const s = localStorage.getItem(CONFIG.save.key) ?? localStorage.getItem(CONFIG.save.legacyKey);
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
