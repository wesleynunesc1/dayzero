import { TILE } from '../config';
import { createItem, freshness, itemDef, ItemInstance } from '../data/items';
import { Recipe, RECIPES } from '../data/recipes';
import { dist } from '../engine/math';
import type { World } from '../world/World';
import { dropToGround } from './ItemActions';

/**
 * Fabricação: verifica materiais, ferramentas e condições ANTES; ao concluir,
 * desconta materiais, adiciona o resultado (peso atualizado automaticamente) e salva.
 */

export interface RecipeCheck {
  recipe: Recipe;
  ok: boolean;
  reason?: string;
  /** Para receitas especiais: o item afetado. */
  target?: ItemInstance;
  /** Situação de cada material: [nome, tem, precisa]. */
  needs: { name: string; have: number; need: number; tool?: boolean }[];
}

/** Doses de água disponíveis (só água potável conta para cozinhar). */
function waterDoses(world: World, potableOnly = true): number {
  let n = 0;
  for (const it of world.player.inv.items) {
    const d = itemDef(it.defId);
    if (d.water && (!potableOnly || !it.state?.contaminated)) n += it.state?.uses ?? 0;
  }
  return n;
}

export function nearFire(world: World): boolean {
  const p = world.player;
  return world.lights.some((l) => l.kind === 'fire' && dist(l.x, l.y, p.x, p.y) < 2.5 * TILE);
}

function have(world: World, id: string): number {
  if (id === 'agua_dose') return waterDoses(world);
  return world.player.inv.count(id);
}

function label(id: string) {
  return id === 'agua_dose' ? 'Água potável (doses de 250 ml)' : itemDef(id).name;
}

export function checkRecipe(world: World, r: Recipe): RecipeCheck {
  const inv = world.player.inv;
  const needs: RecipeCheck['needs'] = r.inputs.map((i) => ({ name: label(i.id), have: have(world, i.id), need: i.qty }));
  for (const t of r.tools ?? []) needs.push({ name: itemDef(t).name, have: inv.count(t) > 0 ? 1 : 0, need: 1, tool: true });
  let ok = needs.every((n) => n.have >= n.need);
  let reason = ok ? undefined : 'Faltam materiais ou ferramentas.';
  let target: ItemInstance | undefined;
  if (r.special === 'reparo') {
    target = inv.items
      .filter((i) => itemDef(i.defId).weapon?.kind === 'melee' && i.condition !== undefined && i.condition < (itemDef(i.defId).durability ?? 0))
      .sort((a, b) => a.condition! / itemDef(a.defId).durability! - b.condition! / itemDef(b.defId).durability!)[0];
    if (!target && ok) {
      ok = false;
      reason = 'Nenhuma arma corpo a corpo danificada no inventário.';
    }
  }
  if (r.special === 'ferver') {
    target = inv.items.find((i) => itemDef(i.defId).water && i.state?.contaminated && (i.state.uses ?? 0) > 0);
    if (!target && ok) {
      ok = false;
      reason = 'Nenhum recipiente com água não tratada.';
    }
  }
  if (ok && r.condition === 'fogo' && !nearFire(world)) {
    ok = false;
    reason = 'Precisa estar perto de uma fonte de fogo (ex.: tambor com fogo).';
  }
  if (ok && world.player.action) {
    ok = false;
    reason = 'Você está ocupado.';
  }
  return { recipe: r, ok, reason, target, needs };
}

export function listRecipes(world: World): RecipeCheck[] {
  return RECIPES.map((r) => checkRecipe(world, r));
}

/** Consome doses de água potável dos recipientes (garrafa vazia permanece). */
function takeWater(world: World, doses: number) {
  let left = doses;
  for (const it of world.player.inv.items) {
    if (left <= 0) break;
    const d = itemDef(it.defId);
    if (!d.water || it.state?.contaminated) continue;
    const k = Math.min(left, it.state?.uses ?? 0);
    it.state!.uses = (it.state!.uses ?? 0) - k;
    left -= k;
  }
}

/** Inicia a fabricação (ação com tempo). Retorna false se não puder. */
export function craft(world: World, recipeId: string): boolean {
  const r = RECIPES.find((x) => x.id === recipeId);
  if (!r) return false;
  const chk = checkRecipe(world, r);
  if (!chk.ok) {
    world.msg(chk.reason ?? 'Não é possível fabricar agora.', 'warn');
    return false;
  }
  const p = world.player;
  if (r.noise) world.makeNoise(p.x, p.y, r.noise, 'fabricar', true, p.id);
  world.sound('cloth', p.x, p.y, 0.6);
  p.action = {
    kind: 'craft',
    label: r.name,
    t: 0,
    dur: r.time,
    allowMove: false,
    onDone: () => {
      // revalida: algo pode ter mudado durante a ação
      const again = checkRecipe(world, r);
      if (!again.ok) {
        world.msg(again.reason ?? 'Fabricação cancelada.', 'warn');
        return;
      }
      const now = world.gameMinutes;
      let spoiledInput = false;
      for (const i of r.inputs) {
        if (i.id === 'agua_dose') takeWater(world, i.qty);
        else {
          const src = p.inv.findDef(i.id);
          if (src && freshness(src, now) === 'estragado') spoiledInput = true;
          p.inv.take(i.id, i.qty);
        }
      }
      if (r.special === 'reparo' && again.target) {
        const d = itemDef(again.target.defId);
        again.target.condition = Math.min(d.durability!, (again.target.condition ?? 0) + Math.round(d.durability! * 0.4));
        world.msg(`${d.name} reparado(a): condição ${Math.round((again.target.condition / d.durability!) * 100)}%.`, 'good');
      } else if (r.special === 'ferver' && again.target) {
        again.target.state!.contaminated = false;
        world.msg('A água ferveu. Agora é segura para beber.', 'good');
      } else if (r.result) {
        const out = createItem(r.result.id, r.result.qty);
        if (itemDef(out.defId).food?.perishable) out.state = { ...out.state, born: spoiledInput ? now - 99999 : now };
        const res = p.inv.add(out);
        if (!res.ok) {
          dropToGround(world, out);
          world.msg(`${itemDef(out.defId).name} fabricado(a), mas não coube: ficou no chão.`, 'warn');
        } else world.msg(`Fabricado: ${itemDef(out.defId).name}.`, 'good');
      }
      p.validateEquipment();
      world.events.emit('inventoryChanged', {});
      world.events.emit('requestSave', {});
    },
  };
  return true;
}
