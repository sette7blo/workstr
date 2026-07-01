import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './app/store.js';
import * as idenstr from './app/idenstr.js';
import * as discover from './app/discover.js';
import { localizeImage } from './app/images.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(root, 'public');

const port = Number(process.env.WORKSTR_BIND_PORT ?? process.env.PORT ?? 3003);
const host = process.env.WORKSTR_BIND_HOST ?? '0.0.0.0';

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (error) {
      sendJson(res, 500, { error: 'internal_error', message: error.message });
    }
  });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const { pathname } = url;
  const auth = authorize(req, pathname);
  if (!auth.ok) {
    if (auth.challenge) res.setHeader('WWW-Authenticate', 'Basic realm="Workstr", charset="UTF-8"');
    return sendJson(res, auth.status, auth.body);
  }

  const seg = pathname.split('/').filter(Boolean); // ['api','v1','exercises','plank']
  const api = seg[0] === 'api' && seg[1] === 'v1';
  if (!api) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
      return serveStatic(pathname, res, req.method === 'HEAD', acceptsGzip);
    }
    return sendJson(res, 404, { error: 'not_found' });
  }

  const resource = seg[2];
  const id = seg[3] ? decodeURIComponent(seg[3]) : null;
  const sub = seg[4] ?? null;
  const m = req.method;
  const body = ['POST', 'PUT', 'PATCH'].includes(m) ? await readJson(req) : null;

  // Health (auth handled above; this is reachable without credentials)
  if (m === 'GET' && resource === 'health') return sendJson(res, 200, { status: 'ok', app: 'workstr' });
  if (m === 'GET' && resource === 'dashboard') return sendJson(res, 200, store.dashboard());

  // Exercises
  if (resource === 'exercises') {
    if (m === 'GET' && !id) return sendJson(res, 200, { exercises: store.listExercises().map(exerciseListShape) });
    if (m === 'GET' && id === 'filters') return sendJson(res, 200, store.exerciseFilters());
    if (m === 'POST' && !id) { if (body) body.imageUrl = await localizeImage(body.imageUrl); return sendJson(res, 201, store.createExercise(body)); }
    if (m === 'GET' && id && sub === 'image') return sendExerciseImage(res, id);
    if (m === 'GET' && id && sub === 'last-sets') return sendJson(res, 200, { sets: store.lastSetsForExercise(id, Number(url.searchParams.get('beforeSessionId')) || null) });
    if (m === 'GET' && id) return sendOrNull(res, store.getExercise(id));
    if (m === 'PUT' && id) { if (body && 'imageUrl' in body) body.imageUrl = await localizeImage(body.imageUrl); return sendOrNull(res, store.updateExercise(id, body)); }
    if (m === 'POST' && id && sub === 'favourite') return sendJson(res, 200, store.setFavourite(id, body?.favourite !== false));
    if (m === 'POST' && id && sub === 'publish') return sendJson(res, 200, await idenstr.publishExercise(id));
    if (m === 'DELETE' && id) return sendJson(res, store.deleteExercise(id) ? 200 : 404, { deleted: true });
  }

  // Discover & import exercises and programs shared on the public relays
  if (resource === 'discover') {
    if (m === 'GET' && id === 'exercises') {
      return sendJson(res, 200, await discover.discoverExercises({
        muscle: url.searchParams.get('muscle') || '',
        limit: Number(url.searchParams.get('limit')) || 80
      }));
    }
    if (m === 'POST' && id === 'import') return sendJson(res, 201, await discover.importExercise(body));
    if (m === 'GET' && id === 'programs') {
      return sendJson(res, 200, await discover.discoverPrograms({ limit: Number(url.searchParams.get('limit')) || 80 }));
    }
    if (m === 'POST' && id === 'import-program') return sendJson(res, 201, await discover.importProgram(body));
  }

  // Sheets (workout templates)
  if (resource === 'sheets') {
    if (m === 'GET' && !id) return sendJson(res, 200, { sheets: store.listSheets() });
    if (m === 'POST' && !id) return sendJson(res, 201, store.createSheet(body));
    if (m === 'GET' && id) return sendOrNull(res, store.getSheet(Number(id)));
    if (m === 'PUT' && id) return sendOrNull(res, store.updateSheet(Number(id), body));
    if (m === 'DELETE' && id) return sendJson(res, store.deleteSheet(Number(id)) ? 200 : 404, { deleted: true });
    if (m === 'POST' && id && sub === 'publish') return sendJson(res, 200, await idenstr.publishProgram(Number(id)));
  }

  // Sessions
  if (resource === 'sessions') {
    if (m === 'GET' && !id) return sendJson(res, 200, { sessions: store.listSessions() });
    if (m === 'GET' && id === 'active') return sendJson(res, 200, { session: store.activeSession() });
    if (m === 'POST' && !id) return sendJson(res, 201, store.startSession(body?.sheetId ? Number(body.sheetId) : null));
    if (m === 'GET' && id) return sendOrNull(res, store.getSession(Number(id)));
    if (m === 'POST' && id && sub === 'sets') return sendJson(res, 201, store.logSet(Number(id), body));
    if (m === 'POST' && id && sub === 'finish') return sendJson(res, 200, store.finishSession(Number(id), body?.notes));
    if (m === 'DELETE' && id) return sendJson(res, store.deleteSession(Number(id)) ? 200 : 404, { deleted: true });
    if (m === 'POST' && id && sub === 'share') return sendJson(res, 200, await idenstr.shareSummary(Number(id)));
  }
  if (resource === 'sets' && m === 'DELETE' && id) return sendJson(res, store.deleteSet(Number(id)) ? 200 : 404, { deleted: true });

  // Body log
  if (resource === 'body') {
    if (m === 'GET') return sendJson(res, 200, { entries: store.listBody() });
    if (m === 'POST') return sendJson(res, 201, { entries: store.logBody(body) });
    if (m === 'DELETE' && id) return sendJson(res, store.deleteBody(Number(id)) ? 200 : 404, { deleted: true });
  }

  // Weekly plan
  if (resource === 'plan') {
    if (m === 'GET') return sendJson(res, 200, { plan: store.listPlan() });
    if (m === 'POST') return sendJson(res, 201, { id: store.addPlan(body), plan: store.listPlan() });
    if (m === 'DELETE' && id) return sendJson(res, store.deletePlan(Number(id)) ? 200 : 404, { deleted: true });
  }

  // Mesocycles
  if (resource === 'mesocycles') {
    if (m === 'GET') return sendJson(res, 200, { mesocycles: store.listMesocycles() });
    if (m === 'POST') return sendJson(res, 201, { id: store.createMesocycle(body), mesocycles: store.listMesocycles() });
    if (m === 'DELETE' && id) return sendJson(res, store.deleteMesocycle(Number(id)) ? 200 : 404, { deleted: true });
  }

  if (m === 'GET' && resource === 'stats') return sendJson(res, 200, store.getStats());
  if (resource === 'recovery') {
    if (m === 'GET' && !id) return sendJson(res, 200, store.getRecovery());
    if (m === 'POST' && id === 'quick-workout') return sendJson(res, 200, store.getQuickWorkout(Number(body?.durationMinutes) || 45, Number(body?.minRecoveryPercent) || 80));
  }

  // Settings (weight unit, body profile, etc.)
  if (resource === 'settings') {
    const readSettings = () => ({
      weightUnit: store.getSetting('weightUnit', 'kg'),
      heightCm: Number(store.getSetting('heightCm', 0)) || 0,
      targetWeightKg: Number(store.getSetting('targetWeightKg', 0)) || 0,
    });
    if (m === 'GET') return sendJson(res, 200, readSettings());
    if (m === 'PUT') {
      if ('weightUnit' in (body || {})) store.setSetting('weightUnit', body.weightUnit === 'lbs' ? 'lbs' : 'kg');
      if ('heightCm' in (body || {})) store.setSetting('heightCm', Number(body.heightCm) || 0);
      if ('targetWeightKg' in (body || {})) store.setSetting('targetWeightKg', Number(body.targetWeightKg) || 0);
      return sendJson(res, 200, readSettings());
    }
  }

  // Idenstr connection (Authority)
  if (resource === 'connect') {
    if (m === 'GET' && id === 'status') return sendJson(res, 200, await idenstr.status());
    if (m === 'GET' && !id) return sendJson(res, 200, idenstr.currentConfig());
    if (m === 'PUT' && !id) return sendJson(res, 200, await idenstr.saveConfig(body || {}));
  }

  return sendJson(res, 404, { error: 'not_found' });
}

