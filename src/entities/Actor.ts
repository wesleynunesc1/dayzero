/** Aparência de um humano (vivo ou infectado). Cores já dessaturadas. */
export interface Appearance {
  skin: string;
  hair: string;
  /** 0 = curto, 1 = longo, 2 = careca, 3 = boné */
  hairStyle: number;
  shirt: string;
  pants: string;
  shoes: string;
  /** Detalhe no tronco: colete, avental, jaqueta... */
  overlay?: { color: string; kind: 'vest' | 'apron' | 'jacket' | 'uniform' | 'backpack' };
  /** Manchas de sangue (0..1). */
  gore: number;
}

let nextId = 1;
export const newId = (prefix: string) => `${prefix}${nextId++}`;

/** Base de qualquer personagem que se move no mundo. */
export abstract class Actor {
  readonly id: string;
  x: number;
  y: number;
  /** Velocidade desejada (definida pela IA ou controle). */
  vx = 0;
  vy = 0;
  /** Impulso externo (empurrões). */
  kx = 0;
  ky = 0;
  radius = 5;
  facing = 0;
  alive = true;
  moving = false;
  walkPhase = 0;
  /** Animações / reações. */
  attackAnim = 0;
  attackDur = 0.25;
  hurtFlash = 0;
  stagger = 0;
  /** Caído temporariamente (empurrão forte). */
  knockedDown = 0;
  look: Appearance;

  constructor(prefix: string, x: number, y: number, look: Appearance) {
    this.id = newId(prefix);
    this.x = x;
    this.y = y;
    this.look = look;
  }

  push(dirX: number, dirY: number, force: number) {
    this.kx += dirX * force;
    this.ky += dirY * force;
  }

  /** Atualiza temporizadores visuais comuns. */
  tickTimers(dt: number) {
    if (this.attackAnim > 0) this.attackAnim = Math.max(0, this.attackAnim - dt);
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    if (this.stagger > 0) this.stagger = Math.max(0, this.stagger - dt);
    if (this.knockedDown > 0) this.knockedDown = Math.max(0, this.knockedDown - dt);
  }
}
