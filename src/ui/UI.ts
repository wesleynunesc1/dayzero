import { CONFIG, RESPAWN_MODE_LABELS, RespawnMode } from '../config';
import { Category, itemDef, ItemInstance, itemWeight } from '../data/items';
import { formatKg } from '../engine/math';
import { listRecipes } from '../systems/Crafting';
import { fatigueLevel, hungerLevel, thirstLevel } from '../systems/Needs';
import { WEATHER_LABEL } from '../systems/Weather';
import { WOUND_SEVERITY } from '../systems/Health';
import { Ally, ALLY_STATE_LABEL } from '../entities/Ally';
import { weaponName } from '../systems/Combat';
import { WOUND_LABEL } from '../systems/Health';
import type { Interactable } from '../systems/Interaction';
import { containerItemActions, describeItem, ItemAction, playerItemActions } from '../systems/ItemActions';
import type { Tone, World } from '../world/World';
import type { Container } from '../world/types';
import { MapKind, MapView } from './MapView';
import { CSS } from './styles';
import type { ActionResult } from '../net/Actions';
import type { LobbyState, Mode } from '../net/protocol';
import { COND_LABEL, MARKER_LABEL, type MarkerKind, type PaperState } from './MapView';
import { Panels, PANEL_CSS } from './Panels';

