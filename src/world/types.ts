import { Inventory } from '../systems/Inventory';
import { Appearance } from '../entities/Actor';

/** Objeto estático do cenário (móveis, carros, entulho...). Coordenadas em tiles. */
export interface Prop {
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  solid: boolean;
  color?: string;
  variant: number;
  /** Para carros: orientação vertical. */
  vertical?: boolean;
  burned?: boolean;
  containerId?: string;
  name?: string;
  desc?: string;
  /** Combustível restante no tanque (veículos abandonados; retirável com mangueira). */
  fuel?: number;
}

/** Fonte de água do ambiente (barril de chuva, caixa d'água). Água NÃO tratada. */
export interface WaterSource {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Litros atuais e capacidade. */
  liters: number;
  capacity: number;
  /** Recolhe água da chuva. */
  collectsRain: boolean;
}

/** Recipiente com itens. Pode estar ligado a um móvel (tiles) ou a um corpo (pixels). */
export interface Container {
  id: string;
  kind: string;
  name: string;
  /** Área em tiles (para móveis). */
  x: number;
  y: number;
  w: number;
  h: number;
  inv: Inventory;
  searched: boolean;
  building: number;
  /** Facção dona do recipiente (pegar sem permissão é roubo). */
  owner?: string;
}

export interface Corpse {
  id: string;
  x: number;
  y: number;
  facing: number;
  look: Appearance;
  name: string;
  isPlayer: boolean;
  zombie: boolean;
  /** Pilha de itens descartados no chão (não é um corpo). */
  pile?: boolean;
  container: Container;
}

export interface Tree {
  x: number;
  y: number;
  r: number;
  variant: number;
}

export interface LightSource {
  x: number;
  y: number;
  r: number;
  color: string;
  flicker: number;
  kind: 'lamp' | 'fire';
}

export interface Decal {
  x: number;
  y: number;
  kind: 'blood' | 'blood_dry' | 'oil' | 'leaves' | 'trash' | 'paper' | 'glass' | 'casing' | 'rug' | 'splinters' | 'cracks' | 'moss';
  r: number;
  rot: number;
  seed: number;
  color?: string;
}

export interface Building {
  id: number;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  roof: string;
  roofKind: 'gable' | 'flat';
  kind: 'casa' | 'mercantil' | 'delegacia' | 'deposito';
}

export interface SafePoint {
  id: string;
  name: string;
  x: number;
  y: number;
  building: number;
  discovered: boolean;
  lastVisit: number;
}

export interface MapLabel {
  text: string;
  x: number;
  y: number;
}

export interface ZombieSpawn {
  x: number;
  y: number;
  type: 'comum' | 'rapido' | 'debilitado';
  outfit?: 'policia' | 'mercado' | 'operario' | 'casual' | 'militar' | 'medico' | 'cientista';
  horde?: number;
}
