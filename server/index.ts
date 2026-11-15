import { CONFIG } from '../src/config';
import type { Mode } from '../src/net/protocol';
import { startServer } from './app';

/**
 * Servidor dedicado de O Último Amanhecer.
 *   npm run server -- --port 8787 --data server/data --nome "Meu mundo" --modo DUO
 * Serve o jogo (pasta dist/, após `npm run build`) e a partida em ws://<host>:<porta>/ws.
 * O mundo fica salvo em --data e sobrevive a reinícios e quedas.
 * --simular-vazio mantém o mundo andando sem ninguém conectado (padrão: suspenso).
 */
const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
if (process.argv.includes('--simular-vazio')) CONFIG.world.simulateWhenEmpty = true;
const srv = startServer({
  port: Number(arg('port', String(CONFIG.multiplayer.port))),
  dataDir: arg('data', 'server/data'),
  distDir: arg('dist', 'dist'),
  worldName: arg('nome', 'Mundo de O Último Amanhecer'),
  mode: arg('modo', 'QUARTETO') as Mode,
  seed: Number(arg('semente', String(CONFIG.seed + 7))),
});
const shutdown = async () => {
  console.log('[servidor] salvando antes de sair…');
  await srv.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
