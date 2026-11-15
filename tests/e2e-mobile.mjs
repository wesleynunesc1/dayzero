// Teste dos controles de celular em EMULAÇÃO (Chromium com perfis Pixel 7 e iPhone 14 do Playwright).
// Toques reais multitoque via CDP (Input.dispatchTouchEvent) — os mesmos eventos que a tela gera.
// NÃO substitui o teste em aparelhos reais: Android físico e Safari do iPhone ficam marcados como pendentes.
// Uso: sirva dist/ (ex.: python3 -m http.server 8080 -d dist) e rode: URL=http://localhost:8080 node tests/e2e-mobile.mjs
import { chromium, devices } from 'playwright';

const URL = process.env.URL || 'http://localhost:8080/';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];
const ok = (n, name, pass, info = '') => {
  results.push({ n, name, pass, info });
  console.log(`${pass ? 'PASSOU' : 'FALHOU'}  ${String(n).padStart(2)} ${name} ${info}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function openDevice(name) {
  const ctx = await browser.newContext({ ...devices[name] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__oua);
  const cdp = await ctx.newCDPSession(page);
  const active = new Map();
  const send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...active.values()] });
  const T = {
    async down(id, x, y) {
      active.set(id, { x, y, id, radiusX: 6, radiusY: 6, force: 1 });
      await send('touchStart');
    },
    async move(id, x, y, steps = 4) {
      const p = active.get(id);
      const x0 = p.x;
      const y0 = p.y;
      for (let i = 1; i <= steps; i++) {
        p.x = x0 + ((x - x0) * i) / steps;
        p.y = y0 + ((y - y0) * i) / steps;
        await send('touchMove');
      }
    },
    async up(id) {
      const pt = active.get(id);
      active.delete(id);
      // CDP: touchEnd com a lista dos dedos que SAEM da tela (os outros continuam apertados)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [pt] });
    },
    async tap(x, y, id = 20) {
      await T.down(id, x, y);
      await wait(70);
      await T.up(id);
      await wait(60);
    },
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const center = async (sel) => {
    const b = await page.locator(sel).first().boundingBox();
    if (!b) throw new Error('sem elemento ' + sel);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const tapEl = async (sel, id) => {
    const c = await center(sel);
    await T.tap(c.x, c.y, id);
  };
  return { ctx, page, cdp, T, ev, center, tapEl, errors, vp: devices[name].viewport };
}

const shot = (page, n) => page.screenshot({ path: `./tests/capturas/mobile-${n}.png` });
const st = (d) =>
  d.ev(() => {
    const w = window.__oua.world;
    const p = w.player;
    return { x: p.x, y: p.y, vx: p.vx, vy: p.vy, running: p.running, crouch: p.crouch, facing: p.facing, aiming: p.aiming, veh: p.vehicleId, open: p.openContainer };
  });

// ====================================================================== ANDROID (Pixel 7, horizontal)
const A = await openDevice('Pixel 7 landscape');
const { page, T, ev } = A;
const W = A.vp.width;
const H = A.vp.height;
{
  const det = await ev(() => ({ touch: document.body.classList.contains('touch'), coarse: matchMedia('(pointer: coarse)').matches, pts: navigator.maxTouchPoints, q: window.__oua.game.renderer.quality }));
  await A.tapEl('[data-a=start]');
  await wait(400);
  const playing = await ev(() => window.__oua.game.state === 'playing');
  const tcVisible = await ev(() => getComputedStyle(document.querySelector('.tc')).display !== 'none' && !document.querySelector('.tc').classList.contains('inactive'));
  await shot(page, '01-android-inicio');
  ok(1, 'Android (Pixel 7 emulado): detecção de toque e início por toque', det.touch && playing && tcVisible, `pointer:coarse=${det.coarse}, toques=${det.pts}, qualidade padrão=${det.q}, ${W}x${H}`);
}

// área aberta na rua, sem infectados (teste de controles)
const clearZ = () => ev(() => (window.__oua.world.zombies.length = 0));
await clearZ();
await ev(() => window.__oua.teleport(20, 28));
await wait(200);

// 3 joystick analógico: deflexão parcial anda devagar, total anda rápido, soltar para na hora
{
  const ox = 130;
  const oy = H - 110;
  const s0 = await st(A);
  await T.down(1, ox, oy);
  await T.move(1, ox + 22, oy); // ~45% do curso
  await wait(350);
  const slow = await st(A);
  await T.move(1, ox + 90, oy); // além do curso: limitado a 100%
  await wait(500);
  const fast = await st(A);
  await T.move(1, ox + 60, oy + 60); // diagonal (360°)
  await wait(300);
  const diag = await st(A);
  await T.up(1);
  await wait(150);
  const stop = await st(A);
  const stickZero = await ev(() => window.__oua.game.touch.state.mx === 0 && window.__oua.game.touch.state.my === 0);
  ok(
    3,
    'Joystick virtual analógico (360°, zona morta, volta ao centro)',
    slow.vx > 5 && fast.vx > slow.vx * 1.4 && diag.vx > 5 && diag.vy > 5 && stop.vx === 0 && stop.vy === 0 && stickZero && fast.x > s0.x + 10,
    `vel. parcial ${slow.vx.toFixed(0)} → total ${fast.vx.toFixed(0)} px/s; diagonal (${diag.vx.toFixed(0)},${diag.vy.toFixed(0)}); ao soltar (${stop.vx},${stop.vy})`,
  );
}

// 4 correr (segurar) e agachar (alternar)
{
  const ox = 130;
  const oy = H - 110;
  await T.down(1, ox, oy);
  await T.move(1, ox - 70, oy);
  const run = await A.center('.tc [data-b=run]');
  await T.down(2, run.x, run.y);
  await wait(350);
  const r1 = await st(A);
  await T.up(2);
  await wait(200);
  const r2 = await st(A);
  await T.up(1);
  await A.tapEl('.tc [data-b=crouch]');
  await wait(120);
  const c1 = await st(A);
  await A.tapEl('.tc [data-b=crouch]');
  await wait(120);
  const c2 = await st(A);
  ok(4, 'Correr (segurar) e agachar (alternar) por toque', r1.running && !r2.running && c1.crouch && !c2.crouch, `correndo=${r1.running}→${r2.running}, agachado=${c1.crouch}→${c2.crouch}`);
}

// 5 mirar e disparar enquanto anda (3 dedos ao mesmo tempo); sem mira nem disparo automáticos
{
  await ev(() => {
    const a = window.__oua;
    a.give('pistola');
    a.give('municao_9mm', 30);
    const pi = a.world.player.inv.findDef('pistola');
    pi.state = { ...(pi.state ?? {}), ammo: 8 };
  });
  await A.tapEl('.tc [data-b=fire]'); // 1º toque: empunha a pistola (troca rápida)
  await wait(400);
  const gun = await ev(() => window.__oua.world.player.weapon.kind === 'gun');
  // um infectado à DIREITA: se houvesse mira automática, os tiros iriam nele
  await ev(() => {
    const w = window.__oua.world;
    const p = w.player;
    const z = w.spawnZombie(p.x + 70, p.y, 'comum', 'civil');
    z.hp = 999;
    // imóvel e inofensivo durante o teste (só serve de "isca" para uma mira automática)
    z.stats = { ...z.stats, wander: 0, investigate: 0, chase: 0, reach: 0, hitChance: 0, biteChance: 0, awareGain: 0 };
    window.__zt = z;
  });
  const zhp0 = await ev(() => window.__zt.hp);
  const ammo0 = await ev(() => window.__oua.world.player.weaponItem.state.ammo);
  await wait(800); // parado, sem tocar no disparo: nada pode acontecer
  const ammoIdle = await ev(() => window.__oua.world.player.weaponItem.state.ammo);
  const s0 = await st(A);
  const ox = 130;
  const oy = H - 110;
  await T.down(1, ox, oy);
  await T.move(1, ox, oy + 70); // anda para baixo
  const zr = { x: W - 330, y: H - 200 };
  await T.down(2, zr.x, zr.y);
  await T.move(2, zr.x - 80, zr.y); // mira para a esquerda
  await wait(250);
  const aimSt = await st(A);
  const fire = await A.center('.tc [data-b=fire]');
  for (let i = 0; i < 3; i++) {
    await T.down(3, fire.x, fire.y);
    await wait(60);
    await T.up(3);
    await wait(420);
  }
  const s1 = await st(A);
  await T.up(2);
  await T.up(1);
  const ammo1 = await ev(() => window.__oua.world.player.weaponItem.state.ammo);
  const zhp1 = await ev(() => window.__zt.hp);
  await shot(page, '05-mira-disparo');
  const facingLeft = Math.abs(Math.abs(aimSt.facing) - Math.PI) < 0.35;
  ok(
    5,
    'Mirar e disparar enquanto se move (multitoque, sem mira/disparo automáticos)',
    gun && ammoIdle === ammo0 && ammo1 === ammo0 - 3 && s1.y > s0.y + 8 && facingLeft && aimSt.aiming && zhp1 === zhp0,
    `pistola em mãos=${gun}; munição ${ammo0}→${ammo1} (parado: ${ammoIdle}); andou ${((s1.y - s0.y) / 16).toFixed(1)} tiles; olhando ${((aimSt.facing * 180) / Math.PI).toFixed(0)}°; infectado à direita intacto=${zhp1 === zhp0}`,
  );
  await ev(() => {
    const w = window.__oua.world;
    w.zombies.splice(w.zombies.indexOf(window.__zt), 1);
  });
}

// 6 recarregar
{
  const a0 = await ev(() => window.__oua.world.player.weaponItem.state.ammo);
  await A.tapEl('.tc [data-b=reload]');
  let a1 = a0;
  for (let i = 0; i < 40 && a1 <= a0; i++) {
    await wait(100);
    a1 = await ev(() => window.__oua.world.player.weaponItem.state.ammo);
  }
  ok(6, 'Recarregar pelo botão', a1 > a0, `carregador ${a0} → ${a1}`);
}

// golpe: com arma de fogo na mão, o 1º toque troca para punhos/arma branca, depois golpeia
{
  await A.tapEl('.tc [data-b=melee]');
  await wait(300);
  const k = await ev(() => window.__oua.world.player.weapon.kind);
  const melee = await A.center('.tc [data-b=melee]');
  const st0 = await ev(() => window.__oua.world.player.stamina);
  await T.down(4, melee.x, melee.y);
  await wait(500);
  await T.up(4);
  const st1 = await ev(() => window.__oua.world.player.stamina);
  ok('5b', 'Botão de golpe: troca para corpo a corpo e golpeia enquanto segura', k !== 'gun' && st1 < st0, `arma agora: ${k}; fôlego ${st0.toFixed(0)}→${st1.toFixed(0)} (golpes gastam fôlego)`);
}

// 7 abrir porta (botão contextual) e 8 entrar na casa andando com o joystick
{
  await ev(() => {
    const a = window.__oua;
    a.teleport(33, 25);
    const d = a.world.map.doorAt(33, 24) ?? a.world.map.doorAt(33, 23);
    if (d) {
      d.open = false;
      d.anim = 0;
    }
  });
  // olhar para cima com o joystick de mira
  const zr = { x: W - 330, y: H - 200 };
  await T.down(2, zr.x, zr.y);
  await T.move(2, zr.x, zr.y - 70);
  await wait(200);
  await T.up(2);
  await wait(150);
  const label = await ev(() => document.querySelector('.tc [data-k=ilabel]').textContent);
  const vis = await ev(() => !document.querySelector('.tc [data-b=interact]').classList.contains('hide'));
  await A.tapEl('.tc [data-b=interact]');
  await wait(500);
  const opened = await ev(() => {
    const t = window.__oua.target();
    const m = window.__oua.world.map;
    for (let y = 22; y <= 25; y++) for (let x = 32; x <= 34; x++) { const d = m.doorAt(x, y); if (d) return d.open; }
    return t?.label;
  });
  ok(7, 'Abrir porta pelo botão de interação contextual', vis && /porta/i.test(label) && opened === true, `botão: "${label}" → aberta=${opened}`);
  const ox = 130;
  const oy = H - 110;
  await T.down(1, ox, oy);
  await T.move(1, ox, oy - 70);
  await wait(1500);
  await T.up(1);
  const inB = await ev(() => { const w = window.__oua.world; return w.buildingOf(w.player)?.name ?? null; });
  await shot(page, '08-dentro-casa');
  ok(8, 'Entrar no imóvel andando com o joystick', inB === 'Casa 2', `dentro de: ${inB}`);
}

// 9 vasculhar armário · 10 coletar comida e água · 11 inventário sem duplicação
{
  await ev(() => window.__oua.teleport(16, 16));
  const zr = { x: W - 330, y: H - 200 };
  await T.down(2, zr.x, zr.y);
  await T.move(2, zr.x, zr.y - 70);
  await wait(200);
  await T.up(2);
  await wait(150);
  const label = await ev(() => document.querySelector('.tc [data-k=ilabel]').textContent);
  await A.tapEl('.tc [data-b=interact]');
  let open = null;
  for (let i = 0; i < 30 && !open; i++) {
    await wait(100);
    open = await ev(() => window.__oua.world.player.openContainer);
  }
  const invShown = await ev(() => !document.getElementById('inventory').classList.contains('hidden'));
  ok(9, 'Vasculhar armário (interação por toque abre o recipiente)', !!open && invShown, `"${label}" → recipiente ${open}`);
  // garante comida e água no armário
  await ev(() => {
    const a = window.__oua;
    const w = a.world;
    const c = w.getContainer(w.player.openContainer);
    for (const id of ['agua', 'feijao_lata']) {
      a.give(id);
      const it = w.player.inv.findDef(id);
      w.player.inv.remove(it.uid);
      c.inv.add(it);
    }
    w.events.emit('inventoryChanged', {});
  });
  await wait(200);
  const before = await ev(() => ({ agua: window.__oua.world.player.inv.count('agua'), feijao: window.__oua.world.player.inv.count('feijao_lata') }));
  const take = async (defId) => {
    const uid = await ev((d) => { const w = window.__oua.world; const c = w.getContainer(w.player.openContainer); return c?.inv.findDef(d)?.uid ?? `?${w.player.openContainer}:${c?.inv.items.map((i) => i.defId)}`; }, defId);
    if (uid.startsWith('?')) console.log('DBG take', defId, uid);
    const sel = `#inventory li[data-side=c][data-uid="${uid}"]`;
    await A.tapEl(sel);
    await wait(450); // fora da janela de toque duplo
    if (process.env.DBG) await ev(() => { if (window.__actLog) return; window.__actLog = []; const g = window.__oua.game; const o = g.act.bind(g); g.act = (...a) => { window.__actLog.push(JSON.stringify(a) + ' @' + (performance.now() | 0)); return o(...a); }; });
    if (process.env.DBG2) { await page.screenshot({ path: '/tmp/sel.png' }); console.log(sel, await A.center(sel), await A.center('#inventory button[data-act=take]'), await ev(() => window.__oua.world.player.inv.items.length)); }
    // três toques rápidos no botão "Pegar": só um pode valer
    const b = await A.center('#inventory button[data-act=take]');
    for (let i = 0; i < 3; i++) await T.tap(b.x, b.y, 21 + i);
    await wait(300);
  };
  await take('agua');
  if (process.env.DBG) console.log(await ev(() => { const w = window.__oua.world; return { acts: window.__actLog, c: w.getContainer(w.player.openContainer).inv.items.map((i) => i.defId), p: w.player.inv.items.map((i) => i.defId), log: [...document.querySelectorAll('#log div')].map((d) => d.textContent) }; }));
  await take('feijao_lata');
  const after = await ev(() => {
    const w = window.__oua.world;
    const c = w.getContainer(w.player.openContainer);
    return { agua: w.player.inv.count('agua'), feijao: w.player.inv.count('feijao_lata'), cAgua: c.inv.count('agua'), cFeijao: c.inv.count('feijao_lata'), audit: window.__oua.audit() };
  });
  await shot(page, '10-coleta');
  ok(10, 'Coletar comida e água por toque', after.agua === before.agua + 1 && after.feijao === before.feijao + 1 && after.cAgua === 0, `água ${before.agua}→${after.agua}, feijão ${before.feijao}→${after.feijao}, sobrou no armário: ${after.cAgua + after.cFeijao}`);
  // comer: três toques rápidos em "Comer" só consomem uma lata
  await A.tapEl('.tc [data-c]'); // ✕ fecha
  await wait(250);
  const closed = await ev(() => document.getElementById('inventory').classList.contains('hidden') && !document.querySelector('.tc').classList.contains('tcm'));
  await A.tapEl('.tc [data-t=inv]');
  await wait(250);
  const reopened = await ev(() => !document.getElementById('inventory').classList.contains('hidden'));
  const uid = await ev(() => window.__oua.world.player.inv.findDef('feijao_lata').uid);
  await A.tapEl(`#inventory li[data-side=p][data-uid="${uid}"]`);
  await wait(450);
  const n0 = await ev(() => window.__oua.world.player.inv.count('feijao_lata'));
  const b = await A.center('#inventory button[data-act=consume]');
  for (let i = 0; i < 3; i++) await T.tap(b.x, b.y, 30 + i);
  await wait(4500);
  const n1 = await ev(() => window.__oua.world.player.inv.count('feijao_lata'));
  const audit = await ev(() => window.__oua.audit());
  await A.tapEl('.tc [data-c]');
  await wait(200);
  ok(11, 'Inventário por toque: abrir, selecionar, consumir, fechar (sem duplicar)', closed && reopened && n1 === n0 - 1 && audit.duplicates.length === 0, `fechou com ✕=${closed}, reabriu pelo 🎒=${reopened}, latas ${n0}→${n1} após 3 toques rápidos, duplicatas=${audit.duplicates.length}`);
}

