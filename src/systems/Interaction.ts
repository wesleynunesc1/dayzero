import { CONFIG, TILE } from '../config';
import { createItem, itemDef } from '../data/items';
import { angleDiff, dist } from '../engine/math';
import { Ally } from '../entities/Ally';
import { Vehicle } from '../entities/Vehicle';
import { T } from '../world/tiles';
import { Door } from '../world/TileMap';
import type { World } from '../world/World';
import type { Container, Corpse, Prop, WaterSource } from '../world/types';
import { breakWindow } from './Combat';
import { fatigueLevel } from './Needs';
import { exitSpot } from './VehicleSystem';

export type RestSpot = 'cama' | 'sofa' | 'banco';

export type Interactable =
  | { kind: 'door'; label: string; x: number; y: number; door: Door }
  | { kind: 'unbarricade_door'; label: string; x: number; y: number; door: Door }
  | { kind: 'container'; label: string; x: number; y: number; container: Container }
  | { kind: 'corpse'; label: string; x: number; y: number; corpse: Corpse }
  | { kind: 'window'; label: string; x: number; y: number; tx: number; ty: number }
  | { kind: 'unboard_window'; label: string; x: number; y: number; tx: number; ty: number }
  | { kind: 'ally'; label: string; x: number; y: number; ally: Ally }
  | { kind: 'examine'; label: string; x: number; y: number; prop: Prop }
  | { kind: 'rest'; label: string; x: number; y: number; prop: Prop; spot: RestSpot }
  | { kind: 'water'; label: string; x: number; y: number; source: WaterSource }
  | { kind: 'vehicle'; label: string; x: number; y: number; vehicle: Vehicle }
  | { kind: 'exit_vehicle'; label: string; x: number; y: number; vehicle: Vehicle }
  | { kind: 'wake'; label: string; x: number; y: number }
  | { kind: 'shout'; label: string; x: number; y: number };

const REACH = 16;
const REST_KINDS: Record<string, RestSpot> = { bed: 'cama', sofa: 'sofa', bench: 'banco' };

/** Distância de um ponto até um retângulo em tiles. */
export function distToRect(px: number, py: number, x: number, y: number, w: number, h: number) {
  const rx = x * TILE;
  const ry = y * TILE;
  const cx = Math.max(rx, Math.min(px, rx + w * TILE));
  const cy = Math.max(ry, Math.min(py, ry + h * TILE));
  return Math.hypot(px - cx, py - cy);
}

const hasTool = (world: World, ids: string[]) => ids.some((id) => world.player.inv.count(id) > 0);

