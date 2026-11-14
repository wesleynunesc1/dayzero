import { CONFIG, TILE } from '../config';
import { createItem, freshness, itemDef, ItemInstance } from '../data/items';
import { formatKg } from '../engine/math';
import { EquipSlot, Player } from '../entities/Player';
import type { World } from '../world/World';
import type { Container } from '../world/types';
import { WOUND_LABEL, WOUND_SEVERITY } from './Health';
import { findEntrance, installBarricade, nearestSiphonCar, nearestVehicle } from './Interaction';
import { Inventory } from './Inventory';

export interface ItemAction {
  id: string;
  label: string;
  enabled: boolean;
  reason?: string;
  primary?: boolean;
}

type TreatKind = 'kit' | 'bandage' | 'improvised' | 'rag' | 'curativo' | 'antisseptico';

const lit = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

/** Ações disponíveis para um item do inventário do jogador. */
export function playerItemActions(world: World, it: ItemInstance): ItemAction[] {
  const p = world.player;
  const d = itemDef(it.defId);
  const out: ItemAction[] = [];
  const busy = !!p.action || p.isDown || !!p.sleep;
  const eq = p.isEquipped(it.uid);

  if (d.water) {
    const uses = it.state?.uses ?? 0;
    out.push({ id: 'consume', label: 'Beber', enabled: uses > 0 && !busy, reason: uses > 0 ? undefined : 'Recipiente vazio.', primary: true });
    if (uses > 0) out.push({ id: 'empty', label: 'Esvaziar', enabled: !busy });
  } else if (d.food) {
    const edible = d.food.edible !== false;
    out.push({ id: 'consume', label: d.food.verb, enabled: edible && !busy, reason: edible ? undefined : 'Precisa ser cozido no fogo (aba Fabricar).', primary: true });
  }
  if (d.medical) {
    if (d.medical.kind === 'painkiller') {
      out.push({ id: 'painkiller', label: 'Tomar', enabled: !busy, primary: true });
    } else {
      const kind = d.medical.kind as TreatKind;
      const block = p.health.treatBlocker(kind);
      out.push({ id: 'treat', label: kind === 'antisseptico' ? 'Limpar ferimento' : 'Tratar ferimento', enabled: !block && !busy, reason: block ?? undefined, primary: true });
    }
  }
  if (d.weapon) {
    if (eq === 'arma') out.push({ id: 'unequip', label: 'Desequipar', enabled: !busy });
    else out.push({ id: 'equip_arma', label: 'Equipar', enabled: !busy, primary: true });
    if (d.weapon.kind === 'gun') {
      const ammo = p.inv.count(d.weapon.ammo!);
      const full = (it.state?.ammo ?? 0) >= (d.weapon.magazine ?? 0);
      out.push({ id: 'reload', label: 'Recarregar', enabled: !busy && ammo > 0 && !full && eq === 'arma', reason: eq !== 'arma' ? 'Equipe a arma primeiro.' : ammo === 0 ? 'Sem munição compatível no inventário.' : full ? 'Carregador cheio.' : undefined });
      if ((it.state?.ammo ?? 0) > 0) out.push({ id: 'unload', label: 'Descarregar', enabled: !busy });
    }
  }
  if (d.wear) {
    out.push(eq === 'corpo' ? { id: 'unequip', label: 'Tirar', enabled: !busy } : { id: 'equip_corpo', label: 'Vestir', enabled: !busy, primary: !d.tearable });
  }
  if (d.backpack) {
    out.push(eq === 'costas' ? { id: 'unequip', label: 'Tirar mochila', enabled: !busy } : { id: 'equip_costas', label: 'Equipar', enabled: !busy, primary: true });
  }
  if (d.light) {
    out.push({ id: 'toggle', label: it.state?.on ? 'Desligar' : 'Ligar', enabled: (it.state?.battery ?? 0) > 0, reason: 'Sem bateria.', primary: true });
    out.push({ id: 'batteries', label: 'Trocar pilhas', enabled: p.inv.count('pilhas') > 0 && !busy, reason: 'Sem pilhas.' });
  }
  if (d.radio) {
    out.push({ id: 'toggle', label: it.state?.on ? 'Desligar' : 'Ligar', enabled: (it.state?.battery ?? 0) > 0, reason: 'Sem bateria.', primary: true });
    out.push({ id: 'tune', label: 'Sintonizar', enabled: !!it.state?.on, reason: 'Rádio desligado.' });
    out.push({ id: 'batteries', label: 'Trocar pilhas', enabled: p.inv.count('pilhas') > 0 && !busy, reason: 'Sem pilhas.' });
  }
  if (d.fuelCan) {
    const fuel = it.state?.fuel ?? 0;
    const v = nearestVehicle(world);
    const car = nearestSiphonCar(world);
    out.push({
      id: 'refuel',
      label: 'Abastecer veículo próximo',
      enabled: !busy && fuel > 0 && !!v && v.fuel < v.def.fuelCapacity - 0.05,
      reason: fuel <= 0 ? 'Galão vazio.' : !v ? 'Chegue perto da caminhonete.' : 'Tanque cheio.',
      primary: true,
    });
    out.push({
      id: 'siphon',
      label: 'Retirar gasolina de carro abandonado',
      enabled: !busy && fuel < d.fuelCan.capacity - 0.05 && !!car && (car.fuel ?? 0) > 0 && p.inv.count('mangueira') > 0,
      reason: p.inv.count('mangueira') === 0 ? 'Precisa de uma mangueira de sifão.' : !car ? 'Chegue perto de um carro abandonado.' : (car.fuel ?? 0) <= 0 ? 'O tanque desse carro está seco.' : 'Galão cheio.',
    });
  }
  if (it.defId === 'barricada') {
    const e = findEntrance(world);
    out.push({ id: 'barricade', label: 'Instalar na entrada à frente', enabled: !busy && !!e && p.inv.count('martelo') > 0, reason: p.inv.count('martelo') === 0 ? 'Precisa de um martelo.' : 'Fique de frente para uma porta fechada ou janela.', primary: true });
  }
  if (d.map) {
    out.push({ id: 'read_map', label: 'Ver mapa', enabled: true, primary: true });
    if (d.map === 'fragmento' || d.map === 'rasgado') {
      const other = d.map === 'fragmento' ? 'mapa_rasgado' : 'fragmento_mapa';
      out.push({ id: 'combine_map', label: 'Combinar fragmento', enabled: p.inv.count(other) > 0 && !busy, reason: d.map === 'fragmento' ? 'Você não tem o mapa principal.' : 'Você não tem o fragmento.' });
    }
  }
  if (d.tearable) out.push({ id: 'tear', label: 'Rasgar em tiras', enabled: !busy && !eq });
  out.push({ id: 'examine', label: 'Examinar', enabled: true });
  if (p.openContainer) out.push({ id: 'store', label: 'Guardar', enabled: !busy });
  out.push({ id: 'drop', label: 'Descartar', enabled: !busy && !p.vehicleId, reason: 'Saia do veículo para largar itens.' });
  return out;
}

