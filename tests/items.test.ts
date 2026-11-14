// Rádio, lanterna, mochila, peso e descarte.
import { World } from '../src/world/World';
import { Simulation } from '../src/systems/Simulation';
import { createItem } from '../src/data/items';
import { doPlayerItemAction, playerItemActions } from '../src/systems/ItemActions';
const w = new World(); const sim = new Simulation(w); const p = w.player;
const msgs: string[] = []; w.events.on('message', (m) => msgs.push(m.text));
const step = (s: number) => { for (let i = 0; i < s * 60; i++) sim.step(1 / 60, { mx: 0, my: 0, run: false, toggleCrouch: false, aimX: p.x, aimY: p.y - 9, attack: false, attackPressed: false, aimHeld: false, interact: false, reload: false }); };
let fails = 0; const check = (n: string, c: boolean, i = '') => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${i}`); if (!c) fails++; };
const radio = createItem('radio'); radio.state = { on: false, battery: 35, freq: 104.5 }; p.inv.add(radio);
doPlayerItemAction(w, 'toggle', radio.uid); check('rádio liga com bateria', !!radio.state.on);
doPlayerItemAction(w, 'tune', radio.uid); check('rádio sintoniza', radio.state.freq !== 104.5, `${radio.state.freq} MHz`);
doPlayerItemAction(w, 'examine', radio.uid); check('inspeção mostra estado', msgs.at(-1)!.includes('Bateria'), msgs.at(-1));
let heard = 0; w.events.on('noise', (n) => { if (n.kind === 'radio') heard++; }); step(7);
check('rádio ligado faz um pouco de barulho', heard >= 2, `${heard} emissões em 7 s`);
const dead = createItem('radio'); p.inv.add(dead);
check('rádio sem pilhas não liga', !playerItemActions(w, dead).find((a) => a.id === 'toggle')!.enabled);
p.inv.add(createItem('pilhas', 1)); doPlayerItemAction(w, 'batteries', dead.uid); step(1.4);
check('trocar pilhas carrega o rádio', dead.state!.battery === 100 && p.inv.count('pilhas') === 0);
const lan = createItem('lanterna'); p.inv.add(lan); doPlayerItemAction(w, 'toggle', lan.uid); check('lanterna liga', !!p.flashlight);
// peso / mochila
const base = p.inv.maxWeight;
const bag = createItem('mochila_trilha'); p.inv.add(bag); doPlayerItemAction(w, 'equip_costas', bag.uid);
check('mochila aumenta capacidade', p.inv.maxWeight > base, `${base} → ${p.inv.maxWeight} kg`);
let added = 0; for (let i = 0; i < 40; i++) { const r = p.inv.add(createItem('tabua', 1)); if (r.ok) added += r.added; }
check('não carrega acima da capacidade', p.inv.weight() <= p.inv.maxWeight + 1e-6, `${p.inv.weight().toFixed(1)}/${p.inv.maxWeight} kg (${added} tábuas)`);
doPlayerItemAction(w, 'unequip', bag.uid); check('não tira a mochila se ficaria acima do peso', p.equipped.costas === bag.uid);
const t = p.inv.findDef('tabua')!; doPlayerItemAction(w, 'drop', t.uid);
check('descartar cria pilha no chão', w.corpses.some((c) => c.pile && c.container.inv.items.length > 0));
// comida e rasgar roupa
p.hunger = 60; const f = createItem('feijao_lata'); p.inv.items.push(f);
doPlayerItemAction(w, 'consume', f.uid); step(1.6); check('comer reduz a fome', p.hunger < 30, `fome ${p.hunger.toFixed(0)}`);
const shirt = createItem('camiseta'); p.inv.items.push(shirt); doPlayerItemAction(w, 'tear', shirt.uid); step(2.2);
check('rasgar camiseta gera tiras de pano', w.corpses.some((c) => c.container.inv.count('tiras_pano') > 0) || p.inv.count('tiras_pano') === 2);
console.log(fails ? `${fails} falha(s)` : 'todos os testes de itens passaram');
