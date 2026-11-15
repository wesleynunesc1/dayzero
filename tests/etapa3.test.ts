// Etapas 3, 4 e 5 — 24 testes de integração obrigatórios (Parte 17 do prompt mestre).
// Executar: npx tsx tests/etapa3.test.ts
// Os testes de multijogador sobem um SERVIDOR REAL (HTTP + WebSocket) numa porta local e
// conectam clientes reais (NetClient) — não são quatro personagens locais simulando rede.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { startServer } from '../server/app';
import { CONFIG, TILE } from '../src/config';
import { createItem, itemDef } from '../src/data/items';
import type { Npc } from '../src/entities/Npc';
import type { Player } from '../src/entities/Player';
import { runAction } from '../src/net/Actions';
import { NetClient } from '../src/net/NetClient';
import { applySnapshot, type Snapshot } from '../src/net/Sync';
import { rep } from '../src/systems/Factions';
import { enterVehicle, findInteractable, interact, openContainer } from '../src/systems/Interaction';
import { doPlayerItemAction, takeFromContainer } from '../src/systems/ItemActions';
import { applySave, serializeWorld } from '../src/systems/Save';
import { Simulation } from '../src/systems/Simulation';
import { attitude, dialogChoose, greeting, proposeTrade } from '../src/systems/Social';
import { EMPTY_COMMAND, PlayerCommand, World } from '../src/world/World';

let fails = 0;
const check = (n: number, name: string, ok: boolean, info = '') => {
  console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${String(n).padStart(2)} ${name}${info ? ` — ${info}` : ''}`);
  if (!ok) fails++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await sleep(25);
  return cond();
};

function fresh() {
  const w = new World();
  const sim = new Simulation(w);
  w.weather.set('limpo', 999, true);
  w.weather.locked = true;
  return { w, sim };
}
const step = (sim: Simulation, seconds: number, cmd: Partial<PlayerCommand> = {}) => {
  const p = sim.world.player;
  for (let i = 0; i < Math.round(seconds * 60); i++)
    sim.step(1 / 60, { ...EMPTY_COMMAND, aimX: p.x + 1, aimY: p.y - 10, ...cmd, ...(i > 0 ? { interact: false, attackPressed: false, reload: false, toggleCrouch: false } : {}) });
};
const tp = (p: Player, tx: number, ty: number) => {
  p.x = tx * TILE + 8;
  p.y = ty * TILE + 8;
  p.vx = p.vy = 0;
};
const clearZombies = (w: World, x: number, y: number, r = 40) => {
  w.zombies = w.zombies.filter((z) => Math.hypot(z.x - x, z.y - y) >= r * TILE);
};
const npc = (w: World, key: string) => w.npcs.find((n) => n.key === key)!;
const tmp = (name: string) => {
  const d = path.join(os.tmpdir(), `oua-${name}-${process.pid}`);
  fs.rmSync(d, { recursive: true, force: true });
  return d;
};

/** Cliente de teste: conecta de verdade e guarda tudo o que recebe. */
async function client(port: number, name: string) {
  const c = new NetClient();
  const st = { full: null as null | { you: string; save: unknown }, snaps: [] as Snapshot[], msgs: [] as string[], errs: [] as string[], closed: false };
  c.onFull = (save, you) => (st.full = { you, save });
  c.onSnap = (s) => {
    st.snaps.push(s);
    if (st.snaps.length > 30) st.snaps.shift();
  };
  c.onEvents = (evs) => {
    for (const e of evs) if (e.k === 'message') st.msgs.push((e.p as { text: string }).text);
  };
  c.onError = (m) => st.errs.push(m);
  c.onClose = () => (st.closed = true);
  await c.connect(`ws://localhost:${port}/ws`, name);
  return { c, st };
}

// ============================================================================ MULTIJOGADOR
const PORT = 8811;
const DATA = tmp('srv');
let srv = startServer({ port: PORT, dataDir: DATA, quiet: true, mode: 'QUARTETO', worldName: 'Teste Etapa 3' });
await srv.ready;
let G = srv.game;

// 1 ─ criar um mundo
const A = await client(PORT, 'Ana');
await until(() => !!A.c.lobby);
const hostOk = A.c.lobby?.host === 'Ana' && A.c.lobby.slots.length === 4 && !A.c.lobby.started;
A.c.setMode('DUO');
await until(() => A.c.lobby?.mode === 'DUO');
A.c.pick(0);
await until(() => A.c.lobby?.you === 'p0');
A.c.start();
await until(() => !!A.st.full && A.st.snaps.length > 2);
check(1, 'Um jogador consegue criar um mundo', hostOk && G.room.started && A.st.full?.you === 'p0' && fs.existsSync(path.join(DATA, 'manifest.json')) && A.st.snaps.length > 0,
  `anfitrião "${A.c.lobby?.host}", modalidade ${G.room.mode}, mundo completo recebido (${Math.round(JSON.stringify(A.st.full?.save ?? '').length / 1024)} KB), ${A.st.snaps.length} snapshots, save em disco`);

