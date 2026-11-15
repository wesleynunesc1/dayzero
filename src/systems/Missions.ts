import { CONFIG, TILE } from '../config';
import { createItem, itemDef } from '../data/items';
import { dist } from '../engine/math';
import type { Npc } from '../entities/Npc';
import type { Player } from '../entities/Player';
import type { Prop } from '../world/types';
import type { World } from '../world/World';
import { changeRep } from './Factions';
import { radioOf } from './Radio';
import { remember } from './Social';

/**
 * Campanha cooperativa (10 capítulos, progresso COMPARTILHADO pelo grupo) e missões
 * secundárias dinâmicas com consequências. Sem cronômetro: nada expira por tempo,
 * exceto pedidos de NPCs (que geram ressentimento, não "game over").
 */

export interface Objective {
  id: string;
  text: string;
  done: boolean;
}

interface ChapterDef {
  n: number;
  title: string;
  intro: string;
  objectives: { id: string; text: string; check: (m: Missions) => boolean }[];
}

export type SideKind = 'desaparecido' | 'resgate_prisioneiro' | 'medicamentos' | 'defender' | 'investigar' | 'escoltar' | 'equipamento' | 'ajudar_faccao' | 'fuga' | 'conflito';

export interface SideMission {
  id: string;
  kind: SideKind;
  title: string;
  text: string;
  /** Quem aceitou/recebeu (vazio = disponível para o grupo). */
  status: 'ativa' | 'concluida' | 'falhou';
  giver?: string;
  target?: string;
  /** Consequência aplicada ao concluir/falhar (texto exibido). */
  outcome?: string;
}

const has = (w: World, id: string) => w.players.some((p) => p.inv.count(id) > 0);

export class Missions {
  chapter = 1;
  finished = false;
  flags: Record<string, boolean | number | string> = {};
  /** Objetivos cumpridos (ids) — "pegajosos": uma vez feitos, ficam feitos. */
  done = new Set<string>();
  side: SideMission[] = [];
  log: { t: number; text: string }[] = [];
  /** Laboratório: combustível no gerador (L), ligado, síntese em andamento. */
  lab = { fuel: 0, on: false, synth: 0, noiseT: 0 };
  /** Ponto de reencontro combinado pelo rádio (nome de lugar + tile). */
  rendezvous: { name: string; x: number; y: number } | null = null;
  private t = 0;
  readonly defs: ChapterDef[];

