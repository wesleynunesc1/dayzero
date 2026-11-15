import { createItem } from '../data/items';
import { Inventory } from '../systems/Inventory';
import { PathPoint } from '../world/Pathfinder';
import { Actor } from './Actor';

export type AllyMode = 'aguardar' | 'seguir';
export type AllyState = 'parado' | 'seguindo' | 'combate' | 'socorrendo' | 'recuando' | 'morto' | 'npc';

export const ALLY_STATE_LABEL: Record<AllyState, string> = {
  parado: 'Aguardando',
  seguindo: 'Seguindo você',
  combate: 'Lutando',
  socorrendo: 'Socorrendo',
  recuando: 'Recuando',
  morto: 'Morto',
  npc: 'Por conta própria',
};

/** NPC aliado simples (base do futuro sistema de aliados). */
export class Ally extends Actor {
  name: string;
  mode: AllyMode = 'aguardar';
  state: AllyState = 'parado';
  hp = 100;
  maxHp = 100;
  inv = new Inventory(15, 12);
  weaponUid: string;
  /** Zumbis percebidos: id -> última posição conhecida e momento. */
  known = new Map<string, { x: number; y: number; t: number }>();
  lastPlayerSeen: { x: number; y: number; t: number } | null = null;
  path: PathPoint[] | null = null;
  pathIdx = 0;
  repathT = 0;
  pathGoal: { x: number; y: number } | null = null;
  attackCd = 0;
  senseT = 0;
  rescueT = 0;
  speakCd = 0;
  doorT = 0;
  /** Recebeu um pedido de socorro (grito). */
  heardCall: { x: number; y: number; t: number } | null = null;
  /** Sobrevivente que deu a última ordem (seguir/aguardar). */
  leaderId: string | null = null;

  constructor(x: number, y: number, fixedId?: string) {
    super('a', x, y, {
      skin: '#a8826a',
      hair: '#8d8a84',
      hairStyle: 0,
      shirt: '#4a5866',
      pants: '#3a3a36',
      shoes: '#2a2624',
      overlay: { color: '#55606b', kind: 'jacket' },
      gore: 0,
    }, fixedId);
    this.name = 'Elias';
    this.radius = 4.5;
    const pipe = createItem('cano_ferro', 1, 0.8);
    this.weaponUid = pipe.uid;
    this.inv.add(pipe);
    const kit = createItem('kit_medico');
    kit.state = { uses: 2 };
    this.inv.add(kit);
    this.inv.add(createItem('barra_cereal', 2));
  }

  get alive2() {
    return this.state !== 'morto';
  }

  medkit() {
    return this.inv.items.find((i) => (i.defId === 'kit_medico' && (i.state?.uses ?? 0) > 0) || i.defId === 'bandagem');
  }
}
