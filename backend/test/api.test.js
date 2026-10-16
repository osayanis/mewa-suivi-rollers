import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { normalizeScannedCode } from '../src/codes.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';

function startServer(overrides = {}) {
  const config = loadConfig({ dbPath: ':memory:', accessCode: '', publicDir: '/nonexistent', ...overrides });
  const db = openDatabase(':memory:');
  const app = createApp(db, config);
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      const call = async (method, path, body, headers = {}) => {
        const res = await fetch(base + path, {
          method,
          headers: { 'Content-Type': 'application/json', ...headers },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* CSV */
        }
        return { status: res.status, body: json, text, headers: res.headers };
      };
      resolve({ server, db, call });
    });
  });
}

describe('normalizeScannedCode', () => {
  test('corrige une douchette QWERTY sur un poste AZERTY', () => {
    assert.equal(normalizeScannedCode('ROLàààà&é'), 'ROL000012');
    assert.equal(normalizeScannedCode('rol"\'(-è_çà'), 'ROL3456789' + '0');
  });
  test('retire espaces et préfixe AIM', () => {
    assert.equal(normalizeScannedCode(' ]C0ROL000042\r\n'), 'ROL000042');
  });
});

describe('API rollers', () => {
  let ctx;
  before(async () => {
    ctx = await startServer({ duplicateWindowSeconds: 0 });
  });
  after(() => {
    ctx.server.close();
    ctx.db.close();
  });

  test('health', async () => {
    const r = await ctx.call('GET', '/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
  });

  test('création de rollers avec codes séquentiels', async () => {
    const r = await ctx.call('POST', '/api/rollers', { count: 3, label: 'Roller linge' });
    assert.equal(r.status, 201);
    assert.deepEqual(
      r.body.map((x) => x.code),
      ['ROL000001', 'ROL000002', 'ROL000003'],
    );
    assert.equal(r.body[1].label, 'Roller linge 2');
    assert.equal(r.body[0].status, 'on_site');
    assert.equal(r.body[0].createdBy, 'GS75 Toussieu', 'le nom du poste est enregistré par défaut');

    const one = await ctx.call('POST', '/api/rollers', { count: 1, label: 'Seul' });
    assert.equal(one.body[0].code, 'ROL000004');
    assert.equal(one.body[0].label, 'Seul');
  });

  test('refuse un nombre invalide', async () => {
    const r = await ctx.call('POST', '/api/rollers', { count: 0 });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'invalid_count');
  });

  test('scan auto : départ puis retour', async () => {
    const out = await ctx.call('POST', '/api/scans', { code: 'ROL000001' });
    assert.equal(out.status, 200);
    assert.equal(out.body.result, 'out');
    assert.equal(out.body.roller.status, 'in_transit');
    assert.equal(out.body.movement.agent, 'GS75 Toussieu');

    const stats = await ctx.call('GET', '/api/stats');
    assert.equal(stats.body.inTransit, 1);
    assert.equal(stats.body.onSite, 3);
    assert.equal(stats.body.outToday, 1);

    // Saisie AZERTY déformée : doit retrouver le même roller.
    const back = await ctx.call('POST', '/api/scans', { code: 'ROLààààà&' });
    assert.equal(back.body.result, 'in');
    assert.equal(back.body.roller.status, 'on_site');
    assert.equal(back.body.departedAt, out.body.movement.scannedAt, 'un retour indique la date du départ');
    assert.ok(back.body.movement.scannedAt >= back.body.departedAt);
  });

  test('code inconnu', async () => {
    const r = await ctx.call('POST', '/api/scans', { code: 'ROL999999' });
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'unknown_code');
  });

  test('le statut décide du sens, un ancien champ "mode" est ignoré', async () => {
    const r = await ctx.call('POST', '/api/scans', { code: 'ROL000002', mode: 'in' });
    assert.equal(r.status, 200);
    assert.equal(r.body.result, 'out');
    assert.equal(r.body.departedAt, r.body.movement.scannedAt);
  });

  test('annulation du dernier mouvement uniquement', async () => {
    const out = await ctx.call('POST', '/api/scans', { code: 'ROL000003' });
    const back = await ctx.call('POST', '/api/scans', { code: 'ROL000003' });

    const notLatest = await ctx.call('POST', `/api/movements/${out.body.movement.id}/cancel`);
    assert.equal(notLatest.status, 409);

    const cancel = await ctx.call('POST', `/api/movements/${back.body.movement.id}/cancel`);
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.roller.status, 'in_transit');

    const cancelOut = await ctx.call('POST', `/api/movements/${out.body.movement.id}/cancel`);
    assert.equal(cancelOut.body.roller.status, 'on_site');
    assert.equal(cancelOut.body.roller.lastMovementAt, null);

    const twice = await ctx.call('POST', `/api/movements/${out.body.movement.id}/cancel`);
    assert.equal(twice.status, 409);
  });

  test('liste, filtres, détail, archivage', async () => {
    const transit = await ctx.call('GET', '/api/rollers?status=in_transit');
    assert.deepEqual(
      transit.body.map((r) => r.code),
      ['ROL000002'],
    );
    const search = await ctx.call('GET', '/api/rollers?q=linge%203');
    assert.deepEqual(
      search.body.map((r) => r.code),
      ['ROL000003'],
    );

    const detail = await ctx.call('GET', '/api/rollers/ROL000001');
    assert.equal(detail.body.movements.length, 2);

    const patched = await ctx.call('PATCH', '/api/rollers/ROL000004', { label: 'Renommé', archived: true });
    assert.equal(patched.body.label, 'Renommé');
    assert.equal(patched.body.archived, true);
    const list = await ctx.call('GET', '/api/rollers');
    assert.ok(!list.body.some((r) => r.code === 'ROL000004'));
    const scanArchived = await ctx.call('POST', '/api/scans', { code: 'ROL000004' });
    assert.equal(scanArchived.status, 409);
    assert.equal(scanArchived.body.error, 'archived');
  });

  test('nom du poste et export CSV', async () => {
    const info = await ctx.call('GET', '/api/info');
    assert.equal(info.body.station, 'GS75 Toussieu');
    assert.equal(info.body.codePrefix, 'ROL');
    assert.equal(info.body.codeDigits, 6);
    const named = await ctx.call('POST', '/api/rollers', { count: 1 }, { 'X-Agent-Name': encodeURIComponent('Poste Été') });
    assert.equal(named.body[0].createdBy, 'Poste Été', 'un nom transmis explicitement reste possible');
    const csv = await ctx.call('GET', '/api/export/movements.csv');
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(csv.text, /Date;Code;Libellé;Mouvement/);
    assert.match(csv.text, /Date;Code;Libellé;Mouvement;Poste;Annulé/);
    assert.match(csv.text, /ROL000001;Roller linge 1;Départ;GS75 Toussieu;/);
  });
});

