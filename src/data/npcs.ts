import type { Appearance } from '../entities/Actor';

/** Traços de personalidade (0..1). Fixos: definem como o NPC reage, não mudam ao acaso. */
export interface Personality {
  coragem: number;
  empatia: number;
  ganancia: number;
  sociavel: number;
  lealdade: number;
  agressividade: number;
}

export type NpcRole = 'sobrevivente' | 'lider' | 'guarda' | 'membro' | 'prisioneiro' | 'cientista';

export interface NpcDef {
  key: string;
  name: string;
  age: number;
  /** História pessoal (aparece em conversa). */
  story: string;
  personality: Personality;
  /** Objetivos pessoais, em ordem de prioridade. */
  goals: NpcGoal[];
  look: Appearance;
  items: [string, number][];
  weapon?: string;
  /** Algo de que precisa e pedirá a quem parecer confiável. */
  needs?: { item: string[]; label: string; reason: string };
  /** Troca: o que aceita e o que oferece. */
  trade?: { wants: string[]; offers: [string, number][] };
  /** Fala de apresentação. */
  intro: string;
  /** O que sabe contar sobre o mundo (sem revelar posição de jogadores). */
  rumors: string[];
}

export type NpcGoal =
  | { kind: 'ficar'; label: string }
  | { kind: 'ir_para'; label: string; x: number; y: number; needsTrust?: number }
  | { kind: 'proteger_territorio'; label: string }
  | { kind: 'acumular'; label: string }
  | { kind: 'fugir_da_prisao'; label: string }
  | { kind: 'pesquisar'; label: string };

const L = (skin: string, hair: string, hairStyle: number, shirt: string, pants: string, overlay?: Appearance['overlay']): Appearance => ({ skin, hair, hairStyle, shirt, pants, shoes: '#2a2624', overlay, gore: 0 });
const P = (coragem: number, empatia: number, ganancia: number, sociavel: number, lealdade: number, agressividade: number): Personality => ({ coragem, empatia, ganancia, sociavel, lealdade, agressividade });
const FARDA: Appearance['overlay'] = { color: '#46503c', kind: 'uniform' };
const JALECO: Appearance['overlay'] = { color: '#c9ccc8', kind: 'apron' };

