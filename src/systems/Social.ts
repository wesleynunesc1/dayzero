import { CONFIG, TILE } from '../config';
import { createItem, itemDef } from '../data/items';
import type { Actor } from '../entities/Actor';
import { Emotion, EMOTIONS, MemoryKind, Npc } from '../entities/Npc';
import { Player } from '../entities/Player';
import type { World } from '../world/World';
import { changeRep, isHostileTo, rep, repLabel } from './Factions';

/**
 * Sistema social: memória, emoções e relações dos NPCs.
 * Toda mudança de relação nasce de um evento registrado na memória (tabela EFFECTS);
 * nada muda ao acaso. As decisões usam apenas estado e contexto (sem modelos externos).
 */

type Effect = { conf?: number; afeto?: number; medo?: number; ress?: number; emo?: Partial<Record<Emotion, number>>; rep?: number };

const EFFECTS: Record<MemoryKind, Effect> = {
  conheceu: { emo: { esperanca: 3 } },
  conversou: { conf: 2, afeto: 1 },
  pediu_ajuda: { emo: { esperanca: 6 } },
  ajudou: { conf: 25, afeto: 20, ress: -30, emo: { felicidade: 15, esperanca: 12, confianca: 15, desconfianca: -12 }, rep: CONFIG.factions.helpRep },
  ignorou_pedido: { conf: -18, afeto: -12, ress: 35, emo: { raiva: 12, tristeza: 10, desconfianca: 15, esperanca: -8 }, rep: -5 },
  presenteou: { conf: 10, afeto: 12, ress: -10, emo: { felicidade: 10, confianca: 6 }, rep: 4 },
  trocou: { conf: 4, afeto: 2, rep: CONFIG.factions.tradeRep },
  atacou: { conf: -45, afeto: -35, medo: 25, ress: 40, emo: { raiva: 30, medo: 20, desconfianca: 30, confianca: -20 }, rep: -25 },
  roubou: { conf: -30, afeto: -20, ress: 30, emo: { raiva: 20, desconfianca: 25 }, rep: CONFIG.factions.stealRep },
  salvou: { conf: 30, afeto: 25, ress: -20, emo: { felicidade: 12, esperanca: 15, confianca: 15, medo: -10 }, rep: 8 },
  resgatou: { conf: 45, afeto: 40, ress: -40, emo: { felicidade: 25, esperanca: 25, confianca: 25 }, rep: 15 },
  prendeu: { conf: -20, medo: 20, ress: 20, emo: { raiva: 15, medo: 15 } },
  viu_morte: { emo: { tristeza: 20, medo: 10, esperanca: -6 } },
  ameacou: { conf: -15, medo: 15, ress: 10, emo: { medo: 12, raiva: 8, desconfianca: 12 } },
  recrutou: { conf: 5, afeto: 5, emo: { esperanca: 10 } },
  abandonou: { conf: -15, afeto: -10, ress: 15, emo: { tristeza: 12, desconfianca: 10 } },
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Registra um acontecimento na memória do NPC e aplica seus efeitos (emoções, relação, reputação). */
export function remember(world: World, npc: Npc, kind: MemoryKind, who: Actor | null, text: string) {
  if (npc.state === 'morto') return;
  const id = who?.id ?? '?';
  const name = who && 'name' in who ? String((who as Actor & { name: string }).name) : 'alguém';
  npc.memory.push({ t: Math.floor(world.gameMinutes), kind, who: id, whoName: name, text });
  if (npc.memory.length > CONFIG.npc.memoryMax) {
    // esquece primeiro as conversas triviais, nunca as ofensas e favores
    const i = npc.memory.findIndex((m) => m.kind === 'conversou' || m.kind === 'conheceu');
    npc.memory.splice(i >= 0 ? i : 0, 1);
  }
  const e = EFFECTS[kind];
  // personalidade modula a intensidade (sem acaso)
  const pers = npc.def.personality;
  const grudge = 0.6 + (1 - pers.empatia) * 0.8;
  const warmth = 0.6 + pers.empatia * 0.8;
  if (who) {
    const r = npc.rel(id);
    if (e.conf) r.confianca = clamp(r.confianca + e.conf * (e.conf > 0 ? warmth : grudge), -100, 100);
    if (e.afeto) r.afeto = clamp(r.afeto + e.afeto * (e.afeto > 0 ? warmth : grudge), -100, 100);
    if (e.medo) r.medo = clamp(r.medo + e.medo * (1.4 - pers.coragem), 0, 100);
    if (e.ress) r.ressentimento = clamp(r.ressentimento + e.ress * (e.ress > 0 ? grudge : warmth), 0, 100);
    if (kind === 'ajudou' || kind === 'salvou' || kind === 'resgatou') r.divida += 1;
    if (kind === 'atacou' || kind === 'roubou') npc.hostileTo.add(id);
  }
  if (e.emo) for (const [k, v] of Object.entries(e.emo)) npc.emotions[k as Emotion] = clamp(npc.emotions[k as Emotion] + (v as number), 0, 100);
  if (e.rep && npc.faction && npc.role !== 'prisioneiro' && who instanceof Player) {
    changeRep(world, npc.faction, who.id, e.rep, text);
  }
}

/** Emoções voltam devagar ao temperamento do NPC; estímulos do ambiente as alteram. */
export function updateEmotions(world: World, npc: Npc, dt: number, threats: number, friendsNear: number) {
  const pers = npc.def.personality;
  const base: Record<Emotion, number> = {
    felicidade: 25 + pers.sociavel * 15,
    tristeza: 25,
    medo: 30 - pers.coragem * 20,
    raiva: pers.agressividade * 20,
    confianca: 20 + pers.empatia * 20,
    desconfianca: 45 - pers.empatia * 25,
    esperanca: 30,
  };
  const k = Math.min(1, dt * 0.01);
  for (const e of EMOTIONS) npc.emotions[e] += (base[e] - npc.emotions[e]) * k;
  if (threats > 0) npc.emotions.medo = clamp(npc.emotions.medo + dt * threats * 6 * (1.3 - pers.coragem), 0, 100);
  if (friendsNear > 0) npc.emotions.esperanca = clamp(npc.emotions.esperanca + dt * 0.5, 0, 100);
  if (npc.hunger > 70 || npc.thirst > 70) {
    npc.emotions.tristeza = clamp(npc.emotions.tristeza + dt * 0.3, 0, 100);
    npc.emotions.raiva = clamp(npc.emotions.raiva + dt * 0.2 * pers.agressividade, 0, 100);
  }
  if (npc.hp < 40) npc.emotions.medo = clamp(npc.emotions.medo + dt * 2, 0, 100);
}

export type Attitude = 'hostil' | 'ressentido' | 'desconfiado' | 'neutro' | 'amigavel' | 'leal';
export const ATTITUDE_LABEL: Record<Attitude, string> = {
  hostil: 'Hostil',
  ressentido: 'Ressentido',
  desconfiado: 'Desconfiado',
  neutro: 'Neutro',
  amigavel: 'Amigável',
  leal: 'Leal',
};

/** Postura do NPC com alguém: resultado de relação pessoal + reputação da facção + emoções. */
export function attitude(world: World, npc: Npc, who: string): Attitude {
  const r = npc.rel(who);
  if (npc.hostileTo.has(who)) return 'hostil';
  if (npc.faction && npc.role !== 'prisioneiro' && isHostileTo(world, npc.faction, who)) return 'hostil';
  if (r.ressentimento >= 40 && r.ressentimento > r.afeto + 20) {
    // personalidade agressiva + muito ressentimento = hostil; caso contrário só guarda rancor
    if (npc.def.personality.agressividade > 0.6 && r.ressentimento > 70) return 'hostil';
    return 'ressentido';
  }
  const score = r.confianca + r.afeto * 0.5 + (npc.faction ? rep(world, npc.faction, who) * 0.4 : 0) + (npc.emotions.confianca - npc.emotions.desconfianca) * 0.2;
  if (score >= 60) return 'leal';
  if (score >= 20) return 'amigavel';
  if (score <= -15) return 'desconfiado';
  return 'neutro';
}

/** Item atende a um "desejo"? ('comida' aceita qualquer alimento). */
export function wantMatches(want: string, defId: string) {
  if (want === defId) return true;
  const d = itemDef(defId);
  if (want === 'comida') return !!d.food && d.category === 'Comida';
  if (want === 'agua') return defId === 'agua' || (!!d.water && defId !== 'galao_agua');
  return false;
}

export function itemsMatching(p: Player, wants: string[]) {
  return p.inv.items.filter((it) => wants.some((w) => wantMatches(w, it.defId)) && !(it.defId === 'agua' && it.state?.contaminated));
}

// ======================================================================= DIÁLOGO

export interface DialogOption {
  id: string;
  label: string;
  enabled: boolean;
  reason?: string;
}

export interface DialogView {
  npcId: string;
  name: string;
  sub: string;
  text: string;
  options: DialogOption[];
}

function moodLine(npc: Npc): string {
  const m = npc.mood;
  if (npc.hunger > 75) return 'Mal consegue ficar de pé de fome.';
  switch (m) {
    case 'medo':
      return 'Olha o tempo todo para as janelas.';
    case 'raiva':
      return 'Está com a mandíbula travada.';
    case 'tristeza':
      return 'Tem os olhos fundos de quem chorou.';
    case 'esperanca':
      return 'Parece querer acreditar em alguma coisa.';
    default:
      return 'Parece calmo, dentro do possível.';
  }
}

/** Texto de abertura: depende da memória (o NPC lembra do jogador), postura e emoções. */
export function greeting(world: World, npc: Npc, p: Player): string {
  const att = attitude(world, npc, p.id);
  const mem = npc.memory.filter((m) => m.who === p.id);
  const has = (k: MemoryKind) => mem.some((m) => m.kind === k);
  if (npc.role === 'prisioneiro' && npc.activity === 'preso') return npc.def.intro;
  if (has('atacou')) return att === 'hostil' ? 'Você! Depois do que fez, ainda tem coragem de aparecer?' : 'Lembro de você. Da última vez saiu sangue. Fala de longe.';
  if (has('ignorou_pedido') && !has('ajudou')) {
    return npc.def.personality.empatia > 0.6
      ? 'Eu te pedi ajuda e você virou as costas. Tô tentando não guardar mágoa... mas tá difícil.'
      : 'Olha quem voltou. Quando eu precisei, você sumiu. Agora quer o quê?';
  }
  if (has('resgatou')) return 'Eu te devo a minha vida. O que precisar, é só falar.';
  if (has('ajudou') || has('salvou')) return `${p.name.split(' ')[0]}! Bom te ver de novo. Não esqueci o que você fez.`;
  if (has('roubou')) return 'Você mexeu no que não era seu. Todo mundo aqui sabe.';
  if (mem.length === 0) return npc.def.intro;
  if (att === 'hostil') return 'Já falei pra sumir daqui.';
  return npc.mood === 'medo' ? 'Fala baixo... eles escutam.' : 'De volta? Diga.';
}

export function dialogView(world: World, npc: Npc, p: Player, text?: string): DialogView {
  const att = attitude(world, npc, p.id);
  const opts: DialogOption[] = [];
  const add = (id: string, label: string, enabled = true, reason?: string) => opts.push({ id, label, enabled, reason });
  const hostile = att === 'hostil';
  const fac = npc.faction ? world.factions.get(npc.faction) : null;
  const caught = p.captive;
  if (npc.confront && npc.confront.who === p.id) add('render', 'Render-se (largar as armas)');
  add('historia', 'Perguntar sobre a vida dele(a)', !hostile, hostile ? 'Não quer conversa.' : undefined);
  add('rumores', 'Perguntar o que sabe por aqui', !hostile && npc.def.rumors.length > 0, hostile ? 'Não quer conversa.' : undefined);
  const req = npc.def.needs;
  if (req) {
    const got = itemsMatching(p, req.item);
    const open = npc.requests.find((r) => r.who === p.id && !r.resolved);
    if (open || npc.remembers('pediu_ajuda', p.id)) {
      add('dar_pedido', `Dar ${req.label}${got[0] ? ` (${itemDef(got[0].defId).name})` : ''}`, !!got[0] && !npc.requests.some((r) => r.who === p.id && r.resolved), got[0] ? undefined : 'Você não tem.');
    }
  }
  if (npc.def.trade) add('trocar', 'Negociar (troca)', !hostile && att !== 'ressentido' || npc.def.personality.ganancia > 0.6, hostile ? 'Não negocia com você.' : 'Ainda guarda rancor.');
  add('presente', 'Dar comida ou água de presente', itemsMatching(p, ['comida', 'agua']).length > 0, 'Você não tem comida/água.');
  if (!npc.faction || npc.role === 'prisioneiro') {
    if (npc.followId === p.id) add('esperar', 'Pedir para esperar aqui');
    else add('seguir', 'Chamar para vir junto', npc.role !== 'prisioneiro' || npc.activity !== 'preso', 'Está preso.');
  }
  if (npc.state !== 'morto' && npc.hp < 60 && p.inv.items.some((i) => itemDef(i.defId).medical && itemDef(i.defId).medical!.kind !== 'painkiller')) add('tratar', 'Tratar os ferimentos dele(a)');
  if (fac && npc.def.key === fac.leader) {
    add('faccao', `Falar sobre ${fac.name}`);
    if (fac.id === 'sentinela') add('autorizacao', 'Pedir autorização para o paiol', rep(world, 'sentinela', p.id) >= CONFIG.factions.friendlyAbove, 'Reputação insuficiente.');
  }
  // prisão: negociar libertação (do próprio jogador ou de outro)
  if (fac && fac.captures && npc.role !== 'prisioneiro') {
    if (caught && caught.faction === fac.id) add('negociar_soltura', 'Negociar minha libertação');
    const other = world.players.find((o) => o !== p && o.captive?.faction === fac.id);
    if (other) add('negociar_outro', `Negociar a soltura de ${other.name}`);
    const pris = world.npcs.find((n) => n.role === 'prisioneiro' && n.faction === fac.id && n.activity === 'preso');
    if (pris && !caught) add('negociar_npc', `Negociar a soltura de ${pris.name}`);
  }
  add('sair', 'Encerrar conversa');
  const sub = `${npc.faction ? `${world.factions.get(npc.faction)?.name ?? ''} · ` : ''}${npc.def.age} anos · ${attitudeLabelFor(world, npc, p)} · ${moodLine(npc)}`;
  return { npcId: npc.id, name: npc.name, sub, text: text ?? greeting(world, npc, p), options: opts };
}

function attitudeLabelFor(world: World, npc: Npc, p: Player) {
  const a = attitude(world, npc, p.id);
  const f = npc.faction && npc.role !== 'prisioneiro' ? ` · ${world.factions.get(npc.faction)?.name}: ${repLabel(rep(world, npc.faction, p.id))}` : '';
  return `${ATTITUDE_LABEL[a]}${f}`;
}

/** Valor de troca de um item (deterministico). */
export function tradeValue(defId: string): number {
  const d = itemDef(defId);
  if (d.weapon?.kind === 'gun') return 40;
  if (d.category === 'Munição') return 3;
  if (d.medical) return d.medical.kind === 'kit' ? 25 : defId === 'antibiotico' ? 22 : 8;
  if (d.food) return 6;
  if (defId === 'agua') return 6;
  if (defId === 'cigarros') return 7;
  if (defId === 'whisky') return 14;
  if (defId === 'pilhas') return 6;
  if (d.fuelCan) return 12;
  return Math.max(1, Math.round(d.weight * 2));
}

/** Executa uma opção de diálogo (sobrevivente em contexto = `p`). Retorna o próximo texto ou null para fechar. */
export function dialogChoose(world: World, npc: Npc, p: Player, opt: string): string | null {
  const att = attitude(world, npc, p.id);
  if (Math.hypot(npc.x - p.x, npc.y - p.y) > 3 * TILE) return 'Chegue mais perto para conversar.';
  if (!npc.remembers('conheceu', p.id)) remember(world, npc, 'conheceu', p, `Conheceu ${p.name}`);
  p.contacts.add(npc.id);
  switch (opt) {
    case 'sair':
      npc.talkingTo = null;
      return null;
    case 'historia':
      remember(world, npc, 'conversou', p, 'Conversaram sobre o passado');
      return `${npc.def.story} ${npc.goal ? `Agora? ${npc.goal.label}.` : ''}`;
    case 'rumores': {
      remember(world, npc, 'conversou', p, 'Trocaram notícias');
      const known = npc.memory.filter((m) => m.who === p.id && m.kind === 'conversou').length;
      return npc.def.rumors[(known - 1) % npc.def.rumors.length];
    }
    case 'presente': {
      const it = itemsMatching(p, ['comida', 'agua'])[0];
      if (!it) return 'Você não tem nada para dar.';
      giveItem(p, npc, it.uid, 1);
      remember(world, npc, 'presenteou', p, `Ganhou ${itemDef(it.defId).name}`);
      eatIfNeeded(npc);
      return npc.def.personality.ganancia > 0.7 ? 'Hm. Não é muito, mas aceito.' : 'Obrigado. De verdade.';
    }
    case 'dar_pedido': {
      const req = npc.def.needs;
      if (!req) return null;
      const it = itemsMatching(p, req.item)[0];
      if (!it) return 'Você não tem o que eu preciso.';
      giveItem(p, npc, it.uid, 1);
      for (const r of npc.requests) if (r.who === p.id) r.resolved = true;
      if (!npc.requests.some((r) => r.who === p.id)) npc.requests.push({ who: p.id, at: world.gameMinutes, resolved: true });
      remember(world, npc, 'ajudou', p, `Atendeu o pedido: ${req.label}`);
      world.missions?.onEvent('npc_ajudado', { npc: npc.key, by: p.id });
      eatIfNeeded(npc);
      return npc.remembers('ignorou_pedido', p.id) ? 'Demorou... mas veio. Obrigado. Vou lembrar disso também.' : 'Você não imagina o quanto isso ajuda. Obrigado.';
    }
    case 'trocar':
      return null; // a UI abre a tela de troca
    case 'seguir': {
      const need = npc.goal?.kind === 'ir_para' ? (npc.goal.needsTrust ?? 20) : 30;
      const r = npc.rel(p.id);
      if (att === 'hostil' || att === 'ressentido') return 'Seguir você? Nem pensar.';
      if (r.confianca < need && !npc.remembers('resgatou', p.id)) return 'Ainda não te conheço o bastante para isso.';
      npc.followId = p.id;
      npc.activity = 'seguindo';
      remember(world, npc, 'recrutou', p, `Passou a acompanhar ${p.name}`);
      return 'Tá bom. Vou com você. Mas se der errado, eu corro.';
    }
    case 'esperar':
      npc.followId = null;
      npc.home = { x: npc.x, y: npc.y };
      npc.activity = 'parado';
      return 'Fico aqui. Não demora.';
    case 'tratar': {
      const it = p.inv.items.find((i) => itemDef(i.defId).medical && itemDef(i.defId).medical!.kind !== 'painkiller');
      if (!it) return 'Você não tem material.';
      useOne(p, it.uid);
      npc.hp = Math.min(100, npc.hp + 30);
      remember(world, npc, 'salvou', p, 'Tratou os ferimentos');
      return 'Ai... obrigado. Tá melhor.';
    }
    case 'faccao': {
      const f = world.factions.get(npc.faction!)!;
      remember(world, npc, 'conversou', p, 'Falaram sobre a facção');
      const res = f.resources;
      return `${f.name}. Regras: ${f.rules.map((r) => r.text).join(' ')} Objetivos: ${f.goals.join('; ')}. Estoques — comida ${Math.round(res.comida)}, água ${Math.round(res.agua)}, munição ${Math.round(res.municao)}, remédios ${Math.round(res.remedios)}.`;
    }
    case 'autorizacao': {
      for (const d of world.map.doors) if (d.label === 'Porta do paiol') d.locked = undefined;
      remember(world, npc, 'conversou', p, 'Recebeu autorização para o paiol');
      return 'Tá autorizado. Leve o que for preciso para o laboratório — e só isso.';
    }
    case 'render':
      world.prison?.surrender(p, npc);
      return 'Isso. Devagar. Mãos na cabeça.';
    case 'negociar_soltura':
    case 'negociar_outro':
    case 'negociar_npc':
      return world.prison?.negotiate(p, npc, opt) ?? 'Não.';
  }
  return null;
}

export function giveItem(from: { inv: Player['inv'] }, to: { inv: Player['inv'] }, uid: string, qty: number) {
  const it = from.inv.get(uid);
  if (!it) return false;
  const n = Math.min(qty, it.qty);
  const copy = { ...it, qty: n, uid: n === it.qty ? it.uid : createItem(it.defId, n).uid, state: it.state ? { ...it.state } : undefined };
  const r = to.inv.add(copy);
  if (!r.ok || r.added <= 0) return false;
  from.inv.remove(uid, r.added);
  return true;
}

function useOne(p: Player, uid: string) {
  const it = p.inv.get(uid);
  if (!it) return;
  if (it.state?.uses && it.state.uses > 1) it.state.uses--;
  else p.inv.remove(uid, 1);
}

/** NPC com fome/sede consome algo do próprio inventário. */
export function eatIfNeeded(npc: Npc): boolean {
  let ate = false;
  if (npc.hunger > 45) {
    const f = npc.inv.items.find((i) => itemDef(i.defId).food && itemDef(i.defId).category === 'Comida');
    if (f) {
      npc.hunger = Math.max(0, npc.hunger - (itemDef(f.defId).food!.hunger ?? 30));
      npc.inv.remove(f.uid, 1);
      ate = true;
    }
  }
  if (npc.thirst > 45) {
    const w = npc.inv.items.find((i) => i.defId === 'agua' || itemDef(i.defId).food?.thirst);
    if (w) {
      npc.thirst = Math.max(0, npc.thirst - 40);
      npc.inv.remove(w.uid, 1);
      ate = true;
    }
  }
  return ate;
}

/** Troca: o jogador oferece `give` (uids) e pede `take` (uids do NPC). Aceita se o valor percebido compensar. */
export function proposeTrade(world: World, npc: Npc, p: Player, give: string[], take: string[]): { ok: boolean; text: string } {
  const att = attitude(world, npc, p.id);
  if (att === 'hostil') return { ok: false, text: 'Não faço negócio com você.' };
  const wants = npc.def.trade?.wants ?? [];
  let offered = 0;
  for (const uid of give) {
    const it = p.inv.get(uid);
    if (!it) continue;
    const mul = wants.some((w) => wantMatches(w, it.defId)) ? 1.3 : 0.6;
    offered += tradeValue(it.defId) * it.qty * mul;
  }
  let asked = 0;
  for (const uid of take) {
    const it = npc.inv.get(uid);
    if (!it) return { ok: false, text: 'Isso eu não tenho mais.' };
    if (uid === npc.weaponUid) return { ok: false, text: 'A minha arma não está à venda.' };
    asked += tradeValue(it.defId) * it.qty;
  }
  // ganância e ressentimento encarecem; dívida de gratidão barateia
  const r = npc.rel(p.id);
  const margin = 1 + npc.def.personality.ganancia * 0.4 + r.ressentimento / 120 - Math.min(0.4, r.divida * 0.1);
  if (offered < asked * margin) {
    return { ok: false, text: att === 'ressentido' ? 'Pra você o preço é outro. Traz mais.' : `Não fecha. Isso vale mais (${Math.round(offered)} por ${Math.round(asked * margin)}).` };
  }
  for (const uid of take) giveItem(npc, p, uid, npc.inv.get(uid)!.qty);
  for (const uid of give) giveItem(p, npc, uid, p.inv.get(uid)?.qty ?? 0);
  remember(world, npc, 'trocou', p, 'Fizeram uma troca justa');
  if (npc.faction) {
    const f = world.factions.get(npc.faction);
    if (f) f.resources.comida += give.length;
  }
  world.events.emit('inventoryChanged', {});
  return { ok: true, text: 'Negócio fechado.' };
}

/** Ganchos de combate → memória/reputação. */
export function installSocialHooks(world: World) {
  world.onHumanHurt = (target, attacker) => {
    if (target instanceof Npc && attacker instanceof Player) {
      target.lastAttacker = attacker.id;
      if (!target.remembers('atacou', attacker.id) || world.time - (target.memory.filter((m) => m.kind === 'atacou').pop()?.t ?? 0) > 1) {
        remember(world, target, 'atacou', attacker, `Foi atacado por ${attacker.name}`);
      }
      // companheiros da facção que viram também reagem
      for (const n of world.npcs) {
        if (n === target || n.state === 'morto' || !n.faction || n.faction !== target.faction) continue;
        if (Math.hypot(n.x - target.x, n.y - target.y) < 14 * TILE && world.map.los(n.x, n.y, target.x, target.y)) n.hostileTo.add(attacker.id);
      }
    }
  };
  world.onHumanDeath = (a) => {
    for (const n of world.npcs) {
      if (n === a || n.state === 'morto') continue;
      if (Math.hypot(n.x - a.x, n.y - a.y) < 12 * TILE) remember(world, n, 'viu_morte', null, `Viu ${'name' in a ? (a as Actor & { name: string }).name : 'alguém'} morrer`);
    }
    if (a instanceof Npc) {
      a.deadAt = world.gameMinutes;
      a.activity = 'morto';
      if (a.faction) {
        const killer = a.lastAttacker ? world.playerById(a.lastAttacker) : undefined;
        if (killer && a.role !== 'prisioneiro') changeRep(world, a.faction, killer.id, CONFIG.factions.killMemberRep, `matou ${a.name}`);
      }
      world.missions?.onEvent('npc_morto', { npc: a.key });
    }
  };
}
