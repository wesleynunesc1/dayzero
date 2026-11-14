import { Actor } from '../entities/Actor';
import { Player } from '../entities/Player';
import { Zombie } from '../entities/Zombie';
import { World } from '../world/World';

const tmp: Actor[] = [];

/** Integra velocidade + empurrões com colisão contra tiles (com sub-passos para evitar atravessar paredes). */
export function integrate(world: World, a: Actor, dt: number) {
  const slow = world.tileSlow(a.x, a.y);
  let dx = (a.vx * slow + a.kx) * dt;
  let dy = (a.vy * slow + a.ky) * dt;
  const decay = Math.exp(-dt * 9);
  a.kx *= decay;
  a.ky *= decay;
  if (Math.abs(a.kx) < 0.5) a.kx = 0;
  if (Math.abs(a.ky) < 0.5) a.ky = 0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / (a.radius * 0.7)));
  const x0 = a.x;
  const y0 = a.y;
  const ix = dx;
  const iy = dy;
  dx /= steps;
  dy /= steps;
  for (let i = 0; i < steps; i++) {
    a.x += dx;
    a.y += dy;
    world.map.resolveCircle(a, a.radius);
  }
  // travou numa quina? desliza para a abertura (portas, vãos entre móveis)
  if (len > 0.05 && Math.hypot(a.x - x0, a.y - y0) < len * 0.5) cornerAssist(world, a, ix, iy);
  const sp = Math.hypot(a.vx, a.vy);
  a.moving = sp > 2;
  if (a.moving) a.walkPhase += sp * dt * 0.22;
}

/**
 * Assistência de quina: se o movimento está bloqueado mas existe uma passagem
 * a poucos pixels para o lado, empurra o personagem suavemente para ela.
 */
function cornerAssist(world: World, a: Actor, ix: number, iy: number) {
  const map = world.map;
  const r = a.radius;
  const free = (x: number, y: number) =>
    !map.solidPx(x - r, y - r) && !map.solidPx(x + r, y - r) && !map.solidPx(x - r, y + r) && !map.solidPx(x + r, y + r);
  const ax = Math.abs(ix);
  const ay = Math.abs(iy);
  const step = Math.max(ax, ay) * 0.9 + 0.2;
  if (ax > ay * 2) {
    const fx = a.x + Math.sign(ix) * 2;
    if (free(fx, a.y)) return;
    for (let k = 1; k <= 8; k++)
      for (const sgn of [1, -1])
        if (free(fx, a.y + sgn * k) && free(a.x, a.y + sgn * k)) {
          a.y += sgn * Math.min(k, step);
          map.resolveCircle(a, r);
          return;
        }
  } else if (ay > ax * 2) {
    const fy = a.y + Math.sign(iy) * 2;
    if (free(a.x, fy)) return;
    for (let k = 1; k <= 8; k++)
      for (const sgn of [1, -1])
        if (free(a.x + sgn * k, fy) && free(a.x + sgn * k, a.y)) {
          a.x += sgn * Math.min(k, step);
          map.resolveCircle(a, r);
          return;
        }
  }
}

/** Separação entre personagens (ninguém atravessa ninguém). */
export function separate(world: World) {
  const all: Actor[] = [];
  if (!world.player.dead && !world.player.vehicleId) all.push(world.player);
  for (const a of world.allies) if (a.state !== 'morto') all.push(a);
  for (const z of world.zombies) all.push(z);
  world.hash.clear();
  for (const a of all) world.hash.insert(a);
  for (const a of all) {
    world.hash.query(a.x, a.y, 16, tmp);
    for (const b of tmp) {
      if (b === a || b.id < a.id) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const r = a.radius + b.radius - 1;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const over = r - d;
      // jogador e aliado são "mais pesados" que zumbis; zumbis caídos são empurrados facilmente
      const wa = weight(a);
      const wb = weight(b);
      const ta = wb / (wa + wb);
      const tb = wa / (wa + wb);
      a.x -= (dx / d) * over * ta;
      a.y -= (dy / d) * over * ta;
      b.x += (dx / d) * over * tb;
      b.y += (dy / d) * over * tb;
    }
  }
  for (const a of all) world.map.resolveCircle(a, a.radius);
}

function weight(a: Actor): number {
  if (a instanceof Player) return a.isDown ? 3 : 2;
  if (a instanceof Zombie) return a.knockedDown > 0 || a.crawler ? 0.6 : 1;
  return 2;
}