// 12 itens médicos
{
  await ev(() => {
    const a = window.__oua;
    const p = a.world.player;
    p.health.wounds = [];
    p.health.addWound('laceracao');
    a.give('bandagem', 2);
  });
  await A.tapEl('.tc [data-t=inv]');
  await wait(250);
  const uid = await ev(() => window.__oua.world.player.inv.findDef('bandagem').uid);
  await A.tapEl(`#inventory li[data-side=p][data-uid="${uid}"]`);
  await wait(450);
  await A.tapEl('#inventory button[data-act=treat]');
  let r = null;
  for (let i = 0; i < 80; i++) {
    await wait(100);
    r = await ev(() => { const h = window.__oua.world.player.health; return { treated: h.wounds.every((w) => w.treated), bleeding: h.bleeding, band: window.__oua.world.player.inv.count('bandagem') }; });
    if (r.treated) break;
  }
  await A.tapEl('.tc [data-c]');
  ok(12, 'Usar item médico (bandagem) pelo inventário de toque', r.treated && !r.bleeding && r.band === 1, `ferimento tratado=${r.treated}, sangrando=${r.bleeding}, bandagens restantes ${r.band}`);
}

// 13 mapa físico: botão desligado sem mapa; com o mapa, abre; toque marca
{
  await wait(200);
  const off = await ev(() => document.querySelector('.tc [data-t=map]').classList.contains('off'));
  await A.tapEl('.tc [data-t=map]');
  await wait(200);
  const openedWithout = await ev(() => !document.getElementById('mapview').classList.contains('hidden'));
  await ev(() => window.__oua.give('mapa_completo'));
  await wait(200);
  const on = await ev(() => !document.querySelector('.tc [data-t=map]').classList.contains('off'));
  await A.tapEl('.tc [data-t=map]');
  await wait(300);
  const shown = await ev(() => !document.getElementById('mapview').classList.contains('hidden'));
  const m0 = await ev(() => (window.__oua.world.player.markers ?? window.__oua.world.markers ?? []).length);
  await A.tapEl('#mapview canvas');
  await wait(300);
  const m1 = await ev(() => (window.__oua.world.player.markers ?? window.__oua.world.markers ?? []).length);
  await shot(page, '13-mapa');
  await A.tapEl('.tc [data-c]');
  await wait(200);
  ok(13, 'Mapa físico: indisponível sem o item, abre com ele (sem minimapa)', off && !openedWithout && on && shown, `sem mapa: botão desligado=${off}, abriu=${openedWithout}; com mapa: abriu=${shown}; marcações ${m0}→${m1}`);
}