export function containerItemActions(world: World, c: Container, it: ItemInstance): ItemAction[] {
  const check = world.player.inv.canAdd(it);
  return [
    { id: 'take', label: 'Pegar', enabled: check.ok && !world.player.isDown, reason: check.reason, primary: true },
    { id: 'examine', label: 'Examinar', enabled: true },
  ];
}

const FRESH_LABEL = { fresco: 'Fresco', passado: 'Passado (rende menos)', estragado: 'Estragado (pode causar mal-estar)' };

export function describeItem(it: ItemInstance, now = 0): string {
  const d = itemDef(it.defId);
  const parts = [d.desc];
  if (d.durability && it.condition !== undefined) parts.push(`Condição: ${Math.round((it.condition / d.durability) * 100)}%.`);
  if (d.weapon && d.weapon.kind !== 'unarmed') {
    const w = d.weapon;
    const rate = (60 / w.cooldown).toFixed(0);
    parts.push(`Dano ${w.damage} · alcance ${w.kind === 'gun' ? `${Math.round(w.range / TILE)} m` : `${w.range} px`} · cadência ${rate}/min · ruído ${w.noise} m.`);
  }
  if (d.weapon?.kind === 'gun') parts.push(`Carregador: ${it.state?.ammo ?? 0}/${d.weapon.magazine} (${itemDef(d.weapon.ammo!).name}).`);
  if (d.water) parts.push(`Conteúdo: ${lit((it.state?.uses ?? 0) * 0.25)} L de ${lit(d.water.capacity * 0.25)} L${(it.state?.uses ?? 0) > 0 ? (it.state?.contaminated ? ' — água NÃO tratada' : ' — água potável') : ''}.`);
  if (d.fuelCan) parts.push(`Gasolina: ${lit(it.state?.fuel ?? 0)} L de ${d.fuelCan.capacity} L.`);
  if (d.food?.kcal) parts.push(`Valor nutricional: ~${d.food.kcal} kcal.`);
  const fr = freshness(it, now);
  if (fr) parts.push(`Conservação: ${FRESH_LABEL[fr]}.`);
  if (d.medical && d.medical.uses > 1) parts.push(`Usos: ${it.state?.uses ?? d.medical.uses}.`);
  if (d.light) parts.push(`Estado: ${it.state?.on ? 'ligada' : 'desligada'}. Bateria: ${Math.round(it.state?.battery ?? 0)}%.`);
  if (d.radio)
    parts.push(
      `Estado: ${it.state?.on ? 'ligado' : 'desligado'}. Bateria: ${Math.round(it.state?.battery ?? 0)}%. Frequência: ${(it.state?.freq ?? 104.5).toLocaleString('pt-BR', { minimumFractionDigits: 1 })} MHz. ` +
        'Sem outros sobreviventes na escuta, por enquanto.',
    );
  if (d.backpack) parts.push(`Capacidade extra: +${formatKg(d.backpack.weight)} kg, +${d.backpack.slots} espaços.`);
  if (d.wear && (d.wear.armor > 0 || d.wear.biteProtect > 0)) parts.push(`Proteção: ${Math.round(d.wear.armor * 100)}% contra golpes, ${Math.round(d.wear.biteProtect * 100)}% contra mordidas.`);
  return parts.join(' ');
}

