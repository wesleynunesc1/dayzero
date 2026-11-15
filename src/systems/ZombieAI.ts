import { CONFIG, TILE } from '../config';
import { angleDiff, approachAngle, dist } from '../engine/math';
import { Actor } from '../entities/Actor';
import { Player } from '../entities/Player';
import { Zombie } from '../entities/Zombie';
import { T } from '../world/tiles';
import type { World } from '../world/World';
import { breakWindow, zombieStrike } from './Combat';
import type { NoiseEvent } from './Noise';

/**
 * IA dos infectados — máquina de estados:
 * vagar → investigar barulho → identificar → perseguir → atacar → procurar → retornar.
 * Os zumbis só sabem o que veem (cone de visão + linha de visão) ou ouvem (sistema de ruído).
 * Nenhum zumbi é teleportado; todos se deslocam pelo mapa usando A*.
 */

const AI = CONFIG.ai;
let lastBreakMsg = -999;

/** Custo de caminho. `aggressive`: atrás de alguém/um barulho, aceita forçar janelas e barricadas. */
function zombieCost(world: World, aggressive: boolean) {
  const map = world.map;
  return (x: number, y: number) => {
    const d = map.doorAt(x, y);
    if (d && !d.open && !d.broken) return d.barricades > 0 ? 12 : 6; // pode arrombar
    const t = map.get(x, y);
    if (aggressive && (t === T.WINDOW || t === T.WINDOW_BOARDED)) return t === T.WINDOW ? 9 : 14;
    if (map.solid(x, y)) return Infinity;
    if (t === T.WINDOW_BROKEN) return 2.5;
    return 1;
  };
}

/** Raio efetivo do alvo (quem está num veículo é alcançado pela lataria). */
export function targetRadius(world: World, t: Actor): number {
  if (t instanceof Player && t.vehicleId) {
    const v = world.vehicleById(t.vehicleId);
    if (v) return v.def.width / 2 + 3;
  }
  return t.radius;
}

function requestPath(world: World, z: Zombie, gx: number, gy: number): boolean {
  if (world.pathfinder.searchesThisTick >= AI.maxPathsPerTick) return false;
  const aggressive = z.state === 'perseguir' || z.state === 'procurar' || z.state === 'investigar';
  const path = world.pathfinder.find(
    Math.floor(z.x / TILE),
    Math.floor(z.y / TILE),
    Math.floor(gx / TILE),
    Math.floor(gy / TILE),
    zombieCost(world, aggressive),
    2500,
  );
  z.path = path;
  z.pathIdx = 0;
  z.pathGoal = { x: gx, y: gy };
  return true;
}

function steer(z: Zombie, tx: number, ty: number, speed: number, dt: number) {
  const dx = tx - z.x;
  const dy = ty - z.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.5) {
    z.vx = z.vy = 0;
    return;
  }
  // balanço desajeitado: pequena oscilação lateral
  const wob = z.crawler ? 0 : Math.sin(z.walkPhase * 0.9 + z.home.x) * 0.25;
  const a = Math.atan2(dy, dx) + wob;
  z.vx = Math.cos(a) * speed;
  z.vy = Math.sin(a) * speed;
  z.facing = approachAngle(z.facing, Math.atan2(dy, dx), (z.ztype === 'rapido' ? 9 : 4.5) * dt);
}

/** Segue o caminho. Retorna 'ok' | 'fim' | 'porta' (arrombando). */
function followPath(world: World, z: Zombie, speed: number, dt: number): 'ok' | 'fim' | 'porta' {
  const path = z.path;
  if (!path || z.pathIdx >= path.length) {
    z.vx = z.vy = 0;
    return 'fim';
  }
  let wp = path[z.pathIdx];
  // atalho: se o ponto seguinte está em linha reta livre, pula
  if (z.pathIdx + 1 < path.length && ((z.thinkT * 10) | 0) % 3 === 0) {
    const nx = path[z.pathIdx + 1];
    if (world.map.clearPath(z.x, z.y, nx.x, nx.y, z.radius)) {
      z.pathIdx++;
      wp = nx;
    }
  }
  const tx = Math.floor(wp.x / TILE);
  const ty = Math.floor(wp.y / TILE);
  const door = world.map.doorAt(tx, ty);
  if (door && !door.open && !door.broken) {
    const d = dist(z.x, z.y, wp.x, wp.y);
    if (d < 15) {
      z.vx = z.vy = 0;
      z.facing = approachAngle(z.facing, Math.atan2(wp.y - z.y, wp.x - z.x), 6 * dt);
      bashDoor(world, z, door, dt);
      return 'porta';
    }
  }
  const wt = world.map.get(tx, ty);
  if ((wt === T.WINDOW || wt === T.WINDOW_BOARDED) && dist(z.x, z.y, wp.x, wp.y) < 15) {
    z.vx = z.vy = 0;
    z.facing = approachAngle(z.facing, Math.atan2(wp.y - z.y, wp.x - z.x), 6 * dt);
    bashWindow(world, z, tx, ty, dt);
    return 'porta';
  }
  if (dist(z.x, z.y, wp.x, wp.y) < 3.5) {
    z.pathIdx++;
    if (z.pathIdx >= path.length) return 'fim';
    wp = path[z.pathIdx];
  }
  steer(z, wp.x, wp.y, speed, dt);
  return 'ok';
}

