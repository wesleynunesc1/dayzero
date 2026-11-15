import { CONFIG, TILE } from '../config';
import { itemDef, ItemInstance } from '../data/items';
import { dist } from '../engine/math';
import type { Player } from '../entities/Player';
import { T } from '../world/tiles';
import type { World } from '../world/World';

/**
 * Comunicação. NÃO existe chat global:
 * - Fala local: só quem está perto ouve (gritar alcança mais, mas faz barulho).
 * - Rádio: precisa de um rádio funcional, ligado, com bateria, na MESMA frequência.
 *   O alcance cai com a distância, montanhas no caminho e chuva (interferência → chiado).
 *   Uma estação fixa (base militar, torre do aeroporto) alcança o mapa inteiro.
 * - Nenhuma mensagem carrega coordenadas: quem ouve só sabe o que o outro disser.
 *
 * Limitação assumida: voz em tempo real não foi implementada; o rádio transmite texto curto.
 */

export interface RadioMsg {
  to: string;
  from: string;
  freq: number;
  text: string;
  quality: number;
}

export function radioOf(p: Player): ItemInstance | null {
  return p.inv.items.find((i) => itemDef(i.defId).radio) ?? null;
}

/** Motivo pelo qual o rádio não funciona (ou null se funciona). */
export function radioProblem(p: Player): string | null {
  const r = radioOf(p);
  if (!r) return 'Você não tem um rádio.';
  if ((r.condition ?? 1) < 0.15) return 'O rádio está danificado.';
  if ((r.state?.battery ?? 0) <= 0) return 'O rádio está sem bateria.';
  if (!r.state?.on) return 'O rádio está desligado.';
  return null;
}

export function usableRadio(p: Player): ItemInstance | null {
  return radioProblem(p) ? null : radioOf(p);
}

/** Perto de uma estação de rádio fixa? (base, torre) */
export function atStation(world: World, x: number, y: number): boolean {
  for (const pr of world.props) {
    if (pr.kind !== 'radio_station') continue;
    if (dist(x, y, (pr.x + pr.w / 2) * TILE, (pr.y + pr.h / 2) * TILE) < 3 * TILE) return true;
  }
  return false;
}

/** Qualidade do sinal (0..1) entre dois pontos. */
export function signal(world: World, ax: number, ay: number, bx: number, by: number): number {
  const range = (atStation(world, ax, ay) || atStation(world, bx, by) ? CONFIG.radio.stationRangeTiles : CONFIG.radio.rangeTiles) * TILE;
  const d = dist(ax, ay, bx, by);
  let q = 1 - d / range;
  // montanhas no caminho bloqueiam parte do sinal (amostragem a cada 4 tiles)
  const steps = Math.floor(d / (4 * TILE));
  let rock = 0;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const tx = Math.floor((ax + (bx - ax) * t) / TILE);
    const ty = Math.floor((ay + (by - ay) * t) / TILE);
    if (world.map.get(tx, ty) === T.ROCK) rock++;
  }
  q -= rock * CONFIG.radio.mountainPenalty * 4;
  if (world.weather.kind === 'chuva') q -= CONFIG.radio.rainInterference;
  return Math.max(0, Math.min(1, q));
}

/** Chiado: troca trechos por "…" conforme a qualidade. Determinístico pelo texto. */
export function garble(text: string, q: number): string {
  if (q >= 0.85) return text;
  const words = text.split(' ');
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return words
    .map((w, i) => {
      h = (h * 1103515245 + 12345 + i) >>> 0;
      return (h % 1000) / 1000 > q + 0.15 ? '…' : w;
    })
    .join(' ')
    .replace(/(… )+…/g, '… [chiado] …');
}

/** Estações de facções que transmitem sozinhas (pistas da campanha). */
interface Broadcast {
  faction: string;
  freq: number;
  x: number;
  y: number;
  every: number;
  lines: string[];
  idx: number;
  t: number;
}

