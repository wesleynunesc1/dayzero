/** Banco de dados de itens. Toda a lógica consulta estas definições pelo identificador. */

export type Category =
  | 'Comida'
  | 'Bebida'
  | 'Médico'
  | 'Arma'
  | 'Munição'
  | 'Roupa'
  | 'Mochila'
  | 'Ferramenta'
  | 'Material'
  | 'Equipamento'
  | 'Diversos'
  | 'Combustível'
  | 'Missão'
  | 'Documento'
  | 'Mapa';

export interface WeaponStats {
  kind: 'unarmed' | 'melee' | 'gun';
  damage: number;
  /** Alcance em pixels a partir da borda do atacante. */
  range: number;
  /** Abertura do golpe em radianos. */
  arc: number;
  cooldown: number;
  stamina: number;
  knockback: number;
  noise: number;
  maxTargets: number;
  /** Chance de derrubar o alvo. */
  knockdown: number;
  ammo?: string;
  magazine?: number;
  /** Dispersão em radianos (armas de fogo). */
  spread?: number;
  reloadTime?: number;
  /** Visual: comprimento da arma corpo a corpo em pixels. */
  length?: number;
}

export interface ItemDef {
  id: string;
  name: string;
  category: Category;
  /** Peso unitário em kg. */
  weight: number;
  desc: string;
  /** Tamanho máximo de pilha (1 = não empilha). */
  stack?: number;
  /** Condição máxima (durabilidade). */
  durability?: number;
  weapon?: WeaponStats;
  /**
   * Alimento/bebida. hunger/thirst = quanto REDUZ. kcal = valor nutricional simplificado (informativo).
   * perishable: horas até "passado" e até "estragado". edible=false: precisa ser cozido.
   */
  food?: {
    verb: 'Comer' | 'Beber';
    hunger?: number;
    thirst?: number;
    uses?: number;
    edible?: boolean;
    kcal?: number;
    perishable?: { freshHours: number; staleHours: number };
  };
  /** Recipiente de água: capacidade em doses (1 dose = 250 ml). */
  water?: { capacity: number; emptyWeight: number };
  /** Recipiente de combustível: capacidade em litros. */
  fuelCan?: { capacity: number; emptyWeight: number };
  /** Ferramenta (não é consumida em receitas). */
  tool?: boolean;
  medical?: {
    /** kit: trata qualquer ferimento e desinfeta · bandage: estanca · improvised/rag: reduz, não estéril ·
     *  curativo: só ferimentos leves · antisseptico: limpa ferimento sujo · painkiller: dor */
    kind: 'kit' | 'bandage' | 'improvised' | 'rag' | 'curativo' | 'antisseptico' | 'painkiller';
    uses: number;
    quality: number;
    time: number;
  };
  backpack?: { weight: number; slots: number };
  wear?: { armor: number; biteProtect: number };
  light?: { radius: number };
  radio?: boolean;
  batteries?: boolean;
  map?: 'rasgado' | 'fragmento' | 'completo' | 'regional' | 'fragmento_regional';
  /** Texto legível (documentos da campanha). */
  text?: string;
  /** Pode ser rasgado em N tiras de pano. */
  tearable?: number;
}

const deg = (d: number) => (d * Math.PI) / 180;

export const FISTS: WeaponStats = {
  kind: 'unarmed',
  damage: 6,
  range: 11,
  arc: deg(80),
  cooldown: 0.45,
  stamina: 5,
  knockback: 85,
  noise: 4,
  maxTargets: 1,
  knockdown: 0.12,
};