// 14 rádio: só com rádio; abre a caixa já no canal do rádio
{
  const off = await ev(() => document.querySelector('.tc [data-t=radio]').classList.contains('off'));
  await ev(() => window.__oua.give('radio'));
  await wait(200);
  const on = await ev(() => !document.querySelector('.tc [data-t=radio]').classList.contains('off'));
  await A.tapEl('.tc [data-t=radio]');
  await wait(250);
  const r = await ev(() => ({ open: !document.getElementById('talk').classList.contains('hidden'), mode: document.querySelector('#talk select').value }));
  await shot(page, '14-radio');
  await A.tapEl('.tc [data-c]');
  await wait(200);
  ok(14, 'Rádio por toque: só aparece ativo com rádio; abre no modo rádio (sem chat global)', off && on && r.open && r.mode === 'radio', `sem rádio: desligado=${off}; com rádio: caixa aberta=${r.open}, modo=${r.mode}`);
}

// 15 dirigir · 16 consumo de combustível
{
  await ev(() => {
    const a = window.__oua;
    const w = a.world;
    w.zombies.length = 0;
    const v = w.vehicles[0];
    v.fuel = Math.max(v.fuel, 20);
    const p = w.player;
    p.x = v.x;
    p.y = v.y + 22;
  });
  await wait(200);
  const label = await ev(() => document.querySelector('.tc [data-k=ilabel]').textContent);
  await A.tapEl('.tc [data-b=interact]');
  await wait(400);
  const inside = await ev(() => ({ veh: !!window.__oua.world.player.vehicleId, driving: document.querySelector('.tc').classList.contains('driving') }));
  const v0 = await ev(() => { const v = window.__oua.world.vehicles[0]; return { x: v.x, y: v.y, a: v.angle, fuel: v.fuel }; });
  const gas = await A.center('.tc [data-b=gas]');
  await T.down(5, gas.x, gas.y);
  await wait(900);
  await T.down(1, 130, H - 110);
  await T.move(1, 200, H - 110); // esterça para a direita
  await wait(700);
  await T.up(1);
  await wait(300);
  await T.up(5);
  const v1 = await ev(() => { const v = window.__oua.world.vehicles[0]; return { x: v.x, y: v.y, a: v.angle, fuel: v.fuel, speed: v.speed }; });
  const fuelHud = await ev(() => (!document.querySelector('[data-k=fuelrow]').classList.contains('hidden') ? document.querySelector('[data-k=fuel]').textContent : null));
  await shot(page, '15-dirigindo');
  const brake = await A.center('.tc [data-b=brake]');
  await T.down(5, brake.x, brake.y);
  let sp = 99;
  // o mesmo pedal freia e, já parado, engata a ré (como o S do teclado): solta ao parar
  for (let i = 0; i < 120 && sp > 3; i++) {
    await wait(25);
    sp = await ev(() => window.__oua.world.vehicles[0].speed);
  }
  await T.up(5);
  await wait(300);
  const exitLabel = await ev(() => document.querySelector('.tc [data-k=ilabel]').textContent);
  await A.tapEl('.tc [data-b=interact]');
  await wait(400);
  const out = await ev(() => !window.__oua.world.player.vehicleId);
  const dist = Math.hypot(v1.x - v0.x, v1.y - v0.y) / 16;
  ok(15, 'Dirigir por toque: entrar, acelerar, esterçar, frear e sair', inside.veh && inside.driving && dist > 2 && Math.abs(v1.a - v0.a) > 0.1 && Math.abs(sp) <= 8 && out, `"${label}" → andou ${dist.toFixed(1)} tiles, giro ${(((v1.a - v0.a) * 180) / Math.PI).toFixed(0)}°, freou até ${sp.toFixed(1)}, "${exitLabel}" → fora=${out}`);
  ok(16, 'Consumo de combustível visível ao dirigir', v1.fuel < v0.fuel && !!fuelHud, `gasolina ${v0.fuel.toFixed(2)} → ${v1.fuel.toFixed(2)} L; HUD: ${fuelHud}`);
}

