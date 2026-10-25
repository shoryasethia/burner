// SessionEnd hook: ask a small/fast model what the session was for, then tag it.

import { readFileSync } from 'node:fs';
import { discoverSessions } from './discover.js';
import { parseTranscript } from './parse.js';
import { loadConfig } from './config.js';
import { loadTags, setTag, resolveSessionProject } from './tags.js';
import { allowedCategories, buildDigest } from './classifier.js';

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

function pickCategory(text, allowed) {
  const t = String(text ?? '').toLowerCase();
  for (const id of allowed) {
    if (t === id || t.includes(id)) return id;
  }
  const word = t.match(/[a-z][a-z0-9_-]*/)?.[0];
  if (word && allowed.includes(word)) return word;
  return null;
}

async function classifyWithModel(digest, categories, model) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set (needed for session-end tagging)');
  const lines = categories.map((c) => `${c.id}: ${c.description || c.label}`).join('\n');
  const prompts = (digest.prompts ?? []).slice(0, 6).map((p, i) => `${i + 1}. ${p}`).join('\n');
  const tools = (digest.tools ?? []).slice(0, 8).map(([s, n]) => `${s} x${n}`).join(', ');
  const user = `Pick exactly one category id for this Claude Code session.

Categories (reply with only the id):
${lines}

Session title: ${digest.title ?? '—'}
Project: ${digest.project ?? '—'}
User prompts:
${prompts || '(none)'}
Tools used: ${tools || '(none)'}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens: 40, messages: [{ role: 'user', content: user }] }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.content?.find((b) => b.type === 'text')?.text ?? '';
  return text.trim();
}

export async function tagSessionAtEnd({ sessionId, model } = {}) {
  const cfg = loadConfig();
  const endModel = (model ?? cfg.tagging?.endModel ?? '').trim();
  if (!endModel) return { ok: false, skipped: true, reason: 'no endModel configured' };

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

  const answer = await classifyWithModel(digest, allowed, endModel);
  const category = pickCategory(answer.split(/\r?\n/)[0], allowedIds);
  if (!category) return { ok: false, error: `model answer not a category: ${answer.slice(0, 80)}` };

  setTag(s.sessionId, { category, source: 'end-model', reason: answer.slice(0, 80) });
  return { ok: true, sessionId: s.sessionId, category, model: endModel };
}
