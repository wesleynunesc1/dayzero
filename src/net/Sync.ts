import { TILE, CONFIG } from '../config';
import type { ItemInstance } from '../data/items';
import type { Appearance } from '../entities/Actor';
import { Zombie, ZombieType } from '../entities/Zombie';
import type { Decal } from '../world/types';
import type { World } from '../world/World';
import { applyNpc, applyPlayer, SavedNpc, SavedPlayer, serializeNpc, serializePlayer } from '../systems/Save';

/**
 * Sincronização servidor → cliente.
 * O servidor monta, para CADA cliente, um "snapshot" com o que interessa a ele
 * (gerenciamento de interesse: só entidades num raio ao redor do seu sobrevivente),
 * mais as diferenças de portas, tiles, recipientes e corpos desde o último envio.
 * O cliente nunca decide nada: só aplica o que recebe e interpola posições.
 */

type ZRow = [string, number, number, number, number, number, ZombieType, number];
type NRow = [string, number, number, number, number, string, string, number];

export interface Snapshot {
  t: number;
  weather: { kind: World['weather']['kind']; rain: number; fog: number; hoursLeft: number };
  /** Posições de todos os sobreviventes (x, y, facing, flags) — o cliente só DESENHA quem estiver à vista. */
  pos: [string, number, number, number, number][];
  /** Estado completo de sobreviventes que mudou. */
  players?: SavedPlayer[];
  /** Extras do jogador local (ação em andamento, sono, recipiente aberto). */
  me?: { action: { label: string; t: number; dur: number } | null; sleep: boolean; openContainer: string | null; attackCd: number };
  z: ZRow[];
  zlook?: [string, Appearance, string | undefined][];
  n: NRow[];
  npcs?: SavedNpc[];
  allies?: [number, number, number, number, number, string][];
  v: [string, number, number, number, number, number, string | null, number][];
  doors?: [number, boolean, boolean, number, string | null, number][];
  tiles?: [number, number][];
  cont?: [string, ItemInstance[], boolean][];
  corpses?: { id: string; cid: string; x: number; y: number; facing: number; look: Appearance; name: string; isPlayer: boolean; zombie: boolean; pile?: boolean; searched: boolean; items: ItemInstance[] }[];
  decals?: Decal[];
  tracers?: World['tracers'];
  mis?: unknown;
  fac?: Record<string, { reputation: Record<string, number>; resources: Record<string, number> }>;
  /** Situação do grupo (sem posição): quem é humano/IA, conectado, morto, preso, contatos. */
  roster?: [string, 'humano' | 'ia', boolean, boolean, boolean, string[], string | null][];
}

/** Estado do que já foi enviado a um cliente (para mandar só diferenças). */
export class ClientView {
  playerKeys = new Map<string, string>();
  zSeen = new Set<string>();
  npcKeys = new Map<string, string>();
  doorKeys: string[] = [];
  tiles: Uint8Array | null = null;
  contKeys = new Map<string, string>();
  corpseKey = '';
  decalIdx = 0;
  tracerIdx = 0;
  slowT = 0;
  tileT = 0;
  full = true;
}

const R2 = (v: number) => Math.round(v * 100) / 100;
const itemsKey = (items: ItemInstance[]) => items.map((i) => `${i.uid}:${i.qty}:${JSON.stringify(i.state ?? '')}:${i.condition ?? ''}`).join('|');