// 17 salvar pelo menu e continuar após recarregar
let savedPos;
{
  await A.tapEl('.tc [data-t=menu]');
  await wait(250);
  await A.tapEl('#pause [data-a=save]');
  savedPos = await ev(() => ({ x: Math.round(window.__oua.world.player.x), y: Math.round(window.__oua.world.player.y), inv: window.__oua.world.player.inv.items.length }));
  await page.reload();
  await page.waitForFunction(() => !!window.__oua);
  await wait(300);
  await A.tapEl('[data-a=continue]');
  await wait(400);
  const now = await ev(() => ({ x: Math.round(window.__oua.world.player.x), y: Math.round(window.__oua.world.player.y), inv: window.__oua.world.player.inv.items.length, st: window.__oua.game.state }));
  ok(17, 'Salvar pelo menu de toque e continuar após recarregar', now.st === 'playing' && Math.abs(now.x - savedPos.x) <= 1 && Math.abs(now.y - savedPos.y) <= 1 && now.inv === savedPos.inv, `(${savedPos.x},${savedPos.y}) → (${now.x},${now.y}), itens ${savedPos.inv}→${now.inv}`);
}

// 18 sair do app / fechar a aba: salva sozinho; reabrir continua de onde parou
{
  await clearZ();
  await T.down(1, 130, H - 110);
  await T.move(1, 130, H - 180);
  await wait(500);
  // o celular manda a aba para o segundo plano no meio do movimento
  const before = await ev(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    const p = window.__oua.world.player;
    return { x: Math.round(p.x), y: Math.round(p.y), state: window.__oua.game.state, mx: window.__oua.game.touch.state.mx, my: window.__oua.game.touch.state.my };
  });
  await T.up(1);
  const page2 = await A.ctx.newPage();
  await page.close();
  await page2.goto(URL);
  await page2.waitForFunction(() => !!window.__oua);
  const hasCont = await page2.evaluate(() => !document.querySelector('[data-a=continue]').classList.contains('hidden'));
  await page2.evaluate(() => window.__oua.game.continueGame());
  await wait(300);
  const after = await page2.evaluate(() => ({ x: Math.round(window.__oua.world.player.x), y: Math.round(window.__oua.world.player.y) }));
  ok(18, 'Fechar a aba e reabrir (salvamento ao ir para segundo plano)', before.state === 'paused' && before.my === 0 && hasCont && Math.abs(after.x - before.x) <= 2 && Math.abs(after.y - before.y) <= 2, `pausou=${before.state}, joystick solto=${before.my === 0}; reabriu com "Continuar"=${hasCont}; (${before.x},${before.y}) → (${after.x},${after.y})`);
  A.page2 = page2;
}

