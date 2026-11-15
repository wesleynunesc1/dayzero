# O Último Amanhecer — Adaptação para celular (Android e iPhone pelo navegador)

O jogo existente foi adaptado para ser jogado no navegador do celular, sem recriar nada:
o mesmo código, a mesma simulação e o mesmo servidor. No computador nada muda (teclado e
mouse continuam iguais); no celular aparecem controles de toque, uma interface compacta e
ajustes próprios. Os dois modos trocam sozinhos conforme o tipo de toque/ponteiro usado.

## Como abrir no celular

1. Abra o endereço publicado do jogo no **Chrome (Android)** ou no **Safari (iPhone)**.
   O endereço precisa ser **HTTPS** (tela cheia, instalação como app e áudio dependem disso).
2. Gire o aparelho para **horizontal**. Na vertical aparece um aviso amigável com a opção
   “Jogar assim mesmo”.
3. Toque em **Novo mundo — SOLO**. Opcional: ⛶ para tela cheia (Android; no iPhone o Safari
   não permite tela cheia em páginas — use “Compartilhar › Adicionar à Tela de Início”, que
   abre o jogo sem as barras do navegador).
4. **Multijogador**: o servidor (`npm run server`) precisa estar acessível pela internet com
   HTTPS na frente (proxy reverso, ex.: Caddy/Nginx). Quando a página está em HTTPS, o jogo
   já sugere `wss://` no lobby — o navegador bloqueia `ws://` em páginas seguras.

Também dá para testar na rede de casa: `npx vite --host` no computador e abrir
`http://IP-do-computador:5173` no celular (sem HTTPS a tela cheia e a instalação podem não
funcionar, o resto funciona).

## Controles de toque

| Controle | Função |
|---|---|
| Joystick esquerdo (flutuante, metade esquerda da tela) | Andar em 360°, analógico (pouca inclinação = devagar), zona morta configurável, volta ao centro ao soltar |
| Joystick direito (metade direita) | Mirar. Ao soltar, a direção fica. Sem mira, o personagem olha para onde anda. **Sem mira automática** |
| 🎯 Disparar | Atira enquanto segura (equipa a arma de fogo da mochila se for preciso). **Sem disparo automático** |
| 🔪 Golpe | Ataque corpo a corpo (troca para a arma branca) |
| ⟳ Recarregar · 🏃 Correr (segurar) · 🧎 Agachar (alternar) | — |
| ✋ Interagir (rótulo muda: “Abrir porta”, “Revistar armário”…) + ⇄ | Interage com o alvo marcado; ⇄ escolhe entre vários alvos próximos |
| Barra superior: ☰ 🎒 🗺 📻 💬 📖 ⛶ ⚙ | Pausa/salvar · inventário · mapa físico · rádio · falar · diário · tela cheia · ajustes |
| No veículo: joystick esterça, ⬆ Acelerar, ⬇ Frear/ré, ✋ Sair | Gasolina sempre visível no HUD |

Mover, mirar e atirar funcionam ao mesmo tempo (multitoque real com Pointer Events, cada
dedo independente). Ao trocar de aba, girar a tela ou perder o foco, todos os controles são
soltos — nada fica “preso” apertado.

Regras preservadas: 🗺 fica desligado sem um mapa físico na mochila (não há minimapa);
📻 só fica ativo com um rádio e abre no modo rádio (não há chat global).

## Interface no celular

- HUD discreto e compacto: vida, fome, sede, energia, fôlego, arma, munição, peso (e gasolina no carro).
- Inventário em tela cheia com rolagem por toque, linhas maiores, painel de detalhes com
  botões grandes (equipar, consumir, beber, largar, transferir, examinar), peso e capacidade
  respeitados. Toques repetidos rápidos são ignorados por um instante: **não há duplicação**
  nem ação no item errado quando a lista muda de lugar. Fechar com ✕.
- Mapa físico: toque marca; “Apagar” no seletor substitui o botão direito do mouse.
- Textos de ajuda mostram os botões de toque em vez das teclas.
- Áreas seguras (entalhe/“notch”, barra inferior do iPhone) respeitadas.

## Ajustes (⚙, salvos no aparelho)

Tamanho dos botões · transparência · inverter lados · sensibilidade do joystick · zona
morta · sensibilidade da mira · qualidade gráfica **BAIXO / MÉDIO / ALTO** (padrão no celular: MÉDIO).

## Câmera e desempenho

- A imagem preenche a tela mantendo a proporção. Telas mais largas **ampliam mais em vez de
  mostrar mais mundo** (sem vantagem para quem tem tela larga).
- BAIXO: desenha direto na resolução de jogo e deixa o navegador ampliar (sem neblina com
  desfoque, metade das partículas, chuva mais leve, sem dessaturação). MÉDIO: densidade de
  pixels limitada a 1,5. ALTO: até 2.
- Medido em emulação (Chromium, perfil Pixel 7, mundo completo com 496 zumbis):

