import { DEFAULT_PREFS, savePrefs, type TouchPrefs } from './TouchControls';

/**
 * Peças de interface para celular: estilos responsivos (só valem com body.touch),
 * aviso de orientação e painel de ajustes (tamanho/transparência/posição dos controles,
 * sensibilidade, zona morta e qualidade gráfica — salvos no aparelho).
 */
export const MOBILE_CSS = `
html,body{overscroll-behavior:none;-webkit-tap-highlight-color:transparent}
body.touch{touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;position:fixed;inset:0;overflow:hidden}
body.touch input,body.touch select,body.touch textarea{-webkit-user-select:text;user-select:text;touch-action:manipulation;font-size:16px!important}
body.touch .btn,body.touch select{min-height:40px;touch-action:manipulation}
body:not(.touch) .touch-help{display:none}
body.touch .controls:not(.touch-help){display:none}
body.touch #game{cursor:default}
/* HUD compacto: barras no topo esquerdo, arma/carga no topo direito sob a barra de botões */
body.touch #hud-left{left:max(8px,env(safe-area-inset-left));top:max(6px,env(safe-area-inset-top));bottom:auto;width:150px;padding:5px 7px;gap:3px;font-size:11px}
body.touch #hud-left .row{gap:5px}
body.touch #hud-left .row .label{width:44px;font-size:8.5px;letter-spacing:.06em}
body.touch #hud-left .row .num{width:20px;font-size:10px}
body.touch #hud-left .bar{height:4px}
body.touch #hud-left .chip{font-size:9.5px;padding:0 4px}
body.touch #hud-right{right:max(10px,env(safe-area-inset-right));top:calc(max(8px,env(safe-area-inset-top)) + 50px);bottom:auto;width:170px;padding:5px 8px;gap:2px}
body.touch #hud-right .label{font-size:8.5px}
body.touch #hud-right .kv b{font-size:11px}
body.touch #log{left:calc(max(8px,env(safe-area-inset-left)) + 162px);top:max(6px,env(safe-area-inset-top));width:min(360px,calc(100vw - 560px));min-width:180px}
body.touch #log div{font-size:11px;padding:2px 6px}
body.touch #prompt{display:none}
body.touch #stance{display:none}
body.touch #action{bottom:calc(max(14px,env(safe-area-inset-bottom)) + 64px)}
body.touch #fps{top:auto;bottom:4px;right:50%}
/* janelas: ocupam a tela, com rolagem por toque e itens maiores */
body.touch .modal{max-width:100vw}
body.touch #inventory{left:env(safe-area-inset-left);right:env(safe-area-inset-right);top:0;bottom:0;transform:none;width:auto;height:100%;border-radius:0;
  padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}
body.touch .inv-col{padding:8px 10px;gap:6px}
body.touch .inv-col:nth-child(2){padding-right:62px}
body.touch .inv-list{overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y;overscroll-behavior:contain}
body.touch .inv-list li{padding:9px 10px;min-height:42px;font-size:14px}
body.touch .details{padding:8px 10px;min-height:0;gap:10px;max-height:42vh;overflow-y:auto;touch-action:pan-y}
body.touch .details .acts{max-width:60%}
body.touch .details .btn{padding:9px 14px;font-size:14px}
body.touch .tabs .btn{padding:8px 12px;font-size:13px}
body.touch .cond-panel{touch-action:pan-y}
body.touch #mapview{top:0;left:0;right:0;bottom:0;transform:none;border-radius:0;justify-content:center;padding:8px 64px 8px 8px}
body.touch #mapview canvas{max-width:calc(100vw - 80px);max-height:calc(100dvh - 90px);touch-action:none}
body.touch #dialog{bottom:max(10px,env(safe-area-inset-bottom));width:min(440px,92vw)}
body.touch #dialog .btn,body.touch #npcdlg .btn{padding:10px 12px;font-size:14px}
body.touch #npcdlg{bottom:max(10px,env(safe-area-inset-bottom));width:min(520px,calc(100vw - 80px));max-height:calc(100dvh - 30px);touch-action:pan-y}
body.touch #trade{width:min(640px,calc(100vw - 80px));max-height:calc(100dvh - 20px);overflow:auto;touch-action:pan-y}
body.touch #trade li{padding:9px 8px;font-size:13px}
body.touch #talk{top:max(10px,env(safe-area-inset-top));bottom:auto;width:min(560px,calc(100vw - 80px));flex-wrap:wrap}
body.touch #journal{width:min(620px,calc(100vw - 80px));max-height:calc(100dvh - 20px);touch-action:pan-y}
body.touch .screen .card{max-height:100dvh;overflow-y:auto;touch-action:pan-y;padding:18px 20px}
body.touch #title h1{font-size:34px}
body.touch #title .btns{flex-wrap:wrap}
body.touch .screen .controls{font-size:12px}
body.touch.portrait #hud-right{top:calc(max(8px,env(safe-area-inset-top)) + 96px)}
body.touch.portrait #log{left:max(8px,env(safe-area-inset-left));top:calc(max(6px,env(safe-area-inset-top)) + 150px);width:calc(100vw - 200px);min-width:0}
#rotate{position:fixed;inset:0;z-index:50;background:#0d0e0d;color:#e6dcc4;display:none;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center;padding:24px;font:15px system-ui,sans-serif}
#rotate .ph{width:46px;height:78px;border:3px solid #c9a25b;border-radius:9px;animation:oua-rot 2.2s ease-in-out infinite}
@keyframes oua-rot{0%,25%{transform:rotate(0)}55%,100%{transform:rotate(-90deg)}}
body.touch.portrait:not(.portrait-ok) #rotate{display:flex}
#prefs{left:50%;top:50%;transform:translate(-50%,-50%);width:min(460px,94vw);max-height:94dvh;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:8px;z-index:40;touch-action:pan-y}
#prefs .r{display:grid;grid-template-columns:150px 1fr 44px;gap:8px;align-items:center;font-size:13px}
#prefs input[type=range]{width:100%;min-height:30px;pointer-events:auto}
#prefs .v{text-align:right;color:var(--ink-dim);font-variant-numeric:tabular-nums}
#prefs .q{display:flex;gap:6px}
#prefs .q .btn.on{border-color:rgba(201,162,91,.7);color:#efdcb2}
`;

