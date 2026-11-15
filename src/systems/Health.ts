import { CONFIG } from '../config';

export type WoundType = 'arranhao' | 'laceracao' | 'mordida';

export const WOUND_LABEL: Record<WoundType, string> = {
  arranhao: 'Arranhão',
  laceracao: 'Laceração',
  mordida: 'Mordida',
};

/** Leve = arranhão; grave = laceração ou mordida. Define quais tratamentos servem. */
export const WOUND_SEVERITY: Record<WoundType, 'leve' | 'grave'> = {
  arranhao: 'leve',
  laceracao: 'grave',
  mordida: 'grave',
};

export interface Wound {
  id: number;
  type: WoundType;
  /** Perda de vida por segundo enquanto sangra. */
  bleed: number;
  treated: boolean;
  /** Tempo restante (s) para cicatrizar após tratado. */
  heal: number;
  /** Arranhões estancam sozinhos depois de algum tempo. */
  clot: number;
  /** Tratado com material não estéril: não cicatriza e pode infeccionar até ser limpo. */
  dirty: boolean;
  /** Horas de jogo sujo. */
  dirtyHours: number;
  /** Infecção bacteriana do ferimento (NÃO é o vírus zumbi; tratável com antisséptico/kit). */
  infected: boolean;
}

export type HealthState = 'Saudável' | 'Ferido' | 'Ferido gravemente' | 'Sangrando' | 'Incapacitado' | 'Morto';
export type DeathCause = 'Hemorragia' | 'Ferimentos' | 'Infecção' | 'Fome' | 'Desidratação' | '';

let woundId = 1;

/**
 * Saúde, ferimentos, sangramento e infecção.
 * Regra da história: se um ataque TRANSMITE o vírus, a morte é imediata (CONFIG.infection).
 */
export class Health {
  hp = 100;
  max = 100;
  wounds: Wound[] = [];
  /** Vírus zumbi transmitido (fatal). */
  infected = false;
  /** Recebeu a vacina (efeito decidido por CONFIG.infection.afterVaccine). */
  vaccinated = false;
  /** Segundos restantes até a morte, quando deathDelaySec > 0. */
  infectionTimer = 0;
  incapacitated = false;
  dead = false;
  deathCause: DeathCause = '';
  painkiller = 0;

  get bleedRate(): number {
    let b = 0;
    for (const w of this.wounds) b += w.bleed;
    return b;
  }
  get bleeding(): boolean {
    return this.bleedRate > 0.001;
  }
  get hasGrave(): boolean {
    return this.wounds.some((w) => WOUND_SEVERITY[w.type] === 'grave' && !w.treated);
  }

  get state(): HealthState {
    if (this.dead) return 'Morto';
    if (this.incapacitated) return 'Incapacitado';
    if (this.bleeding) return 'Sangrando';
    if (this.hasGrave || this.hp < 45) return 'Ferido gravemente';
    if (this.wounds.length > 0 || this.hp < 80) return 'Ferido';
    return 'Saudável';
  }

  /** Penalidade de movimento causada por dor (0..0.3). */
  get painSlow(): number {
    if (this.painkiller > 0) return 0;
    let p = 0;
    for (const w of this.wounds) p += WOUND_SEVERITY[w.type] === 'leve' ? 0.02 : 0.06;
    return Math.min(0.3, p);
  }

  /**
   * Adiciona um ferimento. `transmitRoll` (0..1) decide se o ataque transmitiu o vírus,
   * segundo a probabilidade configurada para o tipo de ferimento.
   */
  addWound(type: WoundType, transmitRoll = 1): Wound {
    const bleedByType: Record<WoundType, number> = { arranhao: 0.14, laceracao: 0.38, mordida: 0.45 };
    const w: Wound = {
      id: woundId++,
      type,
      bleed: bleedByType[type],
      treated: false,
      heal: 0,
      clot: type === 'arranhao' ? 22 : Infinity,
      dirty: false,
      dirtyHours: 0,
      infected: false,
    };
    this.wounds.push(w);
    let chance = CONFIG.infection.transmission[type] ?? 0;
    // regra pós-vacina (configurável; ver CONFIG.infection.afterVaccine)
    if (this.vaccinated) {
      const rule = CONFIG.infection.afterVaccine;
      if (rule === 'imune') chance = 0;
      else if (rule === 'resistente') chance = Math.min(chance, CONFIG.infection.transmissaoResistente);
    }
    if (!this.infected && transmitRoll < chance) {
      this.infected = true;
      this.infectionTimer = CONFIG.infection.deathDelaySec;
      if (this.infectionTimer <= 0) {
        this.hp = 0;
        this.die('Infecção');
      }
    }
    return w;
  }