/** Encontra o melhor objeto interativo à frente/perto do jogador. */
export function findInteractable(world: World): Interactable | null {
  const p = world.player;
  if (p.dead || !p.alive) return null;
  if (p.sleep) return { kind: 'wake', label: 'Acordar', x: p.x, y: p.y };
  const veh = world.vehicleById(p.vehicleId);
  if (veh) return { kind: 'exit_vehicle', label: `Sair da ${veh.def.name.toLowerCase()}`, x: veh.x, y: veh.y, vehicle: veh };
  if (p.isDown) {
    return { kind: 'shout', label: 'Gritar por socorro (faz barulho)', x: p.x, y: p.y };
  }
  const map = world.map;
  const ptx = Math.floor(p.x / TILE);
  const pty = Math.floor(p.y / TILE);
  let best: Interactable | null = null;
  let bestScore = Infinity;
  const consider = (it: Interactable, d: number, bias = 0) => {
    if (d > REACH) return;
    const a = Math.atan2(it.y - p.y, it.x - p.x);
    const ang = Math.abs(angleDiff(p.facing, a));
    const score = d + ang * 5 + bias;
    if (score < bestScore) {
      bestScore = score;
      best = it;
    }
  };

  const seenContainers = new Set<string>();
  for (let ty = pty - 2; ty <= pty + 2; ty++) {
    for (let tx = ptx - 2; tx <= ptx + 2; tx++) {
      if (!map.inb(tx, ty)) continue;
      const cx = tx * TILE + TILE / 2;
      const cy = ty * TILE + TILE / 2;
      const door = map.doorAt(tx, ty);
      if (door && !door.broken) {
        const d = distToRect(p.x, p.y, tx, ty, 1, 1);
        if (door.barricades > 0) consider({ kind: 'unbarricade_door', label: 'Remover barricada (martelo ou pé de cabra)', x: cx, y: cy, door }, d, 2);
        else consider({ kind: 'door', label: `${door.open ? 'Fechar' : 'Abrir'} ${door.label.toLowerCase()}`, x: cx, y: cy, door }, d);
      }
      const t = map.get(tx, ty);
      if (t === T.WINDOW) {
        const d = distToRect(p.x, p.y, tx, ty, 1, 1);
        consider({ kind: 'window', label: 'Quebrar janela (barulho alto)', x: cx, y: cy, tx, ty }, d, 6);
      } else if (t === T.WINDOW_BOARDED) {
        const d = distToRect(p.x, p.y, tx, ty, 1, 1);
        consider({ kind: 'unboard_window', label: 'Remover tábuas da janela (martelo ou pé de cabra)', x: cx, y: cy, tx, ty }, d, 6);
      }
      const c = world.containerAtTile(tx, ty);
      if (c && !seenContainers.has(c.id)) {
        seenContainers.add(c.id);
        const d = distToRect(p.x, p.y, c.x, c.y, c.w, c.h);
        const ccx = (c.x + c.w / 2) * TILE;
        const ccy = (c.y + c.h / 2) * TILE;
        const n = c.inv.items.length;
        const label = c.searched ? `Abrir ${c.name.toLowerCase()}${n === 0 ? ' (vazio)' : ''}` : `Revistar ${c.name.toLowerCase()}`;
        consider({ kind: 'container', label, x: ccx, y: ccy, container: c }, d);
      }
    }
  }
  for (const pr of world.props) {
    if (Math.abs(pr.x - ptx) > 6 || Math.abs(pr.y - pty) > 6) continue;
    const spot = REST_KINDS[pr.kind];
    if (spot) {
      const d = distToRect(p.x, p.y, pr.x, pr.y, pr.w, pr.h);
      const sleepy = p.fatigue >= CONFIG.needs.minFatigueToSleep;
      const where = spot === 'cama' ? 'na cama' : spot === 'sofa' ? 'no sofá' : 'no banco';
      consider({ kind: 'rest', label: sleepy ? `Dormir ${where}` : `Descansar ${where} (1 h)`, x: (pr.x + pr.w / 2) * TILE, y: (pr.y + pr.h / 2) * TILE, prop: pr, spot }, d, 1);
      continue;
    }
    if (!pr.desc || pr.containerId) continue;
    if (world.waterSources.some((w) => w.x === pr.x && w.y === pr.y)) continue;
    const d = distToRect(p.x, p.y, pr.x, pr.y, pr.w, pr.h);
    if (d > 7) continue; // examinar só bem de perto (evita poluir a tela)
    consider({ kind: 'examine', label: `Examinar ${pr.name?.toLowerCase() ?? 'objeto'}`, x: (pr.x + pr.w / 2) * TILE, y: (pr.y + pr.h / 2) * TILE, prop: pr }, d, 4);
  }
  for (const w of world.waterSources) {
    const d = distToRect(p.x, p.y, w.x, w.y, w.w, w.h);
    const liters = w.liters.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    consider({ kind: 'water', label: `Encher recipiente em: ${w.name.toLowerCase()} (${liters} L, não tratada)`, x: (w.x + w.w / 2) * TILE, y: (w.y + w.h / 2) * TILE, source: w }, d);
  }
  for (const v of world.vehicles) {
    if (Math.abs(v.x - p.x) > 60 || Math.abs(v.y - p.y) > 60) continue;
    let d = Infinity;
    for (const c of v.circles()) d = Math.min(d, dist(c.x, c.y, p.x, p.y) - v.radius);
    consider({ kind: 'vehicle', label: `Entrar na ${v.def.name.toLowerCase()}`, x: v.x, y: v.y, vehicle: v }, d - 2);
  }
  for (const k of world.corpses) {
    const d = dist(p.x, p.y, k.x, k.y) - 5;
    const empty = k.container.inv.items.length === 0;
    consider({ kind: 'corpse', label: `${k.pile ? 'Ver' : 'Revistar'} ${k.name.toLowerCase()}${empty ? ' (vazio)' : ''}`, x: k.x, y: k.y, corpse: k }, d, empty ? 5 : 0);
  }
  for (const a of world.allies) {
    if (a.state === 'morto') continue;
    const d = dist(p.x, p.y, a.x, a.y) - a.radius;
    consider({ kind: 'ally', label: `Falar com ${a.name}`, x: a.x, y: a.y, ally: a }, d - 2);
  }
  return best;
}

