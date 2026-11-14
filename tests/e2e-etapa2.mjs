// Requer: npm i -D playwright && npx playwright install chromium
// Uso: npm run dev (em outro terminal) e depois: URL=http://localhost:5173 node tests/e2e-etapa2.mjs
import { chromium } from 'playwright';
const W = Number(process.env.VW || 1280), H = Number(process.env.VH || 720);
const URL = process.env.URL || 'http://localhost:5173';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const res = [];
const ok = (n, name, pass, info = '') => { res.push(pass); console.log(`${pass ? 'PASSOU' : 'FALHOU'}  ${String(n).padStart(2)} ${name} ${info}`); };
const ev = (fn, a) => page.evaluate(fn, a);
const wait = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `./tests/capturas/e2-${n}.png` });
const st = () => ev(() => { const w = window.__oua.world; const p = w.player; return { x: p.x / 16, y: p.y / 16, hunger: p.hunger, thirst: p.thirst, fatigue: p.fatigue, stamina: p.stamina, prompt: document.getElementById('prompt').innerText, veh: p.vehicleId, clock: w.clockText() }; });
const walkUntil = async (key, text, maxMs = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < maxMs) { if ((await st()).prompt.includes(text)) return true; await page.keyboard.down(key); await wait(60); await page.keyboard.up(key); } return (await st()).prompt.includes(text); };

await page.goto(URL); await wait(500);
await ev(() => localStorage.clear());
await page.reload(); await wait(500);
const hasContinue0 = await ev(() => !document.querySelector('[data-a=continue]').classList.contains('hidden'));
await page.click('[data-a=start]'); await wait(400);
const hud = await ev(() => [...document.querySelectorAll('#hud-left .label')].map((e) => e.textContent));
ok('UI', 'HUD mostra saúde, fome, sede, energia e fôlego', ['Saúde', 'Fome', 'Sede', 'Energia', 'Fôlego'].every((k) => hud.includes(k)), hud.join(', '));
await shot('01-hud');

// comer e beber pelo inventário (cliques reais)
await ev(() => { const a = window.__oua; a.give('biscoito', 1); a.give('agua'); const p = a.world.player; p.hunger = 50; p.thirst = 50; });
await page.keyboard.press('KeyI'); await wait(250);
await page.locator('#inventory li', { hasText: 'Pacote de biscoitos' }).first().click(); await wait(120);
await page.locator('#inventory button[data-act=consume]').click(); await wait(1700);
await page.locator('#inventory li', { hasText: 'Garrafa de água' }).first().click(); await wait(120);
await page.locator('#inventory button[data-act=consume]').click(); await wait(1200);
const s1 = await st();
ok(1, 'Comer e beber pelo inventário', s1.hunger < 45 && s1.thirst < 30, `fome 50 → ${s1.hunger.toFixed(0)}, sede 50 → ${s1.thirst.toFixed(0)}`);
await shot('02-inventario');

// crafting pela aba Fabricar
await ev(() => { window.__oua.give('tiras_pano', 3); });
await page.locator('#inventory button[data-tab=fabricar]').click(); await wait(200);
await shot('03-fabricar');
await page.locator('#inventory button[data-craft=bandagem_improvisada]').click(); await wait(3300);
const crafted = await ev(() => { const inv = window.__oua.world.player.inv; return { b: inv.count('bandagem_improvisada'), t: inv.count('tiras_pano') }; });
ok(15, 'Fabricar pela interface desconta materiais', crafted.b === 1 && crafted.t === 0, JSON.stringify(crafted));
await page.keyboard.press('Escape'); await wait(150);

