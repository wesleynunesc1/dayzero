import { CONFIG, TILE } from '../config';
import { itemDef } from '../data/items';
import { angleDiff, approachAngle, dist } from '../engine/math';
import { Npc } from '../entities/Npc';
import { Player } from '../entities/Player';
import { Zombie } from '../entities/Zombie';
import type { World } from '../world/World';
import { goTo, say, sense } from './AllyAI';
import { damageHuman, fireGun, meleeSwing } from './Combat';
import { inRestricted, isHostileTo, rep, territoryAt } from './Factions';
import { attitude, eatIfNeeded, remember, updateEmotions } from './Social';

/**
 * IA dos NPCs humanos: escolha de comportamento por UTILIDADE, a partir do estado
 * (vida, fome, sede, emoções, inventário), do contexto (ameaças percebidas, território,
 * corpos e recipientes próximos) e das relações/memória. Nenhuma decisão é aleatória
 * sem causa; o gerador do mundo (seeded) só desempata exploração.
 *
 * Desempenho: NPCs longe de qualquer sobrevivente (fora das células ativas) só atualizam
 * necessidades e emoções a cada `CONFIG.npc.farThinkSec` segundos.
 */

const WALK = 44;
const RUN = 80;

type Choice = { act: Npc['activity']; score: number; run: () => void };

let zCache: { t: number; map: Map<string, Zombie> } = { t: -1, map: new Map() };
function zombieMap(world: World) {
  if (zCache.t !== world.time) {
    zCache = { t: world.time, map: new Map() };
    for (const z of world.zombies) zCache.map.set(z.id, z);
  }
  return zCache.map;
}

export function updateNpcs(world: World, dt: number, isActive: (x: number, y: number) => boolean) {
  for (const n of world.npcs) {
    if (n.state === 'morto') continue;
    if (n.speakCd > 0) n.speakCd -= dt;
    if (n.attackCd > 0) n.attackCd -= dt;
    if (n.lootCd > 0) n.lootCd -= dt;
    const hours = (dt * CONFIG.time.minutesPerSecond) / 60;
    n.hunger = Math.min(100, n.hunger + hours * 4);
    n.thirst = Math.min(100, n.thirst + hours * 6);
    if (!isActive(n.x, n.y) && n.followId === null) {
      // modo econômico: sem física nem percepção detalhada
      n.vx = n.vy = 0;
      n.thinkT -= dt;
      if (n.thinkT <= 0) {
        n.thinkT = CONFIG.npc.farThinkSec;
        eatIfNeeded(n);
        updateEmotions(world, n, CONFIG.npc.farThinkSec, 0, 0);
        farGoal(world, n, CONFIG.npc.farThinkSec);
      }
      continue;
    }
    n.senseT -= dt;
    if (n.senseT <= 0) {
      n.senseT = 0.25;
      sense(world, n);
      checkRequests(world, n);
    }
    think(world, n, dt);
  }
}

/** Longe dos jogadores, NPCs em viagem avançam pelo caminho (sem física). */
function farGoal(world: World, n: Npc, dt: number) {
  const g = n.goal;
  if (!g || g.kind !== 'ir_para' || n.activity !== 'viajando') return;
  const tx = g.x * TILE;
  const ty = g.y * TILE;
  const d = dist(n.x, n.y, tx, ty);
  if (d < TILE * 2) return;
  const step = WALK * dt;
  const nx = n.x + ((tx - n.x) / d) * step;
  const ny = n.y + ((ty - n.y) / d) * step;
  if (!world.map.solidPx(nx, ny)) {
    n.x = nx;
    n.y = ny;
  }
}

/** Pedidos de ajuda: pede a quem se aproxima; se ignorado por muito tempo, guarda ressentimento. */
function checkRequests(world: World, n: Npc) {
  const need = n.def.needs;
  if (!need) return;
  for (const p of world.players) {
    if (p.dead) continue;
    const d = dist(n.x, n.y, p.x, p.y);
    const req = n.requests.find((r) => r.who === p.id);
    if (!req && d < 4 * TILE && world.map.los(n.x, n.y, p.x, p.y) && attitude(world, n, p.id) !== 'hostil') {
      n.requests.push({ who: p.id, at: world.gameMinutes, resolved: false });
      remember(world, n, 'pediu_ajuda', p, `Pediu ${need.label} a ${p.name}`);
      world.withPlayer(p, () => world.msg(`${n.name}: ${need.reason}`, 'npc'));
      world.missions?.onEvent('npc_pediu', { npc: n.key, to: p.id });
    } else if (req && !req.resolved && world.gameMinutes - req.at > CONFIG.npc.helpWaitHours * 60) {
      req.resolved = true; // o prazo acabou: o pedido foi ignorado
      remember(world, n, 'ignorou_pedido', p, `${p.name} ignorou o pedido (${need.label})`);
      world.missions?.onEvent('npc_ignorado', { npc: n.key, by: p.id });
    }
  }
}

