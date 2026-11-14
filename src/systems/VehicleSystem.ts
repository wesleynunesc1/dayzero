import { CONFIG, TILE } from '../config';
import { clamp, dist } from '../engine/math';
import { Vehicle } from '../entities/Vehicle';
import type { World } from '../world/World';
import { damageZombie } from './Combat';

/**
 * Física simples de veículo: aceleração, frenagem, ré, direção dependente da velocidade,
 * consumo de combustível, ruído do motor e colisões (3 círculos ao longo do eixo).
 * O veículo nunca atravessa paredes, árvores, cercas ou carros abandonados.
 */

function blocked(world: World, v: Vehicle, x: number, y: number, a: number): boolean {
  const r = v.radius;
  const map = world.map;
  for (const c of v.circles(x, y, a)) {
    const x0 = Math.floor((c.x - r) / TILE);
    const x1 = Math.floor((c.x + r) / TILE);
    const y0 = Math.floor((c.y - r) / TILE);
    const y1 = Math.floor((c.y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        if (!map.solid(tx, ty)) continue;
        const cx = Math.max(tx * TILE, Math.min(c.x, tx * TILE + TILE));
        const cy = Math.max(ty * TILE, Math.min(c.y, ty * TILE + TILE));
        if ((c.x - cx) ** 2 + (c.y - cy) ** 2 < r * r) return true;
      }
  }
  for (const o of world.vehicles) {
    if (o === v) continue;
    for (const a1 of v.circles(x, y, a)) for (const b1 of o.circles()) if (dist(a1.x, a1.y, b1.x, b1.y) < r + o.radius) return true;
  }
  return false;
}

export interface DriveInput {
  /** -1 (ré/freio) … 1 (acelerar). */
  throttle: number;
  /** -1 esquerda … 1 direita. */
  steer: number;
}

export function updateVehicle(world: World, v: Vehicle, input: DriveInput | null, dt: number) {
  const d = v.def;
  const V = CONFIG.vehicle;
  if (v.hitCd > 0) v.hitCd -= dt;
  const throttle = input ? clamp(input.throttle, -1, 1) : 0;
  const steer = input ? clamp(input.steer, -1, 1) : 0;
  v.throttle = throttle;
  v.steer = steer;

  // partida: só com combustível e motor em condições
  if (input && !v.engineOn && throttle !== 0) {
    if (v.fuel <= 0) {
      if (v.noiseT <= 0) {
        world.msg('O motor não pega: tanque vazio.', 'warn');
        world.sound('empty', v.x, v.y, 0.6);
        v.noiseT = 2;
      }
    } else if (!v.functional) {
      if (v.noiseT <= 0) {
        world.msg('O motor está danificado demais para funcionar.', 'warn');
        v.noiseT = 2;
      }
    } else {
      v.engineOn = true;
      world.msg('O motor pegou. O barulho vai atrair infectados.', 'warn');
      world.sound('engine_start', v.x, v.y, 1);
      world.makeNoise(v.x, v.y, V.noiseThrottle, 'motor', true, v.occupant);
    }
  }
  if (v.noiseT > 0) v.noiseT -= dt;

  // consumo de combustível
  if (v.engineOn) {
    v.fuel -= (V.fuelIdlePerSec + V.fuelThrottlePerSec * Math.abs(throttle)) * dt;
    if (v.fuel <= 0) {
      v.fuel = 0;
      v.engineOn = false;
      world.msg('O motor morreu: a gasolina acabou.', 'danger');
      world.sound('engine_stop', v.x, v.y, 1);
    }
  }

  // aceleração / freio / ré / arrasto
  const on = v.engineOn;
  if (on && throttle > 0) {
    v.speed += (v.speed < 0 ? d.brake : d.accel) * throttle * dt;
  } else if (on && throttle < 0) {
    if (v.speed > 2) v.speed -= d.brake * -throttle * dt;
    else v.speed -= d.accel * 0.6 * -throttle * dt;
  } else if (!on && throttle < 0 && v.speed > 0) {
    v.speed = Math.max(0, v.speed - d.brake * dt); // freio funciona mesmo com motor desligado
  }
  const drag = on ? 18 : 30;
  if (throttle === 0 || !on) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), drag * dt);
  v.speed = clamp(v.speed, -d.reverseSpeed, d.maxSpeed * (v.functional ? 1 : 0.4));

  // direção (só gira em movimento)
  const turn = steer * d.turnRate * clamp(v.speed / 50, -1, 1) * dt;
  const na = v.angle + turn;
  const nx = v.x + Math.cos(na) * v.speed * dt;
  const ny = v.y + Math.sin(na) * v.speed * dt;
  if (!blocked(world, v, nx, ny, na)) {
    v.x = nx;
    v.y = ny;
    v.angle = na;
  } else if (!blocked(world, v, v.x, v.y, na)) {
    v.angle = na;
    impact(world, v);
  } else impact(world, v);

  // atropelamento / empurrão de pessoas e infectados
  const r = v.radius;
  for (const z of world.zombies.slice()) {
    if (Math.abs(z.x - v.x) > 40 || Math.abs(z.y - v.y) > 40) continue;
    for (const c of v.circles()) {
      const dd = dist(c.x, c.y, z.x, z.y);
      if (dd >= r + z.radius) continue;
      const nxv = (z.x - c.x) / (dd || 1);
      const nyv = (z.y - c.y) / (dd || 1);
      const sp = Math.abs(v.speed);
      if (sp > 28 && v.hitCd <= 0) {
        damageZombie(world, z, sp * 0.65, c.x, c.y, sp * 1.2, 0.9, null);
        v.speed *= 0.82;
        v.hp = Math.max(0, v.hp - 1.5);
        v.hitCd = 0.15;
      }
      z.x = c.x + nxv * (r + z.radius);
      z.y = c.y + nyv * (r + z.radius);
      world.map.resolveCircle(z, z.radius);
      break;
    }
  }

  // ruído do motor (aumenta com a aceleração)
  if (v.engineOn) {
    v.noiseT -= dt;
    if (v.noiseT <= 0) {
      v.noiseT = 0.6;
      const rad = V.noiseIdle + (V.noiseThrottle - V.noiseIdle) * Math.max(Math.abs(throttle), Math.min(1, Math.abs(v.speed) / d.maxSpeed));
      world.makeNoise(v.x, v.y, rad, 'motor', true, v.occupant);
    }
  }
}

