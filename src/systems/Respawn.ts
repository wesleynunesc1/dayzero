import { CONFIG, RespawnMode, TILE } from '../config';
import { createItem } from '../data/items';
import { dist } from '../engine/math';
import { Health } from './Health';
import type { World } from '../world/World';

/**
 * Morte e retorno. Ao morrer, o corpo permanece no local com TODOS os itens.
 * O jogador volta sem armas, em um ponto escolhido pela estratégia configurada.
 */
export function handlePlayerDeath(world: World) {
  const p = world.player;
  if (!p.alive) return;
  p.alive = false;
  p.vx = p.vy = 0;
  p.action = null;
  p.openContainer = null;
  const items = p.inv.items.splice(0);
  p.equipped = { arma: null, corpo: null, costas: null };
  p.refreshCapacity();
  world.createCorpse(p.x, p.y, p.facing, { ...p.look }, `Corpo de ${p.name}`, items, true, false);
  p.captive = null;
  world.msgNear(p.x, p.y, 30 * TILE, `${p.name} morreu.`, 'danger');
  world.addDecal({ x: p.x, y: p.y, kind: 'blood', r: 10, rot: 0, seed: 11 });
  p.deaths++;
  world.events.emit('closeContainer', {});
  world.events.emit('playerDied', { cause: p.health.deathCause || 'Ferimentos' });
}

export interface RespawnPoint {
  x: number;
  y: number;
  name: string;
}

function zombiesWithin(world: World, x: number, y: number, r: number) {
  return world.zombies.some((z) => dist(x, y, z.x, z.y) < r);
}

/** Escolhe o ponto de retorno. Nunca move zumbis — apenas evita pontos ocupados por eles. */
export function chooseRespawn(world: World, mode: RespawnMode = CONFIG.respawnMode): RespawnPoint {
  const p = world.player;
  const known = world.safePoints.filter((s) => s.discovered);
  const clear = (x: number, y: number) => !zombiesWithin(world, x, y, 7 * TILE);
  // ponto inicial do próprio sobrevivente (cada um começa numa região)
  const mine = world.starts.find((s) => s.region === p.region);
  const start = (mine && world.safePoints.find((s) => s.id === mine.safePoint)) || world.safePoints[0];
  const ordered: RespawnPoint[] = [];

  if (mode === 'ultima_localizacao') {
    ordered.push({ x: p.lastSafePos.x, y: p.lastSafePos.y, name: 'Última localização segura' });
  }
  if (mode === 'ultimo_ponto_seguro') {
    const byVisit = known.slice().sort((a, b) => b.lastVisit - a.lastVisit);
    for (const s of byVisit) ordered.push(s);
  }
  if (mode === 'ponto_seguro_proximo' || mode === 'ultima_localizacao' || mode === 'ultimo_ponto_seguro') {
    const byDist = known.slice().sort((a, b) => dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y));
    for (const s of byDist) ordered.push(s);
  }
  ordered.push(start);
  for (const o of ordered) if (clear(o.x, o.y)) return { x: o.x, y: o.y, name: o.name };
  // todos ocupados: o menos perigoso
  return { x: ordered[0].x, y: ordered[0].y, name: ordered[0].name };
}

export function respawnPlayer(world: World): RespawnPoint {
  const p = world.player;
  const pt = chooseRespawn(world);
  p.x = pt.x;
  p.y = pt.y;
  const vaccinated = p.health.vaccinated;
  p.health = new Health();
  p.health.vaccinated = vaccinated;
  p.alive = true;
  p.stamina = CONFIG.player.staminaMax;
  p.hunger = 25;
  p.thirst = 25;
  p.fatigue = 20;
  p.sickHours = 0;
  p.sleep = null;
  p.vehicleId = null;
  p.crouch = false;
  p.running = false;
  p.action = null;
  p.openContainer = null;
  p.kx = p.ky = 0;
  p.vx = p.vy = 0;
  p.hurtFlash = 0;
  p.stagger = 0;
  p.lastSafePos = { x: pt.x, y: pt.y };
  // volta apenas com a roupa do corpo — sem armas e sem os itens antigos
  const shirt = createItem('camiseta');
  p.inv.add(shirt);
  p.equipped.corpo = shirt.uid;
  p.refreshCapacity();
  world.map.resolveCircle(p, p.radius);
  world.events.emit('playerRespawned', { name: pt.name });
  world.msg(`Você acorda em: ${pt.name}. Seus pertences ficaram junto ao seu corpo.`, 'warn');
  return pt;
}
