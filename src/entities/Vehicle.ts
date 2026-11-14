/** Definição de um modelo de veículo (dados). Novos veículos = novas entradas aqui. */
export interface VehicleDef {
  id: string;
  name: string;
  /** Comprimento e largura em pixels de mundo. */
  length: number;
  width: number;
  maxSpeed: number;
  reverseSpeed: number;
  accel: number;
  brake: number;
  /** Radianos por segundo em velocidade plena. */
  turnRate: number;
  fuelCapacity: number;
  maxHp: number;
  color: string;
}

export const VEHICLE_DEFS: Record<string, VehicleDef> = {
  caminhonete: {
    id: 'caminhonete',
    name: 'Caminhonete',
    length: 58,
    width: 26,
    maxSpeed: 150,
    reverseSpeed: 45,
    accel: 70,
    brake: 150,
    turnRate: 2.1,
    fuelCapacity: 60,
    maxHp: 100,
    color: '#5a6b5a',
  },
};

/**
 * Veículo dirigível. Estado preparado para expansão (pneus, bateria, desgaste mecânico).
 */
export class Vehicle {
  speed = 0;
  engineOn = false;
  throttle = 0;
  steer = 0;
  hp: number;
  /** Pneus/bateria/peças: reservados para etapas futuras. */
  parts = { pneus: 100, bateria: 100 };
  noiseT = 0;
  hitCd = 0;
  occupant: string | null = null;

  constructor(
    readonly id: string,
    readonly def: VehicleDef,
    public x: number,
    public y: number,
    public angle: number,
    public fuel: number,
  ) {
    this.hp = def.maxHp;
  }

  get functional() {
    return this.hp > 0;
  }

  /** Centros dos círculos de colisão (frente, meio, traseira). */
  circles(x = this.x, y = this.y, a = this.angle): { x: number; y: number }[] {
    const d = this.def.length / 2 - this.def.width / 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [
      { x: x + c * d, y: y + s * d },
      { x, y },
      { x: x - c * d, y: y - s * d },
    ];
  }

  get radius() {
    return this.def.width / 2 - 1;
  }

  /** Velocidade aproximada em km/h para a interface. */
  get kmh() {
    return Math.round(Math.abs(this.speed) * 0.6);
  }
}
