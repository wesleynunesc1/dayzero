/**
 * Controles de toque (celular/tablet) com Pointer Events e multitoque real.
 * - Joystick analógico à esquerda (360°, zona morta, volta ao centro, nunca trava).
 * - Mira por arrasto à direita (joystick direito), botões de disparo, golpe, recarga,
 *   correr (segurar), agachar (alternar), interação contextual e seleção de alvo.
 * - No veículo: joystick vira volante e aparecem pedais (acelerar / frear-ré) e "Sair".
 * - Barra superior: menu, inventário, mapa (só com mapa físico), rádio (só com rádio),
 *   falar, diário, tela cheia, ajustes.
 * Nada aqui decide regras do jogo: só produz a mesma intenção que teclado e mouse produzem.
 */

export interface TouchPrefs {
  /** Escala dos botões (0,7–1,5). */
  size: number;
  /** Opacidade dos controles (0,25–1). */
  opacity: number;
  /** Inverter lados (joystick à direita, ação à esquerda). */
  swap: boolean;
  /** Zona morta do joystick (0–0,5). */
  deadzone: number;
  /** Sensibilidade do joystick (0,6–1,6): multiplica a deflexão. */
  stickSens: number;
  /** Sensibilidade da mira (0,5–2): alcance do ponto de mira. */
  aimSens: number;
  /** Qualidade gráfica. */
  quality: 'baixo' | 'medio' | 'alto';
}

export const DEFAULT_PREFS: TouchPrefs = { size: 1, opacity: 0.75, swap: false, deadzone: 0.18, stickSens: 1, aimSens: 1, quality: 'medio' };
const KEY = 'oua.mobile';

export function loadPrefs(): TouchPrefs {
  try {
    const s = localStorage.getItem(KEY);
    if (s) return { ...DEFAULT_PREFS, ...JSON.parse(s) };
  } catch {
    /* armazenamento indisponível */
  }
  return { ...DEFAULT_PREFS };
}

export function savePrefs(p: TouchPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
}