// 2 ─ outros jogadores entram
const B = await client(PORT, 'Beto');
await until(() => !!B.c.lobby);
B.c.pick(1);
await until(() => !!B.st.full && B.st.snaps.length > 2);
const ownersOk = A.c.lobby?.slots[1].owner === 'Beto' && B.c.lobby?.slots[0].owner === 'Ana';
check(2, 'Outros jogadores conseguem entrar', B.st.full?.you === 'p1' && G.world.players[1].controller === 'humano' && ownersOk, `Beto entrou como ${G.world.players[1].name}; lobby mostra os dois donos de vaga`);

// 3 ─ vagas vazias são ocupadas por NPCs (IA)
const ai = G.world.players.filter((p) => p.controller === 'ia');
const aiStart = ai.map((p) => ({ x: p.x, y: p.y, n: p.inv.items.length }));
await sleep(2500);
const aiActed = ai.some((p, i) => Math.hypot(p.x - aiStart[i].x, p.y - aiStart[i].y) > 8 || p.inv.items.length !== aiStart[i].n);
const slotsAi = A.c.lobby?.slots.filter((s) => s.aiOnly).map((s) => s.name) ?? [];
// SOLO offline: 1 humano + 3 IA
const solo = new World();
const soloOk = solo.players.filter((p) => p.controller === 'humano').length === 1 && solo.players.filter((p) => p.controller === 'ia').length === 3;
check(3, 'Vagas vazias são ocupadas por NPCs', ai.length === 2 && slotsAi.length === 2 && aiActed && soloOk,
  `DUO: ${ai.map((p) => p.name).join(' e ')} controlados pela IA (agiram: ${aiActed}); SOLO: 1 humano + 3 IA`);

// 4 ─ a IA assume personagens desconectados
const pB = G.world.players[1];
const water = createItem('agua');
pB.inv.add(water);
const usesBefore = pB.inv.get(water.uid)!.state!.uses!;
const ammoGiven = createItem('municao_9mm', 12);
pB.inv.add(ammoGiven);
B.c.close();
await until(() => pB.controller === 'ia', 3000);
const tookOver = pB.controller === 'ia' && !pB.connected && G.room.owners[1] === 'Beto';
pB.thirst = 80; // a IA vai beber a água do próprio inventário
await until(() => (pB.inv.get(water.uid)?.state?.uses ?? 0) < usesBefore, 5000);
const usesAfter = pB.inv.get(water.uid)?.state?.uses ?? 0;
check(4, 'A IA assume personagens desconectados', tookOver && usesAfter < usesBefore, `Beto saiu → ${pB.name} controlado pela IA; a IA bebeu (${usesBefore} → ${usesAfter} goles) e a vaga segue reservada para Beto`);

// 5 ─ o jogador recupera o controle ao retornar
const pBpos = { x: pB.x, y: pB.y };
const B2 = await client(PORT, 'Beto');
await until(() => !!B2.st.full);
check(5, 'O jogador recupera o controle ao retornar', B2.st.full?.you === 'p1' && pB.controller === 'humano' && pB.connected && Math.hypot(pB.x - pBpos.x, pB.y - pBpos.y) < 64,
  `reconectou com o mesmo nome e reassumiu ${pB.name} onde a IA o deixou`);

// 6 ─ inventário correto após reconexão (sem restaurar nem apagar)
const fullB = B2.st.full!.save as ReturnType<typeof serializeWorld>;
const sentInv = fullB.players.find((p) => p.id === 'p1')!.inventory;
const serverInv = pB.inv.items;
const sameInv = sentInv.length === serverInv.length && sentInv.every((it) => serverInv.some((s) => s.uid === it.uid && s.qty === it.qty && JSON.stringify(s.state ?? {}) === JSON.stringify(it.state ?? {})));
const waterNow = sentInv.find((i) => i.uid === water.uid);
// o cliente remonta o mundo e aplica snapshots: o inventário local bate com o do servidor
const cw = new World(fullB.seed);
applySave(cw, fullB);
cw.localId = 'p1';
await until(() => B2.st.snaps.length > 3);
for (const s of B2.st.snaps) applySnapshot(cw, s);
const clientInvOk = cw.playerById('p1')!.inv.items.length === pB.inv.items.length;
check(6, 'O inventário permanece correto após reconexão', sameInv && (waterNow?.state?.uses ?? 99) === usesAfter && clientInvOk,
  `${serverInv.length} itens idênticos (uid/qtd/estado) no servidor e no cliente; a água gasta pela IA continua gasta (${waterNow?.state?.uses} goles)`);

