import { CONFIG, TILE } from '../config';
import { itemDef } from '../data/items';
import { dist } from '../engine/math';
import { Player, SURVIVORS } from '../entities/Player';
import type { Zombie } from '../entities/Zombie';
import type { PathPoint } from '../world/Pathfinder';
import { EMPTY_COMMAND, PlayerCommand, World } from '../world/World';
import { allyCost } from './AllyAI';
import { doPlayerItemAction, startReload } from './ItemActions';
import { radioOf, speak } from './Radio';

/**
 * IA dos SOBREVIVENTES (vagas sem jogador humano, ou jogador desconectado).
 * O bot produz o mesmo `PlayerCommand` que um humano produziria e usa as mesmas
 * ações de inventário: gasta munição, come, recebe dano, encontra itens — tudo persiste.
 *
 * Perto de jogadores (células ativas) age em tempo real. Longe, avança em modo
 * econômico (caminha pelo caminho calculado, revista recipientes, come do inventário).
 */
interface BotMem {
  path: PathPoint[] | null;
  pathGoal: string;
  pathT: number;
  think: number;
  cmd: PlayerCommand;
  goal: { x: number; y: number; why: string } | null;
  lastRadio: number;
  scavT: number;
}

const mem = new WeakMap<Player, BotMem>();

function m(p: Player): BotMem {
  let b = mem.get(p);
  if (!b) mem.set(p, (b = { path: null, pathGoal: '', pathT: 0, think: 0, cmd: { ...EMPTY_COMMAND }, goal: null, lastRadio: -999, scavT: 0 }));
  return b;
}

/** Descrição verbal de onde o bot está (cidade + lugar conhecido mais próximo). Nunca coordenadas. */
export function describePlace(w: World, x: number, y: number): string {
  const tx = x / TILE;
  const ty = y / TILE;
  const town = [...w.towns].sort((a, b) => dist(a.cx, a.cy, tx, ty) - dist(b.cx, b.cy, tx, ty))[0];
  const poi = [...w.pois].sort((a, b) => dist(a.x + a.w / 2, a.y + a.h / 2, tx, ty) - dist(b.x + b.w / 2, b.y + b.h / 2, tx, ty))[0];
  const dTown = town ? dist(town.cx, town.cy, tx, ty) : Infinity;
  const dPoi = poi ? dist(poi.x + poi.w / 2, poi.y + poi.h / 2, tx, ty) : Infinity;
  if (dPoi < 25) return `perto de ${poi.name}${town && dTown < 60 ? `, em ${town.name}` : ''}`;
  if (dTown < 50) return `em ${town.name}`;
  return `na estrada, longe de qualquer cidade${town ? ` — a mais perto deve ser ${town.name}` : ''}`;
}

