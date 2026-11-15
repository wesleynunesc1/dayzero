# O Último Amanhecer — Etapas 3, 4 e 5

Relatório de entrega: o que foi implementado, o que está parcial, o que não foi feito, próximos passos,
como executar e o relatório de testes (todos os números abaixo vêm de execuções reais dos testes).

As Etapas 1 e 2 foram preservadas: o bairro original continua na origem do mapa (0–127 × 0–95), com as
mesmas coordenadas, e as suítes antigas continuam passando (ver relatório de testes).

---

## 1. O que foi implementado

### Módulo A — Mundo e exploração
- **Mundo de 512 × 384 tiles** (`src/world/WorldGen.ts`) com 4 regiões (Oeste, Norte, Leste, Sul), gerado de forma determinística pela semente.
- **Cidades com nome, bairros e porte:** Nova Esperança (capital: Hospital Central, Escola Municipal, Mercantil, Farmácia, Oficina, Posto; bairros Acácias, Centro, Vila Operária), Santa Aurora (média: hospital, delegacia, escola da Comunidade Aurora), Vale Sombrio (presídio dos Abutres), Serra Alta (igreja-abrigo, mercearia), Porto Leste, Pedra Branca; **Base Sentinela**, **Aeroporto** (pista, terminal, hangar, torre), **Instituto Vitalis** (laboratório), 3 fazendas, florestas, rodovias (BR-101, BR-232, Estrada do Vale, Rodovia Leste), rio com pontes, serra com rochas, postos com tanque de combustível.
- **Densidade de infectados pela população** (~496 no mundo; capitais mais cheias, zona rural rarefeita) e **hordas migratórias** entre cidades, atraídas por barulhos fortes (`src/systems/WorldSim.ts`). Nada nasce perto do jogador: as hordas já existem e se deslocam.
- **Carregamento por regiões:** células de 32×32 tiles; só as próximas de jogadores humanos ficam ativas (IA completa, física, colisões). O resto roda em modo econômico.
- **Mapas físicos** (`src/ui/MapView.ts`): mapas regionais e do estado nos estados *completo, rasgado, molhado, queimado, desatualizado* (não sabe dos bloqueios recentes) e *parcialmente ilegível*; **pedaços combináveis** (bitmask de quadrantes); o mapa do bairro da Etapa 1 agora mostra só o bairro. **Marcações manuais** (abrigo, estabelecimento, base militar, estrada, perigo, recurso) com anotação, salvas por personagem. Nenhum mapa mostra o jogador, aliados ou inimigos.

### Módulo B — NPCs com IA
- 17 NPCs com **nome, idade, história, personalidade** (coragem, empatia, ganância, sociabilidade, lealdade, agressividade), **objetivos**, **necessidades** (fome/sede), **7 emoções**, **memória** (até 40 lembranças), **relações** por pessoa (confiança, afeto, medo, ressentimento, dívida) e **inventário** (`src/data/npcs.ts`, `src/entities/Npc.ts`).
- **IA por utilidade** (`src/systems/NpcAI.ts`): fugir, lutar (corpo a corpo e arma de fogo, recarrega), confrontar, socorrer, comer/beber, procurar comida e equipamento em recipientes, **saquear corpos**, seguir quem o recrutou, vigiar território, viajar até o objetivo, fugir da prisão. Decisões vêm de estado + contexto; nenhuma chamada a modelos externos.
- **Memória com consequências** (`src/systems/Social.ts`): toda mudança de relação nasce de um evento registrado (tabela fixa modulada pela personalidade). Ex.: Lúcia pede comida → ignorada por 3 h → ressentimento, fala diferente no próximo encontro, troca mais cara ou recusa; com personalidade agressiva e muito rancor, vira hostil.
- **Diálogo procedural** (história, rumores, pedidos, presentes, tratar ferimentos, recrutar, esperar, troca com valor percebido).

### Módulo C — Facções, captura e prisão
- 4 facções (`src/systems/Factions.ts`): **Base Sentinela** (militar, pode ser amigável), **Comunidade Aurora** (civil), **Os Abutres** (hostil), **Equipe Vitalis** (cientistas), com território, áreas restritas, líder, recursos (consumidos diariamente), integrantes, relações entre si, regras e objetivos. **Reputação** por jogador, com efeito em cadeia nas facções aliadas/inimigas.
- **Captura** (`src/systems/Prison.ts`): guardas dão voz de prisão e esperam a rendição; quem se rende ou cai incapacitado perto deles é preso (a facção estanca o sangramento — não executa presos). **Equipamento confiscado** vai para o depósito de apreensões (não some).
- **Na cela o jogo continua:** revistar o colchão (grampo escondido), conversar com outros presos e guardas, **negociar a soltura** (militares soltam após averiguação; Abutres cobram resgate), **fugir com grampo** (tentativas, barulho, grampo pode quebrar) e **ser resgatado** (chave das celas do carcereiro, grampo pelo lado de fora ou pagamento por um amigo). Fuga vista pelos guardas custa reputação. Missões dinâmicas de prisão são criadas para o grupo.

