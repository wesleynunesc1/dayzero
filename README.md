# O Último Amanhecer

Survival 2D top-down pós-apocalíptico, cooperativo para 1 a 4 jogadores, em mundo aberto persistente.
Tudo em português do Brasil. Arte e sons são **provisórios, originais e gerados pelo próprio código**.

- **Etapa 1** — bairro explorável, infectados com IA (visão, audição, perseguição, busca), ruído com propagação física, combate, ferimentos, inventário com peso, NPC aliado, mapa de papel, morte com corpo saqueável.
- **Etapa 2** — fome, sede, energia/sono, caminhonete com gasolina, crafting, abrigo com barricadas, clima, dia/noite e salvamento. Veja `ETAPA02.md`.
- **Etapas 3–5** — mundo de 512×384 tiles com 4 regiões e cidades, mapas físicos, NPCs com memória e emoções, facções, captura e prisão, rádio, campanha de 10 capítulos, missões secundárias e **multijogador com servidor autoritativo**. Veja `ETAPAS-3-5.md` (inclui o relatório de testes e as limitações).

---

## Como executar

Requer **Node.js 22** ou superior (o servidor e os testes usam o WebSocket nativo do Node).

```bash
npm install
```

### Jogar sozinho (SOLO, offline)
- Sem instalar nada: abra `jogar-offline/o-ultimo-amanhecer.html` no navegador → **Novo mundo — SOLO**.
- Ou, em desenvolvimento: `npm run dev` e abra http://localhost:5173.

No SOLO você controla 1 sobrevivente e a IA controla os outros 3, cada um começando numa região.

### Multijogador (1 a 4 jogadores)
No computador que vai **hospedar o mundo**:

```bash
npm run build                                   # gera dist/ (o servidor serve o jogo daqui)
npm run server -- --nome "Meu mundo" --modo DUO # porta 8787, mundo salvo em server/data/
```

Cada jogador abre `http://<ip-do-anfitrião>:8787` → **Multijogador** → digita o nome → **Conectar** →
escolhe um sobrevivente. Quem conectou primeiro é o anfitrião: escolhe a modalidade e clica em **Iniciar campanha**.

| Modalidade | Humanos | IA |
|---|---|---|
| SOLO | 1 | 3 |
| DUO | 2 | 2 |
| TRIO | 3 | 1 |
| QUARTETO | 4 | 0 |

- **Voltar ao seu personagem:** conecte com o mesmo nome. Enquanto você estiver fora, a IA controla o seu sobrevivente (e o que ela gastar ou encontrar fica).
- **O mundo continua salvo** em `server/data/` (escrita atômica, backup do manifesto e gravação incremental). Desligar com Ctrl+C salva antes de sair.
- `--simular-vazio` mantém o mundo andando sem ninguém conectado (padrão: suspenso — regra ainda em aberto).
- Opções: `--port 8787 --data server/data --nome "..." --modo SOLO|DUO|TRIO|QUARTETO --semente 1337`.
- Situação do servidor (JSON): `http://localhost:8787/status`.

### Testes

```bash
npm run typecheck      # TypeScript estrito
npm test               # 24 testes de integração (servidor real) + campanha completa (10 capítulos)
npm run test:etapa2    # Etapas 1 e 2 (lógica)
npm run test:e2e       # navegador (requer Playwright + Chromium; o teste da Etapa 3 sobe o servidor sozinho)
```

---

## Controles

| Tecla | Ação |
|---|---|
| W A S D | Movimentar (dirigindo: acelerar/frear/esterçar) |
| Shift | Correr (gasta fôlego, faz barulho) |
| C | Agachar / levantar |
| E | Interagir: portas, recipientes, corpos, NPCs, veículos, gerador, bancada, estação de rádio, socorrer amigo |
| I · H · F | Inventário · condição física · fabricar |
| M | Mapa de papel (só se tiver um). Clique marca, botão direito apaga |
| Enter ou T | Falar (perto), gritar (faz barulho) ou transmitir pelo rádio |
| J | Diário: capítulo, objetivos, missões secundárias, grupo e reputação |
| 1–8 | Escolher opção numa conversa |
| R | Recarregar |
| Mouse | Mirar · botão esquerdo ataca · botão direito mira firme |
| Esc | Pausar / fechar janelas |
| F3 | Desempenho |

Não há minimapa, radar, GPS, marcador de aliados, chat global nem cronômetro de campanha.

---

## Estrutura

```
src/
  config.ts             todos os parâmetros ajustáveis (infecção pós-vacina, rádio, facções, multijogador…)
  world/                WorldGen (mundo, regiões, cidades), BuildKit, MapBuilder (bairro da Etapa 1), TileMap, World
  entities/             Player (4 sobreviventes), Npc, Ally, Zombie, Vehicle
  systems/              simulação: Simulation, WorldSim (regiões/hordas), ZombieAI, NpcAI, Social, Factions,
                        Prison, Radio, Missions (campanha + secundárias), SurvivorBot (IA de vaga), Save,
                        Combat, Health, Needs, Interaction, ItemActions, VehicleSystem, Crafting, Weather…
  net/                  protocolo, GameServer (autoritativo), Sync (snapshots/interesse), Actions, NetClient
  ui/                   UI, Panels (NPC, troca, fala/rádio, diário), MapView (mapas de papel)
  render/               renderizador Canvas 2D (chunks em cache, LRU, iluminação, neblina de guerra)
server/                 servidor Node: HTTP + WebSocket (RFC 6455) + FileStore (persistência)
tests/                  etapa2, ai, items, etapa3 (24 integrações), campanha, e2e de navegador
```

Tecnologia: TypeScript + Vite e motor próprio em Canvas 2D (o Phaser não pôde ser instalado no ambiente
de desenvolvimento original, sem acesso ao npm; a arquitetura separa simulação e renderização, então a troca
de renderizador continua possível).
