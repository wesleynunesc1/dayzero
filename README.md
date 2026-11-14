# O Último Amanhecer — Etapas 01 e 02

Protótipo jogável 2D (top-down) de sobrevivência pós-apocalíptica.
A Etapa 02 adicionou fome, sede, energia e sono, caminhonete dirigível com gasolina, crafting,
abrigo com barricadas, clima (chuva/neblina), dia e noite e salvamento local. Veja `ETAPA02.md`.
Bairro explorável, infectados com IA, ruído com propagação física, combate, ferimentos,
inventário com peso, NPC aliado, mapa de papel rasgado e morte com corpo saqueável.

Tudo roda localmente, sem serviços externos. Arte e sons são **provisórios, originais e gerados
pelo próprio código** (procedurais), prontos para serem substituídos por assets finais.

---

## Como executar

### Opção 1 — jogar já (sem instalar nada)
Abra `jogar-offline/o-ultimo-amanhecer.html` no Chrome, Edge ou Firefox. É um arquivo único, funciona offline.

### Opção 2 — ambiente de desenvolvimento (Vite + TypeScript)
Requer Node.js 18 ou superior.

```bash
npm install
npm run dev        # abre em http://localhost:5173
```

Outros comandos:

```bash
npm run typecheck  # verificação de tipos (TypeScript estrito)
npm run build      # gera a versão de produção em dist/ (a versão de arquivo único fica em jogar-offline/)
npm run preview    # serve o build localmente para conferência
```

Valide sempre em `localhost` antes de qualquer publicação.

---

## Controles

| Tecla | Ação |
|---|---|
| W A S D | Movimentar |
| Shift | Correr (gasta fôlego, faz mais barulho) |
| C | Agachar / levantar (passos silenciosos, mais difícil de ser visto) |
| E | Interagir: portas, janelas, recipientes, corpos, NPC |
| I | Inventário |
| H | Condição física e ferimentos |
| M | Mapa (somente depois de encontrar um) |
| R | Recarregar |
| F | Fabricar (aba de crafting) |
| Dirigindo: W / S / A / D | Acelerar · frear e ré · esterçar (E sai — pare antes) |
| Mouse | Mirar · botão esquerdo ataca |
| Botão direito | Mira firme (reduz a dispersão da pistola) |
| Esc | Pausar / fechar janelas (o menu de pausa tem a regra de retorno) |
| F3 | Mostrar desempenho (fps, ms da simulação e da renderização) |

---

## O que existe nesta etapa

**Mundo** — bairro de 128×96 tiles (maior que a tela, câmera suave): avenida e rua comercial,
calçadas com mato, quatro casas, mercantil, delegacia e depósito, todos com interior, paredes com
colisão, portas, janelas e móveis. Carros abandonados (alguns com porta-malas), árvores, postes,
cercas, sebes, entulho bloqueando as saídas do bairro. Telhados somem ao entrar nos edifícios.

**Recursos em locais lógicos** — comida em armários, geladeiras e prateleiras; água no refrigerador
do mercantil; armas, munição e equipamento policial na delegacia; roupas e mochilas em
guarda-roupas; ferramentas e materiais no depósito. Nada solto no chão sem motivo.

**Jogador** — andar, correr, agachar, parado, virar para a mira, socar, usar arma, interagir,
receber dano, cair incapacitado. Animações de pernas, braços, golpes, recuo e reação ao dano.

**Infectados** — três tipos (comum, rápido, debilitado/rastejante), pessoas comuns com roupas
variadas (inclusive policiais, funcionários do mercantil e operários). Máquina de estados:
vagar → investigar barulho → identificar → perseguir → atacar → procurar → retornar.
Visão em cone com linha de visão; audição pelo sistema de ruído; caminhos por A*;
arrombam portas; o grunhido de alerta atrai vizinhos; horda de teste na avenida leste.
Nenhum zumbi é teleportado.

**Ruído** — passos (pequeno), corrida (moderado), golpes, porta, janela quebrada (alto), disparo
(muito alto). O som se propaga pela grade e é abafado por paredes e portas fechadas.

