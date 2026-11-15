import { itemDef } from '../data/items';
import { ACTIVITY_LABEL, EMOTION_LABEL, EMOTIONS } from '../entities/Npc';
import { rep, repLabel } from '../systems/Factions';
import { radioProblem } from '../systems/Radio';
import { tradeValue, type DialogView } from '../systems/Social';
import type { World } from '../world/World';
import type { UIHost } from './UI';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function el(tag: string, cls = '', html = ''): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export const PANEL_CSS = `
#npcdlg{left:50%;bottom:96px;transform:translateX(-50%);width:460px;max-height:62vh;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:6px}
#npcdlg .who{font:600 14px var(--font)} #npcdlg .st{font-size:11px;color:var(--ink-dim)}
#npcdlg .say{font-style:italic;color:#e6dcc4;line-height:1.45;margin:4px 0 6px;border-left:2px solid var(--line);padding-left:8px}
#npcdlg .btn{text-align:left} #npcdlg .emo{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:10px;color:var(--ink-dim)}
#trade{left:50%;top:50%;transform:translate(-50%,-50%);width:640px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
#trade .cols{display:grid;grid-template-columns:1fr 1fr;gap:10px} #trade ul{list-style:none;margin:0;padding:0;max-height:300px;overflow:auto;border:1px solid var(--line)}
#trade li{padding:4px 6px;cursor:pointer;font-size:12px;display:flex;justify-content:space-between} #trade li.sel{background:rgba(120,140,90,.35)}
#talk{left:50%;bottom:150px;transform:translateX(-50%);width:520px;padding:10px 12px;display:flex;gap:6px;align-items:center}
#talk input{flex:1;background:#151514;color:var(--ink);border:1px solid var(--line);padding:6px 8px;font:13px var(--font)}
#talk select{background:#151514;color:var(--ink);border:1px solid var(--line);padding:5px}
#journal{left:50%;top:50%;transform:translate(-50%,-50%);width:620px;max-height:80vh;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:8px}
#journal .obj{font-size:13px} #journal .obj.done{color:var(--green);text-decoration:line-through}
#journal .side{font-size:12px;border-left:2px solid var(--line);padding-left:8px;margin:4px 0}
#journal .side.concluida{border-color:var(--green)} #journal .side.falhou{border-color:#a04a3a;opacity:.8}
#maptools{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12px}
#maptools select,#maptools input{background:#151514;color:var(--ink);border:1px solid var(--line);padding:4px}
#captive{position:absolute;left:50%;top:14px;transform:translateX(-50%);background:rgba(90,30,20,.85);padding:6px 12px;border-radius:3px;font-size:12px;pointer-events:none}
`;

/** Painéis da Etapa 3: diálogo com NPCs, troca, fala/rádio, diário da campanha. */
export class Panels {
  npcDlg = el('div', 'modal hidden');
  trade = el('div', 'modal hidden');
  talk = el('div', 'modal hidden');
  journal = el('div', 'modal hidden');
  captive = el('div', 'hidden');
  private npcId: string | null = null;
  private tradeSel = { give: new Set<string>(), take: new Set<string>() };

  constructor(
    root: HTMLElement,
    private host: UIHost,
  ) {
    this.npcDlg.id = 'npcdlg';
    this.trade.id = 'trade';
    this.talk.id = 'talk';
    this.journal.id = 'journal';
    this.captive.id = 'captive';
    for (const e of [this.npcDlg, this.trade, this.talk, this.journal]) e.addEventListener('mousedown', (ev) => ev.stopPropagation());
    this.talk.innerHTML = `<select data-k="mode"><option value="falar">Falar (perto)</option><option value="gritar">Gritar (faz barulho)</option><option value="radio">Rádio</option></select>
      <input data-k="text" maxlength="140" placeholder="Mensagem… (Enter envia, Esc cancela)"/>`;
    const input = this.talk.querySelector('input')!;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.sendTalk();
      if (e.key === 'Escape') this.close();
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    root.append(this.npcDlg, this.trade, this.talk, this.journal, this.captive);
  }

  isOpen() {
    return [this.npcDlg, this.trade, this.talk, this.journal].some((e) => !e.classList.contains('hidden'));
  }

  /** Caixa de texto aberta (o jogo não deve ler teclas). */
  typing() {
    return !this.talk.classList.contains('hidden');
  }

  close() {
    for (const e of [this.npcDlg, this.trade, this.talk, this.journal]) e.classList.add('hidden');
    if (this.npcId) void this.host.act('npcChoose', this.npcId, 'sair');
    this.npcId = null;
  }

