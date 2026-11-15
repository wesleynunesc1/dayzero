import { CONFIG, TILE } from '../config';
import { itemDef } from '../data/items';
import type { Npc } from '../entities/Npc';
import type { Player } from '../entities/Player';
import type { Door } from '../world/TileMap';
import type { World } from '../world/World';
import type { PrisonSite } from '../world/WorldGen';
import { changeRep, rep } from './Factions';
import { remember, tradeValue } from './Social';

/**
 * Captura, prisão e fuga.
 * - Render-se (diálogo) ou ser incapacitado perto de guardas de uma facção que captura.
 * - Equipamentos confiscados vão para o depósito de apreensões da prisão (continuam existindo).
 * - Na cela o jogador continua jogando: revista o colchão, conversa com outros presos e guardas,
 *   negocia a soltura, tenta abrir a fechadura com um grampo, ou é resgatado por amigos
 *   (chave das celas, grampo pelo lado de fora, negociação, ou arrombando a porta).
 */
export class PrisonSystem {
  constructor(private world: World) {}

  prisonOf(faction: string): PrisonSite | undefined {
    return this.world.prisons.find((p) => p.faction === faction);
  }

  cellDoor(pr: PrisonSite, i: number): Door | undefined {
    const c = pr.cells[i];
    return this.world.map.doors.find((d) => d.x === c.doorX && d.y === c.doorY);
  }

  freeCell(pr: PrisonSite): number {
    const w = this.world;
    const occupied = (i: number) => w.players.some((p) => p.captive && p.captive.cell === i && this.prisonOf(p.captive.faction) === pr) || w.npcs.some((n) => n.state !== 'morto' && n.role === 'prisioneiro' && n.activity === 'preso' && n.cell === i && this.prisonOf(n.faction ?? '') === pr);
    // prefere a cela onde um preso antigo escondeu um grampo (há rumores sobre ela)
    const order = pr.cells.map((_, i) => i).sort((a, b) => Number(this.hasPick(pr, b)) - Number(this.hasPick(pr, a)));
    return order.find((i) => !occupied(i)) ?? 0;
  }

  private hasPick(pr: PrisonSite, i: number) {
    return !!this.world.containers.get(pr.cells[i].mattress)?.inv.findDef('grampo');
  }

  /** Rendição (voluntária) ou captura de um sobrevivente incapacitado. */
  surrender(p: Player, guard: Npc) {
    const w = this.world;
    if (p.captive || p.dead || !guard.faction) return;
    const f = w.factions.get(guard.faction);
    const pr = this.prisonOf(guard.faction);
    if (!f || !pr) return;
    const cell = this.freeCell(pr);
    // confisco: TUDO vai para o depósito de apreensões (nada é apagado)
    const stash = w.containers.get(pr.stash)!;
    const taken: string[] = [];
    if (p.vehicleId) w.events.emit('vehicleExit', { id: p.vehicleId });
    p.vehicleId = null;
    for (const it of [...p.inv.items]) {
      p.inv.remove(it.uid);
      stash.inv.items.push(it);
      taken.push(itemDef(it.defId).name);
    }
    p.validateEquipment();
    // leva para a cela e tranca
    const c = pr.cells[cell];
    p.x = ((c.x0 + c.x1) / 2 + 0.5) * TILE;
    p.y = ((c.y0 + c.y1) / 2 + 0.5) * TILE;
    p.vx = p.vy = 0;
    const door = this.cellDoor(pr, cell);
    if (door) {
      door.open = false;
      door.broken = false;
      door.hp = door.maxHp;
      door.locked = guard.faction;
    }
    if (p.isDown) p.health.revive(20); // a facção estanca o sangramento: não executa presos
    p.captive = { faction: guard.faction, cell, since: w.gameMinutes };
    p.action = null;
    for (const n of w.npcs) if (n.faction === guard.faction) {
      n.hostileTo.delete(p.id);
      if (n.confront?.who === p.id) n.confront = null;
    }
    remember(w, guard, 'prendeu', p, `Prendeu ${p.name}`);
    w.withPlayer(p, () => {
      w.msg(`Você foi capturado por ${f.name}. Confiscaram: ${taken.length ? taken.join(', ') : 'nada'}. Está na cela ${cell + 1}.`, 'danger');
      w.msg('Na cela você pode revistar o colchão, conversar com presos e guardas, negociar a soltura ou tentar fugir.', 'info');
      w.events.emit('inventoryChanged', {});
    });
    w.missions?.onEvent('capturado', { player: p.id, faction: guard.faction, prison: f.name });
  }

