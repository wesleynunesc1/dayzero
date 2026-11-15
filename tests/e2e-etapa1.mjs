// Requer: npm i -D playwright && npx playwright install chromium
// Uso: npm run dev (em outro terminal) e depois: URL=http://localhost:5173 node tests/e2e-etapa1.mjs
import { chromium } from 'playwright';
const W = Number(process.env.VW || 1280), H = Number(process.env.VH || 720);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const results = [];
const ok = (n, name, pass, info = '') => { results.push({ n, name, pass, info }); console.log(`${pass ? 'PASSOU' : 'FALHOU'}  ${String(n).padStart(2)} ${name} ${info}`); };
const shot = (name) => page.screenshot({ path: `./tests/capturas/${name}.png` });
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
// pausa o loop automático para os testes determinísticos usarem step()
const freeze = () => ev(() => { window.__oua.game.timeScale = 0; });
const unfreeze = () => ev(() => { window.__oua.game.timeScale = 1; });
const aimAt = (dx, dy) => ev(([dx, dy]) => { const p = window.__oua.world.player; p.aimX = p.x + dx; p.aimY = p.y + dy; p.facing = Math.atan2(dy, dx); }, [dx, dy]);

await page.goto(process.env.URL || 'http://localhost:5173');
await wait(800);
// 1
await page.click('[data-a=start]');
await wait(500);
ok(1, 'Abrir o jogo e iniciar a partida', await ev(() => window.__oua.game.state === 'playing'));

// 2 movimento real pelo teclado
const p0 = await ev(() => ({ x: window.__oua.world.player.x, y: window.__oua.world.player.y }));
await page.mouse.move(W / 2, H * 0.8);
await page.keyboard.down('KeyS'); await wait(450); await page.keyboard.up('KeyS');
await page.keyboard.down('KeyD'); await wait(350); await page.keyboard.up('KeyD');
const p1 = await ev(() => ({ x: window.__oua.world.player.x, y: window.__oua.world.player.y }));
ok(2, 'Movimentar o personagem (WASD)', p1.y > p0.y + 10 && p1.x > p0.x + 5, `(${p0.x|0},${p0.y|0}) -> (${p1.x|0},${p1.y|0})`);
// colisão: tentar atravessar a parede da sala por 1,5 s
await ev(() => window.__oua.teleport(9, 18));
await page.keyboard.down('KeyA'); await wait(900); await page.keyboard.up('KeyA');
const wallX = await ev(() => window.__oua.world.player.x);
ok(2, '…sem atravessar paredes', wallX > 8 * 16 + 4, `x=${wallX.toFixed(1)} (parede termina em ${9*16})`);

// 3 entrar em uma casa: Casa 2 pela porta da frente
await freeze();
await ev(() => { const a = window.__oua; a.teleport(33, 25); });
await aimAt(0, -30);
const doorLabel = await ev(() => window.__oua.interact());
await ev(() => window.__oua.step(0.3));
await ev(() => window.__oua.step(1.6, { my: -1, aimX: window.__oua.world.player.x, aimY: window.__oua.world.player.y - 40 }));
const inB = await ev(() => { const w = window.__oua.world; const b = w.buildingOf(w.player); return b ? b.name : null; });
ok(3, 'Entrar em uma casa', inB === 'Casa 2', `porta: "${doorLabel}" → dentro de: ${inB}`);
await unfreeze(); await wait(300); await shot('t03-casa2');
await freeze();

// 4 abrir recipiente e coletar item (Casa 1, armário da cozinha)
await ev(() => window.__oua.teleport(16, 16));
await aimAt(0, -20);
const lab4 = await ev(() => window.__oua.interact());
await ev(() => window.__oua.step(0.7));
const opened = await ev(() => window.__oua.world.player.openContainer);
await ev(() => window.__oua.takeAll());
const inv4 = await ev(() => window.__oua.world.player.inv.items.map((i) => i.defId));
ok(4, 'Abrir um recipiente e coletar item', !!opened && inv4.length > 0, `"${lab4}" → ${inv4.join(', ')}`);
await unfreeze(); await wait(400); await shot('t04-recipiente');

