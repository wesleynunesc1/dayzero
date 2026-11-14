/** Estilos da interface (injetados em <head>). Visual sóbrio, sem brilhos ou ícones futuristas. */
export const CSS = `
:root{
  --ink:#e4ddcc; --ink-dim:#a39d8f; --ink-faint:#6f6a60;
  --panel:rgba(16,17,16,0.82); --panel-solid:#151614; --line:rgba(214,200,170,0.14);
  --amber:#c9a25b; --red:#b2463a; --red-dim:#7c2f27; --green:#7f9a62; --blue:#7f97a6;
  --font: "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif;
  --serif: Georgia, "Times New Roman", serif;
}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:#0b0c0c;overflow:hidden;color:var(--ink);font-family:var(--font)}
#app{position:fixed;inset:0}
#game{position:absolute;inset:0;display:block;image-rendering:pixelated;cursor:none}
#game.menu{cursor:default}
#ui{position:absolute;inset:0;pointer-events:none;user-select:none;font-size:13px}
.hidden{display:none!important}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:3px;backdrop-filter:blur(2px)}
.label{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-dim)}
.bar{height:6px;background:rgba(255,255,255,0.07);border-radius:1px;overflow:hidden}
.bar>i{display:block;height:100%;background:var(--ink-dim);transition:width .15s linear}
.bar.hp>i{background:#9a4a3c}.bar.st>i{background:#8a8a72}.bar.w>i{background:#7f8a7a}
.bar.food>i{background:#9a7a44}.bar.water>i{background:#56788c}.bar.en>i{background:#7a6f94}.bar.fuel>i{background:#a0603a}
.tabs{display:flex;gap:4px;flex-wrap:wrap}.tabs .btn{padding:4px 9px;font-size:12px}.tabs .btn.on{border-color:rgba(201,162,91,.6);color:#efdcb2}
#sleep{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);padding:14px 22px;text-align:center;display:flex;flex-direction:column;gap:6px;font-size:15px}
.bar.w.over>i{background:var(--red)}

/* HUD */
#hud-left{position:absolute;left:16px;bottom:16px;width:232px;padding:10px 12px;display:flex;flex-direction:column;gap:7px}
#hud-right{position:absolute;right:16px;bottom:16px;width:220px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.row{display:flex;align-items:center;gap:8px}
.row .label{width:62px;flex:none}
.row .bar{flex:1}
.row .num{width:26px;text-align:right;font-variant-numeric:tabular-nums;color:var(--ink-dim);font-size:12px}
.chips{display:flex;flex-wrap:wrap;gap:4px}
.chip{font-size:11px;padding:1px 6px;border-radius:2px;border:1px solid var(--line);color:var(--ink-dim)}
.chip.ok{color:var(--green);border-color:rgba(127,154,98,.35)}
.chip.warn{color:var(--amber);border-color:rgba(201,162,91,.35)}
.chip.bad{color:#d7685a;border-color:rgba(178,70,58,.5);background:rgba(124,47,39,.18)}
.kv{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.kv b{font-weight:600;color:var(--ink);font-size:13px;text-align:right}
.kv small{color:var(--ink-dim)}
#prompt{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);padding:6px 12px;font-size:13px;white-space:nowrap}
#prompt kbd,.kbd{display:inline-block;min-width:18px;padding:0 5px;margin-right:6px;border:1px solid rgba(214,200,170,.35);border-radius:2px;font:600 11px var(--font);color:var(--amber);text-align:center}
#action{position:absolute;left:50%;bottom:62px;transform:translateX(-50%);width:240px;padding:6px 10px}
#action .bar{margin-top:5px}
#action .bar>i{background:var(--amber)}
#log{position:absolute;left:16px;top:14px;width:min(520px,60vw);display:flex;flex-direction:column;gap:3px}
#log div{padding:3px 9px;background:rgba(12,13,12,.62);border-left:2px solid var(--ink-faint);font-size:12.5px;line-height:1.35;transition:opacity .6s}
#log .warn{border-color:var(--amber)} #log .danger{border-color:var(--red);color:#efc9c0}
#log .good{border-color:var(--green)} #log .npc{border-color:var(--blue);color:#d3dde2}
#stance{position:absolute;left:16px;bottom:208px;font-size:11px;color:var(--ink-dim);letter-spacing:.1em;text-transform:uppercase}

/* Modais */
.modal{position:absolute;pointer-events:auto;background:var(--panel-solid);border:1px solid var(--line);border-radius:4px;box-shadow:0 18px 60px rgba(0,0,0,.6)}
.modal h2{margin:0;font:600 12px var(--font);letter-spacing:.16em;text-transform:uppercase;color:var(--ink-dim)}
.btn{pointer-events:auto;cursor:pointer;background:#22231f;color:var(--ink);border:1px solid rgba(214,200,170,.22);border-radius:2px;padding:6px 12px;font:13px var(--font)}
.btn:hover:not(:disabled){background:#2c2d28;border-color:rgba(214,200,170,.4)}
.btn:disabled{opacity:.4;cursor:default}
.btn.primary{border-color:rgba(201,162,91,.55);color:#efdcb2}
.btn.danger{border-color:rgba(178,70,58,.6);color:#efc9c0}

#inventory{left:50%;top:50%;transform:translate(-50%,-50%);width:min(900px,94vw);height:min(600px,88vh);display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr auto;gap:0}
.inv-col{display:flex;flex-direction:column;min-height:0;padding:14px 16px;gap:8px}
.inv-col+.inv-col{border-left:1px solid var(--line)}
.inv-head{display:flex;justify-content:space-between;align-items:center}
.inv-list{list-style:none;margin:0;padding:0;overflow:auto;flex:1;border:1px solid var(--line);background:rgba(0,0,0,.18)}
.inv-list li{display:grid;grid-template-columns:1fr 84px 54px;align-items:center;gap:8px;padding:5px 9px;border-bottom:1px solid rgba(214,200,170,.06);cursor:pointer}
.inv-list li:hover{background:rgba(255,255,255,.04)}
.inv-list li.sel{background:rgba(201,162,91,.12)}
.inv-list li .n{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.inv-list li .c{font-size:11px;color:var(--ink-faint)}
.inv-list li .w{font-size:12px;color:var(--ink-dim);text-align:right;font-variant-numeric:tabular-nums}
.inv-list li .tag{font-size:10px;color:var(--amber);margin-left:6px;letter-spacing:.06em;text-transform:uppercase}
.inv-list li .cond{display:inline-block;width:34px;height:3px;background:rgba(255,255,255,.08);margin-left:6px;vertical-align:middle}
.inv-list li .cond i{display:block;height:100%;background:#8a8a72}
.inv-list .empty{color:var(--ink-faint);cursor:default;grid-template-columns:1fr;font-style:italic}
.equip{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.slot{border:1px solid var(--line);padding:5px 7px;min-height:38px;background:rgba(0,0,0,.15)}
.slot .label{font-size:9px}
.slot div{font-size:12px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.details{grid-column:1/3;border-top:1px solid var(--line);padding:12px 16px;display:flex;gap:16px;align-items:flex-start;min-height:92px}
.details .txt{flex:1;color:var(--ink-dim);line-height:1.45}
.details .txt b{color:var(--ink);display:block;margin-bottom:2px}
.details .acts{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;max-width:52%}
.cond-panel{display:flex;flex-direction:column;gap:9px;overflow:auto}
.wound{display:flex;justify-content:space-between;padding:5px 8px;border:1px solid var(--line);font-size:12.5px}
.wound .s{color:var(--ink-dim)} .wound .s.b{color:#d7685a}
.foot{font-size:11px;color:var(--ink-faint)}

#mapview{left:50%;top:50%;transform:translate(-50%,-50%);padding:14px;display:flex;flex-direction:column;gap:10px;align-items:center}
#mapview canvas{display:block;max-width:86vw;max-height:76vh;image-rendering:auto}

#dialog{left:50%;bottom:110px;transform:translateX(-50%);width:360px;padding:12px 14px;display:flex;flex-direction:column;gap:6px}
#dialog .btn{text-align:left}
#dialog .who{font:600 13px var(--font)} #dialog .st{font-size:11px;color:var(--ink-dim)}

.screen{position:absolute;inset:0;pointer-events:auto;display:flex;align-items:center;justify-content:center}
.screen .card{width:min(520px,92vw);padding:28px 30px;display:flex;flex-direction:column;gap:12px}
#title{background:linear-gradient(180deg,rgba(8,9,10,.25),rgba(8,9,10,.75) 70%)}
#title h1{font:400 44px/1.05 var(--serif);letter-spacing:.06em;margin:0;color:#ece3cf;text-shadow:0 2px 18px rgba(0,0,0,.6)}
#title .sub{color:var(--ink-dim);letter-spacing:.2em;text-transform:uppercase;font-size:11px}
#title .card{background:none;border:none;align-items:flex-start;gap:16px}
#title .btns{display:flex;gap:10px}
#title .note{font-size:11px;color:var(--ink-faint);max-width:420px;line-height:1.5}
.controls{display:grid;grid-template-columns:auto 1fr;gap:5px 14px;font-size:12.5px;color:var(--ink-dim)}
.controls .kbd{justify-self:start}
#pause,#death{background:rgba(6,7,8,.6)}
#death h1{font:400 34px var(--serif);margin:0;color:#e6b9ae;letter-spacing:.08em}
#death p,#pause p{margin:0;color:var(--ink-dim);line-height:1.5}
select{background:#22231f;color:var(--ink);border:1px solid rgba(214,200,170,.22);padding:5px;font:13px var(--font);pointer-events:auto}
#fps{position:absolute;right:10px;top:8px;font:11px monospace;color:rgba(200,200,190,.45)}
`;
