// Configuração central do protótipo. Valores ajustáveis sem tocar na lógica dos sistemas.

/** Tamanho de um tile em unidades de mundo (1 unidade = 1 pixel da arte). */
export const TILE = 16;

/**
 * Regra de retorno após a morte. Ainda será definida a regra final,
 * por isso o sistema aceita várias estratégias (ver systems/Respawn.ts).
 */
export type RespawnMode =
  | 'ponto_seguro_proximo'
  | 'ultimo_ponto_seguro'
  | 'ultima_localizacao'
  | 'ponto_inicial';

export const RESPAWN_MODE_LABELS: Record<RespawnMode, string> = {
  ponto_seguro_proximo: 'Ponto seguro mais próximo do local da morte',
  ultimo_ponto_seguro: 'Último ponto seguro visitado',
  ultima_localizacao: 'Última localização segura registrada',
  ponto_inicial: 'Ponto inicial (abrigo)',
};

export const CONFIG = {
  seed: 20261114,
  respawnMode: 'ponto_seguro_proximo' as RespawnMode,

  player: {
    walkSpeed: 52,
    runSpeed: 92,
    crouchSpeed: 26,
    staminaMax: 100,
    runStaminaPerSec: 11,
    staminaRegenPerSec: 9,
    baseCarryKg: 8,
    baseSlots: 12,
    incapacitatedHp: 18,
    getUpHp: 30,
  },

  /** Raio dos ruídos em tiles. A propagação considera paredes e portas. */
  noise: {
    walk: 3,
    crouchWalk: 1,
    run: 8,
    punch: 4,
    meleeHit: 6,
    gunshot: 30,
    windowBreak: 16,
    door: 2,
    doorBash: 10,
    shout: 15,
    radio: 5,
    zombieAlert: 7,
  },

  ai: {
    /** Zumbis além desta distância do jogador pensam com menos frequência. */
    lodNear: 34 * TILE,
    /** Além desta, ficam praticamente adormecidos (apenas vagam lentamente). */
    lodFar: 70 * TILE,
    maxPathsPerTick: 6,
    visionRange: 11 * TILE,
    visionFov: (130 * Math.PI) / 180,
    proximitySense: 1.6 * TILE,
  },

  infection: {
    /** Segundos até os primeiros sintomas, febre alta e morte. */
    feverAt: 45,
    highFeverAt: 85,
    deathAt: 125,
  },
};
