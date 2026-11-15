import { CONFIG, TILE } from '../config';
import { createItem, ItemInstance } from '../data/items';
import { EventBus } from '../engine/EventBus';
import { dist2, RNG } from '../engine/math';
import { Actor, Appearance } from '../entities/Actor';
import { Ally } from '../entities/Ally';
import { Npc } from '../entities/Npc';
import { NPC_DEFS } from '../data/npcs';
import { createFactions, type Faction } from '../systems/Factions';
import { Player, SURVIVORS } from '../entities/Player';
import { Zombie, zombieLook } from '../entities/Zombie';
import { Vehicle, VEHICLE_DEFS } from '../entities/Vehicle';
import { WeatherController } from '../systems/Weather';
import { Inventory } from '../systems/Inventory';
import { WoundType } from '../systems/Health';
import { buildWorld, FactionSite, NpcSpawn, Poi, PrisonSite, Town, WorldExtras } from './WorldGen';
import { Pathfinder } from './Pathfinder';
import { TileMap } from './TileMap';
import { TILES } from './tiles';
import type { NoiseEvent } from '../systems/Noise';
import {
  Building,
  Container,
  Corpse,
  Decal,
  LightSource,
  MapLabel,
  Prop,
  SafePoint,
  Tree,
  WaterSource,
} from './types';

export type Tone = 'info' | 'warn' | 'danger' | 'good' | 'npc';
export type SoundName =
  | 'step'
  | 'punch'
  | 'swing'
  | 'hit'
  | 'gunshot'
  | 'empty'
  | 'reload'
  | 'glass'
  | 'door_open'
  | 'door_close'
  | 'door_bash'
  | 'door_break'
  | 'groan'
  | 'alert'
  | 'pickup'
  | 'hurt'
  | 'bite'
  | 'zdie'
  | 'eat'
  | 'drink'
  | 'cloth'
  | 'shout'
  | 'container'
  | 'engine_start'
  | 'engine_stop';

export interface WorldEvents {
  /** `to`: id do sobrevivente destinatário (undefined = todos). */
  message: { text: string; tone: Tone; to?: string };
  noise: { x: number; y: number; radius: number; kind: string; byPlayer: boolean };
  sound: { name: SoundName; x: number; y: number; vol: number };
  playerHurt: { amount: number; kind: WoundType | 'golpe' };
  playerDied: { cause: string };
  playerRespawned: { name: string };
  inventoryChanged: Record<string, never>;
  openContainer: { id: string };
  closeContainer: Record<string, never>;
  shot: { x: number; y: number };
  openMap: { uid?: string };
  allyDialog: { allyId: string };
  vehicleEnter: { id: string };
  vehicleExit: { id: string };
  sleepStart: Record<string, never>;
  sleepEnd: { hours: number; reason: string };
  weatherChanged: { kind: string };
  saved: { auto: boolean };
  /** Pede um salvamento (após fabricar, guardar no abrigo, dormir...). */
  requestSave: Record<string, never>;
  radio: { to: string; from: string; freq: number; text: string; quality: number };
  radioSent: { from: string; freq: number; text: string };
  localSpeech: { from: string; text: string; shout: boolean };
  npcDialog: { npcId: string };
  campaign: { chapter: number; title: string; text: string };
  mission: { id: string; status: string; title: string };
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  kind: 'blood' | 'spark' | 'glass' | 'dust' | 'splinter' | 'smoke';
  size: number;
  color: string;
}

export interface Tracer {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  t: number;
}

export interface NoiseRing {
  x: number;
  y: number;
  r: number;
  t: number;
  max: number;
}

/** Comando de controle do jogador (vindo do teclado/mouse, toque ou rede no futuro). */
export interface PlayerCommand {
  mx: number;
  my: number;
  run: boolean;
  toggleCrouch: boolean;
  aimX: number;
  aimY: number;
  attack: boolean;
  attackPressed: boolean;
  aimHeld: boolean;
  interact: boolean;
  reload: boolean;
}

