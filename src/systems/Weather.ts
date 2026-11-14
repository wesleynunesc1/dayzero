import { CONFIG } from '../config';
import type { RNG } from '../engine/math';

export type WeatherKind = 'limpo' | 'chuva' | 'neblina';

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  limpo: 'Tempo limpo',
  chuva: 'Chuva',
  neblina: 'Neblina',
};

/**
 * Controlador de clima modular. Mantém a condição atual, faz transições suaves
 * (intensidades 0..1) e expõe multiplicadores consumidos pelos outros sistemas.
 * Para adicionar uma condição nova: incluí-la em WeatherKind, CONFIG.weather e nos getters.
 */
export class WeatherController {
  kind: WeatherKind = 'limpo';
  /** Horas de jogo restantes na condição atual. */
  hoursLeft = 4;
  rain = 0;
  fog = 0;
  /** Condição forçada (testes/depuração) — não muda sozinha. */
  locked = false;

  constructor(private rng: RNG) {
    this.hoursLeft = rng.range(2, 5);
  }

  set(kind: WeatherKind, hours?: number, instant = false) {
    this.kind = kind;
    const [a, b] = CONFIG.weather.durationHours[kind];
    this.hoursLeft = hours ?? this.rng.range(a, b);
    if (instant) {
      this.rain = kind === 'chuva' ? 1 : 0;
      this.fog = kind === 'neblina' ? 1 : 0;
    }
  }

  private pickNext(): WeatherKind {
    if (this.kind !== 'limpo') return 'limpo';
    const r = this.rng.next();
    const c = CONFIG.weather.nextChance;
    if (r < c.chuva) return 'chuva';
    if (r < c.chuva + c.neblina) return 'neblina';
    return 'limpo';
  }

  /** dtReal em segundos reais (transição visual), hours em horas de jogo. Retorna a nova condição quando muda. */
  update(dtReal: number, hours: number): WeatherKind | null {
    let changed: WeatherKind | null = null;
    if (!this.locked) {
      this.hoursLeft -= hours;
      if (this.hoursLeft <= 0) {
        const next = this.pickNext();
        const prev = this.kind;
        this.set(next);
        if (next !== prev) changed = next;
      }
    }
    const k = Math.min(1, dtReal * 0.25 + hours * 2);
    this.rain += ((this.kind === 'chuva' ? 1 : 0) - this.rain) * k;
    this.fog += ((this.kind === 'neblina' ? 1 : 0) - this.fog) * k;
    return changed;
  }

  /** Multiplicador do raio de ruído (chuva abafa sons). */
  get noiseMul() {
    return 1 - (1 - CONFIG.weather.rainNoiseMul) * this.rain;
  }
  /** Multiplicador do alcance de visão (zumbis, aliado e jogador). */
  get visionMul() {
    const W = CONFIG.weather;
    return (1 - (1 - W.rainVisionMul) * this.rain) * (1 - (1 - W.fogVisionMul) * this.fog);
  }
}