// 7 ─ o mundo preserva o progresso (saque via ação de rede)
const pA = G.world.players[0];
const cont = [...G.world.containers.values()].find((c) => !c.owner && c.inv.items.length > 0 && c.x < 120 && c.y < 90)!;
tp(pA, cont.x, cont.y + cont.h);
clearZombies(G.world, pA.x, pA.y, 20);
pA.facing = Math.atan2((cont.y + cont.h / 2) * TILE - pA.y, (cont.x + cont.w / 2) * TILE - pA.x);
G.world.withPlayer(pA, () => openContainer(G.world, cont));
await until(() => pA.openContainer === cont.id, 3000);
const lootUid = cont.inv.items[0].uid;
const rTake = await A.c.request('take', [cont.id, lootUid]);
const looted = !cont.inv.items.some((i) => i.uid === lootUid) && pA.inv.items.some((i) => i.uid === lootUid);
await until(() => A.st.snaps.some((s) => s.cont?.some(([id]) => id === cont.id)), 3000);
const clientSaw = A.st.snaps.some((s) => s.cont?.some(([id, items]) => id === cont.id && !items.some((i) => i.uid === lootUid)));
console.log('   (7:', looted, clientSaw, rTake, ')');
check(7, 'O mundo preserva o progresso', looted && clientSaw && rTake === null, `item ${lootUid} saiu de "${cont.name}" para o inventário de ${pA.name} pelo servidor; o cliente recebeu o recipiente atualizado (persistência após reinício: teste 23)`);

// 21 ─ missões principais atualizam o progresso compartilhado
const m = G.world.missions!;
const ch0 = m.chapter;
pA.inv.add(createItem('feijao_lata'));
pA.inv.add(createItem('agua'));
pA.inv.add(createItem('taco_beisebol'));
G.world.withPlayer(pA, () => doPlayerItemAction(G.world, 'equip_arma', pA.inv.findDef('taco_beisebol')!.uid));
m.onEvent('dormiu', {});
await until(() => m.chapter > ch0, 4000);
await until(() => A.st.snaps.some((s) => (s.mis as { chapter: number } | undefined)?.chapter === m.chapter) && B2.st.snaps.some((s) => (s.mis as { chapter: number } | undefined)?.chapter === m.chapter), 3000);
check(21, 'Missões principais atualizam o progresso compartilhado', m.chapter === ch0 + 1 && A.st.msgs.some((t) => t.includes('Capítulo 2')) && B2.st.msgs.some((t) => t.includes('Capítulo 2')),
  `capítulo ${ch0} → ${m.chapter} ("${m.def.title}"); os dois clientes receberam o novo capítulo`);

// 9 ─ localização dos aliados não aparece automaticamente
const lastA = A.st.snaps[A.st.snaps.length - 1];
const farApart = Math.hypot(pA.x - pB.x, pA.y - pB.y) > CONFIG.multiplayer.interestRadius * TILE;
const posLeak = lastA.pos.some(([id]) => id === 'p1');
const fullLeak = (A.st.full!.save as ReturnType<typeof serializeWorld>).players.find((p) => p.id === 'p1')!;
// rádio: mensagem do bot descreve o lugar em palavras, sem coordenadas
const pC = G.world.players[2];
tp(pC, pA.x / TILE + 90, pA.y / TILE + 10); // longe da vista (90 m), mas ao alcance do rádio
const rc = createItem('radio');
rc.state = { on: true, battery: 100, freq: 3 };
pC.inv.add(rc);
const ra = createItem('radio');
ra.state = { on: true, battery: 100, freq: 3 };
pA.inv.add(ra);
const heard: string[] = [];
const off = G.world.events.on('message', (mm) => mm.to === 'p0' && mm.text.includes('📻') && heard.push(mm.text));
const rRadio = await A.c.request('radio', ['Alguém na escuta?']);
await until(() => heard.some((h) => h.includes(pC.name)), 6000);
off();
const botReply = heard.find((h) => h.includes(pC.name)) ?? '';
const cLeak = lastA.pos.some(([id]) => id === 'p2');
check(9, 'A localização dos aliados não aparece automaticamente', farApart && !posLeak && !cLeak && fullLeak.x < -1e5 && botReply.length > 0 && !/\d{2,}\s*,\s*\d{2,}/.test(botReply) && rRadio === null,
  `snapshot de Ana não traz a posição de Beto (longe); save inicial recebido esconde a posição; resposta da IA por rádio só em palavras: "${botReply.replace(/^.*?: /, '').slice(0, 90)}"`);