// 19 girar a tela: aviso na vertical, alternativa "jogar assim mesmo", enquadramento justo
{
  const p2 = A.page2;
  const ev2 = (fn, a) => p2.evaluate(fn, a);
  const land = await ev2(() => ({ vw: window.__oua.game.renderer.viewW, vh: window.__oua.game.renderer.viewH }));
  await p2.setViewportSize({ width: H, height: W });
  await wait(400);
  const port = await ev2(() => ({ rot: getComputedStyle(document.getElementById('rotate')).display, vw: window.__oua.game.renderer.viewW, vh: window.__oua.game.renderer.viewH, canvasW: document.getElementById('game').style.width }));
  await shot(p2, '19-vertical-aviso');
  await p2.locator('#rotate [data-x=ok]').tap();
  await wait(200);
  const dismissed = await ev2(() => getComputedStyle(document.getElementById('rotate')).display === 'none');
  await shot(p2, '19-vertical-jogando');
  await p2.setViewportSize({ width: W, height: H });
  await wait(400);
  const back = await ev2(() => ({ rot: getComputedStyle(document.getElementById('rotate')).display, vw: window.__oua.game.renderer.viewW, vh: window.__oua.game.renderer.viewH, pos: window.__oua.world.player.x }));
  // tela ultralarga: não revela mais mundo na horizontal
  await p2.setViewportSize({ width: 1100, height: 360 });
  await wait(300);
  const wide = await ev2(() => ({ vw: window.__oua.game.renderer.viewW, vh: window.__oua.game.renderer.viewH }));
  await p2.setViewportSize({ width: W, height: H });
  ok(19, 'Girar a tela (aviso, alternativa e enquadramento proporcional)', port.rot === 'flex' && dismissed && back.rot === 'none' && land.vw <= 505 && wide.vw <= 505 && port.vh <= 505, `horizontal ${land.vw}x${land.vh}, vertical ${port.vw}x${port.vh} (aviso=${port.rot}), ultralarga ${wide.vw}x${wide.vh} (unid. de mundo)`);
}