function nearestThreat(world: World, n: Npc) {
  const zm = zombieMap(world);
  let threat: Zombie | null = null;
  let td = Infinity;
  let near = 0;
  for (const [id] of n.known) {
    const z = zm.get(id);
    if (!z || !z.alive) {
      n.known.delete(id);
      continue;
    }
    const d = dist(n.x, n.y, z.x, z.y);
    if (d < 4 * TILE) near++;
    if (d < td) {
      td = d;
      threat = z;
    }
  }
  return { threat, td, near };
}

/** Pessoa hostil visível (sobrevivente com quem tem conflito ou invasor do território). */
function hostileHuman(world: World, n: Npc): { p: Player; d: number } | null {
  let best: { p: Player; d: number } | null = null;
  for (const p of world.players) {
    if (p.dead || p.captive) continue;
    const d = dist(n.x, n.y, p.x, p.y);
    if (d > CONFIG.npc.senseRange) continue;
    if (!world.map.los(n.x, n.y, p.x, p.y)) continue;
    const hostile = n.hostileTo.has(p.id) || (n.faction && n.role !== 'prisioneiro' && isHostileTo(world, n.faction, p.id) && territoryAt(world, p.x, p.y)?.id === n.faction);
    if (hostile && (!best || d < best.d)) best = { p, d };
  }
  return best;
}

function weaponOf(n: Npc) {
  const it = n.inv.get(n.weaponUid);
  return it ? { it, def: itemDef(it.defId) } : null;
}

