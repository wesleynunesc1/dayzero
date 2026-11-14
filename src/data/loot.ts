import { RNG } from '../engine/math';
import { createItem, itemDef, ItemInstance } from './items';

/** Tipos de recipiente: nome exibido, capacidade em kg e tabela de loot. */
export interface ContainerKind {
  name: string;
  capacity: number;
  /** Quantidade de sorteios [mín, máx]. */
  rolls: [number, number];
  table: { id: string; w: number; qty?: [number, number] }[];
}

export const CONTAINER_KINDS: Record<string, ContainerKind> = {
  armario_cozinha: {
    name: 'Armário da cozinha',
    capacity: 15,
    rolls: [0, 3],
    table: [
      { id: 'feijao_lata', w: 4, qty: [1, 2] },
      { id: 'sardinha', w: 3 },
      { id: 'carne_lata', w: 2 },
      { id: 'biscoito', w: 3 },
      { id: 'arroz', w: 3 },
      { id: 'macarrao_inst', w: 3, qty: [1, 3] },
      { id: 'panela', w: 2 },
      { id: 'faca_cozinha', w: 2 },
      { id: 'isqueiro', w: 1 },
      { id: 'velas', w: 1, qty: [1, 3] },
    ],
  },
  geladeira: {
    name: 'Geladeira',
    capacity: 20,
    rolls: [0, 2],
    table: [
      { id: 'refrigerante', w: 4 },
      { id: 'suco', w: 3 },
      { id: 'agua', w: 3 },
      { id: 'pao_forma', w: 2 },
      { id: 'maca', w: 2 },
      { id: 'carne_crua', w: 2 },
    ],
  },
  guarda_roupa: {
    name: 'Guarda-roupa',
    capacity: 25,
    rolls: [1, 3],
    table: [
      { id: 'camiseta', w: 5, qty: [1, 2] },
      { id: 'calca_jeans', w: 3 },
      { id: 'moletom', w: 3 },
      { id: 'jaqueta_couro', w: 1 },
      { id: 'mochila_escolar', w: 2 },
      { id: 'bolsa_lona', w: 1 },
    ],
  },
  comoda: {
    name: 'Cômoda',
    capacity: 12,
    rolls: [0, 2],
    table: [
      { id: 'camiseta', w: 4 },
      { id: 'fotografia', w: 2 },
      { id: 'livro', w: 2 },
      { id: 'pilhas', w: 2 },
      { id: 'analgesico', w: 2 },
      { id: 'bandagem', w: 2 },
      { id: 'curativo', w: 2, qty: [1, 3] },
      { id: 'caderno', w: 1 },
    ],
  },
  estante: {
    name: 'Estante',
    capacity: 15,
    rolls: [0, 2],
    table: [
      { id: 'livro', w: 4 },
      { id: 'velas', w: 2 },
      { id: 'pilhas', w: 2 },
      { id: 'fotografia', w: 2 },
      { id: 'lanterna', w: 1 },
    ],
  },
  armario_banheiro: {
    name: 'Armário do banheiro',
    capacity: 6,
    rolls: [0, 2],
    table: [
      { id: 'bandagem', w: 3, qty: [1, 2] },
      { id: 'curativo', w: 3, qty: [2, 4] },
      { id: 'antisseptico', w: 2 },
      { id: 'analgesico', w: 3 },
      { id: 'sabonete', w: 3 },
      { id: 'papel_higienico', w: 3 },
    ],
  },
  prateleira_mercado: {
    name: 'Prateleira',
    capacity: 40,
    rolls: [2, 4],
    table: [
      { id: 'feijao_lata', w: 5, qty: [1, 3] },
      { id: 'sardinha', w: 4, qty: [1, 3] },
      { id: 'carne_lata', w: 3, qty: [1, 2] },
      { id: 'biscoito', w: 4, qty: [1, 2] },
      { id: 'barra_cereal', w: 3, qty: [1, 4] },
      { id: 'chocolate', w: 2, qty: [1, 2] },
      { id: 'arroz', w: 3 },
      { id: 'macarrao_inst', w: 3, qty: [1, 3] },
      { id: 'sabonete', w: 2, qty: [1, 2] },
      { id: 'papel_higienico', w: 2, qty: [1, 2] },
      { id: 'pilhas', w: 1 },
      { id: 'velas', w: 1 },
    ],
  },
  refrigerador: {
    name: 'Refrigerador de bebidas',
    capacity: 40,
    rolls: [2, 4],
    table: [
      { id: 'agua', w: 6 },
      { id: 'galao_agua', w: 1 },
      { id: 'refrigerante', w: 4, qty: [1, 3] },
      { id: 'suco', w: 3, qty: [1, 2] },
    ],
  },
  caixa_registradora: {
    name: 'Gaveta do caixa',
    capacity: 3,
    rolls: [0, 2],
    table: [
      { id: 'pilhas', w: 2 },
      { id: 'isqueiro', w: 2 },
      { id: 'chocolate', w: 2 },
      { id: 'fita_adesiva', w: 1 },
    ],
  },
  estoque: {
    name: 'Prateleira do estoque',
    capacity: 50,
    rolls: [1, 3],
    table: [
      { id: 'feijao_lata', w: 3, qty: [2, 4] },
      { id: 'agua', w: 3, qty: [1, 2] },
      { id: 'arroz', w: 2, qty: [1, 2] },
      { id: 'papel_higienico', w: 2, qty: [2, 4] },
      { id: 'pilhas', w: 1, qty: [1, 2] },
    ],
  },
  caixote: {
    name: 'Caixote',
    capacity: 20,
    rolls: [0, 2],
    table: [
      { id: 'tabua', w: 3, qty: [1, 2] },
      { id: 'pregos', w: 3, qty: [10, 30] },
      { id: 'corda', w: 2 },
      { id: 'lona', w: 1 },
      { id: 'agua', w: 1 },
    ],
  },
  bancada: {
    name: 'Bancada',
    capacity: 20,
    rolls: [1, 3],
    table: [
      { id: 'martelo', w: 3 },
      { id: 'chave_fenda', w: 3 },
      { id: 'alicate', w: 2 },
      { id: 'fita_adesiva', w: 2 },
      { id: 'pregos', w: 3, qty: [10, 40] },
      { id: 'serrote', w: 2 },
    ],
  },
  caixa_ferramentas: {
    name: 'Caixa de ferramentas',
    capacity: 10,
    rolls: [1, 3],
    table: [
      { id: 'chave_fenda', w: 3 },
      { id: 'alicate', w: 3 },
      { id: 'martelo', w: 2 },
      { id: 'fita_adesiva', w: 2 },
    ],
  },
  estante_ferramentas: {
    name: 'Estante de materiais',
    capacity: 50,
    rolls: [1, 3],
    table: [
      { id: 'tabua', w: 4, qty: [1, 3] },
      { id: 'corda', w: 2 },
      { id: 'lona', w: 2 },
      { id: 'pregos', w: 3, qty: [20, 50] },
      { id: 'cano_ferro', w: 1 },
    ],
  },
  armario_arquivo: {
    name: 'Arquivo',
    capacity: 10,
    rolls: [0, 2],
    table: [
      { id: 'caderno', w: 3 },
      { id: 'pilhas', w: 2 },
      { id: 'fita_adesiva', w: 1 },
      { id: 'barra_cereal', w: 1 },
    ],
  },
  mesa: {
    name: 'Gaveta da mesa',
    capacity: 6,
    rolls: [0, 2],
    table: [
      { id: 'caderno', w: 3 },
      { id: 'pilhas', w: 2 },
      { id: 'barra_cereal', w: 2 },
      { id: 'isqueiro', w: 1 },
    ],
  },
  armario_pessoal: {
    name: 'Armário pessoal',
    capacity: 12,
    rolls: [0, 2],
    table: [
      { id: 'municao_9mm', w: 2, qty: [3, 8] },
      { id: 'cassetete', w: 2 },
      { id: 'moletom', w: 2 },
      { id: 'barra_cereal', w: 2 },
      { id: 'lanterna', w: 2 },
      { id: 'algemas', w: 2 },
      { id: 'agua', w: 1 },
    ],
  },
  armario_evidencias: {
    name: 'Armário de evidências',
    capacity: 15,
    rolls: [1, 2],
    table: [
      { id: 'faca_cozinha', w: 2 },
      { id: 'taco_beisebol', w: 1 },
      { id: 'municao_9mm', w: 2, qty: [2, 6] },
      { id: 'isqueiro', w: 1 },
    ],
  },
  armario_armas: {
    name: 'Armário de armas',
    capacity: 20,
    rolls: [0, 1],
    table: [
      { id: 'municao_9mm', w: 3, qty: [4, 10] },
      { id: 'cassetete', w: 1 },
    ],
  },
  primeiros_socorros: {
    name: 'Caixa de primeiros socorros',
    capacity: 4,
    rolls: [1, 2],
    table: [
      { id: 'bandagem', w: 4, qty: [1, 3] },
      { id: 'curativo', w: 3, qty: [2, 5] },
      { id: 'antisseptico', w: 2 },
      { id: 'analgesico', w: 2 },
    ],
  },
  porta_malas: {
    name: 'Porta-malas',
    capacity: 30,
    rolls: [0, 2],
    table: [
      { id: 'agua', w: 2 },
      { id: 'lona', w: 1 },
      { id: 'corda', w: 1 },
      { id: 'fita_adesiva', w: 1 },
      { id: 'bolsa_lona', w: 1 },
      { id: 'pe_de_cabra', w: 1 },
      { id: 'refrigerante', w: 1 },
    ],
  },
  lixeira: {
    name: 'Caçamba de lixo',
    capacity: 40,
    rolls: [0, 1],
    table: [
      { id: 'tabua', w: 2 },
      { id: 'panela', w: 1 },
      { id: 'cano_ferro', w: 1 },
    ],
  },
  hortifruti: {
    name: 'Banca de hortifrúti',
    capacity: 30,
    rolls: [2, 4],
    table: [
      { id: 'maca', w: 4 },
      { id: 'banana', w: 4 },
    ],
  },
  acougue: {
    name: 'Freezer do açougue (desligado)',
    capacity: 40,
    rolls: [1, 3],
    table: [{ id: 'carne_crua', w: 1 }],
  },
  bau: { name: 'Baú do abrigo', capacity: 80, rolls: [0, 0], table: [] },
  corpo: { name: 'Corpo', capacity: 999, rolls: [0, 0], table: [] },
};