// 8 ─ o rádio só funciona quando encontrado e utilizável
const pD = G.world.players[3];
const noRadio = G.world.radio!.transmit(pD, 'teste');
const rd = createItem('radio');
pD.inv.add(rd);
const noBattery = G.world.radio!.transmit(pD, 'teste');
rd.state = { on: false, battery: 50, freq: 3 };
const switchedOff = G.world.radio!.transmit(pD, 'teste');
rd.state = { on: true, battery: 50, freq: 5 };
const heardWrong: string[] = [];
const off2 = G.world.events.on('message', (mm) => mm.to === 'p0' && mm.text.includes(pD.name) && heardWrong.push(mm.text));
G.world.radio!.transmit(pD, 'canal errado');
rd.state.freq = 3;
G.world.radio!.transmit(pD, 'canal certo');
off2();
check(8, 'O rádio funciona somente quando encontrado e utilizável',
  !noRadio.ok && /não tem/.test(noRadio.reason!) && !noBattery.ok && /bateria/.test(noBattery.reason!) && !switchedOff.ok && /desligado/.test(switchedOff.reason!) && !heardWrong.some((t) => t.includes('canal errado')),
  `sem rádio: "${noRadio.reason}"; sem pilha: "${noBattery.reason}"; desligado: "${switchedOff.reason}"; frequência diferente não chega; mesma frequência: ${heardWrong.some((t) => t.includes('canal certo')) ? 'ouviu (ou fora de alcance com chiado)' : 'fora de alcance'}`);

// 23 ─ o servidor mantém os dados após reinicialização (e após queda)
const marker = await A.c.request('marker', [40, 50, 'abrigo', 'casa segura']);
void marker;
A.c.close();
B2.c.close();
await srv.close(); // desligamento normal: salva
const savedChapter = m.chapter;
const invA = pA.inv.items.map((i) => i.uid).sort().join();
const invB = pB.inv.items.map((i) => i.uid).sort().join();
srv = startServer({ port: PORT, dataDir: DATA, quiet: true });
await srv.ready;
G = srv.game;
const w2 = G.world;
const contAfter = w2.containers.get(cont.id)!;
const restartOk = w2.missions!.chapter === savedChapter && !contAfter.inv.items.some((i) => i.uid === lootUid) && w2.players[0].inv.items.map((i) => i.uid).sort().join() === invA && w2.players[1].inv.items.map((i) => i.uid).sort().join() === invB && w2.players[0].markers.some((mk) => mk.note === 'casa segura') && G.room.owners[0] === 'Ana' && G.room.started;
// incremental: um segundo salvamento sem mudanças grava pouco
const st0 = { ...srv.store.stats };
G.saveNow();
const st1 = { ...srv.store.stats };
const incr = st1.skipped - st0.skipped > st1.written - st0.written;
// queda: manifesto atual corrompido → recupera do backup
await srv.close(true);
fs.writeFileSync(path.join(DATA, 'manifest.json'), '{corrompido');
srv = startServer({ port: PORT, dataDir: DATA, quiet: true });
await srv.ready;
G = srv.game;
const crashOk = G.room.started && G.world.missions!.chapter === savedChapter && G.world.players[0].inv.items.length > 0;
console.log('   (23: reinício', restartOk, '· incremental', incr, '· queda', crashOk, ')');
check(23, 'O servidor mantém os dados após reinicialização', restartOk && incr && crashOk,
  `capítulo ${savedChapter}, saque, inventários (Ana ${w2.players[0].inv.items.length}, Beto ${w2.players[1].inv.items.length} itens), marcação no mapa e donos de vaga preservados; 2º salvamento: ${st1.written - st0.written} seções gravadas, ${st1.skipped - st0.skipped} sem mudança; manifesto corrompido → recuperado do backup`);
await srv.close(true);

// ============================================================================ MUNDO / NPCs / FACÇÕES (servidor local)