// 5 inventário e peso
await page.keyboard.press('Escape'); await wait(150);
await page.keyboard.press('KeyI'); await wait(300);
const invTxt = await ev(() => document.getElementById('inventory').innerText);
const w5 = await ev(() => window.__oua.world.player.inv.weight());
ok(5, 'Abrir inventário e conferir peso', invTxt.toLowerCase().includes('peso total') && w5 > 0, `peso=${w5.toFixed(2)} kg`);
await shot('t05-inventario');
await page.keyboard.press('KeyI'); await wait(150);
await freeze();

// 6 comida no mercantil
await ev(() => window.__oua.teleport(78, 26));
await aimAt(0, -20);
const lab6 = await ev(() => window.__oua.interact());
await ev(() => window.__oua.step(0.7));
const food = await ev(() => { const w = window.__oua.world; const c = w.getContainer(w.player.openContainer); return c ? c.inv.items.map((i) => i.defId) : []; });
await ev(() => window.__oua.takeAll());
const hasFood = await ev(() => window.__oua.world.player.inv.items.some((i) => ['feijao_lata','sardinha','biscoito','barra_cereal','chocolate','arroz','macarrao_inst','pao_forma'].includes(i.defId)));
ok(6, 'Encontrar comida no mercantil', hasFood, `"${lab6}": ${food.join(', ')}`);
await ev(() => { const w = window.__oua.world; w.player.openContainer = null; w.events.emit('closeContainer', {}); });
// esvazia zumbis do mercantil próximos (para a captura)
await unfreeze(); await wait(400); await shot('t06-mercantil'); await freeze();

// 7 arma na delegacia (arsenal)
await ev(() => window.__oua.teleport(101, 70));
await aimAt(20, 0);
const lab7 = await ev(() => window.__oua.interact());
await ev(() => window.__oua.step(0.7));
await ev(() => window.__oua.takeAll());
const gotGun = await ev(() => window.__oua.itemAction('equip_arma', 'pistola'));
const gun = await ev(() => { const p = window.__oua.world.player; const it = p.weaponItem; return it ? { id: it.defId, ammo: it.state.ammo, reserve: p.inv.count('municao_9mm') } : null; });
ok(7, 'Encontrar uma arma na delegacia', gotGun && gun?.id === 'pistola', `"${lab7}" → ${JSON.stringify(gun)}`);
await ev(() => { const w = window.__oua.world; w.player.openContainer = null; w.events.emit('closeContainer', {}); });

// 8 disparo atrai zumbis
await ev(() => { const a = window.__oua; a.teleport(96, 46); const w = a.world; w.player.health.hp = 100; });
await aimAt(-60, 0);
const before = await ev(() => { const w = window.__oua.world; const p = w.player; return w.zombies.map((z) => ({ id: z.id, d: Math.hypot(z.x - p.x, z.y - p.y), s: z.state })); });
await ev(() => { const a = window.__oua; const p = a.world.player; a.step(1 / 60, { attackPressed: true, aimX: p.x - 60, aimY: p.y }); });
const after = await ev(() => { const w = window.__oua.world; return w.zombies.map((z) => ({ id: z.id, s: z.state, heard: !!z.heard && w.time - z.heard.t < 1 })); });
const near = before.filter((b) => b.d < 26 * 16);
const alerted = after.filter((a) => a.heard).length;
const alertedNear = near.filter((b) => after.find((a) => a.id === b.id)?.heard).length;
const shots = await ev(() => window.__oua.world.stats.shotsFired);
ok(8, 'Disparar e atrair zumbis próximos', shots === 1 && alertedNear >= Math.min(5, near.length) && alerted >= 5, `${alerted} zumbis ouviram o disparo (${alertedNear}/${near.length} a menos de 26 tiles)`);
const heardIds = after.filter((a) => a.heard).map((a) => a.id);
const d0 = await ev((ids) => { const w = window.__oua.world; const p = w.player; const zs = w.zombies.filter((z) => ids.includes(z.id)); return zs.reduce((s, z) => s + Math.hypot(z.x - p.x, z.y - p.y), 0) / Math.max(1, zs.length); }, heardIds);
await ev(() => window.__oua.step(4, { aimX: window.__oua.world.player.x - 60, aimY: window.__oua.world.player.y }));
// mede os MESMOS zumbis que ouviram o disparo (o mundo maior tem outros ruídos acontecendo)
const d1 = await ev((ids) => { const w = window.__oua.world; const p = w.player; const zs = w.zombies.filter((z) => ids.includes(z.id)); return zs.reduce((s, z) => s + Math.hypot(z.x - p.x, z.y - p.y), 0) / Math.max(1, zs.length); }, heardIds);
ok(8, '…e eles se aproximam caminhando (sem teleporte)', d1 < d0 - 20, `distância média ${(d0/16).toFixed(1)} → ${(d1/16).toFixed(1)} tiles em 4 s`);
await unfreeze(); await wait(500); await shot('t08-disparo'); await freeze();

