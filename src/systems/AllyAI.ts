import { TILE } from '../config';
import { itemDef } from '../data/items';
import { angleDiff, approachAngle, dist } from '../engine/math';
import { Ally } from '../entities/Ally';
import { Zombie } from '../entities/Zombie';
import { T } from '../world/tiles';
import type { World } from '../world/World';
import { meleeSwing } from './Combat';
import { toggleDoor } from './Interaction';
import { Inventory } from './Inventory';
import type { NoiseEvent } from './Noise';

/**
 * NPC aliado básico. Percebe apenas o que vê/ouve (sem conhecimento global),
 * segue o jogador, abre portas, defende-se e socorre o jogador incapacitado se tiver recursos médicos.
 */

const WALK = 46;
const RUN = 82;

export function allyCost(world: World) {
  const map = world.map;
  return (x: number, y: number) => {
    const d = map.doorAt(x, y);
    if (d && !d.open && !d.broken) return 1.5;
    if (map.solid(x, y)) return Infinity;
    if (map.get(x, y) === T.WINDOW_BROKEN) return 3;
    return 1;
  };
}

export function say(world: World, a: Ally, text: string, cd = 6) {
  if (a.speakCd > 0) return;
  a.speakCd = cd;
  world.msgNear(a.x, a.y, 16 * TILE, `${a.name}: ${text}`, 'npc');
}

export function goTo(world: World, a: Ally, gx: number, gy: number, speed: number, dt: number): 'ok' | 'fim' | 'porta' {
  // linha reta livre: vai direto
  if (world.map.clearPath(a.x, a.y, gx, gy, a.radius * 0.9) && world.map.los(a.x, a.y, gx, gy)) {
    a.path = null;
    const d = dist(a.x, a.y, gx, gy);
    if (d < 4) {
      a.vx = a.vy = 0;
      return 'fim';
    }
    a.vx = ((gx - a.x) / d) * speed;
    a.vy = ((gy - a.y) / d) * speed;
    a.facing = approachAngle(a.facing, Math.atan2(gy - a.y, gx - a.x), 10 * dt);
    return 'ok';
  }
  a.repathT -= dt;
  if (!a.path || a.repathT <= 0 || (a.pathGoal && dist(a.pathGoal.x, a.pathGoal.y, gx, gy) > TILE * 1.5)) {
    if (world.pathfinder.searchesThisTick < 8) {
      a.path = world.pathfinder.find(Math.floor(a.x / TILE), Math.floor(a.y / TILE), Math.floor(gx / TILE), Math.floor(gy / TILE), allyCost(world), 4000);
      a.pathIdx = 0;
      a.pathGoal = { x: gx, y: gy };
      a.repathT = 1;
    }
  }
  const path = a.path;
  if (!path || a.pathIdx >= path.length) {
    a.vx = a.vy = 0;
    return 'fim';
  }
  let wp = path[a.pathIdx];
  const door = world.map.doorAt(Math.floor(wp.x / TILE), Math.floor(wp.y / TILE));
  if (door && !door.open && !door.broken && dist(a.x, a.y, wp.x, wp.y) < 16) {
    a.vx = a.vy = 0;
    a.doorT += dt;
    if (a.doorT > 0.4) {
      a.doorT = 0;
      toggleDoor(world, door, false);
    }
    return 'porta';
  }
  if (a.pathIdx + 1 < path.length && world.map.clearPath(a.x, a.y, path[a.pathIdx + 1].x, path[a.pathIdx + 1].y, a.radius)) {
    a.pathIdx++;
    wp = path[a.pathIdx];
  }
  if (dist(a.x, a.y, wp.x, wp.y) < 3.5) {
    a.pathIdx++;
    if (a.pathIdx >= path.length) return 'fim';
    wp = path[a.pathIdx];
  }
  const d = dist(a.x, a.y, wp.x, wp.y) || 1;
  a.vx = ((wp.x - a.x) / d) * speed;
  a.vy = ((wp.y - a.y) / d) * speed;
  a.facing = approachAngle(a.facing, Math.atan2(wp.y - a.y, wp.x - a.x), 10 * dt);
  return 'ok';
}

