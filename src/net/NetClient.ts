import type { PlayerCommand } from '../world/World';
import type { SaveData } from '../systems/Save';
import type { ActionResult } from './Actions';
import type { ClientMsg, LobbyState, Mode, ServerMsg } from './protocol';
import type { Snapshot } from './Sync';

/**
 * Cliente de rede. Não simula nada: envia comandos/ações e recebe o estado do servidor.
 * Funciona no navegador e no Node 22+ (WebSocket global) — usado também nos testes.
 */
export class NetClient {
  private ws: WebSocket | null = null;
  private seq = 1;
  private pending = new Map<number, (r: ActionResult) => void>();
  private lastCmd = '';
  private cmdT = 0;
  lobby: LobbyState | null = null;
  you: string | null = null;
  rtt = 0;
  onLobby: (s: LobbyState) => void = () => {};
  onFull: (save: SaveData, you: string) => void = () => {};
  onSnap: (s: Snapshot) => void = () => {};
  onEvents: (evs: { k: string; p: unknown }[]) => void = () => {};
  onError: (msg: string) => void = () => {};
  onClose: () => void = () => {};

  connect(url: string, name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(e);
        return;
      }
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error('Tempo esgotado ao conectar.')), 6000);
      ws.onopen = () => {
        clearTimeout(timer);
        this.send({ t: 'hello', name });
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Não foi possível conectar ao servidor.'));
      };
      ws.onclose = () => {
        this.ws = null;
        for (const r of this.pending.values()) r(undefined);
        this.pending.clear();
        this.onClose();
      };
      ws.onmessage = (ev) => this.receive(JSON.parse(String(ev.data)) as ServerMsg);
    });
  }

  get connected() {
    return !!this.ws && this.ws.readyState === 1;
  }

  close() {
    this.ws?.close();
  }

  private send(m: ClientMsg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  private receive(m: ServerMsg) {
    switch (m.t) {
      case 'lobby':
        this.lobby = m.state;
        if (m.state.you) this.you = m.state.you;
        this.onLobby(m.state);
        break;
      case 'full':
        this.you = m.you;
        this.onFull(m.save, m.you);
        break;
      case 'snap':
        this.onSnap(m.s);
        break;
      case 'ev':
        this.onEvents(m.evs);
        break;
      case 'res': {
        const r = this.pending.get(m.id);
        this.pending.delete(m.id);
        r?.(m.r as ActionResult);
        break;
      }
      case 'err':
        this.onError(m.msg);
        break;
      case 'pong':
        this.rtt = Date.now() - m.at;
        break;
    }
  }

  pick(slot: number) {
    this.send({ t: 'pick', slot });
  }
  setMode(mode: Mode) {
    this.send({ t: 'mode', mode });
  }
  start() {
    this.send({ t: 'start' });
  }

  /** Envia o comando de controle (no máx. ~30×/s, ou na hora se houver um toque único). */
  sendCmd(c: PlayerCommand, dt: number) {
    this.cmdT -= dt;
    const key = JSON.stringify(c);
    const urgent = c.attackPressed || c.interact || c.reload || c.toggleCrouch;
    if (!urgent && (this.cmdT > 0 || key === this.lastCmd) && this.cmdT > -0.5) return;
    this.cmdT = 1 / 30;
    this.lastCmd = key;
    this.send({ t: 'cmd', c });
  }

  ping() {
    this.send({ t: 'ping', at: Date.now() });
  }

  /** Ação discreta: o servidor executa e devolve o resultado. */
  request(name: string, args: unknown[]): Promise<ActionResult> {
    const id = this.seq++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.send({ t: 'act', id, name, args });
      setTimeout(() => {
        if (this.pending.delete(id)) resolve(undefined);
      }, 8000);
    });
  }
}
