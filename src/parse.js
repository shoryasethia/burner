import { readFileSync } from 'node:fs';

// Reads one transcript file and returns a flat list of billed turns:
// { model, timestamp, input, output, cacheWrite5m, cacheWrite1h, cacheRead }
// plus a tool-activity tally: { mcp: {server: count}, skills: {name: count}, web: {WebFetch/WebSearch: count} }
export function parseTranscript(file) {
  let text;
  try {
    text = readFileSync(file, 'utf-8');
  } catch {
    return { turns: [], activity: { mcp: {}, skills: {}, web: {} } };
  }

  const turns = [];
  const mcp = {};
  const skills = {};
  const web = {};

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const msg = entry.message;
    if (!msg || msg.type !== 'message' || msg.role !== 'assistant') continue;

    // Tool-call activity: tallied regardless of whether this line also
    // carries usage, since a message can contain tool_use blocks either way.
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type !== 'tool_use') continue;
        if (block.name === 'Skill' && block.input?.skill) {
          skills[block.input.skill] = (skills[block.input.skill] ?? 0) + 1;
        } else if (block.name.startsWith('mcp__')) {
          const server = block.name.split('__')[1] ?? 'unknown';
          mcp[server] = (mcp[server] ?? 0) + 1;
        } else if (block.name === 'WebFetch' || block.name === 'WebSearch') {
          web[block.name] = (web[block.name] ?? 0) + 1;
        }
      }
    }

    if (!msg.usage) continue;
    if (msg.model === '<synthetic>') continue; // internal zero-usage marker, not a billed turn

    const u = msg.usage;
    const isAllZero = !u.input_tokens && !u.output_tokens && !u.cache_creation_input_tokens && !u.cache_read_input_tokens;
    if (isAllZero) continue;
    const cacheCreation = u.cache_creation ?? {};
    turns.push({
      model: msg.model ?? 'unknown',
      timestamp: entry.timestamp ?? null,
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      cacheWrite5m: cacheCreation.ephemeral_5m_input_tokens ?? u.cache_creation_input_tokens ?? 0,
      cacheWrite1h: cacheCreation.ephemeral_1h_input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
    });
  }
  return { turns, activity: { mcp, skills, web } };
}

export function timeRange(turns) {
  const stamps = turns.map((t) => t.timestamp).filter(Boolean).sort();
  return { startedAt: stamps[0] ?? null, endedAt: stamps[stamps.length - 1] ?? null };
}

export function mergeActivity(activities) {
  const merged = { mcp: {}, skills: {}, web: {} };
  for (const a of activities) {
    for (const [k, v] of Object.entries(a.mcp)) merged.mcp[k] = (merged.mcp[k] ?? 0) + v;
    for (const [k, v] of Object.entries(a.skills)) merged.skills[k] = (merged.skills[k] ?? 0) + v;
    for (const [k, v] of Object.entries(a.web)) merged.web[k] = (merged.web[k] ?? 0) + v;
  }
  return merged;
}
