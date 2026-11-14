import { CONFIG, RespawnMode, TILE } from '../config';
import { createItem } from '../data/items';
import { AudioSystem } from '../engine/Audio';
import { Camera } from '../engine/Camera';
import { Input } from '../engine/Input';
import { clamp } from '../engine/math';
import { Renderer } from '../render/Renderer';
import { findInteractable, interact, Interactable } from '../systems/Interaction';
import { doPlayerItemAction, takeAll } from '../systems/ItemActions';
import { respawnPlayer } from '../systems/Respawn';
import { Simulation } from '../systems/Simulation';
import { UI, UIHost } from '../ui/UI';
import { EMPTY_COMMAND, PlayerCommand, World } from '../world/World';

type State = 'title' | 'playing' | 'paused' | 'dead';
const STEP = 1 / 60;

/**
 * Controla o ciclo do jogo: cenas (título, partida, pausa, morte), passo fixo da simulação,
 * conversão de entrada em comandos e ligação entre simulação, renderização, áudio e interface.
 */
export class Game implements UIHost {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: Renderer;
  readonly input: Input;
  readonly audio = new AudioSystem();
  readonly ui: UI;
  world!: World;
  sim!: Simulation;
  camera!: Camera;
  state: State = 'title';
  private acc = 0;
  private last = 0;
  private target: Interactable | null = null;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fpsText = '';
  private deathTimer = -1;
  private titlePan = 0;
  private stepsThisFrame = 0;
  /** Comando injetado (testes automatizados / futura fonte de rede). */
  testCommand: Partial<PlayerCommand> | null = null;
  timeScale = 1;
  showStats = false;