export interface UIHost {
  readonly world: World;
  startGame(): void;
  continueGame(): void;
  saveGame(): boolean;
  loadGame(): void;
  hasSave(): boolean;
  resume(): void;
  restart(): void;
  respawn(): void;
  setRespawnMode(m: RespawnMode): void;
  toggleSound(): boolean;
  /** Ação discreta do jogador (executada no mundo autoritativo: local ou servidor). */
  act(name: string, ...args: unknown[]): Promise<ActionResult>;
  /** Modo online? (afeta só textos da interface). */
  readonly online: boolean;
  connectServer(url: string, name: string): Promise<void>;
  pickSlot(slot: number): void;
  setMode(mode: Mode): void;
  startOnline(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const CONTROLS: [string, string][] = [
  ['W A S D', 'Movimentar'],
  ['Shift', 'Correr (gasta fôlego, faz barulho)'],
  ['C', 'Agachar / levantar (silencioso)'],
  ['E', 'Interagir (portas, recipientes, corpos, NPC)'],
  ['I', 'Inventário'],
  ['H', 'Condição física e ferimentos'],
  ['M', 'Mapa (somente se tiver encontrado um)'],
  ['R', 'Recarregar arma'],
  ['F', 'Fabricar (crafting)'],
  ['W/S · A/D', 'Dirigindo: acelerar/frear · esterçar'],
  ['Mouse', 'Mirar · botão esquerdo ataca'],
  ['Botão direito', 'Mira firme (armas de fogo)'],
  ['Enter / T', 'Falar, gritar ou transmitir pelo rádio'],
  ['J', 'Diário: campanha, missões, grupo e reputação'],
  ['1–8', 'Escolher opção numa conversa'],
  ['Esc', 'Pausar / fechar janelas'],
];

/** Interface em português do Brasil (HUD, inventário, mapa, diálogos e menus). */
export class UI {
  private root: HTMLElement;
  private hud: HTMLElement;
  private hudLeft: HTMLElement;
  private hudRight: HTMLElement;
  private stance: HTMLElement;
  private prompt: HTMLElement;
  private action: HTMLElement;
  private log: HTMLElement;
  private inv: HTMLElement;
  private mapview: HTMLElement;
  private mapCanvas: HTMLCanvasElement;
  private mapTools!: HTMLElement;
  /** Mapa aberto: 'bairro' ou uid de um mapa regional. */
  private mapSel: string | null = null;
  panels!: Panels;
  private dialog: HTMLElement;
  private title: HTMLElement;
  private pause: HTMLElement;
  private death: HTMLElement;
  private fps: HTMLElement;
  private sleepEl: HTMLElement;
  private mapView = new MapView();
  private selected: { side: 'p' | 'c'; uid: string } | null = null;
  private invTab: 'container' | 'condicao' | 'fabricar' = 'condicao';
  private dialogAlly: Ally | null = null;
  private cache = new Map<string, string>();
  private unsub: (() => void)[] = [];
  private invDirty = true;
  private lastInvRender = 0;
  private lastClick: { uid: string; t: number } | null = null;

  constructor(parent: HTMLElement, private host: UIHost) {
    const style = document.createElement('style');
    style.textContent = CSS + PANEL_CSS;
    document.head.appendChild(style);
    this.root = el('div');
    this.root.id = 'ui';
    parent.appendChild(this.root);

    this.hud = el('div', 'hidden');
    this.hudLeft = el('div', 'panel');
    this.hudLeft.id = 'hud-left';
    this.hudRight = el('div', 'panel');
    this.hudRight.id = 'hud-right';
    this.stance = el('div');
    this.stance.id = 'stance';
    this.prompt = el('div', 'panel hidden');
    this.prompt.id = 'prompt';
    this.action = el('div', 'panel hidden');
    this.action.id = 'action';
    this.log = el('div');
    this.log.id = 'log';
    this.fps = el('div');
    this.fps.id = 'fps';
    this.sleepEl = el('div', 'panel hidden');
    this.sleepEl.id = 'sleep';
    this.hud.append(this.hudLeft, this.hudRight, this.stance, this.prompt, this.action, this.log, this.fps, this.sleepEl);

    this.hudLeft.innerHTML = `
      <div class="row"><span class="label">Saúde</span><div class="bar hp"><i data-k="hp"></i></div><span class="num" data-k="hpn"></span></div>
      <div class="row" title="Fome: cheio = alimentado"><span class="label">Fome</span><div class="bar food"><i data-k="food"></i></div><span class="num" data-k="foodn"></span></div>
      <div class="row" title="Sede: cheio = hidratado"><span class="label">Sede</span><div class="bar water"><i data-k="water"></i></div><span class="num" data-k="watern"></span></div>
      <div class="row" title="Energia: fadiga acumulada (sono)"><span class="label">Energia</span><div class="bar en"><i data-k="en"></i></div><span class="num" data-k="enn"></span></div>
      <div class="row" title="Fôlego: resistência de curto prazo"><span class="label">Fôlego</span><div class="bar st"><i data-k="st"></i></div><span class="num" data-k="stn"></span></div>
      <div class="chips" data-k="chips"></div>`;
    this.hudRight.innerHTML = `
      <div data-k="footrow">
        <div class="kv"><span class="label">Arma</span><b data-k="wpn"></b></div>
        <div class="kv"><span class="label">Munição</span><b data-k="ammo"></b></div>
      </div>
      <div class="hidden" data-k="fuelrow">
        <div class="kv"><span class="label">Combustível</span><b data-k="fuel"></b></div>
        <div class="bar fuel"><i data-k="fuelfill"></i></div>
        <div class="kv" style="margin-top:4px"><span class="label">Velocidade</span><b data-k="speed"></b></div>
      </div>
      <div class="kv"><span class="label">Carga</span><b data-k="kg"></b></div>
      <div class="bar w" data-k="wbar"><i data-k="wfill"></i></div>`;

    this.inv = el('div', 'modal hidden');
    this.inv.id = 'inventory';
    this.inv.addEventListener('mousedown', (e) => e.stopPropagation());

    this.mapview = el('div', 'modal hidden');
    this.mapview.id = 'mapview';
    this.mapCanvas = document.createElement('canvas');
    const mapHint = el('div', 'foot', 'O mapa não mostra onde você está, nem onde estão os outros. Clique para marcar · botão direito apaga · <span class="kbd">M</span>/<span class="kbd">Esc</span> fechar');
    this.mapTools = el('div');
    this.mapTools.id = 'maptools';
    this.mapview.append(this.mapTools, this.mapCanvas, mapHint);
    this.mapview.addEventListener('mousedown', (e) => e.stopPropagation());
    this.mapCanvas.addEventListener('click', (e) => this.mapClick(e, false));
    this.mapCanvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.mapClick(e, true);
    });

    this.dialog = el('div', 'modal hidden');
    this.dialog.id = 'dialog';

    this.title = el('div', 'screen');
    this.title.id = 'title';
    this.title.innerHTML = `
      <div class="card">
        <div class="sub">Etapas 1–5 · Sobrevivência cooperativa</div>
        <h1>O Último<br>Amanhecer</h1>
        <div class="btns"><button class="btn primary hidden" data-a="continue">Continuar partida</button><button class="btn" data-a="start">Novo mundo — SOLO (offline)</button><button class="btn" data-a="multi">Multijogador (1–4)</button><button class="btn" data-a="controls">Controles</button></div>
        <div class="foot hidden" data-k="saveinfo"></div>
        <div class="hidden" data-k="lobby" style="margin-top:10px;display:flex;flex-direction:column;gap:6px"></div>
        <div class="controls hidden" data-k="controls">${CONTROLS.map(([k, v]) => `<span class="kbd">${k}</span><span>${v}</span>`).join('')}</div>
        <div class="note">Sobreviva em um bairro tomado por infectados. Explore, procure suprimentos, evite barulho.
        Uma mordida é fatal. Use fones de ouvido: os sons indicam o que você não vê.<br><br>
        Arte e sons são provisórios, originais e gerados pelo próprio jogo.</div>
      </div>`;
    this.title.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).dataset.a;
      if (a === 'start') this.host.startGame();
      if (a === 'continue') this.host.continueGame();
      if (a === 'controls') this.title.querySelector('[data-k=controls]')!.classList.toggle('hidden');
      if (a === 'multi') this.showLobby(null, '');
    });

    this.pause = el('div', 'screen hidden');
    this.pause.id = 'pause';
    this.pause.innerHTML = `
      <div class="card panel">
        <h2 class="label" style="font-size:12px">Jogo pausado</h2>
        <div class="controls">${CONTROLS.map(([k, v]) => `<span class="kbd">${k}</span><span>${v}</span>`).join('')}</div>
        <label class="label" style="margin-top:6px">Regra de retorno após a morte</label>
        <select data-k="respawn">${(Object.keys(RESPAWN_MODE_LABELS) as RespawnMode[]).map((m) => `<option value="${m}">${RESPAWN_MODE_LABELS[m]}</option>`).join('')}</select>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <button class="btn primary" data-a="resume">Continuar</button>
          <button class="btn" data-a="save">Salvar partida</button>
          <button class="btn" data-a="load">Carregar último salvamento</button>
          <button class="btn" data-a="sound">Som: ligado</button>
          <button class="btn danger" data-a="restart">Reiniciar partida</button>
        </div>
      </div>`;
    this.pause.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const a = t.dataset.a;
      if (a === 'resume') this.host.resume();
      if (a === 'save') t.textContent = this.host.saveGame() ? 'Salvo ✓' : 'Falha ao salvar';
      if (a === 'load') this.host.loadGame();
      if (a === 'restart') this.host.restart();
      if (a === 'sound') t.textContent = `Som: ${this.host.toggleSound() ? 'ligado' : 'desligado'}`;
    });
    const sel = this.pause.querySelector('select')! as HTMLSelectElement;
    sel.value = CONFIG.respawnMode;
    sel.addEventListener('change', () => this.host.setRespawnMode(sel.value as RespawnMode));

    this.death = el('div', 'screen hidden');
    this.death.id = 'death';
    this.death.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).dataset.a === 'respawn') this.host.respawn();
    });

    this.root.append(this.hud, this.inv, this.mapview, this.dialog, this.title, this.pause, this.death);
    this.panels = new Panels(this.root, this.host);
  }

  // ------------------------------------------------------------------ eventos do mundo
  bind(world: World) {
    for (const u of this.unsub) u();
    this.unsub = [];
    this.log.innerHTML = '';
    this.cache.clear();
    this.closeAll();
    this.unsub.push(
      // só o que é para ESTE sobrevivente (ou para todos) aparece na tela
      world.events.on('message', (m) => (!m.to || m.to === world.localId) && this.pushLog(m.text, m.tone)),
      world.events.on('npcDialog', ({ npcId }) => world.player.id === world.localId && void this.panels.openNpc(npcId)),
      world.events.on('campaign', ({ chapter, title }) => this.pushLog(chapter > 10 ? 'Campanha concluída.' : `Capítulo ${chapter}: ${title} (J abre o diário)`, 'good')),
      world.events.on('inventoryChanged', () => (this.invDirty = true)),
      world.events.on('openContainer', () => {
        this.invTab = 'container';
        this.selected = null;
        this.openInventory();
      }),
      world.events.on('closeContainer', () => {
        if (this.invTab === 'container') this.invTab = 'condicao';
        this.invDirty = true;
      }),
      world.events.on('openMap', ({ uid }) => world.player.id === world.localId && this.openMap(uid)),
      world.events.on('allyDialog', ({ allyId }) => {
        const a = world.allies.find((x) => x.id === allyId);
        if (a) this.openDialog(a);
      }),
    );
  }

  private pushLog(text: string, tone: Tone) {
    const d = el('div', tone, esc(text));
    this.log.appendChild(d);
    while (this.log.children.length > 6) this.log.firstChild!.remove();
    setTimeout(() => (d.style.opacity = '0'), 7000);
    setTimeout(() => d.remove(), 7700);
  }

  // ------------------------------------------------------------------ telas
  showTitle(show: boolean, saveInfo?: string | null) {
    this.title.classList.toggle('hidden', !show);
    this.hud.classList.toggle('hidden', show);
    const cont = this.title.querySelector('[data-a=continue]')!;
    const info = this.title.querySelector('[data-k=saveinfo]')! as HTMLElement;
    cont.classList.toggle('hidden', !saveInfo);
    info.classList.toggle('hidden', !saveInfo);
    if (saveInfo) info.textContent = saveInfo;
  }
  /** Lobby multijogador: conectar, ver vagas, escolher personagem, modalidade e iniciar/continuar. */
  showLobby(st: LobbyState | null, err: string) {
    const box = this.title.querySelector('[data-k=lobby]') as HTMLElement;
    box.classList.remove('hidden');
    if (!st) {
      // servido pelo próprio servidor do jogo → mesmo endereço; Vite/arquivo local → porta padrão do servidor
      const def = location.protocol.startsWith('http') && location.port && location.port !== '5173' ? `ws://${location.host}/ws` : `ws://${location.hostname || 'localhost'}:${CONFIG.multiplayer.port}/ws`;
      box.innerHTML = `<div class="label">Servidor</div><input data-k="url" value="${def}" style="background:#151514;color:var(--ink);border:1px solid var(--line);padding:6px"/>
        <div class="label">Seu nome (use o mesmo para voltar ao seu personagem)</div><input data-k="nome" maxlength="24" value="${esc(localStorage.getItem('oua.nome') ?? '')}" style="background:#151514;color:var(--ink);border:1px solid var(--line);padding:6px"/>
        <button class="btn primary" data-l="conectar">Conectar</button>
        <div class="foot">Para criar um mundo: rode <b>npm run server</b> no computador anfitrião. O mundo fica salvo no servidor.</div>
        <div class="foot" style="color:#d08a70">${esc(err)}</div>`;
      box.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
      box.querySelector('[data-l=conectar]')!.addEventListener('click', () => {
        const url = (box.querySelector('[data-k=url]') as HTMLInputElement).value.trim();
        const nome = (box.querySelector('[data-k=nome]') as HTMLInputElement).value.trim();
        if (!nome) return this.showLobby(null, 'Digite um nome.');
        try {
          localStorage.setItem('oua.nome', nome);
        } catch {
          /* sem armazenamento */
        }
        this.host.connectServer(url, nome).catch((e: Error) => this.showLobby(null, e.message));
      });
      return;
    }
    const me = st.slots.find((x) => x.playerId === st.you);
    const isHost = !!me && st.host === me.owner;
    const regions: Record<string, string> = { oeste: 'Oeste', sul: 'Sul', norte: 'Norte', leste: 'Leste' };
    box.innerHTML = `<div class="label">Mundo: <b>${esc(st.worldName)}</b> · ${st.started ? `campanha em andamento (dia ${st.day}, capítulo ${st.chapter})` : 'aguardando início'} · criado por ${esc(st.host ?? '—')}</div>
      <div class="label">Modalidade: ${isHost && !st.started ? `<select data-k="modo">${['SOLO', 'DUO', 'TRIO', 'QUARTETO'].map((m) => `<option ${m === st.mode ? 'selected' : ''}>${m}</option>`).join('')}</select>` : `<b>${st.mode}</b>`} — vagas sem jogador ficam com a IA</div>
      ${st.slots
        .map(
          (sl) => `<div style="border:1px solid var(--line);padding:6px 8px;font-size:12px">
          <b>${esc(sl.name)}</b> · começa no ${regions[sl.region] ?? sl.region}${sl.dead ? ' · morto' : ''}<br><span class="foot">${esc(sl.bio)}</span><br>
          ${sl.aiOnly ? 'Vaga da IA nesta modalidade' : sl.owner ? `Jogador: <b>${esc(sl.owner)}</b> ${sl.connected ? '(conectado)' : '(desconectado — IA no controle)'}` : 'Vaga livre (IA até alguém entrar)'}
          ${!sl.aiOnly && (!sl.owner || sl.playerId === st.you) && sl.playerId !== st.you && (!st.started || !me) ? `<button class="btn" data-pick="${sl.slot}">Escolher</button>` : sl.playerId === st.you ? ' ← você' : ''}
        </div>`,
        )
        .join('')}
      ${me ? (st.started ? '<button class="btn primary" data-l="entrar">Entrar na partida</button>' : isHost ? '<button class="btn primary" data-l="iniciar">Iniciar campanha</button>' : '<div class="foot">Aguardando o anfitrião iniciar…</div>') : '<div class="foot">Escolha um sobrevivente.</div>'}
      <div class="foot" style="color:#d08a70">${esc(err)}</div>`;
    box.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => this.host.pickSlot(Number((b as HTMLElement).dataset.pick))));
    box.querySelector('[data-k=modo]')?.addEventListener('change', (e) => this.host.setMode((e.target as HTMLSelectElement).value as Mode));
    box.querySelector('[data-l=iniciar]')?.addEventListener('click', () => this.host.startOnline());
    box.querySelector('[data-l=entrar]')?.addEventListener('click', () => this.host.startOnline());
  }

  showPause(show: boolean) {
    this.pause.classList.toggle('hidden', !show);
    if (show) (this.pause.querySelector('select') as HTMLSelectElement).value = CONFIG.respawnMode;
  }
  showDeath(cause: string | null) {
    if (cause === null) {
      this.death.classList.add('hidden');
      return;
    }
    const causeText: Record<string, string> = {
      Infecção: 'A mordida infectada venceu seu corpo.',
      Hemorragia: 'Você sangrou até a morte.',
      Ferimentos: 'Seus ferimentos foram graves demais.',
    };
    this.closeAll();
    this.death.innerHTML = `
      <div class="card panel">
        <h1>Você morreu</h1>
        <p>${causeText[cause] ?? cause}</p>
        <p>Seu corpo e tudo o que você carregava ficaram no local da morte. Você retorna sem armas e sem os itens antigos.</p>
        <p class="foot">Regra de retorno atual: ${RESPAWN_MODE_LABELS[CONFIG.respawnMode]}.</p>
        <div><button class="btn primary" data-a="respawn">Retornar</button></div>
      </div>`;
    this.death.classList.remove('hidden');
  }

  isModalOpen() {
    return !this.inv.classList.contains('hidden') || !this.mapview.classList.contains('hidden') || !this.dialog.classList.contains('hidden') || this.panels.isOpen();
  }

  closeAll() {
    const w = this.host.world;
    this.inv.classList.add('hidden');
    this.mapview.classList.add('hidden');
    this.dialog.classList.add('hidden');
    this.dialogAlly = null;
    this.panels?.close();
    if (w && w.player.openContainer) void this.host.act('closeContainer');
  }

  // ------------------------------------------------------------------ HUD
  private set(key: string, html: string, attr: 'html' | 'width' = 'html') {
    const k = `${key}:${attr}`;
    if (this.cache.get(k) === html) return;
    this.cache.set(k, html);
    const node = this.root.querySelector(`[data-k="${key}"]`) as HTMLElement | null;
    if (!node) return;
    if (attr === 'width') node.style.width = html;
    else node.innerHTML = html;
  }

  private toggleKey(key: string, show: boolean) {
    const n = this.root.querySelector(`[data-k="${key}"]`);
    if (n) n.classList.toggle('hidden', !show);
  }

  updateHud(world: World, target: Interactable | null, fpsText: string) {
    this.panels.update(world);
    const w = world;
    const p = world.player;
    const h = p.health;
    this.set('hp', `${Math.max(0, h.hp)}%`, 'width');
    this.set('hpn', `${Math.ceil(h.hp)}`);
    this.set('st', `${p.stamina}%`, 'width');
    this.set('stn', `${Math.round(p.stamina)}`);
    this.set('food', `${100 - p.hunger}%`, 'width');
    this.set('foodn', `${Math.round(100 - p.hunger)}`);
    this.set('water', `${100 - p.thirst}%`, 'width');
    this.set('watern', `${Math.round(100 - p.thirst)}`);
    this.set('en', `${100 - p.fatigue}%`, 'width');
    this.set('enn', `${Math.round(100 - p.fatigue)}`);
    const chips: string[] = [];
    const st = h.state;
    chips.push(`<span class="chip ${st === 'Saudável' ? 'ok' : st === 'Ferido' ? 'warn' : 'bad'}">${st}</span>`);
    if (h.bleeding && st !== 'Sangrando') chips.push('<span class="chip bad">Sangrando</span>');
    const untreated = h.wounds.filter((w) => !w.treated).length;
    if (h.wounds.length) chips.push(`<span class="chip ${untreated ? 'warn' : ''}">${h.wounds.length} ferimento${h.wounds.length > 1 ? 's' : ''}${untreated ? '' : ' (tratados)'}</span>`);
    if (h.infected) chips.push('<span class="chip bad">Infectado</span>');
    for (const lv of [hungerLevel(p.hunger), thirstLevel(p.thirst), fatigueLevel(p.fatigue)]) if (lv.tone !== 'ok') chips.push(`<span class="chip ${lv.tone}">${lv.label}</span>`);
    if (p.sickHours > 0) chips.push('<span class="chip bad">Náusea</span>');
    if (h.wounds.some((w) => w.infected)) chips.push('<span class="chip bad">Ferimento infeccionado</span>');
    if (p.stamina < 20) chips.push('<span class="chip warn">Sem fôlego</span>');
    if (h.painkiller > 0) chips.push('<span class="chip">Analgésico</span>');
    this.set('chips', chips.join(''));

    const wi = p.weaponItem;
    const wd = wi ? itemDef(wi.defId) : null;
    let wtxt = esc(weaponName(p));
    if (wi && wd?.durability && wi.condition !== undefined) wtxt += ` <small>${Math.round((wi.condition / wd.durability) * 100)}%</small>`;
    this.set('wpn', wtxt);
    if (wd?.weapon?.kind === 'gun') {
      this.set('ammo', `${wi!.state?.ammo ?? 0} <small>/ ${p.inv.count(wd.weapon.ammo!)}</small>`);
    } else this.set('ammo', '<small>—</small>');
    // combustível só enquanto dirige
    const veh = w.vehicleById(p.vehicleId);
    this.toggleKey('fuelrow', !!veh);
    this.toggleKey('footrow', !veh);
    if (veh) {
      this.set('fuel', `${veh.fuel.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} <small>/ ${veh.def.fuelCapacity} L</small>`);
      this.set('fuelfill', `${(veh.fuel / veh.def.fuelCapacity) * 100}%`, 'width');
      this.set('speed', `${veh.kmh} <small>km/h${veh.engineOn ? '' : ' · motor desligado'}</small>`);
    }
    // sono
    if (p.sleep) {
      this.sleepEl.classList.remove('hidden');
      this.sleepEl.innerHTML = `<div class="label">${p.sleep.maxHours <= 1 ? 'Descansando' : 'Dormindo'}…</div><b>${w.clockText()}</b><div class="foot">Energia ${Math.round(100 - p.fatigue)}% · <span class="kbd">E</span>acordar</div>`;
    } else this.sleepEl.classList.add('hidden');
    const wkg = p.inv.weight();
    this.set('kg', `${formatKg(wkg)} <small>/ ${formatKg(p.inv.maxWeight)} kg</small>`);
    this.set('wfill', `${Math.min(100, (wkg / p.inv.maxWeight) * 100)}%`, 'width');

    const stance = p.isDown || p.sleep ? '' : p.vehicleId ? 'Dirigindo' : p.crouch ? 'Agachado' : p.running ? 'Correndo' : p.aiming ? 'Mirando' : '';
    this.set('__stance', stance);
    if (this.stance.textContent !== stance) this.stance.textContent = stance;

    // prompt de interação
    if (target && !this.isModalOpen() && p.alive) {
      const html = `<kbd>E</kbd>${esc(target.label)}`;
      if (this.prompt.innerHTML !== html) this.prompt.innerHTML = html;
      this.prompt.classList.remove('hidden');
    } else this.prompt.classList.add('hidden');

    // ação em andamento
    if (p.action && p.alive) {
      this.action.classList.remove('hidden');
      const html = `<div>${esc(p.action.label)}…</div><div class="bar"><i style="width:${Math.min(100, (p.action.t / p.action.dur) * 100)}%"></i></div>`;
      this.action.innerHTML = html;
    } else this.action.classList.add('hidden');

    this.fps.textContent = fpsText;

    if (!this.inv.classList.contains('hidden')) {
      const now = performance.now();
      if (this.invDirty || (this.invTab === 'condicao' && now - this.lastInvRender > 1000)) this.renderInventory();
    }
    if (this.dialogAlly && !this.dialog.classList.contains('hidden')) {
      const a = this.dialogAlly;
      if (a.state === 'morto' || Math.hypot(a.x - p.x, a.y - p.y) > 40) this.dialog.classList.add('hidden');
    }
  }

  // ------------------------------------------------------------------ inventário
  toggleInventory(tab?: 'condicao' | 'fabricar') {
    if (!this.inv.classList.contains('hidden') && (!tab || this.invTab === tab)) {
      this.closeInventory();
      return;
    }
    if (tab) this.invTab = tab;
    else if (!this.host.world.player.openContainer) this.invTab = 'condicao';
    this.openInventory();
  }

  openInventory() {
    this.mapview.classList.add('hidden');
    this.dialog.classList.add('hidden');
    this.inv.classList.remove('hidden');
    this.invDirty = true;
    this.renderInventory();
  }

  closeInventory() {
    this.inv.classList.add('hidden');
    if (this.host.world.player.openContainer) void this.host.act('closeContainer');
    this.selected = null;
  }

  private renderInventory() {
    this.invDirty = false;
    this.lastInvRender = performance.now();
    const w = this.host.world;
    const p = w.player;
    const c: Container | undefined = p.openContainer ? w.getContainer(p.openContainer) : undefined;
    if (!c && this.invTab === 'container') this.invTab = 'condicao';
    const pw = p.inv.weight();
    const over = pw > p.inv.maxWeight + 1e-6;

    const slot = (s: 'arma' | 'corpo' | 'costas', label: string) => {
      const it = p.item(s);
      return `<div class="slot"><div class="label">${label}</div><div>${it ? esc(itemDef(it.defId).name) : '<span style="color:var(--ink-faint)">—</span>'}</div></div>`;
    };
    const row = (it: ItemInstance, side: 'p' | 'c') => {
      const d = itemDef(it.defId);
      const eq = side === 'p' ? p.isEquipped(it.uid) : null;
      const sel = this.selected?.uid === it.uid ? ' sel' : '';
      let extra = '';
      if (d.durability && it.condition !== undefined) extra += `<span class="cond"><i style="width:${(it.condition / d.durability) * 100}%"></i></span>`;
      if (d.weapon?.kind === 'gun') extra += `<span class="tag" style="color:var(--ink-dim)">${it.state?.ammo ?? 0}/${d.weapon.magazine}</span>`;
      if (d.food?.uses || (d.medical && d.medical.uses > 1)) extra += `<span class="tag" style="color:var(--ink-dim)">${it.state?.uses ?? 0} usos</span>`;
      if ((d.light || d.radio) && it.state?.on) extra += '<span class="tag">ligado</span>';
      if (eq) extra += '<span class="tag">equipado</span>';
      return `<li class="${sel.trim()}" data-side="${side}" data-uid="${it.uid}"><span class="n">${esc(d.name)}${it.qty > 1 ? ` ×${it.qty}` : ''}${extra}</span><span class="c">${d.category}</span><span class="w">${formatKg(itemWeight(it))}</span></li>`;
    };
    const sortItems = (arr: ItemInstance[]) => {
      const order: Category[] = ['Arma', 'Munição', 'Médico', 'Comida', 'Bebida', 'Roupa', 'Mochila', 'Mapa', 'Equipamento', 'Ferramenta', 'Material', 'Diversos'];
      return arr.slice().sort((a, b) => order.indexOf(itemDef(a.defId).category) - order.indexOf(itemDef(b.defId).category));
    };

    const left = `
      <div class="inv-col">
        <div class="inv-head"><h2>Inventário</h2><span class="foot">${p.inv.items.length}/${p.inv.maxSlots} espaços</span></div>
        <div class="equip">${slot('arma', 'Arma')}${slot('corpo', 'Corpo')}${slot('costas', 'Costas')}</div>
        <div class="kv"><span class="label">Peso total</span><b style="${over ? 'color:#d7685a' : ''}">${formatKg(pw)} / ${formatKg(p.inv.maxWeight)} kg</b></div>
        <div class="bar w${over ? ' over' : ''}"><i style="width:${Math.min(100, (pw / p.inv.maxWeight) * 100)}%"></i></div>
        <ul class="inv-list">${p.inv.items.length ? sortItems(p.inv.items).map((it) => row(it, 'p')).join('') : '<li class="empty">Você não carrega nada.</li>'}</ul>
      </div>`;

    const tabs = `<div class="tabs">${c ? `<button class="btn${this.invTab === 'container' ? ' on' : ''}" data-tab="container">${esc(c.name)}</button>` : ''}<button class="btn${this.invTab === 'condicao' ? ' on' : ''}" data-tab="condicao">Condição</button><button class="btn${this.invTab === 'fabricar' ? ' on' : ''}" data-tab="fabricar">Fabricar</button></div>`;
    let right: string;
    if (this.invTab === 'fabricar') {
      right = `<div class="inv-col">${tabs}${this.craftPanel()}</div>`;
    } else if (c && this.invTab === 'container') {
      const cw = c.inv.weight();
      right = `
        <div class="inv-col">
          ${tabs}
          <div class="inv-head"><h2>${esc(c.name)}</h2><span class="foot">${c.kind === 'corpo' ? '' : `${formatKg(cw)} / ${formatKg(c.inv.maxWeight)} kg`}</span></div>
          <ul class="inv-list">${c.inv.items.length ? sortItems(c.inv.items).map((it) => row(it, 'c')).join('') : '<li class="empty">Vazio.</li>'}</ul>
          <div style="display:flex;gap:6px;justify-content:space-between;align-items:center">
            <span class="foot">Clique duplo transfere o item.</span>
            <span><button class="btn primary" data-a="takeall" ${c.inv.items.length ? '' : 'disabled'}>Pegar tudo</button></span>
          </div>
        </div>`;
    } else {
      right = `<div class="inv-col">${tabs}${this.conditionPanel()}</div>`;
    }

    // detalhes do item selecionado
    let details = '<div class="txt">Selecione um item para ver detalhes e ações.</div>';
    if (this.selected) {
      const s = this.selected;
      const it = s.side === 'p' ? p.inv.get(s.uid) : c?.inv.get(s.uid);
      if (!it) this.selected = null;
      else {
        const d = itemDef(it.defId);
        const acts: ItemAction[] = s.side === 'p' ? playerItemActions(w, it) : containerItemActions(w, c!, it);
        details = `<div class="txt"><b>${esc(d.name)}${it.qty > 1 ? ` ×${it.qty}` : ''}</b>${esc(describeItem(it, w.gameMinutes))} <br><span class="foot">${d.category} · ${formatKg(itemWeight(it))} kg</span></div>
          <div class="acts">${acts
            .map((a) => `<button class="btn${a.primary ? ' primary' : ''}" data-act="${a.id}" ${a.enabled ? '' : `disabled title="${esc(a.reason ?? '')}"`}>${a.label}</button>`)
            .join('')}</div>`;
      }
    }
    this.inv.innerHTML = `${left}${right}<div class="details">${details}</div>`;
    this.bindInventory(c);
  }

  private craftPanel(): string {
    const w = this.host.world;
    const rows = listRecipes(w)
      .map((r) => {
        const needs = r.needs
          .map((n) => `<span style="color:${n.have >= n.need ? 'var(--green)' : 'var(--ink-faint)'}">${n.tool ? 'ferramenta: ' : ''}${esc(n.name)} ${n.tool ? '' : `${Math.min(n.have, n.need)}/${n.need}`}</span>`)
          .join(' · ');
        const cond = r.recipe.condition === 'fogo' ? ' · <span style="color:var(--amber)">perto do fogo</span>' : '';
        const tgt = r.target ? ` <small>(${esc(itemDef(r.target.defId).name)})</small>` : '';
        return `<div class="wound" style="flex-direction:column;gap:4px;align-items:stretch">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>${esc(r.recipe.name)}${tgt}</b>
          <button class="btn${r.ok ? ' primary' : ''}" data-craft="${r.recipe.id}" ${r.ok ? '' : `disabled title="${esc(r.reason ?? '')}"`}>Fabricar</button></div>
          <span class="foot">${esc(r.recipe.desc)}</span>
          <span class="foot">${needs}${cond}</span>
          ${r.ok ? '' : `<span class="foot" style="color:var(--amber)">${esc(r.reason ?? '')}</span>`}
        </div>`;
      })
      .join('');
    return `<div class="inv-head"><h2>Fabricar</h2></div><div class="cond-panel">${rows}</div>`;
  }

  private conditionPanel(): string {
    const w = this.host.world;
    const p = w.player;
    const h = p.health;
    const sev = (t: keyof typeof WOUND_SEVERITY) => (WOUND_SEVERITY[t] === 'grave' ? ' <small style="color:#d7685a">grave</small>' : ' <small>leve</small>');
    const wounds = h.wounds
      .map(
        (wd) =>
          `<div class="wound"><span>${WOUND_LABEL[wd.type]}${sev(wd.type)}</span><span class="s ${wd.bleed > 0 || wd.infected ? 'b' : ''}">${wd.bleed > 0 ? 'Sangrando' : ''}${wd.treated ? (wd.bleed > 0 ? ' · enfaixado' : 'Tratado') : wd.bleed > 0 ? '' : 'Sem sangramento'}${wd.infected ? ' · infeccionado' : wd.dirty ? ' · sujo' : ''}</span></div>`,
      )
      .join('');
    const need = (v: number) => (v < 30 ? 'Bem' : v < 60 ? 'Leve' : v < 85 ? 'Moderada' : 'Grave');
    const infection = h.infected
      ? `<div class="wound"><span>Vírus</span><span class="s b">Transmitido — fatal</span></div>`
      : '';
    const kits = p.inv.items.filter((i) => itemDef(i.defId).medical && itemDef(i.defId).medical!.kind !== 'painkiller');
    return `
      <div class="inv-head"><h2>Condição física</h2><span class="chip">${h.state}</span></div>
      <div class="cond-panel">
        <div class="row"><span class="label">Saúde</span><div class="bar hp"><i style="width:${h.hp}%"></i></div><span class="num">${Math.ceil(h.hp)}</span></div>
        <div class="row"><span class="label">Fôlego</span><div class="bar st"><i style="width:${p.stamina}%"></i></div><span class="num">${Math.round(p.stamina)}</span></div>
        <div class="kv"><span class="label">Fome</span><b>${hungerLevel(p.hunger).label}</b></div>
        <div class="kv"><span class="label">Sede</span><b>${thirstLevel(p.thirst).label}</b></div>
        <div class="kv"><span class="label">Energia</span><b>${fatigueLevel(p.fatigue).label}</b></div>
        ${p.sickHours > 0 ? '<div class="kv"><span class="label">Mal-estar</span><b style="color:#d7685a">Náusea</b></div>' : ''}
        <div class="kv"><span class="label">Relógio · clima</span><b>${w.clockText()} · ${WEATHER_LABEL[w.weather.kind]}</b></div>
        <div class="label" style="margin-top:4px">Ferimentos</div>
        ${wounds || '<div class="foot">Nenhum ferimento.</div>'}
        ${infection}
        <div class="foot" style="margin-top:6px">${
          kits.length
            ? 'Para tratar: selecione um kit médico, bandagem ou tiras de pano e use "Tratar ferimento". Cada uso trata um ferimento.'
            : 'Você não tem itens para curativos. Kits médicos e bandagens podem ser encontrados em banheiros e na delegacia.'
        }</div>
      </div>`;
  }

  private bindInventory(c: Container | undefined) {
    const w = this.host.world;
    this.inv.querySelectorAll('li[data-uid]').forEach((li) => {
      const e = li as HTMLElement;
      e.addEventListener('click', () => {
        const uid = e.dataset.uid!;
        const now = performance.now();
        const dbl = this.lastClick && this.lastClick.uid === uid && now - this.lastClick.t < 380;
        this.lastClick = { uid, t: now };
        if (!dbl) {
          this.selected = { side: e.dataset.side as 'p' | 'c', uid };
          this.renderInventory();
          return;
        }
        // clique duplo: transfere / ação principal
        this.lastClick = null;
        const done = () => this.renderInventory();
        if (e.dataset.side === 'c' && c) void this.host.act('take', c.id, uid).then(done);
        else if (e.dataset.side === 'p' && c) void this.host.act('item', 'store', uid).then(done);
        else {
          const it = w.player.inv.get(uid);
          const prim = it ? playerItemActions(w, it).find((a) => a.primary && a.enabled) : undefined;
          if (prim) void this.host.act('item', prim.id, uid).then(done);
        }
        this.renderInventory();
      });
    });
    this.inv.querySelectorAll('button[data-act]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = (b as HTMLElement).dataset.act!;
        const s = this.selected;
        if (!s) return;
        if (s.side === 'c' && c) {
          if (id === 'take') void this.host.act('take', c.id, s.uid).then(() => this.renderInventory());
          else if (id === 'examine') {
            const it = c.inv.get(s.uid);
            if (it) w.msg(`${itemDef(it.defId).name}: ${describeItem(it, w.gameMinutes)}`);
          }
        } else void this.host.act('item', id, s.uid).then(() => this.renderInventory());
        this.renderInventory();
      });
    });
    this.inv.querySelectorAll('button[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.invTab = (b as HTMLElement).dataset.tab as 'container' | 'condicao' | 'fabricar';
        this.renderInventory();
      }),
    );
    this.inv.querySelectorAll('button[data-craft]').forEach((b) =>
      b.addEventListener('click', () => {
        void this.host.act('craft', (b as HTMLElement).dataset.craft!).then(() => this.renderInventory());
      }),
    );
    this.inv.querySelector('[data-a=takeall]')?.addEventListener('click', () => {
      if (c) void this.host.act('takeAll', c.id).then(() => this.renderInventory());
    });
    this.inv.querySelector('[data-a=cond]')?.addEventListener('click', () => {
      this.invTab = 'condicao';
      this.renderInventory();
    });
    this.inv.querySelector('[data-a=cont]')?.addEventListener('click', () => {
      this.invTab = 'container';
      this.renderInventory();
    });
  }

  // ------------------------------------------------------------------ mapa
  mapKind(world: World): MapKind | null {
    const inv = world.player.inv;
    if (inv.count('mapa_completo')) return 'completo';
    if (inv.count('mapa_rasgado')) return 'rasgado';
    if (inv.count('fragmento_mapa')) return 'fragmento';
    return null;
  }

  toggleMap(): boolean {
    if (!this.mapview.classList.contains('hidden')) {
      this.mapview.classList.add('hidden');
      return true;
    }
    return this.openMap();
  }

  /** Mapas que o sobrevivente tem: o do bairro (se houver) e cada mapa/pedaço regional. */
  private maps(w: World): { key: string; label: string }[] {
    const out: { key: string; label: string }[] = [];
    const k = this.mapKind(w);
    if (k) out.push({ key: 'bairro', label: `Bairro (${k === 'completo' ? 'remendado' : k})` });
    for (const it of w.player.inv.items) {
      const d = itemDef(it.defId);
      if (d.map !== 'regional' && d.map !== 'fragmento_regional') continue;
      const st = it.state as PaperState | undefined;
      if (!st) continue;
      const reg = st.region === 'mundo' ? 'Estado' : st.region[0].toUpperCase() + st.region.slice(1);
      out.push({ key: it.uid, label: `${reg} (${COND_LABEL[st.cond] ?? st.cond}${st.pieces !== 15 ? ', incompleto' : ''})` });
    }
    return out;
  }

  openMap(uid?: string): boolean {
    const w = this.host.world;
    const maps = this.maps(w);
    if (!maps.length) {
      w.msg('Você não tem um mapa. Talvez encontre um explorando as casas.');
      return false;
    }
    this.mapSel = uid && maps.some((m) => m.key === uid) ? uid : this.mapSel && maps.some((m) => m.key === this.mapSel) ? this.mapSel : maps[0].key;
    this.inv.classList.add('hidden');
    this.dialog.classList.add('hidden');
    this.renderMap();
    this.mapview.classList.remove('hidden');
    return true;
  }

  private renderMap() {
    const w = this.host.world;
    const maps = this.maps(w);
    const sel = this.mapSel ?? maps[0]?.key;
    const kindSel = (this.mapTools.querySelector('select[data-k=mk]') as HTMLSelectElement | null)?.value ?? 'abrigo';
    const note = (this.mapTools.querySelector('input[data-k=note]') as HTMLInputElement | null)?.value ?? '';
    this.mapTools.innerHTML = `${maps.map((m) => `<button class="btn ${m.key === sel ? 'primary' : ''}" data-map="${m.key}">${esc(m.label)}</button>`).join('')}
      <span style="margin-left:8px">Marcar:</span><select data-k="mk">${Object.entries(MARKER_LABEL).map(([k, l]) => `<option value="${k}" ${k === kindSel ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <input data-k="note" maxlength="40" placeholder="anotação (opcional)" value="${esc(note)}"/>`;
    this.mapTools.querySelectorAll('button[data-map]').forEach((b) =>
      b.addEventListener('click', () => {
        this.mapSel = (b as HTMLElement).dataset.map!;
        this.renderMap();
      }),
    );
    const ni = this.mapTools.querySelector('input[data-k=note]') as HTMLInputElement;
    ni.addEventListener('keydown', (e) => e.stopPropagation());
    ni.addEventListener('keyup', (e) => e.stopPropagation());
    const markers = w.player.markers;
    if (sel === 'bairro') this.mapView.render(w, this.mapCanvas, this.mapKind(w)!, markers);
    else {
      const it = w.player.inv.get(sel ?? '');
      if (it?.state) this.mapView.renderPaper(w, this.mapCanvas, it.state as PaperState, markers);
    }
  }

  private mapClick(e: MouseEvent, remove: boolean) {
    const r = this.mapCanvas.getBoundingClientRect();
    const cx = ((e.clientX - r.left) / r.width) * this.mapCanvas.width;
    const cy = ((e.clientY - r.top) / r.height) * this.mapCanvas.height;
    const t = this.mapView.toTile(cx, cy);
    if (!t) return;
    const kind = (this.mapTools.querySelector('select[data-k=mk]') as HTMLSelectElement).value as MarkerKind;
    const note = (this.mapTools.querySelector('input[data-k=note]') as HTMLInputElement).value;
    void this.host.act(remove ? 'unmarker' : 'marker', t.x, t.y, kind, note).then(() => this.renderMap());
  }

  // ------------------------------------------------------------------ diálogo com NPC
  openDialog(a: Ally) {
    this.dialogAlly = a;
    const p = this.host.world.player;
    const hasKit = p.inv.items.some((i) => i.defId === 'kit_medico' || i.defId === 'bandagem');
    const opts: [string, string, boolean][] = [
      ['seguir', a.mode === 'seguir' ? 'Continue me seguindo.' : 'Venha comigo.', true],
      ['aguardar', 'Espere aqui.', true],
      ['dar_kit', 'Entregar kit médico / bandagem.', hasKit],
      ['estado', 'Como você está?', true],
    ];
    this.dialog.innerHTML = `<div class="who">${esc(a.name)}</div><div class="st">${ALLY_STATE_LABEL[a.state]} · ${a.hp > 70 ? 'sem ferimentos graves' : a.hp > 35 ? 'ferido' : 'gravemente ferido'}</div>
      ${opts.map(([id, label, en], i) => `<button class="btn" data-o="${id}" ${en ? '' : 'disabled'}><span class="kbd">${i + 1}</span>${label}</button>`).join('')}
      <div class="foot"><span class="kbd">Esc</span>fechar</div>`;
    this.dialog.querySelectorAll('button[data-o]').forEach((b) =>
      b.addEventListener('click', () => this.dialogChoose((b as HTMLElement).dataset.o as never)),
    );
    this.inv.classList.add('hidden');
    this.dialog.classList.remove('hidden');
  }

  dialogOpen() {
    return !this.dialog.classList.contains('hidden');
  }

  dialogChoose(id: 'seguir' | 'aguardar' | 'dar_kit' | 'estado' | number) {
    if (!this.dialogAlly) return;
    const ids = ['seguir', 'aguardar', 'dar_kit', 'estado'] as const;
    const cmd = typeof id === 'number' ? ids[id] : id;
    if (!cmd) return;
    const btn = this.dialog.querySelector(`button[data-o="${cmd}"]`) as HTMLButtonElement | null;
    if (btn?.disabled) return;
    void this.host.act('ally', this.dialogAlly.id, cmd);
    this.dialog.classList.add('hidden');
    this.dialogAlly = null;
  }
}