/**
 * Idade (horas de jogo antes do início) dos perecíveis em cada tipo de recipiente.
 * Sem energia elétrica, geladeiras e freezers não conservam nada.
 */
export const PERISHABLE_AGE_HOURS: Record<string, [number, number]> = {
  geladeira: [40, 90],
  acougue: [30, 60],
  hortifruti: [6, 40],
};

export function rollLoot(kind: string, rng: RNG): ItemInstance[] {
  const k = CONTAINER_KINDS[kind];
  if (!k) return [];
  const out: ItemInstance[] = [];
  const n = rng.int(k.rolls[0], k.rolls[1]);
  const total = k.table.reduce((s, e) => s + e.w, 0);
  for (let i = 0; i < n; i++) {
    let r = rng.next() * total;
    for (const e of k.table) {
      r -= e.w;
      if (r <= 0) {
        const qty = e.qty ? rng.int(e.qty[0], e.qty[1]) : 1;
        const d = itemDef(e.id);
        const existing = out.find((o) => o.defId === e.id && (d.stack ?? 1) > 1);
        if (existing) existing.qty = Math.min(d.stack ?? 1, existing.qty + qty);
        else {
          const it = createItem(e.id, Math.min(qty, d.stack ?? 1), rng.range(0.45, 1));
          if (d.food?.perishable) {
            const age = PERISHABLE_AGE_HOURS[kind] ?? [0, 12];
            it.state = { ...it.state, born: -rng.range(age[0], age[1]) * 60 };
          }
          if (d.water) it.state = { uses: rng.int(1, d.water.capacity), contaminated: false };
          out.push(it);
        }
        break;
      }
    }
  }
  return out;
}