| Qualidade | CPU normal | CPU 4× mais lenta (simula celular modesto) |
|---|---|---|
| ALTO | 60 FPS (render 4,7 ms) | 31 FPS (render 18,1 ms) |
| MÉDIO | 60 FPS (render 5,4 ms) | 41 FPS (render 18,1 ms) |
| BAIXO | 60 FPS (render 3,1 ms) | 53 FPS (render 11,2 ms) |

Memória JS ≈ 28 MB. **São medições em emulação, não garantia em aparelho real.**

## Correções de navegador móvel

Sem rolagem/“puxar para atualizar”, sem zoom de pinça ou duplo toque, sem seleção de texto
nem menu de toque longo; coordenadas recalculadas após girar/redimensionar; áudio
destravado no primeiro toque (exigência do iOS/Chrome); pausa automática e **salvamento
automático** ao ir para segundo plano, trocar de aba ou fechar (`visibilitychange`/`pagehide`),
com “Continuar” ao voltar; tela cheia só aparece onde o navegador suporta; manifesto de
web app e ícones (instalável na tela inicial).

## Testes (20 cenários pedidos + 1 extra) — `tests/e2e-mobile.mjs`

Executados em **emulação** no Chromium (perfis Pixel 7 e iPhone 14 do Playwright), com toques
multitoque reais enviados pelo protocolo do navegador (`Input.dispatchTouchEvent`).
Resultado: **21/21 passaram**. Capturas em `tests/capturas/mobile-*.png`.

| # | Cenário | Resultado |
|---|---|---|
| 1 | Android (Pixel 7 emulado): detecção de toque e início | ✅ emulação |
| 2 | iPhone (iPhone 14 emulado no Chromium): detecção, joystick, áreas seguras | ✅ emulação · **Safari real pendente** |
| 3 | Joystick analógico 360°, zona morta, volta ao centro | ✅ |
| 4 | Correr (segurar) e agachar (alternar) | ✅ |
| 5 | Mirar e atirar andando (multitoque, sem mira/disparo automáticos) | ✅ |
| 5b | Golpe corpo a corpo | ✅ |
| 6 | Recarregar | ✅ |
| 7 | Abrir porta pelo botão contextual | ✅ |
| 8 | Entrar em imóvel | ✅ |
| 9 | Vasculhar armário | ✅ |
| 10 | Coletar comida e água | ✅ |
| 11 | Inventário: abrir, selecionar, consumir, fechar, sem duplicar | ✅ |
| 12 | Item médico (bandagem) | ✅ |
| 13 | Mapa físico: desligado sem item, abre com ele | ✅ |
| 14 | Rádio: só com rádio, modo rádio | ✅ |
| 15 | Dirigir: entrar, acelerar, esterçar, frear, sair | ✅ |
| 16 | Consumo de combustível visível | ✅ |
| 17 | Salvar e continuar | ✅ |
| 18 | Fechar a aba e reabrir | ✅ |
| 19 | Girar a tela (aviso, alternativa, enquadramento) | ✅ |
| 20 | FPS e memória | ✅ medido em emulação |

As baterias anteriores continuam passando: navegador desktop Etapa 1 (21/21), Etapa 2 (12/12),
Etapa 3 com servidor real (13/13); integração 24/24; Etapa 2 lógica 34/34; campanha completa 10/10.

**Pendente (exige aparelho físico — não foi feito):** Chrome em Android real, Safari em iPhone
real e medição de FPS/memória/temperatura/bateria em aparelho. Emulação não reproduz a GPU,
o Safari (WebKit) nem o comportamento real de toque/teclado virtual.

## Limitações conhecidas

- iPhone: o Safari não oferece tela cheia nem trava de orientação para páginas; use
  “Adicionar à Tela de Início”. O botão ⛶ só aparece onde funciona.
- Digitar (falar/rádio) abre o teclado do sistema, que cobre parte da tela.
- O multijogador exige o servidor Node publicado com HTTPS/`wss://`; hospedagem estática
  (como GitHub Pages) serve só o modo SOLO e a área demonstrativa.
- Desempenho em celulares muito antigos não foi medido: comece em BAIXO se travar.

## Arquivos

Novos: `src/ui/TouchControls.ts` (joysticks, botões, multitoque, detecção, ajustes salvos),
`src/ui/MobileUI.ts` (CSS responsivo, aviso de orientação, painel de ajustes),
`public/manifest.webmanifest` e ícones, `tests/e2e-mobile.mjs`, `MOBILE.md`.

Alterados: `index.html` (viewport, metatags de web app, manifesto), `src/game/Game.ts`
(modo toque, comandos de toque → mesmo `PlayerCommand`, ações da barra, tela cheia,
segundo plano/salvamento, qualidade), `src/render/Renderer.ts` (enquadramento proporcional,
predefinições de qualidade), `src/ui/UI.ts` (ajuda de toque, inventário à prova de toques
repetidos, mapa por toque, `wss://` em HTTPS, botão Ajustes), `src/engine/Audio.ts`
(destravar áudio), `src/systems/Interaction.ts` + `PlayerController.ts` + `World.ts` +
`net/GameServer.ts` (escolha entre vários alvos de interação, validada no servidor).