// 9 fugir: zumbi perde contato visual e procura
const r9 = await ev(() => {
  const a = window.__oua; const w = a.world; const p = w.player;
  // afasta o jogador da horda e coloca um zumbi perseguindo
  a.teleport(30, 34);
  for (const z of w.zombies) if (Math.hypot(z.x - p.x, z.y - p.y) < 20 * 16) { z.x += 0; }
  const z = w.spawnZombie(p.x + 5 * 16, p.y, 'comum');
  z.targetId = p.id; z.lastKnown = { x: p.x, y: p.y }; z.setState('perseguir');
  a.step(0.5, { aimX: z.x, aimY: z.y });
  const states = [z.state];
  // jogador foge correndo para dentro do quintal da Casa 1 e some atrás da cerca/casa
  a.teleport(13, 30);
  for (let i = 0; i < 40; i++) { a.step(0.25, { aimX: p.x, aimY: p.y + 30 }); if (states[states.length - 1] !== z.state) states.push(z.state); }
  return { states, alive: z.alive };
});
ok(9, 'Fugir e observar o zumbi procurar o jogador', r9.states.includes('procurar'), `estados: ${r9.states.join(' → ')}`);

// 10 receber dano e sangrar
const r10 = await ev(() => {
  const a = window.__oua; const w = a.world; const p = w.player;
  a.teleport(20, 34); p.health.hp = 100; p.health.wounds = []; p.equipped.corpo = null;
  const z = w.spawnZombie(p.x + 9, p.y, 'comum');
  z.targetId = p.id; z.lastKnown = { x: p.x, y: p.y }; z.setState('atacar');
  let bled = false; let t = 0;
  while (t < 20 && !bled) { a.step(0.25, { aimX: z.x, aimY: z.y }); t += 0.25; bled = p.health.bleeding; }
  const res = { bled, hp: p.health.hp, wounds: p.health.wounds.map((x) => x.type), infected: p.health.infected, t };
  // remove o zumbi para os próximos testes
  w.zombies.splice(w.zombies.indexOf(z), 1);
  return res;
});
ok(10, 'Receber dano e sofrer sangramento', r10.bled, `após ${r10.t}s: vida ${r10.hp.toFixed(0)}, ferimentos [${r10.wounds}]${r10.infected ? ' (houve mordida → infectado)' : ''}`);
await unfreeze(); await wait(300); await page.keyboard.press('KeyH'); await wait(300); await shot('t10-condicao'); await page.keyboard.press('KeyH'); await freeze();

// 11 usar kit médico (cura apenas um ferimento por uso)
const r11 = await ev(() => {
  const a = window.__oua; const w = a.world; const p = w.player;
  p.health.infected = false; p.health.infection = 0; p.health.infectionStage = 0;
  p.health.wounds = [];
  p.health.addWound('laceracao'); p.health.addWound('arranhao');
  a.give('kit_medico');
  const bleedBefore = p.health.bleedRate;
  a.itemAction('treat', 'kit_medico');
  a.step(3.2, { aimX: p.x + 10, aimY: p.y });
  const kit = p.inv.findDef('kit_medico');
  return { bleedBefore, bleedAfter: p.health.bleedRate, treated: p.health.wounds.filter((x) => x.treated).length, total: p.health.wounds.length, uses: kit?.state?.uses };
});
ok(11, 'Utilizar um kit médico', r11.treated === 1 && r11.bleedAfter < r11.bleedBefore && r11.uses === 2, `sangramento ${r11.bleedBefore.toFixed(2)} → ${r11.bleedAfter.toFixed(2)}/s, ${r11.treated}/${r11.total} ferimentos tratados (não cura tudo de uma vez), usos restantes ${r11.uses}`);

