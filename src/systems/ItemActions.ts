import { createItem, itemDef, ItemInstance } from '../data/items';
import { formatKg } from '../engine/math';
import { EquipSlot, Player } from '../entities/Player';
import { TILE } from '../config';
import type { World } from '../world/World';
import type { Container } from '../world/types';
import { WOUND_LABEL } from './Health';
import { Inventory } from './Inventory';

export interface ItemAction {
  id: string;
  label: string;
  enabled: boolean;
  reason?: string;
  primary?: boolean;
}

/** Ações disponíveis para um item do inventário do jogador. */
export function playerItemActions(world: World, it: ItemInstance): ItemAction[] {
  const p = world.player;
  const d = itemDef(it.defId);
  const out: ItemAction[] = [];
  const busy = !!p.action || p.isDown;
  const eq = p.isEquipped(it.uid);

  if (d.food) {
    const edible = d.food.edible !== false;
    out.push({ id: 'consume', label: d.food.verb, enabled: edible && !busy, reason: edible ? undefined : 'Precisa ser cozido.', primary: true });
  }
  if (d.medical) {
    if (d.medical.kind === 'painkiller') {
      out.push({ id: 'painkiller', label: 'Tomar', enabled: !busy, primary: true });
    } else {
      const w = p.health.worstUntreated();
      out.push({ id: 'treat', label: 'Tratar ferimento', enabled: !!w && !busy, reason: w ? undefined : 'Nenhum ferimento sem tratamento.', primary: true });
    }
  }
  if (d.weapon) {
    if (eq === 'arma') out.push({ id: 'unequip', label: 'Desequipar', enabled: !busy });
    else out.push({ id: 'equip_arma', label: 'Equipar', enabled: !busy, primary: true });
    if (d.weapon.kind === 'gun') {
      const ammo = p.inv.count(d.weapon.ammo!);
      const full = (it.state?.ammo ?? 0) >= (d.weapon.magazine ?? 0);
      out.push({ id: 'reload', label: 'Recarregar', enabled: !busy && ammo > 0 && !full, reason: ammo === 0 ? 'Sem munição no inventário.' : full ? 'Carregador cheio.' : undefined });
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
  out.push({ id: 'drop', label: 'Descartar', enabled: !busy });
  return out;
}

export function containerItemActions(world: World, c: Container, it: ItemInstance): ItemAction[] {
  const check = world.player.inv.canAdd(it);
  return [
    { id: 'take', label: 'Pegar', enabled: check.ok && !world.player.isDown, reason: check.reason, primary: true },
    { id: 'examine', label: 'Examinar', enabled: true },
  ];
}

export function describeItem(it: ItemInstance): string {
  const d = itemDef(it.defId);
  const parts = [d.desc];
  if (d.durability && it.condition !== undefined) parts.push(`Condição: ${Math.round((it.condition / d.durability) * 100)}%.`);
  if (d.weapon?.kind === 'gun') parts.push(`Carregador: ${it.state?.ammo ?? 0}/${d.weapon.magazine}.`);
  if (d.food?.uses) parts.push(`Restante: ${it.state?.uses ?? 0}/${d.food.uses}.`);
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
  const extra = itemDef(bag.defId).backpack!;
  const w = p.inv.weight() - (p.openContainer ? 0 : 0);
  return w <= p.inv.baseWeight + 1e-6 && p.inv.items.length <= p.inv.baseSlots;
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

  switch (actionId) {
    case 'consume': {
      const f = d.food!;
      startAction(world, 'consume', f.verb === 'Beber' ? 'Bebendo' : 'Comendo', f.verb === 'Beber' ? 0.9 : 1.4, () => {
        const cur = p.inv.get(uid);
        if (!cur) return;
        p.hunger = Math.max(0, Math.min(100, p.hunger - (f.hunger ?? 0)));
        p.thirst = Math.max(0, Math.min(100, p.thirst - (f.thirst ?? 0)));
        world.sound(f.verb === 'Beber' ? 'drink' : 'eat', p.x, p.y, 0.6);
        world.msg(`Você ${f.verb === 'Beber' ? 'bebeu' : 'comeu'}: ${d.name.toLowerCase()}.`, 'good');
        consumeUse(p, cur);
        changed();
      });
      break;
    }
    case 'treat': {
      const m = d.medical!;
      const w = p.health.worstUntreated();
      if (!w) return;
      startAction(world, 'treat', d.id === 'kit_medico' ? 'Usando kit médico' : 'Fazendo curativo', m.time, () => {
        const cur = p.inv.get(uid);
        if (!cur || !p.health.wounds.includes(w)) return;
        p.health.treat(w, m.quality);
        if (m.kind === 'kit') p.health.hp = Math.min(p.health.max, p.health.hp + 6);
        world.sound('cloth', p.x, p.y, 0.6);
        const stopped = w.bleed === 0;
        world.msg(
          `${WOUND_LABEL[w.type]} ${w.type === 'arranhao' ? 'tratado' : 'tratada'}. ${stopped ? 'O sangramento parou.' : 'O sangramento diminuiu, mas continua.'}` +
            (w.type === 'mordida' ? ' A mordida, porém, continua infeccionada.' : ''),
          stopped ? 'good' : 'warn',
        );
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
      world.msg(`${d.name}: ${describeItem(it)}`);
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
      break;
    }
    case 'drop': {
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
  if (fail) world.msg(fail, 'warn');
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
    world.msg('Sem munição para recarregar.', 'warn');
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
