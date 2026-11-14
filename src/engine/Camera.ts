import { clamp } from './math';

/** Câmera com acompanhamento suave, leve antecipação da mira e tremor. */
export class Camera {
  x = 0;
  y = 0;
  viewW = 640;
  viewH = 360;
  private shakeT = 0;
  private shakeMag = 0;
  offX = 0;
  offY = 0;

  constructor(public worldW: number, public worldH: number) {}

  follow(tx: number, ty: number, dt: number, snap = false) {
    if (snap) {
      this.x = tx;
      this.y = ty;
    } else {
      const k = 1 - Math.exp(-dt * 6.5);
      this.x += (tx - this.x) * k;
      this.y += (ty - this.y) * k;
    }
    const hw = this.viewW / 2;
    const hh = this.viewH / 2;
    this.x = this.worldW > this.viewW ? clamp(this.x, hw, this.worldW - hw) : this.worldW / 2;
    this.y = this.worldH > this.viewH ? clamp(this.y, hh, this.worldH - hh) : this.worldH / 2;

    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const m = this.shakeMag * Math.max(0, this.shakeT) * 6;
      this.offX = (Math.random() - 0.5) * m;
      this.offY = (Math.random() - 0.5) * m;
    } else {
      this.offX = this.offY = 0;
    }
  }

  shake(mag: number, time = 0.18) {
    this.shakeMag = Math.max(this.shakeMag * (this.shakeT > 0 ? 1 : 0), mag);
    this.shakeT = Math.max(this.shakeT, time);
  }

  get left() {
    return this.x - this.viewW / 2 + this.offX;
  }
  get top() {
    return this.y - this.viewH / 2 + this.offY;
  }
}