// 10 ─ mapas incompletos podem ser encontrados e combinados
{
  const { w } = fresh();
  const p = w.player;
  const all = [...w.containers.values()].flatMap((c) => c.inv.items.filter((i) => i.defId === 'mapa_regional' || i.defId === 'fragmento_regional').map((i) => ({ c, i })));
  const conds = new Set(all.filter((x) => x.i.defId === 'mapa_regional').map((x) => x.i.state!.cond));
  const sul = all.filter((x) => x.i.state!.region === 'sul');
  for (const x of sul) {
    tp(p, x.c.x, x.c.y);
    p.openContainer = x.c.id;
    takeFromContainer(w, x.c, x.i.uid);
  }
  const torn = p.inv.items.find((i) => i.defId === 'mapa_regional' && i.state?.region === 'sul')!;
  const piecesBefore = torn.state!.pieces;
  const sim = new Simulation(w);
  for (let k = 0; k < 3; k++) {
    const f = p.inv.items.find((i) => i.defId === 'fragmento_regional' && i.state?.region === 'sul');
    if (!f) break;
    doPlayerItemAction(w, 'combine_regional', torn.uid);
    step(sim, 2);
  }
  runAction(w, p.id, 'marker', [300, 240, 'perigo', 'muitos infectados']);
  const data = serializeWorld(w);
  const w2 = new World();
  new Simulation(w2);
  applySave(w2, data);
  const t2 = w2.player.inv.items.find((i) => i.uid === torn.uid)!;
  check(10, 'Mapas incompletos podem ser encontrados e combinados',
    piecesBefore === 3 && t2.state!.pieces === 15 && t2.state!.cond === 'completo' && ['molhado', 'queimado', 'desatualizado', 'rasgado', 'completo'].every((c) => conds.has(c)) && w2.player.markers.some((mk) => mk.kind === 'perigo'),
    `mapa do Sul rasgado (pedaços ${piecesBefore}/15) + 2 fragmentos achados no mundo → ${t2.state!.pieces}/15 (${t2.state!.cond}); tipos no mundo: ${[...conds].join(', ')}; marcação manual salva`);
}

// 11 ─ NPCs lembram interações anteriores (pedido ignorado → ressentimento)
{
  const { w, sim } = fresh();
  const p = w.player;
  const lucia = npc(w, 'lucia');
  const davi = npc(w, 'irmao_davi');
  tp(p, lucia.x / TILE + 2, lucia.y / TILE);
  clearZombies(w, p.x, p.y, 50);
  for (const it of p.inv.items.slice()) if (itemDef(it.defId).food) p.inv.remove(it.uid);
  const greet0 = greeting(w, lucia, p);
  step(sim, 2);
  const asked = lucia.requests.some((r) => r.who === p.id);
  const daviRel0 = JSON.stringify(davi.rel(p.id));
  step(sim, (CONFIG.npc.helpWaitHours * 60 + 20) / CONFIG.time.minutesPerSecond);
  const r = lucia.rel(p.id);
  const greet1 = greeting(w, lucia, p);
  const daviRel1 = JSON.stringify(davi.rel(p.id));
  const att = attitude(w, lucia, p.id);
  check(11, 'NPCs lembram interações anteriores', asked && lucia.remembers('ignorou_pedido', p.id) && r.ressentimento > 20 && greet1 !== greet0 && (att === 'ressentido' || att === 'desconfiado') && daviRel0 === daviRel1,
    `Lúcia pediu comida, foi ignorada por ${CONFIG.npc.helpWaitHours} h → ressentimento ${Math.round(r.ressentimento)}, postura "${att}"; agora diz: "${greet1}"; relação com quem não interagiu não mudou`);
}

// 12 ─ facções respondem às ações dos jogadores
{
  const { w, sim } = fresh();
  const p = w.player;
  const rosa = npc(w, 'rosa');
  tp(p, rosa.x / TILE + 1, rosa.y / TILE);
  clearZombies(w, p.x, p.y, 40);
  step(sim, 0.5);
  const repTrade0 = rep(w, 'aurora', p.id);
  const sard = createItem('sardinha', 2);
  p.inv.add(sard);
  const tr = proposeTrade(w, rosa, p, [sard.uid], [rosa.inv.items.find((i) => i.uid !== rosa.weaponUid)!.uid]);
  const repTrade1 = rep(w, 'aurora', p.id);
  p.x = rosa.x + 14;
  p.y = rosa.y;
  p.facing = Math.PI;
  const repAtk0 = rep(w, 'aurora', p.id);
  step(sim, 0.1, { attack: true, attackPressed: true, aimX: rosa.x, aimY: rosa.y });
  step(sim, 0.5);
  const repAtk1 = rep(w, 'aurora', p.id);
  const hostile = attitude(w, rosa, p.id) === 'hostil';
  // área restrita da Base Sentinela
  const sRep0 = rep(w, 'sentinela', p.id);
  tp(p, 480, 66);
  clearZombies(w, p.x, p.y, 30);
  step(sim, 1.5);
  const sRep1 = rep(w, 'sentinela', p.id);
  check(12, 'Facções respondem às ações dos jogadores', tr.ok && repTrade1 > repTrade0 && repAtk1 < repAtk0 && hostile && sRep1 <= CONFIG.factions.hostileBelow && sRep0 > sRep1,
    `troca justa com Rosa: Aurora ${repTrade0} → ${repTrade1}; agressão: ${repTrade1} → ${Math.round(repAtk1)} e Rosa ficou hostil; invadir o comando da Sentinela: ${sRep0} → ${sRep1}`);
}

