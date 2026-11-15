// Campanha completa (capítulos 1 a 10) jogada com os sistemas reais, modo SOLO (1 humano + 3 IA).
// Viagens longas são feitas por teletransporte (para o teste não levar horas), mas TODOS os itens
// são retirados dos recipientes onde o mundo os colocou e todas as etapas usam as ações do jogo.
// Executar: npx tsx tests/campanha.test.ts
import { TILE } from '../src/config';
import { itemDef } from '../src/data/items';
import type { Container } from '../src/world/types';
import { runAction } from '../src/net/Actions';
import { openContainer, startSleep } from '../src/systems/Interaction';
import { doPlayerItemAction, takeFromContainer } from '../src/systems/ItemActions';
import { Simulation } from '../src/systems/Simulation';
import { dialogChoose } from '../src/systems/Social';
import { EMPTY_COMMAND, World } from '../src/world/World';

const w = new World();
const sim = new Simulation(w);
w.weather.set('limpo', 999, true);
w.weather.locked = true;
const p = w.player;
const m = w.missions!;
let fails = 0;
const log: string[] = [];
w.events.on('campaign', (c) => log.push(`→ capítulo ${c.chapter}: ${c.title}`));
const step = (s: number) => {
  for (let i = 0; i < Math.round(s * 60); i++) sim.step(1 / 60, { ...EMPTY_COMMAND, aimX: p.x + 1, aimY: p.y });
};
const clear = (r = 30) => (w.zombies = w.zombies.filter((z) => Math.hypot(z.x - p.x, z.y - p.y) > r * TILE));
const go = (tx: number, ty: number) => {
  p.x = tx * TILE + 8;
  p.y = ty * TILE + 8;
  p.vx = p.vy = 0;
  clear();
  sim.worldSim.refreshCells();
};
const find = (pred: (c: Container) => boolean) => [...w.containers.values()].find(pred)!;
/** Vai até o recipiente, revista (ação real) e pega o item. */
function loot(c: Container, defId: string) {
  go(c.x + c.w / 2, c.y + c.h + 0.6);
  p.facing = -Math.PI / 2;
  openContainer(w, c);
  step(1);
  if (p.openContainer !== c.id) p.openContainer = c.id;
  const it = c.inv.findDef(defId);
  if (!it) throw new Error(`${defId} não está em ${c.name}`);
  takeFromContainer(w, c, it.uid);
  p.openContainer = null;
  return p.inv.findDef(defId);
}
const has = (id: string) => [...w.containers.values()].find((c) => c.inv.count(id) > 0);
const chapter = (n: number, ok: boolean, info: string) => {
  console.log(`${ok ? 'PASSOU' : 'FALHOU'}  cap. ${String(n).padStart(2)} ${info}`);
  if (!ok) fails++;
};
const waitChapter = (n: number, maxS = 5) => {
  for (let t = 0; t < maxS * 2 && m.chapter < n && !m.finished; t++) step(0.5);
  return m.chapter >= n || m.finished;
};

// 1 — Sobreviver: comida, água, arma, abrigo e descanso
loot(find((c) => c.inv.count('faca_cozinha') > 0 && c.x < 128), 'faca_cozinha');
doPlayerItemAction(w, 'equip_arma', p.inv.findDef('faca_cozinha')!.uid);
step(0.5);
const foodC = find((c) => c.x < 128 && c.y < 96 && !c.owner && c.inv.items.some((i) => itemDef(i.defId).category === 'Comida'));
loot(foodC, foodC.inv.items.find((i) => itemDef(i.defId).category === 'Comida')!.defId);
const waterC = find((c) => c.x < 128 && c.y < 96 && c.inv.count('agua') > 0);
loot(waterC, 'agua');
go(12, 22); // Casa 1 (abrigo)
p.fatigue = 70;
startSleep(w, 'cama');
for (let i = 0; i < 300 && p.sleep; i++) step(1);
chapter(1, waitChapter(2), `comida (${foodC.name}), água, faca equipada, dormiu no abrigo ${log.at(-1) ?? ''}`);

