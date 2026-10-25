<img src="assets/logo-mark.png" alt="Burner" width="90" />

# burner

What your Claude Code sessions cost, and what they were for. Itemized receipts, projects that span several directories, and intent tagging that doesn't guess from tool counts.

Zero dependencies. Reads `~/.claude/projects/` — nothing leaves your machine except the public price list fetch.

```bash
npx burner-cc            # or: node bin/burner.js
```

Opens a local app at `http://127.0.0.1:4777` — the report, per-session receipts, and **Settings** (projects, categories, pricing, tagging).

## Commands

```bash
burner                          # web app: report + settings
burner report                   # static ~/.burner/report.html (+ receipts)
burner list                     # terminal table
burner receipt [id|title]       # one receipt (default: latest)

burner install                  # install /burner-tag globally, apply tagging level
burner tag <category> [--task] [--reason TEXT] [--session ID]
burner pricing refresh          # fetch fresh prices now
burner model train [--swe-chat] [--data FILE.jsonl]

--project NAME  --from YYYY-MM-DD  --to YYYY-MM-DD  --json  --offline
```

## Categories

Intent, not mechanics — reading code to fix a bug is a bug fix:

`coding` · `debugging` · `planning` · `research` · `writing` · `analysis` · `review` · `learning` · `other`

Edit them on Settings → Categories. A session's category comes from, in order:

1. **A tag** — from `/burner-tag`, or the receipt's category picker
2. **Its project's default category** (or the project's only allowed category)
3. **The learned model**, once trained on your tags and only when confident
4. Otherwise **untagged**. There are no folder-name or tool-ratio rules.

## Projects

A project groups one or more directories; any session started under one of them belongs to it (longest match wins). Each project can restrict which categories apply and set a default. Configure on Settings → Projects — it's stored in `~/.burner/config.yaml`, which you never have to open.

## Tagging levels

Like Claude Code's effort slider (Settings → Tagging):

| Level | What happens |
|---|---|
| Off | No skill, nothing injected |
| Manual | `/burner-tag` is available in every project |
| Session end | A block in `~/.claude/CLAUDE.md` asks Claude to tag once when the work is done (~100 output tokens) |
| Every task | Claude tags each finished task, so one session can split across categories by cost |

### Learned model

`burner model train` fits a small naive-Bayes classifier on prompt words + tool steps from sessions *you* tagged. `--swe-chat` adds intent-labeled prompts from real Claude Code sessions from [SALT-NLP/SWE-chat](https://huggingface.co/datasets/SALT-NLP/SWE-chat) (gated: accept its terms and set `HF_TOKEN`). `--data` takes any `{"text", "category"}` JSONL.

## Tokens

Claude Code writes one API response as several lines (one per streamed block) with growing `output_tokens`. Burner keeps the final line per request ID, drops requests a continued session re-logs from its parent, and bills subagent transcripts to their parent session. Totals include all four billed buckets: fresh input, cache write (5m/1h), cache read, output. On real sessions this lands within a few percent of Claude Code's own `/cost`; the gap is background calls (titles, compaction) Claude Code doesn't write to the transcript.

## Pricing

- **Claude models** — public list prices from [LiteLLM's price table](https://github.com/BerriAI/litellm), refreshed daily (bundled snapshot when offline). Bedrock/Vertex/dated ids are normalized.
- **Everything else** (gateway, on-prem, local models behind the Claude Code harness) — **$0 until you set a price**. Settings → Pricing shows each model, offers the public price when one exists, and saves overrides to `~/.burner/pricing.yaml`.

## Files

| Path | |
|---|---|
| `~/.burner/config.yaml` | projects, categories, tagging level, theme |
| `~/.burner/pricing.yaml` | your price overrides (USD / 1M tokens) |
| `~/.burner/tags.json` | session tags |
| `~/.burner/model/intent-nb.json` | learned model |
| `~/.burner/cache/litellm-pricing.json` | price cache |
| `~/.claude/skills/burner-tag/` | the global skill (`burner install`) |

Old `~/.ti-burner` overrides and custom prices are imported on first run. `BURNER_HOME` and `CLAUDE_CONFIG_DIR` relocate both sides.

*not official billing*