export function interact(world: World, it: Interactable) {
  const p = world.player;
  switch (it.kind) {
    case 'door':
      toggleDoor(world, it.door, true);
      break;
    case 'unbarricade_door': {
      if (p.action) return;
      if (!hasTool(world, ['martelo', 'pe_de_cabra'])) {
        world.msg('Você precisa de um martelo ou pé de cabra para soltar a barricada.', 'warn');
        return;
      }
      const door = it.door;
      p.action = {
        kind: 'unbarricade',
        label: 'Removendo barricada',
        t: 0,
        dur: 3,
        allowMove: false,
        onDone: () => {
          if (door.barricades <= 0) return;
          door.barricades--;
          door.hp = Math.max(10, door.hp - 60);
          door.maxHp = Math.max(door.maxHp - 60, 50);
          const r = p.inv.add(createItem('tabua', 1));
          world.makeNoise(p.x, p.y, 6, 'barricada', true, p.id);
          world.msg(`Barricada removida${r.ok ? ' (1 tábua recuperada)' : ''}.`);
          world.events.emit('requestSave', {});
        },
      };
      break;
    }
    case 'window': {
      if (p.action) return;
      p.action = {
        kind: 'window',
        label: 'Quebrando a janela',
        t: 0,
        dur: 0.6,
        allowMove: false,
        onDone: () => {
          breakWindow(world, it.tx, it.ty, true);
          p.attackAnim = 0.25;
          const armed = !!p.weaponItem;
          if (!armed && world.rng.chance(0.35)) {
            const w = p.health.addWound('laceracao');
            w.bleed = 0.2;
            p.health.damage(5);
            world.msg('Você cortou a mão no vidro.', 'danger');
          } else world.msg('A janela se estilhaça. Isso fez muito barulho.', 'warn');
        },
      };
      break;
    }
    case 'unboard_window': {
      if (p.action) return;
      if (!hasTool(world, ['martelo', 'pe_de_cabra'])) {
        world.msg('Você precisa de um martelo ou pé de cabra para soltar as tábuas.', 'warn');
        return;
      }
      p.action = {
        kind: 'unboard',
        label: 'Removendo tábuas',
        t: 0,
        dur: 3,
        allowMove: false,
        onDone: () => {
          const idx = world.map.idx(it.tx, it.ty);
          if (world.map.get(it.tx, it.ty) !== T.WINDOW_BOARDED) return;
          world.map.set(it.tx, it.ty, world.boardedFrom.get(idx) ?? T.WINDOW_BROKEN);
          world.boardedFrom.delete(idx);
          world.windowHp.delete(idx);
          p.inv.add(createItem('tabua', 1));
          world.makeNoise(p.x, p.y, 6, 'barricada', true, p.id);
          world.msg('Tábuas removidas (1 tábua recuperada).');
          world.events.emit('requestSave', {});
        },
      };
      break;
    }
    case 'container':
      openContainer(world, it.container);
      break;
    case 'corpse':
      openContainer(world, it.corpse.container);
      break;
    case 'ally':
      world.events.emit('allyDialog', { allyId: it.ally.id });
      break;
    case 'examine': {
      const pr = it.prop;
      let extra = '';
      if (pr.fuel !== undefined && !pr.burned && (pr.kind === 'car' || pr.kind === 'van' || pr.kind === 'car_police')) {
        extra = pr.fuel > 0 ? ' Ainda há gasolina no tanque — com uma mangueira e um galão dá para retirar.' : ' O tanque está seco.';
      }
      world.msg(`${pr.name}: ${pr.desc}${extra}`);
      break;
    }
    case 'rest':
      startSleep(world, it.spot);
      break;
    case 'wake':
      endSleep(world, 'Você se levantou.');
      break;
    case 'water':
      fillFromSource(world, it.source);
      break;
    case 'vehicle':
      enterVehicle(world, it.vehicle);
      break;
    case 'exit_vehicle':
      exitVehicle(world, it.vehicle);
      break;
    case 'shout':
      if (p.shoutCd > 0) return;
      p.shoutCd = 6;
      world.sound('shout', p.x, p.y, 1);
      world.msg('Você grita por socorro!', 'warn');
      world.makeNoise(p.x, p.y, CONFIG.noise.shout, 'grito', true, p.id);
      break;
  }
}