  /** Negociação com um guarda/líder da facção. Preço depende de reputação e de quem negocia. */
  negotiate(p: Player, guard: Npc, opt: string): string {
    const w = this.world;
    const f = w.factions.get(guard.faction!)!;
    const target: Player | Npc | undefined =
      opt === 'negociar_soltura' ? p : opt === 'negociar_outro' ? w.players.find((o) => o !== p && o.captive?.faction === f.id) : w.npcs.find((n) => n.role === 'prisioneiro' && n.faction === f.id && n.activity === 'preso');
    if (!target) return 'Não tem ninguém com esse nome aqui.';
    const r = rep(w, f.id, p.id);
    if (f.kind === 'militar' && r >= 0 && target === p) {
      // militares soltam quem não tem histórico grave após um tempo
      const hours = (w.gameMinutes - (p.captive?.since ?? 0)) / 60;
      if (hours < 4) return `Você vai ficar aí até eu ter certeza de que não é saqueador. Volte a falar comigo em ${Math.ceil(4 - hours)} h.`;
      this.release(p, 'Liberado após averiguação. Pegue suas coisas no depósito — e não volte à área restrita.');
      return 'Tá liberado. Suas coisas estão no depósito de apreensões.';
    }
    // pagamento: o negociador oferece o que tem (preso não tem nada: precisa de alguém de fora)
    const price = Math.max(20, 60 - r * 0.5);
    let offer = 0;
    const pay: { uid: string; v: number }[] = [];
    for (const it of p.inv.items) {
      const v = tradeValue(it.defId) * it.qty;
      pay.push({ uid: it.uid, v });
      offer += v;
    }
    if (offer < price) {
      if (target === p) return f.kind === 'hostil' ? `Liberdade custa ${Math.round(price)} em mercadoria. Você não tem nada. Arrume alguém lá fora pra pagar — ou trabalhe pra gente: limpe os infectados do portão e a gente conversa.` : 'Sem garantias, não posso te soltar ainda.';
      return `Pra soltar, quero ${Math.round(price)} em mercadoria (munição, remédio, uísque, cigarro). Você tem ${Math.round(offer)}.`;
    }
    // paga do mais valioso para o menos até cobrir o preço
    pay.sort((a, b) => b.v - a.v);
    let paid = 0;
    const stock = w.containers.get(f.site?.stock ?? '') ?? w.containers.get(this.prisonOf(f.id)!.stash)!;
    for (const x of pay) {
      if (paid >= price) break;
      const it = p.inv.get(x.uid)!;
      p.inv.remove(x.uid);
      stock.inv.items.push(it);
      paid += x.v;
    }
    w.events.emit('inventoryChanged', {});
    changeRep(w, f.id, p.id, 6, 'pagou um resgate');
    if ('captive' in target) this.release(target, `${p.name} pagou sua soltura.`);
    else this.releaseNpc(target, p);
    return 'Negócio é negócio. Pode levar.';
  }

  release(p: Player, why: string) {
    const w = this.world;
    if (!p.captive) return;
    const pr = this.prisonOf(p.captive.faction);
    if (pr) {
      const door = this.cellDoor(pr, p.captive.cell);
      if (door) {
        door.locked = undefined;
        door.open = true;
      }
    }
    p.captive = null;
    w.withPlayer(p, () => w.msg(why, 'good'));
    w.missions?.onEvent('libertado', { player: p.id });
  }

  releaseNpc(n: Npc, by: Player) {
    const w = this.world;
    const pr = this.prisonOf(n.faction ?? '');
    if (pr && n.cell !== null) {
      const door = this.cellDoor(pr, n.cell);
      if (door) {
        door.locked = undefined;
        door.open = true;
      }
    }
    n.activity = 'fugindo_prisao';
    remember(w, n, 'resgatou', by, `Foi libertado por ${by.name}`);
  }

