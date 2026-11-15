import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SaveData } from '../src/systems/Save';
import type { RoomMeta, Store } from '../src/net/GameServer';

/**
 * Persistência do servidor em disco, à prova de quedas:
 * - O save é dividido em SEÇÕES (jogadores, NPCs, recipientes por região, zumbis, mapa...).
 *   Só as seções que mudaram são regravadas (salvamento incremental).
 * - Cada arquivo é escrito num temporário e renomeado (escrita atômica).
 * - O manifesto anterior vira backup; se o atual estiver corrompido, carrega o backup.
 */
type Full = SaveData & { room: RoomMeta };

export class FileStore implements Store {
  private last = new Map<string, string>();
  stats = { written: 0, skipped: 0 };

  constructor(readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private write(file: string, text: string) {
    const f = path.join(this.dir, file);
    const tmp = `${f}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmp, f);
  }

  save(data: Full) {
    const { world, players, room, ...meta } = data;
    const { containers, ground, corpses, zombies, npcs, ...rest } = world;
    // recipientes agrupados (prefixo do id) para regravar só os grupos alterados
    const groups: Record<string, Record<string, unknown>> = {};
    for (const [id, c] of Object.entries(containers)) {
      const g = `c_${Math.floor((parseInt(id.replace(/\D/g, ''), 10) || 0) / 100)}`;
      (groups[g] ??= {})[id] = c;
    }
    const sections: Record<string, unknown> = { players, room, ground, corpses, zombies, npcs: npcs ?? [], rest, ...groups };
    const manifest = { ...meta, version: data.version, sections: Object.keys(sections), savedAt: data.savedAt };
    for (const [k, v] of Object.entries(sections)) {
      const text = JSON.stringify(v);
      // conteúdo igual ao último gravado (e o arquivo existe) → não regrava
      if (this.last.get(k) === text && fs.existsSync(path.join(this.dir, `${k}.json`))) {
        this.stats.skipped++;
        continue;
      }
      this.write(`${k}.json`, text);
      this.last.set(k, text);
      this.stats.written++;
    }
    const mf = path.join(this.dir, 'manifest.json');
    if (fs.existsSync(mf)) fs.copyFileSync(mf, path.join(this.dir, 'manifest.bak.json'));
    this.write('manifest.json', JSON.stringify(manifest));
  }

  load(): Full | null {
    for (const m of ['manifest.json', 'manifest.bak.json']) {
      try {
        const mf = path.join(this.dir, m);
        if (!fs.existsSync(mf)) continue;
        const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
        const sec: Record<string, unknown> = {};
        for (const k of manifest.sections as string[]) {
          const text = fs.readFileSync(path.join(this.dir, `${k}.json`), 'utf8');
          sec[k] = JSON.parse(text);
          this.last.set(k, text);
        }
        const containers: Record<string, unknown> = {};
        for (const k of manifest.sections as string[]) if (k.startsWith('c_')) Object.assign(containers, sec[k] as object);
        const { sections: _s, ...meta } = manifest;
        void _s;
        return {
          ...meta,
          players: sec.players,
          room: sec.room,
          world: { ...(sec.rest as object), containers, ground: sec.ground, corpses: sec.corpses, zombies: sec.zombies, npcs: sec.npcs },
        } as Full;
      } catch (e) {
        console.error(`[persistência] falha ao ler ${m}:`, (e as Error).message);
      }
    }
    return null;
  }
}