**Combate** — punhos, armas corpo a corpo (taco, pé de cabra, cassetete, faca, cano, martelo) com
durabilidade, pistola com carregador, munição limitada e recarga. Ataque furtivo causa dano dobrado.

**Ferimentos** — estados Saudável, Ferido, Sangrando, Incapacitado e Morto. Arranhões, lacerações e
mordidas. Sangramento contínuo. Kit médico trata **um ferimento por uso**, com tempo de aplicação.
Bandagens e tiras de pano (rasgando roupas) também tratam, com qualidades diferentes.

**Infecção** — mordida infectante é fatal (sem cura nesta etapa): ardência, febre, febre alta, morte.

**Morte e retorno** — o corpo fica no local com todos os itens (saqueável). O jogador volta sem
armas, só com uma camiseta. A regra do ponto de retorno é configurável (`src/config.ts` ou menu de
pausa): ponto seguro mais próximo, último ponto seguro visitado, última localização segura ou
ponto inicial. Pontos seguros são registrados ao entrar nas casas e na delegacia.

**Inventário** — limite de peso e de espaços, mochilas, equipar, consumir, examinar, guardar em
recipientes, descartar (cria pilha no chão), pegar tudo, clique duplo para transferir.

**Mapa de papel** — mapa rasgado em uma cômoda da Casa 2; fragmento na escrivaninha da Casa 4.
Combine pelo inventário. O mapa não mostra a posição do jogador, de zumbis ou de aliados.
Não há minimapa, radar, GPS ou setas.

**Rádio** — encontrado na mesa do despacho da delegacia: ligar/desligar, bateria, trocar pilhas,
sintonizar (somente estática). Ligado, faz um pouco de barulho.

**NPC aliado (Elias)** — fala com [E]: seguir, esperar, entregar kit médico, perguntar estado.
Segue o jogador desviando de obstáculos e abrindo portas, percebe apenas zumbis que vê, luta,
recua quando muito ferido e socorre o jogador incapacitado se tiver recursos médicos.
Se ele não estiver por perto, grite por socorro ([E] caído) — o grito também atrai zumbis.

**Interface** — discreta e em português: saúde, fôlego, estado e ferimentos, arma, munição, carga
e a interação disponível.

---

## Onde encontrar o quê (para testar)

| Item | Local |
|---|---|
| Taco de beisebol | Guarda-roupa do quarto, Casa 1 (abrigo inicial) |
| Kit médico | Armário do banheiro da Casa 3 · caixa de primeiros socorros da delegacia · Elias carrega um |
| Pistola 9mm + munição | Armário de armas no arsenal da delegacia (fundos, à direita) |
| Comida / água | Prateleiras e refrigerador do mercantil |
| Mapa rasgado | Cômoda do quarto norte, Casa 2 |
| Fragmento do mapa | Escrivaninha do escritório, Casa 4 |
| Rádio | Mesa do despacho, delegacia |
| Lanterna | Mesa do escritório do depósito · armário pessoal da delegacia |
| Mochilas | Guarda-roupas das casas 2 e 4 |
| Caminhonete (1,5 L no tanque) | Saída do depósito, no caminho de cascalho |
| Galão de gasolina (6 L) + tábuas | Caixotes do depósito |
| Mangueira de sifão, martelo, pregos | Bancada do depósito |
| Rifle de caça .308 + munição | Armário do caçador, escritório da Casa 4 |
| Água não tratada | Barril de chuva (quintal da Casa 1) · caixa d'água (fundos da Casa 3) |
| Fogo para cozinhar/ferver | Tambores com fogo: calçada da Rua do Comércio e frente da delegacia |
| Baú do abrigo | Sala da Casa 1 |

---

## Arquitetura

