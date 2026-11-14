import { CONFIG } from '../config';
import type { Player } from '../entities/Player';

/**
 * Fome, sede, fadiga e mal-estar. Todos evoluem com o RELÓGIO DO MUNDO (horas de jogo),
 * aumentam com esforço físico e produzem fraqueza gradual — nunca perda de vida instantânea.
 * Escala: 0 = satisfeito/descansado, 100 = extremo.
 */

export type Tone = 'ok' | 'warn' | 'bad';

export function hungerLevel(h: number): { label: string; tone: Tone } {
  if (h < 30) return { label: 'Alimentado', tone: 'ok' };
  if (h < 60) return { label: 'Com um pouco de fome', tone: 'ok' };
  if (h < 75) return { label: 'Com fome', tone: 'warn' };
  if (h < 90) return { label: 'Faminto', tone: 'warn' };
  if (h < 100) return { label: 'Desnutrido', tone: 'bad' };
  return { label: 'Inanição', tone: 'bad' };
}

export function thirstLevel(t: number): { label: string; tone: Tone } {
  if (t < 30) return { label: 'Hidratado', tone: 'ok' };
  if (t < 60) return { label: 'Com um pouco de sede', tone: 'ok' };
  if (t < 75) return { label: 'Com sede', tone: 'warn' };
  if (t < 90) return { label: 'Desidratado', tone: 'warn' };
  if (t < 100) return { label: 'Desidratação grave', tone: 'bad' };
  return { label: 'Desidratação extrema', tone: 'bad' };
}

export function fatigueLevel(f: number): { label: string; tone: Tone } {
  if (f < 40) return { label: 'Descansado', tone: 'ok' };
  if (f < 60) return { label: 'Um pouco cansado', tone: 'ok' };
  if (f < 80) return { label: 'Cansado', tone: 'warn' };
  if (f < 95) return { label: 'Exausto', tone: 'bad' };
  return { label: 'Esgotado', tone: 'bad' };
}

export interface NeedModifiers {
  /** Fôlego máximo (resistência de curto prazo). */
  staminaMax: number;
  staminaRegen: number;
  runSpeed: number;
  walkSpeed: number;
  meleeDamage: number;
  canRun: boolean;
}

/** Efeitos combinados de fome, sede, fadiga e mal-estar sobre a capacidade física. */
export function needModifiers(p: Player): NeedModifiers {
  const m: NeedModifiers = { staminaMax: 1, staminaRegen: 1, runSpeed: 1, walkSpeed: 1, meleeDamage: 1, canRun: true };
  const h = p.hunger;
  if (h >= 75) {
    m.staminaMax -= 0.15;
    m.staminaRegen -= 0.25;
  }
  if (h >= 90) {
    m.staminaMax -= 0.2;
    m.staminaRegen -= 0.25;
    m.meleeDamage -= 0.2;
  }
  const t = p.thirst;
  if (t >= 75) {
    m.staminaMax -= 0.2;
    m.staminaRegen -= 0.3;
  }
  if (t >= 90) {
    m.staminaMax -= 0.2;
    m.walkSpeed -= 0.1;
    m.runSpeed -= 0.15;
  }
  const f = p.fatigue;
  if (f >= 60) {
    m.runSpeed -= 0.1;
    m.staminaRegen -= 0.25;
  }
  if (f >= 80) {
    m.runSpeed -= 0.15;
    m.staminaRegen -= 0.25;
    m.staminaMax -= 0.2;
  }
  if (f >= 95) m.canRun = false;
  if (p.sickHours > 0) {
    m.staminaRegen -= 0.3;
    m.meleeDamage -= 0.1;
  }
  m.staminaMax = Math.max(0.25, m.staminaMax);
  m.staminaRegen = Math.max(0.1, m.staminaRegen);
  m.runSpeed = Math.max(0.5, m.runSpeed);
  m.walkSpeed = Math.max(0.6, m.walkSpeed);
  m.meleeDamage = Math.max(0.5, m.meleeDamage);
  return m;
}

export interface NeedsContext {
  hours: number;
  running: boolean;
  sleeping: boolean;
  /** Fração da capacidade de carga usada. */
  loadFrac: number;
}

/**
 * Atualiza as necessidades. Retorna mensagens de transição de estado e,
 * se for o caso, a causa de morte por consequência extrema.
 */
export function updateNeeds(p: Player, c: NeedsContext): { msgs: string[]; death?: 'Fome' | 'Desidratação' } {
  const N = CONFIG.needs;
  const msgs: string[] = [];
  let mul = c.sleeping ? N.sleepingMul : 1;
  if (c.running) mul *= N.runMul;
  const heavy = c.loadFrac > N.heavyLoadFrac ? N.heavyLoadMul : 1;
  const prevH = hungerLevel(p.hunger).label;
  const prevT = thirstLevel(p.thirst).label;
  const prevF = fatigueLevel(p.fatigue).label;

  p.hunger = Math.min(100, p.hunger + N.hungerPerHour * c.hours * mul * heavy);
  p.thirst = Math.min(100, p.thirst + N.thirstPerHour * c.hours * mul * heavy * (p.sickHours > 0 ? 1.5 : 1));
  if (!c.sleeping) p.fatigue = Math.min(100, p.fatigue + N.fatiguePerHour * c.hours * (c.running ? 1.8 : 1) * heavy);

  if (p.sickHours > 0) {
    p.sickHours = Math.max(0, p.sickHours - c.hours);
    p.health.damage(N.sickHpPerHour * c.hours);
    if (p.sickHours === 0) msgs.push('O mal-estar passou.');
  }

  // consequências extremas: graduais
  let death: 'Fome' | 'Desidratação' | undefined;
  if (p.hunger >= 100) p.health.damage(N.starvationHpPerHour * c.hours);
  if (p.thirst >= 100) p.health.damage(N.dehydrationHpPerHour * c.hours);
  if (p.health.hp <= 0 && !p.health.dead) {
    death = p.thirst >= 100 ? 'Desidratação' : p.hunger >= 100 ? 'Fome' : undefined;
  }

  const nh = hungerLevel(p.hunger);
  const nt = thirstLevel(p.thirst);
  const nf = fatigueLevel(p.fatigue);
  if (nh.label !== prevH && nh.tone !== 'ok') msgs.push(`Você está ${nh.label.toLowerCase()}.`);
  if (nt.label !== prevT && nt.tone !== 'ok') msgs.push(`${nt.label === 'Com sede' ? 'Você está com sede' : nt.label}.`);
  if (nf.label !== prevF && nf.tone !== 'ok' && !c.sleeping) msgs.push(`Você está ${nf.label.toLowerCase()}. Procure um lugar seguro para dormir.`);
  return { msgs, death };
}

/** Hidratação/alimentação "suficientes" para regenerar vida. */
export function isFed(p: Player) {
  return p.hunger < 85 && p.thirst < 85;
}
