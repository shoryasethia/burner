// `burner serve` — local-only web app: report, receipts, and the Settings
// page that edits config.yaml / pricing.yaml so nobody has to touch them.

import http from 'node:http';
import { readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSessions } from './analyze.js';
import { renderReport } from './report.js';
import { renderReceipt } from './receipt.js';
import { renderSettingsPage } from './settings-page.js';
import { FILES, loadConfig, saveConfig, loadPricingOverrides, savePricingOverrides, TAGGING_LEVELS, UNTAGGED, THEMES, RANGES } from './config.js';
import { loadPricingTable, lookupPublic, SOURCE_URL } from './pricing.js';
import { setTag, clearTag, loadTags, setAssignment } from './tags.js';
import { applyTagging, installStatus } from './install.js';
import { loadLearned, priorMeta } from './classifier.js';
import { trainFromTags } from './tagging.js';

const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');

export function createApp() {
  let cache = null;
  let cacheAt = 0;
  let cacheKey = '';
  // Tags and project moves are also written by the CLI (/burner-tag) and by
  // new Claude Code activity, so the cache must not outlive them.
  const CACHE_TTL_MS = 15_000;
  const mtime = (f) => { try { return statSync(f).mtimeMs; } catch { return 0; } };
  const stamp = () => `${mtime(FILES.tags)}|${mtime(FILES.assignments)}`;
  const analysis = async ({ refresh = false } = {}) => {
    const stale = !cache || refresh || Date.now() - cacheAt > CACHE_TTL_MS || cacheKey !== stamp();
    if (stale) {
      const key = stamp();
      cache = await analyzeSessions();
      cacheAt = Date.now();
      cacheKey = key;
    }
    return cache;
  };
  const invalidate = () => { cache = null; };

  async function state() {
    const a = await analysis();
    const tags = loadTags();
    const bySource = {};
    for (const s of a.sessions) bySource[s.categorySource] = (bySource[s.categorySource] ?? 0) + 1;
    const learned = loadLearned();
    return {
      config: a.config,
      levels: TAGGING_LEVELS,
      untagged: UNTAGGED,
      directories: a.directories,
      projectTotals: a.projectTotals,
      models: a.models,
      pricing: a.pricing,
      pricingSourceUrl: SOURCE_URL,
      pricingOverrides: loadPricingOverrides(),
      install: installStatus(loadConfig()),
      learned: learned ? {
        builtin: !!learned.builtin,
        meta: learned.builtin ? priorMeta() : null,
        examples: learned.sources?.local ?? learned.examples,
        totalRows: learned.examples,
        trainedAt: learned.trainedAt,
        sources: learned.sources,
        classes: Object.fromEntries(Object.entries(learned.classes).map(([k, v]) => [k, v.docs])),
        hasUserModel: existsSync(FILES.model),
      } : null,
      stats: { sessions: a.sessions.length, tagged: Object.keys(tags).length, untagged: a.sessions.filter((s) => s.category === UNTAGGED.id).length, bySource },
    };
  }

  const routes = {
    'GET /': async () => { const ui = loadConfig().ui; return html(renderReport(await analysis(), { served: true, theme: ui.theme, range: { range: ui.range, from: ui.customFrom, to: ui.customTo } })); },
    'GET /settings': async () => html(renderSettingsPage(loadConfig().ui.theme)),
    'GET /api/state': async () => json(await state()),
    'GET /api/sessions': async () => {
      const a = await analysis();
      return json(a.sessions.map(({ activity, ...s }) => s));
    },
    'PUT /api/config': async (body) => {
      const cur = loadConfig();
      const next = { ...cur };
      if (body.categories) next.categories = body.categories;
      if (body.projects) next.projects = body.projects;
      if (body.tagging) next.tagging = { ...cur.tagging, ...body.tagging };
      validateConfig(next);
      const saved = saveConfig(next);
      if (body.tagging || body.categories) applyTagging(saved);
      invalidate();
      return json(await state());
    },
    'PUT /api/pricing': async (body) => {
      savePricingOverrides(body.models ?? {});
      invalidate();
      return json(await state());
    },
    'POST /api/pricing/lookup': async (body) => {
      const model = String(body.model ?? '').trim();
      if (!model) throw httpError(400, 'model required');
      // refresh:true (per-model Refresh button) always re-fetches the public list first.
      let table = await loadPricingTable({ force: !!body.refresh });
      if (body.refresh && table.source === 'live') cache = await analyzeSessions({ table });
      let r = lookupPublic(model, table);
      // A brand-new model may be newer than the cached list: refetch once.
      if (!r.found && table.source !== 'live') {
        table = await loadPricingTable({ force: true });
        r = lookupPublic(model, table);
      }
      return json({ ...r, listSource: table.source, listError: table.error ?? null });
    },
    'POST /api/pricing/refresh': async () => {
      const t = await loadPricingTable({ force: true });
      cache = await analyzeSessions({ table: t });
      if (t.source !== 'live') throw httpError(502, `could not fetch fresh pricing: ${t.error ?? t.source}`);
      return json(await state());
    },
    'POST /api/session-project': async (body) => {
      if (!body.sessionId) throw httpError(400, 'sessionId required');
      if (body.project) {
        const cfg = loadConfig();
        if (!cfg.projects.some((p) => p.name === body.project)) throw httpError(400, `unknown project ${body.project} (save it first)`);
      }
      setAssignment(body.sessionId, body.project || null);
      invalidate();
      return json({ ok: true });
    },
    'POST /api/tag': async (body) => {
      if (!body.sessionId) throw httpError(400, 'sessionId required');
      if (!body.category) clearTag(body.sessionId);
      else {
        const cfg = loadConfig();
        if (!cfg.categories.some((c) => c.id === body.category)) throw httpError(400, `unknown category ${body.category}`);
        setTag(body.sessionId, { category: body.category, source: 'manual' });
      }
      invalidate();
      return json({ ok: true });
    },
    // The report's time range (7 days, 30 days, ...) is remembered between visits.
    'PUT /api/range': async (body) => {
      if (!RANGES.includes(String(body.range))) throw httpError(400, 'unknown range');
      const cur = loadConfig();
      saveConfig({ ...cur, ui: { ...cur.ui, range: String(body.range), customFrom: body.from || '', customTo: body.to || '' } });
      return json({ ok: true });
    },
    'PUT /api/theme': async (body) => {
      if (!THEMES.includes(body.theme)) throw httpError(400, 'unknown theme');
      const cur = loadConfig();
      saveConfig({ ...cur, ui: { ...cur.ui, theme: body.theme } });
      return json({ ok: true });
    },
    'POST /api/learned/train': async () => {
      const r = await trainFromTags();
      invalidate();
      return json(r);
    },
    'POST /api/learned/reset': async () => {
      if (existsSync(FILES.model)) rmSync(FILES.model);
      invalidate();
      return json({ ok: true });
    },
    'POST /api/install/sync': async () => {
      applyTagging(loadConfig());
      invalidate();
      return json(await state());
    },
  };

  return async function handler(req, res) {
    try {
      const host = (req.headers.host ?? '').replace(/:\d+$/, '');
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) throw httpError(403, 'burner only answers on localhost');
      const url = new URL(req.url, 'http://localhost');
      const asset = url.pathname.match(/^\/assets\/(logo-mark|logo-with-text)\.png$/);
      if (req.method === 'GET' && asset) {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' });
        return res.end(readFileSync(path.join(ASSETS_DIR, `${asset[1]}.png`)));
      }
      const receipt = url.pathname.match(/^\/receipt\/([\w-]+)$/);
      if (req.method === 'GET' && receipt) {
        const a = await analysis();
        const s = a.sessions.find((x) => x.sessionId.startsWith(receipt[1]));
        if (!s) throw httpError(404, 'no such session');
        return send(res, html(renderReceipt(s, a.categories, { served: true, theme: loadConfig().ui.theme, projects: loadConfig().projects.map((x) => x.name) })));
      }
      if (req.method === 'GET' && url.searchParams.has('refresh')) invalidate();
      const route = routes[`${req.method} ${url.pathname}`];
      if (!route) throw httpError(404, 'not found');
      let body = {};
      if (req.method !== 'GET') {
        if (!String(req.headers['content-type'] ?? '').includes('application/json')) throw httpError(415, 'send application/json');
        body = await readBody(req);
      }
      send(res, await route(body));
    } catch (err) {
      send(res, json({ error: err.message }, err.status ?? 500));
    }
  };
}

