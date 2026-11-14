// Etapa 02 — testes de lógica dos 20 cenários obrigatórios (sem navegador).
// Executar: npx tsx tests/etapa2.test.ts   (ou: bun run tests/etapa2.test.ts)
import { CONFIG, TILE } from '../src/config';
import { createItem, itemDef } from '../src/data/items';
import { craft } from '../src/systems/Crafting';
import { enterVehicle, exitVehicle, findInteractable, interact, installBarricade, startSleep } from '../src/systems/Interaction';
import { doPlayerItemAction, takeAll, takeFromContainer } from '../src/systems/ItemActions';
import { needModifiers } from '../src/systems/Needs';
import { applySave, auditUids, serializeWorld } from '../src/systems/Save';
import { Simulation } from '../src/systems/Simulation';
import { EMPTY_COMMAND, PlayerCommand, World } from '../src/world/World';

let fails = 0;
const results: string[] = [];
const check = (n: number | string, name: string, ok: boolean, info = '') => {
  const line = `${ok ? 'PASSOU' : 'FALHOU'}  ${String(n).padStart(2)} ${name}${info ? ` — ${info}` : ''}`;
  console.log(line);
  results.push(line);
  if (!ok) fails++;
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
const hours = (sim: Simulation, h: number, cmd: Partial<PlayerCommand> = {}) => step(sim, (h * 60) / CONFIG.time.minutesPerSecond, cmd);
const tp = (w: World, tx: number, ty: number) => {
  w.player.x = tx * TILE + 8;
  w.player.y = ty * TILE + 8;
};
const clearZombies = (w: World, r = 30) => {
  for (const z of w.zombies.slice()) if (Math.hypot(z.x - w.player.x, z.y - w.player.y) < r * TILE) w.zombies.splice(w.zombies.indexOf(z), 1);
};
const face = (w: World, x: number, y: number) => {
  w.player.facing = Math.atan2(y - w.player.y, x - w.player.x);
};

// 1 ─ encontrar comida e consumir
{
  const { w, sim } = fresh();
  clearZombies(w, 200);
  tp(w, 78, 26);
  face(w, 78 * TILE, 25 * TILE);
  const t = findInteractable(w)!;
  interact(w, t);
  step(sim, 0.7);
  const c = w.getContainer(w.player.openContainer!)!;
  const food = c.inv.items.find((i) => itemDef(i.defId).category === 'Comida' && itemDef(i.defId).food?.edible !== false)!;
  takeFromContainer(w, c, food.uid, 1);
  const it = w.player.inv.findDef(food.defId)!;
  w.player.hunger = 60;
  const before = w.player.hunger;
  const qty = w.player.inv.count(food.defId);
  doPlayerItemAction(w, 'consume', it.uid);
  step(sim, 1.6);
  check(1, 'Encontrar comida e consumir', w.player.hunger < before && w.player.inv.count(food.defId) === qty - 1, `${t.label}: ${itemDef(food.defId).name}, fome ${before} → ${w.player.hunger.toFixed(0)}`);
}

// 2 ─ fome aumenta gradualmente (mais com esforço), fraqueza sem dano instantâneo
{
  const { w, sim } = fresh();
  clearZombies(w, 200);
  w.player.hunger = 10;
  hours(sim, 2);
  const idle = w.player.hunger - 10;
  const { w: w2, sim: s2 } = fresh();
  clearZombies(w2, 200);
  tp(w2, 30, 45);
  w2.player.hunger = 10;
  w2.player.stamina = 100;
  // corre de um lado para o outro
  for (let k = 0; k < 8; k++) step(s2, 15, { mx: k % 2 ? 1 : -1, run: true });
  const runH = (w2.player.hunger - 10) / ((8 * 15) / 60);
  const hpBefore = w.player.health.hp;
  w.player.hunger = 95;
  step(sim, 1);
  const noInstant = w.player.health.hp >= hpBefore - 0.01;
  const weak = needModifiers(w.player).staminaMax < 1;
  check(2, 'Fome aumenta com o tempo e com esforço; fraqueza sem dano instantâneo', idle > 4 && idle < 7 && runH > idle / 2 && noInstant && weak, `+${idle.toFixed(1)} em 2 h parado; correndo ${runH.toFixed(1)}/h vs ${(idle / 2).toFixed(1)}/h; fome 95 → fôlego máx ×${needModifiers(w.player).staminaMax.toFixed(2)}, sem perda de vida`);
  // inanição extrema causa perda gradual
  w.player.hunger = 100;
  w.player.health.hp = 100;
  hours(sim, 2);
  check(2, '…inanição extrema causa perda de vida gradual', w.player.health.hp < 100 && w.player.health.hp > 90, `vida 100 → ${w.player.health.hp.toFixed(1)} em 2 h`);
}

// 3 ─ sede: perde hidratação e bebe água (garrafa reutilizável); desidratação extrema mata
{
  const { w, sim } = fresh();
  clearZombies(w, 200);
  w.player.thirst = 10;
  hours(sim, 2);
  const lost = w.player.thirst - 10;
  const bottle = createItem('agua');
  w.player.inv.add(bottle);
  const thBefore = w.player.thirst;
  const wBefore = w.player.inv.weight();
  doPlayerItemAction(w, 'consume', bottle.uid);
  step(sim, 1);
  check(3, 'Perde hidratação e consegue beber água', lost > 7 && w.player.thirst < thBefore && bottle.state!.uses === 3 && w.player.inv.weight() < wBefore, `+${lost.toFixed(1)} sede em 2 h; bebeu: ${thBefore.toFixed(0)} → ${w.player.thirst.toFixed(0)}; garrafa 4 → 3 doses, peso ${wBefore.toFixed(2)} → ${w.player.inv.weight().toFixed(2)} kg`);
  bottle.state!.uses = 0;
  check(3, '…garrafa vazia continua no inventário para ser reabastecida', !!w.player.inv.get(bottle.uid));
  w.player.thirst = 100;
  w.player.health.hp = 40;
  let t = 0;
  while (w.player.alive && t < 12) {
    hours(sim, 0.5);
    t += 0.5;
  }
  check(3, '…desidratação extrema pode matar (gradualmente)', !w.player.alive && w.player.health.deathCause === 'Desidratação', `morreu após ${t} h com vida inicial 40`);
}

// 4 ─ correr consome fôlego (e cansa mais)
{
  const { w, sim } = fresh();
  clearZombies(w, 200);
  tp(w, 30, 45);
  w.player.stamina = 100;
  step(sim, 3, { mx: 1, run: true });
  const st = w.player.stamina;
  check(4, 'Correr consome resistência', st < 75, `fôlego 100 → ${st.toFixed(0)} em 3 s de corrida`);
  w.player.fatigue = 85;
  const m = needModifiers(w.player);
  check(4, '…fadiga reduz corrida e recuperação', m.runSpeed < 1 && m.staminaRegen < 1, `exausto: corrida ×${m.runSpeed.toFixed(2)}, recuperação ×${m.staminaRegen.toFixed(2)}`);
}

// 5 ─ descanso recupera energia
{
  const { w, sim } = fresh();
  clearZombies(w, 30);
  tp(w, 18, 23);
  w.player.fatigue = 70;
  face(w, 19.5 * TILE, 23.5 * TILE);
  const t = findInteractable(w)!;
  const clock0 = w.gameMinutes;
  const h0 = w.player.hunger;
  interact(w, t);
  let n = 0;
  while (w.player.sleep && n < 20000) {
    step(sim, 1);
    n++;
  }
  const slept = (w.gameMinutes - clock0) / 60;
  check(5, 'Descanso recupera energia (cama)', t.kind === 'rest' && w.player.fatigue < 5 && slept > 3, `"${t.label}": fadiga 70 → ${w.player.fatigue.toFixed(0)} em ${slept.toFixed(1)} h de jogo; fome subiu ${(w.player.hunger - h0).toFixed(1)}`);
  w.player.fatigue = 10;
  const t2 = findInteractable(w)!;
  interact(w, t2);
  check(5, '…sem cansaço: só descanso curto (1 h)', w.player.sleep?.maxHours === 1, `"${t2.label}"`);
}

// 6 ─ inventário impede excesso de peso
{
  const { w } = fresh();
  const p = w.player;
  let added = 0;
  let refused = '';
  for (let i = 0; i < 20; i++) {
    const r = p.inv.add(createItem('rifle'));
    if (r.ok) added++;
    else refused = r.reason ?? '';
  }
  const c = w.containers.values().next().value!;
  c.inv.items.push(createItem('tabua', 6));
  const tr = takeFromContainer(w, c, c.inv.items[c.inv.items.length - 1].uid);
  check(6, 'Inventário impede excesso de peso', p.inv.weight() <= p.inv.maxWeight + 1e-6 && !!refused, `${added} rifles (3,5 kg) em ${p.inv.maxWeight} kg; recusado: "${refused}"; pilha de 6 tábuas: ${tr.ok ? `só ${tr.added} coube` : 'recusada'}`);
}

// 7/8 ─ armas consomem munição; sem munição não disparam
{
  const { w, sim } = fresh();
  clearZombies(w, 200);
  const p = w.player;
  const g = createItem('pistola');
  g.state = { ammo: 3 };
  p.inv.add(g);
  p.equipped.arma = g.uid;
  step(sim, 0.05, { attackPressed: true, aimX: p.x + 50, aimY: p.y });
  step(sim, 0.4);
  step(sim, 0.05, { attackPressed: true, aimX: p.x + 50, aimY: p.y });
  check(7, 'Armas consomem munição', g.state.ammo === 1 && w.stats.shotsFired === 2, `pistola 3 → ${g.state.ammo}, disparos ${w.stats.shotsFired}`);
  g.state.ammo = 0;
  step(sim, 0.4);
  const shots = w.stats.shotsFired;
  step(sim, 0.05, { attackPressed: true, aimX: p.x + 50, aimY: p.y });
  check(8, 'Arma sem munição não dispara', w.stats.shotsFired === shots, 'gatilho com carregador vazio: nenhum disparo');
  // rifle e munição incompatível
  const r = createItem('rifle');
  r.state = { ammo: 0 };
  p.inv.add(r);
  p.equipped.arma = r.uid;
  p.inv.add(createItem('municao_9mm', 10));
  step(sim, 0.05, { reload: true });
  step(sim, 3);
  check(8, '…recarga exige munição compatível', r.state.ammo === 0, 'rifle .308 não aceita 9mm');
  p.inv.add(createItem('municao_308', 7));
  step(sim, 0.05, { reload: true });
  step(sim, 3.2);
  check(7, '…rifle recarrega com .308 até o limite do carregador', r.state.ammo === 5 && p.inv.count('municao_308') === 2, `carregador ${r.state.ammo}/5, sobraram ${p.inv.count('municao_308')}`);
}

// 9 ─ disparos atraem infectados
{
  const { w, sim } = fresh();
  tp(w, 96, 46);
  const g = createItem('rifle');
  g.state = { ammo: 5 };
  w.player.inv.add(g);
  w.player.equipped.arma = g.uid;
  step(sim, 0.05, { attackPressed: true, aimX: w.player.x - 80, aimY: w.player.y });
  const heard = w.zombies.filter((z) => z.heard && w.time - z.heard.t < 1).length;
  check(9, 'Disparos atraem infectados próximos', heard >= 8, `${heard} infectados ouviram o rifle`);
}

// 10–13 ─ gasolina, caminhonete, pane seca, abastecimento
{
  const { w, sim } = fresh();
  clearZombies(w, 200);
  const p = w.player;
  // galão no depósito
  tp(w, 114, 16);
  face(w, 115 * TILE, 17 * TILE);
  interact(w, findInteractable(w)!);
  step(sim, 0.7);
  const cx = w.getContainer(p.openContainer!)!;
  takeFromContainer(w, cx, cx.inv.findDef('galao_gasolina')!.uid);
  const can = p.inv.findDef('galao_gasolina')!;
  // mangueira na bancada; mochila para o peso da gasolina
  p.inv.add(createItem('mangueira'));
  const bag = createItem('mochila_trilha');
  p.inv.add(bag);
  doPlayerItemAction(w, 'equip_costas', bag.uid);
  const fuelFound = can.state!.fuel!;
  // retira gasolina de um carro abandonado com combustível
  const car = w.props.find((pr) => (pr.kind === 'car' || pr.kind === 'van') && (pr.fuel ?? 0) > 0 && !pr.containerId)!;
  tp(w, car.x - 1, car.y);
  const before = car.fuel!;
  doPlayerItemAction(w, 'siphon', can.uid);
  step(sim, 10);
  check(10, 'Coletar gasolina (galão no depósito + sifão)', fuelFound > 0 && can.state!.fuel! > fuelFound && car.fuel! < before, `galão encontrado com ${fuelFound} L; sifão: carro ${before} → ${car.fuel} L, galão ${can.state!.fuel!.toFixed(1)} L`);

  const v = w.vehicles[0];
  p.x = v.x + 20;
  p.y = v.y;
  const f0 = v.fuel;
  enterVehicle(w, v);
  const x0 = v.x;
  const y0 = v.y;
  let motorNoise = 0;
  const off = w.events.on('noise', (n) => {
    if (n.kind === 'motor') motorNoise++;
  });
  step(sim, 3, { my: -1 });
  const moved = Math.hypot(v.x - x0, v.y - y0);
  check(11, 'A caminhonete funciona com combustível', moved > 40 && v.fuel < f0 && motorNoise > 0, `andou ${(moved / TILE).toFixed(1)} tiles, gasolina ${f0} → ${v.fuel.toFixed(2)} L, ${motorNoise} emissões de ruído do motor`);
  off();
  v.fuel = 0.05;
  step(sim, 6, { my: -1 });
  const stopped = !v.engineOn && v.fuel === 0;
  const xs = v.x;
  const ys = v.y;
  step(sim, 3, { my: -1 });
  check(12, 'A caminhonete para quando acaba a gasolina', stopped && Math.abs(v.speed) < 1 && Math.hypot(v.x - xs, v.y - ys) < 30, `motor ${v.engineOn ? 'ligado' : 'desligado'}, velocidade ${v.speed.toFixed(1)}`);
  exitVehicle(w, v);
  const canFuel = can.state!.fuel!;
  doPlayerItemAction(w, 'refuel', can.uid);
  step(sim, 8);
  check(13, 'O jogador consegue abastecer', v.fuel > 4 && can.state!.fuel! < canFuel, `tanque 0 → ${v.fuel.toFixed(1)} L; galão ${canFuel.toFixed(1)} → ${can.state!.fuel!.toFixed(1)} L`);
  enterVehicle(w, v);
  const x1 = v.x;
  const y1 = v.y;
  step(sim, 1.5, { my: 1, mx: 1 }); // ré esterçando (estava encostada num poste)
  step(sim, 2, { my: -1 });
  check(13, '…e volta a dirigir', Math.hypot(v.x - x1, v.y - y1) > 20, `deslocou ${(Math.hypot(v.x - x1, v.y - y1) / TILE).toFixed(1)} tiles, motor ${v.engineOn ? 'ligado' : 'desligado'}`);
  // colisão com estrutura: acelera contra a cerca
  for (let i = 0; i < 5; i++) step(sim, 1, { my: -1 });
  const solid = v.circles().some((c) => w.map.solidPx(c.x, c.y));
  check(11, '…não atravessa estruturas', !solid, `posição final (${(v.x / TILE).toFixed(1)}, ${(v.y / TILE).toFixed(1)})`);
}

// 14 ─ ferimentos e tratamentos por condição; mordida transmissora = morte imediata
{
  const { w, sim } = fresh();
  clearZombies(w, 200);
  const p = w.player;
  const h = p.health;
  h.addWound('laceracao');
  p.inv.add(createItem('curativo', 2));
  const curBlock = h.treatBlocker('curativo');
  p.inv.add(createItem('bandagem_improvisada'));
  doPlayerItemAction(w, 'treat', p.inv.findDef('bandagem_improvisada')!.uid);
  step(sim, 2.6);
  const lac = h.wounds[0];
  const dirty = lac.dirty && lac.treated;
  hours(sim, CONFIG.wounds.dirtyInfectAfterHours + 0.2);
  const infected = lac.infected;
  p.inv.add(createItem('antisseptico'));
  doPlayerItemAction(w, 'treat', p.inv.findDef('antisseptico')!.uid);
  step(sim, 1.7);
  const cleaned = !lac.dirty && !lac.infected;
  h.addWound('arranhao');
  doPlayerItemAction(w, 'treat', p.inv.findDef('curativo')!.uid);
  step(sim, 1.4);
  const scr = h.wounds.find((x) => x.type === 'arranhao')!;
  check(14, 'Ferimentos e sangramentos tratados conforme a condição', !!curBlock && dirty && infected && cleaned && scr.treated && scr.bleed === 0,
    `curativo em laceração: "${curBlock}"; bandagem improvisada deixa sujo → infeccionou após ${CONFIG.wounds.dirtyInfectAfterHours} h → antisséptico limpou; curativo tratou o arranhão`);
  const kit = createItem('kit_medico');
  p.inv.add(kit);
  h.hp = 40;
  h.addWound('laceracao');
  h.addWound('laceracao');
  doPlayerItemAction(w, 'treat', kit.uid);
  step(sim, 3.2);
  check(14, '…kit não cura tudo de uma vez', h.hp < 60 && h.wounds.filter((x) => !x.treated).length === 1, `vida 40 → ${h.hp.toFixed(0)}, 1 laceração ainda aberta`);
  // mordida que transmite: morte imediata (regra da história)
  const { w: w2 } = fresh();
  w2.player.health.addWound('mordida', 0.5);
  check(14, '…mordida que transmite o vírus é fatal imediatamente', w2.player.health.dead && w2.player.health.deathCause === 'Infecção');
  const old = CONFIG.infection.transmission.mordida;
  CONFIG.infection.transmission.mordida = 0.3;
  const { w: w3 } = fresh();
  w3.player.health.addWound('mordida', 0.5);
  CONFIG.infection.transmission.mordida = old;
  check(14, '…probabilidade de transmissão é configurável', !w3.player.health.dead && !w3.player.health.infected, 'com chance 30% e sorteio 0,5: só ferimento');
}

// 15 ─ crafting desconta materiais (e respeita condições)
{
  const { w, sim } = fresh();
  clearZombies(w, 200);
  const p = w.player;
  p.inv.add(createItem('tiras_pano', 4));
  craft(w, 'bandagem_improvisada');
  step(sim, 3.2);
  const a = p.inv.count('tiras_pano') === 1 && p.inv.count('bandagem_improvisada') === 1;
  p.inv.add(createItem('tabua', 2));
  p.inv.add(createItem('pregos', 10));
  const noHammer = craft(w, 'barricada');
  p.inv.add(createItem('martelo'));
  const wBefore = p.inv.weight();
  craft(w, 'barricada');
  step(sim, 5.2);
  const b = !noHammer && p.inv.count('tabua') === 0 && p.inv.count('pregos') === 4 && p.inv.count('barricada') === 1 && p.inv.count('martelo') === 1;
  p.inv.add(createItem('arroz'));
  p.inv.add(createItem('panela'));
  const bottle = createItem('agua');
  p.inv.add(bottle);
  tp(w, 30, 45);
  const farFromFire = craft(w, 'arroz_cozido');
  const fire = w.lights.find((l) => l.kind === 'fire')!;
  p.x = fire.x + 20;
  p.y = fire.y;
  craft(w, 'arroz_cozido');
  step(sim, 6.2);
  const c = !farFromFire && p.inv.count('arroz_cozido') === 1 && p.inv.count('arroz') === 0 && bottle.state!.uses === 2;
  check(15, 'Crafting verifica e desconta materiais', a && b && c, `bandagem (3 tiras); barricada (2 tábuas + 6 pregos, martelo preservado; sem martelo: recusado); arroz exige fogo (longe: recusado), usou 2 doses de água; peso ${wBefore.toFixed(2)} → ${p.inv.weight().toFixed(2)} kg`);
}

// 16 ─ guardar recursos no abrigo + barricada + abrigo não invulnerável
{
  const { w, sim } = fresh();
  clearZombies(w, 200);
  const p = w.player;
  tp(w, 12, 16);
  face(w, 12.5 * TILE, 15 * TILE);
  const t = findInteractable(w)!;
  interact(w, t);
  step(sim, 0.7);
  const bau = w.getContainer(p.openContainer!)!;
  const food = createItem('feijao_lata', 3);
  p.inv.add(food);
  doPlayerItemAction(w, 'store', food.uid);
  check(16, 'Guardar recursos em um abrigo', bau.inv.count('feijao_lata') === 3 && p.inv.count('feijao_lata') === 0, `"${t.label}"`);
  // reforça a porta da frente e verifica que zumbis ainda podem forçar
  p.openContainer = null;
  p.inv.add(createItem('barricada'));
  p.inv.add(createItem('martelo'));
  tp(w, 11, 24);
  face(w, 11.5 * TILE, 25.5 * TILE);
  installBarricade(w);
  step(sim, 4.2);
  const door = w.map.doorAt(11, 25)!;
  const z = w.spawnZombie(11.5 * TILE, 29.5 * TILE, 'comum');
  z.targetId = p.id;
  z.lastKnown = { x: p.x, y: p.y };
  z.setState('perseguir');
  z.lostT = 2;
  const hp0 = door.hp;
  step(sim, 25);
  check(16, '…barricada reforça a porta, mas o abrigo não é invulnerável', door.barricades === 1 && hp0 > door.maxHp - 61 && door.hp < hp0, `porta ${hp0} pts (com barricada) → ${Math.max(0, door.hp)} após 25 s de pancadas`);
}

// 17 ─ clima altera percepção (o visual é verificado no navegador)
{
  const { w } = fresh();
  w.weather.set('chuva', 5, true);
  const rainNoise = w.weather.noiseMul;
  let heardR = 0;
  w.events.on('noise', (n) => (heardR = n.radius));
  w.makeNoise(0, 0, 30, 'disparo', true);
  w.weather.set('neblina', 5, true);
  const fogVision = w.weather.visionMul;
  check(17, 'Chuva abafa sons e neblina reduz a visão', rainNoise < 1 && heardR < 30 && fogVision < 0.7, `chuva: disparo 30 → ${heardR.toFixed(0)} tiles; neblina: visão ×${fogVision.toFixed(2)}`);
  const { w: w2, sim: s2 } = fresh();
  const barrel = w2.waterSources.find((s) => s.collectsRain)!;
  const l0 = barrel.liters;
  w2.weather.set('chuva', 5, true);
  hours(s2, 1);
  check(17, '…chuva enche o barril do abrigo', barrel.liters > l0, `${l0} → ${barrel.liters.toFixed(1)} L`);
}

// 18/19 ─ salvar e carregar: estados reconstruídos, sem duplicação
{
  const { w, sim } = fresh();
  clearZombies(w, 200);
  const p = w.player;
  // altera bastante coisa
  p.hunger = 33;
  p.thirst = 44;
  p.fatigue = 55;
  p.health.hp = 77;
  p.health.addWound('laceracao');
  const g = createItem('pistola');
  g.state = { ammo: 4 };
  p.inv.add(g);
  p.equipped.arma = g.uid;
  p.inv.add(createItem('municao_9mm', 9));
  const v = w.vehicles[0];
  v.fuel = 12.3;
  v.x += 40;
  const c0 = [...w.containers.values()].find((c) => c.inv.items.length > 0)!;
  const looted = c0.inv.items.length;
  c0.inv.items = [];
  c0.searched = true;
  const bau = [...w.containers.values()].find((c) => c.kind === 'bau')!;
  bau.inv.add(createItem('agua'));
  p.x = 20 * TILE;
  p.y = 34 * TILE;
  doPlayerItemAction(w, 'drop', p.inv.add(createItem('livro')) && p.inv.findDef('livro')!.uid);
  const dropPile = w.corpses.find((k) => k.pile)!;
  w.map.doorAt(11, 25)!.barricades = 1;
  const corpse = w.createCorpse(30 * TILE, 30 * TILE, 0, p.look, 'Seu corpo', [createItem('taco_beisebol')], true, false);
  hours(sim, 0.5);
  const killed = 5;
  w.zombies.splice(0, killed);
  const data = JSON.parse(JSON.stringify(serializeWorld(w)));
  const audit = auditUids(data);

  const w2 = new World(data.seed);
  const s2 = new Simulation(w2);
  applySave(w2, data);
  const p2 = w2.player;
  const c1 = w2.containers.get(c0.id)!;
  const v2 = w2.vehicles[0];
  const ok =
    p2.hunger === p.hunger &&
    p2.thirst === p.thirst &&
    p2.fatigue === p.fatigue &&
    Math.abs(p2.health.hp - p.health.hp) < 0.01 &&
    p2.health.wounds.length === p.health.wounds.length &&
    p2.weaponItem?.state?.ammo === 4 &&
    p2.inv.count('municao_9mm') === 9 &&
    Math.abs(v2.fuel - v.fuel) < 1e-6 &&
    Math.abs(v2.x - v.x) < 1e-6 &&
    c1.inv.items.length === 0 &&
    c1.searched &&
    w2.containers.get(bau.id)!.inv.count('agua') === 1 &&
    w2.corpses.some((k) => k.pile && k.container.inv.count('livro') === 1) &&
    w2.corpses.some((k) => k.isPlayer && k.container.inv.count('taco_beisebol') === 1) &&
    w2.map.doorAt(11, 25)!.barricades === 1 &&
    w2.zombies.length === w.zombies.length &&
    Math.abs(w2.gameMinutes - w.gameMinutes) < 1e-6;
  check(18, 'Salvar e carregar reconstrói recursos e estados', ok,
    `jogador (vida/fome/sede/energia/ferimentos/arma/munição), caminhonete (${v2.fuel} L), recipiente saqueado (${looted} itens antes) segue vazio, baú, itens no chão, corpo com equipamento, barricada, ${w2.zombies.length} zumbis, relógio`);
  void dropPile;
  void corpse;
  void s2;
  // 19: sem duplicação — salva/carrega 3 vezes e compara contagens
  const countAll = (ww: World) => {
    const m = new Map<string, number>();
    const add = (items: { defId: string; qty: number }[]) => items.forEach((i) => m.set(i.defId, (m.get(i.defId) ?? 0) + i.qty));
    for (const c of ww.containers.values()) add(c.inv.items);
    for (const k of ww.corpses) add(k.container.inv.items);
    for (const a of ww.allies) add(a.inv.items);
    add(ww.player.inv.items);
    return JSON.stringify([...m].sort());
  };
  const base = countAll(w);
  let cur = w2;
  for (let i = 0; i < 3; i++) {
    const d = JSON.parse(JSON.stringify(serializeWorld(cur)));
    const nw = new World(d.seed);
    new Simulation(nw);
    applySave(nw, d);
    cur = nw;
  }
  const after = countAll(cur);
  const a2 = auditUids(serializeWorld(cur));
  let rejected = false;
  try {
    const bad = JSON.parse(JSON.stringify(data));
    bad.players[0].inventory.push(bad.players[0].inventory[0]);
    applySave(new World(bad.seed), bad);
  } catch {
    rejected = true;
  }
  check(19, 'Itens não são duplicados ao salvar e carregar', audit.duplicates.length === 0 && a2.duplicates.length === 0 && base === after && rejected,
    `${audit.total} itens únicos; contagem idêntica após 3 ciclos; save adulterado com item duplicado é recusado`);
}

// 20 ─ mecânicas da Etapa 1 (lógica): zumbi arromba porta, NPC socorre — o resto roda no navegador
{
  const { w, sim } = fresh();
  clearZombies(w, 200);
  const p = w.player;
  const el = w.allies[0];
  el.mode = 'seguir';
  p.health.addWound('laceracao');
  p.health.hp = 16;
  step(sim, 0.2);
  const down = p.isDown;
  let t = 0;
  while (p.isDown && t < 15) {
    step(sim, 0.25);
    t += 0.25;
  }
  check(20, 'Mecânicas da Etapa 1 (lógica): incapacitação + socorro do NPC', down && !p.isDown && p.alive, `levantou em ${t} s (suite de navegador da Etapa 1 roda separadamente)`);
}

console.log(fails ? `\n${fails} falha(s)` : `\n${results.length}/${results.length} verificações passaram`);
if (fails) process.exitCode = 1;