/** Monta o snapshot de um cliente. `outbox` traz efeitos visuais recentes (decalques, traçantes). */
export function buildSnapshot(w: World, playerId: string, view: ClientView, dt: number, outbox: { decals: Decal[]; tracers: World['tracers'] }): Snapshot {
  const me = w.playerById(playerId)!;
  const R = CONFIG.multiplayer.interestRadius * TILE;
  const near = (x: number, y: number, r = R) => Math.abs(x - me.x) < r && Math.abs(y - me.y) < r;
  const snap: Snapshot = {
    t: w.time,
    weather: { kind: w.weather.kind, rain: w.weather.rain, fog: w.weather.fog, hoursLeft: w.weather.hoursLeft },
    // só quem está no raio de interesse (o cliente nunca recebe a posição de quem está longe)
    pos: w.players.filter((p) => p === me || near(p.x, p.y)).map((p) => [p.id, R2(p.x), R2(p.y), R2(p.facing), (p.crouch ? 1 : 0) | (p.isDown ? 2 : 0) | (p.sleep ? 4 : 0) | (p.moving ? 8 : 0)]),
    z: [],
    n: [],
    v: [],
  };
  // sobreviventes: estado completo só quando muda
  const changed: SavedPlayer[] = [];
  for (const p of w.players) {
    if (p !== me && !near(p.x, p.y)) continue;
    const s = serializePlayer(p);
    if (p !== me) s.markers = [];
    const key = JSON.stringify({ ...s, x: 0, y: 0, facing: 0, stamina: Math.round(s.stamina) });
    if (view.full || view.playerKeys.get(p.id) !== key) {
      view.playerKeys.set(p.id, key);
      changed.push(s);
    }
  }
  if (changed.length) snap.players = changed;
  snap.me = { action: me.action ? { label: me.action.label, t: me.action.t, dur: me.action.dur } : null, sleep: !!me.sleep, openContainer: me.openContainer, attackCd: me.attackCd };

  // zumbis no raio de interesse
  const looks: [string, Appearance, string | undefined][] = [];
  for (const z of w.zombies) {
    if (!near(z.x, z.y)) continue;
    const flags = (z.crawler ? 1 : 0) | (z.knockedDown > 0 ? 2 : 0) | (z.state === 'perseguir' || z.state === 'atacar' ? 4 : 0) | (z.attackWind > 0 || z.attackAnim > 0 ? 8 : 0) | (z.moving ? 16 : 0);
    snap.z.push([z.id, R2(z.x), R2(z.y), R2(z.facing), Math.round(z.hp), flags, z.ztype, z.horde]);
    if (!view.zSeen.has(z.id)) {
      view.zSeen.add(z.id);
      looks.push([z.id, z.look, (z as Zombie & { outfit?: string }).outfit]);
    }
  }
  if (looks.length) snap.zlook = looks;

  // NPCs: posição sempre (no raio); estado completo quando muda (memória, emoções, inventário)
  const npcFull: SavedNpc[] = [];
  for (const n of w.npcs) {
    if (!near(n.x, n.y)) continue;
    snap.n.push([n.id, R2(n.x), R2(n.y), R2(n.facing), Math.round(n.hp), n.state, n.activity, n.attackAnim > 0 ? 1 : 0]);
    if (view.slowT <= 0 || view.full) {
      const s = serializeNpc(n);
      const key = JSON.stringify({ ...s, x: 0, y: 0, facing: 0, emotions: Object.values(s.emotions).map(Math.round), hunger: Math.round(s.hunger), thirst: Math.round(s.thirst) });
      if (view.npcKeys.get(n.id) !== key) {
        view.npcKeys.set(n.id, key);
        npcFull.push(s);
      }
    }
  }
  if (npcFull.length) snap.npcs = npcFull;
  snap.allies = w.allies.map((a) => [R2(a.x), R2(a.y), R2(a.facing), Math.round(a.hp), a.attackAnim > 0 ? 1 : 0, a.state]);
  for (const v of w.vehicles) if (near(v.x, v.y)) snap.v.push([v.id, R2(v.x), R2(v.y), R2(v.angle), R2(v.speed), R2(v.fuel), v.occupant, v.engineOn ? 1 : 0]);

  // portas (todas; só as que mudaram)
  const doors: NonNullable<Snapshot['doors']> = [];
  w.map.doors.forEach((d, i) => {
    const key = `${d.open}|${d.broken}|${Math.round(d.hp)}|${d.locked ?? ''}|${d.barricades}`;
    if (view.full || view.doorKeys[i] !== key) {
      view.doorKeys[i] = key;
      doors.push([i, d.open, d.broken, Math.round(d.hp), d.locked ?? null, d.barricades]);
    }
  });
  if (doors.length) snap.doors = doors;

  // tiles alterados (janelas quebradas/barricadas, construções) — 1×/s
  view.tileT -= dt;
  if (view.tileT <= 0 || view.full) {
    view.tileT = 1;
    const g = w.map.ground;
    if (!view.tiles) view.tiles = g.slice();
    else {
      const out: [number, number][] = [];
      for (let i = 0; i < g.length; i++)
        if (g[i] !== view.tiles[i]) {
          view.tiles[i] = g[i];
          out.push([i, g[i]]);
        }
      if (out.length) snap.tiles = out;
    }
  }

  // recipientes: o aberto sempre; os próximos quando mudam (2×/s)
  view.slowT -= dt;
  const cont: NonNullable<Snapshot['cont']> = [];
  const slow = view.slowT <= 0;
  for (const c of w.containers.values()) {
    const open = me.openContainer === c.id;
    if (!open && !(slow && near((c.x + c.w / 2) * TILE, (c.y + c.h / 2) * TILE, 12 * TILE))) continue;
    const key = itemsKey(c.inv.items) + c.searched;
    if (view.contKeys.get(c.id) !== key) {
      view.contKeys.set(c.id, key);
      cont.push([c.id, c.inv.items, c.searched]);
    }
  }
  if (cont.length) snap.cont = cont;
  if (slow) {
    view.slowT = 0.5;
    const corpses = w.corpses.filter((k) => near(k.x, k.y));
    const key = corpses.map((k) => k.id + itemsKey(k.container.inv.items) + k.container.searched).join(';');
    const openCorpse = w.corpses.find((k) => k.container.id === me.openContainer);
    if (key !== view.corpseKey || openCorpse) {
      view.corpseKey = key;
      snap.corpses = corpses.map((k) => ({ id: k.id, cid: k.container.id, x: k.x, y: k.y, facing: k.facing, look: k.look, name: k.name, isPlayer: k.isPlayer, zombie: k.zombie, pile: k.pile, searched: k.container.searched, items: k.container.inv.items }));
    }
    const m = w.missions;
    if (m) snap.mis = { chapter: m.chapter, finished: m.finished, flags: m.flags, done: [...m.done], side: m.side, log: m.log.slice(-20), lab: m.lab, rendezvous: m.rendezvous };
    snap.roster = w.players.map((p) => [p.id, p.controller, p.connected, p.dead, !!p.captive, [...p.contacts], p.owner]);
    snap.fac = Object.fromEntries([...w.factions].map(([id, f]) => [id, { reputation: f.reputation, resources: f.resources }]));
  }
  const dec = outbox.decals.filter((d) => near(d.x, d.y));
  if (dec.length) snap.decals = dec;
  const tr = outbox.tracers.filter((t) => near(t.x1, t.y1));
  if (tr.length) snap.tracers = tr;
  view.full = false;
  return snap;
}