function bashDoor(world: World, z: Zombie, door: import('../world/TileMap').Door, dt: number) {
  z.bashT -= dt;
  if (z.bashT > 0) return;
  z.bashT = z.ztype === 'rapido' ? 0.8 : 1.15;
  z.attackAnim = 0.3;
  const dmg = z.ztype === 'rapido' ? 9 : z.crawler ? 4 : 7;
  door.hp -= dmg;
  const cx = door.x * TILE + TILE / 2;
  const cy = door.y * TILE + TILE / 2;
  world.sound('door_bash', cx, cy, 0.9);
  world.makeNoise(cx, cy, CONFIG.noise.doorBash, 'pancadas', false, z.id);
  if (door.hp <= 0) {
    door.broken = true;
    door.open = true;
    door.barricades = 0;
      world.burst(cx, cy, 'splinter', 14, '#6b5139', 50);
    world.addDecal({ x: cx, y: cy, kind: 'splinters', r: 8, rot: world.rng.range(0, 6), seed: world.rng.int(0, 9999) });
    world.sound('door_break', cx, cy, 1);
    if (world.nearestPlayerDist(cx, cy) < 22 * TILE && world.time - lastBreakMsg > 15) {
      lastBreakMsg = world.time;
      world.msg('Você ouve uma porta sendo arrombada.', 'danger');
    }
  }
}

function bashWindow(world: World, z: Zombie, tx: number, ty: number, dt: number) {
  z.bashT -= dt;
  if (z.bashT > 0) return;
  z.bashT = z.ztype === 'rapido' ? 0.8 : 1.15;
  z.attackAnim = 0.3;
  const map = world.map;
  const idx = map.idx(tx, ty);
  const t = map.get(tx, ty);
  const hp = (world.windowHp.get(idx) ?? (t === T.WINDOW ? 12 : 90)) - (z.ztype === 'rapido' ? 9 : 7);
  const cx = tx * TILE + TILE / 2;
  const cy = ty * TILE + TILE / 2;
  world.sound(t === T.WINDOW ? 'hit' : 'door_bash', cx, cy, 0.8);
  world.makeNoise(cx, cy, CONFIG.noise.doorBash, 'pancadas', false, z.id);
  if (hp > 0) {
    world.windowHp.set(idx, hp);
    return;
  }
  world.windowHp.delete(idx);
  if (t === T.WINDOW) breakWindow(world, tx, ty, false);
  else {
    map.set(tx, ty, T.WINDOW_BROKEN);
    world.boardedFrom.delete(idx);
    world.burst(cx, cy, 'splinter', 12, '#6b5139', 50);
    world.addDecal({ x: cx, y: cy, kind: 'splinters', r: 8, rot: world.rng.range(0, 6), seed: world.rng.int(0, 9999) });
    world.sound('door_break', cx, cy, 1);
    world.msgNear(cx, cy, 22 * TILE, 'Você ouve tábuas sendo arrancadas de uma janela.', 'danger');
  }
}

function randomWalkable(world: World, cx: number, cy: number, radiusTiles: number): { x: number; y: number } | null {
  for (let i = 0; i < 8; i++) {
    const a = world.rng.range(0, Math.PI * 2);
    const r = world.rng.range(1, radiusTiles) * TILE;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (!world.map.solid(tx, ty)) return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
  }
  return null;
}