// 12 incapacitado + socorro do NPC
const r12 = await ev(() => {
  const a = window.__oua; const w = a.world; const p = w.player; const el = w.allies[0];
  a.teleport(12, 20);
  el.x = 13 * 16; el.y = 17 * 16; el.mode = 'seguir'; el.state = 'seguindo'; el.hp = 100;
  for (const z of w.zombies.slice()) if (Math.hypot(z.x - p.x, z.y - p.y) < 25 * 16) w.zombies.splice(w.zombies.indexOf(z), 1);
  p.health.wounds = []; p.health.addWound('laceracao'); p.health.hp = 16;
  a.step(0.2, {});
  const down = p.isDown;
  const kitBefore = el.medkit()?.state?.uses;
  let t = 0; while (t < 15 && p.isDown) { a.step(0.25, {}); t += 0.25; }
  return { down, up: !p.isDown, alive: p.alive, t, hp: p.health.hp, bleeding: p.health.bleeding, kitBefore, kitAfter: el.medkit()?.state?.uses ?? 0, allyState: el.state };
});
ok(12, 'Ficar incapacitado e ser socorrido pelo NPC', r12.down && r12.up && r12.alive && !r12.bleeding, `caiu=${r12.down}, levantou após ${r12.t}s, vida ${r12.hp.toFixed(0)}, kit do Elias ${r12.kitBefore}→${r12.kitAfter}`);
await unfreeze(); await wait(400); await shot('t12-socorro'); await freeze();

// 13/14 morrer, retornar e equipamentos permanecem
const r13 = await ev(() => {
  const a = window.__oua; const w = a.world; const p = w.player;
  a.teleport(26, 46);
  const deathPos = { x: p.x, y: p.y };
  const carried = p.inv.items.map((i) => i.defId);
  w.allies[0].mode = 'aguardar';
  p.health.wounds = []; p.health.addWound('laceracao'); p.health.hp = 0.5; p.health.incapacitated = true;
  a.step(2, {});
  const dead = !p.alive;
  const corpse = w.corpses.find((c) => c.isPlayer);
  return { dead, deathPos, carried, corpse: corpse ? { x: corpse.x, y: corpse.y, items: corpse.container.inv.items.map((i) => i.defId) } : null };
});
await unfreeze(); await wait(2300); await shot('t13-morte');
const deathVisible = await ev(() => !document.getElementById('death').classList.contains('hidden'));
await page.click('[data-a=respawn]'); await wait(400);
const r13b = await ev(() => { const w = window.__oua.world; const p = w.player; return { alive: p.alive, x: p.x, y: p.y, inv: p.inv.items.map((i) => i.defId), weapon: p.weaponItem?.defId ?? null, building: w.buildingOf(p)?.name ?? null }; });
ok(13, 'Morrer e testar o retorno', r13.dead && deathVisible && r13b.alive && !r13b.weapon, `retornou em: ${r13b.building ?? `(${(r13b.x/16).toFixed(0)},${(r13b.y/16).toFixed(0)})`}, inventário: [${r13b.inv}]`);
const kept = r13.corpse && r13.carried.every((id) => r13.corpse.items.includes(id)) && Math.hypot(r13.corpse.x - r13.deathPos.x, r13.corpse.y - r13.deathPos.y) < 1;
ok(14, 'Equipamentos permanecem no local da morte', !!kept, `corpo em (${(r13.deathPos.x/16).toFixed(1)}, ${(r13.deathPos.y/16).toFixed(1)}) com [${r13.corpse?.items}]`);
await freeze();
// recuperar do corpo
const r14 = await ev(() => { const a = window.__oua; const w = a.world; const c = w.corpses.find((k) => k.isPlayer); a.teleport(Math.floor(c.x / 16), Math.floor(c.y / 16) - 1); const p = w.player; p.aimX = c.x; p.aimY = c.y; p.facing = Math.atan2(c.y - p.y, c.x - p.x); const lab = a.interact(); a.step(0.3); const open = w.player.openContainer === c.container.id; return { lab, open }; });
ok(14, '…e podem ser saqueados do próprio corpo', r14.open, `"${r14.lab}"`);
await ev(() => { const w = window.__oua.world; w.player.openContainer = null; });

