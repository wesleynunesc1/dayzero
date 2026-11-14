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
  food?: { verb: 'Comer' | 'Beber'; hunger?: number; thirst?: number; uses?: number; edible?: boolean };
  medical?: { kind: 'kit' | 'bandage' | 'rag' | 'painkiller'; uses: number; quality: number; time: number };
  backpack?: { weight: number; slots: number };
  wear?: { armor: number; biteProtect: number };
  light?: { radius: number };
  radio?: boolean;
  batteries?: boolean;
  map?: 'rasgado' | 'fragmento' | 'completo';
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
  { id: 'feijao_lata', name: 'Lata de feijão', category: 'Comida', weight: 0.45, stack: 6, desc: 'Feijão cozido em lata. Ainda dentro da validade, por pouco.', food: { verb: 'Comer', hunger: 35, thirst: -5 } },
  { id: 'sardinha', name: 'Sardinha em lata', category: 'Comida', weight: 0.15, stack: 8, desc: 'Lata com abertura fácil. Salgada.', food: { verb: 'Comer', hunger: 22, thirst: -6 } },
  { id: 'biscoito', name: 'Pacote de biscoitos', category: 'Comida', weight: 0.2, stack: 6, desc: 'Biscoito de água e sal. Um pouco murcho.', food: { verb: 'Comer', hunger: 14, thirst: -3 } },
  { id: 'barra_cereal', name: 'Barra de cereal', category: 'Comida', weight: 0.05, stack: 10, desc: 'Leve e prática.', food: { verb: 'Comer', hunger: 9 } },
  { id: 'chocolate', name: 'Chocolate', category: 'Comida', weight: 0.1, stack: 8, desc: 'Meio derretido, mas ainda é chocolate.', food: { verb: 'Comer', hunger: 10 } },
  { id: 'pao_forma', name: 'Pão de forma (vencido)', category: 'Comida', weight: 0.4, stack: 3, desc: 'Algumas fatias têm manchas verdes. Melhor que nada.', food: { verb: 'Comer', hunger: 16 } },
  { id: 'arroz', name: 'Pacote de arroz', category: 'Comida', weight: 1.0, stack: 4, desc: 'Arroz cru. Precisa ser cozido — ainda não há como cozinhar.', food: { verb: 'Comer', hunger: 0, edible: false } },
  { id: 'macarrao_inst', name: 'Macarrão instantâneo', category: 'Comida', weight: 0.1, stack: 8, desc: 'Dá para comer seco, mas dá sede.', food: { verb: 'Comer', hunger: 12, thirst: -10 } },
  // ---------- Bebida ----------
  { id: 'agua', name: 'Garrafa de água', category: 'Bebida', weight: 0.25, desc: 'Garrafa de 1 litro. Cada uso consome um quarto.', food: { verb: 'Beber', thirst: 28, uses: 4 } },
  { id: 'refrigerante', name: 'Lata de refrigerante', category: 'Bebida', weight: 0.35, stack: 6, desc: 'Quente e sem gás.', food: { verb: 'Beber', thirst: 20, hunger: 3 } },
  { id: 'suco', name: 'Caixa de suco', category: 'Bebida', weight: 0.25, stack: 6, desc: 'Suco de caixinha sabor uva.', food: { verb: 'Beber', thirst: 18, hunger: 4 } },
  // ---------- Médico ----------
  { id: 'kit_medico', name: 'Kit médico', category: 'Médico', weight: 0.8, desc: 'Gaze, antisséptico e ataduras. Trata um ferimento por vez (3 usos).', medical: { kind: 'kit', uses: 3, quality: 1, time: 3 } },
  { id: 'bandagem', name: 'Bandagem', category: 'Médico', weight: 0.05, stack: 10, desc: 'Atadura estéril. Estanca um sangramento.', medical: { kind: 'bandage', uses: 1, quality: 0.9, time: 2.2 } },
  { id: 'tiras_pano', name: 'Tiras de pano', category: 'Médico', weight: 0.04, stack: 12, desc: 'Pano rasgado. Reduz o sangramento, mas não é estéril.', medical: { kind: 'rag', uses: 1, quality: 0.6, time: 2.5 } },
  { id: 'analgesico', name: 'Analgésicos', category: 'Médico', weight: 0.05, desc: 'Cartela de comprimidos. Reduz a dor dos ferimentos por algum tempo.', medical: { kind: 'painkiller', uses: 6, quality: 0, time: 1 } },
  // ---------- Armas ----------
  { id: 'taco_beisebol', name: 'Taco de beisebol', category: 'Arma', weight: 1.0, durability: 35, desc: 'Madeira maciça. Golpe amplo e forte.', weapon: { kind: 'melee', damage: 20, range: 17, arc: deg(110), cooldown: 0.72, stamina: 10, knockback: 95, noise: 6, maxTargets: 2, knockdown: 0.3, length: 11 } },
  { id: 'pe_de_cabra', name: 'Pé de cabra', category: 'Arma', weight: 1.4, durability: 70, desc: 'Aço resistente. Também serve como ferramenta.', weapon: { kind: 'melee', damage: 18, range: 15, arc: deg(90), cooldown: 0.66, stamina: 9, knockback: 70, noise: 6, maxTargets: 1, knockdown: 0.22, length: 9 } },
  { id: 'cassetete', name: 'Cassetete', category: 'Arma', weight: 0.6, durability: 55, desc: 'Cassetete policial. Leve e rápido.', weapon: { kind: 'melee', damage: 13, range: 14, arc: deg(90), cooldown: 0.5, stamina: 6, knockback: 60, noise: 5, maxTargets: 1, knockdown: 0.15, length: 8 } },
  { id: 'faca_cozinha', name: 'Faca de cozinha', category: 'Arma', weight: 0.25, durability: 25, desc: 'Curto alcance. Exige chegar perto demais.', weapon: { kind: 'melee', damage: 12, range: 10, arc: deg(60), cooldown: 0.4, stamina: 5, knockback: 15, noise: 3, maxTargets: 1, knockdown: 0, length: 5 } },
  { id: 'cano_ferro', name: 'Cano de ferro', category: 'Arma', weight: 1.2, durability: 45, desc: 'Pedaço de encanamento. Pesado.', weapon: { kind: 'melee', damage: 17, range: 16, arc: deg(95), cooldown: 0.7, stamina: 9, knockback: 80, noise: 6, maxTargets: 1, knockdown: 0.25, length: 10 } },
  { id: 'martelo', name: 'Martelo', category: 'Arma', weight: 0.7, durability: 40, desc: 'Martelo de unha. Ferramenta e arma improvisada.', weapon: { kind: 'melee', damage: 14, range: 12, arc: deg(75), cooldown: 0.55, stamina: 7, knockback: 50, noise: 5, maxTargets: 1, knockdown: 0.12, length: 6 } },
  { id: 'pistola', name: 'Pistola 9mm', category: 'Arma', weight: 0.9, durability: 400, desc: 'Pistola semiautomática. O disparo é ouvido a quarteirões de distância.', weapon: { kind: 'gun', damage: 46, range: 300, arc: 0, cooldown: 0.26, stamina: 0, knockback: 45, noise: 30, maxTargets: 1, knockdown: 0.2, ammo: 'municao_9mm', magazine: 10, spread: deg(7), reloadTime: 1.7 } },
  // ---------- Munição ----------
  { id: 'municao_9mm', name: 'Munição 9mm', category: 'Munição', weight: 0.012, stack: 60, desc: 'Cartuchos 9mm avulsos.' },
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
  { id: 'serrote', name: 'Serrote', category: 'Ferramenta', weight: 0.6, desc: 'Corta madeira. Será útil para construir barricadas.' },
  { id: 'isqueiro', name: 'Isqueiro', category: 'Ferramenta', weight: 0.03, desc: 'Ainda tem gás.' },
  { id: 'fita_adesiva', name: 'Fita adesiva', category: 'Ferramenta', weight: 0.1, stack: 4, desc: 'Fita silver tape. Conserta quase tudo.' },
  // ---------- Materiais ----------
  { id: 'pregos', name: 'Pregos', category: 'Material', weight: 0.005, stack: 100, desc: 'Pregos de aço.' },
  { id: 'tabua', name: 'Tábua de madeira', category: 'Material', weight: 1.0, stack: 6, desc: 'Tábua resistente. Material para barricadas.' },
  { id: 'corda', name: 'Corda', category: 'Material', weight: 0.6, stack: 3, desc: 'Corda de náilon, 10 metros.' },
  { id: 'lona', name: 'Lona', category: 'Material', weight: 1.2, desc: 'Lona plástica dobrada.' },
  // ---------- Equipamentos ----------
  { id: 'radio', name: 'Rádio portátil', category: 'Equipamento', weight: 0.6, desc: 'Rádio comunicador de uso policial. Funciona com pilhas.', radio: true },
  { id: 'pilhas', name: 'Pilhas AA', category: 'Equipamento', weight: 0.05, stack: 8, desc: 'Par de pilhas alcalinas.', batteries: true },
  { id: 'algemas', name: 'Algemas', category: 'Equipamento', weight: 0.3, desc: 'Sem chave.' },
  // ---------- Diversos ----------
  { id: 'sabonete', name: 'Sabonete', category: 'Diversos', weight: 0.1, stack: 6, desc: 'Cheiro de lavanda. Um luxo hoje em dia.' },
  { id: 'papel_higienico', name: 'Papel higiênico', category: 'Diversos', weight: 0.1, stack: 6, desc: 'Rolo de papel higiênico.' },
  { id: 'panela', name: 'Panela', category: 'Diversos', weight: 1.0, desc: 'Panela de alumínio amassada.' },
  { id: 'livro', name: 'Livro', category: 'Diversos', weight: 0.4, desc: 'Um romance policial com a capa rasgada.' },
  { id: 'fotografia', name: 'Fotografia', category: 'Diversos', weight: 0.01, desc: 'Uma família sorrindo em frente a esta casa. No verso: "Natal, 2019".' },
  { id: 'velas', name: 'Velas', category: 'Diversos', weight: 0.1, stack: 6, desc: 'Velas brancas.' },
  { id: 'caderno', name: 'Caderno', category: 'Diversos', weight: 0.2, desc: 'A última anotação diz: "Fomos para o abrigo da escola. Não esperem."' },
  // ---------- Mapas ----------
  { id: 'mapa_rasgado', name: 'Mapa do bairro (rasgado)', category: 'Mapa', weight: 0.05, desc: 'Mapa de papel da região. Falta um pedaço do lado leste.', map: 'rasgado' },
  { id: 'fragmento_mapa', name: 'Fragmento de mapa', category: 'Mapa', weight: 0.02, desc: 'Um pedaço rasgado de mapa. Parece encaixar em outro maior.', map: 'fragmento' },
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
  };
}

let uidCounter = 1;
export function createItem(defId: string, qty = 1, conditionFactor = 1): ItemInstance {
  const d = itemDef(defId);
  const item: ItemInstance = { uid: `it${uidCounter++}`, defId, qty };
  if (d.durability) item.condition = Math.max(1, Math.round(d.durability * conditionFactor));
  if (d.weapon?.kind === 'gun') item.state = { ammo: 0 };
  if (d.food?.uses) item.state = { uses: d.food.uses };
  if (d.medical && d.medical.uses > 1) item.state = { uses: d.medical.uses };
  if (d.light) item.state = { on: false, battery: 60 };
  if (d.radio) item.state = { on: false, battery: 0, freq: 104.5 };
  return item;
}

export function itemWeight(it: ItemInstance): number {
  const d = itemDef(it.defId);
  if (d.food?.uses) {
    // garrafa: peso do vasilhame + líquido restante
    const uses = it.state?.uses ?? d.food.uses;
    return (0.05 + 0.25 * uses) * it.qty;
  }
  return d.weight * it.qty;
}

export function itemLabel(it: ItemInstance): string {
  const d = itemDef(it.defId);
  let s = d.name;
  if (it.qty > 1) s += ` ×${it.qty}`;
  return s;
}
