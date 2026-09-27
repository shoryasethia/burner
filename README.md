<img src="assets/logo-mark.png" alt="Burner" width="90" />

# burner

Itemized dollar-and-token cost receipts for Claude Code sessions.

## Usage

```
npx burner-cc                 # latest session -> opens a receipt
npx burner-cc <session-id>    # specific session (accepts a title, slug, or id prefix)
npx burner-cc --all           # every session found, sliding through one receipt each
npx burner-cc list            # quick terminal table, no browser
npx burner-cc --json          # machine-readable, no browser
```

Or install it globally: `npm install -g burner-cc`, then run `burner-cc` directly.

### Local development

```
node bin/burner-cc.js <same args as above>
```

## How it works

- **Discovery** (`src/discover.js`) walks `~/.claude/projects/**/*.jsonl`, matching each top-level session transcript with any `subagents/agent-*.jsonl` files spawned inside it (those are billed separately by the API and get folded into the parent session's receipt).
- **Parsing** (`src/parse.js`) reads each assistant turn's `usage` block (input/output/cache-write/cache-read tokens) straight from the transcript.
- **Pricing** (`src/pricing.js`) is fetched automatically — no file to hand-edit. It pulls Anthropic's per-model rates from [LiteLLM's community-maintained pricing JSON](https://github.com/BerriAI/litellm) (sourced from `platform.claude.com/docs/.../pricing`), caches it locally for 6 hours, and falls back to a stale cache or a small bundled snapshot (`src/pricing-fallback.json`) if offline.
- **Receipt** (`src/build-receipt.js`) groups tokens by model and computes cost per token-type line.
- **Rendering** (`src/render.js` + `web/`) injects the receipt JSON into `web/receipt.html` and opens it in the default browser. Theme buttons (paper / thermal / matrix / dark) switch CSS variables client-side.

## What this is not

Not official billing. Composition breakdown by *source* (system prompt vs. skills vs. MCP tool schemas) isn't available from local transcripts alone — that needs request interception, which this tool doesn't do. The receipt instead itemizes by token *type*: fresh input, cache write, cache read, output.