// dormir na cama (E real) — tempo acelera
await ev(() => { const a = window.__oua; a.teleport(18, 23); a.world.player.fatigue = 75; });
await page.mouse.move(W * 0.62, H * 0.58);
await wait(200);
const foundBed = await walkUntil('KeyD', 'Dormir', 1500);
const c0 = (await st()).clock;
await page.keyboard.press('KeyE'); await wait(600);
await shot('04-dormindo');
let slept = false; for (let i = 0; i < 40 && !slept; i++) { await wait(250); slept = await ev(() => !window.__oua.world.player.sleep); }
const s5 = await st();
ok(5, 'Dormir na cama recupera energia (tempo acelerado)', foundBed && slept && s5.fatigue < 10, `${c0} → ${s5.clock}, fadiga 75 → ${s5.fatigue.toFixed(0)}`);

// caminhonete: E real, W para acelerar
await ev(() => { const a = window.__oua; const w = a.world; for (const z of w.zombies.slice()) if (Math.hypot(z.x - 112 * 16, z.y - 31 * 16) < 25 * 16) w.zombies.splice(w.zombies.indexOf(z), 1); a.teleport(110, 31); });
await page.mouse.move(W * 0.7, H * 0.5);
await wait(250);
const foundTruck = await walkUntil('KeyD', 'caminhonete', 1500);
await page.keyboard.press('KeyE'); await wait(300);
const v0 = await ev(() => { const v = window.__oua.world.vehicles[0]; return { x: v.x, y: v.y, fuel: v.fuel }; });
await page.keyboard.down('KeyW'); await wait(1600); await page.keyboard.up('KeyW');
await wait(200);
await shot('05-dirigindo');
const v1 = await ev(() => { const v = window.__oua.world.vehicles[0]; return { x: v.x, y: v.y, fuel: v.fuel, on: v.engineOn }; });
const fuelHud = await ev(() => !document.querySelector('[data-k=fuelrow]').classList.contains('hidden') ? document.querySelector('[data-k=fuel]').textContent : null);
ok(11, 'Dirigir a caminhonete com teclado real', foundTruck && Math.hypot(v1.x - v0.x, v1.y - v0.y) > 40 && v1.fuel < v0.fuel, `andou ${(Math.hypot(v1.x - v0.x, v1.y - v0.y) / 16).toFixed(1)} tiles, gasolina ${v0.fuel} → ${v1.fuel.toFixed(2)} L`);
ok('UI', 'Indicador de combustível só ao dirigir', !!fuelHud, `HUD: ${fuelHud}`);
await page.keyboard.down('KeyS'); await wait(700); await page.keyboard.up('KeyS'); await wait(600);
const spd = await ev(() => window.__oua.world.vehicles[0].speed);
await page.keyboard.press('KeyE'); await wait(300);
const out = await ev(() => !window.__oua.world.player.vehicleId);
const fuelHidden = await ev(() => document.querySelector('[data-k=fuelrow]').classList.contains('hidden'));
ok(11, 'Frear (S) e sair do veículo com E', out && fuelHidden, `velocidade ao sair ${spd.toFixed(1)}`);

// clima e noite (visual)
await ev(() => { const a = window.__oua; a.teleport(33, 44); a.setWeather('chuva'); });
await wait(900); await shot('06-chuva');
await ev(() => { window.__oua.setWeather('neblina'); });
await wait(900); await shot('07-neblina');
await ev(() => { const a = window.__oua; const w = a.world; a.teleport(12, 21); w.zombies.length = 0; a.setWeather('limpo'); a.advanceHours(15); a.teleport(33, 44); w.player.hunger = 10; w.player.thirst = 10; w.player.fatigue = 10; });
await wait(800); await shot('08-noite');
const night = await ev(() => window.__oua.world.nightFactor);
ok(17, 'Chuva, neblina e noite alteram o cenário (capturas 06–08)', night > 0.5, `nightFactor=${night.toFixed(2)} às ${(await st()).clock}`);