// ---------- Auth (HTTP Basic + bind guard), mirrors Idenstr ----------

function authorize(req, pathname) {
  if (req.method === 'GET' && pathname === '/api/v1/health') return { ok: true };
  // Branding assets the browser and iOS fetch without credentials (favicon, PWA
  // manifest, home-screen / apple-touch icons). They must load even on the Basic
  // auth challenge, or iOS falls back to a generated letter tile. serveStatic
  // rejects any path containing '..', so the /icons/ prefix cannot be escaped.
  if ((req.method === 'GET' || req.method === 'HEAD') && isPublicAsset(pathname)) return { ok: true };
  const header = req.headers.authorization ?? '';
  if (authConfigured()) {
    const basic = basicCredentials(header);
    if (basic && checkBasicAuth(basic)) return { ok: true };
    return { ok: false, status: 401, body: { error: 'unauthorized' }, challenge: true };
  }
  return { ok: true }; // loopback dev only; startup guard blocks non-loopback without creds
}

function basicCredentials(header) {
  const match = String(header).match(/^Basic\s+(.+)$/i);
  if (!match) return null;
  let decoded = '';
  try { decoded = Buffer.from(match[1].trim(), 'base64').toString('utf8'); } catch { return null; }
  const i = decoded.indexOf(':');
  if (i === -1) return null;
  return { user: decoded.slice(0, i), pass: decoded.slice(i + 1) };
}

