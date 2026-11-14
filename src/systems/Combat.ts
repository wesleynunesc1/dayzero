import { CONFIG, TILE } from '../config';
import { itemDef, WeaponStats } from '../data/items';
import { angleDiff, clamp } from '../engine/math';
import { Actor } from '../entities/Actor';
import { Ally } from '../entities/Ally';
import { Player } from '../entities/Player';
import { Zombie } from '../entities/Zombie';
import { T } from '../world/tiles';
import type { World } from '../world/World';
import { WoundType, WOUND_LABEL } from './Health';

/** Faz o zumbi reagir a quem o atacou. */
function provoke(z: Zombie, attacker: Actor | null) {
  if (!attacker) return;
  z.targetId = attacker.id;
  z.lastKnown = { x: attacker.x, y: attacker.y };
  z.awareness = 1;
  if (z.state !== 'atacar') z.setState('perseguir');
}

export function damageZombie(
  world: World,
  z: Zombie,
  dmg: number,
  fromX: number,
  fromY: number,
  knock: number,
  knockdownChance: number,
  attacker: Actor | null,
) {
  if (z.hp <= 0) return;
  z.hp -= dmg;
  z.hurtFlash = 0.16;
  z.stagger = Math.max(z.stagger, 0.35);
  z.attackWind = 0;
  const dx = z.x - fromX;
  const dy = z.y - fromY;
  const d = Math.hypot(dx, dy) || 1;
  z.push(dx / d, dy / d, knock);
  world.bloodSpray(z.x, z.y, dx / d, dy / d, 5);
  world.sound('hit', z.x, z.y, 0.9);
  if (world.rng.chance(0.55)) {
    world.addDecal({ x: z.x + (dx / d) * 4, y: z.y + (dy / d) * 4, kind: 'blood', r: world.rng.range(2.5, 5), rot: world.rng.range(0, 6), seed: world.rng.int(0, 99999) });
  }
  if (!z.crawler && world.rng.chance(knockdownChance)) {
    z.knockedDown = world.rng.range(1.2, 2.2);
  }
  if (z.hp <= 0) {
    killZombie(world, z, dx / d, dy / d);
    return;
  }
  provoke(z, attacker);
}

export function killZombie(world: World, z: Zombie, dirX: number, dirY: number) {
  const i = world.zombies.indexOf(z);
  if (i >= 0) world.zombies.splice(i, 1);
  z.alive = false;
  world.stats.zombiesKilled++;
  world.sound('zdie', z.x, z.y, 0.8);
  world.addDecal({ x: z.x + dirX * 3, y: z.y + dirY * 3, kind: 'blood', r: world.rng.range(6, 9), rot: world.rng.range(0, 6), seed: world.rng.int(0, 99999) });
  world.createCorpse(z.x, z.y, Math.atan2(dirY, dirX), z.look, 'Corpo de infectado', world.zombieDrops(z), false, true);
}