const list: ItemDef[] = [
  // ---------- Comida ----------
  { id: 'feijao_lata', name: 'Lata de feijão', category: 'Comida', weight: 0.5, stack: 6, desc: 'Feijão cozido em lata. Ainda dentro da validade, por pouco.', food: { verb: 'Comer', hunger: 35, thirst: -5, kcal: 420 } },
  { id: 'sardinha', name: 'Sardinha em lata', category: 'Comida', weight: 0.2, stack: 8, desc: 'Lata com abertura fácil. Salgada.', food: { verb: 'Comer', hunger: 22, thirst: -6, kcal: 250 } },
  { id: 'carne_lata', name: 'Carne enlatada', category: 'Comida', weight: 0.4, stack: 6, desc: 'Carne bovina cozida em conserva. Alimento industrializado durável.', food: { verb: 'Comer', hunger: 30, thirst: -6, kcal: 380 } },
  { id: 'biscoito', name: 'Pacote de biscoitos', category: 'Comida', weight: 0.2, stack: 6, desc: 'Biscoito de água e sal. Um pouco murcho.', food: { verb: 'Comer', hunger: 14, thirst: -3, kcal: 180 } },
  { id: 'barra_cereal', name: 'Barra de cereal', category: 'Comida', weight: 0.05, stack: 10, desc: 'Leve e prática.', food: { verb: 'Comer', hunger: 9, kcal: 110 } },
  { id: 'chocolate', name: 'Chocolate', category: 'Comida', weight: 0.1, stack: 8, desc: 'Meio derretido, mas ainda é chocolate.', food: { verb: 'Comer', hunger: 10, kcal: 160 } },
  { id: 'pao_forma', name: 'Pão de forma', category: 'Comida', weight: 0.4, stack: 1, desc: 'Pão de forma. Mofa em poucos dias.', food: { verb: 'Comer', hunger: 16, kcal: 260, perishable: { freshHours: 48, staleHours: 120 } } },
  { id: 'maca', name: 'Maçã', category: 'Comida', weight: 0.18, stack: 1, desc: 'Fruta fresca. Mata um pouco da sede também.', food: { verb: 'Comer', hunger: 8, thirst: 5, kcal: 80, perishable: { freshHours: 96, staleHours: 192 } } },
  { id: 'banana', name: 'Banana', category: 'Comida', weight: 0.15, stack: 1, desc: 'Amadurece rápido neste calor.', food: { verb: 'Comer', hunger: 9, thirst: 2, kcal: 100, perishable: { freshHours: 48, staleHours: 96 } } },
  { id: 'carne_crua', name: 'Carne bovina crua', category: 'Comida', weight: 0.5, stack: 1, desc: 'Sem geladeira, estraga rápido. Precisa ser assada no fogo.', food: { verb: 'Comer', hunger: 0, edible: false, kcal: 500, perishable: { freshHours: 18, staleHours: 36 } } },
  { id: 'carne_assada', name: 'Carne assada', category: 'Comida', weight: 0.4, stack: 1, desc: 'Carne assada no fogo. Refeição completa.', food: { verb: 'Comer', hunger: 45, thirst: -4, kcal: 520, perishable: { freshHours: 36, staleHours: 72 } } },
  { id: 'arroz_cozido', name: 'Arroz cozido', category: 'Comida', weight: 0.6, stack: 1, desc: 'Uma panela de arroz cozido.', food: { verb: 'Comer', hunger: 40, kcal: 450, perishable: { freshHours: 24, staleHours: 60 } } },
  { id: 'arroz', name: 'Pacote de arroz', category: 'Comida', weight: 1.0, stack: 4, desc: 'Arroz cru. Precisa ser cozido — ainda não há como cozinhar.', food: { verb: 'Comer', hunger: 0, edible: false, kcal: 3600 } },
  { id: 'macarrao_inst', name: 'Macarrão instantâneo', category: 'Comida', weight: 0.1, stack: 8, desc: 'Dá para comer seco, mas dá sede.', food: { verb: 'Comer', hunger: 12, thirst: -10, kcal: 290 } },
  // ---------- Bebida ----------
  { id: 'agua', name: 'Garrafa de água', category: 'Bebida', weight: 0.05, desc: 'Garrafa plástica de 1 litro. Cada gole consome 250 ml. Pode ser reabastecida.', food: { verb: 'Beber', thirst: 28 }, water: { capacity: 4, emptyWeight: 0.05 } },
  { id: 'galao_agua', name: 'Galão de água (5 L)', category: 'Bebida', weight: 0.4, desc: 'Galão plástico de 5 litros. Pesado quando cheio.', food: { verb: 'Beber', thirst: 28 }, water: { capacity: 20, emptyWeight: 0.4 } },
  { id: 'refrigerante', name: 'Lata de refrigerante', category: 'Bebida', weight: 0.35, stack: 6, desc: 'Quente e sem gás.', food: { verb: 'Beber', thirst: 20, hunger: 3, kcal: 140 } },
  { id: 'suco', name: 'Caixa de suco', category: 'Bebida', weight: 0.25, stack: 6, desc: 'Suco de caixinha sabor uva.', food: { verb: 'Beber', thirst: 18, hunger: 4, kcal: 120 } },
  // ---------- Médico ----------
  { id: 'kit_medico', name: 'Kit de primeiros socorros', category: 'Médico', weight: 1.0, desc: 'Gaze, antisséptico e ataduras. Trata e desinfeta um ferimento por vez, leve ou grave (3 usos).', medical: { kind: 'kit', uses: 3, quality: 1, time: 3 } },
  { id: 'curativo', name: 'Curativo adesivo', category: 'Médico', weight: 0.01, stack: 10, desc: 'Serve apenas para ferimentos leves (arranhões).', medical: { kind: 'curativo', uses: 1, quality: 0.95, time: 1.2 } },
  { id: 'bandagem_improvisada', name: 'Bandagem improvisada', category: 'Médico', weight: 0.06, stack: 6, desc: 'Tiras de pano enroladas. Contém bem o sangramento, mas não é estéril.', medical: { kind: 'improvised', uses: 1, quality: 0.8, time: 2.4 } },
  { id: 'antisseptico', name: 'Antisséptico', category: 'Médico', weight: 0.25, desc: 'Frasco de álcool iodado. Limpa um ferimento sujo e evita que infeccione (5 usos).', medical: { kind: 'antisseptico', uses: 5, quality: 0, time: 1.5 } },
  { id: 'bandagem', name: 'Bandagem', category: 'Médico', weight: 0.05, stack: 10, desc: 'Atadura estéril. Estanca um sangramento.', medical: { kind: 'bandage', uses: 1, quality: 0.9, time: 2.2 } },
  { id: 'tiras_pano', name: 'Tiras de pano', category: 'Médico', weight: 0.04, stack: 12, desc: 'Pano rasgado. Reduz o sangramento, mas não é estéril.', medical: { kind: 'rag', uses: 1, quality: 0.6, time: 2.5 } },
  { id: 'analgesico', name: 'Analgésicos', category: 'Médico', weight: 0.05, desc: 'Cartela de comprimidos. Reduz a dor dos ferimentos por algum tempo.', medical: { kind: 'painkiller', uses: 6, quality: 0, time: 1 } },
  // ---------- Armas ----------
  { id: 'taco_beisebol', name: 'Taco de beisebol', category: 'Arma', weight: 1.0, durability: 35, desc: 'Madeira maciça. Golpe amplo e forte.', weapon: { kind: 'melee', damage: 20, range: 17, arc: deg(110), cooldown: 0.72, stamina: 10, knockback: 95, noise: 6, maxTargets: 2, knockdown: 0.3, length: 11 } },
  { id: 'pe_de_cabra', name: 'Pé de cabra', category: 'Arma', weight: 1.4, durability: 70, tool: true, desc: 'Aço resistente. Também serve como ferramenta.', weapon: { kind: 'melee', damage: 18, range: 15, arc: deg(90), cooldown: 0.66, stamina: 9, knockback: 70, noise: 6, maxTargets: 1, knockdown: 0.22, length: 9 } },
  { id: 'cassetete', name: 'Cassetete', category: 'Arma', weight: 0.6, durability: 55, desc: 'Cassetete policial. Leve e rápido.', weapon: { kind: 'melee', damage: 13, range: 14, arc: deg(90), cooldown: 0.5, stamina: 6, knockback: 60, noise: 5, maxTargets: 1, knockdown: 0.15, length: 8 } },
  { id: 'faca_cozinha', name: 'Faca de cozinha', category: 'Arma', weight: 0.25, durability: 25, desc: 'Curto alcance. Exige chegar perto demais.', weapon: { kind: 'melee', damage: 12, range: 10, arc: deg(60), cooldown: 0.4, stamina: 5, knockback: 15, noise: 3, maxTargets: 1, knockdown: 0, length: 5 } },
  { id: 'cano_ferro', name: 'Cano de ferro', category: 'Arma', weight: 1.2, durability: 45, desc: 'Pedaço de encanamento. Pesado.', weapon: { kind: 'melee', damage: 17, range: 16, arc: deg(95), cooldown: 0.7, stamina: 9, knockback: 80, noise: 6, maxTargets: 1, knockdown: 0.25, length: 10 } },
  { id: 'martelo', name: 'Martelo', category: 'Arma', weight: 0.7, durability: 40, tool: true, desc: 'Martelo de unha. Ferramenta e arma improvisada.', weapon: { kind: 'melee', damage: 14, range: 12, arc: deg(75), cooldown: 0.55, stamina: 7, knockback: 50, noise: 5, maxTargets: 1, knockdown: 0.12, length: 6 } },
  { id: 'pistola', name: 'Pistola 9mm', category: 'Arma', weight: 1.0, durability: 400, desc: 'Pistola semiautomática. O disparo é ouvido a quarteirões de distância.', weapon: { kind: 'gun', damage: 46, range: 300, arc: 0, cooldown: 0.26, stamina: 0, knockback: 45, noise: 30, maxTargets: 1, knockdown: 0.2, ammo: 'municao_9mm', magazine: 10, spread: deg(7), reloadTime: 1.7 } },
  { id: 'rifle', name: 'Rifle de caça .308', category: 'Arma', weight: 3.5, durability: 300, desc: 'Rifle de ferrolho. Muito preciso e letal — e ensurdecedor.', weapon: { kind: 'gun', damage: 110, range: 440, arc: 0, cooldown: 1.15, stamina: 0, knockback: 80, noise: 40, maxTargets: 1, knockdown: 0.6, ammo: 'municao_308', magazine: 5, spread: deg(2.2), reloadTime: 2.8 } },
  // ---------- Munição ----------
  { id: 'municao_9mm', name: 'Munição 9mm', category: 'Munição', weight: 0.012, stack: 60, desc: 'Cartuchos 9mm avulsos.' },
  { id: 'municao_308', name: 'Munição .308', category: 'Munição', weight: 0.025, stack: 40, desc: 'Cartuchos de rifle .308.' },
  // ---------- Roupas ----------
  { id: 'camiseta', name: 'Camiseta', category: 'Roupa', weight: 0.2, desc: 'Camiseta de algodão. Pode ser rasgada em tiras.', tearable: 2, wear: { armor: 0, biteProtect: 0 } },
  { id: 'calca_jeans', name: 'Calça jeans', category: 'Roupa', weight: 0.7, desc: 'Jeans grosso. Pode ser rasgada em tiras.', tearable: 3 },
  { id: 'moletom', name: 'Moletom', category: 'Roupa', weight: 0.6, desc: 'Oferece pouca proteção contra arranhões.', wear: { armor: 0.08, biteProtect: 0.1 } },
  { id: 'jaqueta_couro', name: 'Jaqueta de couro', category: 'Roupa', weight: 1.4, desc: 'Couro grosso. Protege bem os braços contra arranhões e mordidas.', wear: { armor: 0.2, biteProtect: 0.35 } },
  { id: 'colete', name: 'Colete balístico', category: 'Roupa', weight: 2.5, desc: 'Colete policial. Protege o tronco, mas não os braços.', wear: { armor: 0.28, biteProtect: 0.12 } },
  // ---------- Mochilas ----------
  { id: 'mochila_escolar', name: 'Mochila escolar', category: 'Mochila', weight: 0.5, desc: 'Aumenta a capacidade de carga quando equipada.', backpack: { weight: 7, slots: 6 } },
  { id: 'mochila_trilha', name: 'Mochila de trilha', category: 'Mochila', weight: 1.0, desc: 'Mochila grande com armação. Muita capacidade.', backpack: { weight: 14, slots: 10 } },
  { id: 'bolsa_lona', name: 'Bolsa de lona', category: 'Mochila', weight: 0.4, desc: 'Bolsa simples de ombro.', backpack: { weight: 5, slots: 4 } },
  // ---------- Ferramentas ----------
  { id: 'lanterna', name: 'Lanterna', category: 'Ferramenta', weight: 0.3, desc: 'Ilumina ambientes escuros. Gasta pilhas.', light: { radius: 150 } },
  { id: 'chave_fenda', name: 'Chave de fenda', category: 'Ferramenta', weight: 0.15, desc: 'Ferramenta comum.' },
  { id: 'alicate', name: 'Alicate', category: 'Ferramenta', weight: 0.3, desc: 'Útil para arame e reparos.' },
  { id: 'serrote', name: 'Serrote', category: 'Ferramenta', weight: 0.6, tool: true, desc: 'Corta madeira. Será útil para construir barricadas.' },
  { id: 'isqueiro', name: 'Isqueiro', category: 'Ferramenta', weight: 0.03, desc: 'Ainda tem gás.' },
  { id: 'fita_adesiva', name: 'Fita adesiva', category: 'Material', weight: 0.1, stack: 4, desc: 'Fita silver tape. Usada para reparos básicos.' },
  { id: 'mangueira', name: 'Mangueira de sifão', category: 'Ferramenta', weight: 0.3, tool: true, desc: 'Mangueira de borracha. Permite retirar combustível do tanque de veículos abandonados.' },
  // ---------- Materiais ----------
  { id: 'pregos', name: 'Pregos', category: 'Material', weight: 0.005, stack: 100, desc: 'Pregos de aço.' },
  { id: 'tabua', name: 'Tábua de madeira', category: 'Material', weight: 1.0, stack: 6, desc: 'Tábua resistente. Material para barricadas.' },
  { id: 'corda', name: 'Corda', category: 'Material', weight: 0.6, stack: 3, desc: 'Corda de náilon, 10 metros.' },
  { id: 'lona', name: 'Lona', category: 'Material', weight: 1.2, desc: 'Lona plástica dobrada.' },
  { id: 'barricada', name: 'Painel de barricada', category: 'Material', weight: 2.4, desc: 'Tábuas pregadas, prontas para reforçar uma porta ou janela. Use pelo inventário perto da entrada.' },
  // ---------- Combustível ----------
  { id: 'galao_gasolina', name: 'Galão de gasolina (10 L)', category: 'Combustível', weight: 0.9, desc: 'Galão vermelho de 10 litros para transportar combustível.', fuelCan: { capacity: 10, emptyWeight: 0.9 } },
  // ---------- Equipamentos ----------
  { id: 'radio', name: 'Rádio portátil', category: 'Equipamento', weight: 0.6, desc: 'Rádio comunicador de uso policial. Funciona com pilhas.', radio: true },
  { id: 'pilhas', name: 'Pilhas AA', category: 'Equipamento', weight: 0.05, stack: 8, desc: 'Par de pilhas alcalinas.', batteries: true },
  { id: 'algemas', name: 'Algemas', category: 'Equipamento', weight: 0.3, desc: 'Sem chave.' },
  // ---------- Diversos ----------
  { id: 'sabonete', name: 'Sabonete', category: 'Diversos', weight: 0.1, stack: 6, desc: 'Cheiro de lavanda. Um luxo hoje em dia.' },
  { id: 'papel_higienico', name: 'Papel higiênico', category: 'Diversos', weight: 0.1, stack: 6, desc: 'Rolo de papel higiênico.' },
  { id: 'panela', name: 'Panela', category: 'Ferramenta', weight: 1.0, tool: true, desc: 'Panela de alumínio amassada. Serve para cozinhar e ferver água no fogo.' },
  { id: 'livro', name: 'Livro', category: 'Diversos', weight: 0.4, desc: 'Um romance policial com a capa rasgada.' },
  { id: 'antibiotico', name: 'Antibiótico', category: 'Médico', weight: 0.05, desc: 'Caixa de amoxicilina. Trata infecção bacteriana de ferimentos — não tem efeito contra o vírus.', medical: { kind: 'antisseptico', uses: 3, quality: 0, time: 1 } },
  { id: 'cigarros', name: 'Maço de cigarros', category: 'Diversos', weight: 0.03, stack: 10, desc: 'Moeda de troca valiosa entre sobreviventes.' },
  { id: 'whisky', name: 'Garrafa de uísque', category: 'Diversos', weight: 0.9, desc: 'Meia garrafa. Vale mais em troca do que bebida.' },
  { id: 'fotografia', name: 'Fotografia', category: 'Diversos', weight: 0.01, desc: 'Uma família sorrindo em frente a esta casa. No verso: "Natal, 2019".' },
  { id: 'velas', name: 'Velas', category: 'Diversos', weight: 0.1, stack: 6, desc: 'Velas brancas.' },
  { id: 'caderno', name: 'Caderno', category: 'Diversos', weight: 0.2, desc: 'A última anotação diz: "Fomos para o abrigo da escola. Não esperem."' },
  // ---------- Mapas ----------
  { id: 'mapa_rasgado', name: 'Mapa do bairro (rasgado)', category: 'Mapa', weight: 0.05, desc: 'Mapa de papel da região. Falta um pedaço do lado leste.', map: 'rasgado' },
  { id: 'fragmento_mapa', name: 'Fragmento de mapa', category: 'Mapa', weight: 0.02, desc: 'Um pedaço rasgado de mapa. Parece encaixar em outro maior.', map: 'fragmento' },
  { id: 'mapa_regional', name: 'Mapa regional', category: 'Mapa', weight: 0.08, desc: 'Mapa rodoviário de uma região. O estado do papel varia. Não mostra onde você está.', map: 'regional' },
  { id: 'fragmento_regional', name: 'Pedaço de mapa regional', category: 'Mapa', weight: 0.02, desc: 'Um quarto de um mapa regional. Combine com outros pedaços da mesma região.', map: 'fragmento_regional' },
  // ---------- Prisão ----------
  { id: 'grampo', name: 'Grampo de metal', category: 'Ferramenta', weight: 0.01, tool: true, desc: 'Um grampo dobrado. Com paciência, abre fechaduras simples.' },
  { id: 'chave_celas', name: 'Molho de chaves das celas', category: 'Ferramenta', weight: 0.15, tool: true, desc: 'Chaves do bloco de celas de uma facção.' },
  // ---------- Campanha ----------
  { id: 'prontuario_zero', name: 'Prontuário do paciente zero', category: 'Documento', weight: 0.1, desc: 'Prontuário do Hospital de Santa Aurora.', text: 'Paciente admitido com febre e agressividade 6 h após exposição em "visita técnica ao Instituto Vitalis". Amostras enviadas ao laboratório do Instituto. Observação manuscrita: "eles sabiam".' },
  { id: 'relatorio_vitalis', name: 'Relatório do Instituto Vitalis', category: 'Documento', weight: 0.2, desc: 'Relatório interno do laboratório.', text: 'Projeto AURORA-7: vetor viral para regeneração tecidual. Falha de contenção no lote 12. A replicação depende de uma proteína sensível ao composto estabilizante R-4, estoque transferido à Base Sentinela. Síntese de contramedida requer: amostra viva, centrífuga, R-4 e energia estável.' },
  { id: 'ordem_militar', name: 'Ordem de serviço militar', category: 'Documento', weight: 0.05, desc: 'Papel timbrado da Base Sentinela.', text: 'Transferência de 4 ampolas de R-4 para o paiol da base. Acesso restrito ao comando. Prioridade: contenção.' },
  { id: 'amostra_viral', name: 'Amostra viral (refrigerada)', category: 'Missão', weight: 0.4, desc: 'Caixa térmica com amostras do paciente zero. Manuseie com cuidado.' },
  { id: 'centrifuga', name: 'Centrífuga portátil', category: 'Missão', weight: 4.5, desc: 'Equipamento de laboratório pesado, porém transportável.' },
  { id: 'reagente_r4', name: 'Estabilizante R-4', category: 'Missão', weight: 0.3, desc: 'Ampolas do composto R-4. Essenciais para a contramedida.' },
  { id: 'vacina', name: 'Contramedida AURORA (protótipo)', category: 'Missão', weight: 0.2, desc: 'Primeiras doses sintetizadas. As regras de uso ainda dependem de validação (ver configuração).' },
  { id: 'mapa_completo', name: 'Mapa do bairro (remendado)', category: 'Mapa', weight: 0.06, desc: 'Mapa da região remendado com fita. Não mostra onde você está.', map: 'completo' },
];

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(list.map((d) => [d.id, d]));