export class RadioSystem {
  log: RadioMsg[] = [];
  broadcasts: Broadcast[];
  /** Respostas pendentes de NPCs operadores (com atraso). */
  private replies: { at: number; from: string; freq: number; text: string; to: string }[] = [];
  /** Chamada respondida pela base Sentinela (campanha cap. 3). */
  baseContact = new Set<string>();

  constructor(private world: World) {
    const tower = world.radioTower;
    this.broadcasts = [
      {
        faction: 'vitalis', freq: 7, x: tower.x * TILE, y: tower.y * TILE, every: 240, idx: 0, t: 30,
        lines: [
          '…aqui é a Dra. Helena Vitalis… transmitindo do aeroporto… alguém na escuta?…',
          '…a infecção começou em Santa Aurora… o prontuário do primeiro paciente… hospital…',
          '…precisamos da amostra, do reagente R-4 e da centrífuga… sem eles não há vacina…',
        ],
      },
      {
        faction: 'sentinela', freq: 4, x: 478 * TILE, y: 62 * TILE, every: 300, idx: 0, t: 90,
        lines: ['Base Sentinela, frequência 4. Sobreviventes, identifiquem-se. Não se aproximem armados.', 'Base Sentinela. Toque de recolher ao anoitecer. Área restrita: comando e paiol.'],
      },
    ];
  }

  /** Bateria gasta enquanto ligado; transmissões automáticas; respostas atrasadas. */
  update(dt: number) {
    const w = this.world;
    const hours = (dt * CONFIG.time.minutesPerSecond) / 60;
    for (const p of w.players) {
      const r = radioOf(p);
      if (r?.state?.on) {
        r.state.battery = Math.max(0, (r.state.battery ?? 0) - CONFIG.radio.batteryPerHour * hours);
        if (r.state.battery <= 0) {
          r.state.on = false;
          w.withPlayer(p, () => w.msg('O rádio apagou: bateria esgotada.', 'warn'));
        }
      }
    }
    for (const b of this.broadcasts) {
      b.t -= dt;
      if (b.t > 0) continue;
      b.t = b.every;
      const line = b.lines[b.idx % b.lines.length];
      b.idx++;
      this.deliverFrom(b.x, b.y, b.freq, b.faction === 'vitalis' ? 'Voz feminina' : 'Base Sentinela', line, null);
    }
    for (let i = this.replies.length - 1; i >= 0; i--) {
      const r = this.replies[i];
      if (w.time < r.at) continue;
      this.replies.splice(i, 1);
      const p = w.playerById(r.to);
      if (!p) continue;
      const radio = usableRadio(p);
      if (!radio || radio.state!.freq !== r.freq) continue;
      this.push({ to: p.id, from: r.from, freq: r.freq, text: r.text, quality: 1 });
    }
  }

  private push(m: RadioMsg) {
    this.log.push(m);
    if (this.log.length > 200) this.log.shift();
    this.world.events.emit('message', { text: `📻 [Canal ${m.freq}] ${m.from}: ${m.text}`, tone: 'npc', to: m.to });
    this.world.events.emit('radio', m);
  }

  /** Entrega uma transmissão a todos os sobreviventes sintonizados ao alcance. */
  private deliverFrom(x: number, y: number, freq: number, from: string, text: string, senderId: string | null): number {
    const w = this.world;
    let n = 0;
    for (const p of w.players) {
      if (p.id === senderId || p.dead) continue;
      const r = usableRadio(p);
      if (!r || r.state!.freq !== freq) continue;
      const q = signal(w, x, y, p.x, p.y);
      if (q < 0.12) continue;
      this.push({ to: p.id, from, freq, text: garble(text, q), quality: q });
      if (senderId) {
        p.contacts.add(senderId);
        w.playerById(senderId)?.contacts.add(p.id);
        w.missions?.onEvent('contato_radio', { from: senderId, to: p.id });
      }
      n++;
    }
    return n;
  }

