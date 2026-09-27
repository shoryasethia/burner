import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Claude Code can run on pay-per-token API billing, or on a flat-fee
// Pro/Max/Team/Enterprise subscription where tokens don't map to dollars
// the way this tool assumes. There's no reliable local signal for *which*
// subscription tier someone's on, but ~/.claude/config.json having a
// primaryApiKey is a reasonable signal that this account bills per token.
// We only check whether the field exists — its value is never read into
// anything we log, render, or persist.
export function detectBillingMode() {
  const configPath = path.join(os.homedir(), '.claude', 'config.json');
  if (!existsSync(configPath)) return 'unknown';
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const hasApiKey = typeof config.primaryApiKey === 'string' && config.primaryApiKey.length > 0;
    return hasApiKey ? 'api-key' : 'subscription-likely';
  } catch {
    return 'unknown';
  }
}
