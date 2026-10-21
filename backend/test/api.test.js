import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { normalizeScannedCode } from '../src/codes.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';

const ADMIN_PASSWORD = 'Admin-Test-2026';

async function startServer(overrides = {}, dbPath = ':memory:') {
  const config = loadConfig({ dbPath, publicDir: '/nonexistent', adminPassword: ADMIN_PASSWORD, ...overrides });
  const db = openDatabase(dbPath);
  const app = createApp(db, config);
  const admin = await app.locals.accounts.ensureAdmin();
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      // Un « navigateur » = un cookie de session.
      const client = () => {
        let cookie = '';
        const call = async (method, path, body, headers = {}) => {
          const res = await fetch(base + path, {
            method,
            headers: {
              'Content-Type': 'application/json',
              'X-Requested-With': 'mewa-rollers',
              ...(cookie ? { Cookie: cookie } : {}),
              ...headers,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          const setCookie = res.headers.get('set-cookie');
          if (setCookie) cookie = setCookie.split(';')[0].endsWith('=') ? '' : setCookie.split(';')[0];
          const text = await res.text();
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* CSV */
          }
          return { status: res.status, body: json, text, headers: res.headers };
        };
        call.login = (username, password) => call('POST', '/api/auth/login', { username, password });
        return call;
      };
      const close = () => {
        server.close();
        db.close();
      };
      resolve({ server, db, client, admin, close });
    });
  });
}