export const NPC_DEFS: Record<string, NpcDef> = {
  // ------------------------------------------------------------ Base Sentinela (militares)
  sgt_ramos: {
    key: 'sgt_ramos', name: 'Sargento Ramos', age: 46,
    story: 'Ficou no comando da Base Sentinela quando os oficiais partiram de helicóptero e não voltaram.',
    personality: P(0.85, 0.35, 0.3, 0.4, 0.9, 0.55),
    goals: [{ kind: 'proteger_territorio', label: 'Manter a base de pé' }],
    look: L('#9c7a62', '#2b2520', 2, '#4c5640', '#3b4232', FARDA), weapon: 'rifle',
    items: [['municao_308', 10], ['carne_lata', 2], ['agua', 1]],
    trade: { wants: ['antibiotico', 'kit_medico', 'galao_gasolina', 'pilhas'], offers: [['municao_9mm', 8], ['carne_lata', 2], ['pilhas', 2]] },
    intro: 'Pare aí. Isto aqui é área militar. Mãos onde eu possa ver.',
    rumors: ['O paiol tem o que sobrou de um projeto do Instituto Vitalis. Ordens eram de destruir tudo.', 'A torre do aeroporto ainda tem um transmissor de longo alcance.', 'Os Abutres tomaram o presídio do Vale Sombrio. Não negocie com eles de mãos vazias.'],
  },
  cabo_lins: {
    key: 'cabo_lins', name: 'Cabo Lins', age: 24,
    story: 'Recruta da última turma. Perdeu contato com a família em Nova Esperança.',
    personality: P(0.55, 0.6, 0.2, 0.6, 0.7, 0.35),
    goals: [{ kind: 'proteger_territorio', label: 'Vigiar o portão' }],
    look: L('#7a5a46', '#1d1a17', 2, '#4c5640', '#3b4232', FARDA), weapon: 'pistola',
    items: [['municao_9mm', 8], ['barra_cereal', 1]],
    needs: { item: ['fotografia', 'radio'], label: 'notícias da família', reason: 'Se achar um rádio, me avisa. Minha mãe morava no Centro de Nova Esperança.' },
    intro: 'Ei... você veio de fora? Como estão as coisas lá?',
    rumors: ['O sargento não deixa ninguém passar do pátio sem autorização.', 'Tem um bloco de detenção atrás do quartel. Já prendemos saqueadores lá.'],
  },
  sold_teles: {
    key: 'sold_teles', name: 'Soldado Teles', age: 29,
    story: 'Carcereiro da base. Guarda as chaves das celas no armário da guarita.',
    personality: P(0.6, 0.3, 0.45, 0.3, 0.6, 0.6),
    goals: [{ kind: 'proteger_territorio', label: 'Vigiar a detenção' }],
    look: L('#b08a6c', '#3a2a20', 0, '#4c5640', '#3b4232', FARDA), weapon: 'cassetete',
    items: [['municao_9mm', 4], ['cigarros', 1]],
    trade: { wants: ['cigarros', 'chocolate', 'whisky'], offers: [['municao_9mm', 6]] },
    intro: 'Circulando. Aqui é o bloco de detenção.',
    rumors: ['Preso que se comporta sai. Preso que foge leva tiro.'],
  },
  sold_paiva: {
    key: 'sold_paiva', name: 'Soldada Paiva', age: 31,
    story: 'Operadora de rádio. Passa as noites tentando falar com outras bases.',
    personality: P(0.5, 0.75, 0.15, 0.7, 0.75, 0.2),
    goals: [{ kind: 'ficar', label: 'Manter o rádio da base escutando' }],
    look: L('#c7a184', '#2f2620', 1, '#4c5640', '#3b4232', FARDA),
    items: [['pilhas', 2], ['caderno', 1]],
    needs: { item: ['pilhas'], label: 'pilhas para o rádio', reason: 'O gerador falha e o rádio de reserva come pilha. Se tiver, eu agradeço.' },
    intro: 'Você tem um rádio? A frequência 4 é a nossa. Escutamos o dia todo.',
    rumors: ['Frequência 4 é a da base. A 7 só tem estática... ou quase.', 'Alguém transmitiu do aeroporto há uns dias. Uma voz de mulher, falando de vacina.'],
  },
  // ------------------------------------------------------------ Comunidade Aurora (civis)
  dona_celia: {
    key: 'dona_celia', name: 'Dona Célia', age: 63,
    story: 'Diretora aposentada. Transformou a escola de Santa Aurora em abrigo para quem chegasse.',
    personality: P(0.6, 0.9, 0.1, 0.85, 0.85, 0.1),
    goals: [{ kind: 'proteger_territorio', label: 'Manter a comunidade alimentada' }],
    look: L('#d2ac8e', '#b9b4ac', 1, '#6b5a6a', '#4a4440'),
    items: [['caderno', 1], ['biscoito', 2]],
    needs: { item: ['antibiotico'], label: 'antibióticos', reason: 'Temos uma criança com febre há três dias. Precisamos de antibiótico.' },
    trade: { wants: ['feijao_lata', 'feijao_lata', 'arroz', 'agua', 'antibiotico', 'arroz'], offers: [['pao_forma', 2], ['bandagem', 2], ['agua', 1]] },
    intro: 'Seja bem-vindo à Aurora. Aqui ninguém passa fome sozinho — mas todo mundo ajuda.',
    rumors: ['Os Abutres levaram dois dos nossos para o presídio.', 'Uma médica do hospital daqui falava de um "paciente zero" antes de tudo desabar.', 'Na Fazenda Três Rios ainda tem plantação de pé.'],
  },
  tiago: {
    key: 'tiago', name: 'Tiago', age: 19,
    story: 'Filho de agricultores. Faz a vigia do portão da escola com um taco de beisebol.',
    personality: P(0.7, 0.55, 0.2, 0.5, 0.8, 0.45),
    goals: [{ kind: 'proteger_territorio', label: 'Vigiar o portão da Aurora' }],
    look: L('#9a7660', '#1d1a17', 3, '#5d6a58', '#3b4350'), weapon: 'taco_beisebol',
    items: [['agua', 1]],
    intro: 'Opa. Arma abaixada aqui dentro, combinado?',
    rumors: ['Dizem que tem um posto na estrada do Vale com combustível ainda.'],
  },
  rosa: {
    key: 'rosa', name: 'Rosa', age: 41,
    story: 'Cozinheira da comunidade. Perdeu o marido no primeiro dia.',
    personality: P(0.35, 0.8, 0.25, 0.75, 0.7, 0.1),
    goals: [{ kind: 'ficar', label: 'Cozinhar para todos' }],
    look: L('#b88f72', '#3a2a20', 1, '#7a5a4a', '#4a4440', { color: '#bdb5a5', kind: 'apron' }),
    items: [['pao_forma', 1], ['sardinha', 1]],
    trade: { wants: ['sardinha', 'feijao_lata', 'carne_lata'], offers: [['pao_forma', 2], ['macarrao_inst', 1]] },
    intro: 'Tá com fome? Senta. Mas amanhã você ajuda a buscar lenha.',
    rumors: ['Lúcia, uma moça da estrada, disse que vinha pra cá. Nunca chegou.'],
  },
  // ------------------------------------------------------------ Os Abutres (hostis)
  caveira: {
    key: 'caveira', name: 'Caveira', age: 38,
    story: 'Chefiava a carceragem antes da queda. Agora o presídio é dele.',
    personality: P(0.8, 0.1, 0.9, 0.35, 0.5, 0.9),
    goals: [{ kind: 'acumular', label: 'Juntar tudo que tiver valor' }],
    look: L('#a8826a', '#141210', 2, '#3a3430', '#2a2624', { color: '#5a3a30', kind: 'vest' }), weapon: 'rifle',
    items: [['municao_308', 6], ['whisky', 1], ['cigarros', 2]],
    trade: { wants: ['municao_9mm', 'municao_308', 'whisky', 'cigarros', 'galao_gasolina', 'antibiotico'], offers: [['municao_308', 4], ['cigarros', 1]] },
    intro: 'Olha só o que a estrada trouxe. Tudo tem preço aqui, amigo.',
    rumors: ['A Sentinela tem um paiol cheio. Um dia vamos buscar.', 'Os cientistas do aeroporto pagam bem por remédio.'],
  },
  navalha: {
    key: 'navalha', name: 'Navalha', age: 27,
    story: 'Ninguém sabe o nome verdadeiro. Vigia o portão do presídio.',
    personality: P(0.7, 0.05, 0.75, 0.2, 0.4, 0.95),
    goals: [{ kind: 'proteger_territorio', label: 'Vigiar o portão' }],
    look: L('#8d6a52', '#1d1a17', 2, '#2f2a26', '#2a2624'), weapon: 'faca_cozinha',
    items: [['cigarros', 1]],
    intro: 'Mais um passo e você entra na lista.',
    rumors: [],
  },
  brito: {
    key: 'brito', name: 'Brito', age: 35,
    story: 'Ex-motorista de ônibus. Entrou para os Abutres para não morrer de fome — e se arrepende.',
    personality: P(0.45, 0.5, 0.5, 0.45, 0.35, 0.5),
    goals: [{ kind: 'proteger_territorio', label: 'Guardar as celas' }],
    look: L('#b08a6c', '#3a2a20', 0, '#45403a', '#2f3a44'), weapon: 'cano_ferro',
    items: [['chave_celas', 1], ['barra_cereal', 1]],
    trade: { wants: ['comida', 'feijao_lata', 'chocolate'], offers: [['municao_9mm', 4]] },
    intro: 'Não me olha assim. Eu só guardo as celas.',
    rumors: ['O Caveira dorme pesado depois do uísque.', 'A cela 1 tem um grampo escondido no colchão. Não fui eu que disse.'],
  },
  // ------------------------------------------------------------ Equipe Vitalis (cientistas)
  dra_helena: {
    key: 'dra_helena', name: 'Dra. Helena Vitalis', age: 52,
    story: 'Virologista do Instituto Vitalis. Acredita que a vacina é possível — e que parte da culpa é dela.',
    personality: P(0.55, 0.65, 0.2, 0.5, 0.6, 0.15),
    goals: [{ kind: 'pesquisar', label: 'Terminar a vacina' }],
    look: L('#d2ac8e', '#6a6560', 1, '#c9ccc8', '#3b3b46', JALECO),
    items: [['caderno', 1], ['antisseptico', 1]],
    needs: { item: ['amostra_viral', 'reagente_r4', 'centrifuga'], label: 'componentes da vacina', reason: 'Preciso de uma amostra viral preservada, do reagente R-4 e de uma centrífuga do Instituto.' },
    trade: { wants: ['antisseptico', 'antibiotico', 'pilhas', 'agua'], offers: [['kit_medico', 1], ['bandagem', 2]] },
    intro: 'Vocês vieram de longe. Sentem-se... temos muito a conversar sobre como isso começou.',
    rumors: ['O primeiro caso foi internado no Hospital de Santa Aurora. O prontuário deve estar lá.', 'O laboratório do Instituto fica a leste, depois do Ribeirão. Sem energia, nada funciona.'],
  },
  marcos_vitalis: {
    key: 'marcos_vitalis', name: 'Marcos', age: 33,
    story: 'Técnico de laboratório. Fugiu do Instituto na noite do incidente.',
    personality: P(0.3, 0.6, 0.35, 0.4, 0.5, 0.1),
    goals: [{ kind: 'ficar', label: 'Ajudar a doutora' }],
    look: L('#9c7a62', '#2b2520', 0, '#c9ccc8', '#33382c', JALECO),
    items: [['agua', 1]],
    trade: { wants: ['agua', 'barra_cereal', 'feijao_lata'], offers: [['antisseptico', 1], ['pilhas', 1]] },
    intro: 'Desculpa, não durmo direito faz dias. Você é da Sentinela?',
    rumors: ['O gerador do Instituto precisa de combustível. Uns dez litros dão para começar.'],
  },
  // ------------------------------------------------------------ prisioneiro
  prisioneiro_joao: {
    key: 'prisioneiro_joao', name: 'João Pereira', age: 50,
    story: 'Agricultor da Fazenda Boa Vista. Foi capturado pelos Abutres quando buscava remédio.',
    personality: P(0.4, 0.75, 0.15, 0.6, 0.8, 0.2),
    goals: [{ kind: 'fugir_da_prisao', label: 'Sair do presídio' }, { kind: 'ir_para', label: 'Voltar para a Comunidade Aurora', x: 245, y: 222 }],
    look: L('#9a7660', '#6a6560', 0, '#7a6a52', '#4a4440'),
    items: [],
    needs: { item: ['chave_celas', 'grampo'], label: 'sair da cela', reason: 'Se conseguir as chaves com o Brito, me tira daqui. Eu conheço o caminho até a Aurora.' },
    intro: 'Psiu! Aqui! Você não é um deles, é?',
    rumors: ['Os Abutres guardam tudo que tiram dos presos no depósito perto da guarita.', 'O muro dos fundos dá para o Ribeirão.'],
  },
  // ------------------------------------------------------------ sobreviventes errantes
  lucia: {
    key: 'lucia', name: 'Lúcia', age: 27,
    story: 'Enfermeira. Saiu de Nova Esperança tentando chegar à Comunidade Aurora.',
    personality: P(0.45, 0.85, 0.2, 0.7, 0.75, 0.2),
    goals: [{ kind: 'ir_para', label: 'Chegar à Comunidade Aurora', x: 245, y: 222, needsTrust: 25 }],
    look: L('#c49a7c', '#4a3020', 1, '#6a7a86', '#3b4350'), weapon: 'faca_cozinha',
    items: [['bandagem', 2], ['agua', 1]],
    needs: { item: ['comida', 'feijao_lata', 'barra_cereal', 'pao_forma'], label: 'comida', reason: 'Faz dois dias que não como nada. Qualquer coisa serve.' },
    trade: { wants: ['comida', 'agua'], offers: [['bandagem', 2], ['antisseptico', 1]] },
    intro: 'Calma! Não atira. Eu sou enfermeira, tá? Só quero passar.',
    rumors: ['Tem uma escola em Nova Esperança com um mapa do estado inteiro na parede.', 'O hospital central foi tomado pelos infectados.'],
  },
  beto: {
    key: 'beto', name: 'Beto', age: 44,
    story: 'Caminhoneiro. O caminhão quebrou na Estrada do Vale e ele ficou.',
    personality: P(0.6, 0.4, 0.65, 0.55, 0.45, 0.45),
    goals: [{ kind: 'acumular', label: 'Juntar combustível para seguir viagem' }],
    look: L('#a8826a', '#2b2520', 3, '#7a4a3a', '#2f3a44'), weapon: 'pe_de_cabra',
    items: [['galao_gasolina', 1], ['cigarros', 1]],
    needs: { item: ['antibiotico', 'antisseptico'], label: 'remédio para o corte', reason: 'Cortei o braço numa lata. Tá inflamando. Tem algum remédio?' },
    trade: { wants: ['cigarros', 'whisky', 'municao_9mm', 'antibiotico'], offers: [['galao_gasolina', 1], ['chave_fenda', 1]] },
    intro: 'Opa. Sem gracinha, que eu também sei bater.',
    rumors: ['O Posto do Vale ainda tem diesel no tanque. Precisa de mangueira.', 'Vi uns caras armados descendo para o presídio. Evita aquela estrada.'],
  },
  irmao_davi: {
    key: 'irmao_davi', name: 'Irmão Davi', age: 58,
    story: 'Cuidava da capela de Serra Alta. Abre a porta para qualquer um que precise.',
    personality: P(0.4, 0.95, 0.05, 0.8, 0.9, 0.05),
    goals: [{ kind: 'ficar', label: 'Manter a capela aberta' }],
    look: L('#d2ac8e', '#b9b4ac', 2, '#3a3430', '#2a2624'),
    items: [['velas', 2], ['agua', 1]],
    needs: { item: ['agua'], label: 'água limpa', reason: 'O poço da capela secou. Se tiver água limpa, divida com quem chegar.' },
    intro: 'Que Deus te guarde. Entra, filho. Aqui é lugar de descanso.',
    rumors: ['As montanhas ao norte cortam o sinal do rádio. Suba a serra para falar mais longe.'],
  },
  nina: {
    key: 'nina', name: 'Nina', age: 16,
    story: 'Perdeu-se dos pais no Porto Leste. Sobrevive escondida em sótãos.',
    personality: P(0.3, 0.6, 0.3, 0.35, 0.6, 0.15),
    goals: [{ kind: 'ir_para', label: 'Encontrar um lugar seguro', x: 245, y: 222, needsTrust: 40 }],
    look: L('#8d6a52', '#1d1a17', 1, '#7a5a6a', '#3b3b46'),
    items: [['chocolate', 1]],
    needs: { item: ['agua', 'comida'], label: 'água', reason: 'Tô com muita sede... tem água?' },
    intro: 'Fica longe! ...Você é de verdade? Não é um deles?',
    rumors: ['Os barcos do porto afundaram todos.', 'Ouvi tiros perto do aeroporto ontem à noite.'],
  },
};
