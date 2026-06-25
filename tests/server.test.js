import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmp = await mkdtemp(join(tmpdir(), 'workstr-'));
process.env.WORKSTR_DB_STORE = join(tmp, 'workstr.db');
process.env.WORKSTR_ENV_FILE = join(tmp, '.env');

const { createServer, authConfigured } = await import('../src/server.js');
const { __test: discoverTest } = await import('../src/app/discover.js');
const { buildExerciseTemplateEvent } = await import('../src/app/idenstr.js');

async function withServer(assertions, { user, pass } = {}) {
  if (user) { process.env.WORKSTR_AUTH_USER = user; process.env.WORKSTR_AUTH_PASSWORD = pass; }
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await assertions(base); }
  finally {
    await new Promise((resolve) => server.close(resolve));
    if (user) { delete process.env.WORKSTR_AUTH_USER; delete process.env.WORKSTR_AUTH_PASSWORD; }
  }
}

const get = async (base, path, opts) => { const r = await fetch(base + path, opts); return [r.status, await r.json().catch(() => null)]; };
const post = (base, path, body) => get(base, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const del = (base, path) => get(base, path, { method: 'DELETE' });

test('health is open without credentials', async () => {
  await withServer(async (base) => {
    const [status, body] = await get(base, '/api/v1/health');
    assert.equal(status, 200);
    assert.equal(body.app, 'workstr');
  });
});

test('exercise library starts empty and serves manually created exercises', async () => {
  await withServer(async (base) => {
    const [initialStatus, initialBody] = await get(base, '/api/v1/exercises');
    assert.equal(initialStatus, 200);
    assert.equal(initialBody.exercises.length, 0);

    const [createdStatus, created] = await post(base, '/api/v1/exercises', { name: 'Dumbbell Bicep Curl', muscleGroup: 'Biceps' });
    assert.equal(createdStatus, 201);
    assert.equal(created.sourceType, 'manual');

    const [status, body] = await get(base, '/api/v1/exercises');
    assert.equal(status, 200);
    assert.equal(body.exercises.length, 1);
    assert.equal(body.exercises[0].slug, 'dumbbell-bicep-curl');
  });
});

test('smart delete: unreferenced exercise is purged, referenced one is kept for history', async () => {
  await withServer(async (base) => {
    // Unreferenced -> hard delete, removed entirely (deleting again is a 404).
    await post(base, '/api/v1/exercises', { name: 'Lonely Lift' });
    const [delStatus, delBody] = await del(base, '/api/v1/exercises/lonely-lift');
    assert.equal(delStatus, 200);
    assert.equal(delBody.deleted, true);
    const [, afterList] = await get(base, '/api/v1/exercises');
    assert.equal(afterList.exercises.some((e) => e.slug === 'lonely-lift'), false);
    const [missStatus] = await del(base, '/api/v1/exercises/lonely-lift');
    assert.equal(missStatus, 404);

    // Referenced by a sheet -> soft delete: hidden from the library, name survives.
    await post(base, '/api/v1/exercises', { name: 'Used Lift' });
    const [, sheet] = await post(base, '/api/v1/sheets', { name: 'Day A', exercises: [{ exerciseSlug: 'used-lift', sets: 3, reps: '5' }] });
    assert.equal((await del(base, '/api/v1/exercises/used-lift'))[0], 200);
    const [, list2] = await get(base, '/api/v1/exercises');
    assert.equal(list2.exercises.some((e) => e.slug === 'used-lift'), false);
    const [, sheetAfter] = await get(base, `/api/v1/sheets/${sheet.id}`);
    assert.equal(sheetAfter.exercises[0].exerciseName, 'Used Lift');
  });
});

test('sheet build, session logging and stats flow', async () => {
  await withServer(async (base) => {
    await post(base, '/api/v1/exercises', { name: 'Dumbbell Bicep Curl', muscleGroup: 'Biceps' });

    const [, sheet] = await post(base, '/api/v1/sheets', { name: 'Push', exercises: [{ exerciseSlug: 'dumbbell-bicep-curl', sets: 3, reps: '5' }] });
    assert.equal(sheet.name, 'Push');
    assert.equal(sheet.exercises.length, 1);

    const [, session] = await post(base, '/api/v1/sessions', { sheetId: sheet.id });
    assert.equal(session.sheetName, 'Push');

    await post(base, `/api/v1/sessions/${session.id}/sets`, { exerciseSlug: 'dumbbell-bicep-curl', setNumber: 1, reps: 5, weight: 100 });
    const [, finished] = await post(base, `/api/v1/sessions/${session.id}/finish`, {});
    assert.equal(finished.sets.length, 1);

    const [, stats] = await get(base, '/api/v1/stats');
    assert.equal(stats.totalVolume, 500);
    assert.ok(stats.prs.length >= 1);
  });
});

test('connect config exposes the required Idenstr scopes', async () => {
  await withServer(async (base) => {
    const [status, body] = await get(base, '/api/v1/connect');
    assert.equal(status, 200);
    assert.deepEqual(body.requiredScopes, ['profile:read', 'relays:read', 'sign:kind:30078', 'sign:kind:27235', 'publish:kind:1', 'publish:kind:33401']);
  });
});

// A stand-in Idenstr that captures whatever Workstr asks it to sign/publish.
function fakeIdenstr(onPublish) {
  return http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const reqBody = raw ? JSON.parse(raw) : {};
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/api/v1/events/publish') {
      onPublish(reqBody);
      const event = { ...reqBody, id: 'evt_' + Math.random().toString(36).slice(2), pubkey: 'a'.repeat(64), sig: 'b'.repeat(128) };
      return res.end(JSON.stringify({ event, relayResults: [{ relay: 'wss://relay.test', accepted: true }] }));
    }
    res.end('{}');
  });
}

