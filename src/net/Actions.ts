import type { World } from '../world/World';
import { allyCommand, AllyCommand } from '../systems/AllyAI';
import { craft } from '../systems/Crafting';
import { doPlayerItemAction, takeAll, takeFromContainer } from '../systems/ItemActions';
import { respawnPlayer } from '../systems/Respawn';
import { speak } from '../systems/Radio';
import { dialogChoose, dialogView, proposeTrade, type DialogView } from '../systems/Social';
import type { Npc } from '../entities/Npc';

/**
 * Ações discretas do jogador (tudo que a interface pode pedir além do movimento).
 * Executadas SEMPRE no mundo autoritativo, no contexto do sobrevivente que pediu:
 * - offline: direto no mundo local;
 * - online: o cliente envia {acao, args}; o servidor valida e executa aqui.
 * Assim o inventário, saque, combate, missões e veículos nunca são decididos pelo cliente.
 */
export type ActionResult = { dialog?: DialogView | null; text?: string; ok?: boolean } | void;

const MAX_STR = 160;
const str = (v: unknown) => String(v ?? '').slice(0, MAX_STR);

function npcNear(w: World, id: unknown): Npc | null {
  const n = w.npcs.find((x) => x.id === id);
  if (!n || n.state === 'morto') return null;
  if (Math.hypot(n.x - w.player.x, n.y - w.player.y) > 48) return null;
  return n;
}

export const ACTIONS: Record<string, (w: World, ...args: unknown[]) => ActionResult> = {
  item: (w, actionId, uid) => doPlayerItemAction(w, str(actionId), str(uid)),
  take: (w, cid, uid, qty) => {
    const c = w.containers.get(str(cid)) ?? w.corpses.find((k) => k.container.id === cid)?.container;
    if (!c || w.player.openContainer !== c.id) return; // só do recipiente que ESTE jogador abriu
    takeFromContainer(w, c, str(uid), typeof qty === 'number' ? qty : undefined);
  },
  takeAll: (w, cid) => {
    const c = w.containers.get(str(cid)) ?? w.corpses.find((k) => k.container.id === cid)?.container;
    if (!c || w.player.openContainer !== c.id) return;
    takeAll(w, c);
  },
  closeContainer: (w) => {
    w.player.openContainer = null;
  },
  craft: (w, id) => {
    craft(w, str(id));
  },
  ally: (w, allyId, cmd) => {
    const a = w.allies.find((x) => x.id === allyId);
    if (a) allyCommand(w, a, str(cmd) as AllyCommand);
  },
  respawn: (w) => {
    if (w.player.dead) respawnPlayer(w);
  },
  speak: (w, text, shout) => {
    if (w.player.dead) return;
    speak(w, w.player, str(text), !!shout);
  },
  radio: (w, text) => {
    const r = w.radio?.transmit(w.player, str(text));
    if (r && !r.ok) w.msg(r.reason ?? 'Não foi possível transmitir.', 'warn');
  },
  npcOpen: (w, npcId) => {
    const n = npcNear(w, npcId);
    if (!n) return { dialog: null };
    n.talkingTo = w.player.id;
    return { dialog: withCampaign(w, n, dialogView(w, n, w.player)) };
  },
  npcChoose: (w, npcId, opt) => {
    const n = npcNear(w, npcId);
    if (!n) return { dialog: null };
    const o = str(opt);
    const extra = w.missions?.npcChoose(n, w.player, o);
    const text = extra ?? dialogChoose(w, n, w.player, o);
    if (text === null) return { dialog: null };
    return { dialog: withCampaign(w, n, dialogView(w, n, w.player, text)) };
  },
  trade: (w, npcId, give, take) => {
    const n = npcNear(w, npcId);
    if (!n) return { text: 'Longe demais.', ok: false };
    const g = Array.isArray(give) ? give.map(str).slice(0, 20) : [];
    const t = Array.isArray(take) ? take.map(str).slice(0, 20) : [];
    return proposeTrade(w, n, w.player, g, t);
  },
  marker: (w, x, y, kind, note) => {
    const p = w.player;
    if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) return;
    if (p.markers.length >= 120) p.markers.shift();
    p.markers.push({ x, y, kind: str(kind).slice(0, 20), note: str(note).slice(0, 40) });
  },
  unmarker: (w, x, y) => {
    const p = w.player;
    if (typeof x !== 'number' || typeof y !== 'number') return;
    let bi = -1;
    let bd = 4;
    p.markers.forEach((m, i) => {
      const d = Math.hypot(m.x - x, m.y - y);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    if (bi >= 0) p.markers.splice(bi, 1);
  },
};

function withCampaign(w: World, n: Npc, v: DialogView): DialogView {
  const extra = w.missions?.npcOptions(n, w.player) ?? [];
  if (extra.length) v.options.splice(v.options.length - 1, 0, ...extra.map((e) => ({ ...e, enabled: true })));
  return v;
}

/** Executa uma ação no contexto de um sobrevivente (servidor ou modo offline). */
export function runAction(w: World, playerId: string, name: string, args: unknown[]): ActionResult {
  const fn = ACTIONS[name];
  const p = w.playerById(playerId);
  if (!fn || !p) return;
  return w.withPlayer(p, () => fn(w, ...args));
}