export function sense(world: World, a: Ally) {
  const fov = (160 * Math.PI) / 180;
  for (const z of world.zombies) {
    const d = dist(a.x, a.y, z.x, z.y);
    if (d > 10 * TILE) continue;
    const ang = Math.abs(angleDiff(a.facing, Math.atan2(z.y - a.y, z.x - a.x)));
    if ((d < 2.5 * TILE || ang < fov / 2) && world.map.los(a.x, a.y, z.x, z.y)) {
      if (!a.known.has(z.id) && d < 6 * TILE) say(world, a, d < 3 * TILE ? 'Infectado, bem aqui!' : 'Tem um deles ali.', 8);
      a.known.set(z.id, { x: z.x, y: z.y, t: world.time });
    }
  }
  for (const [id, k] of a.known) if (world.time - k.t > 10) a.known.delete(id);
  const p = leaderOf(world, a);
  if (p.alive && dist(a.x, a.y, p.x, p.y) < 14 * TILE && world.map.los(a.x, a.y, p.x, p.y)) {
    a.lastPlayerSeen = { x: p.x, y: p.y, t: world.time };
  }
}

export function allyHear(world: World, a: Ally, n: NoiseEvent, _i: number) {
  if (a.state === 'morto') return;
  if (n.kind === 'grito') {
    a.heardCall = { x: n.x, y: n.y, t: world.time };
    say(world, a, 'Estou ouvindo você! Aguenta firme!', 3);
    return;
  }
  if (!n.byPlayer && a.state === 'parado') a.facing = approachAngle(a.facing, Math.atan2(n.y - a.y, n.x - a.x), 1.5);
}

export function updateAlly(world: World, a: Ally, dt: number) {
  if (a.state === 'morto') return;
  a.tickTimers(dt);
  if (a.attackCd > 0) a.attackCd -= dt;
  if (a.speakCd > 0) a.speakCd -= dt;
  a.senseT -= dt;
  if (a.senseT <= 0) {
    a.senseT = 0.2;
    sense(world, a);
  }
  const p = leaderOf(world, a);

  // ameaça mais próxima (somente zumbis que ele percebeu)
  const byId = new Map<string, Zombie>();
  for (const z of world.zombies) byId.set(z.id, z);
  let threat: Zombie | null = null;
  let td = Infinity;
  let near = 0;
  for (const [id] of a.known) {
    const z = byId.get(id);
    if (!z) {
      a.known.delete(id);
      continue;
    }
    const d = dist(a.x, a.y, z.x, z.y);
    if (d < 3 * TILE) near++;
    if (d < td) {
      td = d;
      threat = z;
    }
  }

  const playerDown = p.alive && p.isDown;
  const knowsDown =
    playerDown &&
    ((a.mode === 'seguir' && dist(a.x, a.y, p.x, p.y) < 30 * TILE) ||
      (!!a.lastPlayerSeen && world.time - a.lastPlayerSeen.t < 2) ||
      (!!a.heardCall && world.time - a.heardCall.t < 45));
  const med = a.medkit();
  const w = itemDef('cano_ferro').weapon!;
  const stagger = a.stagger > 0 ? 0.4 : 1;

  if (threat && a.hp < 30 && near >= 2) {
    // recua em direção ao jogador / para longe da ameaça
    a.state = 'recuando';
    a.rescueT = 0;
    const ax = a.x - threat.x;
    const ay = a.y - threat.y;
    const d = Math.hypot(ax, ay) || 1;
    a.vx = (ax / d) * RUN * stagger;
    a.vy = (ay / d) * RUN * stagger;
    a.facing = approachAngle(a.facing, Math.atan2(threat.y - a.y, threat.x - a.x), 8 * dt);
    say(world, a, 'São muitos! Estou recuando!');
    return;
  }

  if (threat && td < (playerDown ? 2.2 : 3.2) * TILE) {
    a.state = 'combate';
    a.rescueT = 0;
    const reach = a.radius + w.range + threat.radius;
    const ang = Math.atan2(threat.y - a.y, threat.x - a.x);
    a.facing = approachAngle(a.facing, ang, 12 * dt);
    if (td > reach - 2) {
      goTo(world, a, threat.x, threat.y, WALK * stagger, dt);
    } else {
      a.vx = a.vy = 0;
      if (a.attackCd <= 0 && a.stagger <= 0 && Math.abs(angleDiff(a.facing, ang)) < 0.6) {
        a.attackCd = w.cooldown * 1.15;
        a.attackAnim = a.attackDur = 0.28;
        meleeSwing(world, a, w, a.facing);
      }
    }
    return;
  }

  if (knowsDown && med) {
    a.state = 'socorrendo';
    const d = dist(a.x, a.y, p.x, p.y);
    if (d > 11) {
      a.rescueT = 0;
      goTo(world, a, p.x, p.y, RUN * stagger, dt);
      say(world, a, 'Estou indo! Fica parado!', 5);
    } else {
      a.vx = a.vy = 0;
      a.facing = approachAngle(a.facing, Math.atan2(p.y - a.y, p.x - a.x), 8 * dt);
      if (a.rescueT === 0) say(world, a, 'Deixa eu ver isso... aguenta.', 1);
      a.rescueT += dt;
      a.attackAnim = (a.rescueT % 0.8) < 0.2 ? 0.1 : 0;
      if (a.rescueT >= 4) {
        a.rescueT = 0;
        p.health.revive(35);
        if (med.defId === 'kit_medico' && med.state?.uses !== undefined) {
          med.state.uses--;
          if (med.state.uses <= 0) a.inv.remove(med.uid);
        } else a.inv.remove(med.uid, 1);
        world.sound('cloth', p.x, p.y, 0.8);
        world.msg(`${a.name} estancou seus sangramentos e te ajudou a levantar.`, 'good');
        say(world, a, 'Pronto. Agora vamos sair daqui.', 1);
        world.events.emit('inventoryChanged', {});
      }
    }
    return;
  }
  a.rescueT = 0;
  if (playerDown && knowsDown && !med) say(world, a, 'Não tenho nada para tratar você! Preciso de um kit médico!', 10);

  if (a.mode === 'seguir' && p.alive) {
    const d = dist(a.x, a.y, p.x, p.y);
    if (d > 2.6 * TILE) {
      a.state = 'seguindo';
      const fast = d > 7 * TILE || p.running;
      goTo(world, a, p.x, p.y, (fast ? RUN : WALK) * stagger, dt);
    } else {
      a.state = 'seguindo';
      a.vx = a.vy = 0;
      a.path = null;
      const look = threat ? Math.atan2(threat.y - a.y, threat.x - a.x) : p.facing;
      a.facing = approachAngle(a.facing, look, 3 * dt);
    }
    return;
  }

  a.state = 'parado';
  a.vx = a.vy = 0;
  if (threat) a.facing = approachAngle(a.facing, Math.atan2(threat.y - a.y, threat.x - a.x), 4 * dt);
  else a.facing += Math.sin(world.time * 0.4) * 0.15 * dt;
}