test('publishing an exercise broadcasts an addressable NIP-101e kind:33401 event', async () => {
  await withServer(async (base) => {
    let captured = null;
    const iden = fakeIdenstr((b) => { captured = b; });
    await new Promise((r) => iden.listen(0, '127.0.0.1', r));
    const idenstrUrl = `http://127.0.0.1:${iden.address().port}`;
    try {
      const [cfgStatus] = await get(base, '/api/v1/connect', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idenstrUrl, idenstrToken: 'test-token' }) });
      assert.equal(cfgStatus, 200);

      await post(base, '/api/v1/exercises', { name: 'Air Squat', muscleGroup: 'Legs' });
      const [pubStatus, pub] = await post(base, '/api/v1/exercises/air-squat/publish', {});
      assert.equal(pubStatus, 200);

      // The event reached Idenstr as a valid NIP-101e template with the addressable d-tag.
      assert.equal(captured.kind, 33401);
      assert.ok(captured.tags.some((t) => t[0] === 'd' && t[1] === 'workstr:exercise:air-squat'));
      assert.ok(captured.tags.some((t) => t[0] === 'title' && t[1] === 'Air Squat'));
      assert.ok(captured.tags.some((t) => t[0] === 'format'));
      assert.ok(captured.tags.some((t) => t[0] === 't' && t[1] === 'workstr'));
      assert.ok(captured.tags.some((t) => t[0] === 'workstr_meta'));

      // The address is returned and the published coordinates are persisted on the row.
      assert.match(pub.address, /^33401:a{64}:workstr:exercise:air-squat$/);
      const [, list] = await get(base, '/api/v1/exercises');
      const ex = list.exercises.find((e) => e.slug === 'air-squat');
      assert.ok(ex.nostrEventId, 'exercise records its published event id');
      assert.equal(ex.nostrAddress, pub.address);
    } finally {
      await new Promise((r) => iden.close(r));
    }
  });
});