```
src/
  config.ts              parâmetros (velocidades, ruídos, IA, regra de retorno)
  main.ts                ponto de entrada
  engine/                Input (ações), Camera, Audio (WebAudio), EventBus, math (RNG determinístico)
  world/                 TileMap, tiles, Pathfinder (A*), MapBuilder (o bairro), World (estado), types
  entities/              Actor, Player, Zombie, Ally
  systems/               Simulation (passo fixo), PlayerController, ZombieAI, AllyAI, Noise,
                         Combat, Health, Inventory, ItemActions, Interaction, Respawn, Physics
  data/                  items (banco de itens), loot (tabelas por recipiente)
  render/                Renderer (camadas, visão, luz), Textures, Sprites, Decals
  ui/                    UI (HUD, inventário, diálogos, menus), MapView (mapa de papel), styles
  game/Game.ts           cenas (título, partida, pausa, morte) e ligação entre os módulos
tests/                   testes automatizados de simulação (rodam sem navegador)
```

Decisões pensadas para as próximas etapas:

- **Simulação separada da renderização e do DOM.** `World` + `Simulation` rodam sozinhos (os testes
  em `tests/` os executam sem navegador). Isso permite levar a simulação a um servidor no multiplayer.
- **Jogador controlado por comandos** (`PlayerCommand`), não por teclas. Teclado/mouse hoje; toque,
  gamepad ou rede depois, sem mudar a lógica.
- **Passo fixo de 60 Hz** e RNG com semente — base para sincronização e reprodução.
- **Estado do mundo serializável** (arrays tipados do mapa, recipientes, portas, corpos) — base para
  mundo persistente e save.
- **Eventos** (`EventBus`) desacoplam simulação, interface e áudio.
- **IA com nível de detalhe**: zumbis distantes pensam menos e não calculam caminhos; buscas A*
  limitadas por quadro.

### Onde ajustar o balanceamento (Etapa 02)

- `src/config.ts`: relógio (`time`), fome/sede/fadiga (`needs`), ferimentos sujos (`wounds`),
  transmissão do vírus por tipo de ferimento e atraso (`infection`), consumo e ruído do veículo
  (`vehicle`), clima (`weather`), salvamento (`save`), carga base do jogador (`player.baseCarryKg`).
- `src/data/items.ts`: peso, valores nutricionais, conservação, armas (dano, alcance, cadência,
  munição, ruído), recipientes de água e de gasolina.
- `src/data/recipes.ts`: receitas de fabricação. `src/data/loot.ts`: o que existe em cada recipiente.
- `src/entities/Vehicle.ts`: modelos de veículo.

### Sobre o Phaser

O briefing recomenda Phaser. Este protótipo foi construído num ambiente sem acesso à internet,
onde o Phaser não pôde ser instalado. Para não entregar algo que não roda, a base usa um motor
próprio enxuto em TypeScript + Canvas 2D, organizado com as mesmas responsabilidades (cenas,
câmera com acompanhamento, colisão, tilemap, carregamento). A simulação não depende do motor de
renderização, então migrar a camada `render/` + `game/` para Phaser é um trabalho localizado, se
for a preferência para as próximas etapas.

---

## Testes

Os 18 testes obrigatórios do briefing foram executados no Chrome (com o jogo servido em `localhost`)
por um roteiro automatizado, além de testes de simulação:

```bash
npm test                     # lógica: 20 cenários da Etapa 02 + IA + itens + sanidade (sem navegador)
npm run test:e2e             # navegador: 18 testes da Etapa 01 + roteiro da Etapa 02 (requer playwright)
npx tsx tests/etapa2.test.ts # só os 20 cenários da Etapa 02
npx tsx tests/ai.test.ts     # arrombamento de portas, NPC abrindo portas, som abafado, soak de 5 min
npx tsx tests/items.test.ts  # rádio, lanterna, mochila, limite de peso, descarte, comida, tiras de pano
npx tsx tests/sim.test.ts    # sanidade da simulação e reação ao disparo
```

## Assets provisórios

Todos os gráficos (tiles 16×16, personagens, móveis, carros, telhados, mapa de papel) e sons
(passos, golpes, disparo, vidro, grunhidos, estática) são gerados por código em
`src/render/Textures.ts`, `src/render/Sprites.ts`, `src/render/Decals.ts`, `src/ui/MapView.ts` e
`src/engine/Audio.ts`. Para trocar por arte final, substitua as funções de desenho por sprites
carregados, mantendo as mesmas chamadas.
