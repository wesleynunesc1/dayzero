import { CONFIG, TILE } from '../config';
import { dist } from '../engine/math';
import type { Zombie } from '../entities/Zombie';
import type { World } from '../world/World';

/**
 * Simulação em larga escala:
 * - CARREGAMENTO POR REGIÕES: o mundo é dividido em células de 32×32 tiles. Só as células
 *   próximas de algum sobrevivente ficam ativas (IA completa, física, colisões). Fora delas,
 *   os zumbis ficam dormentes e só as hordas se deslocam em modo macro (barato).
 * - HORDAS: cada horda tem um centro que migra entre cidades e é atraído por barulhos fortes
 *   (disparos, motores). Ninguém é criado perto do jogador: as hordas já existem e se movem.
 */
export const CELL = 32;

export interface HordeState {
  id: number;
  x: number;
  y: number;
  destX: number;
  destY: number;
  destName: string;
  /** Horas de jogo até escolher novo destino. */
  restHours: number;
}

export class WorldSim {
  activeCells = new Set<number>();
  hordes = new Map<number, HordeState>();
  private cellT = 0;
  private macroT = 0;
  /** Barulhos fortes recentes (atraem hordas próximas). */
  attractions: { x: number; y: number; t: number; strength: number }[] = [];
  stats = { active: 0, dormant: 0 };

  constructor(private world: World) {
    world.hordeSim = this.hordes;
    for (const z of world.zombies) {
      if (z.horde < 0 || this.hordes.has(z.horde)) continue;
      this.hordes.set(z.horde, { id: z.horde, x: z.x, y: z.y, destX: z.x, destY: z.y, destName: 'local', restHours: 2 + (z.horde % 3) * 2 });
    }
  }

  cellOf(x: number, y: number) {
    return Math.floor(y / TILE / CELL) * 1000 + Math.floor(x / TILE / CELL);
  }

  isActive(x: number, y: number) {
    return this.activeCells.has(this.cellOf(x, y));
  }

  /** Recalcula as células ativas ao redor de todos os sobreviventes (humanos ou IA). */
  refreshCells() {
    const w = this.world;
    this.activeCells.clear();
    const R = CONFIG.world.activeRadiusCells;
    for (const p of w.players) {
      // só sobreviventes controlados por humanos mantêm o mundo "carregado" ao redor
      if (!p.alive || p.controller !== 'humano') continue;
      const cx = Math.floor(p.x / TILE / CELL);
      const cy = Math.floor(p.y / TILE / CELL);
      for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) this.activeCells.add(y * 1000 + x);
    }
  }

  noise(x: number, y: number, radius: number) {
    if (radius < 18) return;
    this.attractions.push({ x, y, t: this.world.time, strength: radius });
    if (this.attractions.length > 20) this.attractions.shift();
  }

  update(dt: number) {
    const w = this.world;
    this.cellT -= dt;
    if (this.cellT <= 0) {
      this.cellT = 0.5;
      this.refreshCells();
    }
    const hours = (dt * CONFIG.time.minutesPerSecond) / 60;
    // hordas: escolhem destinos e migram
    for (const h of this.hordes.values()) {
      h.restHours -= hours;
      // barulho forte recente e próximo tem prioridade
      const att = this.attractions.find((a) => w.time - a.t < 60 && dist(a.x, a.y, h.x, h.y) < a.strength * TILE * 3);
      if (att && (h.destName !== 'barulho' || dist(att.x, att.y, h.destX, h.destY) > 5 * TILE)) {
        h.destX = att.x;
        h.destY = att.y;
        h.destName = 'barulho';
        h.restHours = 3;
      } else if (h.restHours <= 0) {
        const towns = w.towns.filter((t) => t.kind !== 'instalacao');
        const near = towns.sort((a, b) => dist(a.cx, a.cy, h.x / TILE, h.y / TILE) - dist(b.cx, b.cy, h.x / TILE, h.y / TILE)).slice(0, 3);
        const t = near[(h.id + Math.floor(w.time / 600)) % near.length];
        h.destX = t.cx * TILE;
        h.destY = t.cy * TILE;
        h.destName = t.name;
        h.restHours = CONFIG.world.hordeRestHours[0] + ((h.id * 7) % (CONFIG.world.hordeRestHours[1] - CONFIG.world.hordeRestHours[0]));
      }
      const d = dist(h.x, h.y, h.destX, h.destY);
      if (d > 8) {
        const sp = CONFIG.world.hordeSpeed * dt;
        let nx = h.x + ((h.destX - h.x) / d) * sp;
        let ny = h.y + ((h.destY - h.y) / d) * sp;
        if (w.map.solidPx(nx, ny)) {
          // contorna obstáculos de forma simples
          const a = Math.atan2(h.destY - h.y, h.destX - h.x) + (Math.sin(w.time * 0.3 + h.id) > 0 ? 1.2 : -1.2);
          nx = h.x + Math.cos(a) * sp;
          ny = h.y + Math.sin(a) * sp;
        }
        if (!w.map.solidPx(nx, ny)) {
          h.x = nx;
          h.y = ny;
        }
      }
      w.hordes.set(h.id, { x: h.x, y: h.y, t: w.time });
    }
    // zumbis dormentes: deslocamento macro das hordas a cada 2 s
    this.macroT -= dt;
    if (this.macroT <= 0) {
      this.macroT = 2;
      let dormant = 0;
      for (const z of w.zombies) {
        if (this.isActive(z.x, z.y)) continue;
        dormant++;
        if (z.horde < 0) continue;
        const h = this.hordes.get(z.horde);
        if (!h) continue;
        moveToward(w, z, h.x + Math.cos(z.home.x) * 30, h.y + Math.sin(z.home.y) * 30, z.stats.wander * 2 * 2);
      }
      this.stats.dormant = dormant;
      this.stats.active = w.zombies.length - dormant;
    }
  }
}

function moveToward(w: World, z: Zombie, tx: number, ty: number, step: number) {
  const d = dist(z.x, z.y, tx, ty);
  if (d < 2) return;
  const k = Math.min(1, step / d);
  const nx = z.x + (tx - z.x) * k;
  const ny = z.y + (ty - z.y) * k;
  if (!w.map.solidPx(nx, ny)) {
    z.x = nx;
    z.y = ny;
  }
}