function impact(world: World, v: Vehicle) {
  const sp = Math.abs(v.speed);
  if (sp > 35) {
    const dmg = (sp - 30) * 0.12;
    v.hp = Math.max(0, v.hp - dmg);
    world.sound('door_bash', v.x, v.y, Math.min(1, sp / 100));
    world.makeNoise(v.x, v.y, 10, 'batida', true, v.occupant);
    if (sp > 70) world.msg(`Batida! Estado do veículo: ${Math.round(v.hp)}%.`, 'warn');
    if (v.hp <= 0) {
      v.engineOn = false;
      world.msg('O motor apagou com a batida. O veículo não funciona mais.', 'danger');
    }
  }
  v.speed = -v.speed * 0.25;
}

/** Posição livre para sair do veículo (lado do motorista, depois o outro lado, frente e trás). */
export function exitSpot(world: World, v: Vehicle, radius: number): { x: number; y: number } | null {
  const c = Math.cos(v.angle);
  const s = Math.sin(v.angle);
  const side = v.def.width / 2 + radius + 3;
  const ahead = v.def.length / 2 + radius + 3;
  const cands = [
    { x: v.x + s * side, y: v.y - c * side },
    { x: v.x - s * side, y: v.y + c * side },
    { x: v.x + c * ahead, y: v.y + s * ahead },
    { x: v.x - c * ahead, y: v.y - s * ahead },
  ];
  const map = world.map;
  for (const p of cands) {
    if (map.solidPx(p.x - radius, p.y - radius) || map.solidPx(p.x + radius, p.y - radius) || map.solidPx(p.x - radius, p.y + radius) || map.solidPx(p.x + radius, p.y + radius)) continue;
    return p;
  }
  return null;
}

/** Empurra pessoas para fora da carroceria (o veículo é um obstáculo para todos). */
export function vehicleObstacles(world: World) {
  for (const v of world.vehicles) {
    const actors = [world.player, ...world.allies, ...world.zombies];
    for (const a of actors) {
      if (!a.alive || (a === world.player && world.player.vehicleId === v.id)) continue;
      if (Math.abs(a.x - v.x) > 45 || Math.abs(a.y - v.y) > 45) continue;
      for (const c of v.circles()) {
        const dd = dist(c.x, c.y, a.x, a.y);
        const min = v.radius + a.radius;
        if (dd < min) {
          const nx = (a.x - c.x) / (dd || 1);
          const ny = (a.y - c.y) / (dd || 1);
          a.x = c.x + nx * min;
          a.y = c.y + ny * min;
        }
      }
      world.map.resolveCircle(a, a.radius);
    }
  }
}
