// Etapas 3–5 — teste de ponta a ponta no NAVEGADOR (interface real + multijogador real).
// Requer: playwright + Chromium, `npm run build` (gera dist/), e o servidor é iniciado pelo próprio teste.
// Uso: node tests/e2e-etapa3.mjs     (variáveis: PW=caminho do playwright, CHROME=executável, SHOTS=pasta)
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
const PW = process.env.PW || 'playwright';
const { chromium } = await import(PW);
const SHOTS = process.env.SHOTS || './tests/capturas';
fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 8790;
const DATA = `/tmp/oua-e2e3-${process.pid}`;
fs.rmSync(DATA, { recursive: true, force: true });
const W = 1280, H = 720;
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];
const ok = (n, name, pass, info = '') => { results.push({ n, name, pass }); console.log(`${pass ? 'PASSOU' : 'FALHOU'}  ${String(n).padStart(2)} ${name} ${info}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
async function newPage() {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  return page;
}

// servidor real (serve o jogo da pasta dist/ e a partida via WebSocket)
let server;
process.on('exit', () => { try { server.kill('SIGKILL'); } catch {} });
process.on('uncaughtException', (e) => { console.error(e); try { server.kill('SIGKILL'); } catch {} process.exit(1); });
server = spawn('npx', ['tsx', 'server/index.ts', '--port', String(PORT), '--data', DATA, '--modo', 'DUO', '--nome', 'Mundo do teste'], { stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
for (let i = 0; i < 60 && !serverLog.includes('http://localhost'); i++) await wait(250);

// ===================================================================== SOLO (offline)
const page = await newPage();
await page.goto(`http://localhost:${PORT}/`);
await wait(900);
const ev = (fn, arg) => page.evaluate(fn, arg);
const titleBtns = await page.$$eval('#title button', (bs) => bs.map((b) => b.textContent));
await page.click('[data-a=start]');
await wait(500);
ok(1, 'Menu inicial com SOLO e Multijogador; partida SOLO inicia', titleBtns.some((t) => t.includes('Multijogador')) && (await ev(() => window.__oua.game.state)) === 'playing' && (await ev(() => window.__oua.world.players.filter((p) => p.controller === 'ia').length)) === 3, titleBtns.join(' | '));
await ev(() => { window.__oua.game.timeScale = 0; });

// diário
await page.keyboard.press('KeyJ');
await wait(200);
const jtxt = await page.$eval('#journal', (e) => e.textContent);
await page.screenshot({ path: `${SHOTS}/e3-01-diario.png` });
ok(2, 'Diário (J): capítulo, missões secundárias, grupo, reputação', /Capítulo 1/.test(jtxt) && /Missões secundárias/.test(jtxt) && /Reputação/.test(jtxt) && /não mostra onde/.test(jtxt));
await page.keyboard.press('Escape');
await wait(150);

// fala local
await page.keyboard.press('Enter');
await wait(150);
await page.keyboard.type('Tem alguém aí?');
await page.keyboard.press('Enter');
await wait(200);
const log1 = await page.$eval('#log', (e) => e.textContent);
ok(3, 'Falar (Enter) — só quem está perto ouve', log1.includes('Você: Tem alguém aí?'));

// conversa com NPC (Lúcia)
await ev(() => { const a = window.__oua; const n = a.world.npcs.find((x) => x.key === 'lucia'); a.teleport(n.x / 16 + 1.2, n.y / 16); const p = a.world.player; p.facing = Math.PI; p.aimX = n.x; p.aimY = n.y; a.world.zombies = a.world.zombies.filter((z) => Math.hypot(z.x - p.x, z.y - p.y) > 40 * 16); a.game.sim.worldSim.refreshCells(); a.interact(); });
await wait(400);
const dlg1 = await page.$eval('#npcdlg', (e) => (e.classList.contains('hidden') ? '' : e.textContent));
await page.click('#npcdlg button[data-o=historia]');
await wait(300);
const dlg2 = await page.$eval('#npcdlg', (e) => e.textContent);
await page.screenshot({ path: `${SHOTS}/e3-02-npc-dialogo.png` });
ok(4, 'Conversar com NPC (emoções, postura, história)', /Lúcia/.test(dlg1) && /Medo/.test(dlg1) && /Enfermeira/i.test(dlg2), dlg2.slice(0, 120));
await page.keyboard.press('Escape');
await wait(150);
await wait(100);

// troca com NPC
await page.evaluate(() => { const a = window.__oua; a.give('feijao_lata', 2); const n = a.world.npcs.find((x) => x.key === 'lucia'); a.teleport(n.x / 16 + 1, n.y / 16); a.world.player.facing = Math.PI; a.interact(); });
await wait(300);
await page.click('#npcdlg button[data-o=trocar]');
await wait(200);
const tradeVisible = await page.$eval('#trade', (e) => !e.classList.contains('hidden'));
await page.screenshot({ path: `${SHOTS}/e3-03-troca.png` });
ok(5, 'Tela de troca com NPC', tradeVisible);
await page.keyboard.press('Escape');
await wait(150);

// mapa regional (estado do papel) + marcação manual
await ev(() => { const a = window.__oua; const it = a.give('mapa_regional'); const m = a.world.player.inv.items.find((i) => i.defId === 'mapa_regional'); m.state = { region: 'norte', cond: 'molhado', pieces: 15 }; });
await page.keyboard.press('KeyM');
await wait(400);
const box = await page.$eval('#mapview canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.$$eval('#maptools button[data-map]', (bs) => bs[bs.length - 1].click());
await wait(300);
await page.mouse.click(box.x + box.w * 0.4, box.y + box.h * 0.5);
await wait(300);
const markers = await ev(() => window.__oua.world.player.markers.length);
await page.screenshot({ path: `${SHOTS}/e3-04-mapa-regional.png` });
ok(6, 'Mapa regional molhado + marcação manual salva no personagem', markers === 1);
await page.keyboard.press('Escape');
await wait(150);

// rádio: só funciona quando encontrado e utilizável
await page.keyboard.press('Enter');
await page.selectOption('#talk select', 'radio');
await page.keyboard.type('Alguém na escuta?');
await page.keyboard.press('Enter');
await wait(200);
const log2 = await page.$eval('#log', (e) => e.textContent);
await ev(() => { const a = window.__oua; a.give('radio'); a.give('pilhas'); a.itemAction('batteries', 'radio'); a.step(1.5); a.itemAction('toggle', 'radio'); });
await page.keyboard.press('Enter');
await page.selectOption('#talk select', 'radio');
await page.keyboard.type('Base Sentinela, câmbio');
await page.keyboard.press('Enter');
await wait(200);
const log3 = await page.$eval('#log', (e) => e.textContent);
ok(7, 'Rádio pela interface: sem rádio recusa; com rádio transmite', /não tem um rádio/.test(log2) && /📻 \[Canal 1\] Você: Base Sentinela/.test(log3));

// captura e prisão (não é tela de espera)
await ev(() => { const a = window.__oua; const n = a.world.npcs.find((x) => x.key === 'navalha'); a.teleport(n.x / 16 + 1.5, n.y / 16); const p = a.world.player; p.facing = Math.PI; p.aimX = n.x; p.aimY = n.y; a.world.zombies = a.world.zombies.filter((z) => Math.hypot(z.x - p.x, z.y - p.y) > 60 * 16); a.game.sim.worldSim.refreshCells(); a.step(1.2); const m = a.world.npcs.find((x) => x.key === 'navalha'); a.teleport(m.x / 16 + 1, m.y / 16); a.world.player.facing = Math.PI; a.interact(); });
await wait(300);
const dlgNav = await page.$eval('#npcdlg', (e) => e.className + ' ' + e.textContent.slice(0, 160));
const hasSurrender = await page.$('#npcdlg button[data-o=render]');
if (hasSurrender) await hasSurrender.click();
await wait(300);
await ev(() => { window.__oua.game.timeScale = 1; });
await wait(600);
const captive = await ev(() => window.__oua.world.player.captive);
const banner = await page.$eval('#captive', (e) => (e.classList.contains('hidden') ? '' : e.textContent));
await page.screenshot({ path: `${SHOTS}/e3-05-prisao.png` });
ok(8, 'Render-se → preso na cela, com aviso e jogo continuando', !!captive && /Preso por Os Abutres/.test(banner) && (await ev(() => window.__oua.game.state)) === 'playing', banner || dlgNav + ' render=' + !!hasSurrender + ' log=' + (await page.$eval('#log', (e) => e.textContent)).slice(-200));

// sem minimapa/radar/GPS e sem marcador de aliados
const hudTxt = await page.$eval('#ui', (e) => e.textContent);
const canvases = await page.$$eval('canvas', (cs) => cs.filter((c) => c.getBoundingClientRect().width > 0 && c.id !== 'game').length);
ok(9, 'Sem minimapa, radar, GPS ou marcador de aliados na tela', canvases === 0 && !/minimapa|radar|GPS/i.test(hudTxt));

// ===================================================================== ONLINE (2 navegadores, servidor real)
const p1 = await newPage();
const p2 = await newPage();
const join = async (pg, name) => {
  await pg.goto(`http://localhost:${PORT}/`);
  await wait(700);
  await pg.click('[data-a=multi]');
  await wait(150);
  await pg.fill('[data-k=nome]', name);
  await pg.click('[data-l=conectar]');
  await wait(600);
};
await join(p1, 'Ana');
const lobby1 = await p1.$eval('[data-k=lobby]', (e) => e.textContent);
await p1.click('[data-pick="0"]');
await wait(400);
await p1.screenshot({ path: `${SHOTS}/e3-06-lobby.png` });
await join(p2, 'Beto');
await p2.click('[data-pick="1"]');
await wait(400);
const lobby2 = await p2.$eval('[data-k=lobby]', (e) => e.textContent);
await p1.click('[data-l=iniciar]');
await wait(1500);
const s1 = await p1.evaluate(() => ({ st: window.__oua.game.state, on: window.__oua.game.online, id: window.__oua.world.localId, name: window.__oua.world.player.name }));
const s2 = await p2.evaluate(() => ({ st: window.__oua.game.state, on: window.__oua.game.online, id: window.__oua.world.localId, name: window.__oua.world.player.name }));
ok(10, 'Lobby: criar/entrar, vagas, escolha de personagem, iniciar', /Ana/.test(lobby2) && /Vaga da IA/.test(lobby1) && s1.st === 'playing' && s1.on && s1.id === 'p0' && s2.st === 'playing' && s2.on && s2.id === 'p1', `${s1.name} (Ana) e ${s2.name} (Beto) na mesma partida`);

// movimento real pelo teclado → servidor autoritativo → volta pelo snapshot
const a0 = await p1.evaluate(() => ({ x: window.__oua.world.player.x, y: window.__oua.world.player.y }));
await p1.mouse.move(W / 2, H * 0.8);
await p1.keyboard.down('KeyS');
await wait(900);
await p1.keyboard.up('KeyS');
await wait(400);
const a1 = await p1.evaluate(() => ({ x: window.__oua.world.player.x, y: window.__oua.world.player.y }));
const status = await (await fetch(`http://localhost:${PORT}/status`)).json();
await p1.screenshot({ path: `${SHOTS}/e3-07-online-ana.png` });
await p2.screenshot({ path: `${SHOTS}/e3-08-online-beto.png` });
ok(11, 'Movimento online validado pelo servidor', Math.hypot(a1.x - a0.x, a1.y - a0.y) > 10 && status.conexoes === 2, `deslocou ${(Math.hypot(a1.x - a0.x, a1.y - a0.y) / 16).toFixed(1)} tiles; servidor: ${status.conexoes} conexões, sim ${status.desempenho.simMs.toFixed(2)} ms/passo, zumbis ativos ${status.desempenho.zumbisAtivos}/dormentes ${status.desempenho.zumbisDormentes}`);

// fala local online não chega a quem está longe (Ana e Beto começam em regiões diferentes)
await p1.keyboard.press('Enter');
await p1.keyboard.type('Beto, tá me ouvindo?');
await p1.keyboard.press('Enter');
await wait(600);
const beLog = await p2.$eval('#log', (e) => e.textContent);
const anaLog = await p1.$eval('#log', (e) => e.textContent);
ok(12, 'Sem chat global: fala local não alcança quem está longe', anaLog.includes('Você: Beto, tá me ouvindo?') && !beLog.includes('tá me ouvindo'));

// Beto fecha a página → IA assume; Ana vê no diário
await p2.close();
await wait(1500);
await p1.keyboard.press('KeyJ');
await wait(300);
const j1 = await p1.$eval('#journal', (e) => e.textContent);
await p1.screenshot({ path: `${SHOTS}/e3-09-diario-online.png` });
ok(13, 'Jogador sai → IA assume o personagem (visível no diário)', /desconectado — IA no controle/.test(j1));

console.log(errors.length ? errors.slice(0, 8) : 'sem erros no console');
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} verificações de navegador passaram${errors.length ? ` · ${errors.length} erro(s) no console` : ''}`);
await browser.close();
server.kill('SIGINT');
await wait(800);
process.exit(failed.length || errors.length ? 1 : 0);