/** Serveur + session administrateur + agence GS75 avec un compte agent connecté. */
async function setup(overrides) {
  const ctx = await startServer(overrides);
  const admin = ctx.client();
  assert.equal((await admin.login('admin', ADMIN_PASSWORD)).status, 200);
  const agencies = (await admin('GET', '/api/admin/agencies')).body;
  const gs75 = agencies.find((a) => a.code === 'GS75');
  const gs76 = agencies.find((a) => a.code === 'GS76');
  await admin('POST', '/api/admin/users', { username: 'agent75', password: 'Toussieu-75', role: 'agent', agencyId: gs75.id });
  await admin('POST', '/api/admin/users', { username: 'agent76', password: 'Agence-76!', role: 'agent', agencyId: gs76.id });
  const agent = ctx.client();
  assert.equal((await agent.login('agent75', 'Toussieu-75')).status, 200);
  return { ...ctx, adminCall: admin, agent, gs75, gs76 };
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

describe('connexion', () => {
  let ctx;
  before(async () => {
    ctx = await setup();
  });
  after(() => ctx.close());

  test('sans session, les données sont refusées ; la sonde de santé reste ouverte', async () => {
    const anon = ctx.client();
    const r = await anon('GET', '/api/stats');
    assert.equal(r.status, 401);
    assert.equal(r.body.error, 'auth_required');
    assert.equal((await anon('GET', '/api/health')).status, 200);
  });

  test('identifiants faux refusés, puis blocage après 10 échecs', async () => {
    const c = ctx.client();
    const wrong = await c.login('agent75', 'mauvais-mdp');
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error, 'invalid_credentials');
    const unknown = await c.login('inconnu', 'mauvais-mdp');
    assert.equal(unknown.body.message, wrong.body.message, 'même message pour un identifiant inconnu');
    for (let i = 0; i < 9; i++) await c.login('agent75', 'mauvais-mdp');
    const blocked = await c.login('agent75', 'Toussieu-75');
    assert.equal(blocked.status, 429);
  });

  test('cookie de session HttpOnly + SameSite=Strict, identifiant insensible à la casse', async () => {
    const res = await fetch(`http://127.0.0.1:${ctx.server.address().port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'mewa-rollers', 'X-Forwarded-For': '10.0.0.9' },
      body: JSON.stringify({ username: 'AGENT75', password: 'Toussieu-75' }),
    });
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    const body = await res.json();
    assert.equal(body.user.agency.code, 'GS75');
    assert.equal(body.user.agency.name, 'GS75 Toussieu');
    assert.equal(body.user.role, 'agent');
    assert.equal(body.user.password_hash, undefined, "l'empreinte du mot de passe n'est jamais renvoyée");
  });

  test('requête modifiante sans en-tête anti-CSRF refusée', async () => {
    const r = await ctx.agent('POST', '/api/rollers', { count: 1 }, { 'X-Requested-With': '' });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'csrf');
  });

  test('changement de son propre mot de passe, puis déconnexion', async () => {
    const c = ctx.client();
    await c.login('agent76', 'Agence-76!');
    const wrong = await c('POST', '/api/auth/password', { currentPassword: 'faux', newPassword: 'Nouveau-76!' });
    assert.equal(wrong.body.error, 'wrong_password');
    const weak = await c('POST', '/api/auth/password', { currentPassword: 'Agence-76!', newPassword: 'court' });
    assert.equal(weak.body.error, 'weak_password');
    const ok = await c('POST', '/api/auth/password', { currentPassword: 'Agence-76!', newPassword: 'Nouveau-76!' });
    assert.equal(ok.status, 200);
    assert.equal((await c('POST', '/api/auth/logout')).status, 200);
    assert.equal((await c('GET', '/api/auth/me')).body.user, null);
    assert.equal((await c.login('agent76', 'Nouveau-76!')).status, 200);
  });

  test('un compte agent n’accède pas à l’administration', async () => {
    const r = await ctx.agent('GET', '/api/admin/users');
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'admin_only');
  });
});

describe('administrateur initial', () => {
  test('sans ADMIN_PASSWORD : mot de passe provisoire à changer avant tout accès', async () => {
    const ctx = await startServer({ adminPassword: '' });
    assert.equal(ctx.admin.generated, true);
    assert.ok(ctx.admin.password.length >= 12);
    const c = ctx.client();
    const login = await c.login('admin', ctx.admin.password);
    assert.equal(login.body.user.mustChangePassword, true);
    const blocked = await c('GET', '/api/stats');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error, 'password_change_required');
    await c('POST', '/api/auth/password', { currentPassword: ctx.admin.password, newPassword: 'Definitif-2026' });
    assert.equal((await c('GET', '/api/stats')).status, 200);
    assert.equal(await ctx.client().login('admin', ctx.admin.password).then((r) => r.status), 401);
    ctx.close();
  });
});

describe('administration : agences et utilisateurs', () => {
  let ctx;
  before(async () => {
    ctx = await setup();
  });
  after(() => ctx.close());

  test('les 6 agences sont créées au premier démarrage, avec leur ville', async () => {
    const r = await ctx.adminCall('GET', '/api/admin/agencies');
    assert.deepEqual(
      r.body.map((a) => a.name),
      ['GS18 Saarlouis', 'GS60 Binche', 'GS74 Spay', 'GS75 Toussieu', 'GS76 Rémy', 'GS78 Gémenos'],
    );
    assert.equal(r.body.find((a) => a.code === 'GS75').users, 1);
  });

  test('création, modification et suppression d’une agence', async () => {
    const created = await ctx.adminCall('POST', '/api/admin/agencies', { code: 'gs 80', city: 'Amiens' });
    assert.equal(created.status, 201);
    assert.equal(created.body.code, 'GS80');
    const dup = await ctx.adminCall('POST', '/api/admin/agencies', { code: 'GS80' });
    assert.equal(dup.status, 409);
    const renamed = await ctx.adminCall('PATCH', `/api/admin/agencies/${created.body.id}`, { city: 'Abbeville' });
    assert.equal(renamed.body.name, 'GS80 Abbeville');
    const used = await ctx.adminCall('DELETE', `/api/admin/agencies/${ctx.gs75.id}`);
    assert.equal(used.status, 409, 'une agence avec des utilisateurs ne peut pas être supprimée');
    const del = await ctx.adminCall('DELETE', `/api/admin/agencies/${created.body.id}`);
    assert.equal(del.status, 204);
  });

  test('un compte agent doit avoir une agence, un administrateur non', async () => {
    const noAgency = await ctx.adminCall('POST', '/api/admin/users', { username: 'sans.agence', password: 'Password-1', role: 'agent' });
    assert.equal(noAgency.status, 400);
    assert.equal(noAgency.body.error, 'agency_required');
    const admin2 = await ctx.adminCall('POST', '/api/admin/users', {
      username: 'admin.it',
      password: 'Password-1',
      role: 'admin',
      agencyId: ctx.gs75.id,
    });
    assert.equal(admin2.status, 201);
    assert.equal(admin2.body.agency, null, "l'agence est ignorée pour un administrateur");
    const dup = await ctx.adminCall('POST', '/api/admin/users', { username: 'ADMIN.IT', password: 'Password-1', role: 'admin' });
    assert.equal(dup.status, 409);
    const badName = await ctx.adminCall('POST', '/api/admin/users', { username: 'é é', password: 'Password-1', role: 'admin' });
    assert.equal(badName.body.error, 'invalid_username');
  });

  test("nouveau mot de passe défini par l'admin : anciennes sessions fermées", async () => {
    const users = (await ctx.adminCall('GET', '/api/admin/users')).body;
    const agent76 = users.find((u) => u.username === 'agent76');
    const c = ctx.client();
    await c.login('agent76', 'Agence-76!');
    assert.equal((await c('GET', '/api/stats')).status, 200);
    const r = await ctx.adminCall('PATCH', `/api/admin/users/${agent76.id}`, { password: 'Reinit-7676' });
    assert.equal(r.status, 200);
    assert.equal((await c('GET', '/api/stats')).status, 401);
    assert.equal((await c.login('agent76', 'Reinit-7676')).status, 200);
  });

  test('changement d’agence, protections du dernier administrateur et de son propre compte', async () => {
    const users = (await ctx.adminCall('GET', '/api/admin/users')).body;
    const agent76 = users.find((u) => u.username === 'agent76');
    const moved = await ctx.adminCall('PATCH', `/api/admin/users/${agent76.id}`, { agencyId: ctx.gs75.id });
    assert.equal(moved.body.agency.code, 'GS75');

    const me = users.find((u) => u.username === 'admin');
    const selfDelete = await ctx.adminCall('DELETE', `/api/admin/users/${me.id}`);
    assert.equal(selfDelete.body.error, 'self_delete');
    const selfDemote = await ctx.adminCall('PATCH', `/api/admin/users/${me.id}`, { role: 'agent', agencyId: ctx.gs75.id });
    assert.equal(selfDemote.body.error, 'self_demote');

    const other = users.find((u) => u.username === 'admin.it');
    assert.equal((await ctx.adminCall('DELETE', `/api/admin/users/${other.id}`)).status, 204);
    assert.equal((await ctx.adminCall('DELETE', `/api/admin/users/${agent76.id}`)).status, 204);
    const after = (await ctx.adminCall('GET', '/api/admin/users')).body;
    assert.ok(!after.some((u) => u.username === 'agent76'));
  });
});

describe('rollers d’une agence', () => {
  let ctx;
  before(async () => {
    ctx = await setup({ duplicateWindowSeconds: 0, rescanConfirmHours: 0 });
  });
  after(() => ctx.close());

  test('création : codes séquentiels, rattachés à l’agence de l’utilisateur', async () => {
    const r = await ctx.agent('POST', '/api/rollers', { count: 3, label: 'Roller linge', agencyId: ctx.gs76.id });
    assert.equal(r.status, 201);
    assert.deepEqual(
      r.body.map((x) => x.code),
      ['ROL000001', 'ROL000002', 'ROL000003'],
    );
    assert.equal(r.body[1].label, 'Roller linge 2');
    assert.equal(r.body[0].agency.code, 'GS75', "un agent ne peut créer que dans sa propre agence");
    assert.equal(r.body[0].createdBy, 'agent75');

    const one = await ctx.agent('POST', '/api/rollers', { count: 1, label: 'Seul' });
    assert.equal(one.body[0].code, 'ROL000004');
    const invalid = await ctx.agent('POST', '/api/rollers', { count: 0 });
    assert.equal(invalid.body.error, 'invalid_count');
  });

  test("l'administrateur crée dans l'agence choisie (obligatoire)", async () => {
    const missing = await ctx.adminCall('POST', '/api/rollers', { count: 1 });
    assert.equal(missing.body.error, 'unknown_agency');
    const r = await ctx.adminCall('POST', '/api/rollers', { count: 2, agencyId: ctx.gs76.id });
    assert.deepEqual(
      r.body.map((x) => [x.code, x.agency.code]),
      [
        ['ROL000005', 'GS76'],
        ['ROL000006', 'GS76'],
      ],
    );
  });

  test('scan auto : départ puis retour, avec le nom de l’utilisateur', async () => {
    const out = await ctx.agent('POST', '/api/scans', { code: 'ROL000001' });
    assert.equal(out.body.result, 'out');
    assert.equal(out.body.roller.status, 'in_transit');
    assert.equal(out.body.movement.agent, 'agent75');
    assert.equal(out.body.movement.kind, 'out');

    const stats = await ctx.agent('GET', '/api/stats');
    assert.equal(stats.body.inTransit, 1);
    assert.equal(stats.body.onSite, 3);
    assert.equal(stats.body.total, 4, 'les rollers de GS76 ne sont pas comptés');
    assert.equal(stats.body.outToday, 1);
    assert.equal(stats.body.overdueDays, 14);

    const back = await ctx.agent('POST', '/api/scans', { code: 'ROLààààà&' });
    assert.equal(back.body.result, 'in');
    assert.equal(back.body.departedAt, out.body.movement.scannedAt, 'un retour indique la date du départ');
  });

  test("un roller d'une autre agence est refusé, un code inconnu aussi", async () => {
    const other = await ctx.agent('POST', '/api/scans', { code: 'ROL000005' });
    assert.equal(other.status, 403);
    assert.equal(other.body.error, 'other_agency');
    assert.match(other.body.message, /GS76/);
    assert.equal((await ctx.agent('GET', '/api/rollers/ROL000005')).status, 403);
    const list = await ctx.agent('GET', '/api/rollers');
    assert.ok(!list.body.some((r) => r.code === 'ROL000005'));
    const unknown = await ctx.agent('POST', '/api/scans', { code: 'ROL999999' });
    assert.equal(unknown.body.error, 'unknown_code');
  });

  test('annulation du dernier mouvement uniquement', async () => {
    const out = await ctx.agent('POST', '/api/scans', { code: 'ROL000003' });
    const back = await ctx.agent('POST', '/api/scans', { code: 'ROL000003' });
    const notLatest = await ctx.agent('POST', `/api/movements/${out.body.movement.id}/cancel`);
    assert.equal(notLatest.status, 409);
    const cancel = await ctx.agent('POST', `/api/movements/${back.body.movement.id}/cancel`);
    assert.equal(cancel.body.roller.status, 'in_transit');
    const cancelOut = await ctx.agent('POST', `/api/movements/${out.body.movement.id}/cancel`);
    assert.equal(cancelOut.body.roller.status, 'on_site');
    assert.equal(cancelOut.body.roller.lastMovementAt, null);
    const twice = await ctx.agent('POST', `/api/movements/${out.body.movement.id}/cancel`);
    assert.equal(twice.status, 409);
  });

  test('maintenance : une ou plusieurs raisons, scan bloqué, puis remise en service', async () => {
    const none = await ctx.agent('POST', '/api/rollers/ROL000002/maintenance', { reasons: [] });
    assert.equal(none.body.error, 'missing_reasons');
    const start = await ctx.agent('POST', '/api/rollers/ROL000002/maintenance', { reasons: ['plateaux', 'roulettes', 'inconnu'] });
    assert.equal(start.status, 200);
    assert.equal(start.body.roller.status, 'maintenance');
    assert.deepEqual(start.body.roller.maintenanceReasons, ['roulettes', 'plateaux']);
    assert.equal(start.body.movement.kind, 'maintenance_start');

    const scan = await ctx.agent('POST', '/api/scans', { code: 'ROL000002' });
    assert.equal(scan.status, 409);
    assert.equal(scan.body.error, 'in_maintenance');
    assert.equal(scan.body.roller.code, 'ROL000002');

    const edit = await ctx.agent('POST', '/api/rollers/ROL000002/maintenance', { reasons: ['paroi'] });
    assert.deepEqual(edit.body.roller.maintenanceReasons, ['paroi']);
    const stats = await ctx.agent('GET', '/api/stats');
    assert.equal(stats.body.maintenance, 1);
    const filtered = await ctx.agent('GET', '/api/rollers?status=maintenance');
    assert.deepEqual(
      filtered.body.map((r) => r.code),
      ['ROL000002'],
    );

    const end = await ctx.agent('DELETE', '/api/rollers/ROL000002/maintenance');
    assert.equal(end.body.roller.status, 'on_site');
    assert.deepEqual(end.body.roller.maintenanceReasons, []);
    const cancelEnd = await ctx.agent('POST', `/api/movements/${end.body.movement.id}/cancel`);
    assert.equal(cancelEnd.body.roller.status, 'maintenance', "annuler la fin de maintenance la rétablit");
    assert.deepEqual(cancelEnd.body.roller.maintenanceReasons, ['paroi']);
    await ctx.agent('DELETE', '/api/rollers/ROL000002/maintenance');
    assert.equal((await ctx.agent('POST', '/api/scans', { code: 'ROL000002' })).body.result, 'out');
    const inTransit = await ctx.agent('POST', '/api/rollers/ROL000002/maintenance', { reasons: ['paroi'] });
    assert.equal(inTransit.body.error, 'in_transit');
  });

  test('retard après 14 jours en transit', async () => {
    ctx.db
      .prepare(`UPDATE rollers SET last_movement_at = ? WHERE code = 'ROL000002'`)
      .run(new Date(Date.now() - 13 * 86400_000).toISOString());
    assert.equal((await ctx.agent('GET', '/api/stats')).body.overdue, 0);
    ctx.db
      .prepare(`UPDATE rollers SET last_movement_at = ? WHERE code = 'ROL000002'`)
      .run(new Date(Date.now() - 15 * 86400_000).toISOString());
    assert.equal((await ctx.agent('GET', '/api/stats')).body.overdue, 1);
    const overdue = await ctx.agent('GET', '/api/rollers?status=overdue');
    assert.equal(overdue.body[0].overdue, true);
  });

  test('archivage, historique de l’agence et export CSV', async () => {
    const patched = await ctx.agent('PATCH', '/api/rollers/ROL000004', { label: 'Renommé', archived: true });
    assert.equal(patched.body.archived, true);
    const scanArchived = await ctx.agent('POST', '/api/scans', { code: 'ROL000004' });
    assert.equal(scanArchived.body.error, 'archived');

    const moves = await ctx.agent('GET', '/api/movements');
    assert.ok(moves.body.length > 0);
    assert.ok(moves.body.every((m) => m.agency.code === 'GS75'));

    const csv = await ctx.agent('GET', '/api/export/movements.csv');
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(csv.text, /Date;Agence;Code;Libellé;Mouvement;Maintenance;Utilisateur;Annulé/);
    assert.match(csv.text, /GS75 Toussieu;ROL000001;Roller linge 1;Départ;;agent75;/);
    assert.match(csv.text, /Mise en maintenance;Roulettes, Plateaux|Mise en maintenance;Paroi/);
  });

  test("supervision de l'administrateur : toutes les agences, filtre par agence, transfert", async () => {
    const overview = await ctx.adminCall('GET', '/api/admin/overview');
    assert.equal(overview.body.totals.total, 5, 'GS75 (3 actifs) + GS76 (2)');
    const gs76 = overview.body.agencies.find((a) => a.agency.code === 'GS76');
    assert.equal(gs76.onSite, 2);
    assert.equal(overview.body.agencies.length, 6);
    assert.equal(overview.body.activity.length, 14, '14 jours d’activité');
    const today = overview.body.activity.at(-1);
    assert.ok(today.out >= 1 && today.in >= 1, 'les scans du jour sont comptés');
    assert.deepEqual(
      overview.body.overdueRollers.map((r) => r.code),
      ['ROL000002'],
      'les rollers en retard sont listés',
    );

    const all = await ctx.adminCall('GET', '/api/rollers');
    assert.equal(all.body.length, 5);
    const only76 = await ctx.adminCall('GET', `/api/rollers?agency=${ctx.gs76.id}`);
    assert.equal(only76.body.length, 2);

    const moved = await ctx.adminCall('PATCH', '/api/rollers/ROL000006', { agencyId: ctx.gs75.id });
    assert.equal(moved.body.agency.code, 'GS75');
    const notByAgent = await ctx.agent('PATCH', '/api/rollers/ROL000006', { agencyId: ctx.gs76.id });
    assert.equal(notByAgent.body.agency.code, 'GS75', 'un agent ne peut pas transférer un roller');
  });

  test('format des codes et raisons de maintenance', async () => {
    const info = await ctx.agent('GET', '/api/info');
    assert.equal(info.body.codePrefix, 'ROL');
    assert.equal(info.body.codeDigits, 6);
    assert.deepEqual(
      info.body.maintenanceReasons.map((r) => r.id),
      ['paroi', 'roulettes', 'plateaux'],
    );
  });
});

describe('anti double-scan', () => {
  test('une double lecture immédiate est ignorée, pas un rescan quelques secondes après', async () => {
    const ctx = await setup({ rescanConfirmHours: 0 });
    await ctx.agent('POST', '/api/rollers', { count: 1 });
    const first = await ctx.agent('POST', '/api/scans', { code: 'ROL000001' });
    assert.equal(first.body.result, 'out');
    const second = await ctx.agent('POST', '/api/scans', { code: 'ROL000001' });
    assert.equal(second.body.result, 'duplicate');
    ctx.db.prepare('UPDATE rollers SET last_movement_at = ?').run(new Date(Date.now() - 3000).toISOString());
    const back = await ctx.agent('POST', '/api/scans', { code: 'ROL000001' });
    assert.equal(back.body.result, 'in', 'passé le délai, le rescan est un retour');
    ctx.close();
  });
});

describe('confirmation d’un rescan dans les 24 h', () => {
  test('premier scan libre, rescan rapproché à confirmer, puis libre après 24 h', async () => {
    const ctx = await setup();
    await ctx.agent('POST', '/api/rollers', { count: 1 });
    const first = await ctx.agent('POST', '/api/scans', { code: 'ROL000001' });
    assert.equal(first.body.result, 'out', 'un roller jamais scanné passe directement');

    const age = (hours) =>
      ctx.db.prepare('UPDATE rollers SET last_movement_at = ?').run(new Date(Date.now() - hours * 3600_000).toISOString());
    age(23);
    const ask = await ctx.agent('POST', '/api/scans', { code: 'ROL000001' });
    assert.equal(ask.status, 200);
    assert.equal(ask.body.result, 'confirm');
    assert.equal(ask.body.lastScan.kind, 'out');
    assert.equal(ask.body.next, 'in');
    assert.equal(ask.body.roller.status, 'in_transit', 'rien n’est enregistré sans confirmation');
    assert.equal((await ctx.agent('GET', '/api/movements')).body.length, 1);

    const confirmed = await ctx.agent('POST', '/api/scans', { code: 'ROL000001', confirm: true });
    assert.equal(confirmed.body.result, 'in');

    age(25);
    const later = await ctx.agent('POST', '/api/scans', { code: 'ROL000001' });
    assert.equal(later.body.result, 'out', 'au-delà de 24 h, pas de confirmation');

    const duplicate = await ctx.agent('POST', '/api/scans', { code: 'ROL000001' });
    assert.equal(duplicate.body.result, 'duplicate', 'une double lecture immédiate reste ignorée sans question');
    ctx.close();
  });
});

describe('migration d’une base v1 (un seul poste)', () => {
  test('rollers et mouvements existants rattachés à GS75', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rollers-v1-'));
    const path = join(dir, 'rollers.db');
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE rollers (id INTEGER PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, code TEXT NOT NULL UNIQUE, label TEXT, notes TEXT,
        status TEXT NOT NULL DEFAULT 'on_site' CHECK (status IN ('on_site', 'in_transit')), last_movement_at TEXT, last_agent TEXT,
        created_at TEXT NOT NULL, created_by TEXT, archived_at TEXT);
      CREATE TABLE movements (id INTEGER PRIMARY KEY, roller_id INTEGER NOT NULL REFERENCES rollers(id),
        direction TEXT NOT NULL CHECK (direction IN ('out', 'in')), agent TEXT, scanned_at TEXT NOT NULL, cancelled_at TEXT, cancelled_by TEXT);
      INSERT INTO rollers VALUES (1, 1, 'ROL000001', 'Ancien', NULL, 'in_transit', '2026-10-01T08:00:00.000Z', 'GS75 Toussieu', '2026-09-01T08:00:00.000Z', 'GS75 Toussieu', NULL);
      INSERT INTO movements VALUES (1, 1, 'out', 'GS75 Toussieu', '2026-10-01T08:00:00.000Z', NULL, NULL);
    `);
    old.close();

    const ctx = await startServer({}, path);
    const admin = ctx.client();
    await admin.login('admin', ADMIN_PASSWORD);
    const roller = await admin('GET', '/api/rollers/ROL000001');
    assert.equal(roller.body.agency.code, 'GS75');
    assert.equal(roller.body.status, 'in_transit');
    assert.equal(roller.body.movements[0].kind, 'out');
    assert.equal(roller.body.movements[0].agent, 'GS75 Toussieu');
    const next = await admin('POST', '/api/rollers', { count: 1, agencyId: roller.body.agency.id });
    assert.equal(next.body[0].code, 'ROL000002', 'la numérotation continue');
    ctx.close();

    // Réouverture : la migration ne se rejoue pas.
    const again = openDatabase(path);
    assert.equal(again.prepare('PRAGMA user_version').get().user_version, 3);
    assert.equal(again.prepare('SELECT COUNT(*) AS n FROM agencies').get().n, 6);
    again.close();
  });
});