  constructor(public world: World) {
    const w = world;
    const alive = () => w.players.filter((p) => !p.dead);
    this.defs = [
      { n: 1, title: 'Sobreviver', intro: 'Cada um acordou num canto do mapa. Antes de qualquer coisa: comida, água, algo para se defender e um lugar para dormir.', objectives: [
        { id: 'c1_comida', text: 'Conseguir comida e água potável', check: () => w.players.some((p) => p.inv.items.some((i) => itemDef(i.defId).food && itemDef(i.defId).category === 'Comida') && p.inv.items.some((i) => (i.defId === 'agua' || i.defId === 'garrafa_agua') && !i.state?.contaminated)) || !!this.flags.comeu },
        { id: 'c1_arma', text: 'Arrumar algo para se defender', check: () => w.players.some((p) => !!p.weaponItem) },
        { id: 'c1_abrigo', text: 'Encontrar um abrigo e descansar', check: () => !!this.flags.dormiu },
      ] },
      { n: 2, title: 'Encontrar o rádio', intro: 'Sem telefone, sem internet. Um rádio é a única forma de saber se mais alguém está vivo.', objectives: [
        { id: 'c2_radio', text: 'Encontrar um rádio', check: () => w.players.some((p) => !!radioOf(p)) },
        { id: 'c2_pilhas', text: 'Colocar pilhas e ligar o rádio', check: () => w.players.some((p) => { const r = radioOf(p); return !!r && (r.state?.battery ?? 0) > 0 && !!r.state?.on; }) },
      ] },
      { n: 3, title: 'Estabelecer contato', intro: 'Transmita. Alguém precisa ouvir. A Base Sentinela escuta o canal 4; outros sobreviventes podem estar em qualquer canal.', objectives: [
        { id: 'c3_contato', text: 'Falar pelo rádio com outro sobrevivente ou com a Base Sentinela', check: () => !!this.flags.contato },
      ] },
      { n: 4, title: 'Encontrar os aliados', intro: 'Quatro pessoas, quatro regiões. Pelo rádio, descubram onde cada um está — o mapa não mostra ninguém: só o que vocês disserem.', objectives: [
        { id: 'c4_todos', text: 'Fazer contato com todos os sobreviventes do grupo', check: () => alive().every((p) => alive().every((o) => o === p || p.contacts.has(o.id) || o.contacts.has(p.id))) },
        { id: 'c4_ponto', text: 'Combinar um ponto de encontro pelo rádio (diga o nome de uma cidade ou abrigo)', check: () => !!this.rendezvous || alive().length <= 1 },
      ] },
      { n: 5, title: 'O reencontro', intro: 'Atravessar regiões inteiras a pé ou de carro, com o combustível que der. Encontrem-se.', objectives: [
        { id: 'c5_juntos', text: 'Reunir todos os sobreviventes vivos no mesmo lugar', check: () => { const a = alive(); return a.length > 0 && a.every((p) => a.every((o) => dist(p.x, p.y, o.x, o.y) < 14 * TILE)); } },
      ] },
      { n: 6, title: 'A origem da epidemia', intro: 'Hospitais, laboratórios e quartéis guardam o que aconteceu. Alguém sabia.', objectives: [
        { id: 'c6_prontuario', text: 'Ler o prontuário do paciente zero (Hospital de Santa Aurora)', check: () => !!this.flags.lido_prontuario_zero },
        { id: 'c6_relatorio', text: 'Ler o relatório interno do Instituto Vitalis', check: () => !!this.flags.lido_relatorio_vitalis },
        { id: 'c6_helena', text: 'Conversar com a Dra. Helena Vitalis', check: () => !!this.flags.helena },
      ] },
      { n: 7, title: 'Os componentes', intro: 'A Dra. Helena listou o que falta. Cada peça está num lugar perigoso — ou nas mãos de alguém.', objectives: [
        { id: 'c7_amostra', text: 'Amostra viral preservada', check: () => has(w, 'amostra_viral') || !!this.flags.entregue_amostra_viral },
        { id: 'c7_r4', text: 'Reagente R-4 (paiol da Base Sentinela)', check: () => has(w, 'reagente_r4') || !!this.flags.entregue_reagente_r4 },
        { id: 'c7_centrifuga', text: 'Centrífuga do Instituto Vitalis', check: () => has(w, 'centrifuga') || !!this.flags.entregue_centrifuga },
      ] },
      { n: 8, title: 'O laboratório', intro: 'O Instituto Vitalis tem o equipamento — e está às escuras. O gerador precisa de combustível, e o barulho dele vai chamar atenção.', objectives: [
        { id: 'c8_chegar', text: 'Chegar ao laboratório do Instituto Vitalis', check: () => w.players.some((p) => inLab(w, p.x, p.y)) },
        { id: 'c8_combustivel', text: 'Abastecer o gerador (10 L)', check: () => this.lab.fuel >= 10 || this.lab.on },
        { id: 'c8_ligar', text: 'Ligar o gerador', check: () => this.lab.on },
        { id: 'c8_componentes', text: 'Levar os três componentes à bancada de síntese', check: () => !!(this.flags.entregue_amostra_viral && this.flags.entregue_reagente_r4 && this.flags.entregue_centrifuga) },
      ] },
      { n: 9, title: 'A vacina', intro: 'Síntese em andamento. Alguém precisa ficar na bancada enquanto o gerador ruge e eles vêm.', objectives: [
        { id: 'c9_sintese', text: 'Concluir a síntese (fique perto da bancada; defenda o laboratório)', check: () => !!this.flags.vacina_pronta },
      ] },
      { n: 10, title: 'A missão final', intro: 'Uma dose não salva o mundo. A fórmula precisa chegar a quem puder reproduzi-la.', objectives: [
        { id: 'c10_transmitir', text: 'Transmitir a fórmula de uma estação de longo alcance (torre do aeroporto ou Base Sentinela)', check: () => !!this.flags.formula_transmitida },
        { id: 'c10_aurora', text: 'Entregar doses à Comunidade Aurora (Dona Célia)', check: () => !!this.flags.vacina_aurora },
      ] },
    ];
  }

