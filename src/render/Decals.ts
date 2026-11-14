import { RNG } from '../engine/math';
import { Decal } from '../world/types';
import { Ctx, ellipse } from './canvas';

/** Decalques pintados no chão (sangue, folhas, lixo, vidro...). */
export function drawDecal(ctx: Ctx, d: Decal) {
  const r = new RNG(d.seed + 1);
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(d.rot);
  switch (d.kind) {
    case 'blood': {
      ctx.fillStyle = 'rgba(78,20,16,0.85)';
      ellipse(ctx, 0, 0, d.r, d.r * 0.75);
      const n = Math.max(2, Math.round(d.r));
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = r.chance(0.5) ? 'rgba(70,18,14,0.9)' : 'rgba(92,26,20,0.8)';
        const a = r.range(0, 6.28);
        const dd = r.range(d.r * 0.6, d.r * 1.6);
        ellipse(ctx, Math.cos(a) * dd, Math.sin(a) * dd, r.range(0.4, d.r * 0.35), r.range(0.4, d.r * 0.3));
      }
      break;
    }
    case 'blood_dry': {
      ctx.fillStyle = 'rgba(58,30,22,0.55)';
      for (let i = 0; i < 5; i++) ellipse(ctx, r.range(-d.r, d.r) * 0.6, r.range(-d.r, d.r) * 0.5, r.range(d.r * 0.3, d.r * 0.7), r.range(d.r * 0.2, d.r * 0.5));
      break;
    }
    case 'oil':
      ctx.fillStyle = 'rgba(20,20,22,0.32)';
      ellipse(ctx, 0, 0, d.r * 1.6, d.r);
      break;
    case 'leaves':
      for (let i = 0; i < 9; i++) {
        ctx.fillStyle = r.pick(['#7a5a32', '#8a6a3a', '#5e5a34', '#6a4a2a']);
        ctx.fillRect(r.range(-d.r, d.r), r.range(-d.r, d.r), 1.5, 1);
      }
      break;
    case 'trash':
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = r.pick(['#b8b4a8', '#8a8a84', '#6a5a4a', '#9a8a6a']);
        ctx.fillRect(r.range(-d.r, d.r), r.range(-d.r, d.r), r.range(1, 3), r.range(1, 2));
      }
      ctx.fillStyle = '#7a3a2a';
      ctx.fillRect(1, 1, 2, 1.3);
      break;
    case 'paper':
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = 'rgba(200,196,182,0.85)';
        ctx.save();
        ctx.rotate(r.range(0, 3));
        ctx.fillRect(r.range(-d.r, d.r), r.range(-d.r, d.r), 3, 4);
        ctx.restore();
      }
      break;
    case 'glass':
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = r.chance(0.5) ? 'rgba(170,190,198,0.8)' : 'rgba(120,150,160,0.7)';
        ctx.fillRect(r.range(-d.r, d.r), r.range(-d.r, d.r), 1, 1);
      }
      break;
    case 'casing':
      ctx.fillStyle = '#b09a50';
      ctx.fillRect(0, 0, 1.4, 0.8);
      break;
    case 'rug':
      ctx.fillStyle = d.color ?? '#5b3f3a';
      ctx.fillRect(-d.r, -d.r * 0.7, d.r * 2, d.r * 1.4);
      ctx.strokeStyle = 'rgba(160,130,90,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(-d.r + 2, -d.r * 0.7 + 2, d.r * 2 - 4, d.r * 1.4 - 4);
      break;
    case 'splinters':
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = r.chance(0.5) ? '#6b5139' : '#4e3a28';
        ctx.fillRect(r.range(-d.r, d.r), r.range(-d.r, d.r), r.range(1, 4), 0.8);
      }
      break;
    case 'cracks':
      ctx.strokeStyle = 'rgba(30,30,30,0.35)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(-d.r, 0);
      for (let i = 0; i < 4; i++) ctx.lineTo(-d.r + (i + 1) * (d.r / 2), r.range(-2, 2));
      ctx.stroke();
      break;
    case 'moss':
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = '#56663e';
        ctx.fillRect(r.range(-d.r, d.r), r.range(-d.r, d.r), 1, 1);
      }
      break;
  }
  ctx.restore();
}
