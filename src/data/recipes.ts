/**
 * Receitas de fabricação. Cada receita define materiais consumidos, ferramentas (não consumidas),
 * resultado, tempo, ruído e condição de fabricação. Valores ajustáveis aqui.
 */
export type CraftCondition = 'fogo';

export interface Recipe {
  id: string;
  name: string;
  desc: string;
  /** Materiais consumidos. 'agua_dose' = doses de água em qualquer recipiente. */
  inputs: { id: string; qty: number }[];
  /** Ferramentas necessárias (não consumidas). */
  tools?: string[];
  result?: { id: string; qty: number };
  /** Receitas especiais que alteram um item existente. */
  special?: 'reparo' | 'ferver';
  time: number;
  noise?: number;
  condition?: CraftCondition;
}

export const RECIPES: Recipe[] = [
  {
    id: 'bandagem_improvisada',
    name: 'Bandagem improvisada',
    desc: 'Enrola tiras de pano numa bandagem. Contém sangramentos, mas não é estéril.',
    inputs: [{ id: 'tiras_pano', qty: 3 }],
    result: { id: 'bandagem_improvisada', qty: 1 },
    time: 3,
  },
  {
    id: 'barricada',
    name: 'Painel de barricada',
    desc: 'Prega tábuas num painel para reforçar uma porta ou janela. Faz barulho.',
    inputs: [
      { id: 'tabua', qty: 2 },
      { id: 'pregos', qty: 6 },
    ],
    tools: ['martelo'],
    result: { id: 'barricada', qty: 1 },
    time: 5,
    noise: 7,
  },
  {
    id: 'reparo_fita',
    name: 'Reparo básico com fita',
    desc: 'Recupera parte da condição de uma arma corpo a corpo danificada (+40% da durabilidade).',
    inputs: [{ id: 'fita_adesiva', qty: 1 }],
    special: 'reparo',
    time: 3,
  },
  {
    id: 'arroz_cozido',
    name: 'Cozinhar arroz',
    desc: 'Cozinha um pacote de arroz com 500 ml de água. Precisa de fogo e de uma panela.',
    inputs: [
      { id: 'arroz', qty: 1 },
      { id: 'agua_dose', qty: 2 },
    ],
    tools: ['panela'],
    result: { id: 'arroz_cozido', qty: 1 },
    time: 6,
    condition: 'fogo',
  },
  {
    id: 'carne_assada',
    name: 'Assar carne',
    desc: 'Assa a carne no fogo. Carne estragada continua estragada depois de assada.',
    inputs: [{ id: 'carne_crua', qty: 1 }],
    tools: ['panela'],
    result: { id: 'carne_assada', qty: 1 },
    time: 6,
    condition: 'fogo',
  },
  {
    id: 'ferver_agua',
    name: 'Ferver água',
    desc: 'Ferve a água não tratada de um recipiente, tornando-a segura para beber.',
    inputs: [],
    tools: ['panela'],
    special: 'ferver',
    time: 5,
    condition: 'fogo',
  },
];