  // ------------------------------------------------------------- fala e rádio
  openTalk() {
    const w = this.host.world;
    const sel = this.talk.querySelector('select') as HTMLSelectElement;
    const prob = radioProblem(w.player);
    (sel.querySelector('option[value=radio]') as HTMLOptionElement).textContent = prob ? `Rádio (${prob.replace('O rádio está ', '').replace('.', '')})` : `Rádio — canal ${w.player.inv.items.find((i) => itemDef(i.defId).radio)?.state?.freq ?? 1}`;
    this.talk.classList.remove('hidden');
    const input = this.talk.querySelector('input') as HTMLInputElement;
    input.value = '';
    setTimeout(() => input.focus(), 0);
  }

  private sendTalk() {
    const input = this.talk.querySelector('input') as HTMLInputElement;
    const mode = (this.talk.querySelector('select') as HTMLSelectElement).value;
    const text = input.value.trim();
    this.talk.classList.add('hidden');
    input.blur();
    if (!text) return;
    if (mode === 'radio') void this.host.act('radio', text);
    else void this.host.act('speak', text, mode === 'gritar');
  }

  // ------------------------------------------------------------- NPCs
  async openNpc(npcId: string) {
    this.npcId = npcId;
    const r = await this.host.act('npcOpen', npcId);
    this.showDialog(r && 'dialog' in r ? r.dialog ?? null : null);
  }

  private showDialog(v: DialogView | null) {
    if (!v) {
      this.npcDlg.classList.add('hidden');
      this.npcId = null;
      return;
    }
    const w = this.host.world;
    const n = w.npcs.find((x) => x.id === v.npcId);
    const emo = n ? EMOTIONS.map((e) => `<span>${EMOTION_LABEL[e]} ${Math.round(n.emotions[e])}</span>`).join('') : '';
    this.npcDlg.innerHTML = `<div class="who">${esc(v.name)}</div><div class="st">${esc(v.sub)}${n ? ` · ${ACTIVITY_LABEL[n.activity]}` : ''}</div>
      <div class="emo">${emo}</div>
      <div class="say">“${esc(v.text)}”</div>
      ${v.options.map((o, i) => `<button class="btn" data-o="${esc(o.id)}" ${o.enabled ? '' : `disabled title="${esc(o.reason ?? '')}"`}><span class="kbd">${i + 1}</span>${esc(o.label)}${!o.enabled && o.reason ? ` <small>(${esc(o.reason)})</small>` : ''}</button>`).join('')}`;
    this.npcDlg.querySelectorAll('button[data-o]').forEach((b) => b.addEventListener('click', () => this.choose((b as HTMLElement).dataset.o!)));
    this.npcDlg.classList.remove('hidden');
  }

  /** Escolha por número (teclas 1–9). */
  chooseIndex(i: number): boolean {
    if (this.npcDlg.classList.contains('hidden')) return false;
    const b = this.npcDlg.querySelectorAll('button[data-o]')[i] as HTMLButtonElement | undefined;
    if (b && !b.disabled) this.choose(b.dataset.o!);
    return true;
  }

  private async choose(opt: string) {
    if (!this.npcId) return;
    if (opt === 'trocar') return this.openTrade();
    if (opt === 'sair') return this.close();
    const r = await this.host.act('npcChoose', this.npcId, opt);
    this.showDialog(r && 'dialog' in r ? r.dialog ?? null : null);
  }

  // ------------------------------------------------------------- troca
  private openTrade() {
    this.tradeSel = { give: new Set(), take: new Set() };
    this.npcDlg.classList.add('hidden');
    this.renderTrade('');
    this.trade.classList.remove('hidden');
  }

