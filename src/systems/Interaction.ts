import { CONFIG, TILE } from '../config';
import { angleDiff, dist } from '../engine/math';
import { Ally } from '../entities/Ally';
import { T } from '../world/tiles';
import { Door } from '../world/TileMap';
import type { World } from '../world/World';
import type { Container, Corpse, Prop } from '../world/types';
import { breakWindow } from './Combat';

export type Interactable =
  | { kind: 'door'; label: string; x: number; y: number; door: Door }
  | { kind: 'container'; label: string; x: number; y: number; container: Container }
  | { kind: 'corpse'; label: string; x: number; y: number; corpse: Corpse }
  | { kind: 'window'; label: string; x: number; y: number; tx: number; ty: number }
  | { kind: 'ally'; label: string; x: number; y: number; ally: Ally }
  | { kind: 'examine'; label: string; x: number; y: number; prop: Prop }
  | { kind: 'shout'; label: string; x: number; y: number };

const REACH = 16;

/** Distância de um ponto até um retângulo em tiles. */
function distToRect(px: number, py: number, x: number, y: number, w: number, h: number) {
  const rx = x * TILE;
  const ry = y * TILE;
  const cx = Math.max(rx, Math.min(px, rx + w * TILE));
  const cy = Math.max(ry, Math.min(py, ry + h * TILE));
  return Math.hypot(px - cx, py - cy);
}

/** Encontra o melhor objeto interativo à frente/perto do jogador. */
export function findInteractable(world: World): Interactable | null {
  const p = world.player;
  if (p.dead) return null;
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
        consider({ kind: 'door', label: `${door.open ? 'Fechar' : 'Abrir'} ${door.label.toLowerCase()}`, x: cx, y: cy, door }, d);
      }
      const t = map.get(tx, ty);
      if (t === T.WINDOW) {
        const d = distToRect(p.x, p.y, tx, ty, 1, 1);
        consider({ kind: 'window', label: 'Quebrar janela (barulho alto)', x: cx, y: cy, tx, ty }, d, 6);
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
    if (!pr.desc || pr.containerId) continue;
    if (Math.abs(pr.x - ptx) > 6 || Math.abs(pr.y - pty) > 6) continue;
    const d = distToRect(p.x, p.y, pr.x, pr.y, pr.w, pr.h);
    if (d > 7) continue; // examinar só bem de perto (evita poluir a tela)
    consider({ kind: 'examine', label: `Examinar ${pr.name?.toLowerCase() ?? 'objeto'}`, x: (pr.x + pr.w / 2) * TILE, y: (pr.y + pr.h / 2) * TILE, prop: pr }, d, 4);
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
    case 'container':
      openContainer(world, it.container);
      break;
    case 'corpse':
      openContainer(world, it.corpse.container);
      break;
    case 'ally':
      world.events.emit('allyDialog', { allyId: it.ally.id });
      break;
    case 'examine':
      world.msg(`${it.prop.name}: ${it.prop.desc}`);
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

export function toggleDoor(world: World, door: Door, byPlayer: boolean): boolean {
  if (door.broken) return false;
  const cx = door.x * TILE + TILE / 2;
  const cy = door.y * TILE + TILE / 2;
  if (door.open) {
    // não fecha se alguém estiver no vão
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