/** Visão: cone frontal + linha de visão + percepção de proximidade. */
function sense(world: World, z: Zombie, interval: number) {
  let best: Actor | null = null;
  let bestD = Infinity;
  const hunting = z.state === 'perseguir' || z.state === 'atacar' || z.state === 'procurar' || z.state === 'identificar';
  for (const h of world.humans()) {
    const d = dist(z.x, z.y, h.x, h.y);
    // clima (neblina/chuva) e escuridão reduzem a visão; a lanterna denuncia
    const p = h instanceof Player ? h : null;
    const dark = world.nightFactor * (p?.flashlight ? 0 : 0.35);
    let range = AI.visionRange * z.stats.visionMul * world.weather.visionMul * (1 - dark);
    if (p?.crouch) range *= 0.55;
    if (p?.running) range *= 1.15;
    if (p?.isDown) range *= 0.8;
    // ambientes internos são escuros: enxergam menos (a lanterna denuncia)
    const inside = world.map.buildingAtPx(h.x, h.y) >= 0;
    if (inside && !(p && p.flashlight)) range *= 0.7;
    if (d > range && d > AI.proximitySense) continue;
    let seen = false;
    if (d <= AI.proximitySense * (p?.crouch ? 0.7 : 1)) seen = world.map.los(z.x, z.y, h.x, h.y);
    else {
      const fov = hunting ? Math.PI * 1.4 : AI.visionFov;
      const ang = Math.abs(angleDiff(z.facing, Math.atan2(h.y - z.y, h.x - z.x)));
      if (ang <= fov / 2) seen = world.map.los(z.x, z.y, h.x, h.y);
    }
    if (seen && d < bestD) {
      bestD = d;
      best = h;
    }
  }

  if (!best) {
    z.awareness = Math.max(0, z.awareness - 0.35 * interval);
    if (hunting) z.lostT += interval;
    return;
  }
  const target = best;
  z.lostT = 0;

  if (z.state === 'perseguir' || z.state === 'atacar' || z.state === 'identificar') {
    if (z.targetId === target.id || !world.actorById(z.targetId)) {
      if (z.lastKnown) {
        z.lastKnownVel = { x: (target.x - z.lastKnown.x) / Math.max(interval, 0.05), y: (target.y - z.lastKnown.y) / Math.max(interval, 0.05) };
      }
      z.targetId = target.id;
      z.lastKnown = { x: target.x, y: target.y };
    }
    return;
  }

  const range = AI.visionRange * z.stats.visionMul;
  const closeness = 1 + Math.max(0, 1 - bestD / range) * 2;
  const crouchMul = target instanceof Player && target.crouch ? 0.5 : 1;
  z.awareness += z.stats.awareGain * interval * closeness * crouchMul;
  if (bestD <= AI.proximitySense) z.awareness = 1;
  z.facing = approachAngle(z.facing, Math.atan2(target.y - z.y, target.x - z.x), 2 * interval);

  if (z.awareness >= 1) {
    z.targetId = target.id;
    z.lastKnown = { x: target.x, y: target.y };
    z.setState('identificar');
  } else if (z.awareness > 0.35 && (z.state === 'vagar' || z.state === 'retornar')) {
    // algo se moveu ali... vai conferir
    z.setState('investigar');
    z.goal = { x: target.x, y: target.y };
  }
}

/** Reação a ruídos (chamada pelo sistema de propagação). */
export function zombieHear(world: World, z: Zombie, n: NoiseEvent, intensity: number) {
  if (n.sourceId === z.id) return;
  const lostT = z.lostT;
  if (z.state === 'perseguir' || z.state === 'atacar' || z.state === 'identificar') {
    // perdeu de vista? o barulho do alvo atualiza a pista
    if (n.byPlayer && lostT > 0.6) z.lastKnown = { x: n.x, y: n.y };
    return;
  }
  // erro de localização: quanto mais fraco o som, menos preciso
  const err = (1 - intensity) * 3 * TILE;
  const gx = n.x + world.rng.range(-err, err);
  const gy = n.y + world.rng.range(-err, err);
  z.heard = { x: n.x, y: n.y, t: world.time };
  if (z.state === 'procurar' && n.byPlayer) {
    z.lastKnown = { x: gx, y: gy };
    z.setState('perseguir');
    z.lostT = 1; // ouviu, mas não está vendo
    return;
  }
  if (z.state === 'investigar' && z.goal && intensity < 0.3 && dist(z.goal.x, z.goal.y, gx, gy) < 4 * TILE) return;
  z.setState('investigar');
  z.goal = { x: gx, y: gy };
  z.facing = approachAngle(z.facing, Math.atan2(n.y - z.y, n.x - z.x), 1.2);
}