### Módulo D — Multijogador (1 a 4)
- **Servidor autoritativo** em Node (`src/net/GameServer.ts`, `server/`): só ele simula; clientes mandam comandos de controle e **ações validadas** (`src/net/Actions.ts`). Inventário, saque, combate, missões e veículos nunca são decididos pelo cliente.
- **WebSocket próprio** (RFC 6455, `server/ws.ts`) — o ambiente não tinha npm, então nada de dependências externas.
- **Lobby real** no menu: conectar, ver participantes e vagas, escolher personagem, modalidade SOLO/DUO/TRIO/QUARTETO (anfitrião), iniciar ou continuar a campanha.
- **4 sobreviventes**, cada um começando numa região (Marina — Oeste/bairro; Rafael — Sul/Santa Aurora; Ana — Norte/Serra Alta; Caio — Leste/Porto Leste). **Vagas sem humano são da IA** (`src/systems/SurvivorBot.ts`), que usa exatamente os mesmos comandos e ações de inventário de um jogador.
- **Desconexão:** a IA assume na hora; ao voltar com o mesmo nome, o jogador reassume onde a IA deixou o personagem. O inventário **não é restaurado nem apagado** (o que a IA comeu, gastou ou achou permanece).
- **Sem duplicação:** itens só mudam de lugar no servidor; o save do servidor passa por auditoria de uids antes de gravar.
- **Gerenciamento de interesse:** cada cliente recebe só o que está no seu raio (34 tiles). A posição de quem está longe nunca é enviada (nem no estado inicial) e marcações de mapa são privadas.

### Módulo E — Comunicação
- **Rádio** (`src/systems/Radio.ts`): estado funcional (danificado/sem bateria/desligado), **bateria** (gasta ligado e por transmissão), **8 canais**, **alcance** (~150 m portátil; estações fixas da base e da torre alcançam o mapa), **interferência** (montanhas no caminho e chuva → "… [chiado] …").
- **Fala local** (perto, com linha de visão) e **grito** (alcança mais, atravessa paredes e atrai infectados). **Sem chat global.**
- Mensagens não carregam coordenadas. A Base Sentinela escuta o canal 4; a Dra. Helena transmite no canal 7; sobreviventes da IA respondem descrevendo onde estão **em palavras** ("perto da Igreja da Serra, em Serra Alta").
- **Limitação assumida:** não há voz em tempo real — o rádio é de texto curto, restrito pelas mesmas regras.

### Módulo F — Campanha e missões
- **10 capítulos** com progresso **compartilhado** e sem cronômetro (`src/systems/Missions.ts`): Sobreviver → Encontrar o rádio → Estabelecer contato → Encontrar os aliados (grafo de contatos + ponto de encontro dito pelo rádio) → O reencontro → A origem (prontuário no hospital de Santa Aurora, relatório no hangar, Dra. Helena) → Os componentes (amostra no freezer do hospital, R-4 no paiol trancado da Sentinela, centrífuga no Instituto) → O laboratório (gerador precisa de 10 L e faz barulho) → A vacina (síntese de ~2,5 min defendendo o laboratório) → A missão final (transmitir a fórmula de uma estação de longo alcance e entregar doses à Aurora).
- **Missões secundárias com consequência:** pessoa desaparecida (Lúcia), resgate de prisioneiro (João), remédio para a Aurora, defender a comunidade (10 abates por perto), investigar o hospital, conflito do paiol, escolta, recuperar equipamento saqueado por NPC, fuga da prisão. Ajudar sobe reputação/recursos e cria gratidão; ignorar gera ressentimento e fracasso registrado.
- **Infecção:** mordida que transmite continua matando na hora antes da cura; não há antídoto comum. A regra **pós-vacina é configurável** (`CONFIG.infection.afterVaccine`: `imune` | `resistente` | `sem_efeito`) — o padrão `imune` é provisório até a decisão de design.

