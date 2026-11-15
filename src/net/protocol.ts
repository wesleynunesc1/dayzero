import type { PlayerCommand } from '../world/World';
import type { SaveData } from '../systems/Save';
import type { Snapshot } from './Sync';

/** Modalidade: quantos sobreviventes são humanos (o resto fica com a IA). */
export type Mode = 'SOLO' | 'DUO' | 'TRIO' | 'QUARTETO';
export const MODE_HUMANS: Record<Mode, number> = { SOLO: 1, DUO: 2, TRIO: 3, QUARTETO: 4 };

export interface SlotInfo {
  slot: number;
  playerId: string;
  name: string;
  region: string;
  bio: string;
  /** Nome do jogador humano dono da vaga (null = vaga livre). */
  owner: string | null;
  connected: boolean;
  controller: 'humano' | 'ia';
  /** Vaga reservada para IA pela modalidade escolhida. */
  aiOnly: boolean;
  dead: boolean;
}

export interface LobbyState {
  worldName: string;
  mode: Mode;
  started: boolean;
  createdAt: string;
  host: string | null;
  slots: SlotInfo[];
  you: string | null;
  day: number;
  chapter: number;
}

export type ClientMsg =
  | { t: 'hello'; name: string }
  | { t: 'pick'; slot: number }
  | { t: 'mode'; mode: Mode }
  | { t: 'start' }
  | { t: 'cmd'; c: PlayerCommand }
  | { t: 'act'; id: number; name: string; args: unknown[] }
  | { t: 'ping'; at: number };

export type ServerMsg =
  | { t: 'lobby'; state: LobbyState }
  | { t: 'full'; save: SaveData; you: string }
  | { t: 'snap'; s: Snapshot }
  | { t: 'ev'; evs: { k: string; p: unknown }[] }
  | { t: 'res'; id: number; r: unknown }
  | { t: 'err'; msg: string }
  | { t: 'pong'; at: number };