// ===================================================================== cliente

/** Alvos de interpolação (o cliente suaviza posições entre snapshots). */
const targets = new WeakMap<object, { x: number; y: number; f: number }>();

function setTarget(o: { x: number; y: number; facing: number }, x: number, y: number, f: number, snap: boolean) {
  if (snap) {
    o.x = x;
    o.y = y;
    o.facing = f;
  }
  targets.set(o, { x, y, f });
}

export function applySnapshot(w: World, s: Snapshot) {
  w.time = s.t;
  Object.assign(w.weather, s.weather);
  for (const sp of s.players ?? []) {
    const p = w.playerById(sp.id);
    if (!p) continue;
    const { x, y, facing } = p;
    applyPlayer(w, p, sp);
    // a posição vem do canal de posições (interpolado)
    p.x = x;
    p.y = y;
    p.facing = facing;
  }
  for (const [id, x, y, f, flags] of s.pos) {
    const p = w.playerById(id);
    if (!p) continue;
    const far = Math.abs(p.x - x) > 48 || Math.abs(p.y - y) > 48;
    setTarget(p, x, y, f, far);
    p.crouch = !!(flags & 1);
    p.moving = !!(flags & 8);
    p.sleep = flags & 4 ? (p.sleep ?? { t: 0, hours: 0, spot: 'cama' as never, quality: 1 } as never) : null;
  }
  const me = w.localPlayer;
  if (s.me) {
    me.action = s.me.action ? ({ kind: 'search', allowMove: true, ...s.me.action } as never) : null;
    me.openContainer = s.me.openContainer;
    me.attackCd = s.me.attackCd;
  }
  // zumbis: substitui a lista pelo que está no raio de interesse
  const byId = new Map(w.zombies.map((z) => [z.id, z]));
  const looks = new Map((s.zlook ?? []).map(([id, look, outfit]) => [id, { look, outfit }]));
  const next: Zombie[] = [];
  for (const [id, x, y, f, hp, flags, type, horde] of s.z) {
    let z = byId.get(id);
    if (!z) {
      const l = looks.get(id) ?? zombieLooks.get(id);
      z = new Zombie(x, y, type, l?.look ?? { skin: '#7a8a6a', hair: '#222', hairStyle: 0, shirt: '#555', pants: '#333', shoes: '#222', gore: 1 }, horde);
      (z as { id: string }).id = id;
      if (l) zombieLooks.set(id, l);
    }
    if (looks.has(id)) {
      z.look = looks.get(id)!.look;
      zombieLooks.set(id, looks.get(id)!);
    }
    setTarget(z, x, y, f, !byId.has(id));
    z.hp = hp;
    z.crawler = !!(flags & 1);
    z.knockedDown = flags & 2 ? 1 : 0;
    (z as { state: string }).state = flags & 4 ? 'perseguir' : 'vagar';
    z.attackAnim = flags & 8 ? 0.2 : 0;
    z.moving = !!(flags & 16);
    next.push(z);
  }
  w.zombies = next;
  // NPCs
  for (const sn of s.npcs ?? []) {
    const n = w.npcs.find((x) => x.id === sn.id);
    if (!n) continue;
    const { x, y, facing } = n;
    applyNpc(n, sn);
    n.x = x;
    n.y = y;
    n.facing = facing;
  }
  for (const [id, x, y, f, hp, state, activity, atk] of s.n) {
    const n = w.npcs.find((q) => q.id === id);
    if (!n) continue;
    setTarget(n, x, y, f, Math.abs(n.x - x) > 64 || Math.abs(n.y - y) > 64);
    n.hp = hp;
    n.state = state as never;
    n.activity = activity as never;
    n.alive = state !== 'morto';
    n.attackAnim = atk ? 0.2 : 0;
  }
  (s.allies ?? []).forEach(([x, y, f, hp, atk, state], i) => {
    const a = w.allies[i];
    if (!a) return;
    setTarget(a, x, y, f, false);
    a.hp = hp;
    a.attackAnim = atk ? 0.2 : 0;
    a.state = state as never;
    a.alive = state !== 'morto';
  });
  for (const [id, x, y, ang, speed, fuel, occ, on] of s.v) {
    const v = w.vehicleById(id);
    if (!v) continue;
    const t = { x: v.x, y: v.y, facing: v.angle };
    setTarget(t, x, y, ang, true);
    Object.assign(v, { x, y, angle: ang, speed, fuel, occupant: occ, engineOn: !!on });
  }
  for (const [i, open, broken, hp, locked, bar] of s.doors ?? []) {
    const d = w.map.doors[i];
    if (!d) continue;
    Object.assign(d, { open, broken, hp, locked: locked ?? undefined, barricades: bar });
  }
  if (s.tiles?.length) for (const [i, t] of s.tiles) w.map.set(i % w.map.w, Math.floor(i / w.map.w), t as never);
  for (const [id, items, searched] of s.cont ?? []) {
    const c = w.containers.get(id);
    if (c) {
      c.inv.items = items;
      c.searched = searched;
    }
  }
  if (s.corpses) {
    const R = CONFIG.multiplayer.interestRadius * TILE;
    w.corpses = w.corpses.filter((k) => Math.abs(k.x - me.x) >= R || Math.abs(k.y - me.y) >= R);
    for (const k of s.corpses) {
      const c = w.createCorpse(k.x, k.y, k.facing, k.look, k.name, k.items, k.isPlayer, k.zombie);
      (c as { id: string }).id = k.id;
      c.container.id = k.cid;
      c.pile = k.pile;
      c.container.searched = k.searched;
    }
  }
  for (const d of s.decals ?? []) w.addDecal(d);
  for (const t of s.tracers ?? []) w.tracers.push({ ...t });
  if (s.mis && w.missions) {
    const m = s.mis as { chapter: number; finished: boolean; flags: Record<string, boolean | number | string>; done: string[]; side: never[]; log: never[]; lab: typeof w.missions.lab; rendezvous: typeof w.missions.rendezvous };
    Object.assign(w.missions, { chapter: m.chapter, finished: m.finished, flags: m.flags, side: m.side, log: m.log, lab: m.lab, rendezvous: m.rendezvous });
    w.missions.done = new Set(m.done);
  }
  for (const [id, ctrl, conn, dead, captive, contacts, owner] of s.roster ?? []) {
    const p = w.playerById(id);
    if (!p) continue;
    p.owner = owner;
    p.controller = ctrl;
    p.connected = conn;
    if (p !== me) {
      p.health.dead = dead;
      p.captive = captive ? p.captive ?? { faction: '?', cell: 0, since: 0 } : null;
    }
    p.contacts = new Set(contacts);
  }
  for (const [id, f] of Object.entries(s.fac ?? {})) {
    const ff = w.factions.get(id);
    if (ff) {
      ff.reputation = f.reputation;
      ff.resources = f.resources as typeof ff.resources;
    }
  }
}