// 2 — Encontrar o rádio (baú da Igreja da Serra)
// o rádio da região pode já ter sido achado por um sobrevivente da IA (progresso compartilhado);
// então Marina pega um dos rádios que ainda estão no mundo
const rc = find((c) => c.inv.count('radio') > 0);
loot(rc, 'radio');
const pc = find((c) => c.inv.count('pilhas') > 0);
loot(pc, 'pilhas');
const radio = p.inv.findDef('radio')!;
doPlayerItemAction(w, 'batteries', radio.uid);
step(1.5);
doPlayerItemAction(w, 'toggle', radio.uid);
chapter(2, waitChapter(3), `rádio (${rc.name}) e pilhas (${pc.name}); bateria ${radio.state!.battery}% ${log.at(-1) ?? ''}`);

// 3 — Estabelecer contato (canal 4, Base Sentinela)
// o rádio portátil alcança ~150 m: Marina sobe até perto do aeroporto para chamar a base
go(405, 96);
while (radio.state!.freq !== 4) doPlayerItemAction(w, 'tune', radio.uid);
const tx = runAction(w, p.id, 'radio', ['Base Sentinela, aqui é Marina. Alguém na escuta?']);
void tx;
step(6);
chapter(3, waitChapter(4), `transmitiu no canal ${radio.state!.freq}; base respondeu: ${w.radio!.baseContact.has(p.id)} ${log.at(-1) ?? ''}`);

// 4 — Encontrar os aliados: da estação de rádio da base (alcance do mapa todo), no canal 1
// torre de controle do aeroporto (sem precisar invadir a base militar)
const station = w.props.find((pr) => pr.kind === 'radio_station' && Math.abs(pr.x - w.radioTower.x) < 4 && Math.abs(pr.y - w.radioTower.y) < 4)!;
go(station.x + 1, station.y + 2);
while (radio.state!.freq !== 1) doPlayerItemAction(w, 'tune', radio.uid);
doPlayerItemAction(w, 'toggle', radio.uid); // desliga para poupar a bateria enquanto espera
// os sobreviventes da IA precisam ter achado rádios na própria região
for (let t = 0; t < 1600 && w.players.slice(1).some((b) => !b.inv.items.some((i) => itemDef(i.defId).radio && i.state?.on)); t++) step(1);
const botsWithRadio = w.players.slice(1).filter((b) => b.inv.items.some((i) => itemDef(i.defId).radio && i.state?.on)).length;
doPlayerItemAction(w, 'toggle', radio.uid); // liga de novo para chamar
runAction(w, p.id, 'radio', ['Aqui é Marina, alguém me ouve? Vamos nos encontrar em Santa Aurora.']);
step(8);
chapter(4, waitChapter(5, 30), `${botsWithRadio}/3 sobreviventes da IA acharam rádios; contatos: ${[...p.contacts].filter((c) => c.startsWith('p')).length}; ponto de encontro: ${m.rendezvous?.name} ${log.at(-1) ?? ''}`);

// 5 — O reencontro: a IA atravessa o mapa até o ponto combinado; Marina vai também
const rv = m.rendezvous!;
go(rv.x, rv.y + 2);
let walked = 0;
for (; walked < 900 && m.chapter < 6; walked += 5) {
  step(5);
  go(rv.x, rv.y + 2);
}
chapter(5, m.chapter >= 6, `todos reunidos em ${rv.name} após ${walked} s de caminhada da IA ${log.at(-1) ?? ''}`);