export function botCommand(w: World, p: Player, dt: number, active: boolean): PlayerCommand {
  const b = m(p);
  const cmd = b.cmd;
  cmd.attackPressed = false;
  cmd.interact = false;
  cmd.reload = false;
  cmd.toggleCrouch = false;
  if (p.dead || p.isDown || p.sleep || p.captive) {
    cmd.mx = cmd.my = 0;
    cmd.attack = false;
    return cmd;
  }
  b.think -= dt;
  if (!active) return far(w, p, b, dt);
  if (b.think > 0) return cmd;
  b.think = 0.15;
  const def = SURVIVORS[p.slot];
  cmd.mx = cmd.my = 0;
  cmd.attack = false;
  cmd.aimHeld = false;
  cmd.run = false;

  // necessidades: come/bebe/trata do inventário
  if (!p.action) selfCare(w, p);

  // ameaça
  let threat: Zombie | null = null;
  let td = Infinity;
  for (const z of w.zombies) {
    if (!z.alive) continue;
    const d = dist(z.x, z.y, p.x, p.y);
    if (d < td && d < 8 * TILE && w.map.los(p.x, p.y, z.x, z.y)) {
      td = d;
      threat = z;
    }
  }
  const wpn = p.weaponItem;
  const wd = wpn ? itemDef(wpn.defId).weapon : null;
  if (threat) {
    const brave = def.bot.aggression + (wd ? 0.3 : 0) - (p.health.hp < 40 ? 0.5 : 0);
    cmd.aimX = threat.x;
    cmd.aimY = threat.y;
    if (brave > 0.5 || td < 1.8 * TILE) {
      if (wd?.kind === 'gun' && (wpn!.state?.ammo ?? 0) > 0 && td > 2.2 * TILE) {
        cmd.aimHeld = true;
        cmd.attackPressed = p.attackCd <= 0;
        cmd.attack = true;
      } else if (wd?.kind === 'gun' && (wpn!.state?.ammo ?? 0) === 0 && p.inv.count(wd.ammo!) > 0 && !p.action) {
        startReload(w);
      } else if (td > (wd?.range ?? 14) + 6) {
        steer(cmd, p, threat.x, threat.y);
      } else {
        cmd.attackPressed = p.attackCd <= 0;
      }
      return cmd;
    }
    // recua
    steer(cmd, p, p.x - (threat.x - p.x), p.y - (threat.y - p.y));
    cmd.run = p.stamina > 20;
    return cmd;
  }

  // socorrer companheiro caído
  const down = w.players.find((o) => o !== p && o.alive && o.isDown && dist(o.x, o.y, p.x, p.y) < 15 * TILE);
  if (down) {
    if (dist(down.x, down.y, p.x, p.y) > 14) {
      followPath(w, p, b, down.x, down.y, 'socorro', cmd);
      cmd.run = true;
    } else reviveOther(w, p, down);
    return cmd;
  }

  // seguir o humano mais próximo (grupo), ou ir ao ponto de encontro
  const human = w.players.filter((o) => o !== p && !o.dead && o.controller === 'humano').sort((a, bb) => dist(a.x, a.y, p.x, p.y) - dist(bb.x, bb.y, p.x, p.y))[0];
  if (human && dist(human.x, human.y, p.x, p.y) < 30 * TILE) {
    const d = dist(human.x, human.y, p.x, p.y);
    if (d > 3 * TILE) {
      followPath(w, p, b, human.x, human.y, 'grupo', cmd);
      cmd.run = d > 8 * TILE && p.stamina > 30;
    }
    return cmd;
  }
  const goal = currentGoal(w, p, b);
  if (goal) followPath(w, p, b, goal.x, goal.y, goal.why, cmd);
  return cmd;
}

function steer(cmd: PlayerCommand, p: Player, x: number, y: number) {
  const dx = x - p.x;
  const dy = y - p.y;
  const d = Math.hypot(dx, dy) || 1;
  cmd.mx = dx / d;
  cmd.my = dy / d;
  cmd.aimX = x;
  cmd.aimY = y;
}

function followPath(w: World, p: Player, b: BotMem, gx: number, gy: number, why: string, cmd: PlayerCommand) {
  b.pathT -= 0.15;
  const key = `${why}:${Math.floor(gx / TILE / 3)},${Math.floor(gy / TILE / 3)}`;
  if (!b.path || b.pathGoal !== key || b.pathT <= 0) {
    b.path = w.pathfinder.find(Math.floor(p.x / TILE), Math.floor(p.y / TILE), Math.floor(gx / TILE), Math.floor(gy / TILE), allyCost(w), 6000);
    b.pathGoal = key;
    b.pathT = 3;
  }
  const path = b.path;
  if (!path || path.length === 0) {
    steer(cmd, p, gx, gy);
    return;
  }
  while (path.length > 1 && dist(path[0].x, path[0].y, p.x, p.y) < 6) path.shift();
  const n = path[0];
  steer(cmd, p, n.x, n.y);
  // portas fechadas no caminho: abre
  const door = w.map.doorAt(Math.floor(n.x / TILE), Math.floor(n.y / TILE));
  if (door && !door.open && !door.broken && dist(n.x, n.y, p.x, p.y) < 14) cmd.interact = true;
}