// barricada visível + abrigo
await ev(() => { const a = window.__oua; a.teleport(12, 21); a.advanceHours(10); const d = a.world.map.doorAt(11, 25); d.open = false; d.anim = 0; a.give('barricada'); a.give('martelo'); a.teleport(11, 24); const p = a.world.player; p.aimX = p.x; p.aimY = p.y + 40; p.facing = Math.PI / 2; });
await page.mouse.move(W / 2, H * 0.85); await wait(200);
await page.keyboard.press('KeyI'); await wait(250);
await page.locator('#inventory li', { hasText: 'Painel de barricada' }).first().click(); await wait(120);
await page.locator('#inventory button[data-act=barricade]').click(); await wait(200);
await page.keyboard.press('Escape'); await wait(4400);
const barr = await ev(() => window.__oua.world.map.doorAt(11, 25).barricades);
await shot('09-barricada');
ok(16, 'Reforçar a porta do abrigo com barricada (interface)', barr === 1, `barricadas na porta da frente: ${barr}`);

// guardar no baú, salvar pelo menu, recarregar a página e continuar
await ev(() => { const a = window.__oua; a.teleport(12, 16); const p = a.world.player; p.aimX = p.x; p.aimY = p.y - 30; p.facing = -Math.PI / 2; a.give('feijao_lata', 2); });
await page.mouse.move(W / 2, H * 0.2); await wait(200);
await page.keyboard.press('KeyE'); await wait(900);
await page.locator('#inventory li', { hasText: 'Lata de feijão' }).first().click(); await wait(100);
await page.locator('#inventory button[data-act=store]').click(); await wait(200);
await page.keyboard.press('Escape'); await wait(150);
const before = await ev(() => { const w = window.__oua.world; const p = w.player; const bau = [...w.containers.values()].find((c) => c.kind === 'bau'); const v = w.vehicles[0];
  return { bau: bau.inv.items.map((i) => `${i.defId}x${i.qty}`).join(','), inv: p.inv.items.map((i) => `${i.defId}x${i.qty}`).sort().join(','), fuel: v.fuel.toFixed(3), vx: v.x.toFixed(1), clock: w.clockText(), hunger: p.hunger.toFixed(2), barr: w.map.doorAt(11, 25).barricades, zombies: w.zombies.length, uids: window.__oua.audit().total }; });
await page.keyboard.press('Escape'); await wait(200);
await page.locator('#pause button[data-a=save]').click(); await wait(300);
await page.reload(); await wait(700);
const hasContinue = await ev(() => !document.querySelector('[data-a=continue]').classList.contains('hidden'));
await page.click('[data-a=continue]'); await wait(600);
const after = await ev(() => { const w = window.__oua.world; const p = w.player; const bau = [...w.containers.values()].find((c) => c.kind === 'bau'); const v = w.vehicles[0];
  return { bau: bau.inv.items.map((i) => `${i.defId}x${i.qty}`).join(','), inv: p.inv.items.map((i) => `${i.defId}x${i.qty}`).sort().join(','), fuel: v.fuel.toFixed(3), vx: v.x.toFixed(1), clock: w.clockText(), hunger: p.hunger.toFixed(2), barr: w.map.doorAt(11, 25).barricades, zombies: w.zombies.length, uids: window.__oua.audit().total }; });
const diff = Object.keys(before).filter((k) => before[k] !== after[k] && k !== 'clock' && k !== 'hunger');
ok(18, 'Salvar no menu, recarregar a página e continuar', !hasContinue0 && hasContinue && diff.length === 0, diff.length ? `diferenças: ${diff.map((k) => `${k}: ${before[k]} ≠ ${after[k]}`).join('; ')}` : `baú [${after.bau}], combustível ${after.fuel} L, ${after.clock}, ${after.zombies} zumbis`);
ok(19, 'Sem duplicação após recarregar', before.uids === after.uids && before.inv === after.inv, `${after.uids} itens únicos antes e depois`);
await shot('10-continuar');
ok('—', 'Sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${res.filter(Boolean).length}/${res.length} verificações passaram`);
await browser.close();