test('NIP-101e exercise templates are parsed into Workstr recovery muscles', () => {
  const ev = {
    id: 'evt_nip101e_squat',
    pubkey: 'd'.repeat(64),
    kind: 33401,
    created_at: 1770000000,
    content: 'Barbell squatting movement building lower body strength and power.',
    tags: [
      ['d', 'back-squat-bb'],
      ['title', 'Back Squat'],
      ['format', 'weight', 'reps', 'rpe', 'set_type'],
      ['format_units', 'kg', 'count', '0-10', 'enum'],
      ['equipment', 'barbell'],
      ['difficulty', 'beginner'],
      ['imeta', 'url https://www.youtube.com/watch?v=XT1SYF8SzU4'],
      ['t', 'legs'],
      ['t', 'squat']
    ]
  };
  const ex = discoverTest.toNip101eExercise(ev);
  assert.equal(ex.protocol, 'nip101e');
  assert.equal(ex.kind, 33401);
  assert.equal(ex.name, 'Back Squat');
  assert.equal(ex.address, `33401:${'d'.repeat(64)}:back-squat-bb`);
  assert.equal(ex.muscleGroup, 'Quadriceps');
  assert.ok(ex.muscles.includes('Glutes'));
  assert.ok(ex.muscles.includes('Hamstrings'));
  assert.ok(ex.muscles.includes('Core'));
  assert.deepEqual(ex.equipment, ['barbell']);
  assert.equal(ex.category, 'squat');
  assert.equal(ex.mediaUrl, 'https://www.youtube.com/watch?v=XT1SYF8SzU4');
  assert.equal(ex.image, 'https://img.youtube.com/vi/XT1SYF8SzU4/hqdefault.jpg');
  assert.ok(ex.instructions.some((i) => i.includes('Demo video:')));
});

test('Workstr exercises publish as valid NIP-101e 33401 templates', () => {
  const ex = {
    slug: 'back-squat', name: 'Back Squat', description: 'Brace and sit back.',
    category: 'squat', muscleGroup: 'Quadriceps',
    muscles: ['Quadriceps', 'Glutes', 'Hamstrings', 'Core'],
    equipment: ['barbell'], difficulty: 'Intermediate', tags: ['compound'],
    instructions: ['Unrack', 'Descend', 'Drive up'],
    defaultSets: 5, defaultReps: '5', defaultRest: 180
  };
  const ev = buildExerciseTemplateEvent(ex, 'https://image.nostr.build/x.jpg');
  assert.equal(ev.kind, 33401);
  // The event passes the discovery parser's NIP-101e validity gate.
  assert.ok(discoverTest.isNip101eExerciseEvent(ev));
  const t = (k) => ev.tags.find((row) => row[0] === k);
  assert.equal(t('d')[1], 'workstr:exercise:back-squat');
  assert.equal(t('title')[1], 'Back Squat');
  assert.deepEqual(t('format').slice(1), ['weight', 'reps', 'rpe', 'set_type']);
  assert.equal(t('equipment')[1], 'barbell');
  assert.equal(t('difficulty')[1], 'intermediate');
  assert.ok(ev.tags.some((row) => row[0] === 't' && row[1] === 'workstr'));
  assert.ok(ev.tags.some((row) => row[0] === 'workstr_muscle' && row[1] === 'Quadriceps' && row[2] === 'primary'));
  assert.equal(ev.content, 'Brace and sit back.\nUnrack\nDescend\nDrive up');
});