function think(world: World, n: Npc, dt: number) {
  const pers = n.def.personality;
  const { threat, td, near } = nearestThreat(world, n);
  const enemy = hostileHuman(world, n);
  const friendsNear = world.players.filter((p) => !p.dead && dist(p.x, p.y, n.x, n.y) < 8 * TILE && attitude(world, n, p.id) !== 'hostil').length;
  updateEmotions(world, n, dt, near + (enemy ? 1 : 0), friendsNear);
  const stagger = n.stagger > 0 ? 0.4 : 1;
  const wpn = weaponOf(n);
  const armed = !!wpn;
  const fear = n.emotions.medo / 100;
  const choices: Choice[] = [];

  // prisioneiro preso: fica na cela (pode conversar); se a porta abrir, foge
  if (n.role === 'prisioneiro' && n.activity === 'preso') {
    const pr = world.prisons.find((p) => p.faction === n.faction);
    const cell = pr && n.cell !== null ? pr.cells[n.cell] : null;
    const door = cell ? world.map.doors.find((d) => d.x === cell.doorX && d.y === cell.doorY) : null;
    if (door && (door.open || door.broken)) {
      n.activity = 'fugindo_prisao';
      say(world, n, 'A porta! Vamos, antes que eles voltem!', 1);
    } else {
      n.vx = n.vy = 0;
      return;
    }
  }

  // 1) FUGIR — medo alto, ferido ou desarmado diante de ameaça
  if (threat && td < 7 * TILE) {
    const flee = fear * 0.8 + (n.hp < 35 ? 0.6 : 0) + (armed ? 0 : 0.25) + near * 0.12 - pers.coragem * 0.5;
    choices.push({
      act: 'fugindo',
      score: flee,
      run: () => {
        const ax = n.x - threat.x;
        const ay = n.y - threat.y;
        const d = Math.hypot(ax, ay) || 1;
        const tx = n.x + (ax / d) * 5 * TILE;
        const ty = n.y + (ay / d) * 5 * TILE;
        goTo(world, n, tx, ty, RUN * stagger, dt);
        if (n.speakCd <= 0) say(world, n, near > 2 ? 'São muitos! Corre!' : 'Sai de perto de mim!', 6);
      },
    });
    // 2) LUTAR — coragem, arma, defender o território/aliados
    const fight = (1 - fear) * 0.6 + (armed ? 0.35 : 0) + pers.coragem * 0.4 + (n.role === 'guarda' || n.role === 'lider' ? 0.3 : 0) + (td < 2.5 * TILE ? 0.3 : 0);
    choices.push({ act: n.role === 'guarda' ? 'defendendo' : 'lutando', score: fight, run: () => fightZombie(world, n, threat, td, dt, stagger) });
  }

  // 3) CONFRONTAR humano hostil (guarda → exige rendição; agressivo → ataca)
  if (enemy) {
    const fac = n.faction ? world.factions.get(n.faction) : null;
    choices.push({
      act: 'confrontando',
      score: 0.7 + pers.agressividade * 0.4 + (n.role === 'guarda' ? 0.3 : 0) - fear * 0.3,
      run: () => confrontHuman(world, n, enemy.p, enemy.d, dt, stagger, !!fac?.captures),
    });
  }

  // 4) SOCORRER — sobrevivente amigo incapacitado por perto
  const down = world.players.find((p) => p.alive && p.isDown && dist(p.x, p.y, n.x, n.y) < 12 * TILE && attitude(world, n, p.id) !== 'hostil' && attitude(world, n, p.id) !== 'ressentido');
  const med = n.medkit();
  if (down && med && !threat) {
    choices.push({ act: 'ajudando', score: 0.8 + pers.empatia * 0.5, run: () => rescue(world, n, down, dt) });
  }

  // 5) COMER / BEBER / BUSCAR COMIDA
  const hungry = Math.max(n.hunger, n.thirst) / 100;
  if (hungry > 0.45) {
    if (eatIfNeeded(n)) {
      n.activity = 'comendo';
    } else {
      choices.push({ act: 'buscando_comida', score: hungry * 0.9, run: () => scavenge(world, n, dt, 'comida') });
    }
  }

  // 6) SAQUEAR CORPO com itens (ganância/sobrevivência)
  if (n.lootCd <= 0 && !threat) {
    const c = world.corpses.find((c) => !c.zombie && c.container.inv.items.length > 0 && dist(c.x, c.y, n.x, n.y) < 18 * TILE && world.map.los(n.x, n.y, c.x, c.y));
    if (c) choices.push({ act: 'saqueando_corpo', score: 0.25 + pers.ganancia * 0.6 + (n.role === 'guarda' ? -0.3 : 0), run: () => lootCorpse(world, n, c, dt) });
  }

  // 7) SEGUIR quem o recrutou
  const leader = world.playerById(n.followId);
  if (leader && !leader.dead) {
    choices.push({ act: 'seguindo', score: 0.55 + pers.lealdade * 0.2, run: () => follow(world, n, leader, dt, stagger) });
  }

  // 8) OBJETIVO pessoal (viajar, vigiar, explorar)
  const g = n.goal;
  if (n.activity === 'fugindo_prisao' && n.role === 'prisioneiro') {
    const pr = world.prisons.find((p) => p.faction === n.faction)!;
    choices.push({
      act: 'fugindo_prisao',
      score: 0.9,
      run: () => {
        if (goTo(world, n, pr.exit.x * TILE, pr.exit.y * TILE, RUN * stagger, dt) === 'fim' || dist(n.x, n.y, pr.exit.x * TILE, pr.exit.y * TILE) < 2 * TILE) {
          n.role = 'sobrevivente';
          n.activity = 'viajando';
          n.goalIdx = Math.min(n.goalIdx + 1, n.def.goals.length - 1);
          const rescuer = world.players.find((p) => dist(p.x, p.y, n.x, n.y) < 14 * TILE);
          if (rescuer) remember(world, n, 'resgatou', rescuer, `Foi resgatado por ${rescuer.name}`);
          world.missions?.onEvent('prisioneiro_livre', { npc: n.key, by: rescuer?.id ?? null });
        }
      },
    });
  } else if (g?.kind === 'ir_para' && !leader) {
    const ready = !g.needsTrust || world.players.some((p) => n.rel(p.id).confianca >= g.needsTrust!) || n.activity === 'viajando';
    if (ready) {
      choices.push({
        act: 'viajando',
        score: 0.4,
        run: () => {
          if (goTo(world, n, g.x * TILE, g.y * TILE, WALK * stagger, dt) === 'fim' || dist(n.x, n.y, g.x * TILE, g.y * TILE) < 2 * TILE) {
            n.home = { x: n.x, y: n.y };
            n.goalDone = true;
            n.goalIdx = n.def.goals.length; // concluído
            n.activity = 'parado';
            world.missions?.onEvent('npc_chegou', { npc: n.key });
          }
        },
      });
    }
  }
  const home = n.home;
  const guard = n.role === 'guarda' || n.role === 'lider' || g?.kind === 'proteger_territorio';
  choices.push({
    act: guard ? 'vigiando' : g?.kind === 'acumular' || n.role === 'sobrevivente' ? 'explorando' : 'parado',
    score: 0.2,
    run: () => {
      if (!guard && (g?.kind === 'acumular' || n.role === 'sobrevivente') && hungry < 0.45 && n.activityT <= 0) {
        scavenge(world, n, dt, 'qualquer');
        return;
      }
      const d = dist(n.x, n.y, home.x, home.y);
      if (d > 1.5 * TILE) goTo(world, n, home.x, home.y, WALK * stagger, dt);
      else {
        n.vx = n.vy = 0;
        // vigia: olha ao redor devagar
        if (guard) n.facing += Math.sin(world.time * 0.4 + n.x) * dt * 0.5;
      }
    },
  });

  // conversa aberta: fica parado olhando para quem fala (salvo perigo)
  if (n.talkingTo) {
    const p = world.playerById(n.talkingTo);
    if (p && dist(p.x, p.y, n.x, n.y) < 3 * TILE && !threat && !enemy) {
      n.activity = 'conversando';
      n.vx = n.vy = 0;
      n.facing = approachAngle(n.facing, Math.atan2(p.y - n.y, p.x - n.x), 8 * dt);
      return;
    }
    n.talkingTo = null;
  }

  choices.sort((a, b) => b.score - a.score);
  const best = choices[0];
  if (n.activity !== best.act && n.activity === 'saqueando_corpo') n.lootCd = 4;
  n.activity = best.act;
  if (n.activityT > 0) n.activityT -= dt;
  best.run();
}

