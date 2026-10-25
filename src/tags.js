import { FILES, readJson, writeJson, resolveProject } from './config.js';

// tags.json: { [sessionId]: { category, source, at, reason?, confidence?, model?, segments: [{ category, at, reason? }] } }
//   source: skill | manual
// A segment marks the end of one task inside a session ("Every task" level):
// turns up to its timestamp belong to it.

export function loadTags() {
  return readJson(FILES.tags, {});
}

export function saveTags(tags) {
  writeJson(FILES.tags, tags);
}

export function setTag(sessionId, { category, source, reason, confidence, model, segment = false, at }) {
  const tags = loadTags();
  const now = at ?? new Date().toISOString();
  const prev = tags[sessionId];
  const entry = prev && segment ? { ...prev } : { segments: [] };
  entry.category = category;
  entry.source = source;
  entry.at = now;
  if (reason) entry.reason = String(reason).slice(0, 300);
  else delete entry.reason;
  if (confidence != null) entry.confidence = confidence;
  else delete entry.confidence;
  if (model) entry.model = model;
  else delete entry.model;
  if (segment) entry.segments = [...(entry.segments ?? []), { category, at: now, ...(reason ? { reason: String(reason).slice(0, 300) } : {}) }];
  tags[sessionId] = entry;
  saveTags(tags);
  return entry;
}

export function clearTag(sessionId) {
  const tags = loadTags();
  delete tags[sessionId];
  saveTags(tags);
}

// Splits a session's turns across its task segments by timestamp.
export function segmentTurns(turns, segments) {
  if (!segments?.length) return null;
  const segs = [...segments].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const groups = segs.map((s) => ({ category: s.category, turns: [] }));
  for (const t of turns) {
    const ts = t.timestamp ?? '';
    let idx = segs.findIndex((s) => ts <= s.at);
    if (idx < 0) idx = segs.length - 1;
    groups[idx].turns.push(t);
  }
  return groups;
}

// assignments.json: { [sessionId]: projectName }
// Lets one session move into a project even though it was started somewhere
// else (typically a home directory that holds work for several projects).
export function loadAssignments() {
  return readJson(FILES.assignments, {});
}

export function setAssignment(sessionId, projectName) {
  const a = loadAssignments();
  if (projectName) a[sessionId] = projectName;
  else delete a[sessionId];
  writeJson(FILES.assignments, a);
}

// The project a session belongs to: its own assignment if that project still
// exists, otherwise whatever its working directory resolves to.
export function resolveSessionProject(sessionId, cwd, cfg, assignments = loadAssignments()) {
  const name = assignments[sessionId];
  if (name) {
    const p = cfg.projects.find((x) => x.name === name);
    if (p) return { ...p, implicit: false, bySession: true };
  }
  return resolveProject(cwd, cfg);
}