/** Zumbis dentro do arco de ataque, ordenados por distância. */
function targetsInArc(world: World, ax: number, ay: number, facing: number, reach: number, arc: number): Zombie[] {
  const out: { z: Zombie; d: number }[] = [];
  for (const z of world.zombies) {
    const dx = z.x - ax;
    const dy = z.y - ay;
    const d = Math.hypot(dx, dy);
    if (d > reach + z.radius) continue;
    if (d > 4 && Math.abs(angleDiff(facing, Math.atan2(dy, dx))) > arc / 2) continue;
    if (!world.map.los(ax, ay, z.x, z.y)) continue;
    out.push({ z, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out.map((o) => o.z);
}

/** Golpe corpo a corpo (punhos ou arma). Retorna o número de acertos. */
export function meleeSwing(world: World, attacker: Actor, w: WeaponStats, facing: number, dmgMul = 1): number {
  const reach = attacker.radius + w.range;
  const targets = targetsInArc(world, attacker.x, attacker.y, facing, reach, w.arc).slice(0, w.maxTargets);
  let hits = 0;
  for (const z of targets) {
    // ataque furtivo: zumbi que não percebeu o atacante sofre dano dobrado
    const unaware = z.targetId !== attacker.id && (z.state === 'vagar' || z.state === 'investigar' || z.state === 'retornar');
    let dmg = w.damage * dmgMul * world.rng.range(0.85, 1.15);
    if (unaware) dmg *= 2;
    if (z.knockedDown > 0 || z.crawler) dmg *= 1.3;
    damageZombie(world, z, dmg, attacker.x, attacker.y, w.knockback, w.knockdown, attacker);
    hits++;
  }
  world.sound(hits ? (w.kind === 'unarmed' ? 'punch' : 'hit') : 'swing', attacker.x, attacker.y, 0.8);
  world.makeNoise(attacker.x, attacker.y, hits ? w.noise : Math.ceil(w.noise / 2), hits ? 'golpe' : 'golpe_ar', attacker instanceof Player, attacker.id);
  return hits;
}

/** Disparo de arma de fogo (hitscan com dispersão). */
export function fireGun(world: World, shooter: Actor, w: WeaponStats, aimAngle: number, spread: number) {
  const a = aimAngle + world.rng.range(-spread / 2, spread / 2);
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const map = world.map;
  const sx = shooter.x;
  const sy = shooter.y;
  let brokeWindow: { x: number; y: number } | null = null;
  const wallDist = map.cast(sx, sy, dx, dy, w.range, (tx, ty) => {
    if (!map.inb(tx, ty)) return true;
    const t = map.get(tx, ty);
    if (t === T.WINDOW) {
      brokeWindow = { x: tx, y: ty };
      return true;
    }
    if (map.opaque(tx, ty)) return true;
    const i = map.idx(tx, ty);
    // objetos altos param a bala (carros, móveis); cercas e entulho não
    if (map.block[i] && t !== T.FENCE_METAL) return true;
    return false;
  });
  // alvo mais próximo atravessado pelo raio
  let best: Zombie | null = null;
  let bestT = wallDist;
  for (const z of world.zombies) {
    const ox = z.x - sx;
    const oy = z.y - sy;
    const t = ox * dx + oy * dy;
    if (t < 0 || t > bestT) continue;
    const px = ox - dx * t;
    const py = oy - dy * t;
    const r = z.radius + 1;
    if (px * px + py * py <= r * r) {
      best = z;
      bestT = t;
    }
  }
  const ex = sx + dx * bestT;
  const ey = sy + dy * bestT;
  world.tracers.push({ x1: sx + dx * 7, y1: sy + dy * 7, x2: ex, y2: ey, t: 0.07 });
  world.sound('gunshot', sx, sy, 1);
  world.events.emit('shot', { x: sx, y: sy });
  world.stats.shotsFired++;
  // casca do cartucho
  world.addDecal({ x: sx + world.rng.range(-6, 6), y: sy + world.rng.range(-6, 6), kind: 'casing', r: 1, rot: world.rng.range(0, 6), seed: 1 });
  world.makeNoise(sx, sy, w.noise, 'disparo', shooter instanceof Player, shooter.id);
  if (best) {
    damageZombie(world, best, w.damage * world.rng.range(0.85, 1.2), sx, sy, w.knockback, w.knockdown, shooter);
  } else {
    world.burst(ex, ey, 'spark', 4, '#d8c79a', 50);
    world.burst(ex, ey, 'dust', 4, '#8a857a', 25);
    const bw = brokeWindow as { x: number; y: number } | null;
    if (bw && bestT >= wallDist - 0.01) breakWindow(world, bw.x, bw.y, shooter instanceof Player);
  }
}

export function breakWindow(world: World, tx: number, ty: number, byPlayer: boolean) {
  const map = world.map;
  if (map.get(tx, ty) !== T.WINDOW) return;
  map.set(tx, ty, T.WINDOW_BROKEN);
  const cx = tx * TILE + TILE / 2;
  const cy = ty * TILE + TILE / 2;
  world.burst(cx, cy, 'glass', 14, '#a9bcc4', 55);
  world.addDecal({ x: cx, y: cy, kind: 'glass', r: 8, rot: world.rng.range(0, 6), seed: world.rng.int(0, 9999) });
  world.sound('glass', cx, cy, 1);
  world.makeNoise(cx, cy, CONFIG.noise.windowBreak, 'janela', byPlayer, null);
}

/** Golpe de um zumbi em um humano. Diferencia ferimentos comuns de mordidas infectantes. */
export function zombieStrike(world: World, z: Zombie, target: Actor) {
  const rng = world.rng;
  z.attackAnim = 0.3;
  if (target instanceof Player) {
    const p = target;
    if (p.dead) return;
    // dentro do veículo: os golpes acertam a lataria, não o motorista
    const v = world.vehicleById(p.vehicleId);
    if (v) {
      v.hp = Math.max(0, v.hp - 1.2);
      world.sound('door_bash', v.x, v.y, 0.7);
      if (rng.chance(0.15)) world.msg('Os infectados batem na lataria!', 'warn');
      return;
    }
    let hitChance = z.stats.hitChance;
    const sp = Math.hypot(p.vx, p.vy);
    if (!p.isDown && sp > 40) {
      const dx = p.x - z.x;
      const dy = p.y - z.y;
      const d = Math.hypot(dx, dy) || 1;
      const away = (p.vx * dx + p.vy * dy) / (d * sp);
      if (away > 0.4) hitChance *= 0.5;
    }
    if (p.isDown) hitChance = 0.95;
    if (!rng.chance(hitChance)) {
      world.sound('swing', z.x, z.y, 0.6);
      return;
    }
    const armor = p.armor;
    let bite = z.stats.biteChance * (p.isDown ? 4 : 1) * (1 - armor.biteProtect);
    bite = clamp(bite, 0, 0.75);
    const r = rng.next();
    let type: WoundType;
    if (r < bite) type = 'mordida';
    else if (r < bite + 0.32 * (1 - armor.armor)) type = 'laceracao';
    else type = 'arranhao';

    // proteção pode absorver arranhões
    if (type === 'arranhao' && rng.chance(armor.armor * 1.6)) {
      p.health.damage(2);
      p.hurtFlash = 0.12;
      world.msg('Sua roupa absorveu o arranhão.', 'info');
      world.events.emit('playerHurt', { amount: 2, kind: 'golpe' });
      return;
    }
    const base = type === 'mordida' ? rng.range(14, 19) : type === 'laceracao' ? rng.range(11, 15) : rng.range(6, 9);
    const dmg = base * (1 - armor.armor * 0.5);
    p.health.damage(dmg);
    const wound = p.health.addWound(type, rng.next());
    if (type === 'arranhao' && rng.chance(0.45)) wound.bleed = 0;
    p.hurtFlash = 0.2;
    p.stagger = Math.max(p.stagger, 0.3);
    const dx = p.x - z.x;
    const dy = p.y - z.y;
    const d = Math.hypot(dx, dy) || 1;
    p.push(dx / d, dy / d, 40);
    world.bloodSpray(p.x, p.y, dx / d, dy / d, type === 'mordida' ? 9 : 5);
    world.addDecal({ x: p.x, y: p.y, kind: 'blood', r: rng.range(2, 4), rot: rng.range(0, 6), seed: rng.int(0, 9999) });
    world.sound(type === 'mordida' ? 'bite' : 'hurt', p.x, p.y, 1);
    world.events.emit('playerHurt', { amount: dmg, kind: type });
    if (p.action) cancelAction(world, p);
    if (p.health.infected) world.msg('Você foi mordido. O vírus foi transmitido — não há cura.', 'danger');
    else if (type === 'mordida') world.msg('Uma mordida rasgou a pele, mas o vírus não foi transmitido. Trate o ferimento.', 'danger');
    else if (type === 'laceracao') world.msg(`${WOUND_LABEL[type]}! Você está sangrando.`, 'danger');
    else world.msg(wound.bleed > 0 ? 'Um infectado te arranhou. Está sangrando.' : 'Um infectado te arranhou de raspão.', 'warn');
    return;
  }
  if (target instanceof Ally) {
    const a = target;
    if (!rng.chance(0.65)) {
      world.sound('swing', z.x, z.y, 0.6);
      return;
    }
    const dmg = rng.range(7, 15);
    a.hp -= dmg;
    a.hurtFlash = 0.2;
    a.stagger = 0.25;
    const dx = a.x - z.x;
    const dy = a.y - z.y;
    const d = Math.hypot(dx, dy) || 1;
    a.push(dx / d, dy / d, 35);
    world.bloodSpray(a.x, a.y, dx / d, dy / d, 5);
    world.sound('hurt', a.x, a.y, 0.8);
    if (a.hp <= 0) killAlly(world, a);
  }
}

export function killAlly(world: World, a: Ally) {
  a.hp = 0;
  a.state = 'morto';
  a.alive = false;
  world.addDecal({ x: a.x, y: a.y, kind: 'blood', r: 8, rot: 0, seed: 7 });
  world.createCorpse(a.x, a.y, a.facing, a.look, `Corpo de ${a.name}`, a.inv.items.splice(0), false, false);
  world.msg(`${a.name} foi morto.`, 'danger');
}

export function cancelAction(world: World, p: Player) {
  if (!p.action) return;
  p.action.onCancel?.();
  world.msg(`${p.action.label} interrompido.`, 'warn');
  p.action = null;
}

/** Nome da arma equipada para a interface. */
export function weaponName(p: Player): string {
  const it = p.weaponItem;
  return it ? itemDef(it.defId).name : 'Punhos';
}
