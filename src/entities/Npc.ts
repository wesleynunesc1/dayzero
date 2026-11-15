import { createItem } from '../data/items';
import { NpcDef, NpcRole } from '../data/npcs';
import { Ally } from './Ally';

export type Emotion = 'felicidade' | 'tristeza' | 'medo' | 'raiva' | 'confianca' | 'desconfianca' | 'esperanca';
export const EMOTIONS: Emotion[] = ['felicidade', 'tristeza', 'medo', 'raiva', 'confianca', 'desconfianca', 'esperanca'];
export const EMOTION_LABEL: Record<Emotion, string> = {
  felicidade: 'Felicidade',
  tristeza: 'Tristeza',
  medo: 'Medo',
  raiva: 'Raiva',
  confianca: 'Confiança',
  desconfianca: 'Desconfiança',
  esperanca: 'Esperança',
};

export type MemoryKind =
  | 'conheceu'
  | 'conversou'
  | 'pediu_ajuda'
  | 'ajudou'
  | 'ignorou_pedido'
  | 'presenteou'
  | 'trocou'
  | 'atacou'
  | 'roubou'
  | 'salvou'
  | 'resgatou'
  | 'prendeu'
  | 'viu_morte'
  | 'ameacou'
  | 'recrutou'
  | 'abandonou';

export interface Memory {
  /** Minuto de jogo em que aconteceu. */
  t: number;
  kind: MemoryKind;
  /** Id de quem causou (sobrevivente, NPC). */
  who: string;
  whoName: string;
  text: string;
}

/** Relação do NPC com outra pessoa. Só muda por eventos lembrados — nunca ao acaso. */
export interface Relation {
  confianca: number; // -100..100
  afeto: number; // -100..100
  medo: number; // 0..100
  ressentimento: number; // 0..100
  divida: number; // favores devidos (+) ou cobrados (-)
}

export type NpcActivity =
  | 'parado'
  | 'vigiando'
  | 'explorando'
  | 'buscando_comida'
  | 'comendo'
  | 'saqueando_corpo'
  | 'fugindo'
  | 'lutando'
  | 'seguindo'
  | 'defendendo'
  | 'ajudando'
  | 'conversando'
  | 'viajando'
  | 'preso'
  | 'fugindo_prisao'
  | 'confrontando'
  | 'morto';

export const ACTIVITY_LABEL: Record<NpcActivity, string> = {
  parado: 'Parado',
  vigiando: 'Vigiando',
  explorando: 'Explorando',
  buscando_comida: 'Procurando comida',
  comendo: 'Comendo',
  saqueando_corpo: 'Revirando um corpo',
  fugindo: 'Fugindo',
  lutando: 'Lutando',
  seguindo: 'Seguindo',
  defendendo: 'Defendendo',
  ajudando: 'Ajudando alguém',
  conversando: 'Conversando',
  viajando: 'Viajando',
  preso: 'Preso',
  fugindo_prisao: 'Fugindo da prisão',
  confrontando: 'Confrontando',
  morto: 'Morto',
};

/**
 * NPC com identidade: nome, história, personalidade, objetivos, necessidades, emoções,
 * memória, relações e inventário. Reaproveita o corpo do aliado (caminhada, portas, combate).
 */
export class Npc extends Ally {
  readonly key: string;
  readonly def: NpcDef;
  role: NpcRole;
  faction: string | null;
  activity: NpcActivity = 'parado';
  emotions: Record<Emotion, number>;
  memory: Memory[] = [];
  relations = new Map<string, Relation>();
  hunger = 30;
  thirst = 25;
  /** Posto/casa (tiles) para onde volta. */
  home: { x: number; y: number };
  /** Sobrevivente que está seguindo (recrutado). */
  followId: string | null = null;
  /** Pedido de ajuda em aberto: a quem pediu, quando, e se já foi resolvido. */
  requests: { who: string; at: number; resolved: boolean }[] = [];
  /** Índice do objetivo atual em def.goals. */
  goalIdx = 0;
  goalDone = false;
  thinkT = 0;
  activityT = 0;
  target: { x: number; y: number; id?: string } | null = null;
  /** Ameaça humana atual (id) — sobrevivente hostil, invasor etc. */
  hostileTo = new Set<string>();
  /** Confronto com invasor: id e tempo restante para render-se. */
  confront: { who: string; t: number } | null = null;
  /** Cela em que está (prisioneiro). */
  cell: number | null = null;
  lootCd = 0;
  /** Conversa aberta com (id). */
  talkingTo: string | null = null;
  deadAt = -1;
  /** Último sobrevivente que o feriu. */
  lastAttacker: string | null = null;

  constructor(def: NpcDef, x: number, y: number, role: NpcRole, faction: string | null) {
    super(x, y, `n_${def.key}`);
    this.key = def.key;
    this.def = def;
    this.name = def.name;
    this.role = role;
    this.faction = faction;
    this.look = { ...def.look };
    this.home = { x, y };
    this.state = 'npc';
    this.mode = 'aguardar';
    const pers = def.personality;
    this.emotions = {
      felicidade: 30 + pers.sociavel * 20,
      tristeza: 30,
      medo: 40 - pers.coragem * 30,
      raiva: pers.agressividade * 30,
      confianca: 20 + pers.empatia * 20,
      desconfianca: 50 - pers.empatia * 25,
      esperanca: 30,
    };
    this.inv.items = [];
    this.inv.baseWeight = 30;
    this.inv.baseSlots = 20;
    this.weaponUid = '';
    if (def.weapon) {
      const w = createItem(def.weapon, 1, 0.8);
      if (w.state && 'ammo' in w.state) w.state.ammo = def.weapon === 'rifle' ? 4 : 8;
      this.inv.items.push(w);
      this.weaponUid = w.uid;
    }
    for (const [id, q] of def.items) this.inv.items.push(createItem(id, q));
    if (role === 'prisioneiro') this.activity = 'preso';
  }

  rel(who: string): Relation {
    let r = this.relations.get(who);
    if (!r) this.relations.set(who, (r = { confianca: 0, afeto: 0, medo: 0, ressentimento: 0, divida: 0 }));
    return r;
  }

  remembers(kind: MemoryKind, who?: string) {
    return this.memory.some((m) => m.kind === kind && (!who || m.who === who));
  }

  get goal() {
    return this.def.goals[this.goalIdx] ?? null;
  }

  /** Emoção dominante (para falas e rótulos). */
  get mood(): Emotion {
    let best: Emotion = 'felicidade';
    let v = -1;
    for (const e of EMOTIONS) {
      if (e === 'confianca' || e === 'desconfianca') continue;
      if (this.emotions[e] > v) {
        v = this.emotions[e];
        best = e;
      }
    }
    return best;
  }
}
