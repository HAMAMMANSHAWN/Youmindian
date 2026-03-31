# Phase 1.1 集成指南 — Board Selector 接入 Chat View


> 本文档说明如何将 Board Selector 的 4 个模块接入现有的 `chat-view.ts` 和 `main.ts`。
>
> **⚠️ 关于文件路径**：本文档中的 import 路径使用的是 **target 架构**（`src/core/...`、`src/features/...`）。如果当前仓库仍是 flat 结构（`main.ts`、`api.ts`），请将这些模块的代码直接写入现有文件中，等重构时再拆分。具体来说：
>
> - Board API 方法 → 写入 `api.ts`
>
> - Board 类型 → 写入 `api.ts` 顶部或单独的 `types.ts`
>
> - BoardContext 类 → 写入 `main.ts` 或新建 `board-context.ts`
>
> - BoardSelector 类 → 写入 `main.ts` 或新建 `board-selector.ts`
>
> - Board CSS → 追加到 `styles.css`

---

## 1. 文件清单

| 文件 | 路径 | 职责 |
| --- | --- | --- |
| types.ts | `src/core/api/types.ts` | Board 相关类型定义 |
| board.ts | `src/core/api/board.ts` | Board API 调用（listBoards / getBoard / getDefaultBoard） |
| board-context.ts | `src/features/board/board-context.ts` | Board 状态管理（单例，pub/sub） |
| board-selector.ts | `src/features/board/board-selector.ts` | Board 下拉选择器 UI 组件 |
| board.css | `src/style/board.css` | Board Selector 样式 |

---

## 2. main.ts 改动

在插件入口初始化 `BoardContext` 单例，并在 `onunload` 时销毁。

```typescript
// src/main.ts

import { Plugin } from 'obsidian';
import { BoardContext } from './features/board/board-context';

export default class YouMindPlugin extends Plugin {
  boardContext: BoardContext;

  async onload() {
    // ... existing code ...

    // ── Phase 1.1: Initialize Board Context ──
    const settings = await this.loadSettings(); // your existing settings loader

    this.boardContext = new BoardContext(
      settings.apiKey,
      // Persist callback: save selected boardId to settings
      async (boardId: string) => {
        settings.lastBoardId = boardId;
        await this.saveSettings(settings);
      },
      // Load callback: read persisted boardId from settings
      () => settings.lastBoardId ?? null
    );

    // Initialize asynchronously (don't block plugin load)
    this.boardContext.initialize().catch((err) => {
      console.error('[YouMind] Failed to initialize board context:', err);
    });

    // ... rest of onload (register views, commands, etc.) ...
  }

  onunload() {
    // ... existing cleanup ...
    this.boardContext?.destroy();
  }
}
```

### Settings 类型追加

在你的 settings 类型定义中添加 `lastBoardId` 字段：

```typescript
// src/core/storage/settings.ts

export interface YouMindSettings {
  apiKey: string;
  // ... existing fields ...
  lastBoardId?: string;  // ← Phase 1.1 新增
}
```

---

## 3. chat-view.ts 改动

在 Chat View 的 header 区域挂载 Board Selector，并在 `createChat` 时自动绑定 `boardId`。

```typescript
// src/features/chat/chat-view.ts

import { ItemView, WorkspaceLeaf } from 'obsidian';
import { BoardSelector } from '../board/board-selector';
import type YouMindPlugin from '../../main';

export const VIEW_TYPE_YOUMIND_CHAT = 'youmind-chat-view';

export class YouMindChatView extends ItemView {
  private boardSelector: BoardSelector | null = null;
  private unsubBoardChange: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: YouMindPlugin) {
    super(leaf);
  }

  getViewType() { return VIEW_TYPE_YOUMIND_CHAT; }
  getDisplayText() { return 'YouMind Chat'; }
  getIcon() { return 'message-circle'; }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('ym-chat-container');

    // ── Header ──
    const headerEl = container.createDiv({ cls: 'ym-chat-header' });

    // History button (existing)
    const historyBtn = headerEl.createDiv({
      cls: 'ym-chat-header-btn clickable-icon',
    });
    // setIcon(historyBtn, 'menu');

    // ★ Phase 1.1: Board Selector — 挂载到 header 中间区域
    this.boardSelector = new BoardSelector(
      headerEl,
      this.plugin.boardContext
    );

    // New chat button (existing)
    const newChatBtn = headerEl.createDiv({
      cls: 'ym-chat-header-btn clickable-icon',
    });
    // setIcon(newChatBtn, 'plus');

    // ── Subscribe to board changes ──
    // When user switches board, reset current chat or show prompt
    this.unsubBoardChange = this.plugin.boardContext.onChange((board) => {
      console.log('[YouMind] Board changed to:', board?.name ?? 'none');
      // TODO Phase 1.2: Reset chat history panel to new board's chats
      // TODO Phase 1.3: Reload material browser for new board
    });

    // ── Messages area ──
    const messagesEl = container.createDiv({ cls: 'ym-chat-messages' });

    // ── Input area ──
    const inputEl = container.createDiv({ cls: 'ym-chat-input' });
    // ... existing input setup ...
  }

  async onClose() {
    this.boardSelector?.destroy();
    this.boardSelector = null;
    this.unsubBoardChange?.();
    this.unsubBoardChange = null;
  }
}
```