describe('migration d’une base v2 (villes des agences)', () => {
  test('ajoute GS18, complète les villes vides sans remplacer une ville saisie', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rollers-v2-'));
    const path = join(dir, 'rollers.db');
    const db = openDatabase(path);
    db.exec(`DELETE FROM agencies WHERE code = 'GS18';
             UPDATE agencies SET city = NULL WHERE code IN ('GS60', 'GS76');
             UPDATE agencies SET city = 'Ma ville' WHERE code = 'GS74';
             PRAGMA user_version = 2;`);
    db.close();

    const again = openDatabase(path);
    const cities = Object.fromEntries(again.prepare('SELECT code, city FROM agencies').all().map((a) => [a.code, a.city]));
    assert.equal(cities.GS18, 'Saarlouis');
    assert.equal(cities.GS60, 'Binche');
    assert.equal(cities.GS76, 'Rémy');
    assert.equal(cities.GS74, 'Ma ville', 'une ville saisie dans le panneau admin est conservée');
    assert.equal(again.prepare('PRAGMA user_version').get().user_version, 3);
    again.close();
  });
});

describe('configuration et interface web', () => {
  test('configuration invalide', () => {
    assert.throws(() => loadConfig({ codePrefix: 'MAQ' }), /CODE_PREFIX/);
  });

  test("sert la page avec les en-têtes de sécurité, l'API reste en no-store", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rollers-ui-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Rollers</title>');
    const ctx = await startServer({ publicDir: dir });
    const c = ctx.client();
    const page = await c('GET', '/');
    assert.equal(page.status, 200);
    assert.match(page.text, /<title>Rollers<\/title>/);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(page.headers.get('cache-control'), 'no-cache');
    const api = await c('GET', '/api/health');
    assert.equal(api.headers.get('cache-control'), 'no-store');
    await c.login('admin', ADMIN_PASSWORD);
    assert.equal((await c('GET', '/api/inexistant')).status, 404);
    ctx.close();
  });
});