  get def() {
    return this.defs[this.chapter - 1];
  }

  objectives(): Objective[] {
    if (this.finished) return [];
    return this.def.objectives.map((o) => ({ id: o.id, text: o.text, done: this.done.has(o.id) }));
  }

  private note(text: string) {
    this.log.push({ t: Math.floor(this.world.gameMinutes), text });
    if (this.log.length > 60) this.log.shift();
  }

  update(dt: number) {
    const w = this.world;
    this.updateLab(dt);
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1;
    if (this.finished) return;
    let changed = false;
    for (const o of this.def.objectives) {
      if (!this.done.has(o.id) && o.check(this)) {
        this.done.add(o.id);
        changed = true;
        w.msgAll(`✔ Objetivo: ${o.text}`, 'good');
        this.note(`Objetivo cumprido: ${o.text}`);
      }
    }
    if (changed && this.def.objectives.every((o) => this.done.has(o.id))) this.advance();
  }

  private advance() {
    const w = this.world;
    this.note(`Capítulo ${this.chapter} concluído: ${this.def.title}`);
    if (this.chapter >= 10) {
      this.finished = true;
      w.msgAll('A fórmula foi transmitida e as primeiras doses chegaram à Aurora. Não é o fim do mundo — é o primeiro amanhecer depois dele.', 'good');
      w.events.emit('campaign', { chapter: 11, title: 'Epílogo', text: 'Campanha concluída. O mundo continua — e vocês também.' });
      return;
    }
    this.chapter++;
    w.msgAll(`Capítulo ${this.chapter} — ${this.def.title}. ${this.def.intro}`, 'good');
    w.events.emit('campaign', { chapter: this.chapter, title: this.def.title, text: this.def.intro });
    // objetivos já cumpridos antes (ex.: já tinham a amostra) contam imediatamente
    this.t = 0;
  }