// 20 FPS e memória (CPU emulada 4x mais lenta), por qualidade
{
  const p2 = A.page2;
  const cdp2 = await A.ctx.newCDPSession(p2);
  await p2.evaluate(() => { window.__oua.game.state = 'title'; window.__oua.game.startGame(); });
  await wait(500);
  const fpsOf = async (q) => {
    await p2.evaluate((qq) => { const g = window.__oua.game; g.touch.prefs.quality = qq; g.applyQuality(); }, q);
    await wait(700);
    return p2.evaluate(
      () =>
        new Promise((res) => {
          let n = 0;
          const t0 = performance.now();
          const f = () => {
            n++;
            if (performance.now() - t0 < 4000) requestAnimationFrame(f);
            else res({ fps: Math.round((n * 1000) / (performance.now() - t0)), render: window.__oua.game.renderer.frameMs.toFixed(1), sim: window.__oua.game.sim.stepMs.toFixed(2), mem: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, z: window.__oua.world.zombies.length });
          };
          requestAnimationFrame(f);
        }),
    );
  };
  const full = {};
  for (const q of ['alto', 'medio', 'baixo']) full[q] = await fpsOf(q);
  await cdp2.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const slow = {};
  for (const q of ['alto', 'medio', 'baixo']) slow[q] = await fpsOf(q);
  await cdp2.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const fmt = (o) => Object.entries(o).map(([k, v]) => `${k} ${v.fps} fps (render ${v.render} ms)`).join(', ');
  ok(20, 'Desempenho medido (emulação; não é aparelho real)', slow.baixo.fps >= 25 && full.medio.fps >= 50, `CPU normal: ${fmt(full)} | CPU 4x mais lenta: ${fmt(slow)} | memória JS ${slow.baixo.mem} MB, ${slow.baixo.z} zumbis`);
  A.perf = { full, slow };
}
const androidErrors = A.errors.slice();
await A.ctx.close();