function fightZombie(world: World, n: Npc, z: Zombie, td: number, dt: number, stagger: number) {
  const wpn = weaponOf(n);
  const ang = Math.atan2(z.y - n.y, z.x - n.x);
  n.facing = approachAngle(n.facing, ang, 12 * dt);
  const ws = wpn?.def.weapon ?? itemDef('cano_ferro').weapon!;
  if (ws.kind === 'gun' && (wpn!.it.state?.ammo ?? 0) > 0 && td > 2 * TILE && td < 12 * TILE) {
    n.vx = n.vy = 0;
    if (n.attackCd <= 0 && Math.abs(angleDiff(n.facing, ang)) < 0.15 && world.map.los(n.x, n.y, z.x, z.y)) {
      n.attackCd = ws.cooldown * 1.6;
      wpn!.it.state!.ammo!--;
      fireGun(world, n, ws, ang, 0.12);
      reloadIfEmpty(n);
    }
    return;
  }
  const melee = ws.kind === 'gun' ? itemDef('cano_ferro').weapon! : ws;
  const reach = n.radius + melee.range + z.radius;
  if (td > reach - 2) goTo(world, n, z.x, z.y, RUN * stagger, dt);
  else {
    n.vx = n.vy = 0;
    if (n.attackCd <= 0 && n.stagger <= 0 && Math.abs(angleDiff(n.facing, ang)) < 0.6) {
      n.attackCd = melee.cooldown * 1.2;
      n.attackAnim = n.attackDur = 0.28;
      meleeSwing(world, n, melee, n.facing);
    }
  }
}

function reloadIfEmpty(n: Npc) {
  const wpn = weaponOf(n);
  if (!wpn || wpn.def.weapon?.kind !== 'gun' || (wpn.it.state?.ammo ?? 0) > 0) return;
  const ammoId = wpn.def.weapon.ammo!;
  const have = n.inv.count(ammoId);
  const k = Math.min(have, wpn.def.weapon.magazine ?? 6);
  if (k > 0) {
    const a = n.inv.findDef(ammoId)!;
    n.inv.remove(a.uid, k);
    wpn.it.state!.ammo = k;
    n.attackCd = 2;
  }
}

