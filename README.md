<img src="assets/logo-mark.png" alt="Burner" width="90" />

# burner

What your Claude Code sessions cost, and what they were for — itemized receipts, projects, intent tagging, and a local analytics app.

Zero runtime dependencies. Reads `~/.claude/projects/` on your machine. Only network use by default is refreshing public model prices (optional).

## Install

```bash
npm install -g burner-cc
# commands: burner  (alias entry: burner-cc)
```

Or without installing:

```bash
npx burner-cc
```

**Node 18+** required.

## Quick start

```bash
burner                 # opens http://127.0.0.1:4777 (report + Settings)
burner serve           # same; --port N, --no-open
burner install         # global /burner-tag skill + tagging level from ~/.burner/config.yaml
```

Settings covers **projects**, **categories**, **pricing** (pin/refresh per model), and **tagging** (slider, train your intent model).

## Commands

```bash
burner list [--json] [--project NAME] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
burner receipt [session-id|title]     # one receipt HTML under ~/.burner/
burner report [--no-open]               # static report.html + receipt-*.html

burner tag <category> [--session ID] [--reason TEXT] [--task]
burner tag --clear [--session ID]
burner install | uninstall | status

burner pricing refresh
burner model train [--data FILE.jsonl] [--swe-chat] [--prior]
```

`burner tag` is what `/burner-tag` runs. After `npm i -g burner-cc`, hooks and the skill use the `burner` command on your PATH.

## Categories

Intent, not tool counts — e.g. reading files to fix a bug is **debugging**, not research.

Default ids: `coding` · `debugging` · `planning` · `research` · `writing` · `analysis` · `review` · `learning` · `other` (editable in Settings).

Resolution order:

1. Tag (`/burner-tag`, receipt picker, session-end model, or CLI)
2. Project default category
3. **Your trained model** (optional; only if enabled and confidence ≥ 60%)
4. Otherwise **untagged** — no folder-name or tool-ratio guessing

## Tagging levels (Settings)

| Level | Behavior |
|--------|----------|
| Off | Removes global skill / hooks |
| Manual | `/burner-tag` only; skill stays installed |
| Session end | SessionEnd hook tags with your **local** trained model (no API, no CLAUDE.md) |

Moving the tagging slider updates `~/.claude` automatically. Use **Train from my tags** in Settings for a local naive-Bayes model (`~/.burner/model/intent-nb.json`). Training is pure Node — no GPU or Python. CLI `burner model train` does the same; `--prior` / `--swe-chat` are optional extras.

## Tokens & pricing

- One API request → several transcript lines; burner bills the **last** chunk per `requestId`, dedupes continued sessions, rolls subagents into the parent.
- Totals: fresh input, cache write (5m/1h), cache read, output.
- **Claude** models: public LiteLLM price list (daily refresh, offline snapshot fallback).
- **Other** models (gateway, on-prem, local): **$0** until you set a price in Settings.

## Files

| Path | Purpose |
|------|---------|
| `~/.burner/config.yaml` | projects, categories, tagging, UI theme/range |
| `~/.burner/pricing.yaml` | your USD/1M overrides |
| `~/.burner/tags.json` | session tags |
| `~/.burner/assignments.json` | per-session project overrides |
| `~/.burner/model/intent-nb.json` | your trained intent model |
| `~/.claude/skills/burner-tag/` | global skill (`burner install`) |

`BURNER_HOME` and `CLAUDE_CONFIG_DIR` override `~/.burner` and `~/.claude`. Legacy `~/.ti-burner` data is migrated on first run.

*Not official Anthropic billing.*