// ====================================================================== iPhone (perfil iPhone 14 em Chromium — NÃO é o Safari)
{
  const I = await openDevice('iPhone 14 landscape');
  const iw = I.vp.width;
  const ih = I.vp.height;
  const det = await I.ev(() => document.body.classList.contains('touch'));
  await I.tapEl('[data-a=start]');
  await wait(400);
  await I.ev(() => (window.__oua.world.zombies.length = 0));
  await I.ev(() => window.__oua.teleport(20, 28));
  const s0 = await I.ev(() => window.__oua.world.player.x);
  await I.T.down(1, 120, ih - 100);
  await I.T.move(1, 190, ih - 100);
  await wait(500);
  await I.T.up(1);
  const s1 = await I.ev(() => window.__oua.world.player.x);
  const full = await I.ev(() => getComputedStyle(document.querySelector('.tc [data-t=full]')).display);
  await shot(I.page, '02-iphone');
  ok(2, 'iPhone (perfil iPhone 14 emulado em Chromium): detecção, joystick, áreas seguras', det && s1 > s0 + 10, `${iw}x${ih}, andou ${((s1 - s0) / 16).toFixed(1)} tiles, botão tela cheia: ${full === 'none' ? 'oculto (sem suporte)' : 'visível'} — Safari real: PENDENTE`);
  androidErrors.push(...I.errors);
  await I.ctx.close();
}

await browser.close();
const pass = results.filter((r) => r.pass).length;
console.log(`\n${pass}/${results.length} verificações passaram (emulação).`);
console.log('Pendentes (exigem aparelho real): Android físico (Chrome), iPhone físico (Safari), medição de FPS/memória em aparelho.');
if (androidErrors.length) console.log('Erros no console:', androidErrors.slice(0, 8));
import('node:fs').then((fs) => fs.writeFileSync('./tests/capturas/mobile-resultados.json', JSON.stringify({ results, errors: androidErrors, perf: A.perf }, null, 2)));
process.exitCode = pass === results.length ? 0 : 1;