function startAction(world: World, kind: string, label: string, dur: number, onDone: () => void, allowMove = false) {
  const p = world.player;
  if (p.action) return;
  p.action = { kind, label, t: 0, dur, allowMove, onDone };
}

function consumeUse(p: Player, it: ItemInstance) {
  if (it.state?.uses !== undefined) {
    it.state.uses--;
    if (it.state.uses <= 0) p.inv.remove(it.uid);
  } else if (it.qty > 1) it.qty--;
  else p.inv.remove(it.uid);
  p.validateEquipment();
}

export function canDropBag(p: Player, uid: string): boolean {
  if (p.equipped.costas !== uid) return true;
  const bag = p.inv.get(uid);
  if (!bag) return true;
  return p.inv.weight() <= p.inv.baseWeight + 1e-6 && p.inv.items.length <= p.inv.baseSlots;
}

/** Pilha de itens no chão próxima ao jogador (cria se não existir). */
function groundPile(world: World): Container {
  const p = world.player;
  const near = world.corpses.find((c) => c.pile && Math.hypot(c.x - p.x, c.y - p.y) < 14);
  if (near) return near.container;
  const c = world.createCorpse(p.x, p.y, 0, p.look, 'Itens no chão', [], false, false);
  c.pile = true;
  c.container.searched = true;
  return c.container;
}

