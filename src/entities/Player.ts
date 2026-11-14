import { CONFIG } from '../config';
import { FISTS, itemDef, ItemInstance, WeaponStats } from '../data/items';
import { Health } from '../systems/Health';
import { Inventory } from '../systems/Inventory';
import { Actor, Appearance } from './Actor';

/** Ação com duração (usar kit, recarregar, revistar...). */
export interface TimedAction {
  kind: string;
  label: string;
  t: number;
  dur: number;
  /** Se o jogador pode andar durante a ação (devagar). */
  allowMove: boolean;
  onDone: () => void;
  onCancel?: () => void;
}

export type EquipSlot = 'arma' | 'corpo' | 'costas';

export interface SleepState {
  spot: 'cama' | 'sofa' | 'banco';
  x: number;
  y: number;
  /** Minuto de jogo em que começou. */
  start: number;
  /** Horas máximas (descanso curto) ou até recuperar. */
  maxHours: number;
  hpAtStart: number;
}

export const PLAYER_LOOK: Appearance = {
  skin: '#c49a7c',
  hair: '#2f2620',
  hairStyle: 0,
  shirt: '#5d6a58',
  pants: '#3b4350',
  shoes: '#2a2624',
  gore: 0,
};

export class Player extends Actor {
  name = 'Sobrevivente';
  health = new Health();
  inv = new Inventory(CONFIG.player.baseCarryKg, CONFIG.player.baseSlots);
  equipped: Record<EquipSlot, string | null> = { arma: null, corpo: null, costas: null };
  stamina = CONFIG.player.staminaMax;
  hunger = 12;
  thirst = 15;
  crouch = false;
  running = false;
  aiming = false;
  attackCd = 0;
  stepNoiseT = 0;
  action: TimedAction | null = null;
  aimX = 0;
  aimY = 0;
  /** Recipiente aberto na interface (id). */
  openContainer: string | null = null;
  /** Última posição sem zumbis por perto (para a regra de retorno "última localização"). */
  lastSafePos = { x: 0, y: 0 };
  safeCheckT = 0;
  deaths = 0;
  muzzleT = 0;
  /** Fala/chamado de socorro recente. */
  shoutCd = 0;
  /** Contador de danos recebidos (para efeitos de tela). */
  hurtPulse = 0;
  /** Fadiga acumulada (0 descansado … 100 esgotado) — diferente do fôlego de curto prazo. */
  fatigue = 15;
  /** Horas de jogo restantes de mal-estar (comida estragada / água não tratada). */
  sickHours = 0;
  /** Sono/descanso em andamento. */
  sleep: SleepState | null = null;
  /** Veículo em que o jogador está (id), ou null a pé. */
  vehicleId: string | null = null;

  constructor(x: number, y: number) {
    super('p', x, y, { ...PLAYER_LOOK });
    this.radius = 4.5;
    this.lastSafePos = { x, y };
  }

  item(slot: EquipSlot): ItemInstance | null {
    const uid = this.equipped[slot];
    return uid ? this.inv.get(uid) ?? null : null;
  }

  get weaponItem(): ItemInstance | null {
    return this.item('arma');
  }

  get weapon(): WeaponStats {
    const it = this.weaponItem;
    return it ? itemDef(it.defId).weapon ?? FISTS : FISTS;
  }

  get armor(): { armor: number; biteProtect: number } {
    const it = this.item('corpo');
    const w = it ? itemDef(it.defId).wear : undefined;
    return w ?? { armor: 0, biteProtect: 0 };
  }

  /** Lanterna ligada e com bateria (em qualquer lugar do inventário). */
  get flashlight(): ItemInstance | null {
    for (const it of this.inv.items) {
      if (itemDef(it.defId).light && it.state?.on && (it.state.battery ?? 0) > 0) return it;
    }
    return null;
  }

  get isDown(): boolean {
    return this.health.incapacitated;
  }

  get dead(): boolean {
    return this.health.dead;
  }

  /** Recalcula bônus de mochila. */
  refreshCapacity() {
    const bag = this.item('costas');
    const b = bag ? itemDef(bag.defId).backpack : undefined;
    this.inv.extraWeight = b?.weight ?? 0;
    this.inv.extraSlots = b?.slots ?? 0;
  }

  /** Remove referências de equipamento para itens que saíram do inventário. */
  validateEquipment() {
    for (const s of Object.keys(this.equipped) as EquipSlot[]) {
      const uid = this.equipped[s];
      if (uid && !this.inv.get(uid)) this.equipped[s] = null;
    }
    this.refreshCapacity();
  }

  isEquipped(uid: string): EquipSlot | null {
    for (const s of Object.keys(this.equipped) as EquipSlot[]) if (this.equipped[s] === uid) return s;
    return null;
  }
}