// ------------------------------------------------------------------ portas
export function toggleDoor(world: World, door: Door, byPlayer: boolean): boolean {
  if (door.broken) return false;
  if (door.barricades > 0) {
    if (byPlayer) world.msg('A porta está barricada.', 'warn');
    return false;
  }
  const cx = door.x * TILE + TILE / 2;
  const cy = door.y * TILE + TILE / 2;
  if (door.open) {
    const blockers = [world.player, ...world.allies, ...world.zombies].filter(
      (a) => a.alive && Math.abs(a.x - cx) < TILE / 2 + a.radius - 1 && Math.abs(a.y - cy) < TILE / 2 + a.radius - 1,
    );
    if (blockers.length) {
      if (byPlayer) world.msg('Algo está bloqueando a porta.', 'warn');
      return false;
    }
  }
  door.open = !door.open;
  world.sound(door.open ? 'door_open' : 'door_close', cx, cy, 0.7);
  world.makeNoise(cx, cy, CONFIG.noise.door, 'porta', byPlayer, null);
  return true;
}

/** Porta fechada ou janela à frente do jogador, para instalar barricada. */
export function findEntrance(world: World): { door?: Door; tx: number; ty: number } | null {
  const p = world.player;
  const map = world.map;
  const ptx = Math.floor(p.x / TILE);
  const pty = Math.floor(p.y / TILE);
  let best: { door?: Door; tx: number; ty: number } | null = null;
  let bs = Infinity;
  for (let ty = pty - 2; ty <= pty + 2; ty++)
    for (let tx = ptx - 2; tx <= ptx + 2; tx++) {
      const door = map.doorAt(tx, ty);
      const t = map.get(tx, ty);
      const okDoor = door && !door.broken && !door.open && door.barricades < 2;
      const okWin = t === T.WINDOW || t === T.WINDOW_BROKEN;
      if (!okDoor && !okWin) continue;
      const d = distToRect(p.x, p.y, tx, ty, 1, 1);
      if (d > REACH) continue;
      const a = Math.atan2(ty * TILE + 8 - p.y, tx * TILE + 8 - p.x);
      const s = d + Math.abs(angleDiff(p.facing, a)) * 5;
      if (s < bs) {
        bs = s;
        best = { door: okDoor ? door : undefined, tx, ty };
      }
    }
  return best;
}

