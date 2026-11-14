import { Game } from './game/Game';

/**
 * O Último Amanhecer — Etapa 01.
 * Ponto de entrada: cria o jogo dentro de #app.
 */
const root = document.getElementById('app') ?? document.body;
const game = new Game(root);

// API de depuração/testes automatizados (somente leitura para o jogador comum).
(window as unknown as { __oua: ReturnType<Game['debugApi']> }).__oua = game.debugApi();