  /** Transmite pelo rádio do sobrevivente. Retorna quantos receberam (o emissor não sabe). */
  transmit(p: Player, text: string): { ok: boolean; reason?: string } {
    const w = this.world;
    const clean = text.trim().slice(0, 140);
    if (!clean) return { ok: false, reason: 'Mensagem vazia.' };
    const prob = radioProblem(p);
    if (prob) return { ok: false, reason: prob };
    const r = radioOf(p)!;
    r.state!.battery = Math.max(0, (r.state!.battery ?? 0) - CONFIG.radio.batteryPerMessage);
    const freq = r.state!.freq ?? 1;
    w.withPlayer(p, () => w.msg(`📻 [Canal ${freq}] Você: ${clean}`, 'info'));
    w.makeNoise(p.x, p.y, 3, 'voz', true, p.id);
    this.deliverFrom(p.x, p.y, freq, p.name, clean, p.id);
    // a Base Sentinela escuta o canal 4 (se o sinal chegar até a base)
    if (freq === 4 && signal(w, p.x, p.y, 478 * TILE, 62 * TILE) >= 0.12) {
      const first = !this.baseContact.has(p.id);
      this.baseContact.add(p.id);
      this.replies.push({
        at: w.time + 4, from: 'Soldada Paiva (Base Sentinela)', freq: 4, to: p.id,
        text: first ? `Recebido, ${p.name.split(' ')[0]}. Aqui é a Base Sentinela, extremo nordeste, depois do aeroporto. Venha desarmado pelo portão oeste.` : 'Recebido. Mantenha este canal.',
      });
      w.missions?.onEvent('contato_base', { player: p.id });
    }
    // a equipe Vitalis responde no canal 7 quando ouve alguém
    if (freq === 7 && signal(w, p.x, p.y, w.radioTower.x * TILE, w.radioTower.y * TILE) >= 0.12) {
      this.replies.push({ at: w.time + 6, from: 'Dra. Helena Vitalis', freq: 7, to: p.id, text: 'Graças a Deus, alguém! Estamos no hangar do aeroporto, região Leste. Precisamos de ajuda para terminar a vacina.' });
      w.missions?.onEvent('contato_vitalis', { player: p.id });
    }
    w.missions?.onEvent('radio_texto', { player: p.id, freq, text: clean });
    w.events.emit('radioSent', { from: p.id, freq, text: clean });
    return { ok: true };
  }

  /** Resposta de um sobrevivente controlado pela IA (descreve onde está em palavras, nunca coordenadas). */
  botReply(bot: Player, to: Player, text: string) {
    const r = usableRadio(bot);
    if (!r) return;
    this.replies.push({ at: this.world.time + 3, from: bot.name, freq: r.state!.freq ?? 1, to: to.id, text });
  }
}

/** Fala local: só quem está perto ouve. Gritar alcança mais e atrai infectados. */
export function speak(world: World, p: Player, text: string, shout = false): number {
  const clean = text.trim().slice(0, 140);
  if (!clean) return 0;
  const range = (shout ? CONFIG.radio.shoutRangeTiles : CONFIG.radio.talkRangeTiles) * TILE;
  world.withPlayer(p, () => world.msg(`${shout ? '📢' : '💬'} Você${shout ? ' (gritando)' : ''}: ${clean}`, 'info'));
  if (shout) world.makeNoise(p.x, p.y, CONFIG.radio.shoutRangeTiles, 'grito', true, p.id);
  let n = 0;
  for (const o of world.players) {
    if (o === p || o.dead) continue;
    const d = dist(o.x, o.y, p.x, p.y);
    // fala normal precisa de linha de visão ou estar muito perto; grito atravessa paredes
    if (d > range || (!shout && d > 3 * TILE && !world.map.los(o.x, o.y, p.x, p.y))) continue;
    world.events.emit('message', { text: `${shout ? '📢' : '💬'} ${p.name}${shout ? ' (gritando)' : ''}: ${clean}`, tone: 'npc', to: o.id });
    o.contacts.add(p.id);
    p.contacts.add(o.id);
    n++;
  }
  world.missions?.onEvent('radio_texto', { player: p.id, text: clean });
  world.events.emit('localSpeech', { from: p.id, text: clean, shout });
  return n;
}
