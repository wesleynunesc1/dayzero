import { CONFIG, TILE } from '../config';
import { dist } from '../engine/math';
import { WEATHER_LABEL } from './Weather';
import { updateVehicle, vehicleObstacles } from './VehicleSystem';
import { endSleep } from './Interaction';
import { Actor } from '../entities/Actor';
import { Ally } from '../entities/Ally';
import { Zombie } from '../entities/Zombie';
import type { PlayerCommand, World } from '../world/World';
import { allyHear, updateAlly } from './AllyAI';
import { NoiseSystem } from './Noise';
import { integrate, separate } from './Physics';
import { driveInput, updatePlayer } from './PlayerController';
import { updateZombie, zombieHear } from './ZombieAI';

/** Orquestra a simulação em passo fixo. */
export class Simulation {
  readonly noise: NoiseSystem;
  /** Tempo médio gasto por passo (ms) — monitoramento de desempenho. */
  stepMs = 0;

  constructor(readonly world: World) {
    this.noise = new NoiseSystem(world);
    world.noiseHook = (n) => {
      const listeners: Actor[] = [...world.zombies];
      for (const a of world.allies) if (a.state !== 'morto') listeners.push(a);
      this.noise.emit(
        n,
        listeners,
        (l) => (l instanceof Zombie ? l.stats.hearingMul : 1),
        (l, i) => {
          if (l instanceof Zombie) zombieHear(world, l, n, i);
          else if (l instanceof Ally) allyHear(world, l, n, i);
        },
      );
      // barulho alheio por perto acorda quem está dormindo
      const p = world.player;
      if (p.sleep && !n.byPlayer && dist(n.x, n.y, p.x, p.y) < n.radius * TILE * 0.8 && n.radius >= 6) {
        endSleep(world, n.kind === 'pancadas' ? 'Você acordou com pancadas na porta!' : 'Um barulho te acordou.');
      }
    };
  }

  step(dt: number, cmd: PlayerCommand) {
    const t0 = performance.now();
    const w = this.world;
    w.time += dt;
    w.pathfinder.searchesThisTick = 0;

    const hours = (dt * CONFIG.time.minutesPerSecond) / 60;
    const changed = w.weather.update(dt, hours);
    if (changed) {
      w.events.emit('weatherChanged', { kind: changed });
      if (!w.player.sleep) w.msg(changed === 'chuva' ? 'Começou a chover. A chuva abafa os sons.' : changed === 'neblina' ? 'Uma neblina baixa toma o bairro. Difícil enxergar longe.' : `${WEATHER_LABEL[changed]}.`, 'info');
    }
    // barris de chuva enchem
    if (w.weather.rain > 0.05) {
      for (const s of w.waterSources) if (s.collectsRain) s.liters = Math.min(s.capacity, s.liters + CONFIG.weather.rainBarrelLitersPerHour * w.weather.rain * hours);
    }

    updatePlayer(w, cmd, dt);
    for (const v of w.vehicles) updateVehicle(w, v, v.occupant === w.player.id ? driveInput : null, dt);
    for (const a of w.allies) updateAlly(w, a, dt);
    for (const z of w.zombies) updateZombie(w, z, dt);

    if (w.player.alive && !w.player.vehicleId) integrate(w, w.player, dt);
    for (const a of w.allies) if (a.state !== 'morto') integrate(w, a, dt);
    for (const z of w.zombies) integrate(w, z, dt);
    separate(w);
    vehicleObstacles(w);
    const pv = w.vehicleById(w.player.vehicleId);
    if (pv) {
      w.player.x = pv.x;
      w.player.y = pv.y;
    }

    // portas (animação)
    for (const d of w.map.doors) {
      const target = d.open || d.broken ? 1 : 0;
      d.anim += Math.sign(target - d.anim) * Math.min(Math.abs(target - d.anim), dt * 6);
    }

    // efeitos
    for (let i = w.particles.length - 1; i >= 0; i--) {
      const p = w.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const drag = Math.exp(-dt * (p.kind === 'smoke' ? 1 : 6));
      p.vx *= drag;
      p.vy *= drag;
      if (p.life <= 0) {
        if (p.kind === 'blood' && w.rng.chance(0.25)) w.addDecal({ x: p.x, y: p.y, kind: 'blood', r: w.rng.range(0.8, 1.8), rot: 0, seed: w.rng.int(0, 9999) });
        w.particles.splice(i, 1);
      }
    }
    if (w.particles.length > 600) w.particles.splice(0, w.particles.length - 600);
    for (let i = w.tracers.length - 1; i >= 0; i--) {
      w.tracers[i].t -= dt;
      if (w.tracers[i].t <= 0) w.tracers.splice(i, 1);
    }
    for (let i = w.noiseRings.length - 1; i >= 0; i--) {
      w.noiseRings[i].t += dt;
      if (w.noiseRings[i].t >= w.noiseRings[i].max) w.noiseRings.splice(i, 1);
    }
    // limites do mundo
    const maxX = w.map.w * TILE - 2;
    const maxY = w.map.h * TILE - 2;
    for (const z of w.zombies) {
      z.x = Math.min(maxX, Math.max(2, z.x));
      z.y = Math.min(maxY, Math.max(2, z.y));
    }
    const ms = performance.now() - t0;
    this.stepMs = this.stepMs * 0.95 + ms * 0.05;
  }
}