### Módulos G e H — Persistência, consequências e otimização
- **Morte persistente:** o corpo fica no lugar com todos os itens (mesmos uids); NPCs próximos podem saquear (os itens passam para o inventário deles e continuam recuperáveis — troca, negociação ou combate; se o NPC morrer, ficam no corpo dele). Retorno no ponto configurável, **só com os punhos** (sem arma, munição ou mochila); o ponto inicial de cada sobrevivente é o da sua região.
- **Save v3** (`src/systems/Save.ts`): mundo, recipientes, corpos, zumbis, veículos e combustível, ferimentos, 4 sobreviventes (marcações, contatos, prisão, vacina), NPCs (memória, emoções, relações, inventário), facções, campanha, missões, rádio e hordas. Lê saves da Etapa 2.
- **Servidor** (`server/FileStore.ts`): seções em arquivos separados, **escrita atômica** (temporário + fsync + rename), **gravação incremental** (só seções alteradas), **backup do manifesto** e **recuperação após queda**. O mundo não é reiniciado quando o anfitrião sai. Simular com o servidor vazio é configurável (`--simular-vazio`).
- **Otimização:** ativação de IA por proximidade, zumbis dormentes em modo macro, NPCs distantes pensando a cada 2 s, LOD de IA por distância ao jogador mais próximo, colisões só entre entidades ativas, cache de chunks e telhados com LRU no renderizador, monitor de desempenho (F3 e `/status` do servidor).

---

## 2. O que está parcial

- **Rádio por voz:** não implementado (texto restrito, ver acima).
- **Predição no cliente:** o modo online não tem predição/reconciliação. Em rede local o atraso é imperceptível; pela internet o movimento terá a latência da conexão.
- **Dormir no multijogador** não acelera o tempo (o mundo é compartilhado): 1 hora de jogo leva 1 minuto real. No SOLO o tempo continua acelerando.
- **Regra de retorno no online:** o seletor do menu de pausa muda só a configuração local; o servidor usa a sua configuração.
- **Movimento distante:** zumbis dormentes, NPCs e sobreviventes da IA longe de humanos se deslocam em modo simplificado (sem colisão fina). Hordas contornam obstáculos de forma simples.
- **Conflito entre facções** existe como relações, reputação em cadeia e missão narrativa; não há ataque roteirizado dos Abutres à Sentinela.
- **Falas dos NPCs** são procedurais por modelos (memória + emoções + personalidade), não texto livre.
- **Identidade visual das cidades** vem do traçado, nomes e estabelecimentos; a arte procedural continua provisória.
- **Phaser** não foi usado (sem npm no ambiente original); o motor próprio em Canvas 2D foi mantido.

## 3. O que não foi implementado

- Autenticação de jogadores: a vaga é reassumida pelo **nome** (quem digitar o mesmo nome assume o personagem). Para jogar pela internet aberta, falta login/senha ou token.
- Comunicação por voz em tempo real.
- Mais de um mundo por processo de servidor (um servidor = um mundo).
- Geração procedural de NPCs genéricos além dos 17 com história.

## 4. Próximos passos sugeridos

1. Autenticação simples (token por jogador gravado no navegador) e lista de mundos no servidor.
2. Predição de movimento no cliente com reconciliação pelo snapshot.
3. Voz por rádio (WebRTC) obedecendo alcance/canal/bateria do sistema atual.
4. Eventos de facção (ataque dos Abutres ao paiol, comércio entre comunidades) usando os recursos que já existem.
5. Assets finais (tiles, personagens, sons) substituindo os procedurais.
6. Decidir a regra pós-vacina e a simulação com servidor vazio.

---

## 5. Relatório de testes

Executados neste ambiente (Node 22, Chromium headless). Comandos na seção "Testes" do README.

### 5.1 Integração — `tests/etapa3.test.ts` — **24/24**
Os testes de multijogador sobem um **servidor real (HTTP + WebSocket)** e conectam **clientes reais**.

