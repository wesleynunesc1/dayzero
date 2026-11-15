import { CONFIG, TILE } from '../config';
import { SURVIVORS } from '../entities/Player';
import { applySave, auditUids, SaveData, serializeWorld } from '../systems/Save';
import { Simulation } from '../systems/Simulation';
import type { Decal } from '../world/types';
import { EMPTY_COMMAND, PlayerCommand, World } from '../world/World';
import { runAction } from './Actions';
import type { ClientMsg, LobbyState, Mode, ServerMsg } from './protocol';
import { MODE_HUMANS } from './protocol';
import { buildSnapshot, ClientView } from './Sync';

/**
 * Servidor AUTORITATIVO de uma partida (independente de transporte: WebSocket em produção,
 * conexões em memória nos testes). Só o servidor simula; clientes enviam comandos e ações.
 *
 * - 4 vagas de sobrevivente. A modalidade (SOLO/DUO/TRIO/QUARTETO) define quantas aceitam humanos;
 *   as demais e as vazias são controladas pela IA.
 * - Desconexão: a IA assume o personagem na hora; ao voltar (mesmo nome), o jogador reassume.
 *   O inventário NUNCA é restaurado nem apagado: o que a IA gastou/achou fica.
 * - Itens só mudam de lugar dentro do servidor (ações validadas); nada vem pronto do cliente,
 *   então latência/reconexão não duplicam itens.
 */
export interface Conn {
  id: number;
  send(msg: ServerMsg): void;
  close?(): void;
}

interface Session {
  conn: Conn;
  name: string | null;
  playerId: string | null;
  cmd: PlayerCommand;
  lastSeen: number;
  view: ClientView;
  snapT: number;
  events: { k: string; p: unknown }[];
}

export interface Store {
  load(): SaveData & { room?: RoomMeta } | null;
  save(data: SaveData & { room: RoomMeta }): void;
}

export interface RoomMeta {
  worldName: string;
  mode: Mode;
  started: boolean;
  createdAt: string;
  host: string | null;
  owners: (string | null)[];
}

const CTX_EVENTS = ['openContainer', 'closeContainer', 'inventoryChanged', 'playerHurt', 'playerDied', 'playerRespawned', 'openMap', 'allyDialog', 'npcDialog', 'vehicleEnter', 'vehicleExit', 'sleepStart', 'sleepEnd'] as const;
const ALL_EVENTS = ['weatherChanged', 'campaign', 'mission'] as const;

export class GameServer {
  world: World;
  sim: Simulation;
  room: RoomMeta;
  sessions = new Map<number, Session>();
  private outbox: { decals: Decal[]; tracers: World['tracers'] } = { decals: [], tracers: [] };
  private saveT = 0;
  /** Tempo real total (s), para timeouts. */
  clock = 0;
  stats = { ticks: 0, saves: 0, lastSaveMs: 0 };

  constructor(private store: Store | null, opts: { seed?: number; worldName?: string; mode?: Mode } = {}) {
    const saved = store?.load() ?? null;
    if (saved) {
      this.world = new World(saved.seed);
      this.sim = new Simulation(this.world);
      applySave(this.world, saved);
      this.room = saved.room ?? { worldName: 'Mundo', mode: 'SOLO', started: true, createdAt: saved.savedAt, host: null, owners: [null, null, null, null] };
    } else {
      this.world = new World(opts.seed ?? CONFIG.seed + 7);
      this.sim = new Simulation(this.world);
      this.room = { worldName: opts.worldName ?? 'Nova partida', mode: opts.mode ?? 'QUARTETO', started: false, createdAt: new Date().toISOString(), host: null, owners: [null, null, null, null] };
    }
    // ao (re)iniciar o servidor ninguém está conectado: todas as vagas ficam com a IA
    for (const p of this.world.players) {
      p.controller = 'ia';
      p.connected = false;
      p.owner = this.room.owners[p.slot] ?? null;
    }
    this.hookEvents();
  }

  // ------------------------------------------------------------------ eventos → clientes
  private hookEvents() {
    const w = this.world;
    const toPlayer = (pid: string | undefined, k: string, p: unknown) => {
      for (const s of this.sessions.values()) if (s.playerId && (!pid || s.playerId === pid)) s.events.push({ k, p });
    };
    w.events.on('message', (m) => toPlayer(m.to, 'message', m));
    w.events.on('radio', (m) => toPlayer(m.to, 'radio', m));
    for (const k of CTX_EVENTS) w.events.on(k, (p: unknown) => toPlayer(w.player.id, k, p));
    for (const k of ALL_EVENTS) w.events.on(k, (p: unknown) => toPlayer(undefined, k, p));
    w.events.on('sound', (snd) => {
      for (const s of this.sessions.values()) {
        const pl = w.playerById(s.playerId);
        if (pl && Math.hypot(pl.x - snd.x, pl.y - snd.y) < 40 * TILE) s.events.push({ k: 'sound', p: snd });
      }
    });
    // efeitos visuais vão no próximo snapshot
    const origPush = w.tracers.push.bind(w.tracers);
    w.tracers.push = (...t) => {
      this.outbox.tracers.push(...t);
      return origPush(...t);
    };
  }