export function itemDef(id: string): ItemDef {
  const d = ITEMS[id];
  if (!d) throw new Error(`Item desconhecido: ${id}`);
  return d;
}

/** Instância concreta de um item no mundo (inventário, recipiente ou corpo). */
export interface ItemInstance {
  uid: string;
  defId: string;
  qty: number;
  condition?: number;
  /** Estado específico: munição carregada, usos restantes, bateria, frequência... */
  state?: {
    ammo?: number;
    uses?: number;
    battery?: number;
    on?: boolean;
    freq?: number;
    /** Minuto de jogo em que o alimento perecível foi produzido/colhido. */
    born?: number;
    /** Água não tratada (chuva, reservatório). */
    contaminated?: boolean;
    /** Litros de combustível. */
    fuel?: number;
    /** Mapas regionais: região, condição e quadrantes presentes (bits 1,2,4,8). */
    region?: string;
    cond?: string;
    pieces?: number;
  };
}

/** Contador de identificadores únicos. Persistido no save para impedir duplicação de uid. */
let uidCounter = 1;
export const getUidCounter = () => uidCounter;
export function setUidCounter(n: number) {
  uidCounter = Math.max(uidCounter, n);
}

export function createItem(defId: string, qty = 1, conditionFactor = 1): ItemInstance {
  const d = itemDef(defId);
  const item: ItemInstance = { uid: `it${uidCounter++}`, defId, qty };
  if (d.durability) item.condition = Math.max(1, Math.round(d.durability * conditionFactor));
  if (d.weapon?.kind === 'gun') item.state = { ammo: 0 };
  if (d.food?.uses) item.state = { uses: d.food.uses };
  if (d.water) item.state = { uses: d.water.capacity, contaminated: false };
  if (d.fuelCan) item.state = { fuel: 0 };
  if (d.food?.perishable) item.state = { born: 0 };
  if (d.medical && d.medical.uses > 1) item.state = { uses: d.medical.uses };
  if (d.light) item.state = { on: false, battery: 60 };
  if (d.radio) item.state = { on: false, battery: 0, freq: 1 };
  return item;
}