  /** Eventos do mundo → flags da campanha e missões secundárias. */
  onEvent(kind: string, data: Record<string, unknown>) {
    const w = this.world;
    switch (kind) {
      case 'dormiu':
        this.flags.dormiu = true;
        break;
      case 'comeu':
        this.flags.comeu = true;
        break;
      case 'contato_base':
      case 'contato_vitalis':
      case 'contato_radio':
        this.flags.contato = true;
        break;
      case 'documento_lido':
        this.flags[`lido_${data.id}`] = true;
        break;
      case 'conversa':
        if (data.npc === 'dra_helena' && this.chapter >= 6) this.flags.helena = true;
        break;
      case 'radio_texto':
        this.parseRendezvous(String(data.text ?? ''));
        break;
      case 'npc_pediu':
        this.ensureSide(`ajuda_${data.npc}`, () => {
          const n = w.npcs.find((x) => x.key === data.npc)!;
          const kindOf: SideKind = n.def.needs!.item.includes('antibiotico') ? 'medicamentos' : n.def.needs!.item.includes('chave_celas') ? 'resgate_prisioneiro' : 'ajudar_faccao';
          return { kind: kindOf, title: `${n.name}: ${n.def.needs!.label}`, text: n.def.needs!.reason, giver: n.key };
        });
        break;
      case 'npc_ajudado':
        this.finishSide(`ajuda_${data.npc}`, true, `${this.npcName(data.npc)} não vai esquecer a ajuda.`);
        if (data.npc === 'dona_celia') {
          const f = w.factions.get('aurora');
          if (f) f.resources.remedios += 10;
        }
        break;
      case 'npc_ignorado':
        this.finishSide(`ajuda_${data.npc}`, false, `${this.npcName(data.npc)} ficou esperando ajuda que não veio — e guardou ressentimento.`);
        break;
      case 'npc_morto':
        for (const s of this.side) if (s.status === 'ativa' && (s.giver === data.npc || s.target === data.npc)) this.finishSide(s.id, false, `${this.npcName(data.npc)} morreu.`);
        break;
      case 'prisioneiro_livre':
        this.finishSide('resgate_joao', true, 'João está livre. A Comunidade Aurora vai saber quem o trouxe de volta.');
        if (data.by) changeRep(w, 'aurora', String(data.by), 20, 'resgatou João');
        this.ensureSide('escolta_joao', () => ({ kind: 'escoltar', title: 'Levar João até a Comunidade Aurora', text: 'João conhece o caminho, mas não sobrevive sozinho na estrada.', target: 'prisioneiro_joao' }));
        break;
      case 'npc_chegou':
        if (data.npc === 'prisioneiro_joao') this.finishSide('escolta_joao', true, 'João chegou à Aurora. Dona Célia passa a confiar no grupo.');
        if (data.npc === 'lucia') this.finishSide('desaparecida_lucia', true, 'Lúcia chegou à Aurora. Rosa chorou de alívio.');
        break;
      case 'capturado': {
        const p = w.playerById(String(data.player));
        this.ensureSide(`fuga_${data.player}`, () => ({ kind: 'fuga', title: `${p?.name ?? 'Sobrevivente'} preso em ${data.prison}`, text: 'Fugir (grampo, chave das celas), negociar a soltura ou ser resgatado pelos amigos. As coisas confiscadas estão no depósito de apreensões.', target: String(data.player) }));
        break;
      }
      case 'fugiu':
      case 'resgatado':
      case 'libertado':
        this.finishSide(`fuga_${data.player}`, true, kind === 'resgatado' ? 'Resgatado pelos amigos.' : kind === 'fugiu' ? 'Fuga bem-sucedida.' : 'Libertado por negociação.');
        break;
      case 'corpo_saqueado':
        this.ensureSide(`recuperar_${data.corpse}`, () => ({ kind: 'equipamento', title: 'Equipamento saqueado', text: `${this.npcName(data.npc)} levou itens de um corpo. Eles continuam com ele(a): negocie, troque ou tome de volta.`, target: String(data.npc) }));
        break;
      case 'investigou':
        this.finishSide(`investigar_${data.id}`, true, 'Instalação investigada.');
        break;
    }
  }

  private npcName(key: unknown) {
    return this.world.npcs.find((n) => n.key === key)?.name ?? 'Alguém';
  }

  ensureSide(id: string, make: () => Omit<SideMission, 'id' | 'status'>) {
    if (this.side.some((s) => s.id === id)) return;
    const m: SideMission = { id, status: 'ativa', ...make() };
    this.side.push(m);
    this.world.msgAll(`Nova missão secundária: ${m.title}`, 'info');
    this.world.events.emit('mission', { id, status: 'ativa', title: m.title });
  }

  finishSide(id: string, ok: boolean, outcome: string) {
    const m = this.side.find((s) => s.id === id);
    if (!m || m.status !== 'ativa') return;
    m.status = ok ? 'concluida' : 'falhou';
    m.outcome = outcome;
    this.note(`${ok ? 'Missão concluída' : 'Missão fracassada'}: ${m.title} — ${outcome}`);
    this.world.msgAll(`${ok ? '✔' : '✖'} ${m.title}: ${outcome}`, ok ? 'good' : 'warn');
    this.world.events.emit('mission', { id, status: m.status, title: m.title });
  }