export function doPlayerItemAction(world: World, actionId: string, uid: string): void {
  const p = world.player;
  const it = p.inv.get(uid);
  if (!it) return;
  const d = itemDef(it.defId);
  const changed = () => world.events.emit('inventoryChanged', {});
  const N = CONFIG.needs;

  switch (actionId) {
    case 'consume': {
      const f = d.food!;
      const drink = f.verb === 'Beber';
      startAction(world, 'consume', drink ? 'Bebendo' : 'Comendo', drink ? 0.9 : 1.4, () => {
        const cur = p.inv.get(uid);
        if (!cur) return;
        if (d.water && (cur.state?.uses ?? 0) <= 0) return;
        let mul = 1;
        let sick = false;
        const fr = freshness(cur, world.gameMinutes);
        if (fr === 'passado') mul = 0.7;
        if (fr === 'estragado') {
          mul = 0.4;
          if (world.rng.chance(N.rottenSickChance)) sick = true;
        }
        if (d.water && cur.state?.contaminated && world.rng.chance(N.dirtyWaterSickChance)) sick = true;
        p.hunger = Math.max(0, Math.min(100, p.hunger - (f.hunger ?? 0) * mul));
        p.thirst = Math.max(0, Math.min(100, p.thirst - (f.thirst ?? 0) * (d.water ? 1 : mul)));
        world.sound(drink ? 'drink' : 'eat', p.x, p.y, 0.6);
        let txt = drink ? `Você bebeu: ${d.water ? '250 ml de água' : d.name.toLowerCase()}.` : `Você comeu: ${d.name.toLowerCase()}.`;
        if (fr === 'passado') txt += ' Não estava tão bom.';
        if (fr === 'estragado') txt += ' Tinha um gosto horrível.';
        world.msg(txt, fr === 'estragado' ? 'warn' : 'good');
        if (sick) {
          p.sickHours = Math.max(p.sickHours, N.sickHours);
          world.msg('Você sente náusea. Seu corpo vai sofrer por algumas horas.', 'danger');
        }
        if (d.water) {
          cur.state!.uses = (cur.state!.uses ?? 1) - 1;
          if (cur.state!.uses <= 0) cur.state!.contaminated = false;
        } else consumeUse(p, cur);
        changed();
      });
      break;
    }
    case 'empty':
      if (it.state) {
        it.state.uses = 0;
        it.state.contaminated = false;
        world.msg(`Você esvaziou: ${d.name.toLowerCase()}.`);
        changed();
      }
      break;
    case 'treat': {
      const m = d.medical!;
      const kind = m.kind as TreatKind;
      const w = p.health.bestTarget(kind);
      if (!w) return;
      const label = kind === 'kit' ? 'Usando kit de primeiros socorros' : kind === 'antisseptico' ? 'Limpando ferimento' : 'Fazendo curativo';
      startAction(world, 'treat', label, m.time, () => {
        const cur = p.inv.get(uid);
        if (!cur || !p.health.wounds.includes(w)) return;
        p.health.treat(w, kind, m.quality);
        if (kind === 'kit') p.health.hp = Math.min(p.health.max, p.health.hp + 6);
        world.sound('cloth', p.x, p.y, 0.6);
        const name = WOUND_LABEL[w.type];
        const art = w.type === 'arranhao' ? 'o' : 'a';
        if (kind === 'antisseptico') world.msg(`${name} limp${art}. Agora pode cicatrizar.`, 'good');
        else {
          const stopped = w.bleed === 0;
          let txt = `${name} (${WOUND_SEVERITY[w.type]}) tratad${art}. ${stopped ? 'O sangramento parou.' : 'O sangramento diminuiu, mas continua.'}`;
          if (w.dirty) txt += ' Material não estéril: limpe com antisséptico ou o ferimento pode infeccionar.';
          world.msg(txt, stopped ? 'good' : 'warn');
        }
        consumeUse(p, cur);
        changed();
      });
      break;
    }
    case 'painkiller': {
      startAction(world, 'pill', 'Tomando analgésico', 1, () => {
        const cur = p.inv.get(uid);
        if (!cur) return;
        p.health.painkiller = 90;
        world.msg('A dor diminui um pouco.', 'good');
        consumeUse(p, cur);
        changed();
      });
      break;
    }
    case 'equip_arma':
      p.equipped.arma = uid;
      world.sound('cloth', p.x, p.y, 0.4);
      world.msg(`Equipado: ${d.name}.`);
      changed();
      break;
    case 'equip_corpo':
      p.equipped.corpo = uid;
      world.sound('cloth', p.x, p.y, 0.5);
      world.msg(`Você vestiu: ${d.name.toLowerCase()}.`);
      changed();
      break;
    case 'equip_costas':
      p.equipped.costas = uid;
      p.refreshCapacity();
      world.sound('cloth', p.x, p.y, 0.5);
      world.msg(`Mochila equipada. Capacidade: ${formatKg(p.inv.maxWeight)} kg.`);
      changed();
      break;
    case 'unequip': {
      const slot = p.isEquipped(uid);
      if (!slot) return;
      if (slot === 'costas' && !canDropBag(p, uid)) {
        world.msg('Você não consegue carregar tudo sem a mochila.', 'warn');
        return;
      }
      p.equipped[slot] = null;
      p.refreshCapacity();
      changed();
      break;
    }
    case 'reload':
      startReload(world);
      break;
    case 'unload': {
      const w = d.weapon!;
      const n = it.state?.ammo ?? 0;
      const ammo = createItem(w.ammo!, n);
      const r = p.inv.add(ammo);
      if (!r.ok) {
        world.msg(r.reason ?? 'Sem espaço para a munição.', 'warn');
        return;
      }
      it.state!.ammo = 0;
      world.sound('reload', p.x, p.y, 0.4);
      world.msg(`Você retirou ${n} cartucho(s).`);
      changed();
      break;
    }
    case 'toggle': {
      if (!it.state) return;
      if (!it.state.on && (it.state.battery ?? 0) <= 0) {
        world.msg('Sem bateria.', 'warn');
        return;
      }
      it.state.on = !it.state.on;
      world.sound('pickup', p.x, p.y, 0.4);
      if (d.radio) world.msg(it.state.on ? 'O rádio chia. Somente estática.' : 'Rádio desligado.');
      else world.msg(it.state.on ? 'Lanterna ligada.' : 'Lanterna desligada.');
      changed();
      break;
    }
    case 'tune': {
      if (!it.state) return;
      const freqs = [88.1, 92.7, 96.3, 101.9, 104.5, 107.9];
      const i = freqs.indexOf(it.state.freq ?? 104.5);
      it.state.freq = freqs[(i + 1) % freqs.length];
      world.msg(`Sintonizado em ${it.state.freq.toLocaleString('pt-BR', { minimumFractionDigits: 1 })} MHz. Somente estática.`);
      changed();
      break;
    }
    case 'batteries':
      startAction(world, 'batteries', 'Trocando pilhas', 1.2, () => {
        const cur = p.inv.get(uid);
        if (!cur || p.inv.take('pilhas', 1) < 1) return;
        cur.state = { ...cur.state, battery: 100 };
        world.msg(`Pilhas novas em: ${d.name.toLowerCase()}.`, 'good');
        changed();
      });
      break;
    case 'refuel': {
      const v = nearestVehicle(world);
      if (!v) return;
      const amount = Math.min(it.state?.fuel ?? 0, v.def.fuelCapacity - v.fuel);
      if (amount <= 0) return;
      startAction(world, 'refuel', `Abastecendo a ${v.def.name.toLowerCase()}`, 1 + amount * 0.4, () => {
        const cur = p.inv.get(uid);
        if (!cur) return;
        const n = Math.min(cur.state?.fuel ?? 0, v.def.fuelCapacity - v.fuel);
        cur.state!.fuel = (cur.state!.fuel ?? 0) - n;
        v.fuel += n;
        world.sound('drink', p.x, p.y, 0.5);
        world.msg(`Você colocou ${lit(n)} L de gasolina. Tanque: ${lit(v.fuel)} / ${v.def.fuelCapacity} L.`, 'good');
        changed();
        world.events.emit('requestSave', {});
      });
      break;
    }
    case 'siphon': {
      const car = nearestSiphonCar(world);
      if (!car || !d.fuelCan) return;
      const room = d.fuelCan.capacity - (it.state?.fuel ?? 0);
      const amount = Math.min(car.fuel ?? 0, room);
      if (amount <= 0) return;
      // peso extra da gasolina
      if (p.inv.weight() + amount * 0.75 > p.inv.maxWeight + 1e-6) {
        world.msg('Com essa gasolina o galão ficaria pesado demais para você carregar.', 'warn');
        return;
      }
      world.makeNoise(p.x, p.y, 2, 'sifao', true, p.id);
      startAction(world, 'siphon', 'Retirando gasolina com a mangueira', 2 + amount * 0.6, () => {
        const cur = p.inv.get(uid);
        if (!cur) return;
        const n = Math.min(car.fuel ?? 0, d.fuelCan!.capacity - (cur.state?.fuel ?? 0));
        car.fuel = Math.max(0, (car.fuel ?? 0) - n);
        cur.state!.fuel = (cur.state!.fuel ?? 0) + n;
        world.msg(`Você retirou ${lit(n)} L de gasolina. Galão: ${lit(cur.state!.fuel)} L.`, 'good');
        changed();
      });
      break;
    }
    case 'barricade':
      installBarricade(world);
      break;
    case 'read_map':
      world.events.emit('openMap', {});
      break;
    case 'combine_map':
      startAction(world, 'combine', 'Juntando os pedaços do mapa', 1.6, () => {
        if (p.inv.count('mapa_rasgado') < 1 || p.inv.count('fragmento_mapa') < 1) return;
        p.inv.take('mapa_rasgado', 1);
        p.inv.take('fragmento_mapa', 1);
        p.inv.add(createItem('mapa_completo'));
        world.sound('cloth', p.x, p.y, 0.5);
        world.msg('Você remendou o mapa com o fragmento. A parte leste agora está completa.', 'good');
        changed();
      });
      break;
    case 'tear':
      startAction(world, 'tear', 'Rasgando roupa', 2, () => {
        const cur = p.inv.get(uid);
        if (!cur) return;
        p.inv.remove(uid, 1);
        const rags = createItem('tiras_pano', d.tearable ?? 2);
        const r = p.inv.add(rags);
        if (!r.ok) dropToGround(world, rags);
        world.sound('cloth', p.x, p.y, 0.7);
        world.msg(`Você rasgou ${d.name.toLowerCase()} em ${d.tearable} tiras de pano.`);
        changed();
      });
      break;
    case 'examine':
      world.msg(`${d.name}: ${describeItem(it, world.gameMinutes)}`);
      break;
    case 'store': {
      const c = p.openContainer ? world.getContainer(p.openContainer) : undefined;
      if (!c) return;
      const slot = p.isEquipped(uid);
      if (slot === 'costas' && !canDropBag(p, uid)) {
        world.msg('Você não consegue carregar tudo sem a mochila.', 'warn');
        return;
      }
      if (slot) p.equipped[slot] = null;
      const r = Inventory.transfer(p.inv, c.inv, uid);
      if (!r.ok) {
        if (slot) p.equipped[slot] = uid;
        world.msg(r.reason ?? 'Não cabe.', 'warn');
      } else world.sound('container', p.x, p.y, 0.4);
      p.validateEquipment();
      changed();
      if (r.ok) world.events.emit('requestSave', {});
      break;
    }
    case 'drop': {
      if (p.vehicleId) return;
      const slot = p.isEquipped(uid);
      if (slot === 'costas' && !canDropBag(p, uid)) {
        world.msg('Você não consegue carregar tudo sem a mochila.', 'warn');
        return;
      }
      if (slot) p.equipped[slot] = null;
      const part = p.inv.remove(uid);
      if (part) dropToGround(world, part);
      p.validateEquipment();
      world.msg(`Você largou: ${d.name.toLowerCase()}.`);
      changed();
      break;
    }
  }
}