/** Peso real: recipientes pesam o vasilhame + o conteúdo (água 0,25 kg/dose, gasolina 0,75 kg/L). */
export function itemWeight(it: ItemInstance): number {
  const d = itemDef(it.defId);
  if (d.water) return (d.water.emptyWeight + 0.25 * (it.state?.uses ?? 0)) * it.qty;
  if (d.fuelCan) return (d.fuelCan.emptyWeight + 0.75 * (it.state?.fuel ?? 0)) * it.qty;
  if (d.food?.uses) return (0.05 + 0.25 * (it.state?.uses ?? d.food.uses)) * it.qty;
  return d.weight * it.qty;
}

export type Freshness = 'fresco' | 'passado' | 'estragado';

/** Estado de conservação de um perecível no minuto de jogo `now`. */
export function freshness(it: ItemInstance, now: number): Freshness | null {
  const p = itemDef(it.defId).food?.perishable;
  if (!p) return null;
  const ageH = (now - (it.state?.born ?? 0)) / 60;
  return ageH < p.freshHours ? 'fresco' : ageH < p.staleHours ? 'passado' : 'estragado';
}

export function itemLabel(it: ItemInstance): string {
  const d = itemDef(it.defId);
  let s = d.name;
  if (d.water && (it.state?.uses ?? 0) === 0) s += ' (vazia)';
  if (it.qty > 1) s += ` ×${it.qty}`;
  return s;
}