  /** Missões iniciais do mundo (pessoas desaparecidas, prisioneiros, instalações, conflito). */
  seedSideMissions() {
    this.ensureSide('desaparecida_lucia', () => ({ kind: 'desaparecido', title: 'Lúcia desaparecida', text: 'Rosa, da Comunidade Aurora, espera uma enfermeira chamada Lúcia que vinha de Nova Esperança. Ela nunca chegou.', giver: 'rosa', target: 'lucia' }));
    this.ensureSide('resgate_joao', () => ({ kind: 'resgate_prisioneiro', title: 'João preso pelos Abutres', text: 'Dona Célia diz que os Abutres levaram João Pereira para o Presídio do Vale Sombrio.', giver: 'dona_celia', target: 'prisioneiro_joao' }));
    this.ensureSide('investigar_hospital_sa', () => ({ kind: 'investigar', title: 'O hospital de Santa Aurora', text: 'O primeiro caso teria sido internado lá. O que restou dos arquivos?' }));
    this.ensureSide('conflito_paiol', () => ({ kind: 'conflito', title: 'O paiol cobiçado', text: 'Os Abutres querem o paiol da Sentinela. Ajudar um lado vai custar a confiança do outro.' }));
    this.ensureSide('defender_aurora', () => ({ kind: 'defender', title: 'Defender a Aurora', text: 'Infectados rondam a escola à noite. Ajude a limpar o entorno do portão (10 abates por perto).', giver: 'dona_celia' }));
  }

  /** Zumbi morto perto da Aurora conta para "Defender a Aurora". */
  onZombieKilled(x: number, y: number, by: string | null) {
    const site = this.world.factionSites.find((s) => s.faction === 'aurora');
    if (!site) return;
    const cx = ((site.area.x0 + site.area.x1) / 2) * TILE;
    const cy = ((site.area.y0 + site.area.y1) / 2) * TILE;
    if (dist(x, y, cx, cy) > 30 * TILE) return;
    this.flags.abates_aurora = Number(this.flags.abates_aurora ?? 0) + 1;
    if (Number(this.flags.abates_aurora) >= 10) {
      this.finishSide('defender_aurora', true, 'O entorno da Aurora está mais seguro. A comunidade passa a dividir comida com o grupo.');
      if (by) changeRep(this.world, 'aurora', by, 15, 'defendeu a comunidade');
    }
  }

