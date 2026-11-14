/**
 * Entrada baseada em ações. Teclado e mouse são apenas "fontes";
 * controles de toque podem ser adicionados futuramente como outra fonte
 * que alimenta as mesmas ações, sem alterar a lógica do jogo.
 */
export type Action =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'run'
  | 'crouch'
  | 'interact'
  | 'inventory'
  | 'map'
  | 'reload'
  | 'pause'
  | 'attack'
  | 'aim'
  | 'health'
  | 'opt1'
  | 'opt2'
  | 'opt3'
  | 'opt4';

const KEYMAP: Record<string, Action> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'run',
  ShiftRight: 'run',
  KeyC: 'crouch',
  KeyE: 'interact',
  KeyI: 'inventory',
  KeyM: 'map',
  KeyR: 'reload',
  Escape: 'pause',
  KeyH: 'health',
  Digit1: 'opt1',
  Digit2: 'opt2',
  Digit3: 'opt3',
  Digit4: 'opt4',
};

export class Input {
  private down = new Set<Action>();
  private pressed = new Set<Action>();
  /** Posição do mouse em pixels CSS relativos ao canvas. */
  mouseX = 0;
  mouseY = 0;
  mouseInside = false;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat) this.pressed.add(a);
      this.down.add(a);
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.down.delete(a);
    });
    window.addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('mousemove', (e) => this.updateMouse(e));
    canvas.addEventListener('mouseenter', () => (this.mouseInside = true));
    canvas.addEventListener('mouseleave', () => (this.mouseInside = false));
    canvas.addEventListener('mousedown', (e) => {
      this.updateMouse(e);
      const a: Action | null = e.button === 0 ? 'attack' : e.button === 2 ? 'aim' : null;
      if (!a) return;
      this.pressed.add(a);
      this.down.add(a);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.down.delete('attack');
      if (e.button === 2) this.down.delete('aim');
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private updateMouse(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.mouseX = e.clientX - r.left;
    this.mouseY = e.clientY - r.top;
    this.mouseInside = true;
  }

  isDown(a: Action): boolean {
    return this.down.has(a);
  }
  wasPressed(a: Action): boolean {
    return this.pressed.has(a);
  }
  /** Consome um "pressionar" para que outro consumidor não o processe. */
  consume(a: Action): boolean {
    const had = this.pressed.has(a);
    this.pressed.delete(a);
    return had;
  }
  /** Permite simular entradas (testes automatizados, futura fonte de toque). */
  inject(a: Action, isDown: boolean) {
    if (isDown) {
      if (!this.down.has(a)) this.pressed.add(a);
      this.down.add(a);
    } else this.down.delete(a);
  }
  endFrame() {
    this.pressed.clear();
  }
  releaseAll() {
    this.down.clear();
    this.pressed.clear();
  }
}