  /**
   * Tentativa de abrir uma porta trancada (cela/paiol) com grampo ou chave.
   * Chamado pela interação quando a porta está trancada. Retorna true se tratou.
   */
  tryUnlock(p: Player, door: Door): boolean {
    const w = this.world;
    const key = p.inv.findDef('chave_celas');
    if (key && door.label === 'Porta da cela') {
      door.locked = undefined;
      w.msg('Você destrancou a cela com a chave.', 'good');
      w.sound('container', door.x * TILE, door.y * TILE, 0.6);
      this.onCellOpened(door, p);
      return true;
    }
    const pick = p.inv.findDef('grampo');
    if (!pick) {
      w.msg(door.label === 'Porta da cela' ? 'Trancada. Sem chave ou grampo, só arrombando (barulho e muita força).' : 'Trancada.', 'warn');
      return true;
    }
    if (p.action) return true;
    const dur = door.label === 'Porta do paiol' ? 14 : 8;
    p.action = {
      kind: 'search',
      label: 'Abrindo a fechadura com o grampo',
      t: 0,
      dur,
      allowMove: false,
      onDone: () => {
        // chance fixa por tentativa (determinada pelo gerador semeado do mundo), grampo pode quebrar
        if (w.rng.chance(door.label === 'Porta do paiol' ? 0.35 : 0.6)) {
          door.locked = undefined;
          w.msg('Clique. A fechadura cedeu.', 'good');
          this.onCellOpened(door, p);
        } else {
          w.msg('O grampo escorregou. Tente de novo.', 'warn');
          if (w.rng.chance(0.3)) {
            p.inv.remove(pick.uid, 1);
            w.msg('O grampo entortou e quebrou.', 'danger');
            w.events.emit('inventoryChanged', {});
          }
        }
        w.makeNoise(p.x, p.y, 3, 'fechadura', true, p.id);
      },
    };
    w.makeNoise(p.x, p.y, 2, 'fechadura', true, p.id);
    return true;
  }

  /** Porta de cela aberta: libera o preso daquela cela (jogador ou NPC) e avisa a facção se alguém viu. */
  onCellOpened(door: Door, by: Player) {
    const w = this.world;
    for (const pr of w.prisons) {
      const i = pr.cells.findIndex((c) => c.doorX === door.x && c.doorY === door.y);
      if (i < 0) continue;
      const pl = w.players.find((q) => q.captive && q.captive.cell === i && this.prisonOf(q.captive.faction) === pr);
      if (pl) {
        pl.captive = null;
        w.withPlayer(pl, () => w.msg(pl === by ? 'Você está fora da cela. Agora é sair sem ser visto — suas coisas estão no depósito de apreensões.' : `${by.name} abriu sua cela! Fuja!`, 'good'));
        w.missions?.onEvent(pl === by ? 'fugiu' : 'resgatado', { player: pl.id, by: by.id });
        // guardas que virem a fuga reagem (não executam: tentam recapturar)
        for (const n of w.npcs) {
          if (n.faction !== pr.faction || n.state === 'morto' || n.role === 'prisioneiro') continue;
          if (Math.hypot(n.x - by.x, n.y - by.y) < 10 * TILE && w.map.los(n.x, n.y, by.x, by.y)) {
            changeRep(w, pr.faction, by.id, -20, 'fuga da prisão');
            if (by !== pl) changeRep(w, pr.faction, pl.id, -20, 'fuga da prisão');
          }
        }
      }
      const npc = w.npcs.find((n) => n.role === 'prisioneiro' && n.cell === i && n.faction === pr.faction && n.activity === 'preso');
      if (npc) this.releaseNpc(npc, by);
    }
  }

  /** Atualização: presos não ficam parados num menu — só verificamos regras do lugar. */
  update() {
    const w = this.world;
    for (const p of w.players) {
      if (!p.captive) continue;
      const pr = this.prisonOf(p.captive.faction);
      if (!pr) continue;
      const c = pr.cells[p.captive.cell];
      const tx = Math.floor(p.x / TILE);
      const ty = Math.floor(p.y / TILE);
      const inside = tx >= c.x0 - 1 && tx <= c.x1 + 1 && ty >= c.y0 - 1 && ty <= c.y1 + 1;
      if (!inside) {
        // saiu por outro meio (porta arrombada, etc.)
        p.captive = null;
        w.missions?.onEvent('fugiu', { player: p.id, by: p.id });
      }
    }
  }
}

export const SURRENDER_WAIT = CONFIG.factions.surrenderWaitSec;