/** Instala um painel de barricada (consumindo-o) na porta/janela à frente. */
export function installBarricade(world: World): boolean {
  const p = world.player;
  const e = findEntrance(world);
  if (!e) {
    world.msg('Fique de frente para uma porta fechada ou uma janela.', 'warn');
    return false;
  }
  if (!hasTool(world, ['martelo'])) {
    world.msg('Você precisa de um martelo para pregar a barricada.', 'warn');
    return false;
  }
  if (p.inv.count('barricada') < 1 || p.action) return false;
  world.makeNoise(p.x, p.y, 8, 'barricada', true, p.id);
  world.sound('door_bash', p.x, p.y, 0.5);
  p.action = {
    kind: 'barricade',
    label: 'Pregando barricada',
    t: 0,
    dur: 4,
    allowMove: false,
    onDone: () => {
      if (p.inv.take('barricada', 1) < 1) return;
      const map = world.map;
      if (e.door) {
        e.door.barricades++;
        e.door.hp += 60;
        e.door.maxHp += 60;
        world.msg(`Porta reforçada (${e.door.barricades}/2 barricadas).`, 'good');
      } else {
        const idx = map.idx(e.tx, e.ty);
        world.boardedFrom.set(idx, map.get(e.tx, e.ty));
        map.set(e.tx, e.ty, T.WINDOW_BOARDED);
        world.windowHp.set(idx, 90);
        world.msg('Janela fechada com tábuas.', 'good');
      }
      world.makeNoise(p.x, p.y, 8, 'barricada', true, p.id);
      world.events.emit('inventoryChanged', {});
      world.events.emit('requestSave', {});
    },
  };
  return true;
}

// ------------------------------------------------------------------ recipientes
export function openContainer(world: World, c: Container) {
  const p = world.player;
  if (p.action) return;
  const doOpen = () => {
    c.searched = true;
    p.openContainer = c.id;
    world.sound('container', p.x, p.y, 0.5);
    world.events.emit('openContainer', { id: c.id });
  };
  if (c.searched) doOpen();
  else {
    p.action = { kind: 'search', label: `Revistando ${c.name.toLowerCase()}`, t: 0, dur: 0.55, allowMove: false, onDone: doOpen };
    world.makeNoise(p.x, p.y, 2, 'revistar', true, p.id);
  }
}

/** O recipiente aberto ainda está ao alcance? */
export function containerInReach(world: World, c: Container): boolean {
  const p = world.player;
  const corpse = world.corpses.find((k) => k.container === c);
  if (corpse) return dist(p.x, p.y, corpse.x, corpse.y) < 26;
  return distToRect(p.x, p.y, c.x, c.y, c.w, c.h) < 22;
}

// ------------------------------------------------------------------ água do ambiente
export function fillFromSource(world: World, src: WaterSource) {
  const p = world.player;
  if (p.action) return;
  const target = p.inv.items.find((i) => {
    const d = itemDef(i.defId);
    return d.water && (i.state?.uses ?? 0) < d.water.capacity;
  });
  if (!target) {
    world.msg('Você precisa de uma garrafa ou galão com espaço.', 'warn');
    return;
  }
  if (src.liters < 0.25) {
    world.msg(`${src.name}: vazio.`, 'warn');
    return;
  }
  const d = itemDef(target.defId);
  const room = d.water!.capacity - (target.state?.uses ?? 0);
  const doses = Math.min(room, Math.floor(src.liters / 0.25));
  // checa peso
  const extra = doses * 0.25;
  if (p.inv.weight() + extra > p.inv.maxWeight + 1e-6) {
    world.msg('Cheio assim, o recipiente ficaria pesado demais para carregar.', 'warn');
    return;
  }
  p.action = {
    kind: 'fill',
    label: `Enchendo ${d.name.toLowerCase()}`,
    t: 0,
    dur: 0.5 + doses * 0.25,
    allowMove: false,
    onDone: () => {
      const n = Math.min(doses, Math.floor(src.liters / 0.25), d.water!.capacity - (target.state?.uses ?? 0));
      target.state = { ...target.state, uses: (target.state?.uses ?? 0) + n, contaminated: true };
      src.liters -= n * 0.25;
      world.sound('drink', p.x, p.y, 0.5);
      world.msg(`Você encheu ${d.name.toLowerCase()} com ${(n * 0.25).toLocaleString('pt-BR')} L de água não tratada. Ferva antes de beber.`, 'info');
      world.events.emit('inventoryChanged', {});
    },
  };
}

