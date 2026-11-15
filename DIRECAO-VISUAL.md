# O Último Amanhecer — Nova direção visual (2D, vista de cima com leve perspectiva)

Reformulação **somente da camada visual**. Movimento, colisões, combate, inventário, fome/sede,
IA dos zumbis, ruído, veículos, combustível, missões, salvamento e multijogador não foram alterados
(as suítes de teste das Etapas 1, 2 e 3–5 continuam passando).

## Análise do que existia
- Motor próprio em Canvas 2D (o projeto não usa Phaser; ver README).
- Renderização em baixa resolução (tile de 16 px) ampliada por fator inteiro (~15 tiles de altura na tela).
- Chão e paredes em "chunks" estáticos em cache; telhados como chapas planas vistas de cima.
- Personagens desenhados **de cima** (cabeça redonda vista do alto), ~16 px de largura.
- Iluminação com camada ambiente escura de dia (18%) e de noite (até 82%), neblina de visão em 62% e
  vinheta forte, mais dessaturação — daí o aspecto escuro e pouco definido.

## O que mudou
| Área | Antes | Agora |
|---|---|---|
| Perspectiva | puramente de cima | 3/4: fachadas visíveis, telhados com volume, objetos com altura, ordenação por profundidade (Y da base) |
| Personagens | vistos do alto | sprites 3/4 em 4 direções: cabeça, pescoço, tronco com ombros, braços, pernas, sapatos, cabelos variados, mochila (de costas, de lado e alças de frente), contorno de 1 px; caminhada, corrida (passada maior e inclinação), ataque corpo a corpo em arco, mira com as duas mãos, soco, agachado, caído |
| Zumbis | mesma base vista do alto | mesma anatomia dos sobreviventes, pele acinzentada, roupas rasgadas e sangue, olhos leitosos, cambaleio, braços estendidos ao perseguir/atacar, corredores com animação rápida, rastejantes deitados |
| Construções | chapa de telhado | telhado de quatro águas (planos com luz diferente, espigões, cumeeira, calha, chaminé, musgo, telhas faltando, buracos) ou laje com platibanda e condensadoras; **fachada** com revestimento (reboco, tijolo, sidings), trepadeiras, rachaduras, placas (MERCANTIL, FARMÁCIA, POLÍCIA, HOSPITAL…), janelas e portas no estado real do mapa (quebrada, com tábuas, aberta, arrombada), degrau |
| Interiores | — | telhado e fachada somem ao entrar (como antes); pisos e paredes mais claros |
| Vegetação | copas planas | frondosas com volume e brilhos, pinheiros em camadas (predominam na serra ao norte), árvores secas, sebes com altura, flores silvestres, tufos de capim, capim seco, mato nas rachaduras, grama invadindo calçadas |
| Terreno | ruído escuro | paleta natural; terra com manchas arredondadas; rocha em blocos com face de penhasco; água com reflexos; manchas grandes de cor quebrando a repetição |
| Veículos | vistos de cima | carroceria elevada com lateral e rodas visíveis |
| Cercas e postes | linhas finas | cerca de tábuas com altura e pilares, alambrado, poste alto com luminária |
| Luz | escura de dia | dia claro (ambiente 2%), sombras suaves; entardecer dourado; noite azulada legível (máx. 66%) com luz ao redor do personagem, lanternas e fogo |
| Neblina de visão | 62% escura | 20% de dia, até 45% à noite, borda suave; telhados não são escurecidos |

## Padrões
- **Tile:** 16 × 16 px de arte. **Personagem:** ≈ 27 px de altura (≈ 1,7 tile, escala `CHAR_SCALE = 1.12`), pés na base do círculo de colisão.
- **Fachada:** `FACADE_H = 30` px; telhado sobe `ROOF_RISE = 10` px acima da planta.
- **Luz:** vem de cima/esquerda (realces à esquerda, sombras à direita e embaixo); sombras projetadas para sudeste.
- **Contorno:** 1 px escuro em personagens e copas.
- **Paleta:** verdes naturais (#5e8a3e–#86b860), terra (#8a7050), asfalto (#525458), calçada (#a8a296), telhados conforme o prédio; cores pós-apocalípticas por desgaste (musgo, ferrugem, manchas), não por escurecimento geral.
- Tudo é **original e gerado por código** (`src/render/Art.ts`, `Textures.ts`, `Sprites.ts`); nada foi copiado de outros jogos.

## Área demonstrativa
Menu inicial → **Área demonstrativa (visual)**: a casa do bairro com fachada e telhado detalhados, rua, calçadas,
árvores, arbustos e sebes, cercas, personagem animado, dois infectados vagando, carro abandonado na garagem,
às 10h com céu limpo. É o jogo de verdade (mesmos sistemas), num recorte calmo.

## Limitações honestas
- As imagens de referência não chegaram anexadas ao pedido; a direção foi construída a partir da descrição escrita.
  Para comparar lado a lado com a "Imagem 1", é preciso enviá-la.
- É pixel art procedural: bem mais rica que antes, mas não equivale a sprites desenhados à mão por um artista.
  A arquitetura (funções de desenho isoladas por tipo) permite trocar por spritesheets finais sem mexer nos sistemas.
- Objetos de interior e alguns adereços (barris, caixas) continuam no estilo anterior, apenas mais claros.
- Fachadas mostram só o lado sul (o voltado para a câmera); paredes laterais aparecem pela borda do telhado.
