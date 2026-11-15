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
  /** Sobreviventes do grupo podem ferir uns aos outros? */
  friendlyFire: false,

  player: {
    walkSpeed: 52,
    runSpeed: 92,
    crouchSpeed: 26,
    staminaMax: 100,
    runStaminaPerSec: 11,
    staminaRegenPerSec: 9,
    baseCarryKg: 10,
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

  /**
   * Infecção zumbi (Etapa 2): se um ataque TRANSMITE o vírus, a morte é imediata
   * enquanto a cura não existir. Probabilidades por tipo de ferimento ficam configuráveis.
   * deathDelaySec > 0 permite testar um pequeno atraso (nunca uma progressão de dias).
   */
  infection: {
    transmission: { mordida: 1.0, laceracao: 0, arranhao: 0 } as Record<'mordida' | 'laceracao' | 'arranhao', number>,
    deathDelaySec: 0,
    /**
     * Regra APÓS a vacina existir (decisão de design ainda em aberto — não inventamos uma solução
     * definitiva). Opções: 'imune' (mordida deixa de transmitir para quem tomou a vacina),
     * 'resistente' (só a chance de transmissão cai para transmissaoResistente),
     * 'sem_efeito' (a vacina não muda nada; só a campanha avança).
     */
    afterVaccine: 'imune' as 'imune' | 'resistente' | 'sem_efeito',
    transmissaoResistente: 0.25,
  },

  /** Relógio do mundo: 1 segundo real = N minutos de jogo. Sem prazo de campanha. */
  time: {
    minutesPerSecond: 1,
    startHour: 6,
    /** Passos de simulação por quadro enquanto o personagem dorme (aceleração real do tempo). */
    sleepStepsPerFrame: 240,
  },

  /** Fome, sede e fadiga — valores por HORA de jogo (0 = satisfeito, 100 = extremo). */
  needs: {
    hungerPerHour: 2.6,
    thirstPerHour: 4.2,
    fatiguePerHour: 4.0,
    /** Multiplicadores de gasto durante esforço. */
    runMul: 2.4,
    fightHungerPerSwing: 0.08,
    fightFatiguePerSwing: 0.05,
    /** Acima desta fração da capacidade, o peso cansa mais. */
    heavyLoadFrac: 0.75,
    heavyLoadMul: 1.4,
    /** Dormindo, o corpo gasta menos. */
    sleepingMul: 0.45,
    /** Perda de vida por hora de jogo nos estados extremos (consequência gradual, nunca instantânea). */
    starvationHpPerHour: 3,
    dehydrationHpPerHour: 9,
    /** Recuperação de fadiga por hora dormindo, conforme o local. */
    sleepRecovery: { cama: 16, sofa: 11, banco: 6 } as Record<'cama' | 'sofa' | 'banco', number>,
    /** Fadiga mínima para conseguir dormir. */
    minFatigueToSleep: 25,
    /** Chance de passar mal com comida estragada / água não tratada. */
    rottenSickChance: 0.6,
    dirtyWaterSickChance: 0.4,
    /** Horas de mal-estar (náusea) e perda de vida por hora durante ele. */
    sickHours: 4,
    sickHpPerHour: 2,
  },

  /** Ferimentos tratados com material não estéril podem infeccionar (bactéria, não o vírus). */
  wounds: {
    dirtyInfectAfterHours: 6,
    infectedHpPerHour: 1.5,
  },

  vehicle: {
    /** Consumo em litros por segundo real. */
    fuelIdlePerSec: 0.004,
    fuelThrottlePerSec: 0.045,
    noiseIdle: 9,
    noiseThrottle: 22,
  },

  weather: {
    /** Duração de cada condição, em horas de jogo [mín, máx]. */
    durationHours: { limpo: [3, 8], chuva: [1.5, 4], neblina: [1, 3] } as Record<'limpo' | 'chuva' | 'neblina', [number, number]>,
    /** Chance da próxima condição (após tempo limpo). */
    nextChance: { chuva: 0.45, neblina: 0.3 },
    /** Chuva abafa sons; neblina reduz a visão (de todos). */
    rainNoiseMul: 0.7,
    rainVisionMul: 0.85,
    fogVisionMul: 0.55,
    /** Litros por hora que um barril de chuva recolhe. */
    rainBarrelLitersPerHour: 6,
  },

  save: {
    key: 'oua.save.v3',
    legacyKey: 'oua.save.v2',
    autosaveSeconds: 90,
  },

  /** Mundo grande (Etapas 3–5): carregamento por regiões e hordas migratórias. */
  world: {
    /** Raio (em células de 32×32 tiles) mantido ativo ao redor de cada sobrevivente. */
    activeRadiusCells: 2,
    /** Velocidade das hordas em modo macro (px/s). */
    hordeSpeed: 9,
    /** Horas de descanso de uma horda numa cidade antes de migrar [mín, máx]. */
    hordeRestHours: [6, 20] as [number, number],
    /** Se o mundo continua sendo simulado sem nenhum jogador conectado (servidor). */
    simulateWhenEmpty: false,
  },

  /** Multijogador: 1–4 sobreviventes; vagas vazias ficam com IA. */
  multiplayer: {
    maxSlots: 4,
    tickRate: 60,
    snapshotRate: 15,
    /** Raio de interesse (tiles) para enviar entidades a cada cliente. */
    interestRadius: 34,
    port: 8787,
    /** Segundos sem resposta até considerar o jogador desconectado (IA assume). */
    timeoutSec: 6,
    autosaveSeconds: 60,
  },

  /** Rádio e comunicação. Não há chat global: só fala local e rádio. */
  radio: {
    /** Alcance base de um rádio portátil (tiles). */
    rangeTiles: 150,
    /** Estações fixas (torre/base) alcançam o mundo todo. */
    stationRangeTiles: 700,
    /** Bateria gasta por hora de jogo ligado (0–100). */
    batteryPerHour: 4,
    batteryPerMessage: 0.6,
    frequencies: [1, 2, 3, 4, 5, 6, 7, 8],
    /** Montanhas entre os rádios aumentam a interferência. */
    mountainPenalty: 0.012,
    rainInterference: 0.15,
    /** Alcance (tiles) da voz sem rádio. Gritar alcança mais e faz barulho. */
    talkRangeTiles: 9,
    shoutRangeTiles: 18,
  },

  /** NPCs com identidade: tudo determinístico, sem chamadas a modelos externos. */
  npc: {
    /** Horas que um NPC espera por ajuda antes de guardar ressentimento. */
    helpWaitHours: 3,
    memoryMax: 40,
    senseRange: 11 * TILE,
    /** NPCs fora das áreas ativas pensam em modo econômico (a cada N segundos). */
    farThinkSec: 2,
  },

  /** Facções: reputação vai de -100 (inimigo) a 100 (aliado). */
  factions: {
    hostileBelow: -40,
    friendlyAbove: 30,
    killMemberRep: -60,
    stealRep: -15,
    tradeRep: 3,
    helpRep: 12,
    /** Segundos que os guardas esperam pela rendição antes de atacar. */
    surrenderWaitSec: 6,
  },
};