| # | Exigência | Resultado (exemplo de execução) |
|---|---|---|
| 1 | Criar um mundo | anfitrião "Ana", modalidade DUO, mundo recebido (~470 KB), snapshots, save em disco |
| 2 | Outros jogadores entram | Beto entrou como Rafael Moura; o lobby mostra os donos de vaga |
| 3 | Vagas vazias com NPCs | DUO: 2 personagens da IA agindo; SOLO: 1 humano + 3 IA |
| 4 | IA assume desconectado | Beto saiu → IA assumiu e bebeu água do inventário (4 → 3 goles) |
| 5 | Retomar o controle | reconectou com o mesmo nome e reassumiu onde a IA deixou |
| 6 | Inventário após reconexão | itens idênticos (uid/qtd/estado) no servidor e no cliente; o gasto da IA permaneceu |
| 7 | Mundo preserva o progresso | saque por ação de rede; cliente recebeu o recipiente atualizado |
| 8 | Rádio só quando utilizável | sem rádio / sem bateria / desligado recusados; outro canal não recebe |
| 9 | Aliados não aparecem | posição de quem está longe não é enviada; resposta da IA por rádio só em palavras |
| 10 | Mapas incompletos combinados | mapa do Sul rasgado (3/15) + 2 pedaços achados no mundo → completo; marcação salva |
| 11 | NPCs lembram | Lúcia ignorada por 3 h → ressentimento e fala nova; quem não interagiu não mudou |
| 12 | Facções respondem | troca justa +3; agressão −25 e NPC hostil; invadir o comando da Sentinela → hostil |
| 13 | Captura | voz de prisão, rendição, cela trancada, itens no depósito de apreensões |
| 14 | Fuga ou resgate | fuga com grampo do colchão; amigo com a chave solta João, que foge para a Aurora |
| 15 | Zumbis e barulho | vagar → investigar após disparo a 12 m |
| 16 | Hordas coerentes | horda segue para uma cidade, membros acompanham; disparo próximo muda o destino |
| 17 | Combustível | consome ao dirigir; tanque seco desliga o motor |
| 18 | Morrer e voltar | voltou em outro ponto só com a roupa do corpo |
| 19 | Equipamento após a morte | rifle, munição e mochila no corpo, mesmos uids |
| 20 | NPC saqueia cadáver | Beto pegou o rifle (mesmo uid); missão "Equipamento saqueado"; ao morrer, o rifle ficou no corpo dele |
| 21 | Campanha compartilhada | capítulo 1 → 2 recebido pelos dois clientes |
| 22 | Consequências | antibiótico para Dona Célia: missão concluída, reputação e remédios sobem; pedido de Beto ignorado: missão fracassada e ressentimento |
| 23 | Dados após reinício | capítulo, saque, inventários, marcações e donos de vaga preservados; 2º save grava só seções alteradas; manifesto corrompido → recuperado do backup |
| 24 | Etapas 1 e 2 | Etapa 2: 34/34; IA da Etapa 1 e itens: ok |

Observação: o teste 7 falhou 1 vez em 3 numa versão anterior por uma espera mal escrita no próprio teste (verificava o snapshot antigo); a espera foi corrigida e as execuções seguintes passaram.

### 5.2 Campanha completa — `tests/campanha.test.ts` — **10/10 capítulos**
Modo SOLO (1 humano + 3 IA). Itens retirados dos recipientes onde o mundo os colocou; viagens do jogador por teletransporte (para o teste não levar horas); os sobreviventes da IA **acharam rádios sozinhos**, responderam pelo rádio e **atravessaram o mapa a pé** até o ponto de encontro dito na transmissão ("Santa Aurora").

### 5.3 Navegador — `tests/e2e-etapa3.mjs` — **13/13**, sem erros no console
Menu (SOLO e Multijogador), diário, fala local, conversa com NPC (emoções e postura), tela de troca, mapa regional molhado com marcação, rádio pela interface (recusa sem rádio, transmite com rádio), rendição e prisão com o jogo continuando, ausência de minimapa/radar/GPS; **dois navegadores no servidor real**: lobby, escolha de personagens, início, movimento validado pelo servidor, fala local que não alcança quem está longe, saída de um jogador com a IA assumindo (visível no diário do outro).

### 5.4 Regressão das Etapas 1 e 2
- Navegador, Etapa 1: **21/21** (um critério do teste — "zumbis se aproximam" — media a média de *todos* os zumbis que ouviram qualquer barulho; no mundo maior há outros ruídos acontecendo, então passou a medir os **mesmos** zumbis que ouviram o disparo).
- Navegador, Etapa 2: **12/12**. Lógica da Etapa 2: **34/34**. IA dos zumbis e itens: ok.

### 5.5 Desempenho medido
- Geração do mundo: ~70–80 ms. Simulação SOLO: ~0,2–0,3 ms por passo (≈ 25 zumbis ativos de 496).
- Servidor com 2 jogadores em regiões diferentes: ~1,5–3 ms por passo a 60 Hz (115 zumbis ativos, 381 dormentes).
- Renderização (Etapa 1, Chromium headless): ~4 ms por quadro.

### 5.6 Não testado
- 4 jogadores humanos simultâneos pela internet (testado: 2 navegadores + 2 clientes Node em rede local).
- Partidas longas reais (dias de jogo) com pessoas — os testes automatizados aceleram o tempo.