function selfCare(w: World, p: Player) {
  w.withPlayer(p, () => {
    if (p.health.bleeding) {
      const med = p.inv.items.find((i) => itemDef(i.defId).medical && itemDef(i.defId).medical!.kind !== 'painkiller' && itemDef(i.defId).medical!.kind !== 'antisseptico');
      if (med) return doPlayerItemAction(w, 'treat', med.uid);
    }
    if (p.thirst > 55) {
      const d = p.inv.items.find((i) => itemDef(i.defId).food?.verb === 'Beber' && (!itemDef(i.defId).water || (i.state?.uses ?? 0) > 0) && !i.state?.contaminated);
      if (d) return doPlayerItemAction(w, 'consume', d.uid);
    }
    if (p.hunger > 55) {
      const f = p.inv.items.find((i) => itemDef(i.defId).food && itemDef(i.defId).food!.verb !== 'Beber' && itemDef(i.defId).category === 'Comida');
      if (f) return doPlayerItemAction(w, 'consume', f.uid);
    }
    if (!p.weaponItem) {
      const wp = p.inv.items.find((i) => itemDef(i.defId).weapon);
      if (wp) return doPlayerItemAction(w, 'equip_arma', wp.uid);
    }
    const r = radioOf(p);
    if (r && (r.state?.battery ?? 0) <= 0 && p.inv.count('pilhas') > 0) return doPlayerItemAction(w, 'batteries', r.uid);
    if (r && !r.state?.on && (r.state?.battery ?? 0) > 0) return doPlayerItemAction(w, 'toggle', r.uid);
  });
}

/** Objetivo de longo prazo do bot (sem saber onde os outros estão, a não ser que digam). */
function currentGoal(w: World, p: Player, b: BotMem) {
  const ms = w.missions;
  if (ms && ms.chapter >= 4 && ms.rendezvous) return { x: ms.rendezvous.x * TILE, y: ms.rendezvous.y * TILE, why: `encontro ${ms.rendezvous.name}` };
  // capítulos iniciais: procurar rádio e equipamento na própria região
  const want = !radioOf(p) ? 'radio' : !p.weaponItem && !p.inv.items.some((i) => itemDef(i.defId).weapon) ? 'arma' : null;
  if (want && b.scavT <= 0) {
    const c = nearestContainerWith(w, p, want, 90);
    if (c) {
      b.goal = { x: (c.x + c.w / 2) * TILE, y: (c.y + c.h / 2) * TILE, why: `buscar ${want}` };
      if (dist(b.goal.x, b.goal.y, p.x, p.y) < 1.8 * TILE) {
        lootContainer(w, p, c);
        b.goal = null;
      }
      return b.goal;
    }
    b.scavT = 120;
  }
  return b.goal;
}

function nearestContainerWith(w: World, p: Player, want: 'radio' | 'arma', rangeTiles: number) {
  let best = null as null | { c: ReturnType<World['containers']['get']>; d: number };
  for (const c of w.containers.values()) {
    if (c.owner) continue;
    const d = dist((c.x + c.w / 2) * TILE, (c.y + c.h / 2) * TILE, p.x, p.y);
    if (d > rangeTiles * TILE || (best && d >= best.d)) continue;
    const ok = c.inv.items.some((i) => (want === 'radio' ? !!itemDef(i.defId).radio : !!itemDef(i.defId).weapon));
    if (ok) best = { c, d };
  }
  return best?.c ?? null;
}

function lootContainer(w: World, p: Player, c: NonNullable<ReturnType<World['containers']['get']>>) {
  c.searched = true;
  for (const it of [...c.inv.items]) {
    const d = itemDef(it.defId);
    const useful = d.radio || d.weapon || d.food || d.medical || d.water || it.defId === 'pilhas' || d.category === 'Munição' || d.backpack;
    if (!useful || !p.inv.canAdd(it).ok) continue;
    c.inv.remove(it.uid);
    p.inv.add(it);
  }
  p.validateEquipment();
  selfCare(w, p);
}