function validateConfig(cfg) {
  const ids = new Set();
  for (const c of cfg.categories) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(c.id ?? '')) throw httpError(400, `category id "${c.id}" must be lowercase letters, digits or dashes`);
    if (c.id === UNTAGGED.id) throw httpError(400, '"untagged" is reserved');
    if (ids.has(c.id)) throw httpError(400, `duplicate category ${c.id}`);
    ids.add(c.id);
  }
  const names = new Set();
  for (const p of cfg.projects) {
    if (!p.name?.trim()) throw httpError(400, 'every project needs a name');
    if (names.has(p.name)) throw httpError(400, `duplicate project ${p.name}`);
    names.add(p.name);
    for (const c of [...(p.categories ?? []), ...(p.defaultCategory ? [p.defaultCategory] : [])]) {
      if (!ids.has(c)) throw httpError(400, `project ${p.name} uses unknown category ${c}`);
    }
  }
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function html(body) {
  return { status: 200, type: 'text/html; charset=utf-8', body };
}

function json(value, status = 200) {
  return { status, type: 'application/json', body: JSON.stringify(value) };
}

function send(res, { status, type, body }) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2_000_000) reject(httpError(413, 'body too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(httpError(400, 'invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function startServer({ port = 4777 } = {}) {
  const server = http.createServer(createApp());
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}