export const EMPTY_COMMAND: PlayerCommand = {
  mx: 0,
  my: 0,
  run: false,
  toggleCrouch: false,
  aimX: 0,
  aimY: 0,
  attack: false,
  attackPressed: false,
  aimHeld: false,
  interact: false,
  reload: false,
};

/** Grade espacial simples para consultas de vizinhança. */
export class SpatialHash {
  private cells = new Map<number, Actor[]>();
  constructor(private size = 32) {}
  clear() {
    this.cells.clear();
  }
  private key(cx: number, cy: number) {
    return cy * 4096 + cx;
  }
  insert(a: Actor) {
    const k = this.key(Math.floor(a.x / this.size), Math.floor(a.y / this.size));
    let c = this.cells.get(k);
    if (!c) this.cells.set(k, (c = []));
    c.push(a);
  }
  query(x: number, y: number, r: number, out: Actor[]): Actor[] {
    out.length = 0;
    const x0 = Math.floor((x - r) / this.size);
    const x1 = Math.floor((x + r) / this.size);
    const y0 = Math.floor((y - r) / this.size);
    const y1 = Math.floor((y + r) / this.size);
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const c = this.cells.get(this.key(cx, cy));
        if (c) for (const a of c) out.push(a);
      }
    return out;
  }
}

/**
 * Estado completo da simulação. Não depende de renderização nem de DOM,
 * o que permite no futuro rodá-lo em servidor (multiplayer) ou salvar/carregar.
 */
export class World {
  readonly events = new EventBus<WorldEvents>();
  readonly rng: RNG;
  map: TileMap;
  props: Prop[];
  containers: Map<string, Container>;
  containerAt: Map<number, string>;
  trees: Tree[];
  lights: LightSource[];
  decals: Decal[];
  buildings: Building[];
  safePoints: SafePoint[];
  labels: MapLabel[];
  /**
   * Sobrevivente em CONTEXTO. Os sistemas (inventário, interação, itens...) agem sobre
   * `world.player`; a simulação troca o contexto para cada sobrevivente a cada passo
   * (ver `withPlayer`). No cliente, fora da simulação, aponta para o jogador local.
   */
  player: Player;
  /** Todos os sobreviventes do grupo (1–4 humanos; vagas vazias controladas pela IA). */
  players: Player[] = [];
  /** Id do sobrevivente controlado neste computador (cliente). */
  localId = 'p0';
  zombies: Zombie[] = [];
  allies: Ally[] = [];
  corpses: Corpse[] = [];
  particles: Particle[] = [];
  tracers: Tracer[] = [];
  noiseRings: NoiseRing[] = [];
  pathfinder: Pathfinder;
  hash = new SpatialHash(32);
  time = 0;
  /** Novos decalques (sangue) a serem pintados no cenário pelo renderizador. */
  pendingDecals: Decal[] = [];
  playerStart: { x: number; y: number };
  vehicles: Vehicle[] = [];
  waterSources: WaterSource[];
  weather: WeatherController;
  /** Resistência restante de janelas de vidro/barricadas (índice do tile → pontos). */
  windowHp = new Map<number, number>();
  /** Tile original (vidro inteiro ou quebrado) de janelas que receberam tábuas. */
  boardedFrom = new Map<number, number>();
  towns: Town[];
  pois: Poi[];
  prisons: PrisonSite[];
  factionSites: FactionSite[];
  npcSpawns: NpcSpawn[];
  starts: WorldExtras['starts'];
  lab: WorldExtras['lab'];
  radioTower: WorldExtras['radioTower'];
  /** Semente usada para construir o mapa (necessária para carregar o save). */
  readonly seed: number;
  /** Estatísticas exibidas e úteis em testes. */
  stats = { zombiesKilled: 0, shotsFired: 0 };
  private corpseSeq = 0;
  /** Destino compartilhado de cada horda (id -> ponto). */
  hordes = new Map<number, { x: number; y: number; t: number }>();
  /** Facções humanas (Etapa 3). */
  factions = new Map<string, Faction>();
  /** NPCs com identidade (Etapa 3). */
  npcs: Npc[] = [];
  /** Missões (campanha + secundárias) e prisão: ligados pela Simulação. */
  missions: import('../systems/Missions').Missions | null = null;
  prison: import('../systems/Prison').PrisonSystem | null = null;
  radio: import('../systems/Radio').RadioSystem | null = null;
  /** Estado das hordas em escala de mundo (WorldSim). */
  hordeSim: Map<number, import('../systems/WorldSim').HordeState> | null = null;
  /** Ganchos do sistema social/facções (ligados pela Simulação). */
  onHumanHurt: ((target: Actor, attacker: Actor | null, dmg: number) => void) | null = null;
  onHumanDeath: ((a: Actor) => void) | null = null;
  /** Conectado pela Simulação: propaga ruídos aos ouvintes. */
  noiseHook: ((n: NoiseEvent) => void) | null = null;

