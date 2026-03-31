# YouMind for Obsidian

An Obsidian plugin that bridges YouMind's cloud AI with the local Obsidian vault.  
YouMind Agent thinks in the cloud; the plugin executes locally.

---

## 1. What This Plugin Does

YouMind = cloud AI creation studio (boards, materials, multi-model chat, image/video/slides generation, semantic search, skills).  
Obsidian = local-first private knowledge base (Markdown files, offline, open format).  
This plugin connects them: **cloud AI brain + local vault hands**.

Key difference from Claudian:

- We call YouMind OpenAPI directly. No local CLI dependency.
- Agent runs in the cloud with YouMind tools.
- Plugin acts as a bridge: receives intent and executes locally with permission checks.
- Supports Claude, GPT-5, Gemini, DeepSeek.

One-liner: Claudian = invite AI into your house; YouMind for Obsidian = a remote control in your house that commands a cloud AI factory.

---

## 2. Architecture Overview

```text
YouMind Cloud (API)              Plugin (Bridge)                Obsidian Vault (Local)
┌─────────────────┐     ┌──────────────────────────┐     ┌──────────────────┐
│ Chat / Agent    │◄───►│ YouMind API Client       │     │ Markdown files   │
│ Boards          │     │ Action Interpreter       │◄───►│ Frontmatter      │
│ Materials/Crafts│     │ Content Converter        │     │ Folders          │
│ Search          │     │ Security Layer           │     │                  │
│ Tools / Skills  │     └──────────────────────────┘     └──────────────────┘
└─────────────────┘
```

### 2.1 Bridge Layer

The Agent never directly touches the local filesystem. All vault operations should flow through:

1. Agent returns tool calls or actionable output.
2. Action Interpreter maps them to local operations.
3. Security Layer checks permissions.
4. Vault Operations Engine executes safely.

### 2.2 Bidirectional Content Flow

- Pull: YouMind → Obsidian
- Push: Obsidian → YouMind
- Sync: frontmatter links local files and cloud entities

### 2.3 Security Model

| Mode | Vault Read | Vault Write | YouMind API | Use Case |
| --- | --- | --- | --- | --- |
| Safe | Confirm each | Confirm each | Auto | Sensitive vaults |
| Auto | Auto | Confirm | Auto | Default |
| YOLO | Auto | Auto | Auto | Power users |

---

## 3. Tech Stack

| Layer | Tech |
| --- | --- |
| Runtime | Obsidian (Electron), Node.js |
| Language | TypeScript strict mode |
| UI | Obsidian API native (`ItemView`, `Modal`, `Setting`, `MarkdownRenderer`) |
| HTTP | `requestUrl` |
| Styles | Obsidian CSS variables only |
| Icons | Lucide via `setIcon()` |
| Build | esbuild |
| Auth | `x-api-key` primary + `Authorization: Bearer` fallback |

---

## 4. YouMind OpenAPI

Base URL: `https://youmind.com/openapi/v1`

### 4.1 Authentication

Every external request should include:

```ts
headers: {
  'x-api-key': apiKey,
  'Authorization': `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
}
```

Important live finding from 2026-03-31:

- `x-api-key` succeeded against external OpenAPI
- `Authorization: Bearer` alone returned `401`
- therefore `x-api-key` is the real primary auth path for this plugin

### 4.2 Current Endpoint Style

The current live plugin implementation uses the existing OpenAPI POST endpoints, not a RESTful `/chats/...` resource layer:

- `POST /createChat`
- `POST /sendMessage`
- `POST /listChats`
- `POST /getChat`
- `POST /listMessages`
- `POST /listBoards`
- `POST /getBoard`
- `POST /listMaterials`
- `POST /getMaterial`
- `POST /listCrafts`
- `POST /getCraft`
- `POST /createDocumentByMarkdown`
- `POST /createNote`
- `POST /search`

### 4.3 Request Field Convention

For external OpenAPI calls, prefer `snake_case` payload keys:

- `board_id`
- `chat_id`
- `chat_model`
- `message_mode`

Local TypeScript method signatures may stay camelCase for ergonomics, but the bridge layer should normalize outgoing payloads to `snake_case`.

### 4.4 Response Parsing

Assistant messages may store text in `blocks[].data`, not only `content`.

Use this extraction priority:

```ts
1. blocks[].data
2. content
3. text
```

Example:

```json
{
  "role": "assistant",
  "$class": "AssistantMessageV2Dto",
  "blocks": [
    {
      "type": "content",
      "data": "AI 的回复内容在这里"
    }
  ]
}
```

### 4.5 Models

| Value | Label |
| --- | --- |
| `claude-4-6-sonnet` | Sonnet |
| `claude-4-6-opus` | Opus |
| `gpt-5` | GPT-5 |
| `gemini-3.1-pro-preview` | Gemini Pro |
| `deepseek-chat` | DeepSeek |

### 4.6 Modes

| Value | Description |
| --- | --- |
| `ask` | Simple Q&A, no tools |
| `agent` | Full agent with tools |

---

## 5. Source Code Structure

### Current repository shape

```plaintext
youmind-obsidian/
├── main.ts
├── api.ts
├── styles.css
├── manifest.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── AGENTS.md
└── CLAUDE.md
```

### Target architecture

```plaintext
src/
├── main.ts
├── core/
├── features/
├── shared/
├── style/
└── utils/
```

This target structure is a roadmap, not the current file layout. When refactoring, move toward it incrementally rather than forcing it all at once.

---

## 6. UI Design Rules

### 6.1 Core Principles

1. Obsidian-native look only
2. Use Obsidian CSS variables for all colors
3. Use Lucide via `setIcon()`
4. No emoji
5. Use `clickable-icon` for icon buttons
6. Must work in light and dark themes
7. Use restrained motion only

### 6.2 Key CSS Variables

```css
--text-normal
--text-muted
--text-faint
--text-accent
--text-on-accent
--background-primary
--background-secondary
--background-modifier-hover
--background-modifier-border
--interactive-accent
--font-ui-small
--font-ui-smaller
--font-ui-medium
--font-interface
--radius-s
--radius-m
```

---

## 7. Frontmatter Convention

```yaml
---
youmind_id: "uuid"
youmind_board: "uuid"
youmind_type: "document"
youmind_synced_at: "ISO8601"
---
```

---

## 8. Development Workflow

```bash
npm run dev
npm run build
npm run check:secrets
```

### Pre-commit safety check

Before commit or push:

1. Run `git status --short` and confirm you are only staging intended files.
2. Run `npm run check:secrets` to catch likely PATs, API keys, auth tokens, and private keys in tracked files.
3. Prefer targeted staging such as `git add main.ts api.ts styles.css` instead of `git add -A`.
4. Never commit local plugin state or session logs. Keep files like `data.json`, `.specstory/`, `.env*`, and `*.local` out of git.
5. If a real token or API key was ever pasted into a tracked file, rotate it even if you later delete it.
npm run build
```

After code changes, reload Obsidian with `Cmd+P` → `Reload app without saving`.

Checklist for meaningful changes:

- [ ] `npm run build` passes
- [ ] no hardcoded colors
- [ ] no emoji
- [ ] API uses `requestUrl`
- [ ] auth headers include `x-api-key`
- [ ] assistant parsing supports `blocks[].data`

---

## 9. Current Status

Completed:

- Sidebar chat panel
- `createChat` / `sendMessage` integration
- `x-api-key` auth + Bearer fallback
- `blocks[].data` parsing
- Model selection
- Ask / Agent mode toggle
- Markdown rendering
- API key validation button
- Chat history panel
- `listChats` / `listMessages` / `getChat` client methods
- `snake_case` normalization for outgoing chat payloads

---

## 10. Development Roadmap

### Phase 1

- Board selector
- Chat history polish
- Material browser
- Push current note to YouMind
- `@` references

### Phase 2

- Agent → vault operations bridge
- Tool visualization
- Tool controls

### Phase 3

- Message hover actions
- Input enhancements

### Phase 4

- Semantic search
- Smart context

### Phase 5

- Settings polish
- Keyboard shortcuts
- Responsive layout

---

## 11. Key Design Decisions

1. No Claude Agent SDK
2. Bridge Layer pattern
3. Security-first vault access
4. Frontmatter as the sync link
5. Obsidian-native UI only

---

## 12. Capability Comparison

| Dimension | Claudian | YouMind for Obsidian |
| --- | --- | --- |
| AI location | Local CLI | Cloud API |
| Models | Claude | Claude / GPT-5 / Gemini / DeepSeek |
| Vault ops | Direct local | Through bridge |
| Dependencies | CLI required | API key only |
| Multimedia | Limited | Broader YouMind toolchain |

---

## 13. Working Rules For Codex

- Keep `main.ts` thin where practical, but prefer incremental refactors over broad rewrites.
- Extend `api.ts` first when adding YouMind-backed features.
- Prefer correctness over speculative architecture.
- Do not document unimplemented behavior as if it already exists.
- Remove temporary debug logs once API/network debugging is done.
- When API docs conflict with live behavior, trust live behavior and record the finding.