/** Celular/tablet? Considera toque, ponteiro grosso e tamanho de tela — não só o user-agent. */
export function detectTouch(): boolean {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const anyFine = typeof matchMedia === 'function' && matchMedia('(any-pointer: fine)').matches;
  const touchPoints = (navigator.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in window;
  const small = Math.min(screen.width, screen.height) < 900;
  const ua = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  if (coarse && touchPoints) return true;
  if (touchPoints && (small || ua) && !anyFine) return true;
  return touchPoints && ua;
}

export interface TouchState {
  mx: number;
  my: number;
  /** Mira ativa (dedo no joystick direito) e direção. */
  aiming: boolean;
  aimDx: number;
  aimDy: number;
  fire: boolean;
  melee: boolean;
  run: boolean;
  /** Pedais no veículo: +1 acelera, -1 freia/ré. */
  pedal: number;
}

type Btn = 'fire' | 'melee' | 'reload' | 'run' | 'crouch' | 'interact' | 'next' | 'gas' | 'brake';
export type TopAction = 'menu' | 'inv' | 'map' | 'radio' | 'talk' | 'journal' | 'full' | 'prefs';

const CSS = `
.tc{position:fixed;inset:0;pointer-events:none;z-index:5;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
body:not(.touch) .tc{display:none}
.tc .zone{position:absolute;bottom:0;height:72%;pointer-events:auto;touch-action:none}
.tc .zone.l{left:0;width:42%}.tc .zone.r{right:0;width:46%}
.tc.swap .zone.l{left:auto;right:0}.tc.swap .zone.r{right:auto;left:0}
.tc .stick{position:absolute;width:calc(124px*var(--s));height:calc(124px*var(--s));margin:calc(-62px*var(--s)) 0 0 calc(-62px*var(--s));border-radius:50%;
  border:2px solid rgba(232,220,190,.35);background:radial-gradient(circle,rgba(20,22,20,.25),rgba(20,22,20,.45));opacity:var(--o);pointer-events:none}
.tc .stick i{position:absolute;left:50%;top:50%;width:calc(54px*var(--s));height:calc(54px*var(--s));margin:calc(-27px*var(--s)) 0 0 calc(-27px*var(--s));border-radius:50%;
  background:rgba(232,220,190,.55);box-shadow:0 2px 8px rgba(0,0,0,.4)}
.tc .stick.aim{border-color:rgba(214,120,90,.45)} .tc .stick.aim i{background:rgba(226,150,120,.55)}
.tc .stick.idle{opacity:calc(var(--o)*.55)}
.tc .btns{position:absolute;right:max(14px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));display:grid;
  grid-template-columns:repeat(3,auto);gap:calc(10px*var(--s));align-items:end;pointer-events:none}
.tc.swap .btns{right:auto;left:max(14px,env(safe-area-inset-left))}
.tc .b{pointer-events:auto;touch-action:none;width:calc(64px*var(--s));height:calc(64px*var(--s));border-radius:50%;border:2px solid rgba(232,220,190,.4);
  background:rgba(24,25,22,.62);color:#efe4cc;font:600 calc(11px*var(--s))/1.1 system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;
  opacity:var(--o);text-align:center;padding:2px;box-sizing:border-box}
.tc .b span{font-size:calc(22px*var(--s));line-height:1}
.tc .b.big{width:calc(84px*var(--s));height:calc(84px*var(--s))}
.tc .b.on{background:rgba(201,162,91,.55);border-color:#e8c880}
.tc .b.down{transform:scale(.92);background:rgba(201,162,91,.45)}
.tc .b.off{opacity:calc(var(--o)*.35)}
.tc .b.hide{visibility:hidden}
.tc .ia{position:absolute;left:50%;bottom:max(14px,env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;gap:8px;pointer-events:none}
.tc .ia .b{width:auto;min-width:calc(150px*var(--s));height:calc(52px*var(--s));border-radius:26px;padding:0 16px;flex-direction:row;gap:8px;font-size:calc(13px*var(--s))}
.tc .ia .b.n{min-width:0;width:calc(52px*var(--s))}
.tc .top{position:absolute;top:max(8px,env(safe-area-inset-top));right:max(10px,env(safe-area-inset-right));display:flex;gap:6px;pointer-events:none}
.tc .top .b{width:calc(42px*var(--s));height:calc(42px*var(--s));border-radius:10px}
.tc .top .b span{font-size:calc(18px*var(--s))}
.tc.driving .combat,.tc.driving .zone.r,.tc.driving .stick.aim{display:none} .tc:not(.driving) .drive{display:none}
.tc.tcm .zone,.tc.tcm .btns,.tc.tcm .ia,.tc.tcm .stick{display:none}
.tc .close{position:fixed;top:max(8px,env(safe-area-inset-top));right:max(10px,env(safe-area-inset-right));width:48px;height:48px;border-radius:12px;font-size:22px;display:none;z-index:30}
.tc.tcm .close{display:flex}
.tc.tcm .top{display:none}
.tc.inactive{display:none}
/* em pé: barra de botões em duas linhas, mira acima dos botões, ação contextual sobre eles */
body.portrait .tc .top{max-width:calc(100vw - 168px);flex-wrap:wrap;justify-content:flex-end;gap:5px}
body.portrait .tc .top .b{width:calc(38px*var(--s));height:calc(38px*var(--s))}
body.portrait .tc .zone{height:55%}
body.portrait .tc .zone.l{width:50%}body.portrait .tc .zone.r{width:50%}
body.portrait .tc .btns{transform:scale(.85);transform-origin:bottom right}
body.portrait .tc.swap .btns{transform-origin:bottom left}
body.portrait .tc .ia{bottom:calc(max(14px,env(safe-area-inset-bottom)) + 190px*var(--s));left:auto;right:max(14px,env(safe-area-inset-right));transform:none}
`;

export class TouchControls {
  readonly el = document.createElement('div');
  state: TouchState = { mx: 0, my: 0, aiming: false, aimDx: 0, aimDy: 1, fire: false, melee: false, run: false, pedal: 0 };
  /** Toques únicos pendentes (consumidos pelo jogo). */
  private pressed = new Set<Btn>();
  private moveId: number | null = null;
  private aimId: number | null = null;
  private moveOrigin = { x: 0, y: 0 };
  private aimOrigin = { x: 0, y: 0 };
  private stickL: HTMLElement;
  private stickR: HTMLElement;
  private btn = new Map<string, HTMLElement>();
  private held = new Map<number, Btn>();
  onTop: (a: TopAction) => void = () => {};
  onClose: () => void = () => {};
  prefs: TouchPrefs;

  constructor(root: HTMLElement) {
    this.prefs = loadPrefs();
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el.className = 'tc';
    this.el.innerHTML = `
      <div class="zone l"></div><div class="zone r"></div>
      <div class="stick idle" data-k="L"><i></i></div><div class="stick aim idle" data-k="R"><i></i></div>
      <div class="ia"><div class="b n hide" data-b="next" title="Trocar alvo"><span>⇄</span></div><div class="b hide" data-b="interact"><span>✋</span><b data-k="ilabel">Interagir</b></div></div>
      <div class="btns">
        <div class="b combat" data-b="reload"><span>⟳</span>Recarregar</div>
        <div class="b combat" data-b="crouch"><span>🧎</span>Agachar</div>
        <div class="b combat" data-b="run"><span>🏃</span>Correr</div>
        <div class="b combat" style="visibility:hidden"></div>
        <div class="b combat" data-b="melee"><span>🔪</span>Golpe</div>
        <div class="b big combat" data-b="fire"><span>🎯</span>Disparar</div>
        <div class="b drive" data-b="brake"><span>⬇</span>Frear / ré</div>
        <div class="b big drive" data-b="gas"><span>⬆</span>Acelerar</div>
      </div>
      <div class="top">
        <div class="b" data-t="menu" title="Pausa"><span>☰</span></div>
        <div class="b" data-t="inv" title="Inventário"><span>🎒</span></div>
        <div class="b" data-t="map" title="Mapa"><span>🗺</span></div>
        <div class="b" data-t="radio" title="Rádio"><span>📻</span></div>
        <div class="b" data-t="talk" title="Falar"><span>💬</span></div>
        <div class="b" data-t="journal" title="Diário"><span>📖</span></div>
        <div class="b" data-t="full" title="Tela cheia"><span>⛶</span></div>
        <div class="b" data-t="prefs" title="Ajustes"><span>⚙</span></div>
      </div>
      <div class="b close" data-c="1" title="Fechar"><span>✕</span></div>`;
    root.appendChild(this.el);
    this.stickL = this.el.querySelector('[data-k=L]') as HTMLElement;
    this.stickR = this.el.querySelector('[data-k=R]') as HTMLElement;
    this.el.querySelectorAll<HTMLElement>('[data-b],[data-t]').forEach((b) => this.btn.set(b.dataset.b ?? `t:${b.dataset.t}`, b));
    this.applyPrefs();
    this.bind();
    this.resetSticks();
  }

  applyPrefs() {
    const p = this.prefs;
    this.el.style.setProperty('--s', String(p.size));
    this.el.style.setProperty('--o', String(p.opacity));
    this.el.classList.toggle('swap', p.swap);
    this.resetSticks();
  }

  /** Posição de repouso dos joysticks (canto inferior de cada lado, respeitando áreas seguras). */
  private resetSticks() {
    const s = this.prefs.size;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const portrait = H > W;
    const lx = this.prefs.swap ? W - 100 * s - 10 : 100 * s + 10;
    const rx = portrait ? (this.prefs.swap ? 110 * s : W - 110 * s) : this.prefs.swap ? 270 * s : W - 300 * s;
    const ry = portrait ? H - 330 * s : H - 210 * s;
    this.place(this.stickL, lx, H - 100 * s - 10, 0, 0);
    this.place(this.stickR, rx, ry, 0, 0);
    this.stickL.classList.add('idle');
    this.stickR.classList.add('idle');
  }

  private place(stick: HTMLElement, x: number, y: number, kx: number, ky: number) {
    stick.style.left = `${x}px`;
    stick.style.top = `${y}px`;
    const knob = stick.firstElementChild as HTMLElement;
    const R = 40 * this.prefs.size;
    knob.style.transform = `translate(${kx * R}px,${ky * R}px)`;
  }

  private bind() {
    const zl = this.el.querySelector('.zone.l') as HTMLElement;
    const zr = this.el.querySelector('.zone.r') as HTMLElement;
    const R = () => 48 * this.prefs.size;
    // ---- joystick esquerdo (flutuante dentro da zona)
    zl.addEventListener('pointerdown', (e) => {
      if (this.moveId !== null) return;
      e.preventDefault();
      this.moveId = e.pointerId;
      zl.setPointerCapture(e.pointerId);
      this.moveOrigin = { x: e.clientX, y: e.clientY };
      this.stickL.classList.remove('idle');
      this.place(this.stickL, e.clientX, e.clientY, 0, 0);
    });
    zl.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.moveId) return;
      const dx = (e.clientX - this.moveOrigin.x) / R();
      const dy = (e.clientY - this.moveOrigin.y) / R();
      const m = Math.hypot(dx, dy);
      const k = m > 1 ? 1 / m : 1;
      const nx = dx * k;
      const ny = dy * k;
      const mag = Math.min(1, m);
      const dz = this.prefs.deadzone;
      if (mag < dz) {
        this.state.mx = this.state.my = 0;
      } else {
        // reescala depois da zona morta e aplica a sensibilidade (sempre limitado a 1)
        const t = Math.min(1, ((mag - dz) / (1 - dz)) * this.prefs.stickSens);
        this.state.mx = (nx / (mag || 1)) * t;
        this.state.my = (ny / (mag || 1)) * t;
      }
      this.place(this.stickL, this.moveOrigin.x, this.moveOrigin.y, nx, ny);
    });
    const endMove = (e: PointerEvent) => {
      if (e.pointerId !== this.moveId) return;
      this.moveId = null;
      this.state.mx = this.state.my = 0;
      this.resetSticks();
    };
    zl.addEventListener('pointerup', endMove);
    zl.addEventListener('pointercancel', endMove);
    zl.addEventListener('lostpointercapture', endMove);
    // ---- mira (joystick direito)
    zr.addEventListener('pointerdown', (e) => {
      if (this.aimId !== null) return;
      e.preventDefault();
      this.aimId = e.pointerId;
      zr.setPointerCapture(e.pointerId);
      this.aimOrigin = { x: e.clientX, y: e.clientY };
      this.stickR.classList.remove('idle');
      this.place(this.stickR, e.clientX, e.clientY, 0, 0);
    });
    zr.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.aimId) return;
      const dx = (e.clientX - this.aimOrigin.x) / R();
      const dy = (e.clientY - this.aimOrigin.y) / R();
      const m = Math.hypot(dx, dy);
      if (m > 0.2) {
        this.state.aiming = true;
        this.state.aimDx = dx / m;
        this.state.aimDy = dy / m;
      }
      const k = m > 1 ? 1 / m : 1;
      this.place(this.stickR, this.aimOrigin.x, this.aimOrigin.y, dx * k, dy * k);
    });
    const endAim = (e: PointerEvent) => {
      if (e.pointerId !== this.aimId) return;
      this.aimId = null;
      this.state.aiming = false; // a direção fica: o personagem continua olhando para onde mirou
      this.resetSticks();
    };
    zr.addEventListener('pointerup', endAim);
    zr.addEventListener('pointercancel', endAim);
    zr.addEventListener('lostpointercapture', endAim);
    // ---- botões de ação (cada dedo é independente)
    for (const [name, b] of this.btn) {
      if (name.startsWith('t:')) {
        b.addEventListener('pointerdown', (e) => e.preventDefault());
        b.addEventListener('click', () => !b.classList.contains('off') && this.onTop(name.slice(2) as TopAction));
        continue;
      }
      const id = name as Btn;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        b.setPointerCapture(e.pointerId);
        this.held.set(e.pointerId, id);
        b.classList.add('down');
        this.pressed.add(id);
        if (id === 'fire') this.state.fire = true;
        if (id === 'melee') this.state.melee = true;
        if (id === 'run') this.state.run = true;
        if (id === 'gas') this.state.pedal = 1;
        if (id === 'brake') this.state.pedal = -1;
      });
      const up = (e: PointerEvent) => {
        if (this.held.get(e.pointerId) !== id) return;
        this.held.delete(e.pointerId);
        b.classList.remove('down');
        if (id === 'fire') this.state.fire = false;
        if (id === 'melee') this.state.melee = false;
        if (id === 'run') this.state.run = false;
        if ((id === 'gas' && this.state.pedal === 1) || (id === 'brake' && this.state.pedal === -1)) this.state.pedal = 0;
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
    }
    (this.el.querySelector('[data-c]') as HTMLElement).addEventListener('click', () => this.onClose());
    // trocar de aba/app, girar a tela: nada fica "preso" apertado
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => document.hidden && this.releaseAll());
    window.addEventListener('resize', () => {
      this.releaseAll();
      this.resetSticks();
    });
  }

  /** Solta tudo (dedo saiu da tela, app em segundo plano, rotação). */
  releaseAll() {
    this.moveId = this.aimId = null;
    this.held.clear();
    Object.assign(this.state, { mx: 0, my: 0, aiming: false, fire: false, melee: false, run: false, pedal: 0 });
    this.btn.forEach((b) => b.classList.remove('down'));
    this.pressed.clear();
    this.resetSticks();
  }

  consume(b: Btn): boolean {
    const had = this.pressed.has(b);
    this.pressed.delete(b);
    return had;
  }

  /** Atualiza o que aparece: botão contextual, alvo, mapa/rádio disponíveis, modo veículo. */
  sync(o: { active: boolean; modal: boolean; driving: boolean; crouch: boolean; target: string | null; targets: number; hasMap: boolean; hasRadio: boolean; gun: boolean; canFull: boolean; isFull: boolean }) {
    if (!this.setActive(o.active)) return;
    // (classe própria: ".modal" já é o estilo das janelas da interface)
    if (o.modal && !this.el.classList.contains('tcm')) this.releaseAll();
    this.el.classList.toggle('tcm', o.modal);
    this.el.classList.toggle('driving', o.driving);
    this.btn.get('crouch')!.classList.toggle('on', o.crouch);
    const ib = this.btn.get('interact')!;
    ib.classList.toggle('hide', !o.target);
    if (o.target) (ib.querySelector('[data-k=ilabel]') as HTMLElement).textContent = o.target;
    this.btn.get('next')!.classList.toggle('hide', !o.target || o.targets < 2);
    this.btn.get('t:map')!.classList.toggle('off', !o.hasMap);
    this.btn.get('t:radio')!.classList.toggle('off', !o.hasRadio);
    this.btn.get('t:full')!.style.display = o.canFull ? '' : 'none';
    this.btn.get('t:full')!.classList.toggle('on', o.isFull);
    this.btn.get('fire')!.classList.toggle('off', !o.gun);
  }

  /** Esconde tudo fora da partida (título, pausa, morte). Retorna se está ativo. */
  setActive(on: boolean): boolean {
    const was = !this.el.classList.contains('inactive');
    if (was !== on) {
      this.el.classList.toggle('inactive', !on);
      if (!on) this.releaseAll();
    }
    return on;
  }
}