const ROWS: [keyof TouchPrefs, string, number, number, number, (v: number) => string][] = [
  ['size', 'Tamanho dos botões', 0.7, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`],
  ['opacity', 'Opacidade', 0.25, 1, 0.05, (v) => `${Math.round(v * 100)}%`],
  ['stickSens', 'Sensibilidade do joystick', 0.6, 1.6, 0.05, (v) => v.toFixed(2)],
  ['deadzone', 'Zona morta do joystick', 0, 0.5, 0.02, (v) => `${Math.round(v * 100)}%`],
  ['aimSens', 'Sensibilidade da mira', 0.5, 2, 0.05, (v) => v.toFixed(2)],
];

export class PrefsPanel {
  readonly el = document.createElement('div');
  constructor(
    root: HTMLElement,
    private prefs: TouchPrefs,
    private apply: (p: TouchPrefs) => void,
  ) {
    this.el.className = 'modal hidden';
    this.el.id = 'prefs';
    this.el.addEventListener('mousedown', (e) => e.stopPropagation());
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
    root.appendChild(this.el);
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  show() {
    this.render();
    this.el.classList.remove('hidden');
  }

  hide() {
    this.el.classList.add('hidden');
  }

  private render() {
    const p = this.prefs;
    this.el.innerHTML = `<h2>Ajustes</h2>
      <div class="label">Qualidade gráfica</div>
      <div class="q">${(['baixo', 'medio', 'alto'] as const).map((q) => `<button class="btn ${p.quality === q ? 'on' : ''}" data-q="${q}">${q === 'baixo' ? 'Baixo' : q === 'medio' ? 'Médio' : 'Alto'}</button>`).join('')}</div>
      <div class="foot">Baixo: resolução nativa reduzida, sem desfoque e menos partículas — para celulares modestos.</div>
      <div class="label" style="margin-top:6px">Controles de toque</div>
      ${ROWS.map(([k, label, min, max, step, fmt]) => `<label class="r"><span>${label}</span><input type="range" data-p="${k}" min="${min}" max="${max}" step="${step}" value="${p[k]}"/><span class="v">${fmt(p[k] as number)}</span></label>`).join('')}
      <label class="r"><span>Inverter lados</span><input type="checkbox" data-p="swap" ${p.swap ? 'checked' : ''} style="width:24px;height:24px;pointer-events:auto"/><span></span></label>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px"><button class="btn" data-x="reset">Restaurar padrão</button><button class="btn primary" data-x="ok">Fechar</button></div>`;
    this.el.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) =>
      inp.addEventListener('input', () => {
        const k = inp.dataset.p as keyof TouchPrefs;
        (this.prefs as unknown as Record<string, number>)[k] = Number(inp.value);
        const row = ROWS.find((r) => r[0] === k)!;
        (inp.nextElementSibling as HTMLElement).textContent = row[5](Number(inp.value));
        this.commit();
      }),
    );
    (this.el.querySelector('input[data-p=swap]') as HTMLInputElement).addEventListener('change', (e) => {
      this.prefs.swap = (e.target as HTMLInputElement).checked;
      this.commit();
    });
    this.el.querySelectorAll<HTMLElement>('[data-q]').forEach((b) =>
      b.addEventListener('click', () => {
        this.prefs.quality = b.dataset.q as TouchPrefs['quality'];
        this.commit();
        this.render();
      }),
    );
    this.el.querySelector('[data-x=reset]')!.addEventListener('click', () => {
      Object.assign(this.prefs, DEFAULT_PREFS);
      this.commit();
      this.render();
    });
    this.el.querySelector('[data-x=ok]')!.addEventListener('click', () => this.hide());
  }

  private commit() {
    savePrefs(this.prefs);
    this.apply(this.prefs);
  }
}

/** Aviso amigável para girar o aparelho (com opção de jogar em pé mesmo assim). */
export function makeRotateOverlay(): HTMLElement {
  const d = document.createElement('div');
  d.id = 'rotate';
  d.innerHTML = `<div class="ph"></div><b>Gire o celular para jogar deitado</b>
    <div style="color:#a99f8a;max-width:320px;line-height:1.4">O jogo foi pensado para a tela na horizontal: cabe mais do bairro e os dois polegares ficam livres.</div>
    <button class="btn" data-x="ok" style="pointer-events:auto;min-height:44px">Jogar na vertical assim mesmo</button>`;
  d.querySelector('[data-x=ok]')!.addEventListener('click', () => document.body.classList.add('portrait-ok'));
  document.body.appendChild(d);
  return d;
}