/** Atualiza um zumbi. */
export function updateZombie(world: World, z: Zombie, dt: number) {
  z.tickTimers(dt);
  if (z.attackCd > 0) z.attackCd -= dt;
  z.stateT += dt;
  z.thinkT += dt;
  const dP = world.nearestPlayerDist(z.x, z.y);
  const lod = dP > AI.lodFar ? 2 : dP > AI.lodNear ? 1 : 0;

  if (z.knockedDown > 0) {
    z.vx = z.vy = 0;
    return;
  }

  // gemidos (somente áudio)
  z.groanT -= dt;
  if (z.groanT <= 0) {
    z.groanT = world.rng.range(5, 12);
    if (dP < 16 * TILE) world.sound('groan', z.x, z.y, 0.5);
  }

  // sentidos (com nível de detalhe por distância)
  z.senseT -= dt;
  if (z.senseT <= 0) {
    const interval = lod === 0 ? 0.15 : lod === 1 ? 0.5 : 1.5;
    z.senseT = interval;
    if (lod < 2) sense(world, z, interval);
  }

  const S = z.stats;
  const slow = z.stagger > 0 ? 0.25 : 1;
  const lostT = z.lostT;

  switch (z.state) {
    case 'vagar': {
      if (z.waitT > 0) {
        z.waitT -= dt;
        z.vx = z.vy = 0;
        z.facing += Math.sin(world.time * 0.7 + z.home.y) * 0.3 * dt;
        break;
      }
      if (!z.goal) {
        let base = z.home;
        if (z.horde >= 0) {
          let h = world.hordes.get(z.horde);
          if (!h || world.time - h.t > 14) {
            const c = h ?? { x: z.home.x, y: z.home.y };
            const n = randomWalkable(world, c.x, c.y, 6);
            h = { x: n?.x ?? c.x, y: n?.y ?? c.y, t: world.time };
            world.hordes.set(z.horde, h);
          }
          base = h;
        }
        z.goal = randomWalkable(world, base.x, base.y, z.horde >= 0 ? 3 : 5);
        z.path = null;
        if (!z.goal) {
          z.waitT = 2;
          break;
        }
      }
      if (lod === 2) {
        steer(z, z.goal.x, z.goal.y, S.wander * 0.8, dt);
        if (dist(z.x, z.y, z.goal.x, z.goal.y) < 6 || z.stateT > 20) {
          z.goal = null;
          z.waitT = world.rng.range(2, 6);
          z.stateT = 0;
        }
        break;
      }
      if (!z.path && !requestPath(world, z, z.goal.x, z.goal.y)) break;
      const r = followPath(world, z, S.wander * slow, dt);
      if (r === 'fim' || z.stateT > 25) {
        z.goal = null;
        z.path = null;
        z.waitT = world.rng.range(1.5, 5);
        z.stateT = 0;
      }
      break;
    }

    case 'investigar': {
      if (!z.goal) {
        z.setState('retornar');
        break;
      }
      if (!z.path || (z.pathGoal && dist(z.pathGoal.x, z.pathGoal.y, z.goal.x, z.goal.y) > TILE * 1.5)) {
        if (!requestPath(world, z, z.goal.x, z.goal.y)) break;
      }
      const r = followPath(world, z, S.investigate * slow, dt);
      if (r === 'fim') {
        // chegou: olha em volta por alguns segundos
        z.vx = z.vy = 0;
        z.waitT += dt;
        z.facing += dt * 1.8;
        if (z.waitT > 3.5) {
          z.waitT = 0;
          z.setState('retornar');
        }
      }
      if (z.stateT > 30) z.setState('retornar');
      break;
    }

    case 'identificar': {
      z.vx = z.vy = 0;
      const t = world.actorById(z.targetId);
      if (t) z.facing = approachAngle(z.facing, Math.atan2(t.y - z.y, t.x - z.x), 8 * dt);
      if (z.stateT >= S.identify) {
        world.sound('alert', z.x, z.y, 0.8);
        // o grunhido alerta zumbis próximos (perseguição coletiva)
        world.makeNoise(z.x, z.y, CONFIG.noise.zombieAlert, 'alerta', false, z.id);
        z.setState('perseguir');
      }
      break;
    }

    case 'perseguir': {
      const t = world.actorById(z.targetId);
      if (!t) {
        z.targetId = null;
        z.setState(z.lastKnown ? 'procurar' : 'retornar');
        break;
      }
      const d = dist(z.x, z.y, t.x, t.y);
      if (d <= z.radius + targetRadius(world, t) + S.reach && lostT < 0.5) {
        z.setState('atacar');
        break;
      }
      const visible = lostT < 0.35;
      if (visible && world.map.clearPath(z.x, z.y, t.x, t.y, z.radius * 0.8)) {
        z.path = null;
        steer(z, t.x, t.y, S.chase * slow, dt);
      } else if (z.lastKnown) {
        const lk = z.lastKnown;
        if (!z.path || (z.pathGoal && dist(z.pathGoal.x, z.pathGoal.y, lk.x, lk.y) > TILE) || z.repathT <= 0) {
          if (requestPath(world, z, lk.x, lk.y)) z.repathT = 1.2;
        }
        z.repathT -= dt;
        const r = followPath(world, z, S.chase * slow, dt);
        if (r === 'fim' && !visible) {
          z.setState('procurar');
          z.searchT = world.rng.range(10, 16);
          // extrapola para onde o alvo provavelmente foi
          const v = z.lastKnownVel;
          const sp = Math.hypot(v.x, v.y);
          const k = sp > 1 ? Math.min(3 * TILE, sp * 1.5) / sp : 0;
          z.goal = { x: lk.x + v.x * k, y: lk.y + v.y * k };
        }
      } else z.setState('procurar');
      break;
    }

    case 'atacar': {
      const t = world.actorById(z.targetId);
      if (!t) {
        z.setState('procurar');
        break;
      }
      const d = dist(z.x, z.y, t.x, t.y);
      z.facing = approachAngle(z.facing, Math.atan2(t.y - z.y, t.x - z.x), 10 * dt);
      const tr = targetRadius(world, t);
      if (d > z.radius + tr + S.reach + 5) {
        z.setState('perseguir');
        break;
      }
      // mantém contato
      if (d > z.radius + tr) steer(z, t.x, t.y, S.chase * 0.5 * slow, dt);
      else z.vx = z.vy = 0;
      if (z.attackCd <= 0 && z.stagger <= 0) {
        z.attackWind += dt;
        if (z.attackWind >= S.windup) {
          z.attackWind = 0;
          z.attackCd = S.attackCd * world.rng.range(0.85, 1.15);
          if (d <= z.radius + tr + S.reach + 3) zombieStrike(world, z, t);
          else world.sound('swing', z.x, z.y, 0.5);
        }
      }
      break;
    }

    case 'procurar': {
      z.searchT -= dt;
      if (z.searchT <= 0) {
        z.setState('retornar');
        break;
      }
      if (!z.goal) {
        const c = z.lastKnown ?? { x: z.x, y: z.y };
        z.goal = randomWalkable(world, c.x, c.y, 4);
        z.path = null;
        if (!z.goal) break;
      }
      if (!z.path && !requestPath(world, z, z.goal.x, z.goal.y)) break;
      const r = followPath(world, z, S.investigate * slow, dt);
      if (r === 'fim') {
        z.vx = z.vy = 0;
        z.facing += dt * 2.2;
        z.waitT += dt;
        if (z.waitT > 1.6) {
          z.waitT = 0;
          z.goal = null;
          z.path = null;
        }
      }
      break;
    }

    case 'retornar': {
      if (!z.goal) {
        const base = z.horde >= 0 ? world.hordes.get(z.horde) ?? z.home : z.home;
        z.goal = randomWalkable(world, base.x, base.y, 3) ?? { x: base.x, y: base.y };
        z.path = null;
      }
      if (!z.path && !requestPath(world, z, z.goal.x, z.goal.y)) break;
      const r = followPath(world, z, S.wander * 1.2 * slow, dt);
      if (r === 'fim' || z.stateT > 45) {
        z.setState('vagar');
        z.waitT = world.rng.range(1, 4);
      }
      break;
    }
  }

  // detecção de travamento: tenta outro caminho / pequeno desvio
  if (z.thinkT > 1) {
    z.thinkT = 0;
    const moved = dist(z.x, z.y, z.lastX, z.lastY);
    const intends = Math.hypot(z.vx, z.vy) > 2;
    if (intends && moved < 2) {
      z.stuckT++;
      if (z.stuckT >= 2) {
        z.path = null;
        z.push(world.rng.range(-1, 1), world.rng.range(-1, 1), 25);
        z.stuckT = 0;
        if (z.state === 'vagar') z.goal = null;
      }
    } else z.stuckT = 0;
    z.lastX = z.x;
    z.lastY = z.y;
  }
}
