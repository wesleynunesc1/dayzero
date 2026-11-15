import { CONFIG, TILE } from '../config';
import type { World } from '../world/World';
import type { FactionSite } from '../world/WorldGen';

export type FactionKind = 'militar' | 'civil' | 'hostil' | 'cientistas';

export interface FactionRule {
  id: string;
  text: string;
}

export interface Faction {
  id: string;
  name: string;
  kind: FactionKind;
  /** Chave do NPC líder. */
  leader: string;
  /** Recursos abstratos (sobem com trocas/doações, descem com consumo diário e roubos). */
  resources: { comida: number; agua: number; municao: number; remedios: number };
  /** Ids dos NPCs membros. */
  members: string[];
  /** Relação com outras facções (-100..100). */
  relations: Record<string, number>;
  /** Reputação de cada sobrevivente com a facção (-100..100). */
  reputation: Record<string, number>;
  rules: FactionRule[];
  goals: string[];
  /** Captura invasores em vez de matar? */
  captures: boolean;
  /** Postura inicial com desconhecidos. */
  defaultRep: number;
  site: FactionSite | null;
  /** Avisos já dados a cada sobrevivente (para não repetir). */
  warned: Record<string, number>;
}

const RULES: Record<string, FactionRule[]> = {
  sentinela: [
    { id: 'area_restrita', text: 'Áreas restritas (comando, paiol, detenção) só com autorização.' },
    { id: 'sem_saque', text: 'Nada sai do almoxarifado sem ordem do sargento.' },
    { id: 'invasor_preso', text: 'Invasores são detidos, não executados.' },
  ],
  aurora: [
    { id: 'armas_baixas', text: 'Dentro da escola, armas abaixadas.' },
    { id: 'todos_ajudam', text: 'Quem come, ajuda: comida vem do trabalho de todos.' },
    { id: 'sem_roubo', text: 'Roubar da despensa é expulsão.' },
  ],
  abutres: [
    { id: 'pedagio', text: 'Quem passa pelo Vale paga pedágio.' },
    { id: 'tudo_tem_preco', text: 'Tudo tem preço — inclusive a liberdade.' },
    { id: 'presos_trabalham', text: 'Preso trabalha ou paga para sair.' },
  ],
  vitalis: [
    { id: 'laboratorio', text: 'Ninguém mexe nas amostras sem a doutora.' },
    { id: 'sem_violencia', text: 'Não atiramos em ninguém. Pedimos ajuda à Sentinela.' },
  ],
};

export function createFactions(world: World): Map<string, Faction> {
  const site = (id: string) => world.factionSites.find((s) => s.faction === id) ?? null;
  const list: Faction[] = [
    {
      id: 'sentinela', name: 'Base Sentinela', kind: 'militar', leader: 'sgt_ramos',
      resources: { comida: 60, agua: 70, municao: 80, remedios: 30 }, members: [],
      relations: { aurora: 20, abutres: -70, vitalis: 40 }, reputation: {}, rules: RULES.sentinela,
      goals: ['Manter a base operando', 'Restabelecer contato com o comando', 'Conter os Abutres'],
      captures: true, defaultRep: 0, site: site('sentinela'), warned: {},
    },
    {
      id: 'aurora', name: 'Comunidade Aurora', kind: 'civil', leader: 'dona_celia',
      resources: { comida: 35, agua: 40, municao: 10, remedios: 10 }, members: [],
      relations: { sentinela: 20, abutres: -60, vitalis: 30 }, reputation: {}, rules: RULES.aurora,
      goals: ['Alimentar todos até a colheita', 'Trazer de volta os capturados pelos Abutres'],
      captures: false, defaultRep: 10, site: site('aurora'), warned: {},
    },
    {
      id: 'abutres', name: 'Os Abutres', kind: 'hostil', leader: 'caveira',
      resources: { comida: 50, agua: 40, municao: 45, remedios: 15 }, members: [],
      relations: { sentinela: -70, aurora: -60, vitalis: -20 }, reputation: {}, rules: RULES.abutres,
      goals: ['Controlar o Vale Sombrio', 'Saquear o paiol da Sentinela'],
      captures: true, defaultRep: -45, site: site('abutres'), warned: {},
    },
    {
      id: 'vitalis', name: 'Equipe Vitalis', kind: 'cientistas', leader: 'dra_helena',
      resources: { comida: 20, agua: 25, municao: 2, remedios: 40 }, members: [],
      relations: { sentinela: 40, aurora: 30, abutres: -20 }, reputation: {}, rules: RULES.vitalis,
      goals: ['Reunir os componentes da vacina', 'Religar o laboratório do Instituto'],
      captures: false, defaultRep: 5, site: site('vitalis'), warned: {},
    },
  ];
  return new Map(list.map((f) => [f.id, f]));
}

