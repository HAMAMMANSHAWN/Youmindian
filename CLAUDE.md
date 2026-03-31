# YouMind for Obsidian

An Obsidian plugin that bridges YouMind's cloud AI with the local Obsidian vault.  
YouMind Agent thinks in the cloud; the plugin executes locally.

## Project Summary

YouMind = cloud AI creation studio.  
Obsidian = local-first Markdown knowledge base.  
This plugin connects them as a cloud-to-local bridge.

Key differences from Claudian:

- No local Claude CLI dependency
- Multi-model support through YouMind
- Local vault actions should go through plugin-controlled operations
- Obsidian UI stays native

## Current Codebase

Current files:

- `main.ts` — chat view, history panel, settings tab, plugin registration
- `api.ts` — YouMind API client using `requestUrl`
- `styles.css` — all current plugin styles
- `manifest.json` — plugin metadata

Target structure for future refactors:

```plaintext
src/
├── core/
├── features/
├── shared/
├── style/
└── utils/
```

Treat that as a roadmap, not current reality.

## Tech Stack

- TypeScript strict mode
- Obsidian Plugin API
- `requestUrl` for HTTP
- Lucide icons via `setIcon()`
- CSS using Obsidian CSS variables only
- esbuild

## API Rules

Base URL: `https://youmind.com/openapi/v1`

### Auth

Always send:

```ts
headers: {
  'x-api-key': apiKey,
  'Authorization': `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
}
```

Live external finding:

- `x-api-key` is the primary working auth header
- Bearer alone returned `401` in external tests on 2026-03-31

### Current Endpoint Style

Use the existing POST endpoints:

- `/createChat`
- `/sendMessage`
- `/listChats`
- `/getChat`
- `/listMessages`
- `/listBoards`
- `/getBoard`
- `/listMaterials`
- `/getMaterial`
- `/listCrafts`
- `/getCraft`
- `/createDocumentByMarkdown`
- `/createNote`
- `/search`

### Outgoing Payload Convention

Normalize external request payloads to `snake_case` where applicable:

- `board_id`
- `chat_id`
- `chat_model`
- `message_mode`

Caller-facing TypeScript methods may still accept camelCase options.

### Response Parsing

Assistant text may be stored in:

1. `blocks[].data`
2. `content`
3. `text`

Do not assume `content` is always populated.

## UI Rules

1. Use Obsidian CSS variables only.
2. Never hardcode colors.
3. Never use emoji.
4. Always use Lucide via `setIcon()`.
5. Use `clickable-icon` for icon buttons.
6. Keep motion subtle.
7. Make layouts work in both light and dark themes.

Preferred variables:

- `--text-normal`
- `--text-muted`
- `--text-faint`
- `--text-accent`
- `--text-on-accent`
- `--background-primary`
- `--background-secondary`
- `--background-modifier-hover`
- `--background-modifier-border`
- `--interactive-accent`
- `--font-ui-small`
- `--font-ui-smaller`
- `--font-ui-medium`
- `--font-interface`
- `--radius-s`
- `--radius-m`

## Frontmatter Convention

```yaml
---
youmind_id: "uuid"
youmind_board: "uuid"
youmind_type: "document"
youmind_synced_at: "ISO8601"
---
```

## Current Status

Implemented:

- Sidebar chat panel
- Real API integration
- API key validation
- Markdown rendering
- Multi-model selector
- Ask / Agent mode switch
- History panel
- `listChats` / `listMessages` / `getChat`
- `snake_case` chat payload normalization

Not yet implemented:

- Board selector
- Material browser
- Push/pull sync
- Security modes
- Agent-driven local vault operations

## Workflow

Commands:

```bash
npm run dev
npm run build
```

After edits:

1. Run `npm run build`
2. Reload Obsidian
3. Test the changed flow manually

## Guidance For Claude

- Prefer incremental refactors over broad speculative rewrites.
- Keep documentation aligned with real code.
- If live API behavior conflicts with docs, trust the live result and note it.
- Remove temporary debug logging after diagnosing issues.
- Preserve Obsidian-native UX.