/** Confronto com humano: guardas de facções que capturam exigem rendição antes de atacar. */
function confrontHuman(world: World, n: Npc, p: Player, d: number, dt: number, stagger: number, captures: boolean) {
  const ang = Math.atan2(p.y - n.y, p.x - n.x);
  n.facing = approachAngle(n.facing, ang, 10 * dt);
  const personal = n.hostileTo.has(p.id);
  if (captures && !personal && !p.isDown) {
    if (!n.confront || n.confront.who !== p.id) {
      n.confront = { who: p.id, t: CONFIG.factions.surrenderWaitSec };
      const f = world.factions.get(n.faction!)!;
      world.withPlayer(p, () => world.msg(`${n.name}: ${f.kind === 'militar' ? 'Parado! Largue a arma e deite no chão! Você está detido!' : 'Perdeu, parceiro. Larga tudo e vem com a gente.'} (fale com ${n.name.split(' ')[0]} para se render)`, 'danger'));
      remember(world, n, 'ameacou', p, `Deu voz de prisão a ${p.name}`);
    }
    n.confront.t -= dt;
    if (d > 2.2 * TILE) goTo(world, n, p.x, p.y, WALK * stagger, dt);
    else n.vx = n.vy = 0;
    if (n.confront.t > 0) return;
    // não se rendeu: passa a tratar como hostil (mas busca incapacitar, não matar)
    n.hostileTo.add(p.id);
  }
  if (p.isDown) {
    // incapacitado: facções que capturam prendem; as outras param de atacar (não executam)
    n.vx = n.vy = 0;
    if (captures && d < 2 * TILE) world.prison?.surrender(p, n);
    return;
  }
  const wpn = weaponOf(n);
  const ws = wpn?.def.weapon;
  if (ws?.kind === 'gun' && (wpn!.it.state?.ammo ?? 0) > 0 && d > 2.5 * TILE) {
    n.vx = n.vy = 0;
    if (n.attackCd <= 0 && Math.abs(angleDiff(n.facing, ang)) < 0.2) {
      n.attackCd = ws.cooldown * 2.2;
      wpn!.it.state!.ammo!--;
      world.sound('gunshot', n.x, n.y, 1);
      world.makeNoise(n.x, n.y, ws.noise, 'tiro', false, n.id);
      world.tracers.push({ x1: n.x, y1: n.y, x2: p.x, y2: p.y, t: 0.07 });
      const hit = 0.75 - d / (CONFIG.npc.senseRange * 2);
      if (world.rng.chance(hit)) damageHuman(world, p, ws.damage * 0.45, n, 'tiro');
      reloadIfEmpty(n);
    }
    return;
  }
  const melee = ws && ws.kind !== 'gun' ? ws : itemDef('cano_ferro').weapon!;
  if (d > n.radius + melee.range + p.radius - 2) goTo(world, n, p.x, p.y, RUN * stagger, dt);
  else {
    n.vx = n.vy = 0;
    if (n.attackCd <= 0 && n.stagger <= 0) {
      n.attackCd = melee.cooldown * 1.4;
      n.attackAnim = n.attackDur = 0.28;
      damageHuman(world, p, melee.damage * 0.5, n, 'golpe');
    }
  }
}

function rescue(world: World, n: Npc, p: Player, dt: number) {
  const d = dist(n.x, n.y, p.x, p.y);
  if (d > 11) {
    n.rescueT = 0;
    goTo(world, n, p.x, p.y, RUN, dt);
    return;
  }
  n.vx = n.vy = 0;
  n.rescueT += dt;
  if (n.rescueT >= 4) {
    n.rescueT = 0;
    const med = n.medkit();
    if (!med) return;
    p.health.revive(30);
    if (med.state?.uses && med.state.uses > 1) med.state.uses--;
    else n.inv.remove(med.uid, 1);
    world.withPlayer(p, () => world.msg(`${n.name} te socorreu e estancou o sangramento.`, 'good'));
    // ajudar também cria vínculo: o jogador fica devendo (e o NPC confia mais)
    n.rel(p.id).confianca += 5;
  }
}