/** Modo econômico: sem física; avança no caminho a passo de caminhada e cuida de si. */
function far(w: World, p: Player, b: BotMem, dt: number): PlayerCommand {
  const cmd = b.cmd;
  cmd.mx = cmd.my = 0;
  cmd.attack = false;
  b.scavT -= dt;
  if (b.think > 0) return cmd;
  b.think = 1;
  selfCare(w, p);
  const goal = currentGoal(w, p, b);
  if (!goal) return cmd;
  if (!b.path || !b.pathGoal.startsWith(goal.why)) {
    b.path = w.pathfinder.find(Math.floor(p.x / TILE), Math.floor(p.y / TILE), Math.floor(goal.x / TILE), Math.floor(goal.y / TILE), allyCost(w), 60000);
    b.pathGoal = goal.why;
  }
  // anda ~1 s de caminhada por pensamento (sem colisão com entidades: ninguém está vendo)
  let budget = 50;
  while (b.path && b.path.length && budget > 0) {
    const n = b.path[0];
    const d = dist(n.x, n.y, p.x, p.y);
    if (d <= budget) {
      p.x = n.x;
      p.y = n.y;
      budget -= d;
      b.path.shift();
      const door = w.map.doorAt(Math.floor(n.x / TILE), Math.floor(n.y / TILE));
      if (door && !door.open && !door.broken && !door.locked) door.open = true;
    } else {
      p.x += ((n.x - p.x) / d) * budget;
      p.y += ((n.y - p.y) / d) * budget;
      budget = 0;
    }
  }
  return cmd;
}

/** Bot (ou humano) socorre um companheiro incapacitado usando material médico do próprio inventário. */
export function reviveOther(w: World, helper: Player, target: Player): boolean {
  if (!target.isDown || target.dead || helper.action) return false;
  const med = helper.inv.items.find((i) => itemDef(i.defId).medical && itemDef(i.defId).medical!.kind !== 'painkiller' && itemDef(i.defId).medical!.kind !== 'antisseptico');
  if (!med) {
    w.withPlayer(helper, () => w.msg('Sem bandagem ou kit para socorrer.', 'warn'));
    return false;
  }
  helper.action = {
    kind: 'search',
    label: `Socorrendo ${target.name}`,
    t: 0,
    dur: 4,
    allowMove: false,
    onDone: () => {
      if (!target.isDown) return;
      const cur = helper.inv.get(med.uid);
      if (!cur) return;
      if (cur.state?.uses && cur.state.uses > 1) cur.state.uses--;
      else helper.inv.remove(cur.uid, 1);
      target.health.revive(30);
      w.withPlayer(target, () => w.msg(`${helper.name} estancou seu sangramento e te levantou.`, 'good'));
      w.withPlayer(helper, () => w.msg(`Você socorreu ${target.name}.`, 'good'));
      w.events.emit('inventoryChanged', {});
    },
  };
  return true;
}

/** Bots respondem ao rádio e à fala local com informações verbais (sem coordenadas). */
export function installBotChat(w: World) {
  w.events.on('radio', (msg) => {
    const bot = w.playerById(msg.to);
    if (!bot || bot.controller !== 'ia' || bot.dead) return;
    const from = w.players.find((p) => p.name === msg.from);
    if (!from) return;
    const b = m(bot);
    if (w.time - b.lastRadio < 20) return;
    b.lastRadio = w.time;
    const first = bot.name.split(' ')[0];
    const where = describePlace(w, bot.x, bot.y);
    const rv = w.missions?.rendezvous;
    const text = rv ? `Entendido. Vou para ${rv.name}. Agora estou ${where}.` : `Aqui é ${first}! Graças a Deus. Estou ${where}. Diga um lugar e eu vou até lá.`;
    w.radio?.botReply(bot, from, text);
    bot.contacts.add(from.id);
    from.contacts.add(bot.id);
  });
  w.events.on('localSpeech', ({ from, text }) => {
    const sp = w.playerById(from);
    if (!sp) return;
    for (const bot of w.players) {
      if (bot === sp || bot.controller !== 'ia' || bot.dead || dist(bot.x, bot.y, sp.x, sp.y) > CONFIG.radio.talkRangeTiles * TILE) continue;
      const b = m(bot);
      if (w.time - b.lastRadio < 8) continue;
      b.lastRadio = w.time;
      w.missions?.onEvent('radio_texto', { text });
      speak(w, bot, /ajuda|socorro/i.test(text) ? 'Tô indo!' : 'Tô contigo. Vamos.');
    }
  });
}
