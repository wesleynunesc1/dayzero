# Etapa 02 — Sistema avançado de sobrevivência realista

## Análise inicial do projeto (Etapa 01)

- **Tecnologia real:** TypeScript + Vite + motor próprio em Canvas 2D. O Phaser não foi usado na
  Etapa 01 (o ambiente estava sem internet), então a base existente foi mantida.
- **Verificado antes de mudar:** os 18 testes da Etapa 01 rodaram no navegador antes e depois desta etapa.
  Todos continuam passando: movimento, câmera, colisões, estabelecimentos, IA, ruído, combate,
  inventário, ferimentos, NPC e mapas físicos.
- **Lacunas encontradas:**
  - fome e sede rudimentares, contadas em segundos reais e drenando vida no limite;
  - nenhum relógio de mundo, fadiga ou sono;
  - nenhum salvamento;
  - nenhum veículo, crafting (exceto rasgar roupa) ou clima;
  - a infecção progredia por cerca de 2 minutos, em conflito com a nova regra de morte imediata;
  - a garrafa de água sumia ao esvaziar;
  - pesos diferentes dos exemplos do briefing.

## 1. Sistemas implementados

| Fase | Sistema | Resumo |
|---|---|---|
| A | Relógio do mundo | 1 s real = 1 min de jogo. Dias e noites passam, mas não há prazo de campanha. Noite escura, amanhecer e entardecer com luz própria. |
| A | Fome / sede | Sobem por hora de jogo, mais rápido ao correr, lutar e carregar peso. Níveis graduais causam fraqueza (menos fôlego máximo, recuperação, velocidade e dano). Inanição e desidratação extremas tiram vida aos poucos, e a desidratação pode matar. Nunca há dano instantâneo. |
| A | Energia e sono | O fôlego (curto prazo) é separado da fadiga acumulada. Fadiga reduz corrida e recuperação, e a 95 impede correr. Dormir em cama, sofá ou banco, com qualidades diferentes, faz o tempo correr em simulação real acelerada. O sono é interrompido por dano, zumbis por perto, barulho (pancadas na porta), fome ou sede, ou pela tecla [E]. |
| B | Inventário | Peso + espaços, mochilas, empilhamento, transferência, consumo e descarte (pilha no chão). Pesos em `data/items.ts`: lata 0,5 kg; garrafa 1 L ≈ 1,05 kg; pistola 1 kg; rifle 3,5 kg; kit 1 kg. A carga base passou de 8 para 10 kg. |
| B | Alimentos | Lata de feijão, sardinha, carne enlatada, biscoitos, arroz (precisa cozinhar), maçã, banana, carne crua (precisa assar), pão, macarrão instantâneo e outros. Cada um tem kcal, quanto reduz a fome e conservação (fresco → passado → estragado). Comida estragada rende menos e pode causar náusea. |
| B | Água | Garrafas e galões de 5 L reutilizáveis, que pesam conforme o conteúdo. O barril de chuva e a caixa d'água têm água não tratada (risco de náusea); ferver no fogo torna potável. Não há água infinita: os reservatórios esvaziam e a chuva enche o barril. |
| C | Armas | Punhos, armas corpo a corpo com durabilidade, pistola 9mm e rifle .308 (novo). Cada uma tem dano, alcance, cadência, munição própria, ruído e carregador. Não dispara vazia; descontar munição → disparo/colisão → som → zumbis reagem → dano. Recarregar, descarregar e reparar com fita. |
| C | Médico | Ferimentos leves (arranhão) e graves (laceração, mordida). O tratamento depende da condição: o curativo serve só para ferimento leve; a bandagem estanca; a bandagem improvisada e as tiras de pano deixam o ferimento **sujo**, que infecciona em 6 h e só se limpa com antisséptico; o kit de primeiros socorros trata e desinfeta **um** ferimento por uso. Também há analgésico. |
| C | Infecção | Se o ataque transmite o vírus, a morte é **imediata**. A chance por tipo de ferimento (`infection.transmission`) e o atraso (`deathDelaySec`) são configuráveis. Não há progressão de dias nem remédio comum que cure. |
| D | Caminhonete | Posição, colisão por 3 círculos com paredes, árvores, cercas e carros, tanque de 60 L, aceleração, freio, ré, direção e estado do veículo. Consome gasolina ligada (mais acelerando). Sem gasolina o motor morre e ela para. Entrar e sair com [E] (precisa estar parada). O motor faz ruído que aumenta com a aceleração, e zumbis perseguem e batem na lataria. Atropelamento causa dano. Pneus e bateria já existem como campos para etapas futuras. |
| D | Gasolina | Galão de 10 L (pesa conforme o conteúdo), achado no depósito. Sifão com mangueira retira gasolina de carros abandonados que ainda têm combustível. "Abastecer veículo próximo" é feito pelo inventário. |
| E | Crafting | Receitas em `data/recipes.ts` com materiais, ferramentas, condição e tempo: bandagem improvisada, painel de barricada (martelo, faz barulho), reparo com fita, cozinhar arroz, assar carne e ferver água (perto do fogo, com panela). Valida antes, desconta depois, atualiza o peso e salva. |
| E | Abrigo | Casa 1 com baú de armazenamento persistente, cama e portas. Portas e janelas podem ser reforçadas com barricadas (até 2 por porta, que também impedem abri-la). O abrigo não é invulnerável: zumbis forçam portas, quebram janelas e arrancam tábuas quando perseguem alguém ou ouvem barulho. Não há base obrigatória. |
| F | Clima | Controlador modular com tempo limpo, chuva e neblina, transições suaves e duração configurável. A chuva escurece, mostra gotas, abafa sons (ruídos ×0,7), reduz um pouco a visão e enche o barril. A neblina reduz a visão de todos (×0,55) e encobre a distância. |
| F | Salvamento | localStorage, com salvamento manual (pausa) e automático (a cada 90 s e após dormir, fabricar, guardar, abastecer, barricar, sair do veículo e reaparecer). O formato é versionado e separa `world` de `players[]`, pensando no servidor multiplayer. Restaura jogador, recipientes saqueados, itens no chão, corpos com equipamento, veículos e combustível, barricadas, janelas, portas, reservatórios, zumbis (mortos continuam mortos), clima e relógio. Uids preservados; um save com item duplicado é **recusado**. |
| F | Interface | HUD com saúde, fome, sede, energia e fôlego (cheio = bom), estados, arma e munição, carga. Combustível e velocidade aparecem só dirigindo. Aba "Fabricar", relógio e clima no painel de condição, tela de sono, "Continuar partida". Não há minimapa, GPS, marcadores, chat ou contagem regressiva. |