export function rep(world: World, faction: string, who: string): number {
  const f = world.factions.get(faction);
  if (!f) return 0;
  return f.reputation[who] ?? f.defaultRep;
}

export function repLabel(v: number): string {
  if (v <= -70) return 'Inimigo';
  if (v <= CONFIG.factions.hostileBelow) return 'Hostil';
  if (v < 0) return 'Desconfiada';
  if (v < CONFIG.factions.friendlyAbove) return 'Neutra';
  if (v < 70) return 'Amigável';
  return 'Aliada';
}

/** Altera a reputação de um sobrevivente com uma facção (com aviso ao jogador). */
export function changeRep(world: World, faction: string, who: string, delta: number, reason: string) {
  const f = world.factions.get(faction);
  if (!f || !delta) return;
  const before = rep(world, faction, who);
  const after = Math.max(-100, Math.min(100, before + delta));
  f.reputation[who] = after;
  const p = world.playerById(who);
  if (p) {
    world.withPlayer(p, () => {
      world.msg(`${f.name}: reputação ${delta > 0 ? '+' : ''}${Math.round(delta)} (${reason}) → ${repLabel(after)}.`, delta > 0 ? 'good' : 'warn');
    });
  }
  // facções aliadas/inimigas reagem um pouco (efeito em cadeia, nunca aleatório)
  if (Math.abs(delta) >= 20) {
    for (const [other, rel] of Object.entries(f.relations)) {
      const o = world.factions.get(other);
      if (!o || Math.abs(rel) < 40) continue;
      o.reputation[who] = Math.max(-100, Math.min(100, rep(world, other, who) + delta * 0.25 * Math.sign(rel)));
    }
  }
}

export const inRect = (r: { x0: number; y0: number; x1: number; y1: number }, tx: number, ty: number) => tx >= r.x0 && tx <= r.x1 && ty >= r.y0 && ty <= r.y1;

/** Facção cujo território contém o ponto (px). */
export function territoryAt(world: World, x: number, y: number): Faction | null {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  for (const f of world.factions.values()) if (f.site && inRect(f.site.area, tx, ty)) return f;
  return null;
}

export function inRestricted(f: Faction, x: number, y: number): boolean {
  if (!f.site) return false;
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  return f.site.restricted.some((r) => inRect(r, tx, ty));
}

export function isHostileTo(world: World, faction: string, who: string): boolean {
  return rep(world, faction, who) <= CONFIG.factions.hostileBelow;
}

/** Consumo diário de recursos de cada facção (sem ajuda externa, os recursos caem devagar). */
export function factionDaily(world: World, hours: number) {
  for (const f of world.factions.values()) {
    const alive = f.members.filter((id) => world.npcs.some((n) => n.id === id && n.state !== 'morto')).length;
    const use = (alive * hours) / 24;
    f.resources.comida = Math.max(0, f.resources.comida - use * 1.5);
    f.resources.agua = Math.max(0, f.resources.agua - use * 1.8);
  }
}