export type AllyCommand = 'seguir' | 'aguardar' | 'dar_kit' | 'estado';

/** Sobrevivente que o aliado acompanha (quem deu a última ordem). */
export function leaderOf(world: World, a: Ally) {
  return world.playerById(a.leaderId) ?? world.players[0];
}

export function allyCommand(world: World, a: Ally, cmd: AllyCommand) {
  if (a.state === 'morto') return;
  const p = world.player;
  a.leaderId = p.id;
  switch (cmd) {
    case 'seguir':
      a.mode = 'seguir';
      a.speakCd = 0;
      say(world, a, 'Certo, vou com você. Eu cuido das suas costas.', 0);
      break;
    case 'aguardar':
      a.mode = 'aguardar';
      a.speakCd = 0;
      say(world, a, 'Fico aqui. Não demora.', 0);
      break;
    case 'dar_kit': {
      const it = p.inv.items.find((i) => i.defId === 'kit_medico' || i.defId === 'bandagem');
      if (!it) {
        world.msg('Você não tem kit médico nem bandagem para entregar.', 'warn');
        return;
      }
      const r = Inventory.transfer(p.inv, a.inv, it.uid, it.defId === 'bandagem' ? 1 : undefined);
      p.validateEquipment();
      a.speakCd = 0;
      if (r.ok) say(world, a, 'Obrigado. Se você cair, eu te levanto.', 0);
      else say(world, a, 'Não tenho espaço para carregar isso.', 0);
      world.events.emit('inventoryChanged', {});
      break;
    }
    case 'estado': {
      const med = a.inv.items.find((i) => i.defId === 'kit_medico');
      const band = a.inv.count('bandagem');
      const hp = a.hp > 70 ? 'Estou inteiro.' : a.hp > 35 ? 'Estou ferido, mas aguento.' : 'Estou mal...';
      const kit = med ? `Tenho um kit médico com ${med.state?.uses ?? 0} uso(s).` : band ? `Tenho ${band} bandagem(ns).` : 'Não tenho nada para curativos.';
      a.speakCd = 0;
      say(world, a, `${hp} ${kit}`, 0);
      break;
    }
  }
}