  constructor(seed = CONFIG.seed) {
    this.seed = seed;
    this.rng = new RNG(seed);
    const b = buildWorld(seed);
    this.towns = b.towns;
    this.pois = b.pois;
    this.prisons = b.prisons;
    this.factionSites = b.factionSites;
    this.npcSpawns = b.npcSpawns;
    this.starts = b.starts;
    this.lab = b.lab;
    this.radioTower = b.radioTower;
    this.waterSources = b.waterSources;
    this.weather = new WeatherController(this.rng);
    b.vehicles.forEach((v, i) => this.vehicles.push(new Vehicle(`v${i}`, VEHICLE_DEFS[v.def], v.x, v.y, v.angle, v.fuel)));
    this.map = b.map;
    this.props = b.props;
    this.containers = b.containers;
    this.containerAt = b.containerAt;
    this.trees = b.trees;
    this.lights = b.lights;
    this.decals = b.decals;
    this.buildings = b.buildings;
    this.safePoints = b.safePoints;
    this.labels = b.labels;
    this.playerStart = b.playerStart;
    this.pathfinder = new Pathfinder(this.map);
    // quatro sobreviventes, cada um numa região diferente
    for (const def of SURVIVORS) {
      const st = def.region === 'oeste' ? { x: b.playerStart.x, y: b.playerStart.y } : (() => {
        const s0 = b.starts.find((s) => s.region === def.region)!;
        return { x: s0.x * TILE + TILE / 2, y: s0.y * TILE + TILE / 2 };
      })();
      const pl = new Player(st.x, st.y, def);
      pl.facing = -Math.PI / 2;
      pl.controller = def.slot === 0 ? 'humano' : 'ia';
      pl.connected = def.slot === 0;
      this.players.push(pl);
    }
    this.player = this.players[0];
    this.allies.push(new Ally(b.allyStart.x, b.allyStart.y));
    for (const s of b.zombies) this.spawnZombie(s.x * TILE, s.y * TILE, s.type, s.outfit, s.horde ?? -1);
    // facções e NPCs com identidade
    this.factions = createFactions(this);
    for (const sp of b.npcSpawns) {
      const def = NPC_DEFS[sp.key];
      if (!def) continue;
      const n = new Npc(def, sp.x * TILE, sp.y * TILE, sp.role as Npc['role'], sp.faction ?? null);
      this.npcs.push(n);
      if (n.faction && n.role !== 'prisioneiro') this.factions.get(n.faction)?.members.push(n.id);
      if (n.role === 'prisioneiro') {
        const pr = this.prisons.find((p) => p.faction === n.faction);
        const tx = Math.floor(sp.x);
        n.cell = pr ? pr.cells.findIndex((c) => tx >= c.x0 && tx <= c.x1) : null;
      }
    }
  }

  spawnZombie(x: number, y: number, type: Zombie['ztype'], outfit?: string, horde = -1): Zombie {
    const z = new Zombie(x, y, type, zombieLook(this.rng, outfit), horde);
    (z as Zombie & { outfit?: string }).outfit = outfit;
    this.map.resolveCircle(z, z.radius);
    this.zombies.push(z);
    return z;
  }

