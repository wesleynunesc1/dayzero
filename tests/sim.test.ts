import { World, EMPTY_COMMAND } from '../src/world/World';
import { Simulation } from '../src/systems/Simulation';
import { TILE } from '../src/config';
const w = new World();
const sim = new Simulation(w);
const msgs: string[] = [];
w.events.on('message', (m) => msgs.push(m.text));
let t0 = performance.now();
const cmd = { ...EMPTY_COMMAND, aimX: w.player.x, aimY: w.player.y - 20 };
for (let i = 0; i < 60 * 30; i++) sim.step(1 / 60, cmd);
console.log('30s sim ms', (performance.now() - t0).toFixed(0), 'zombies', w.zombies.length);
// zombies inside solid?
let bad = 0;
for (const z of w.zombies) if (w.map.solidPx(z.x, z.y)) bad++;
console.log('zombies inside solid:', bad);
const states: Record<string, number> = {};
for (const z of w.zombies) states[z.state] = (states[z.state] ?? 0) + 1;
console.log(states);
// gunshot test near horde
w.player.x = 95 * TILE; w.player.y = 46.5 * TILE;
w.makeNoise(w.player.x, w.player.y, 30, 'disparo', true, w.player.id);
const inv: Record<string, number> = {};
for (const z of w.zombies) inv[z.state] = (inv[z.state] ?? 0) + 1;
console.log('after shot', inv);
console.log('player alive', w.player.alive, 'hp', w.player.health.hp.toFixed(1), msgs.slice(-5));