  // ------------------------------------------------------------------ lobby
  lobbyState(forPlayer: string | null): LobbyState {
    const humans = MODE_HUMANS[this.room.mode];
    return {
      worldName: this.room.worldName,
      mode: this.room.mode,
      started: this.room.started,
      createdAt: this.room.createdAt,
      host: this.room.host,
      you: forPlayer,
      day: this.world.day,
      chapter: this.world.missions?.chapter ?? 1,
      slots: this.world.players.map((p) => ({
        slot: p.slot,
        playerId: p.id,
        name: p.name,
        region: SURVIVORS[p.slot].region,
        bio: SURVIVORS[p.slot].bio,
        owner: this.room.owners[p.slot] ?? null,
        connected: p.connected,
        controller: p.controller,
        aiOnly: p.slot >= humans,
        dead: p.dead,
      })),
    };
  }

  private broadcastLobby() {
    for (const s of this.sessions.values()) s.conn.send({ t: 'lobby', state: this.lobbyState(s.playerId) });
  }

  connect(conn: Conn) {
    this.sessions.set(conn.id, { conn, name: null, playerId: null, cmd: { ...EMPTY_COMMAND }, lastSeen: this.clock, view: new ClientView(), snapT: 0, events: [] });
  }

  disconnect(connId: number) {
    const s = this.sessions.get(connId);
    if (!s) return;
    this.sessions.delete(connId);
    const p = this.world.playerById(s.playerId);
    if (p) {
      // a IA assume imediatamente; a vaga continua reservada para o dono
      p.controller = 'ia';
      p.connected = false;
      this.world.msgAll(`${s.name} desconectou. A IA assumiu ${p.name}.`, 'warn');
    }
    this.broadcastLobby();
  }

  handle(connId: number, msg: ClientMsg) {
    const s = this.sessions.get(connId);
    if (!s) return;
    s.lastSeen = this.clock;
    switch (msg.t) {
      case 'hello': {
        s.name = String(msg.name ?? '').trim().slice(0, 24) || `Jogador ${connId}`;
        if (!this.room.host) this.room.host = s.name;
        // reconexão: o nome já é dono de uma vaga → reassume o mesmo personagem
        const slot = this.room.owners.findIndex((o) => o === s.name);
        if (slot >= 0) this.claim(s, slot);
        else s.conn.send({ t: 'lobby', state: this.lobbyState(null) });
        this.broadcastLobby();
        break;
      }
      case 'pick': {
        if (!s.name) return;
        const slot = Number(msg.slot);
        const humans = MODE_HUMANS[this.room.mode];
        if (!(slot >= 0 && slot < humans)) return s.conn.send({ t: 'err', msg: 'Essa vaga é da IA nesta modalidade.' });
        const owner = this.room.owners[slot];
        if (owner && owner !== s.name) return s.conn.send({ t: 'err', msg: 'Essa vaga já tem dono.' });
        if (s.playerId) {
          // trocou de personagem antes de começar
          const old = this.world.playerById(s.playerId)!;
          if (this.room.started) return s.conn.send({ t: 'err', msg: 'A campanha já começou: você continua com o mesmo sobrevivente.' });
          this.room.owners[old.slot] = null;
          old.controller = 'ia';
          old.connected = false;
          old.owner = null;
        }
        this.claim(s, slot);
        this.broadcastLobby();
        break;
      }
      case 'mode': {
        if (this.room.started || s.name !== this.room.host) return;
        if (!(msg.mode in MODE_HUMANS)) return;
        this.room.mode = msg.mode;
        const humans = MODE_HUMANS[msg.mode];
        this.room.owners = this.room.owners.map((o, i) => (i < humans ? o : null));
        for (const p of this.world.players) if (p.slot >= humans) {
          p.controller = 'ia';
          p.connected = false;
          p.owner = null;
        }
        this.broadcastLobby();
        break;
      }
      case 'start': {
        if (s.name !== this.room.host) return s.conn.send({ t: 'err', msg: 'Só quem criou o mundo inicia a campanha.' });
        this.room.started = true;
        this.broadcastLobby();
        for (const ss of this.sessions.values()) if (ss.playerId) this.sendFull(ss);
        this.saveNow();
        break;
      }
      case 'cmd':
        if (s.playerId) {
          const c = sanitize(msg.c);
          // toques únicos não se perdem se dois comandos chegarem entre dois passos
          c.attackPressed ||= s.cmd.attackPressed;
          c.interact ||= s.cmd.interact;
          c.reload ||= s.cmd.reload;
          c.toggleCrouch ||= s.cmd.toggleCrouch;
          s.cmd = c;
        }
        break;
      case 'act': {
        if (!s.playerId || !this.room.started) return;
        let r: unknown = null;
        try {
          r = runAction(this.world, s.playerId, String(msg.name), Array.isArray(msg.args) ? msg.args : []) ?? null;
        } catch (e) {
          r = { error: String(e) };
        }
        s.conn.send({ t: 'res', id: msg.id, r });
        break;
      }
      case 'ping':
        s.conn.send({ t: 'pong', at: msg.at });
        break;
    }
  }

