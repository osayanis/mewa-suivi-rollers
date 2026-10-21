// Photos des maintenances : fichiers JPEG sur disque, références dans la table `photos`.
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError } from './errors.js';

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
// Une photo envoyée mais jamais rattachée à une maintenance (fenêtre fermée en cours de route) est supprimée après ce délai.
const ORPHAN_MAX_AGE_MS = 24 * 3600_000;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class Photos {
  constructor(db, config) {
    this.db = db;
    this.dir = config.photosDir;
    mkdirSync(this.dir, { recursive: true });
  }

  pathFor(id) {
    return join(this.dir, `${id}.jpg`);
  }

  /** Enregistre une photo JPEG envoyée par l'interface (déjà réduite côté navigateur). */
  save(buffer, username) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
      throw new HttpError(400, 'invalid_photo', 'Photo manquante.');
    }
    if (buffer.length > MAX_PHOTO_BYTES) throw new HttpError(413, 'photo_too_large', 'Photo trop lourde (8 Mo maximum).');
    // Signature JPEG : FF D8 FF.
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
      throw new HttpError(415, 'invalid_photo', 'Format de photo non reconnu (JPEG attendu).');
    }
    const id = randomUUID();
    writeFileSync(this.pathFor(id), buffer, { mode: 0o640 });
    this.db
      .prepare('INSERT INTO photos (id, size, created_at, created_by) VALUES (?, ?, ?, ?)')
      .run(id, buffer.length, new Date().toISOString(), username);
    return { id };
  }

  /**
   * Photo lisible par cet utilisateur : celle d'une maintenance de son périmètre,
   * ou une photo qu'il vient d'envoyer et pas encore rattachée.
   */
  requireReadable(id, user, scope) {
    const row = ID_PATTERN.test(String(id))
      ? this.db
          .prepare(`SELECT p.*, m.agency_id FROM photos p LEFT JOIN movements m ON m.id = p.movement_id WHERE p.id = ?`)
          .get(id)
      : undefined;
    const allowed =
      row &&
      (row.movement_id === null
        ? row.created_by === user.username
        : scope.agencyId === null || row.agency_id === scope.agencyId);
    if (!allowed) throw new HttpError(404, 'unknown_photo', 'Photo introuvable.');
    return row;
  }

  cleanupOrphans() {
    const before = new Date(Date.now() - ORPHAN_MAX_AGE_MS).toISOString();
    const orphans = this.db.prepare('SELECT id FROM photos WHERE movement_id IS NULL AND created_at < ?').all(before);
    for (const { id } of orphans) {
      rmSync(this.pathFor(id), { force: true });
      this.db.prepare('DELETE FROM photos WHERE id = ?').run(id);
    }
    return orphans.length;
  }
}