// ------------------------------------------------------------------ descanso / sono
export function startSleep(world: World, spot: RestSpot) {
  const p = world.player;
  if (p.action || p.sleep) return;
  const threat = world.zombies.find((z) => dist(z.x, z.y, p.x, p.y) < 9 * TILE && (z.state === 'perseguir' || z.state === 'atacar' || world.map.los(z.x, z.y, p.x, p.y)));
  if (threat) {
    world.msg('Não dá para descansar com infectados por perto.', 'warn');
    return;
  }
  if (p.health.bleeding) {
    world.msg('Você está sangrando. Trate o ferimento antes de descansar.', 'warn');
    return;
  }
  const sleepy = p.fatigue >= CONFIG.needs.minFatigueToSleep;
  p.sleep = { spot, x: p.x, y: p.y, start: world.gameMinutes, maxHours: sleepy ? 10 : 1, hpAtStart: p.health.hp };
  p.crouch = false;
  p.vx = p.vy = 0;
  world.msg(sleepy ? `Você se deita para dormir (${fatigueLevel(p.fatigue).label.toLowerCase()}).` : 'Você descansa um pouco.', 'info');
  world.events.emit('sleepStart', {});
}

export function endSleep(world: World, reason: string) {
  const p = world.player;
  if (!p.sleep) return;
  const hours = (world.gameMinutes - p.sleep.start) / 60;
  p.sleep = null;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  world.msg(`${reason} (${h > 0 ? `${h} h ` : ''}${m} min — ${world.clockText()})`, 'info');
  world.events.emit('sleepEnd', { hours, reason });
  world.events.emit('requestSave', {});
}

// ------------------------------------------------------------------ veículos
export function enterVehicle(world: World, v: Vehicle) {
  const p = world.player;
  if (p.action) return;
  if (v.occupant) return;
  p.vehicleId = v.id;
  v.occupant = p.id;
  p.crouch = false;
  p.running = false;
  p.openContainer = null;
  world.sound('door_close', v.x, v.y, 0.6);
  const fuel = v.fuel.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  world.msg(
    v.fuel > 0
      ? `Você entrou na ${v.def.name.toLowerCase()} (${fuel} L no tanque). W acelera, S freia/ré, A/D esterçam, E sai.`
      : `Você entrou na ${v.def.name.toLowerCase()}, mas o tanque está vazio.`,
    'info',
  );
  world.events.emit('vehicleEnter', { id: v.id });
}

export function exitVehicle(world: World, v: Vehicle): boolean {
  const p = world.player;
  if (Math.abs(v.speed) > 15) {
    world.msg('Pare o veículo antes de sair.', 'warn');
    return false;
  }
  const spot = exitSpot(world, v, p.radius);
  if (!spot) {
    world.msg('Não há espaço para abrir a porta.', 'warn');
    return false;
  }
  v.speed = 0;
  if (v.engineOn) {
    v.engineOn = false;
    world.sound('engine_stop', v.x, v.y, 0.6);
  }
  v.occupant = null;
  p.vehicleId = null;
  p.x = spot.x;
  p.y = spot.y;
  world.sound('door_close', v.x, v.y, 0.6);
  world.events.emit('vehicleExit', { id: v.id });
  world.events.emit('requestSave', {});
  return true;
}

/** Veículo dirigível mais próximo do jogador (a pé). */
export function nearestVehicle(world: World, maxDist = 30): Vehicle | null {
  const p = world.player;
  let best: Vehicle | null = null;
  let bd = maxDist;
  for (const v of world.vehicles) {
    let d = Infinity;
    for (const c of v.circles()) d = Math.min(d, dist(c.x, c.y, p.x, p.y) - v.radius);
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  return best;
}

/** Veículo abandonado (cenário) mais próximo com combustível retirável. */
export function nearestSiphonCar(world: World): Prop | null {
  const p = world.player;
  let best: Prop | null = null;
  let bd = 18;
  for (const pr of world.props) {
    if (pr.fuel === undefined || pr.burned) continue;
    if (pr.kind !== 'car' && pr.kind !== 'van' && pr.kind !== 'car_police') continue;
    const d = distToRect(p.x, p.y, pr.x, pr.y, pr.w, pr.h);
    if (d < bd) {
      bd = d;
      best = pr;
    }
  }
  return best;
}