  makeNoise(x: number, y: number, radius: number, kind: string, byPlayer: boolean, sourceId: string | null = null) {
    // a chuva abafa os sons (exceto o próprio alerta entre zumbis próximos)
    const r = kind === 'alerta' ? radius : radius * this.weather.noiseMul;
    this.noiseHook?.({ x, y, radius: r, kind, byPlayer, sourceId });
  }

  // ------------------------------------------------------------- relógio do mundo
  /** Minutos de jogo desde a meia-noite do dia 1. */
  get gameMinutes() {
    return CONFIG.time.startHour * 60 + this.time * CONFIG.time.minutesPerSecond;
  }
  get day() {
    return Math.floor(this.gameMinutes / 1440) + 1;
  }
  get hour() {
    return (this.gameMinutes % 1440) / 60;
  }
  clockText() {
    const m = Math.floor(this.gameMinutes % 1440);
    return `Dia ${this.day}, ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  /** Escuridão natural (0 dia claro … 1 noite fechada), com amanhecer e anoitecer graduais. */
  get nightFactor() {
    const h = this.hour;
    if (h >= 7 && h < 17.5) return 0;
    if (h >= 17.5 && h < 19.5) return (h - 17.5) / 2;
    if (h >= 4.5 && h < 7) return 1 - (h - 4.5) / 2.5;
    return 1;
  }

  vehicleById(id: string | null) {
    return id ? this.vehicles.find((v) => v.id === id) ?? null : null;
  }

  /** Mensagem para o sobrevivente em contexto. */
  msg(text: string, tone: Tone = 'info') {
    this.events.emit('message', { text, tone, to: this.player.id });
  }

  /** Mensagem para todos os sobreviventes. */
  msgAll(text: string, tone: Tone = 'info') {
    this.events.emit('message', { text, tone });
  }

  /** Mensagem para quem estiver perto de um ponto (algo que se ouve/vê no local). */
  msgNear(x: number, y: number, rangePx: number, text: string, tone: Tone = 'info') {
    for (const p of this.players) if (p.alive && Math.hypot(p.x - x, p.y - y) < rangePx) this.events.emit('message', { text, tone, to: p.id });
  }

  /** Célula ativa (perto de um jogador humano)? Fornecido pela Simulação (WorldSim). */
  isActiveAt: (x: number, y: number) => boolean = () => true;

  /** Executa `fn` com `p` como sobrevivente em contexto e restaura o anterior. */
  withPlayer<R>(p: Player, fn: () => R): R {
    const prev = this.player;
    this.player = p;
    try {
      return fn();
    } finally {
      this.player = prev;
    }
  }

  get localPlayer(): Player {
    return this.players.find((p) => p.id === this.localId) ?? this.players[0];
  }

  playerById(id: string | null | undefined): Player | undefined {
    return id ? this.players.find((p) => p.id === id) : undefined;
  }

  /** Distância até o sobrevivente vivo mais próximo. */
  nearestPlayerDist(x: number, y: number): number {
    let best = Infinity;
    for (const p of this.players) {
      if (p.dead) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < best) best = d;
    }
    return best;
  }

  sound(name: SoundName, x: number, y: number, vol = 1) {
    this.events.emit('sound', { name, x, y, vol });
  }

  /** Humanos vivos que podem ser alvo dos zumbis. */
  humans(): Actor[] {
    const out: Actor[] = [];
    for (const p of this.players) if (!p.dead) out.push(p);
    for (const a of this.allies) if (a.state !== 'morto') out.push(a);
    for (const n of this.npcs) if (n.state !== 'morto') out.push(n);
    return out;
  }

  actorById(id: string | null): Actor | null {
    if (!id) return null;
    for (const p of this.players) if (p.id === id) return p.dead ? null : p;
    for (const a of this.allies) if (a.id === id) return a.state === 'morto' ? null : a;
    for (const n of this.npcs) if (n.id === id) return n.state === 'morto' ? null : n;
    for (const z of this.zombies) if (z.id === id) return z;
    return null;
  }

  containerAtTile(x: number, y: number): Container | undefined {
    const id = this.containerAt.get(this.map.idx(x, y));
    return id ? this.containers.get(id) : undefined;
  }

  getContainer(id: string): Container | undefined {
    const c = this.containers.get(id);
    if (c) return c;
    return this.corpses.find((k) => k.container.id === id)?.container;
  }

  // ------------------------------------------------------------- efeitos
  bloodSpray(x: number, y: number, dirX: number, dirY: number, amount = 6) {
    for (let i = 0; i < amount; i++) {
      const sp = this.rng.range(20, 70);
      const a = Math.atan2(dirY, dirX) + this.rng.range(-0.7, 0.7);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: this.rng.range(0.2, 0.45),
        max: 0.45,
        kind: 'blood',
        size: this.rng.range(0.8, 1.6),
        color: this.rng.chance(0.5) ? '#5e1c18' : '#46140f',
      });
    }
  }

  burst(x: number, y: number, kind: Particle['kind'], n: number, color: string, speed = 40) {
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const sp = this.rng.range(speed * 0.3, speed);
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: this.rng.range(0.2, 0.6), max: 0.6, kind, size: this.rng.range(0.6, 1.4), color });
    }
  }

  addDecal(d: Decal) {
    this.decals.push(d);
    this.pendingDecals.push(d);
  }

  noiseRing(x: number, y: number, radiusTiles: number) {
    this.noiseRings.push({ x, y, r: radiusTiles * TILE, t: 0, max: 0.9 });
  }

  // ------------------------------------------------------------- corpos
  createCorpse(x: number, y: number, facing: number, look: Appearance, name: string, items: ItemInstance[], isPlayer: boolean, zombie: boolean): Corpse {
    const inv = new Inventory(999);
    for (const it of items) inv.items.push(it);
    const container: Container = {
      id: `corpo${this.corpseSeq++}`,
      kind: 'corpo',
      name,
      x: Math.floor(x / TILE),
      y: Math.floor(y / TILE),
      w: 1,
      h: 1,
      inv,
      searched: isPlayer,
      building: this.map.buildingAtPx(x, y),
    };
    const c: Corpse = { id: container.id, x, y, facing, look, name, isPlayer, zombie, container };
    this.corpses.push(c);
    // limite de corpos de zumbis sem itens
    if (this.corpses.length > 70) {
      const idx = this.corpses.findIndex((k) => k.zombie && k.container.inv.items.length === 0);
      if (idx >= 0) this.corpses.splice(idx, 1);
    }
    return c;
  }

  zombieDrops(z: Zombie): ItemInstance[] {
    const out: ItemInstance[] = [];
    const outfit = (z as Zombie & { outfit?: string }).outfit;
    if (outfit === 'policia') {
      if (this.rng.chance(0.45)) out.push(createItem('municao_9mm', this.rng.int(2, 6)));
      if (this.rng.chance(0.15)) out.push(createItem('cassetete', 1, this.rng.range(0.3, 0.8)));
    } else if (outfit === 'operario') {
      if (this.rng.chance(0.3)) out.push(createItem(this.rng.pick(['chave_fenda', 'fita_adesiva', 'alicate'])));
    } else if (this.rng.chance(0.18)) {
      out.push(createItem(this.rng.pick(['barra_cereal', 'isqueiro', 'fotografia', 'chocolate', 'bandagem'])));
    }
    return out;
  }

  // ------------------------------------------------------------- consulta
  zombiesNear(x: number, y: number, r: number): Zombie[] {
    const r2 = r * r;
    return this.zombies.filter((z) => dist2(x, y, z.x, z.y) <= r2);
  }

  tileSlow(x: number, y: number): number {
    return TILES[this.map.get(Math.floor(x / TILE), Math.floor(y / TILE))].slow ?? 1;
  }

  buildingOf(a: { x: number; y: number }): Building | null {
    const b = this.map.buildingAtPx(a.x, a.y);
    return b >= 0 ? this.buildings[b] : null;
  }
}
