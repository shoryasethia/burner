import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function claudeProjectsRoot() {
  return path.join(os.homedir(), '.claude', 'projects');
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
  return out;
}

// A session is identified by its top-level "<sessionId>.jsonl" file. Any
// "<sessionId>/subagents/agent-*.jsonl" files sit alongside it and are
// billed separately by the API, so their cost is real but attributed back
// to the parent session rather than shown as their own session.
export function discoverSessions() {
  const root = claudeProjectsRoot();
  const files = walk(root);

  const sessions = new Map();

  for (const file of files) {
    const rel = path.relative(root, file);
    const parts = rel.split(path.sep);
    const project = parts[0];
    const isSubagent = parts.includes('subagents');
    const sessionId = isSubagent ? parts[1] : path.basename(file, '.jsonl');

    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, { sessionId, project, mainFile: null, subagentFiles: [] });
    }
    const entry = sessions.get(sessionId);
    if (isSubagent) {
      entry.subagentFiles.push(file);
    } else {
      entry.mainFile = file;
    }
  }

  // Drop entries that only have subagent files but never got a parent
  // transcript picked up (shouldn't normally happen, but be defensive).
  const result = [...sessions.values()].filter((s) => s.mainFile);

  for (const s of result) {
    s.mtime = statSync(s.mainFile).mtimeMs;
  }

  result.sort((a, b) => b.mtime - a.mtime);
  return result;
}

export function findSession(idOrPrefix) {
  const all = discoverSessions();
  return (
    all.find((s) => s.sessionId === idOrPrefix) ||
    all.find((s) => s.sessionId.startsWith(idOrPrefix))
  );
}

export function latestSession() {
  return discoverSessions()[0] ?? null;
}