function isPublicAsset(pathname) {
  return pathname === '/manifest.webmanifest' ||
    pathname === '/favicon.ico' ||
    pathname.startsWith('/icons/');
}

export function authConfigured() {
  return Boolean((process.env.WORKSTR_AUTH_USER ?? '') && (process.env.WORKSTR_AUTH_PASSWORD ?? ''));
}

function checkBasicAuth({ user, pass }) {
  return constantTimeEqual(user, process.env.WORKSTR_AUTH_USER ?? '') && constantTimeEqual(pass, process.env.WORKSTR_AUTH_PASSWORD ?? '');
}

function constantTimeEqual(a, b) {
  return timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
}

// ---------- HTTP helpers ----------

function sendOrNull(res, value) {
  return value ? sendJson(res, 200, value) : sendJson(res, 404, { error: 'not_found' });
}

function exerciseListShape(exercise) {
  if (!exercise?.imageUrl?.startsWith('data:')) return exercise;
  // The /image endpoint is cached for a day, but its URL is keyed only on the
  // slug — so a re-uploaded image would keep serving the stale cached copy.
  // Append the row's updatedAt as a version so each edit yields a fresh URL.
  const v = encodeURIComponent(exercise.updatedAt ?? '');
  return { ...exercise, imageUrl: `api/v1/exercises/${encodeURIComponent(exercise.slug)}/image${v ? `?v=${v}` : ''}` };
}

function sendExerciseImage(res, slug) {
  const exercise = store.getExercise(slug);
  const dataUrl = exercise?.imageUrl || '';
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return sendJson(res, 404, { error: 'not_found' });
  const body = Buffer.from(match[2], 'base64');
  res.writeHead(200, { 'Content-Type': match[1], 'Cache-Control': 'public, max-age=86400' });
  res.end(body);
}

async function serveStatic(pathname, res, headOnly = false, acceptsGzip = false) {
  const normalized = pathname === '/' ? '/index.html' : pathname;
  if (normalized.includes('..')) return sendJson(res, 400, { error: 'bad_path' });
  try {
    const data = await readFile(join(publicDir, normalized));
    const type = contentType(normalized);
    const headers = { 'Content-Type': type, 'Cache-Control': cacheControl(normalized), 'Vary': 'Accept-Encoding' };
    const compressible = /^(text\/|application\/(javascript|json|manifest\+json)|image\/svg)/.test(type);
    if (headOnly) { res.writeHead(200, headers); return res.end(); }
    if (acceptsGzip && compressible && data.length > 1024) {
      headers['Content-Encoding'] = 'gzip';
      res.writeHead(200, headers);
      return res.end(gzipSync(data));
    }
    res.writeHead(200, headers);
    res.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') return sendJson(res, 404, { error: 'not_found' });
    throw error;
  }
}

function contentType(filePath) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json; charset=utf-8'
  }[extname(filePath)] ?? 'application/octet-stream';
}

function cacheControl(filePath) {
  if (extname(filePath) === '.html' || extname(filePath) === '.json') return 'no-store';
  if (extname(filePath) === '.css' || extname(filePath) === '.js') return 'public, max-age=86400, immutable';
  return 'public, max-age=3600';
}

async function readJson(req, maxBytes = 16 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) { const err = new Error('Request body too large'); err.code = 'body_too_large'; throw err; }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer().listen(port, host, () => {
    console.log(`Workstr listening on http://${host}:${port}`);
    // No login by default: like Feedstr, Workstr relies on the network boundary and
    // its scoped Idenstr token. Optional HTTP Basic auth turns on if you set
    // WORKSTR_AUTH_USER and WORKSTR_AUTH_PASSWORD.
    console.log(authConfigured() ? 'Optional dashboard login is enabled.' : 'No dashboard login (network-boundary + Idenstr token).');
    console.log(`Idenstr upstream: ${idenstr.currentConfig().idenstrUrl} (token ${idenstr.currentConfig().tokenConfigured ? 'configured' : 'missing'})`);
  });
}