---

## 4. createChat 绑定 boardId

在发送消息创建新 chat 时，自动从 `BoardContext` 获取当前 boardId。

**⚠️ 注意**：发给 API 的 payload 必须用 `snake_case` 字段名（见 [AGENTS.md](http://AGENTS.md) §4.3）。

```typescript
// 在 chat 相关逻辑中（如 chat-view.ts 的 sendMessage 方法）

async function createNewChat(plugin: YouMindPlugin, model: string, mode: 'ask' | 'agent') {
  const boardId = plugin.boardContext.getBoardId();

  // API client 内部需要将 camelCase 转为 snake_case:
  //   boardId    → board_id
  //   model      → chat_model
  //   mode       → message_mode
  const response = await createChat(plugin.settings.apiKey, {
    board_id: boardId,       // snake_case — server requirement
    chat_model: model,       // snake_case
    message_mode: mode,      // snake_case
  });

  return response;
}
```

这样 Agent 在该 chat 中就能访问对应 board 的 materials、crafts 和 context.

---

## 5. CSS 引入

在 `main.ts` 或你的样式入口文件中引入 board.css：

```typescript
// 如果使用 esbuild CSS loader
import './style/board.css';
```

或者在 `styles.css`（Obsidian 插件的全局样式文件）中 `@import`：

```css
/* styles.css */
@import './src/style/board.css';
```

---

## 6. 数据流总览

```plaintext
Plugin Load
    │
    ▼
BoardContext.initialize()
    │
    ├─ loadPersistedBoardId() → settings.lastBoardId
    │   │
    │   ├─ found → listBoards() → verify exists → setBoard()
    │   └─ not found → getDefaultBoard() → setBoard()
    │
    ▼
ChatView.onOpen()
    │
    ├─ new BoardSelector(headerEl, boardContext)
    │   └─ renders trigger: [icon] "Board Name" [▼]
    │
    ├─ boardContext.onChange(callback)
    │   └─ future: reset chat history, reload browser
    │
    ▼
User clicks Board Selector
    │
    ├─ dropdown opens → search + board list
    ├─ user selects board
    │   │
    │   ▼
    │   boardContext.setBoard(board)
    │       │
    │       ├─ persistBoardId(board.id) → settings saved
    │       ├─ notify listeners → ChatView callback fires
    │       └─ trigger re-renders with new board name
    │
    ▼
User sends message
    │
    ├─ createChat({ boardId: boardContext.getBoardId(), model, mode })
    └─ Agent now has board context → can access materials, crafts, etc.
```

---

## 7. 测试清单

### 基础功能

- [ ]  插件加载后，header 中间显示 Board Selector trigger（图标 + Board 名称 + 箭头）

- [ ]  首次加载时，自动选中 persisted board 或 default board 或第一个 board

- [ ]  点击 trigger 打开下拉面板，再次点击关闭

- [ ]  下拉面板显示所有 board，当前选中的 board 有 check 图标和高亮色

### 搜索与交互

- [ ]  在搜索框输入文字，board 列表实时过滤（匹配 name 和 description）

- [ ]  清空搜索框后恢复完整列表

- [ ]  键盘 ↑/↓ 移动高亮，Enter 选择，Escape 关闭

- [ ]  点击面板外部自动关闭

### Board 切换

- [ ]  选择新 board 后，trigger 显示新 board 名称

- [ ]  切换 board 后，下次打开插件自动恢复到该 board（持久化验证）

- [ ]  切换 board 后，新建 chat 的 `createChat` 请求中包含正确的 `board_id`

### 刷新

- [ ]  点击刷新按钮，图标旋转，board 列表重新加载

- [ ]  如果当前 board 被删除，自动降级到第一个 board

### API 合规

- [ ]  所有请求使用 `POST` 方法（`/listBoards`、`/getBoard`、`/getDefaultBoard`）

- [ ]  请求 body 字段为 `snake_case`（`board_id`，不是 `boardId`）

- [ ]  请求 header 包含 `x-api-key`（primary）和 `Authorization: Bearer`（fallback）

### 主题兼容

- [ ]  Light 主题下外观正常（颜色、边框、阴影）

- [ ]  Dark 主题下外观正常

- [ ]  长 board 名称正确截断（ellipsis），不撑破布局

### 边界情况

- [ ]  API Key 无效时，显示错误信息而非空白

- [ ]  用户没有任何 board 时，显示 “No boards found”

- [ ]  网络断开时，显示错误信息并允许重试（刷新按钮）

- [ ]  插件加载期间（boards 还在请求中），dropdown 显示 loading 状态而非 “No boards found”