  constructor(root: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'game';
    root.appendChild(this.canvas);
    this.renderer = new Renderer(this.canvas);
    this.input = new Input(this.canvas);
    this.ui = new UI(root, this);
    this.newWorld(CONFIG.seed + 7);
    this.state = 'title';
    this.canvas.classList.add('menu');
    this.ui.showTitle(true);
    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.camera.viewW = this.renderer.viewW;
      this.camera.viewH = this.renderer.viewH;
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        this.showStats = !this.showStats;
        e.preventDefault();
      }
    });
    requestAnimationFrame((t) => this.frame(t));
  }

  private newWorld(seed: number) {
    this.world = new World(seed);
    this.sim = new Simulation(this.world);
    this.camera = new Camera(this.world.map.pxW, this.world.map.pxH);
    this.camera.viewW = this.renderer.viewW;
    this.camera.viewH = this.renderer.viewH;
    this.camera.follow(this.world.player.x, this.world.player.y, 0, true);
    this.renderer.setWorld(this.world);
    this.ui.bind(this.world);
    this.world.events.on('sound', (s) => {
      const p = this.world.player;
      if (this.state === 'title') return;
      this.audio.playAt(s.name, s.x, s.y, s.vol, p.x, p.y);
    });
    this.world.events.on('playerHurt', (h) => this.camera.shake(h.kind === 'mordida' ? 3 : 1.6, 0.25));
    this.world.events.on('shot', () => this.camera.shake(1.2, 0.12));
    this.world.events.on('playerDied', () => {
      this.deathTimer = 1.8;
    });
  }

  // ------------------------------------------------------------------ UIHost
  startGame() {
    this.audio.init();
    this.newWorld(CONFIG.seed);
    this.state = 'playing';
    this.canvas.classList.remove('menu');
    this.ui.showTitle(false);
    this.world.msg('Você está no abrigo (Casa 1). Elias está com você. Procure suprimentos — e evite fazer barulho.', 'info');
    this.world.msg('Dica: [E] interage, [I] abre o inventário, [Esc] mostra os controles.', 'info');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.world.player.alive ? 'playing' : 'dead';
    this.ui.showPause(false);
    this.canvas.classList.toggle('menu', this.state !== 'playing');
    this.last = performance.now();
  }

  restart() {
    this.ui.showPause(false);
    this.ui.showDeath(null);
    this.startGame();
  }

  respawn() {
    respawnPlayer(this.world);
    this.ui.showDeath(null);
    this.state = 'playing';
    this.canvas.classList.remove('menu');
    this.camera.follow(this.world.player.x, this.world.player.y, 0, true);
  }

  setRespawnMode(m: RespawnMode) {
    CONFIG.respawnMode = m;
  }

  toggleSound(): boolean {
    this.audio.setMuted(this.audio.enabled);
    return this.audio.enabled;
  }

  // ------------------------------------------------------------------ ciclo
  private frame(t: number) {
    const dt = Math.min(0.1, (t - (this.last || t)) / 1000);
    this.last = t;
    try {
      this.update(dt);
      this.draw();
    } catch (err) {
      console.error(err);
    }
    // só descarta toques de tecla depois que a simulação avançou ao menos um passo
    // (evita perder um [E] que caiu num quadro sem passo de simulação)
    if (this.stepsThisFrame > 0 || this.state !== 'playing') this.input.endFrame();
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      const fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.fpsText = this.showStats
        ? `${fps} fps · sim ${this.sim.stepMs.toFixed(2)} ms · render ${this.renderer.frameMs.toFixed(1)} ms · zumbis ${this.world.zombies.length}`
        : '';
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    requestAnimationFrame((tt) => this.frame(tt));
  }

  private handleGlobalKeys() {
    const inp = this.input;
    if (this.state === 'title') return;
    if (inp.consume('pause')) {
      if (this.state === 'playing' && this.ui.isModalOpen()) this.ui.closeAll();
      else if (this.state === 'playing') {
        this.state = 'paused';
        this.ui.showPause(true);
        this.canvas.classList.add('menu');
        inp.releaseAll();
      } else if (this.state === 'paused') this.resume();
      return;
    }
    if (this.state !== 'playing') return;
    if (this.ui.dialogOpen()) {
      for (const [a, i] of [
        ['opt1', 0],
        ['opt2', 1],
        ['opt3', 2],
        ['opt4', 3],
      ] as const)
        if (inp.consume(a)) this.ui.dialogChoose(i);
    }
    if (inp.consume('inventory')) this.ui.toggleInventory();
    if (inp.consume('health')) this.ui.toggleInventory('condicao');
    if (inp.consume('map')) this.ui.toggleMap();
  }

  private buildCommand(): PlayerCommand {
    const inp = this.input;
    const aim = this.renderer.screenToWorld(this.camera, inp.mouseX, inp.mouseY);
    const modal = this.ui.isModalOpen();
    const cmd: PlayerCommand = {
      mx: (inp.isDown('right') ? 1 : 0) - (inp.isDown('left') ? 1 : 0),
      my: (inp.isDown('down') ? 1 : 0) - (inp.isDown('up') ? 1 : 0),
      run: inp.isDown('run'),
      toggleCrouch: inp.consume('crouch'),
      aimX: aim.x,
      aimY: aim.y,
      attack: !modal && inp.isDown('attack'),
      attackPressed: !modal && inp.consume('attack'),
      aimHeld: !modal && inp.isDown('aim'),
      interact: !modal && inp.consume('interact'),
      reload: inp.consume('reload'),
    };
    if (this.testCommand) Object.assign(cmd, this.testCommand);
    return cmd;
  }

  private update(dt: number) {
    this.handleGlobalKeys();
    const w = this.world;
    if (this.state === 'title') {
      // fundo animado: câmera passeando pelo bairro
      this.titlePan += dt * 0.04;
      const cx = w.map.pxW * (0.5 + Math.sin(this.titlePan) * 0.32);
      const cy = w.map.pxH * (0.5 + Math.sin(this.titlePan * 0.7) * 0.28);
      this.camera.follow(cx, cy, dt * 0.3);
      this.acc += dt;
      while (this.acc >= STEP) {
        this.sim.step(STEP, { ...EMPTY_COMMAND, aimX: w.player.x, aimY: w.player.y - 10 });
        this.acc -= STEP;
      }
      return;
    }
    this.stepsThisFrame = 0;
    if (this.state === 'paused') return;

    this.acc += dt * this.timeScale;
    let first = true;
    let steps = 0;
    while (this.acc >= STEP && steps < 8) {
      const cmd = this.state === 'playing' ? this.buildCommand() : { ...EMPTY_COMMAND, aimX: w.player.aimX, aimY: w.player.aimY };
      if (!first) {
        cmd.toggleCrouch = cmd.attackPressed = cmd.interact = cmd.reload = false;
      }
      this.sim.step(STEP, cmd);
      if (first && this.testCommand) {
        // comandos de "toque único" valem só um passo
        delete this.testCommand.attackPressed;
        delete this.testCommand.interact;
        delete this.testCommand.reload;
        delete this.testCommand.toggleCrouch;
      }
      first = false;
      this.acc -= STEP;
      steps++;
    }
    if (steps >= 8) this.acc = 0;
    this.stepsThisFrame = steps;

    // câmera: segue o jogador com leve antecipação da mira
    const p = w.player;
    const lookX = clamp((p.aimX - p.x) * 0.18, -50, 50);
    const lookY = clamp((p.aimY - p.y) * 0.18, -36, 36);
    this.camera.follow(p.x + (p.alive ? lookX : 0), p.y + (p.alive ? lookY : 0), dt);

    this.target = this.state === 'playing' && p.alive ? findInteractable(w) : null;

    // áudio contínuo
    this.audio.setRadio(p.alive && p.inv.items.some((i) => i.defId === 'radio' && i.state?.on));
    if (p.alive) this.audio.updateHeart(dt, p.health.hp / p.health.max);

    if (this.deathTimer > 0) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) {
        this.state = 'dead';
        this.canvas.classList.add('menu');
        this.ui.showDeath(w.player.health.deathCause || 'Ferimentos');
      }
    }
  }

  private draw() {
    const inp = this.input;
    this.renderer.render(this.world, this.camera, {
      target: this.target,
      mouseX: inp.mouseX,
      mouseY: inp.mouseY,
      showCursor: this.state === 'playing' && !this.ui.isModalOpen(),
      overview: this.state === 'title',
    });
    if (this.state !== 'title') this.ui.updateHud(this.world, this.target, this.fpsText);
  }

  // ------------------------------------------------------------------ utilidades de depuração/teste
  debugApi() {
    const g = this;
    return {
      game: g,
      get world() {
        return g.world;
      },
      teleport(tx: number, ty: number) {
        const p = g.world.player;
        p.x = tx * TILE + TILE / 2;
        p.y = ty * TILE + TILE / 2;
        g.camera.follow(p.x, p.y, 0, true);
      },
      give(id: string, qty = 1) {
        const r = g.world.player.inv.add(createItem(id, qty));
        g.world.events.emit('inventoryChanged', {});
        return r;
      },
      step(seconds: number, cmd: Partial<PlayerCommand> = {}) {
        const n = Math.round(seconds / STEP);
        const w = g.world;
        for (let i = 0; i < n; i++) {
          const c: PlayerCommand = { ...EMPTY_COMMAND, aimX: w.player.aimX || w.player.x + 10, aimY: w.player.aimY || w.player.y, ...cmd };
          if (i > 0) c.attackPressed = c.interact = c.reload = c.toggleCrouch = false;
          g.sim.step(STEP, c);
        }
      },
      target: () => findInteractable(g.world),
      /** Interage com o alvo atual (como apertar E). */
      interact() {
        const t = findInteractable(g.world);
        if (t) interact(g.world, t);
        return t?.label ?? null;
      },
      itemAction(actionId: string, defId: string) {
        const it = g.world.player.inv.findDef(defId);
        if (it) doPlayerItemAction(g.world, actionId, it.uid);
        return !!it;
      },
      takeAll() {
        const id = g.world.player.openContainer;
        const c = id ? g.world.getContainer(id) : undefined;
        if (c) takeAll(g.world, c);
        return !!c;
      },
    };
  }
}