test('Workstr-origin 33401 events re-import losslessly with exact recovery map', () => {
  const source = {
    slug: 'romanian-deadlift', name: 'Romanian Deadlift', description: 'Hip hinge.',
    category: 'hinge', muscleGroup: 'Hamstrings',
    muscles: ['Hamstrings', 'Glutes', 'Back'],
    equipment: ['barbell'], difficulty: 'intermediate', tags: ['posterior'],
    instructions: ['Hinge at hips', 'Return'], defaultSets: 4, defaultReps: '8', defaultRest: 120
  };
  const built = buildExerciseTemplateEvent(source);
  const ev = { ...built, id: 'evt_rdl', pubkey: 'f'.repeat(64), created_at: 1770000000 };
  const ex = discoverTest.toNip101eExercise(ev);
  assert.equal(ex.protocol, 'workstr', 'own exercises group under Workstr, not NIP-101e');
  assert.equal(ex.slug, 'romanian-deadlift');
  assert.equal(ex.muscleGroup, 'Hamstrings');
  assert.deepEqual(ex.muscles, ['Hamstrings', 'Glutes', 'Back']);
  assert.deepEqual(ex.equipment, ['barbell']);
  assert.deepEqual(ex.instructions, ['Hinge at hips', 'Return']);
  assert.equal(ex.defaultReps, '8');
  assert.equal(ex.address, `33401:${'f'.repeat(64)}:workstr:exercise:romanian-deadlift`);
});

test('NIP-101e parser rejects non-fitness 33401 collisions', () => {
  const ev = {
    id: 'evt_task',
    pubkey: 'e'.repeat(64),
    kind: 33401,
    created_at: 1770000000,
    content: '{"title":"Task","description":"not an exercise"}',
    tags: [['d', 'task-1'], ['title', 'Task'], ['t', 'catallax']]
  };
  assert.equal(discoverTest.toNip101eExercise(ev), null);
});

test('discover import saves a shared exercise into the library and dedups re-imports', async () => {
  await withServer(async (base) => {
    const shared = {
      name: 'Kettlebell Swing',
      slug: 'kettlebell-swing',
      muscleGroup: 'Posterior chain',
      instructions: ['Hinge', 'Swing'],
      defaultSets: 4,
      defaultReps: '10',
      eventId: 'evt_kb',
      pubkey: 'c'.repeat(64),
      address: `30078:${'c'.repeat(64)}:workstr:exercise:kettlebell-swing`
    };
    const [s1, r1] = await post(base, '/api/v1/discover/import', shared);
    assert.equal(s1, 201);
    assert.equal(r1.duplicate, false);
    assert.equal(r1.exercise.sourceType, 'nostr');
    assert.equal(r1.exercise.nostrAddress, shared.address);

    const [, list] = await get(base, '/api/v1/exercises');
    assert.equal(list.exercises.filter((e) => e.slug === 'kettlebell-swing').length, 1);

    const [s2, r2] = await post(base, '/api/v1/discover/import', shared);
    assert.equal(s2, 201);
    assert.equal(r2.duplicate, true);
    const [, list2] = await get(base, '/api/v1/exercises');
    assert.equal(list2.exercises.filter((e) => e.slug === 'kettlebell-swing').length, 1);
  });
});

test('discover reports not-configured when no relays are reachable', async () => {
  await withServer(async (base) => {
    const [status, body] = await get(base, '/api/v1/discover/exercises');
    assert.equal(status, 200);
    assert.equal(body.configured, false);
    assert.deepEqual(body.exercises, []);
  });
});

test('with credentials configured, the API requires Basic auth', async () => {
  await withServer(async (base) => {
    const [noAuth, , ] = [await fetch(base + '/api/v1/exercises')].map((r) => r);
    assert.equal(noAuth.status, 401);
    assert.match(noAuth.headers.get('www-authenticate') ?? '', /^Basic /);

    const ok = await fetch(base + '/api/v1/exercises', { headers: { authorization: 'Basic ' + Buffer.from('coach:secret').toString('base64') } });
    assert.equal(ok.status, 200);

    const open = await fetch(base + '/api/v1/health');
    assert.equal(open.status, 200, 'health stays open');
  }, { user: 'coach', pass: 'secret' });
});

test('authConfigured reflects whether dashboard credentials are set', () => {
  assert.equal(authConfigured(), false);
});