// 15 mapa rasgado (Casa 2) — e M só funciona depois de encontrar
await unfreeze();
await page.keyboard.press('KeyM'); await wait(200);
const mapBefore = await ev(() => !document.getElementById('mapview').classList.contains('hidden'));
await freeze();
await ev(() => window.__oua.teleport(38, 14));
await aimAt(0, -20);
const lab15 = await ev(() => window.__oua.interact());
await ev(() => window.__oua.step(0.7));
await ev(() => window.__oua.takeAll());
const hasMap = await ev(() => window.__oua.world.player.inv.count('mapa_rasgado') > 0);
await unfreeze();
await page.keyboard.press('Escape'); await wait(100);
await page.keyboard.press('KeyM'); await wait(400);
const mapOpen = await ev(() => !document.getElementById('mapview').classList.contains('hidden'));
await shot('t15-mapa-rasgado');
ok(15, 'Encontrar um mapa rasgado', !mapBefore && hasMap && mapOpen, `M antes de achar: ${mapBefore ? 'abriu (erro)' : 'bloqueado'}; "${lab15}"`);
await page.keyboard.press('KeyM'); await wait(100);
await freeze();

// 16 fragmento (Casa 4) e combinação
await ev(() => window.__oua.teleport(42, 69));
await aimAt(0, -20);
const lab16 = await ev(() => window.__oua.interact());
await ev(() => window.__oua.step(0.7));
await ev(() => window.__oua.takeAll());
await ev(() => { const w = window.__oua.world; w.player.openContainer = null; });
const near16 = await ev(() => { const w = window.__oua.world; const p = w.player; const n = w.zombies.filter((z) => Math.hypot(z.x - p.x, z.y - p.y) < 6 * 16).map((z) => `${z.ztype}:${z.state}`); for (const z of w.zombies.slice()) if (Math.hypot(z.x - p.x, z.y - p.y) < 12 * 16) w.zombies.splice(w.zombies.indexOf(z), 1); return n; });
console.log('   (zumbis perto antes da combinação:', near16.join(', ') || 'nenhum', ')');
await ev(() => window.__oua.itemAction('combine_map', 'fragmento_mapa'));
await ev(() => window.__oua.step(1.8));
const r16 = await ev(() => { const inv = window.__oua.world.player.inv; return { full: inv.count('mapa_completo'), torn: inv.count('mapa_rasgado'), frag: inv.count('fragmento_mapa') }; });
await unfreeze();
await page.keyboard.press('KeyM'); await wait(400);
await shot('t16-mapa-completo');
ok(16, 'Encontrar e combinar o fragmento', r16.full === 1 && r16.torn === 0 && r16.frag === 0, `"${lab16}" → ${JSON.stringify(r16)}`);
await page.keyboard.press('KeyM'); await wait(100);

// 17 sem minimapa / rastreamento
const r17 = await ev(() => {
  const ui = document.getElementById('ui');
  const txt = ui.innerText.toLowerCase();
  const canvases = ui.querySelectorAll('canvas').length; // apenas o canvas do mapa de papel
  const bad = ['minimapa', 'radar', 'gps'].filter((k) => txt.includes(k));
  return { canvases, bad, hud: [...document.querySelectorAll('#hud-left .label, #hud-right .label')].map((e) => e.textContent) };
});
ok(17, 'Sem minimapa ou rastreamento automático', r17.canvases === 1 && r17.bad.length === 0, `HUD: ${r17.hud.join(', ')}`);

// 18 desempenho com horda perseguindo + erros no console
await ev(() => { const a = window.__oua; a.teleport(100, 46); const w = a.world; w.player.health.hp = 100; w.player.health.wounds = []; w.makeNoise(w.player.x, w.player.y, 30, 'disparo', true, w.player.id); window.__oua.game.showStats = true; });
await page.mouse.move(W * 0.3, H / 2);
await page.keyboard.down('KeyA'); await wait(2500); await page.keyboard.up('KeyA');
await shot('t18-horda');
const perf = await page.evaluate(async () => {
  const g = window.__oua.game; let frames = 0; const t0 = performance.now();
  await new Promise((r) => { const f = () => { frames++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); });
  return { fps: frames / ((performance.now() - t0) / 1000), sim: g.sim.stepMs, render: g.renderer.frameMs, zombies: g.world.zombies.length, chasing: g.world.zombies.filter((z) => z.state === 'perseguir' || z.state === 'atacar').length };
});
ok(18, 'Sem erros no console e sem problemas graves de desempenho', errors.length === 0 && perf.render < 16, `fps=${perf.fps.toFixed(0)} (headless), sim=${perf.sim.toFixed(2)}ms/passo, render=${perf.render.toFixed(1)}ms, ${perf.chasing} zumbis perseguindo; erros: ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 10));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} verificações passaram`);
await browser.close();