// 13 e 14 ─ captura, prisão, fuga e resgate
{
  const { w, sim } = fresh();
  const p = w.player;
  const nav = npc(w, 'navalha');
  p.inv.add(createItem('rifle'));
  p.inv.add(createItem('municao_308', 8));
  const rifleUid = p.inv.findDef('rifle')!.uid;
  tp(p, nav.x / TILE + 2, nav.y / TILE);
  clearZombies(w, p.x, p.y, 60);
  step(sim, 1.5);
  const confronted = !!nav.confront && nav.confront.who === p.id;
  const said = dialogChoose(w, nav, p, 'render');
  const pr = w.prisons.find((x) => x.faction === 'abutres')!;
  const stash = w.containers.get(pr.stash)!;
  const cap = p.captive;
  const cell = cap ? pr.cells[cap.cell] : null;
  const door = cell ? w.map.doors.find((d) => d.x === cell.doorX && d.y === cell.doorY)! : null;
  check(13, 'Personagens podem ser capturados', confronted && !!cap && p.inv.items.length === 0 && stash.inv.items.some((i) => i.uid === rifleUid) && !!door && door.locked === 'abutres' && !door.open,
    `Navalha deu voz de prisão; rendição ("${said}") → cela ${cap ? cap.cell + 1 : '?'} trancada; rifle e munição foram para o depósito de apreensões (não sumiram)`);

  // 14a ─ fuga com grampo achado no colchão
  const mat = w.containers.get(cell!.mattress)!;
  tp(p, mat.x + 1, mat.y + 1);
  p.facing = -Math.PI / 2;
  openContainer(w, mat);
  step(sim, 1);
  const pick = mat.inv.findDef('grampo');
  if (pick) takeFromContainer(w, mat, pick.uid);
  tp(p, cell!.doorX, cell!.doorY - 1);
  p.facing = Math.PI / 2;
  let tries = 0;
  while (p.captive && tries < 8 && p.inv.count('grampo') > 0) {
    tries++;
    p.facing = Math.PI / 2;
    const it = findInteractable(w);
    if (it && it.kind === 'door') interact(w, it);
    step(sim, 9.5);
    if (door!.locked === undefined) {
      interact(w, { kind: 'door', label: '', x: 0, y: 0, door: door! });
      step(sim, 0.5);
    }
  }
  const escaped = door!.locked === undefined;
  if (escaped) {
    tp(p, cell!.doorX, cell!.doorY + 2);
    step(sim, 0.3);
  }
  // 14b ─ resgate: outro sobrevivente com a chave das celas solta João
  const rescuer = w.players[1];
  rescuer.controller = 'humano';
  const joao = npc(w, 'prisioneiro_joao');
  const jCell = pr.cells[joao.cell!];
  const jDoor = w.map.doors.find((d) => d.x === jCell.doorX && d.y === jCell.doorY)!;
  rescuer.inv.add(createItem('chave_celas'));
  tp(rescuer, jCell.doorX, jCell.doorY + 1);
  w.withPlayer(rescuer, () => interact(w, { kind: 'door', label: '', x: 0, y: 0, door: jDoor }));
  const keyOpened = jDoor.locked === undefined;
  w.withPlayer(rescuer, () => interact(w, { kind: 'door', label: '', x: 0, y: 0, door: jDoor }));
  step(sim, 1);
  const joaoFree = joao.activity === 'fugindo_prisao' || joao.role === 'sobrevivente';
  // 14c ─ prisão não é tela de espera: preso pode conversar com outro preso
  const talk = dialogChoose(w, joao, rescuer, 'historia');
  check(14, 'O sistema de prisão permite escapar ou receber resgate', (escaped || !p.captive) && keyOpened && joaoFree && !!talk,
    `fuga com grampo: ${escaped ? `fechadura aberta em ${tries} tentativa(s)` : 'não abriu'}; ${rescuer.name} abriu a cela de João com a chave → João ${joao.activity}; missão: ${w.missions!.side.find((s) => s.id === 'resgate_joao')?.status ?? '-'}`);
}