## 2. Arquivos

**Criados:**
- `src/systems/Needs.ts`, `src/systems/Weather.ts`, `src/systems/VehicleSystem.ts`
- `src/systems/Crafting.ts`, `src/systems/Save.ts`
- `src/entities/Vehicle.ts`, `src/data/recipes.ts`
- `tests/etapa2.test.ts`, `tests/e2e-etapa2.mjs`, `ETAPA02.md`

**Modificados:**
- `src/config.ts`, `src/data/items.ts`, `src/data/loot.ts`
- `src/engine/Audio.ts` (motor, chuva), `src/engine/Input.ts`
- `src/entities/Player.ts`, `src/game/Game.ts`
- `src/render/Renderer.ts` (noite, faróis, chuva, neblina, veículo, janelas com tábuas), `src/render/Sprites.ts`
- `src/systems/Combat.ts`, `Health.ts`, `Interaction.ts`, `ItemActions.ts`, `Noise.ts`, `Physics.ts`, `PlayerController.ts`, `Respawn.ts`, `Simulation.ts`, `ZombieAI.ts`
- `src/ui/UI.ts`, `src/ui/styles.ts`
- `src/world/MapBuilder.ts`, `TileMap.ts`, `World.ts`, `tiles.ts`, `types.ts`
- `README.md`, `package.json`, `tests/e2e-etapa1.mjs` (antigo `tests/e2e.mjs`)

