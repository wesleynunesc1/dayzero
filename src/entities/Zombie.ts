import { RNG } from '../engine/math';
import { PathPoint } from '../world/Pathfinder';
import { Actor, Appearance } from './Actor';

export type ZombieType = 'comum' | 'rapido' | 'debilitado';

/** Estados da máquina de estados da IA (ver systems/ZombieAI.ts). */
export type ZombieState =
  | 'vagar'
  | 'investigar'
  | 'identificar'
  | 'perseguir'
  | 'atacar'
  | 'procurar'
  | 'retornar';

export const ZSTATE_LABEL: Record<ZombieState, string> = {
  vagar: 'Vagar',
  investigar: 'Investigar barulho',
  identificar: 'Identificar',
  perseguir: 'Perseguir',
  atacar: 'Atacar',
  procurar: 'Procurar',
  retornar: 'Retornar',
};

export interface ZombieStats {
  hp: number;
  wander: number;
  investigate: number;
  chase: number;
  /** Tempo de reconhecimento antes de perseguir. */
  identify: number;
  /** Ganho de "percepção" por segundo ao ver um humano. */
  awareGain: number;
  visionMul: number;
  hearingMul: number;
  windup: number;
  attackCd: number;
  reach: number;
  biteChance: number;
  hitChance: number;
}

export const ZOMBIE_STATS: Record<ZombieType, ZombieStats> = {
  comum: { hp: 60, wander: 13, investigate: 21, chase: 34, identify: 0.7, awareGain: 1.4, visionMul: 1, hearingMul: 1, windup: 0.5, attackCd: 1.25, reach: 7, biteChance: 0.1, hitChance: 0.7 },
  rapido: { hp: 42, wander: 22, investigate: 40, chase: 74, identify: 0.18, awareGain: 3.2, visionMul: 1.25, hearingMul: 1.3, windup: 0.32, attackCd: 0.9, reach: 7, biteChance: 0.12, hitChance: 0.75 },
  debilitado: { hp: 35, wander: 6, investigate: 9, chase: 12, identify: 1, awareGain: 1, visionMul: 0.7, hearingMul: 0.9, windup: 0.6, attackCd: 1.5, reach: 6, biteChance: 0.2, hitChance: 0.6 },
};

const SKINS = ['#8f9a83', '#9a9c88', '#7f8a78', '#a0998a', '#868f84', '#958a7a'];
const HAIR = ['#2a231e', '#3e3328', '#5b4a38', '#6f6a62', '#1f1d1b', '#7a5a3a'];
const SHIRTS = ['#5b6b7a', '#7a5b4f', '#6e6a55', '#4f5d4a', '#7b7466', '#5a4f62', '#8a7d6b', '#6b4c4c', '#4d5862', '#857d73'];
const PANTS = ['#3b4350', '#4a4038', '#2f3236', '#55524a', '#3e4a3e'];

export function zombieLook(rng: RNG, outfit?: string): Appearance {
  const look: Appearance = {
    skin: rng.pick(SKINS),
    hair: rng.pick(HAIR),
    hairStyle: rng.int(0, 2),
    shirt: rng.pick(SHIRTS),
    pants: rng.pick(PANTS),
    shoes: '#2a2624',
    gore: rng.range(0.2, 0.9),
  };
  if (outfit === 'policia') {
    look.shirt = '#3b4658';
    look.pants = '#2b3240';
    look.overlay = { color: '#2a2e33', kind: 'vest' };
    look.hairStyle = rng.chance(0.5) ? 3 : 0;
    look.hair = rng.chance(0.5) ? '#2b3240' : look.hair;
  } else if (outfit === 'mercado') {
    look.overlay = { color: '#7a3f35', kind: 'apron' };
  } else if (outfit === 'operario') {
    look.shirt = '#6d5d3a';
    look.pants = '#4a4433';
    look.overlay = { color: '#8a7a3a', kind: 'vest' };
  }
  return look;
}

export class Zombie extends Actor {
  stats: ZombieStats;
  hp: number;
  state: ZombieState = 'vagar';
  stateT = 0;
  home: { x: number; y: number };
  horde: number;
  /** Alvo humano atual (id). */
  targetId: string | null = null;
  lastKnown: { x: number; y: number } | null = null;
  lastKnownVel = { x: 0, y: 0 };
  awareness = 0;
  /** Segundos desde que viu o alvo pela última vez. */
  lostT = 0;
  path: PathPoint[] | null = null;
  pathIdx = 0;
  pathGoal: { x: number; y: number } | null = null;
  repathT = 0;
  wantPath = false;
  goal: { x: number; y: number } | null = null;
  waitT = 0;
  attackWind = 0;
  attackCd = 0;
  searchT = 0;
  searchLeft = 0;
  thinkT = 0;
  senseT = 0;
  groanT = 0;
  stuckT = 0;
  lastX = 0;
  lastY = 0;
  bashT = 0;
  /** Pontos de dano visual (feridas). */
  crawler: boolean;
  /** Para depuração/teste: último ruído ouvido. */
  heard: { x: number; y: number; t: number } | null = null;

  constructor(x: number, y: number, public ztype: ZombieType, look: Appearance, horde = -1) {
    super('z', x, y, look);
    this.stats = ZOMBIE_STATS[ztype];
    this.hp = this.stats.hp;
    this.home = { x, y };
    this.horde = horde;
    this.crawler = ztype === 'debilitado';
    this.radius = this.crawler ? 5.5 : 4.8;
    this.facing = Math.random() * Math.PI * 2;
    this.lastX = x;
    this.lastY = y;
    this.thinkT = Math.random() * 0.3;
    this.senseT = Math.random() * 0.2;
    this.groanT = 3 + Math.random() * 8;
  }

  setState(s: ZombieState) {
    if (this.state === s) return;
    this.state = s;
    this.stateT = 0;
    this.path = null;
    this.goal = null;
    this.attackWind = 0;
    if (s === 'identificar' || s === 'perseguir') this.lostT = 0;
  }
}