// 15 ─ zumbis reagem aos barulhos
{
  const { w, sim } = fresh();
  const p = w.player;
  clearZombies(w, p.x, p.y, 200);
  const z = w.spawnZombie(p.x + 12 * TILE, p.y, 'comum');
  step(sim, 0.5);
  const before = z.state;
  w.makeNoise(p.x, p.y, 20, 'tiro', true, p.id);
  step(sim, 0.3);
  check(15, 'Zumbis reagem aos barulhos', before === 'vagar' && (z.state === 'investigar' || z.state === 'perseguir' || z.state === 'identificar'), `estado ${before} → ${z.state} após um disparo a 12 m`);
}

// 16 ─ hordas se movimentam de maneira coerente
{
  const { w, sim } = fresh();
  const ws = sim.worldSim;
  const h = [...ws.hordes.values()].find((x) => Math.hypot(x.x - w.player.x, x.y - w.player.y) > 100 * TILE)!;
  const members = w.zombies.filter((z) => z.horde === h.id);
  h.restHours = 0;
  step(sim, 2);
  const dest = { x: h.destX, y: h.destY, name: h.destName };
  const d0 = Math.hypot(h.x - dest.x, h.y - dest.y);
  const spread0 = members.reduce((a, z) => a + Math.hypot(z.x - h.x, z.y - h.y), 0) / members.length;
  step(sim, 40);
  const d1 = Math.hypot(h.x - dest.x, h.y - dest.y);
  const spread1 = members.reduce((a, z) => a + Math.hypot(z.x - h.x, z.y - h.y), 0) / members.length;
  // barulho forte perto da horda muda o destino
  w.makeNoise(h.x + 20 * TILE, h.y, 40, 'tiro', true, null);
  step(sim, 1);
  check(16, 'Hordas se movimentam de maneira coerente', dest.name !== 'local' && d1 < d0 && spread1 < 6 * TILE && h.destName === 'barulho',
    `horda ${h.id} (${members.length} infectados) seguiu para ${dest.name}: ${Math.round(d0 / TILE)} → ${Math.round(d1 / TILE)} m; membros acompanham o centro (dispersão ${Math.round(spread0)} → ${Math.round(spread1)} px); disparo próximo → destino "${h.destName}"`);
}

// 17 ─ veículos consomem combustível
{
  const { w, sim } = fresh();
  const p = w.player;
  const v = w.vehicles[0];
  tp(p, v.x / TILE, v.y / TILE + 2);
  clearZombies(w, p.x, p.y, 60);
  v.fuel = 6;
  enterVehicle(w, v);
  const f0 = v.fuel;
  step(sim, 8, { my: -1 });
  const used = f0 - v.fuel;
  v.fuel = 0.02;
  step(sim, 6, { my: -1 });
  check(17, 'Veículos consomem combustível', used > 0 && v.fuel === 0 && !v.engineOn, `gastou ${used.toFixed(3)} L em 8 s; com o tanque seco o motor morreu`);
}

// 18 a 20 ─ morte, retorno, equipamento e saque por NPC
{
  const { w, sim } = fresh();
  const p = w.player;
  const beto = npc(w, 'beto');
  tp(p, beto.x / TILE + 3, beto.y / TILE + 3);
  clearZombies(w, p.x, p.y, 60);
  const rifle = createItem('rifle');
  const ammo = createItem('municao_308', 10);
  const bag = createItem('mochila_escolar');
  for (const it of [rifle, ammo, bag]) p.inv.add(it);
  doPlayerItemAction(w, 'equip_arma', rifle.uid);
  step(sim, 0.2);
  doPlayerItemAction(w, 'equip_costas', bag.uid);
  step(sim, 0.2);
  const deathPos = { x: p.x, y: p.y };
  p.health.die('Ferimentos');
  step(sim, 0.5);
  const corpse = w.corpses.find((c) => c.isPlayer && Math.hypot(c.x - deathPos.x, c.y - deathPos.y) < 4)!;
  runAction(w, p.id, 'respawn', []);
  step(sim, 0.2);
  const back = p.alive && !p.weaponItem && !p.item('costas') && p.inv.count('municao_308') === 0 && Math.hypot(p.x - deathPos.x, p.y - deathPos.y) > 3 * TILE;
  check(18, 'Jogadores podem morrer e retornar', !!corpse && back, `morreu e voltou em outro ponto, só com os punhos (${p.inv.items.map((i) => itemDef(i.defId).name).join(', ') || 'nada'})`);
  const kept = [rifle.uid, ammo.uid, bag.uid].every((u) => corpse.container.inv.items.some((i) => i.uid === u));
  check(19, 'Equipamentos permanecem após a morte', kept, `rifle, munição e mochila continuam no ${corpse.name.toLowerCase()} (mesmos itens, mesmos uids)`);
  // o jogador (que voltou) fica longe; um sobrevivente humano perto mantém a região ativa
  const watcher = w.players[2];
  watcher.controller = 'humano';
  tp(watcher, beto.x / TILE - 6, beto.y / TILE);
  tp(p, 12, 22);
  sim.worldSim.refreshCells();
  beto.lootCd = 0;
  let t = 0;
  while (t < 60 && !beto.inv.items.some((i) => i.uid === rifle.uid)) {
    step(sim, 1);
    t++;
  }
  const npcHas = beto.inv.items.some((i) => i.uid === rifle.uid);
  const gone = !corpse.container.inv.items.some((i) => i.uid === rifle.uid);
  // e os itens continuam recuperáveis: se Beto morrer, ficam no corpo dele
  beto.hp = 1;
  const { damageHuman } = await import('../src/systems/Combat');
  damageHuman(w, beto, 50, null, 'golpe');
  const betoCorpse = w.corpses.find((c) => c.name.includes('Beto'));
  check(20, 'NPCs podem saquear cadáveres', npcHas && gone && !!betoCorpse?.container.inv.items.some((i) => i.uid === rifle.uid) && !!w.missions!.side.find((s) => s.kind === 'equipamento'),
    `Beto revirou o corpo em ${t} s e pegou o rifle (mesmo uid); missão "Equipamento saqueado" criada; quando Beto morreu, o rifle ficou no corpo dele`);
}

