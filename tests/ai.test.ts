// Testes de IA sem navegador: arrombamento de portas, NPC atravessando portas,
// propagação de som através de paredes e "soak test" com o jogador se movendo aleatoriamente.
import { World, EMPTY_COMMAND } from '../src/world/World';
import { Simulation } from '../src/systems/Simulation';
import { TILE } from '../src/config';
import { toggleDoor } from '../src/systems/Interaction';

const step = (sim: Simulation, s: number, cmd = {}) => { for (let i = 0; i < Math.round(s * 60); i++) sim.step(1 / 60, { ...EMPTY_COMMAND, aimX: sim.world.player.x, aimY: sim.world.player.y - 10, ...cmd }); };
let fails = 0;
const check = (name: string, cond: boolean, info = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name} ${info}`); if (!cond) fails++; };

{ // 1) zumbi arromba a porta da frente para chegar ao jogador trancado na Casa 1
  const w = new World(); const sim = new Simulation(w);
  w.zombies.length = 0; w.allies[0].x = 999 * 16;
  const p = w.player; p.x = 12.5 * TILE; p.y = 22.5 * TILE;
  const front = w.map.doorAt(11, 25)!; const back = w.map.doorAt(21, 17)!;
  check('portas começam fechadas', !front.open && !back.open);
  const z = w.spawnZombie(11.5 * TILE, 29.5 * TILE, 'comum');
  z.targetId = p.id; z.lastKnown = { x: p.x, y: p.y }; z.setState('perseguir'); z.lostT = 2;
  let t = 0; let bashed = false;
  while (t < 60 && !front.broken) { step(sim, 0.5); t += 0.5; if (front.hp < front.maxHp) bashed = true; }
  check('zumbi bate na porta', bashed, `hp porta ${front.hp}`);
  check('porta arrombada', front.broken, `em ${t}s`);
  step(sim, 8);
  check('zumbi entra na casa', w.map.buildingAtPx(z.x, z.y) === 0, `estado ${z.state}`);
}

{ // 2) NPC segue o jogador e abre portas fechadas
  const w = new World(); const sim = new Simulation(w);
  w.zombies.length = 0;
  const p = w.player; const el = w.allies[0];
  el.mode = 'seguir';
  // jogador sai pela porta da frente e fecha atrás de si
  const front = w.map.doorAt(11, 25)!;
  front.open = true;
  p.x = 11.5 * TILE; p.y = 30.5 * TILE;
  step(sim, 0.5);
  front.open = false;
  step(sim, 12);
  const d = Math.hypot(el.x - p.x, el.y - p.y) / TILE;
  check('NPC abriu a porta e alcançou o jogador', front.open && d < 4, `distância ${d.toFixed(1)} tiles, porta ${front.open ? 'aberta' : 'fechada'}`);
}

{ // 3) som abafado por paredes: disparo dentro de casa x na rua
  const w = new World(); const sim = new Simulation(w);
  const inside = { x: 12.5 * TILE, y: 21.5 * TILE };
  w.makeNoise(inside.x, inside.y, 30, 'disparo', true, null);
  const cIn = sim.noise.costAt(11, 40);
  w.makeNoise(11.5 * TILE, 30.5 * TILE, 30, 'disparo', true, null);
  const cOut = sim.noise.costAt(11, 40);
  check('paredes/portas fechadas abafam o som', cIn > cOut, `custo até a avenida: dentro=${cIn.toFixed(1)} fora=${cOut.toFixed(1)}`);
}

{ // 4) agachado faz menos barulho: nº de zumbis que ouvem passos
  const count = (crouch: boolean, run: boolean) => {
    const w = new World(); const sim = new Simulation(w);
    w.player.x = 40 * TILE; w.player.y = 46.5 * TILE; w.player.crouch = crouch;
    let heard = 0;
    w.events.on('noise', () => {});
    step(sim, 3, { mx: 1, run });
    for (const z of w.zombies) if (z.heard) heard++;
    return heard;
  };
  const a = count(true, false), b = count(false, false), c = count(false, true);
  check('agachar < andar < correr (ruído)', a <= b && b <= c && c > a, `ouviram: agachado=${a}, andando=${b}, correndo=${c}`);
}

{ // 5) soak test: 5 minutos de jogo com movimento aleatório e tiros
  const w = new World(); const sim = new Simulation(w);
  let errs = 0; let nan = 0; let deaths = 0;
  w.events.on('playerDied', () => deaths++);
  const { respawnPlayer } = await import('../src/systems/Respawn');
  const { createItem } = await import('../src/data/items');
  const g = createItem('pistola'); g.state = { ammo: 10 }; w.player.inv.add(g); w.player.equipped.arma = g.uid; w.player.inv.add(createItem('municao_9mm', 60));
  let mx = 1, my = 0;
  const t0 = performance.now();
  for (let i = 0; i < 60 * 300; i++) {
    if (i % 90 === 0) { mx = Math.round(Math.random() * 2 - 1); my = Math.round(Math.random() * 2 - 1); }
    try {
      const p = w.player;
      sim.step(1 / 60, { ...EMPTY_COMMAND, mx, my, run: i % 600 < 200, aimX: p.x + mx * 40 + 1, aimY: p.y + my * 40, attackPressed: i % 240 === 0, attack: i % 50 < 3, reload: i % 900 === 0, interact: i % 120 === 0 });
      if (!p.alive && i % 120 === 0) respawnPlayer(w);
    } catch (e) { errs++; if (errs < 3) console.error(e); }
    for (const z of w.zombies) if (!isFinite(z.x) || !isFinite(z.y)) nan++;
  }
  const ms = performance.now() - t0;
  const inside = w.zombies.filter((z) => w.map.solidPx(z.x, z.y)).length;
  check('soak 5 min sem exceções', errs === 0, `exceções=${errs}`);
  check('nenhuma posição inválida', nan === 0 && inside === 0, `NaN=${nan}, dentro de sólidos=${inside}`);
  check('desempenho da simulação', ms / (60 * 300) < 1, `${(ms / (60 * 300)).toFixed(3)} ms/passo, zumbis restantes ${w.zombies.length}, abatidos ${w.stats.zombiesKilled}, mortes ${deaths}`);
}
console.log(fails ? `\n${fails} falha(s)` : '\ntodos os testes de IA passaram');
