import { readFileSync } from 'node:fs';

// Reads one transcript file and returns a flat list of billed turns:
// { model, timestamp, input, output, cacheWrite5m, cacheWrite1h, cacheRead }
export function parseTranscript(file) {
  let text;
  try {
    text = readFileSync(file, 'utf-8');
  } catch {
    return [];
  }

  const turns = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const msg = entry.message;
    if (!msg || msg.type !== 'message' || msg.role !== 'assistant' || !msg.usage) continue;
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
  return turns;
}

export function turnCount(turns) {
  return turns.length;
}

export function timeRange(turns) {
  const stamps = turns.map((t) => t.timestamp).filter(Boolean).sort();
  return { startedAt: stamps[0] ?? null, endedAt: stamps[stamps.length - 1] ?? null };
}
