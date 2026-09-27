# burner-cc

Itemized dollar-and-token cost receipts for Claude Code sessions, rendered as a themed local HTML receipt.

## Usage

```
node bin/burner-cc.js                 # latest session -> opens a receipt
node bin/burner-cc.js <session-id>    # specific session (accepts a prefix)
node bin/burner-cc.js --all           # every session found, one receipt each + grand total
node bin/burner-cc.js list            # quick terminal table, no browser
node bin/burner-cc.js --json          # machine-readable, no browser
```

Once published: `npx burner-cc`, `npx burner-cc --all`, etc.

## How it works

- **Discovery** (`src/discover.js`) walks `~/.claude/projects/**/*.jsonl`, matching each top-level session transcript with any `subagents/agent-*.jsonl` files spawned inside it (those are billed separately by the API and get folded into the parent session's receipt).
- **Parsing** (`src/parse.js`) reads each assistant turn's `usage` block (input/output/cache-write/cache-read tokens) straight from the transcript.
- **Pricing** (`src/pricing.js`) is fetched automatically — no file to hand-edit. It pulls Anthropic's per-model rates from [LiteLLM's community-maintained pricing JSON](https://github.com/BerriAI/litellm) (sourced from `platform.claude.com/docs/.../pricing`), caches it locally for 6 hours, and falls back to a stale cache or a small bundled snapshot (`src/pricing-fallback.json`) if offline.
- **Receipt** (`src/build-receipt.js`) groups tokens by model and computes cost per token-type line.
- **Rendering** (`src/render.js` + `web/`) injects the receipt JSON into `web/receipt.html` and opens it in the default browser. Theme buttons (paper / thermal / matrix / dark) switch CSS variables client-side.

## What this is not

Not official billing. Composition breakdown by *source* (system prompt vs. skills vs. MCP tool schemas) isn't available from local transcripts alone — that needs request interception, which this tool doesn't do. The receipt instead itemizes by token *type*: fresh input, cache write, cache read, output.