  damage(amount: number) {
    if (this.dead) return;
    this.hp = Math.max(0, this.hp - amount);
  }

  /** Ferimento mais urgente para um tipo de tratamento. */
  bestTarget(kind: 'kit' | 'bandage' | 'improvised' | 'rag' | 'curativo' | 'antisseptico'): Wound | undefined {
    const ws = this.wounds;
    if (kind === 'antisseptico') return ws.find((w) => w.infected) ?? ws.find((w) => w.dirty);
    if (kind === 'curativo') return ws.find((w) => !w.treated && WOUND_SEVERITY[w.type] === 'leve');
    const open = ws.filter((w) => !w.treated || (w.bleed > 0 && kind !== 'rag'));
    if (kind === 'kit' && open.length === 0) return ws.find((w) => w.dirty || w.infected);
    return open.sort((a, b) => b.bleed - a.bleed)[0];
  }

  /** Por que o item não serve agora (ou null se serve). */
  treatBlocker(kind: 'kit' | 'bandage' | 'improvised' | 'rag' | 'curativo' | 'antisseptico'): string | null {
    if (this.bestTarget(kind)) return null;
    if (kind === 'curativo' && this.wounds.some((w) => !w.treated)) return 'O curativo só serve para ferimentos leves.';
    if (kind === 'antisseptico') return 'Nenhum ferimento sujo ou infeccionado.';
    return 'Nenhum ferimento precisa deste tratamento.';
  }

  /** Aplica um tratamento a um único ferimento. */
  treat(w: Wound, kind: 'kit' | 'bandage' | 'improvised' | 'rag' | 'curativo' | 'antisseptico', quality: number) {
    if (kind === 'antisseptico') {
      w.dirty = false;
      w.dirtyHours = 0;
      w.infected = false;
      return;
    }
    w.bleed = quality >= 0.85 ? 0 : w.bleed * (1 - quality);
    w.treated = true;
    w.heal = w.type === 'arranhao' ? 40 : w.type === 'laceracao' ? 75 : 95;
    if (kind === 'kit') {
      w.dirty = false;
      w.infected = false;
    } else if (kind === 'improvised' || kind === 'rag') w.dirty = true;
  }

  /**
   * Atualiza o estado. dt em segundos reais, hours = horas de jogo passadas neste passo.
   * `fed` indica se fome/sede permitem regeneração.
   */
  update(dt: number, fed: boolean, hours = 0): string[] {
    const msgs: string[] = [];
    if (this.dead) return msgs;
    if (this.painkiller > 0) this.painkiller -= dt;

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
      if (w.dirty) {
        w.dirtyHours += hours;
        if (!w.infected && w.dirtyHours >= CONFIG.wounds.dirtyInfectAfterHours) {
          w.infected = true;
          msgs.push(`O ferimento (${WOUND_LABEL[w.type].toLowerCase()}) infeccionou. Limpe com antisséptico.`);
        }
      }
      if (w.infected) this.hp -= CONFIG.wounds.infectedHpPerHour * hours;
      // ferimento sujo não cicatriza
      if (w.treated && !w.dirty) {
        w.heal -= dt;
        if (w.heal <= 0) {
          this.wounds.splice(i, 1);
          msgs.push(`Um ferimento (${WOUND_LABEL[w.type].toLowerCase()}) cicatrizou.`);
        }
      }
    }

    if (!this.bleeding && fed && !this.infected && !this.wounds.some((w) => w.infected)) {
      const rate = this.incapacitated ? 0.4 : 0.22;
      this.hp = Math.min(this.max, this.hp + rate * dt);
    }

    if (this.infected && CONFIG.infection.deathDelaySec > 0) {
      this.infectionTimer -= dt;
      if (this.infectionTimer <= 0) {
        this.hp = 0;
        this.die('Infecção');
        return msgs;
      }
    }

    if (this.hp <= 0) {
      this.hp = 0;
      this.die(bleed > 0 ? 'Hemorragia' : 'Ferimentos');
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
    for (const w of this.wounds) if (w.bleed > 0) this.treat(w, 'bandage', 1);
    this.hp = Math.max(this.hp, hpTo);
    this.incapacitated = false;
  }
}