  private renderTrade(msg: string) {
    const w = this.host.world;
    const n = w.npcs.find((x) => x.id === this.npcId);
    if (!n) return this.close();
    const sum = (ids: Set<string>, inv: typeof n.inv) => [...ids].reduce((a, uid) => a + (inv.get(uid) ? tradeValue(inv.get(uid)!.defId) * inv.get(uid)!.qty : 0), 0);
    const li = (it: { uid: string; defId: string; qty: number }, side: 'give' | 'take') =>
      `<li data-uid="${it.uid}" data-side="${side}" class="${this.tradeSel[side].has(it.uid) ? 'sel' : ''}"><span>${esc(itemDef(it.defId).name)}${it.qty > 1 ? ` ×${it.qty}` : ''}</span><span>${tradeValue(it.defId) * it.qty}</span></li>`;
    const mine = w.player.inv.items.filter((i) => !w.player.isEquipped(i.uid));
    const theirs = n.inv.items.filter((i) => i.uid !== n.weaponUid);
    this.trade.innerHTML = `<h2>Troca com ${esc(n.name)}</h2>
      <div class="foot">Quer: ${esc((n.def.trade?.wants ?? []).map((x) => (x === 'comida' ? 'comida' : itemDef(x).name)).join(', ') || '—')}. Itens que ele(a) quer valem mais. Rancor e ganância encarecem; favores barateiam.</div>
      <div class="cols"><div><div class="label">Você oferece (${sum(this.tradeSel.give, w.player.inv)})</div><ul>${mine.map((i) => li(i, 'give')).join('') || '<li>—</li>'}</ul></div>
      <div><div class="label">Você pede (${sum(this.tradeSel.take, n.inv)})</div><ul>${theirs.map((i) => li(i, 'take')).join('') || '<li>—</li>'}</ul></div></div>
      <div class="say">${esc(msg)}</div>
      <div style="display:flex;gap:6px"><button class="btn primary" data-a="propor">Propor troca</button><button class="btn" data-a="voltar">Voltar à conversa</button></div>`;
    this.trade.querySelectorAll('li[data-uid]').forEach((e) =>
      e.addEventListener('click', () => {
        const h = e as HTMLElement;
        const set = this.tradeSel[h.dataset.side as 'give' | 'take'];
        if (set.has(h.dataset.uid!)) set.delete(h.dataset.uid!);
        else set.add(h.dataset.uid!);
        this.renderTrade(msg);
      }),
    );
    this.trade.querySelector('[data-a=propor]')!.addEventListener('click', async () => {
      const r = await this.host.act('trade', this.npcId, [...this.tradeSel.give], [...this.tradeSel.take]);
      const res = r && 'text' in r ? r : { text: '…', ok: false };
      if (res.ok) this.tradeSel = { give: new Set(), take: new Set() };
      this.renderTrade(res.text ?? '');
    });
    this.trade.querySelector('[data-a=voltar]')!.addEventListener('click', () => {
      this.trade.classList.add('hidden');
      if (this.npcId) void this.openNpc(this.npcId);
    });
  }

  // ------------------------------------------------------------- diário
  toggleJournal() {
    if (!this.journal.classList.contains('hidden')) {
      this.journal.classList.add('hidden');
      return;
    }
    this.renderJournal();
    this.journal.classList.remove('hidden');
  }

  renderJournal() {
    const w = this.host.world;
    const m = w.missions;
    if (!m) return;
    const p = w.player;
    const objs = m.objectives();
    const facs = [...w.factions.values()].map((f) => `<div class="kv"><span class="label">${esc(f.name)}</span><b>${repLabel(rep(w, f.id, p.id))} (${Math.round(rep(w, f.id, p.id))})</b></div>`).join('');
    const group = w.players
      .map((o) => `<div class="kv"><span class="label">${esc(o.name)}${o === p ? ' (você)' : ''}</span><b>${o.controller === 'humano' ? (o.connected ? 'jogador' : 'desconectado — IA no controle') : 'IA'}${o.dead ? ' · morto' : ''}${o.captive ? ' · preso' : ''}${o !== p && !p.contacts.has(o.id) && !o.contacts.has(p.id) ? ' · sem contato' : ''}</b></div>`)
      .join('');
    this.journal.innerHTML = `<h2>Diário — ${m.finished ? 'Campanha concluída' : `Capítulo ${m.chapter}: ${esc(m.def.title)}`}</h2>
      ${m.finished ? '' : `<div class="foot">${esc(m.def.intro)}</div>`}
      ${objs.map((o) => `<div class="obj ${o.done ? 'done' : ''}">${o.done ? '✔' : '○'} ${esc(o.text)}</div>`).join('')}
      ${m.rendezvous ? `<div class="foot">Ponto de encontro combinado: <b>${esc(m.rendezvous.name)}</b></div>` : ''}
      <h2 style="margin-top:8px">Missões secundárias</h2>
      ${m.side.map((s) => `<div class="side ${s.status}"><b>${esc(s.title)}</b> — ${s.status === 'ativa' ? 'em aberto' : s.status === 'concluida' ? 'concluída' : 'fracassou'}<br>${esc(s.text)}${s.outcome ? `<br><i>${esc(s.outcome)}</i>` : ''}</div>`).join('') || '<div class="foot">Nenhuma.</div>'}
      <h2 style="margin-top:8px">Grupo</h2>${group}
      <div class="foot">O diário não mostra onde os outros estão. Combine pelo rádio.</div>
      <h2 style="margin-top:8px">Reputação</h2>${facs}
      <div class="foot"><span class="kbd">J</span>/<span class="kbd">Esc</span> fechar</div>`;
  }

  /** Atualiza o aviso de prisão no topo da tela. */
  update(w: World) {
    const c = w.player.captive;
    if (c) {
      const f = w.factions.get(c.faction);
      this.captive.textContent = `Preso por ${f?.name ?? c.faction} (cela ${c.cell + 1}). Revistar o colchão, falar com presos/guardas, negociar ou fugir.`;
      this.captive.classList.remove('hidden');
    } else this.captive.classList.add('hidden');
  }
}
