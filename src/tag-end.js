// SessionEnd hook: tag from local signals only (learned model, project default). No API calls.

import { discoverSessions } from './discover.js';
import { parseTranscript } from './parse.js';
import { loadConfig, UNTAGGED } from './config.js';
import { loadTags, setTag, resolveSessionProject } from './tags.js';
import {
  allowedCategories,
  buildDigest,
  loadLearned,
  predictLearned,
  resolveCategory,
} from './classifier.js';

const SESSION_END_CONFIDENCE = 0.45;

export async function readHookPayload() {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf-8').trim();
    if (!text) return {};
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function tagSessionAtEnd({ sessionId } = {}) {
  const cfg = loadConfig();
  if ((cfg.tagging?.level ?? 'manual') !== 'session') {
    return { ok: false, skipped: true, reason: 'tagging level is not session' };
  }

  const id = sessionId ?? process.env.CLAUDE_SESSION_ID;
  if (!id || id.includes('${')) return { ok: false, skipped: true, reason: 'no session id' };

  const sessions = discoverSessions();
  const s = sessions.find((x) => x.sessionId === id || x.sessionId.startsWith(id));
  if (!s) return { ok: false, skipped: true, reason: 'session not found yet' };

  const existing = loadTags()[s.sessionId];
  if (existing && ['skill', 'manual'].includes(existing.source)) {
    return { ok: true, skipped: true, reason: 'already tagged', category: existing.category };
  }

  const parsed = parseTranscript(s.mainFile);
  const project = resolveSessionProject(s.sessionId, parsed.digest.cwd, cfg);
  const allowed = allowedCategories(project, cfg);
  const allowedIds = allowed.map((c) => c.id);
  const digest = buildDigest(parsed, { title: s.customTitle ?? parsed.digest.aiTitle, projectName: project.name });
  const learned = loadLearned();

  let resolved = resolveCategory({ tag: existing, project, cfg, digest, learned });
  if (resolved.category === UNTAGGED.id && learned) {
    const p = predictLearned(learned, digest, allowedIds);
    if (p && p.confidence >= SESSION_END_CONFIDENCE) {
      resolved = { category: p.category, source: 'session-end', confidence: p.confidence };
    }
  }

  if (resolved.category === UNTAGGED.id || resolved.source === 'none') {
    return { ok: true, skipped: true, reason: 'no confident category' };
  }

  setTag(s.sessionId, {
    category: resolved.category,
    source: 'session-end',
    reason: resolved.source === 'project' ? 'project default' : `auto (${resolved.source})`,
    confidence: resolved.confidence ?? null,
  });
  return { ok: true, sessionId: s.sessionId, category: resolved.category, source: resolved.source };
}
