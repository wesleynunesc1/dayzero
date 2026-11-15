import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { CONFIG } from '../src/config';
import { GameServer } from '../src/net/GameServer';
import type { ClientMsg, Mode } from '../src/net/protocol';
import { FileStore } from './FileStore';
import { acceptUpgrade } from './ws';

/**
 * Servidor dedicado de O Último Amanhecer.
 *   npm run server -- --port 8787 --data server/data --nome "Meu mundo" --modo DUO
 * Serve o jogo (pasta dist/, após `npm run build`) e a partida em ws://<host>:<porta>/ws.
 * O mundo fica salvo em --data e sobrevive a reinícios e quedas.
 */
export interface ServerOptions {
  port: number;
  dataDir: string;
  distDir?: string;
  worldName?: string;
  mode?: Mode;
  seed?: number;
  quiet?: boolean;
}

export function startServer(o: ServerOptions) {
  const log = (...a: unknown[]) => !o.quiet && console.log(...a);
  const dataDir = path.resolve(o.dataDir);
  const distDir = path.resolve(o.distDir ?? 'dist');
  const store = new FileStore(dataDir);
  const game = new GameServer(store, { worldName: o.worldName ?? 'Mundo de O Último Amanhecer', mode: o.mode ?? 'QUARTETO', seed: o.seed ?? CONFIG.seed + 7 });
  log(`[servidor] mundo "${game.room.worldName}" (${game.room.mode}) — ${game.room.started ? 'campanha em andamento' : 'aguardando início'} — dados em ${dataDir}`);
  const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (url === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ...game.lobbyState(null), stats: game.stats, conexoes: game.sessions.size, desempenho: { simMs: game.sim.stepMs, zumbisAtivos: game.sim.worldSim.stats.active, zumbisDormentes: game.sim.worldSim.stats.dormant } }));
      return;
    }
    const f = path.join(distDir, url === '/' ? 'index.html' : url);
    if (!f.startsWith(distDir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404);
      res.end('Não encontrado. Rode "npm run build" para gerar a pasta dist/.');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  let nextId = 1;
  const sockets = new Set<{ close(): void }>();
  srv.on('upgrade', (req, sock) => {
    const ws = acceptUpgrade(req, sock);
    if (!ws) return;
    sockets.add(ws);
    const id = nextId++;
    game.connect({ id, send: (m) => ws.send(JSON.stringify(m)), close: () => ws.close() });
    ws.onMessage = (t) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(t);
      } catch {
        return;
      }
      game.handle(id, msg);
    };
    ws.onClose = () => {
      sockets.delete(ws);
      game.disconnect(id);
    };
  });
  const STEP = 1 / CONFIG.multiplayer.tickRate;
  let last = performance.now();
  let acc = 0;
  const loop = setInterval(() => {
    const now = performance.now();
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    while (acc >= STEP) {
      game.tick(STEP);
      acc -= STEP;
    }
  }, 1000 / CONFIG.multiplayer.tickRate);
  const ready = new Promise<void>((r) => srv.listen(o.port, () => r()));
  ready.then(() => log(`[servidor] http://localhost:${o.port}  (WebSocket em /ws)`));
  return {
    game,
    store,
    ready,
    /** Para o servidor salvando o mundo antes. `crash` simula uma queda (sem salvar). */
    close(crash = false) {
      clearInterval(loop);
      if (!crash) game.saveNow();
      for (const s of sockets) s.close();
      return new Promise<void>((r) => srv.close(() => r()));
    },
  };
}