describe('anti double-scan', () => {
  test('une double lecture immédiate est ignorée, pas un rescan quelques secondes après', async () => {
    const ctx = await startServer();
    await ctx.call('POST', '/api/rollers', { count: 1 });
    const first = await ctx.call('POST', '/api/scans', { code: 'ROL000001' });
    assert.equal(first.body.result, 'out');
    const second = await ctx.call('POST', '/api/scans', { code: 'ROL000001' });
    assert.equal(second.body.result, 'duplicate');
    assert.equal(second.body.roller.status, 'in_transit');
    ctx.db.prepare('UPDATE rollers SET last_movement_at = ?').run(new Date(Date.now() - 3000).toISOString());
    const back = await ctx.call('POST', '/api/scans', { code: 'ROL000001' });
    assert.equal(back.body.result, 'in', 'passé le délai, le rescan est un retour');
    ctx.server.close();
    ctx.db.close();
  });
});

describe("code d'accès", () => {
  test('sans ACCESS_CODE, aucun code demandé', async () => {
    const ctx = await startServer();
    const r = await ctx.call('GET', '/api/stats');
    assert.equal(r.status, 200);
    ctx.server.close();
    ctx.db.close();
  });

  test('avec ACCESS_CODE : requis, vérifié, et limité en tentatives', async () => {
    const ctx = await startServer({ accessCode: 'Mewa-2026' });
    const missing = await ctx.call('GET', '/api/stats');
    assert.equal(missing.status, 401);
    assert.equal(missing.body.error, 'access_code_required');

    const wrong = await ctx.call('GET', '/api/stats', undefined, { 'X-Access-Code': 'faux' });
    assert.equal(wrong.body.error, 'access_code_invalid');

    const ok = await ctx.call('GET', '/api/stats', undefined, { 'X-Access-Code': encodeURIComponent('Mewa-2026') });
    assert.equal(ok.status, 200);

    const health = await ctx.call('GET', '/api/health');
    assert.equal(health.status, 200, 'la sonde de santé reste accessible');

    for (let i = 0; i < 10; i++) await ctx.call('GET', '/api/stats', undefined, { 'X-Access-Code': 'faux' });
    const blocked = await ctx.call('GET', '/api/stats', undefined, { 'X-Access-Code': encodeURIComponent('Mewa-2026') });
    assert.equal(blocked.status, 429);
    ctx.server.close();
    ctx.db.close();
  });

  test('configuration invalide', () => {
    assert.throws(() => loadConfig({ codePrefix: 'MAQ' }), /CODE_PREFIX/);
  });
});

describe('interface web', () => {
  test("sert la page avec les en-têtes de sécurité, l'API reste en no-store", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rollers-ui-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Rollers</title>');
    const ctx = await startServer({ publicDir: dir });
    const page = await ctx.call('GET', '/');
    assert.equal(page.status, 200);
    assert.match(page.text, /<title>Rollers<\/title>/);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(page.headers.get('cache-control'), 'no-cache');
    const api = await ctx.call('GET', '/api/health');
    assert.equal(api.headers.get('cache-control'), 'no-store');
    const missing = await ctx.call('GET', '/api/inexistant');
    assert.equal(missing.status, 404);
    ctx.server.close();
    ctx.db.close();
  });
});