## 3. Testes realizados

- **`tests/etapa2.test.ts`** (lógica, sem navegador): 34/34 verificações cobrindo os 20 cenários
  obrigatórios, incluindo os casos negativos: arma vazia não dispara, munição incompatível, curativo
  não serve em laceração, crafting sem martelo ou longe do fogo é recusado e um save adulterado com
  item duplicado é rejeitado.
- **`tests/e2e-etapa2.mjs`** (Chrome, teclas e cliques reais): 12/12 em 1280×720 e 1920×1080.
  - Comer e beber pela interface, fabricar pela aba, dormir na cama com [E].
  - Dirigir com W, frear com S, sair com [E], indicador de combustível.
  - Chuva, neblina e noite.
  - Barricada pela interface, guardar no baú, salvar pelo menu.
  - **Recarregar a página**, clicar em "Continuar" e conferir que nada mudou e que não houve duplicação.
  - Console sem erros.
- **`tests/e2e-etapa1.mjs`**: os 18 testes da Etapa 01 seguem passando (21/21 verificações) nas duas resoluções.
- **`tests/ai.test.ts`, `tests/items.test.ts`, `tests/sim.test.ts`**: passam, inclusive o soak de 5
  minutos sem exceções (simulação ≈ 0,05 ms/passo).

Problemas encontrados e corrigidos durante os testes:
- coleta de gasolina bloqueada pela carga base de 8 kg (o galão cheio pesa 8,4 kg) → carga base 10 kg;
- anéis de ruído do motor poluindo a tela;
- mensagem repetida de porta arrombada;
- rótulo "Dirigindo" sobreposto ao HUD;
- conflito entre a infecção de 2 minutos e a nova regra de morte imediata.

## 4. O que ainda não funciona / limitações conhecidas

- O motor continua próprio (não é Phaser).
- **Veículo:**
  - há um único veículo e um único modelo; a colisão é aproximada por círculos;
  - o NPC não entra no carro;
  - pneus, bateria e reparos de motor só existem como campos de dados.
- **Água e fogo:**
  - só há duas fontes de fogo fixas (tambores); não dá para fazer fogueira nem usar o fogão (sem gás);
  - não há filtragem de água, só fervura.
- **Salvamento:**
  - um único slot no navegador (some se os dados do site forem apagados) e não há exportação para arquivo;
  - manchas de sangue não são salvas;
  - os zumbis voltam ao estado "vagar" ao carregar.
- **Clima:**
  - não há temperatura corporal (fora do escopo, como pedido);
  - a chuva não molha o personagem.
- **Outros:**
  - barricadas são instaladas pelo inventário, não pela tecla [E];
  - os valores de balanceamento são uma primeira passada;
  - controles de toque ainda não existem.

## 5. Como executar e testar

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # testes de lógica
npm run test:e2e     # testes no navegador (com o dev server rodando; requer playwright)
```

Ou abra `jogar-offline/o-ultimo-amanhecer.html` direto no navegador (arquivo único, offline).

**Roteiro sugerido para testar à mão:**

1. Saia da Casa 1 e vá ao mercantil buscar comida e água.
2. No depósito, pegue o galão, a mangueira e o martelo.
3. Abasteça a caminhonete na saída do depósito pelo inventário (galão → "Abastecer veículo próximo").
4. Dirija pela avenida e observe os zumbis atraídos pelo motor.
5. Volte ao abrigo, guarde suprimentos no baú, fabrique e instale uma barricada (aba Fabricar → item no inventário).
6. Durma na cama e salve pelo menu de pausa.
7. Recarregue a página e clique em "Continuar partida".