/** Procura comida (ou qualquer coisa útil) em recipientes próximos e não revistados. */
function scavenge(world: World, n: Npc, dt: number, what: 'comida' | 'qualquer') {
  let tgt = n.target ? world.containers.get(n.target.id ?? '') : undefined;
  if (!tgt || tgt.inv.items.length === 0 && tgt.searched) {
    n.target = null;
    let best = Infinity;
    for (const c of world.containers.values()) {
      if (c.owner && c.owner !== n.faction) continue; // não rouba de facções
      const cx = (c.x + c.w / 2) * TILE;
      const cy = (c.y + c.h / 2) * TILE;
      const d = dist(cx, cy, n.x, n.y);
      if (d > 22 * TILE || d >= best) continue;
      if (c.searched && !c.inv.items.some((i) => what === 'qualquer' || itemDef(i.defId).food)) continue;
      best = d;
      tgt = c;
    }
    if (!tgt) {
      n.activityT = 30; // nada por perto: desiste por um tempo
      n.vx = n.vy = 0;
      return;
    }
    n.target = { x: (tgt.x + tgt.w / 2) * TILE, y: (tgt.y + tgt.h / 2) * TILE, id: tgt.id };
  }
  const t = n.target!;
  if (dist(n.x, n.y, t.x, t.y) > 1.6 * TILE) {
    goTo(world, n, t.x, t.y, WALK, dt);
    return;
  }
  n.vx = n.vy = 0;
  tgt.searched = true;
  for (const it of [...tgt.inv.items]) {
    const d = itemDef(it.defId);
    const useful = what === 'qualquer' ? !!(d.food || d.medical || d.category === 'Munição' || d.water) : !!(d.food || d.water);
    if (!useful) continue;
    if (n.inv.canAdd(it).ok) {
      tgt.inv.remove(it.uid);
      n.inv.add(it);
    }
  }
  n.target = null;
  n.activityT = 20;
  eatIfNeeded(n);
}

/** NPC revira um corpo e fica com o que tiver valor (armas, munição, remédios, comida). */
function lootCorpse(world: World, n: Npc, c: World['corpses'][number], dt: number) {
  if (dist(n.x, n.y, c.x, c.y) > 1.2 * TILE) {
    goTo(world, n, c.x, c.y, WALK, dt);
    return;
  }
  n.vx = n.vy = 0;
  n.rescueT += dt;
  if (n.rescueT < 2.5) return;
  n.rescueT = 0;
  const taken: string[] = [];
  for (const it of [...c.container.inv.items]) {
    const d = itemDef(it.defId);
    const value = d.weapon || d.category === 'Munição' || d.medical || d.food || d.water || d.backpack || d.wear || d.radio;
    if (!value || !n.inv.canAdd(it).ok) continue;
    c.container.inv.remove(it.uid);
    n.inv.add(it);
    taken.push(d.name);
    // pega uma arma melhor se estiver desarmado
    if (d.weapon && !n.inv.get(n.weaponUid)) n.weaponUid = it.uid;
  }
  n.lootCd = 30;
  if (taken.length) {
    world.msgNear(n.x, n.y, 12 * TILE, `${n.name} revirou ${c.name.toLowerCase()} e pegou: ${taken.slice(0, 4).join(', ')}${taken.length > 4 ? '…' : ''}.`, 'warn');
    world.missions?.onEvent('corpo_saqueado', { npc: n.key, corpse: c.id, items: taken.length });
  }
}

function follow(world: World, n: Npc, p: Player, dt: number, stagger: number) {
  const d = dist(n.x, n.y, p.x, p.y);
  if (d > 2.6 * TILE) goTo(world, n, p.x, p.y, (d > 7 * TILE ? RUN : WALK) * stagger, dt);
  else {
    n.vx = n.vy = 0;
    n.facing = approachAngle(n.facing, Math.atan2(p.y - n.y, p.x - n.x), 4 * dt);
  }
  if (d > 60 * TILE) {
    remember(world, n, 'abandonou', p, `${p.name} o deixou para trás`);
    n.followId = null;
    n.home = { x: n.x, y: n.y };
  }
}

/** Invasão de território: guardas reagem a quem entra em área restrita sem autorização. */
export function updateTerritories(world: World) {
  for (const p of world.players) {
    if (p.dead || p.captive) continue;
    const f = territoryAt(world, p.x, p.y);
    if (!f) continue;
    const r = rep(world, f.id, p.id);
    const restricted = inRestricted(f, p.x, p.y);
    if (restricted && r < CONFIG.factions.friendlyAbove && !(f.id === 'sentinela' && world.map.doors.some((d) => d.label === 'Porta do paiol' && !d.locked))) {
      const last = f.warned[p.id] ?? -999;
      if (world.time - last > 20) {
        f.warned[p.id] = world.time;
        world.withPlayer(p, () => world.msg(`Você entrou numa área restrita de ${f.name}.`, 'danger'));
        // reputação cai e os guardas que virem o invasor vão confrontá-lo
        f.reputation[p.id] = Math.min(r, CONFIG.factions.hostileBelow - 1);
      }
    }
  }
}

export { Npc };
