import { CONFIG, TILE } from '../config';
import { dist } from '../engine/math';
import { WEATHER_LABEL } from './Weather';
import { updateVehicle, vehicleObstacles } from './VehicleSystem';
import { endSleep } from './Interaction';
import { Actor } from '../entities/Actor';
import { Ally } from '../entities/Ally';
import { Zombie } from '../entities/Zombie';
import { EMPTY_COMMAND, type PlayerCommand, type World } from '../world/World';
import type { Player } from '../entities/Player';
import { allyHear, updateAlly } from './AllyAI';
import { factionDaily } from './Factions';
import { Missions } from './Missions';
import { updateNpcs, updateTerritories } from './NpcAI';
import { PrisonSystem } from './Prison';
import { RadioSystem } from './Radio';
import { installSocialHooks } from './Social';
import { botCommand, installBotChat } from './SurvivorBot';
import { WorldSim } from './WorldSim';
import type { DriveInput } from './VehicleSystem';
import { NoiseSystem } from './Noise';
import { integrate, separate } from './Physics';
import { driveInput, updatePlayer } from './PlayerController';
import { updateZombie, zombieHear } from './ZombieAI';

/** Orquestra a simulação em passo fixo. */
export class Simulation {
  readonly noise: NoiseSystem;
  readonly worldSim: WorldSim;
  /** Tempo médio gasto por passo (ms) — monitoramento de desempenho. */
  stepMs = 0;
  /** Comando de direção de cada sobrevivente (veículos). */
  private drive = new Map<string, DriveInput>();
  private territoryT = 0;

  constructor(readonly world: World) {
    this.noise = new NoiseSystem(world);
    this.worldSim = new WorldSim(world);
    world.isActiveAt = (x, y) => this.worldSim.isActive(x, y);
    world.prison ??= new PrisonSystem(world);
    world.radio ??= new RadioSystem(world);
    if (!world.missions) {
      world.missions = new Missions(world);
      world.missions.seedSideMissions();
    }
    installSocialHooks(world);
    installBotChat(world);
    world.noiseHook = (n) => {
      this.worldSim.noise(n.x, n.y, n.radius);
      const listeners: Actor[] = [];
      for (const z of world.zombies) if (this.worldSim.isActive(z.x, z.y)) listeners.push(z);
      for (const a of world.allies) if (a.state !== 'morto') listeners.push(a);
      for (const a of world.npcs) if (a.state !== 'morto' && this.worldSim.isActive(a.x, a.y)) listeners.push(a);
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
      for (const p of world.players) {
        if (p.sleep && n.sourceId !== p.id && dist(n.x, n.y, p.x, p.y) < n.radius * TILE * 0.8 && n.radius >= 6) {
          world.withPlayer(p, () => endSleep(world, n.kind === 'pancadas' ? 'Você acordou com pancadas na porta!' : 'Um barulho te acordou.'));
        }
      }
    };
    this.worldSim.refreshCells();
  }

  /**
   * Um passo da simulação. `cmd` pode ser o comando do jogador local (modo offline)
   * ou um mapa id→comando com os humanos conectados (servidor). Vagas sem humano: IA.
   */
  step(dt: number, cmd: PlayerCommand | Map<string, PlayerCommand>) {
    const t0 = performance.now();
    const w = this.world;
    w.time += dt;
    w.pathfinder.searchesThisTick = 0;

    const hours = (dt * CONFIG.time.minutesPerSecond) / 60;
    const changed = w.weather.update(dt, hours);
    if (changed) {
      w.events.emit('weatherChanged', { kind: changed });
      w.msgAll(changed === 'chuva' ? 'Começou a chover. A chuva abafa os sons.' : changed === 'neblina' ? 'Uma neblina baixa toma o bairro. Difícil enxergar longe.' : `${WEATHER_LABEL[changed]}.`, 'info');
    }
    // barris de chuva enchem
    if (w.weather.rain > 0.05) {
      for (const s of w.waterSources) if (s.collectsRain) s.liters = Math.min(s.capacity, s.liters + CONFIG.weather.rainBarrelLitersPerHour * w.weather.rain * hours);
    }

    const ctx = w.player;
    const cmds = cmd instanceof Map ? cmd : new Map([[w.localId, cmd]]);
    this.worldSim.update(dt);
    for (const p of w.players) {
      const active = this.worldSim.isActive(p.x, p.y);
      const human = p.controller === 'humano';
      const c = human ? cmds.get(p.id) ?? EMPTY_COMMAND : botCommand(w, p, dt, active);
      w.withPlayer(p, () => updatePlayer(w, c, dt));
      this.drive.set(p.id, { throttle: driveInput.throttle, steer: driveInput.steer });
    }
    for (const v of w.vehicles) updateVehicle(w, v, v.occupant ? this.drive.get(v.occupant) ?? null : null, dt);
    for (const a of w.allies) updateAlly(w, a, dt);
    updateNpcs(w, dt, (x, y) => this.worldSim.isActive(x, y));
    for (const z of w.zombies) if (this.worldSim.isActive(z.x, z.y)) updateZombie(w, z, dt);

    for (const p of w.players) if (p.alive && !p.vehicleId && (p.controller === 'humano' || this.worldSim.isActive(p.x, p.y))) integrate(w, p, dt);
    for (const a of w.allies) if (a.state !== 'morto') integrate(w, a, dt);
    for (const n of w.npcs) if (n.state !== 'morto' && (this.worldSim.isActive(n.x, n.y) || n.followId)) integrate(w, n, dt);
    for (const z of w.zombies) if (this.worldSim.isActive(z.x, z.y)) integrate(w, z, dt);
    separate(w);
    vehicleObstacles(w);
    for (const p of w.players) {
      const pv = w.vehicleById(p.vehicleId);
      if (pv) {
        p.x = pv.x;
        p.y = pv.y;
      }
    }
    w.player = ctx;

    // sistemas sociais e de campanha
    w.prison!.update();
    w.radio!.update(dt);
    w.missions!.update(dt);
    this.territoryT -= dt;
    if (this.territoryT <= 0) {
      this.territoryT = 1;
      updateTerritories(w);
      factionDaily(w, (1 * CONFIG.time.minutesPerSecond) / 60);
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
