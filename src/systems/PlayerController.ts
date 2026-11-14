import { CONFIG, TILE } from '../config';
import { itemDef } from '../data/items';
import { approachAngle, dist } from '../engine/math';
import type { PlayerCommand, World } from '../world/World';
import { fireGun, meleeSwing } from './Combat';
import { containerInReach, findInteractable, interact } from './Interaction';
import { startReload } from './ItemActions';
import { handlePlayerDeath } from './Respawn';

let emptyMsgT = 0;

/** Aplica o comando do jogador à simulação: movimento, postura, combate, necessidades e interação. */
export function updatePlayer(world: World, cmd: PlayerCommand, dt: number) {
  const p = world.player;
  if (!p.alive) {
    p.vx = p.vy = 0;
    return;
  }
  const P = CONFIG.player;
  p.tickTimers(dt);
  if (p.attackCd > 0) p.attackCd -= dt;
  if (p.muzzleT > 0) p.muzzleT -= dt;
  if (p.shoutCd > 0) p.shoutCd -= dt;
  if (emptyMsgT > 0) emptyMsgT -= dt;

  // ---------------- necessidades
  p.hunger = Math.min(100, p.hunger + dt * 0.045);
  p.thirst = Math.min(100, p.thirst + dt * 0.07);
  if (p.hunger >= 95 || p.thirst >= 95) p.health.damage(0.12 * dt);

  // ---------------- saúde
  const wasDown = p.isDown;
  const msgs = p.health.update(dt, p.hunger < 85 && p.thirst < 85);
  for (const m of msgs) world.msg(m, m.includes('levantar') || m.includes('parou') || m.includes('cicatrizou') ? 'good' : 'danger');
  if (p.health.dead) {
    handlePlayerDeath(world);
    return;
  }
  if (!wasDown && p.isDown) {
    p.action = null;
    p.crouch = false;
    world.sound('hurt', p.x, p.y, 1);
    world.msg('Incapacitado. Sem ajuda, a hemorragia vai te matar. [E] grita por socorro.', 'danger');
  }

  // ---------------- mira
  p.aimX = cmd.aimX;
  p.aimY = cmd.aimY;
  const aimAngle = Math.atan2(cmd.aimY - p.y, cmd.aimX - p.x);

  if (p.isDown) {
    p.vx = p.vy = 0;
    p.running = false;
    if (cmd.interact) {
      const it = findInteractable(world);
      if (it) interact(world, it);
    }
    return;
  }

  if (p.stagger <= 0) p.facing = approachAngle(p.facing, aimAngle, 16 * dt);

  // ---------------- postura e movimento
  if (cmd.toggleCrouch) {
    p.crouch = !p.crouch;
    world.msg(p.crouch ? 'Agachado: passos silenciosos, mais difícil de ser visto.' : 'De pé.');
  }
  let mx = cmd.mx;
  let my = cmd.my;
  const ml = Math.hypot(mx, my);
  if (ml > 1) {
    mx /= ml;
    my /= ml;
  }
  const wantsMove = ml > 0.1;
  const w = p.weapon;
  const gun = w.kind === 'gun';
  p.aiming = gun && cmd.aimHeld;

  if (cmd.run && wantsMove && p.crouch) p.crouch = false;
  p.running = cmd.run && wantsMove && p.stamina > 4 && !p.aiming;
  const infectedSlow = p.health.infectionStage >= 2 ? 0.5 : 1;
  if (p.running) p.stamina = Math.max(0, p.stamina - P.runStaminaPerSec * dt);
  else p.stamina = Math.min(P.staminaMax, p.stamina + P.staminaRegenPerSec * dt * infectedSlow * (wantsMove ? 0.6 : 1));

  let speed = p.running ? P.runSpeed : p.crouch ? P.crouchSpeed : P.walkSpeed;
  if (p.aiming) speed *= 0.6;
  speed *= 1 - p.health.painSlow;
  if (p.stagger > 0) speed *= 0.45;
  if (p.stamina < 8 && !p.running) speed *= 0.85;

  if (p.action) {
    if (!p.action.allowMove && wantsMove) {
      world.msg(`${p.action.label} cancelado.`, 'warn');
      p.action.onCancel?.();
      p.action = null;
    } else if (p.action.allowMove) speed *= 0.55;
    else speed = 0;
  }
  p.vx = mx * speed;
  p.vy = my * speed;

  // ruído dos passos (percebido pelos zumbis)
  if (wantsMove && speed > 0) {
    p.stepNoiseT -= dt;
    if (p.stepNoiseT <= 0) {
      const N = CONFIG.noise;
      const r = p.running ? N.run : p.crouch ? N.crouchWalk : N.walk;
      p.stepNoiseT = p.running ? 0.3 : p.crouch ? 0.7 : 0.48;
      world.makeNoise(p.x, p.y, r, p.running ? 'corrida' : 'passos', true, p.id);
      world.sound('step', p.x, p.y, p.running ? 0.5 : p.crouch ? 0.12 : 0.28);
    }
  } else p.stepNoiseT = Math.min(p.stepNoiseT, 0.1);

  // ---------------- ação em andamento
  if (p.action) {
    p.action.t += dt;
    if (p.action.t >= p.action.dur) {
      const a = p.action;
      p.action = null;
      a.onDone();
    }
  }

  // ---------------- ataque
  const item = p.weaponItem;
  if (gun) {
    if (cmd.attackPressed && p.attackCd <= 0 && !p.action) {
      const ammo = item?.state?.ammo ?? 0;
      if (ammo > 0 && item) {
        item.state!.ammo = ammo - 1;
        p.attackCd = w.cooldown;
        p.muzzleT = 0.06;
        p.attackAnim = 0.12;
        const moving = Math.hypot(p.vx, p.vy) > 5;
        const spread = (w.spread ?? 0.1) * (p.aiming ? 0.35 : 1) * (moving ? 1.6 : 1) * (p.running ? 2 : 1);
        fireGun(world, p, w, aimAngle, spread);
        world.events.emit('inventoryChanged', {});
      } else {
        p.attackCd = 0.25;
        world.sound('empty', p.x, p.y, 0.6);
        if (emptyMsgT <= 0) {
          emptyMsgT = 2;
          world.msg(p.inv.count(w.ammo!) > 0 ? 'Carregador vazio. [R] para recarregar.' : 'Sem munição.', 'warn');
        }
      }
    }
  } else if (cmd.attack && p.attackCd <= 0 && !p.action) {
    if (p.stamina < w.stamina * 0.5) {
      if (emptyMsgT <= 0) {
        emptyMsgT = 2;
        world.msg('Exausto demais para atacar.', 'warn');
      }
    } else {
      p.stamina = Math.max(0, p.stamina - w.stamina);
      p.attackCd = w.cooldown * (p.stamina < 20 ? 1.4 : 1);
      p.attackAnim = p.attackDur = Math.min(0.3, w.cooldown * 0.6);
      const hits = meleeSwing(world, p, w, aimAngle, p.crouch ? 1.1 : 1);
      if (hits && item && item.condition !== undefined) {
        item.condition -= hits;
        if (item.condition <= 0) {
          p.inv.remove(item.uid);
          p.validateEquipment();
          world.msg(`Seu ${itemDef(item.defId).name.toLowerCase()} quebrou.`, 'warn');
          world.burst(p.x + Math.cos(aimAngle) * 8, p.y + Math.sin(aimAngle) * 8, 'splinter', 8, '#6b5139', 40);
          world.events.emit('inventoryChanged', {});
        }
      }
    }
  }

  if (cmd.reload) startReload(world);

  // ---------------- interação
  if (cmd.interact) {
    const it = findInteractable(world);
    if (it) interact(world, it);
  }

  // ---------------- equipamentos com bateria
  for (const it of p.inv.items) {
    const d = itemDef(it.defId);
    if ((d.light || d.radio) && it.state?.on) {
      it.state.battery = Math.max(0, (it.state.battery ?? 0) - dt * (d.light ? 0.25 : 0.15));
      if (it.state.battery <= 0) {
        it.state.on = false;
        world.msg(`${d.name}: bateria esgotada.`, 'warn');
      }
    }
  }
  // rádio ligado faz um pouco de barulho (estática)
  const radioOn = p.inv.items.some((i) => itemDef(i.defId).radio && i.state?.on);
  if (radioOn && Math.floor(world.time / 3) !== Math.floor((world.time - dt) / 3)) {
    world.makeNoise(p.x, p.y, CONFIG.noise.radio, 'radio', true, p.id);
  }

  // ---------------- recipiente aberto fora de alcance
  if (p.openContainer) {
    const c = world.getContainer(p.openContainer);
    if (!c || !containerInReach(world, c)) {
      p.openContainer = null;
      world.events.emit('closeContainer', {});
    }
  }

  // ---------------- pontos seguros e última posição segura
  const b = world.map.buildingAtPx(p.x, p.y);
  if (b >= 0) {
    for (const s of world.safePoints) {
      if (s.building !== b) continue;
      if (!s.discovered) {
        s.discovered = true;
        world.msg(`Ponto de retorno registrado: ${s.name}.`, 'good');
      }
      s.lastVisit = world.time;
    }
  }
  p.safeCheckT -= dt;
  if (p.safeCheckT <= 0) {
    p.safeCheckT = 1.5;
    const danger = world.zombies.some((z) => dist(z.x, z.y, p.x, p.y) < 10 * TILE);
    if (!danger && !p.health.bleeding) p.lastSafePos = { x: p.x, y: p.y };
  }
}