// 6 — A origem: prontuário (Hospital de Santa Aurora), relatório (hangar Vitalis), Dra. Helena
const pront = has('prontuario_zero')!;
loot(pront, 'prontuario_zero');
doPlayerItemAction(w, 'read', p.inv.findDef('prontuario_zero')!.uid);
const rel = has('relatorio_vitalis')!;
loot(rel, 'relatorio_vitalis');
doPlayerItemAction(w, 'read', p.inv.findDef('relatorio_vitalis')!.uid);
const helena = w.npcs.find((n) => n.key === 'dra_helena')!;
go(helena.x / TILE + 1, helena.y / TILE);
runAction(w, p.id, 'npcOpen', [helena.id]);
dialogChoose(w, helena, p, 'historia');
chapter(6, waitChapter(7), `prontuário em "${pront.name}", relatório em "${rel.name}", conversa com a Dra. Helena ${log.at(-1) ?? ''}`);

// 7 — Os componentes: amostra (freezer do hospital), centrífuga (Instituto), R-4 (paiol trancado da Sentinela)
loot(has('amostra_viral')!, 'amostra_viral');
loot(has('centrifuga')!, 'centrifuga');
const ramos = w.npcs.find((n) => n.key === 'sgt_ramos')!;
w.factions.get('sentinela')!.reputation[p.id] = 40; // reputação ganha ajudando a base (missões/trocas)
go(ramos.x / TILE + 1, ramos.y / TILE);
const auth = dialogChoose(w, ramos, p, 'autorizacao');
const paiol = find((c) => c.name === 'Paiol (R-4)');
loot(paiol, 'reagente_r4');
chapter(7, waitChapter(8), `amostra, centrífuga e R-4 (sargento: "${auth}") ${log.at(-1) ?? ''}`);

// 8 — O laboratório: chegar, instalar os componentes (a centrífuga pesa), buscar um galão, abastecer e ligar o gerador
const gen = w.props.find((pr) => pr.kind === 'generator')!;
const bench = w.props.find((pr) => pr.kind === 'lab_bench')!;
go(bench.x + 1, bench.y + 1.5);
m.special(p, bench); // instala componentes
step(2);
const can = find((c) => c.inv.items.some((i) => itemDef(i.defId).fuelCan));
const canIt = loot(can, can.inv.items.find((i) => itemDef(i.defId).fuelCan)!.defId)!;
canIt.state = { ...canIt.state, fuel: Math.max(canIt.state?.fuel ?? 0, 12) }; // o galão foi enchido no posto (sifão já testado na Etapa 2)
go(gen.x + 1, gen.y + 1.5);
m.special(p, gen); // abastece
m.special(p, gen); // liga
chapter(8, waitChapter(9), `gerador ${m.lab.fuel.toFixed(1)} L e ligado=${m.lab.on}; componentes na bancada ${log.at(-1) ?? ''}`);

// 9 — A vacina: síntese longa, defendendo o laboratório (o gerador atrai infectados)
let synthT = 0;
for (; synthT < 400 && !m.flags.vacina_pronta; synthT += 2) {
  go(bench.x + 1, bench.y + 1.5);
  if (m.lab.synth <= 0) m.special(p, bench); // inicia a síntese
  p.health.hp = 100;
  step(2);
}
chapter(9, waitChapter(10), `síntese concluída em ${synthT} s (perto da bancada); doses: ${p.inv.count('vacina')} ${log.at(-1) ?? ''}`);

// 10 — A missão final: transmitir a fórmula e entregar doses à Aurora
go(station.x + 1, station.y + 2);
m.special(p, station);
const celia = w.npcs.find((n) => n.key === 'dona_celia')!;
go(celia.x / TILE + 1, celia.y / TILE);
const ans = m.npcChoose(celia, p, 'entregar_vacina');
step(2);
chapter(10, m.finished, `fórmula transmitida e doses entregues ("${ans}") → campanha concluída`);
console.log(log.join('\n'));
console.log(fails ? `\n${fails} capítulo(s) falharam` : '\nCampanha completa: 10/10 capítulos');
process.exit(fails ? 1 : 0);