  private claim(s: Session, slot: number) {
    const p = this.world.players[slot];
    // se havia outra sessão com esse personagem (reconexão rápida), ela perde o controle
    for (const o of this.sessions.values()) if (o !== s && o.playerId === p.id) o.playerId = null;
    this.room.owners[slot] = s.name;
    s.playerId = p.id;
    p.owner = s.name;
    p.controller = 'humano';
    p.connected = true;
    s.view = new ClientView();
    if (this.room.started) {
      this.world.msgAll(`${s.name} assumiu ${p.name}.`, 'info');
      this.sendFull(s);
    }
  }

  private sendFull(s: Session) {
    s.view = new ClientView();
    s.conn.send({ t: 'full', save: redactFor(serializeWorld(this.world), s.playerId!), you: s.playerId! });
  }

  /** Avança o servidor. `dt` em segundos reais. */
  tick(dt: number) {
    this.clock += dt;
    // sem resposta → considera desconectado (a IA assume)
    for (const [id, s] of this.sessions) if (this.clock - s.lastSeen > CONFIG.multiplayer.timeoutSec) {
      s.conn.close?.();
      this.disconnect(id);
    }
    const anyone = [...this.sessions.values()].some((s) => s.playerId);
    if (!this.room.started) return;
    if (!anyone && !CONFIG.world.simulateWhenEmpty) return; // mundo suspenso sem jogadores (configurável)
    const cmds = new Map<string, PlayerCommand>();
    for (const s of this.sessions.values()) if (s.playerId) {
      cmds.set(s.playerId, s.cmd);
      // toques únicos (atacar/interagir) valem para um passo só
      s.cmd = { ...s.cmd, attackPressed: false, interact: false, reload: false, toggleCrouch: false };
    }
    this.sim.step(dt, cmds);
    this.stats.ticks++;
    // decalques novos (o servidor não renderiza: drena a fila)
    const pend = (this.world as unknown as { pendingDecals: Decal[] }).pendingDecals;
    if (pend.length) this.outbox.decals.push(...pend.splice(0));
    if (this.world.decals.length > 4000) this.world.decals.splice(0, this.world.decals.length - 4000);
    // snapshots e eventos
    for (const s of this.sessions.values()) {
      if (!s.playerId) continue;
      if (s.events.length) {
        s.conn.send({ t: 'ev', evs: s.events });
        s.events = [];
      }
      s.snapT -= dt;
      if (s.snapT <= 0) {
        s.snapT = 1 / CONFIG.multiplayer.snapshotRate;
        s.conn.send({ t: 'snap', s: buildSnapshot(this.world, s.playerId, s.view, 1 / CONFIG.multiplayer.snapshotRate, this.outbox) });
      }
    }
    if ([...this.sessions.values()].every((s) => s.snapT > 1 / CONFIG.multiplayer.snapshotRate - dt * 1.5)) this.outbox = { decals: [], tracers: [] };
    this.saveT += dt;
    if (this.saveT >= CONFIG.multiplayer.autosaveSeconds) this.saveNow();
  }

  /** Salva o mundo inteiro (o Store faz escrita atômica + backup + gravação incremental). */
  saveNow(): boolean {
    if (!this.store) return false;
    const t0 = performance.now();
    this.saveT = 0;
    const data = serializeWorld(this.world);
    const audit = auditUids(data);
    if (audit.duplicates.length) {
      console.error('[servidor] itens duplicados detectados — salvamento abortado', audit.duplicates.slice(0, 5));
      return false;
    }
    this.store.save({ ...data, room: this.room });
    this.stats.saves++;
    this.stats.lastSaveMs = performance.now() - t0;
    return true;
  }
}

function sanitize(c: PlayerCommand): PlayerCommand {
  const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const clamp1 = (v: unknown) => Math.max(-1, Math.min(1, n(v)));
  return {
    mx: clamp1(c?.mx),
    my: clamp1(c?.my),
    run: !!c?.run,
    toggleCrouch: !!c?.toggleCrouch,
    aimX: n(c?.aimX),
    aimY: n(c?.aimY),
    attack: !!c?.attack,
    attackPressed: !!c?.attackPressed,
    aimHeld: !!c?.aimHeld,
    interact: !!c?.interact,
    reload: !!c?.reload,
  };
}

/**
 * Remove do save enviado a um cliente o que ele não deveria saber: posição de quem está longe
 * e as marcações de mapa dos outros (que são pessoais).
 */
export function redactFor(data: SaveData, you: string): SaveData {
  const me = data.players.find((p) => p.id === you);
  const R = CONFIG.multiplayer.interestRadius * TILE;
  data.players = data.players.map((p) => {
    if (p.id === you) return p;
    const far = !me || Math.abs(p.x - me.x) > R || Math.abs(p.y - me.y) > R;
    return { ...p, markers: [], ...(far ? { x: -1e6, y: -1e6, lastSafePos: { x: -1e6, y: -1e6 } } : {}) };
  });
  return data;
}