const zombieLooks = new Map<string, { look: Appearance; outfit?: string }>();

/** Interpola posições recebidas e anima portas/partículas no cliente. */
export function clientTick(w: World, dt: number) {
  const k = Math.min(1, dt * 14);
  const lerp = (o: { x: number; y: number; facing: number; walkPhase?: number }) => {
    const t = targets.get(o);
    if (!t) return;
    const dx = t.x - o.x;
    const dy = t.y - o.y;
    o.x += dx * k;
    o.y += dy * k;
    let df = t.f - o.facing;
    while (df > Math.PI) df -= Math.PI * 2;
    while (df < -Math.PI) df += Math.PI * 2;
    o.facing += df * k;
    if (o.walkPhase !== undefined) o.walkPhase += Math.hypot(dx * k, dy * k) * 0.22;
  };
  for (const p of w.players) lerp(p);
  for (const z of w.zombies) lerp(z);
  for (const n of w.npcs) lerp(n);
  for (const a of w.allies) lerp(a);
  for (const a of [...w.players, ...w.zombies, ...w.npcs, ...w.allies]) {
    if (a.hurtFlash > 0) a.hurtFlash -= dt;
    if (a.attackAnim > 0) a.attackAnim -= dt;
  }
  for (const d of w.map.doors) {
    const target = d.open || d.broken ? 1 : 0;
    d.anim += Math.sign(target - d.anim) * Math.min(Math.abs(target - d.anim), dt * 6);
  }
  for (let i = w.tracers.length - 1; i >= 0; i--) {
    w.tracers[i].t -= dt;
    if (w.tracers[i].t <= 0) w.tracers.splice(i, 1);
  }
  for (let i = w.particles.length - 1; i >= 0; i--) {
    const p = w.particles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.life <= 0) w.particles.splice(i, 1);
  }
}
