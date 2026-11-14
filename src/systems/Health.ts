import { CONFIG } from '../config';

export type WoundType = 'arranhao' | 'laceracao' | 'mordida';

export const WOUND_LABEL: Record<WoundType, string> = {
  arranhao: 'Arranhão',
  laceracao: 'Laceração',
  mordida: 'Mordida',
};

export interface Wound {
  id: number;
  type: WoundType;
  /** Perda de vida por segundo enquanto sangra. */
  bleed: number;
  treated: boolean;
  /** Tempo restante para cicatrizar após tratado. */
  heal: number;
  /** Arranhões estancam sozinhos depois de algum tempo. */
  clot: number;
}

export type HealthState = 'Saudável' | 'Ferido' | 'Sangrando' | 'Incapacitado' | 'Morto';
export type DeathCause = 'Hemorragia' | 'Ferimentos' | 'Infecção' | '';

let woundId = 1;

/** Saúde, ferimentos, sangramento e infecção (regra da etapa 1: mordida infectante = morte). */
export class Health {
  hp = 100;
  max = 100;
  wounds: Wound[] = [];
  infected = false;
  infection = 0;
  incapacitated = false;
  dead = false;
  deathCause: DeathCause = '';
  painkiller = 0;
  /** Último estágio de infecção comunicado (0..3). */
  infectionStage = 0;

  get bleedRate(): number {
    let b = 0;
    for (const w of this.wounds) b += w.bleed;
    return b;
  }
  get bleeding(): boolean {
    return this.bleedRate > 0.001;
  }

  get state(): HealthState {
    if (this.dead) return 'Morto';
    if (this.incapacitated) return 'Incapacitado';
    if (this.bleeding) return 'Sangrando';
    if (this.wounds.length > 0 || this.hp < 75) return 'Ferido';
    return 'Saudável';
  }

  /** Penalidade de movimento causada por dor (0..0.3). */
  get painSlow(): number {
    if (this.painkiller > 0) return 0;
    let p = 0;
    for (const w of this.wounds) p += w.type === 'arranhao' ? 0.02 : 0.06;
    return Math.min(0.3, p);
  }

  addWound(type: WoundType): Wound {
    const bleedByType: Record<WoundType, number> = { arranhao: 0.14, laceracao: 0.38, mordida: 0.45 };
    const w: Wound = {
      id: woundId++,
      type,
      bleed: bleedByType[type],
      treated: false,
      heal: 0,
      clot: type === 'arranhao' ? 22 : Infinity,
    };
    this.wounds.push(w);
    if (type === 'mordida') this.infected = true;
    return w;
  }

  damage(amount: number) {
    if (this.dead) return;
    this.hp = Math.max(0, this.hp - amount);
  }

  /** Ferimento mais urgente para tratamento. */
  worstUntreated(): Wound | undefined {
    return this.wounds
      .filter((w) => !w.treated)
      .sort((a, b) => b.bleed - a.bleed || (b.type === 'mordida' ? 1 : 0) - (a.type === 'mordida' ? 1 : 0))[0];
  }

  /** Trata um único ferimento. quality >= 0.85 estanca totalmente. */
  treat(w: Wound, quality: number) {
    w.bleed = quality >= 0.85 ? 0 : w.bleed * (1 - quality);
    w.treated = true;
    w.heal = w.type === 'arranhao' ? 40 : w.type === 'laceracao' ? 75 : 95;
  }

  /**
   * Atualiza o estado. Retorna mensagens de eventos relevantes.
   * `fed` indica se fome/sede permitem regeneração.
   */
  update(dt: number, fed: boolean): string[] {
    const msgs: string[] = [];
    if (this.dead) return msgs;
    if (this.painkiller > 0) this.painkiller -= dt;

    // sangramento
    const bleed = this.bleedRate;
    if (bleed > 0) this.hp -= bleed * dt;

    for (let i = this.wounds.length - 1; i >= 0; i--) {
      const w = this.wounds[i];
      if (!w.treated && w.bleed > 0 && isFinite(w.clot)) {
        w.clot -= dt;
        if (w.clot <= 0) {
          w.bleed = 0;
          msgs.push('O arranhão parou de sangrar.');
        }
      }
      if (w.treated) {
        w.heal -= dt;
        if (w.heal <= 0) {
          this.wounds.splice(i, 1);
          msgs.push(`Um ferimento (${WOUND_LABEL[w.type].toLowerCase()}) cicatrizou.`);
        }
      }
    }

    // regeneração lenta
    if (!this.bleeding && fed && !this.infected) {
      const rate = this.incapacitated ? 0.4 : 0.22;
      this.hp = Math.min(this.max, this.hp + rate * dt);
    }

    // infecção: fatal nesta etapa
    if (this.infected) {
      this.infection += dt;
      const inf = CONFIG.infection;
      if (this.infectionStage === 0 && this.infection > 8) {
        this.infectionStage = 1;
        msgs.push('A mordida arde muito. Você sente um frio estranho.');
      }
      if (this.infectionStage === 1 && this.infection > inf.feverAt) {
        this.infectionStage = 2;
        msgs.push('Você está com febre. Seu corpo treme.');
      }
      if (this.infectionStage === 2 && this.infection > inf.highFeverAt) {
        this.infectionStage = 3;
        msgs.push('Febre alta. A visão escurece nas bordas...');
      }
      if (this.infectionStage >= 3) this.hp -= 0.55 * dt;
      if (this.infection >= inf.deathAt) {
        this.hp = 0;
        this.die('Infecção');
        return msgs;
      }
    }

    if (this.hp <= 0) {
      this.hp = 0;
      this.die(this.infected && this.infectionStage >= 3 ? 'Infecção' : bleed > 0 ? 'Hemorragia' : 'Ferimentos');
      return msgs;
    }

    const P = CONFIG.player;
    if (!this.incapacitated && this.hp <= P.incapacitatedHp) {
      this.incapacitated = true;
      msgs.push('Você desabou no chão.');
    } else if (this.incapacitated && !this.bleeding && this.hp >= P.getUpHp) {
      this.incapacitated = false;
      msgs.push('Com esforço, você consegue se levantar.');
    }
    return msgs;
  }

  die(cause: DeathCause) {
    if (this.dead) return;
    this.dead = true;
    this.deathCause = cause;
    this.incapacitated = false;
  }

  /** Reerguido por um aliado: estanca sangramentos e devolve o mínimo para levantar. */
  revive(hpTo: number) {
    for (const w of this.wounds) if (w.bleed > 0) this.treat(w, 1);
    this.hp = Math.max(this.hp, hpTo);
    this.incapacitated = false;
  }
}