export function dropToGround(world: World, it: ItemInstance) {
  const pile = groundPile(world);
  pile.inv.items.push(it);
}

export function takeFromContainer(world: World, c: Container, uid: string, qty?: number) {
  const p = world.player;
  const r = Inventory.transfer(c.inv, p.inv, uid, qty);
  if (!r.ok) world.msg(r.reason ?? 'Não foi possível pegar.', 'warn');
  else world.sound('pickup', p.x, p.y, 0.5);
  world.events.emit('inventoryChanged', {});
  return r;
}

export function takeAll(world: World, c: Container) {
  const p = world.player;
  let any = false;
  let fail: string | undefined;
  for (const it of c.inv.items.slice()) {
    const r = Inventory.transfer(c.inv, p.inv, it.uid);
    if (r.ok) any = true;
    else fail = r.reason;
  }
  if (any) world.sound('pickup', p.x, p.y, 0.5);
  if (fail) world.msg(`Nem tudo coube: ${fail.toLowerCase()}`, 'warn');
  world.events.emit('inventoryChanged', {});
}

export function startReload(world: World) {
  const p = world.player;
  const it = p.weaponItem;
  const w = p.weapon;
  if (!it || w.kind !== 'gun') {
    world.msg('Nenhuma arma de fogo equipada.');
    return;
  }
  const loaded = it.state?.ammo ?? 0;
  if (loaded >= (w.magazine ?? 0)) {
    world.msg('O carregador já está cheio.');
    return;
  }
  if (p.inv.count(w.ammo!) <= 0) {
    world.msg(`Sem ${itemDef(w.ammo!).name.toLowerCase()} para recarregar.`, 'warn');
    return;
  }
  world.sound('reload', p.x, p.y, 0.7);
  p.action = {
    kind: 'reload',
    label: 'Recarregando',
    t: 0,
    dur: w.reloadTime ?? 1.5,
    allowMove: true,
    onDone: () => {
      const cur = p.weaponItem;
      if (!cur) return;
      const need = (w.magazine ?? 0) - (cur.state?.ammo ?? 0);
      const got = p.inv.take(w.ammo!, need);
      cur.state = { ...cur.state, ammo: (cur.state?.ammo ?? 0) + got };
      world.msg(`Arma recarregada (${cur.state.ammo}/${w.magazine}).`);
      world.events.emit('inventoryChanged', {});
    },
  };
}

/** Tile em pixels do centro (utilitário). */
export const tileCenter = (t: number) => t * TILE + TILE / 2;

export type { EquipSlot };