// 22 ─ missões secundárias produzem consequências
{
  const { w, sim } = fresh();
  const p = w.player;
  const celia = npc(w, 'dona_celia');
  tp(p, celia.x / TILE + 2, celia.y / TILE);
  clearZombies(w, p.x, p.y, 50);
  step(sim, 2);
  const med0 = w.factions.get('aurora')!.resources.remedios;
  const rep0 = rep(w, 'aurora', p.id);
  p.inv.add(createItem('antibiotico'));
  const reply = dialogChoose(w, celia, p, 'dar_pedido');
  const helped = w.missions!.side.find((s) => s.id === 'ajuda_dona_celia');
  const rep1 = rep(w, 'aurora', p.id);
  // ignorar o pedido de Beto tem o efeito oposto
  const beto = npc(w, 'beto');
  tp(p, beto.x / TILE + 2, beto.y / TILE);
  clearZombies(w, p.x, p.y, 50);
  for (const it of p.inv.items.slice()) if (itemDef(it.defId).medical) p.inv.remove(it.uid);
  step(sim, 2);
  step(sim, (CONFIG.npc.helpWaitHours * 60 + 15) / CONFIG.time.minutesPerSecond);
  const ignored = w.missions!.side.find((s) => s.id === 'ajuda_beto');
  check(22, 'Missões secundárias produzem consequências', helped?.status === 'concluida' && w.factions.get('aurora')!.resources.remedios > med0 && rep1 > rep0 && ignored?.status === 'falhou' && beto.rel(p.id).ressentimento > 0,
    `antibiótico para Dona Célia → missão concluída, Aurora ${rep0} → ${Math.round(rep1)} e remédios ${med0} → ${w.factions.get('aurora')!.resources.remedios} ("${reply}"); pedido de Beto ignorado → missão fracassada e ressentimento ${Math.round(beto.rel(p.id).ressentimento)}`);
}

// 24 ─ as mecânicas das Etapas 1 e 2 continuam funcionando
{
  const run = (f: string) => {
    try {
      return execFileSync('npx', ['tsx', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 });
    } catch (e) {
      return String((e as { stdout?: string }).stdout ?? e);
    }
  };
  const e2 = run('tests/etapa2.test.ts');
  const ai = run('tests/ai.test.ts');
  const items = run('tests/items.test.ts');
  const m2 = /(\d+)\/(\d+) verificações passaram/.exec(e2);
  check(24, 'As mecânicas das Etapas 1 e 2 continuam funcionando', !!m2 && m2[1] === m2[2] && /todos os testes de IA passaram/.test(ai) && /todos os testes de itens passaram/.test(items),
    `Etapa 2: ${m2 ? `${m2[1]}/${m2[2]}` : 'falhou'}; IA dos zumbis (Etapa 1): ${/todos os testes de IA passaram/.test(ai) ? 'ok' : 'falhou'}; itens: ${/todos os testes de itens passaram/.test(items) ? 'ok' : 'falhou'}`);
}

console.log(fails ? `\n${fails} teste(s) falharam` : '\n24/24 testes de integração passaram');
process.exit(fails ? 1 : 0);