  // ------------------------------------------------------------------ ponto de encontro
  private parseRendezvous(text: string) {
    const t = text.toLowerCase();
    if (!/encontr|reun|vamos|ponto|venham|vem pra|vem para|me acha/.test(t)) return;
    const places = [...this.world.towns.map((x) => ({ name: x.name, x: x.cx, y: x.cy })), ...this.world.pois.map((p) => ({ name: p.name, x: p.x + p.w / 2, y: p.y + p.h / 2 }))];
    const found = places.filter((p) => t.includes(p.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0];
    if (found) {
      this.rendezvous = found;
      this.note(`Ponto de encontro combinado: ${found.name}`);
    }
  }

  // ------------------------------------------------------------------ laboratório
  /** Rótulo de interação especial para um objeto (ou null). */
  specialLabel(p: Player, pr: Prop): string | null {
    if (pr.kind === 'generator') {
      if (this.lab.on) return 'Desligar o gerador';
      if (this.lab.fuel >= 10) return 'Ligar o gerador';
      const can = p.inv.items.find((i) => itemDef(i.defId).fuelCan && (i.state?.fuel ?? 0) > 0);
      return can ? `Abastecer o gerador (${this.lab.fuel.toFixed(0)}/10 L)` : `Gerador sem combustível (${this.lab.fuel.toFixed(0)}/10 L) — traga um galão`;
    }
    if (pr.kind === 'lab_bench') {
      if (this.flags.vacina_pronta) return 'Bancada de síntese (vacina pronta)';
      if (this.lab.synth > 0) return `Síntese em andamento (${Math.floor(this.lab.synth * 100)}%)`;
      const comps = ['amostra_viral', 'reagente_r4', 'centrifuga'].filter((id) => p.inv.count(id) > 0 && !this.flags[`entregue_${id}`]);
      if (comps.length) return `Instalar na bancada: ${comps.map((c) => itemDef(c).name).join(', ')}`;
      return this.lab.on ? 'Iniciar síntese da vacina' : 'Bancada de síntese (sem energia)';
    }
    if (pr.kind === 'radio_station') return p.inv.count('vacina') > 0 && p.inv.count('relatorio_vitalis') > 0 ? 'Transmitir a fórmula da vacina' : 'Usar a estação de rádio (canal 4)';
    return null;
  }

  special(p: Player, pr: Prop) {
    const w = this.world;
    if (pr.kind === 'generator') {
      if (this.lab.on) {
        this.lab.on = false;
        w.msg('Gerador desligado.');
        return;
      }
      if (this.lab.fuel >= 10) {
        this.lab.on = true;
        w.msg('O gerador tosse e pega. As luzes do Instituto acendem — e o barulho ecoa longe.', 'warn');
        w.makeNoise(pr.x * TILE, pr.y * TILE, 30, 'motor', true, p.id);
        return;
      }
      const can = p.inv.items.find((i) => itemDef(i.defId).fuelCan && (i.state?.fuel ?? 0) > 0);
      if (!can) return w.msg('Precisa de um galão com combustível.', 'warn');
      const liters = Math.min(can.state!.fuel!, 10 - this.lab.fuel + 10);
      can.state!.fuel! -= liters;
      this.lab.fuel += liters;
      w.msg(`Você despejou ${liters.toFixed(1)} L no gerador (${this.lab.fuel.toFixed(1)} L).`, 'good');
      w.events.emit('inventoryChanged', {});
      return;
    }
    if (pr.kind === 'lab_bench') {
      if (this.flags.vacina_pronta) return w.msg('As doses já foram produzidas.');
      let put = 0;
      for (const id of ['amostra_viral', 'reagente_r4', 'centrifuga']) {
        const it = p.inv.findDef(id);
        if (it && !this.flags[`entregue_${id}`]) {
          p.inv.remove(it.uid, 1);
          this.flags[`entregue_${id}`] = true;
          put++;
        }
      }
      if (put) {
        w.msg(`${put} componente(s) instalado(s) na bancada.`, 'good');
        w.events.emit('inventoryChanged', {});
        return;
      }
      const ready = this.flags.entregue_amostra_viral && this.flags.entregue_reagente_r4 && this.flags.entregue_centrifuga;
      if (!ready) return w.msg('Faltam componentes: amostra viral, reagente R-4 e centrífuga.', 'warn');
      if (!this.lab.on) return w.msg('Sem energia. Ligue o gerador.', 'warn');
      if (p.inv.count('relatorio_vitalis') === 0 && !w.npcs.some((n) => n.key === 'dra_helena' && n.state !== 'morto' && dist(n.x, n.y, p.x, p.y) < 10 * TILE)) {
        return w.msg('Sem o protocolo do relatório Vitalis (ou a Dra. Helena aqui), ninguém sabe como conduzir a síntese.', 'warn');
      }
      if (this.chapter < 9) return w.msg('Antes, reúnam tudo o que o laboratório precisa (capítulo 8).', 'warn');
      if (this.lab.synth <= 0) {
        this.lab.synth = 0.001;
        w.msgAll('A síntese começou. Alguém precisa ficar perto da bancada até terminar — o gerador vai atrair infectados.', 'warn');
      }
      return;
    }
    if (pr.kind === 'radio_station') {
      if (p.inv.count('vacina') > 0 && p.inv.count('relatorio_vitalis') > 0) {
        if (this.chapter < 10) return w.msg('Ainda não há fórmula validada para transmitir.', 'warn');
        this.flags.formula_transmitida = true;
        w.msgAll(`${p.name} transmitiu a fórmula da contramedida em todas as frequências. Do outro lado, depois de muito chiado: "…recebido… repita… recebido."`, 'good');
        return;
      }
      w.msg('A estação tem alcance enorme. Use seu rádio no canal 4 aqui perto para falar com a Base.', 'info');
    }
  }

  private updateLab(dt: number) {
    const w = this.world;
    if (!this.lab.on) return;
    const hours = (dt * CONFIG.time.minutesPerSecond) / 60;
    this.lab.fuel = Math.max(0, this.lab.fuel - hours * 1.2);
    this.lab.noiseT -= dt;
    if (this.lab.noiseT <= 0) {
      this.lab.noiseT = 6;
      w.makeNoise(w.lab.generator.x * TILE, w.lab.generator.y * TILE, 26, 'motor', true, null);
    }
    if (this.lab.fuel <= 0) {
      this.lab.on = false;
      w.msgNear(w.lab.generator.x * TILE, w.lab.generator.y * TILE, 40 * TILE, 'O gerador engasgou e parou: acabou o combustível.', 'warn');
    }
    if (this.lab.synth > 0 && !this.flags.vacina_pronta) {
      const bx = (w.lab.bench.x + 1.5) * TILE;
      const by = (w.lab.bench.y + 0.5) * TILE;
      const someone = w.players.some((p) => !p.dead && !p.isDown && dist(p.x, p.y, bx, by) < 6 * TILE);
      if (someone) this.lab.synth += dt / 150; // ~2,5 min de defesa
      if (this.lab.synth >= 1) {
        this.flags.vacina_pronta = true;
        const p = w.players.filter((q) => !q.dead).sort((a, b) => dist(a.x, a.y, bx, by) - dist(b.x, b.y, bx, by))[0];
        const doses = createItem('vacina', 4);
        if (p && p.inv.add(doses).ok) w.withPlayer(p, () => w.msg('A síntese terminou: 4 doses da contramedida AURORA estão com você.', 'good'));
        else w.containers.values().next().value?.inv.items.push(doses);
        w.msgAll('A primeira contramedida foi sintetizada.', 'good');
      }
    }
  }

  /** Diálogo extra com NPCs da campanha (entregar vacina etc.). */
  npcOptions(npc: Npc, p: Player): { id: string; label: string }[] {
    const out: { id: string; label: string }[] = [];
    if (npc.key === 'dona_celia' && p.inv.count('vacina') > 0 && !this.flags.vacina_aurora) out.push({ id: 'entregar_vacina', label: 'Entregar doses da vacina' });
    if (npc.key === 'dra_helena' && this.chapter >= 7) out.push({ id: 'helena_status', label: 'Perguntar o que falta para a vacina' });
    return out;
  }

  npcChoose(npc: Npc, p: Player, opt: string): string | null {
    const w = this.world;
    if (opt === 'entregar_vacina') {
      const it = p.inv.findDef('vacina');
      if (!it) return 'Você não tem doses.';
      p.inv.remove(it.uid, Math.min(2, it.qty));
      this.flags.vacina_aurora = true;
      remember(w, npc, 'ajudou', p, 'Trouxe a vacina para a Aurora');
      changeRep(w, 'aurora', p.id, 30, 'trouxe a vacina');
      w.events.emit('inventoryChanged', {});
      return 'Meu Deus... vocês conseguiram. As crianças primeiro. Obrigada — de todo o coração.';
    }
    if (opt === 'helena_status') {
      const falta = ['amostra_viral', 'reagente_r4', 'centrifuga'].filter((id) => !this.flags[`entregue_${id}`] && !has(w, id)).map((id) => itemDef(id).name);
      return falta.length ? `Ainda falta: ${falta.join(', ')}. A amostra estava no freezer do hospital de Santa Aurora; o R-4 foi para o paiol da Sentinela; a centrífuga ficou no Instituto.` : 'Vocês têm tudo. Levem ao Instituto, religuem o gerador e me deixem trabalhar — ou sigam o protocolo do relatório.';
    }
    return null;
  }
}

export function inLab(w: World, x: number, y: number) {
  const a = w.lab.area;
  const tx = x / TILE;
  const ty = y / TILE;
  return tx >= a.x0 && tx <= a.x1 && ty >= a.y0 && ty <= a.y1;
}
