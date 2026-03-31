# Phase 1.2 集成指南 — History Panel 接入 Chat View


> 本文档说明如何将 Phase 1.2 的 4 个模块（types 补充、chat.ts、history-panel.ts、history.css）接入现有的 `chat-view.ts` 和 `main.ts`，实现完整的对话历史管理。
>
> **⚠️ 关于文件路径**：与 Phase 1.1 集成指南相同，import 路径使用 target 架构（`src/core/...`、`src/features/...`）。如果当前仍是 flat 结构，请将代码写入现有文件中：
>
> - Chat API 方法 → 写入 `api.ts`
>
> - Chat/Message 类型 → 写入 `api.ts` 顶部或 `types.ts`
>
> - HistoryPanel 类 → 写入 `main.ts` 或新建 `history-panel.ts`
>
> - History CSS → 追加到 `styles.css`

---

## 1. 文件清单

| 文件 | 路径 | 职责 | 依赖 |
| --- | --- | --- | --- |
| types.ts （补充） | `src/core/api/types.ts` | Chat、Message、MessageBlock 类型 + extractAssistantContent | — |
| chat.ts | `src/core/api/chat.ts` | Chat API 调用（createChat / sendMessage / listChats / getChat / listMessages） | types.ts |
| history-panel.ts | `src/features/chat/history-panel.ts` | 侧滑 History 面板 UI 组件 | types.ts, board-context.ts |
| history.css | `src/style/history.css` | History 面板全部样式 | — |

Phase 1.1 依赖（必须已完成）：

| 文件 | 职责 |
| --- | --- |
| board-context.ts | Board 状态管理（HistoryPanel 订阅 board 变化） |
| board-selector.ts | Board 选择器（Context Bar 中） |
| board.css | Board Selector 样式 |

---

## 2. chat-view.ts 改动

这是最核心的改动——将 HistoryPanel 挂载到 chat container，并将 header 中已有的 history 按钮绑定为面板的 toggle 触发器。

### 2.1 完整的 chat-view.ts 结构

```typescript
// src/features/chat/chat-view.ts

import { ItemView, WorkspaceLeaf } from 'obsidian';
import { BoardSelector } from '../board/board-selector';
import { HistoryPanel, HistoryPanelCallbacks } from './history-panel';
import { listChats, listMessages, createChat } from '../../core/api/chat';
import type { Chat, Message } from '../../core/api/types';
import { extractAssistantContent } from '../../core/api/types';
import type YouMindPlugin from '../../main';

export const VIEW_TYPE_YOUMIND_CHAT = 'youmind-chat-view';

export class YouMindChatView extends ItemView {
  // Phase 1.1
  private boardSelector: BoardSelector | null = null;
  private unsubBoardChange: (() => void) | null = null;

  // Phase 1.2
  private historyPanel: HistoryPanel | null = null;
  private currentChatId: string | null = null;
  private messagesEl: HTMLElement | null = null;

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
    this.buildHeader(headerEl);

    // ── Messages area ──
    this.messagesEl = container.createDiv({ cls: 'ym-chat-messages' });

    // ── Phase 1.1: Context Bar (Board Selector) ──
    const contextBarEl = container.createDiv({ cls: 'ym-context-bar' });
    this.boardSelector = new BoardSelector(
      contextBarEl,
      this.plugin.boardContext
    );

    // ── Input area ──
    const inputEl = container.createDiv({ cls: 'ym-chat-input' });
    // ... existing input setup ...

    // ── Phase 1.2: History Panel ──
    // Panel mounts on the chat container (absolute positioned overlay)
    this.historyPanel = new HistoryPanel(
      container,
      this.plugin.boardContext,
      this.buildHistoryCallbacks()
    );

    // ── Board change subscription ──
    this.unsubBoardChange = this.plugin.boardContext.onChange((board) => {
      console.log('[YouMind] Board changed to:', board?.name ?? 'none');
      // Phase 1.2: Reset current chat when board changes
      this.resetChat();
    });
  }

  async onClose() {
    this.boardSelector?.destroy();
    this.boardSelector = null;
    this.historyPanel?.destroy();
    this.historyPanel = null;
    this.unsubBoardChange?.();
    this.unsubBoardChange = null;
  }

  // ... continued below ...
}
```

### 2.2 Header 构建 — 绑定 History 按钮

Header 的 DOM 结构不变（Phase 1.1 承诺的“零改动”），只是给已有的 history 按钮添加点击事件。

```typescript
  // Inside YouMindChatView class

  private buildHeader(headerEl: HTMLElement): void {
    // ── Left: sparkles icon ──
    const leftEl = headerEl.createDiv({ cls: 'ym-chat-header-left' });
    const sparklesBtn = leftEl.createDiv({
      cls: 'clickable-icon',
      attr: { 'aria-label': 'YouMind' },
    });
    setIcon(sparklesBtn, 'sparkles');

    // ── Center: title ──
    const titleEl = headerEl.createDiv({ cls: 'ym-chat-header-title' });
    titleEl.setText('New conversation');

    // ── Right: actions ──
    const rightEl = headerEl.createDiv({ cls: 'ym-chat-header-right' });

    // Rename button
    const renameBtn = rightEl.createDiv({
      cls: 'clickable-icon',
      attr: { 'aria-label': 'Rename conversation' },
    });
    setIcon(renameBtn, 'pencil');

    // ★ History button — Phase 1.2: toggle history panel
    const historyBtn = rightEl.createDiv({
      cls: 'clickable-icon',
      attr: { 'aria-label': 'Conversation history' },
    });
    setIcon(historyBtn, 'clock');
    historyBtn.addEventListener('click', () => {
      this.historyPanel?.toggle();
    });
  }
```

### 2.3 History Panel 回调

HistoryPanel 不直接调用 API——它通过回调委托给 chat-view.ts。这保持了单向数据流：UI 组件 → 回调 → View 控制器 → API。

```typescript
  // Inside YouMindChatView class

  private buildHistoryCallbacks(): HistoryPanelCallbacks {
    return {
      // ── Fetch chats (for panel listing) ──
      fetchChats: async (boardId, page, pageSize) => {
        const result = await listChats(
          this.plugin.settings.apiKey,
          boardId,
          page,
          pageSize
        );
        return result;
      },

      // ── Select a chat to resume ──
      onSelectChat: async (chatId: string) => {
        await this.resumeChat(chatId);
      },

      // ── Create new chat (from panel's "new" button) ──
      onNewChat: async () => {
        this.resetChat();
      },
    };
  }
```

### 2.4 对话恢复与重置

这两个方法是 Phase 1.2 的核心业务逻辑——恢复历史对话和重置为新对话。

```typescript
  // Inside YouMindChatView class

  /**
   * Resume a historical chat — load its messages and display them.
   *
   * Flow:
   * 1. Set currentChatId
   * 2. Call listMessages API to get all messages
   * 3. Clear message area and render messages
   * 4. Update header title
   * 5. Sync active state to HistoryPanel
   */
  private async resumeChat(chatId: string): Promise<void> {
    try {
      // 1. Update state
      this.currentChatId = chatId;
      this.historyPanel?.setActiveChatId(chatId);

      // 2. Show loading state
      if (this.messagesEl) {
        this.messagesEl.empty();
        const loadingEl = this.messagesEl.createDiv({
          cls: 'ym-chat-loading',
        });
        loadingEl.setText('Loading conversation...');
      }

      // 3. Fetch messages
      const result = await listMessages(
        this.plugin.settings.apiKey,
        chatId
      );

      // 4. Render messages
      this.renderMessages(result.messages);

      // 5. Update header title (from first assistant message or chat metadata)
      // Fetch chat metadata for the title
      const { getChat } = await import('../../core/api/chat');
      const chat = await getChat(this.plugin.settings.apiKey, chatId);
      this.updateHeaderTitle(chat.title || 'Untitled');

      // 6. Scroll to bottom
      if (this.messagesEl) {
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      }
    } catch (err: any) {
      console.error('[YouMind] Failed to resume chat:', err);
      if (this.messagesEl) {
        this.messagesEl.empty();
        this.messagesEl.createDiv({
          cls: 'ym-chat-error',
          text: `Failed to load conversation: ${err.message}`,
        });
      }
    }
  }

  /**
   * Reset to a fresh conversation state.
   *
   * Called when:
   * - User switches board (Phase 1.1 → 1.2 bridge)
   * - User clicks "New conversation" in history panel
   * - User starts typing in a blank state
   */
  private resetChat(): void {
    this.currentChatId = null;
    this.historyPanel?.setActiveChatId(null);

    // Clear messages
    if (this.messagesEl) {
      this.messagesEl.empty();
    }

    // Reset header title
    this.updateHeaderTitle('New conversation');

    // Show board context message
    const boardName = this.plugin.boardContext.getBoard()?.name;
    if (this.messagesEl && boardName) {
      const systemMsg = this.messagesEl.createDiv({
        cls: 'ym-chat-system-message',
      });
      systemMsg.setText(`Switched to ${boardName}`);
    }
  }

  /**
   * Render a list of messages into the messages area.
   */
  private renderMessages(messages: Message[]): void {
    if (!this.messagesEl) return;
    this.messagesEl.empty();

    for (const msg of messages) {
      const msgEl = this.messagesEl.createDiv({
        cls: `ym-chat-message ym-chat-message--${msg.role}`,
      });

      if (msg.role === 'user') {
        msgEl.setText(msg.content);
      } else {
        // Assistant: extract from blocks
        const text = extractAssistantContent(msg);
        // Use Obsidian's MarkdownRenderer for rich rendering
        // (simplified here — full implementation uses MarkdownRenderer.renderMarkdown)
        msgEl.setText(text);
      }
    }
  }

  /**
   * Update the header title text.
   */
  private updateHeaderTitle(title: string): void {
    const titleEl = this.containerEl.querySelector('.ym-chat-header-title');
    if (titleEl) {
      titleEl.setText(title);
    }
  }
</void>
```

### 2.5 sendMessage 集成

当用户发送消息时，需要处理两种情况：(1) 已有 chat → 直接 sendMessage；(2) 新对话 → 先 createChat 再 sendMessage。

```typescript
  // Inside YouMindChatView class

  /**
   * Handle user sending a message.
   *
   * If no currentChatId exists, creates a new chat first.
   * The new chat is automatically scoped to the current board.
   */
  private async handleSendMessage(content: string): Promise<void> {
    const apiKey = this.plugin.settings.apiKey;
    const boardId = this.plugin.boardContext.getBoardId();
    const model = this.plugin.settings.chatModel ?? 'claude-4-6-sonnet';
    const mode = this.plugin.settings.messageMode ?? 'agent';

    try {
      // ── Step 1: Ensure we have a chat ──
      if (!this.currentChatId) {
        const chat = await createChat(apiKey, {
          boardId: boardId ?? undefined,
          chatModel: model,
          messageMode: mode,
        });
        this.currentChatId = chat.id;
        this.historyPanel?.setActiveChatId(chat.id);
      }

      // ── Step 2: Render user message immediately (optimistic) ──
      this.appendMessage({ role: 'user', content });

      // ── Step 3: Send to API ──
      const { sendMessage } = await import('../../core/api/chat');
      const response = await sendMessage(apiKey, {
        chatId: this.currentChatId,
        content,
        chatModel: model,
        messageMode: mode,
      });

      // ── Step 4: Render assistant response ──
      const assistantText = extractAssistantContent(response);
      this.appendMessage({ role: 'assistant', content: assistantText });

      // ── Step 5: Update header title if this is the first message ──
      // (API may auto-generate a title after the first exchange)
      if (this.currentChatId) {
        const { getChat } = await import('../../core/api/chat');
        const updatedChat = await getChat(apiKey, this.currentChatId);
        if (updatedChat.title && updatedChat.title !== 'New conversation') {
          this.updateHeaderTitle(updatedChat.title);
        }
      }
    } catch (err: any) {
      console.error('[YouMind] Send message failed:', err);
      this.appendMessage({
        role: 'assistant',
        content: `Error: ${err.message}`,
        isError: true,
      });
    }
  }

  /**
   * Append a single message to the messages area.
   */
  private appendMessage(msg: {
    role: 'user' | 'assistant';
    content: string;
    isError?: boolean;
  }): void {
    if (!this.messagesEl) return;

    const msgEl = this.messagesEl.createDiv({
      cls: `ym-chat-message ym-chat-message--${msg.role}${
        msg.isError ? ' ym-chat-message--error' : ''
      }`,
    });
    msgEl.setText(msg.content);

    // Auto-scroll to bottom
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
</void>
```

---

## 3. DOM 结构总览

```plaintext
.ym-chat-container                     ← position: relative (for panel overlay)
├── .ym-chat-header                    ← 不动：sparkles / 标题 / pencil / ★clock(toggle history)
├── .ym-chat-messages                  ← 消息区域
│   ├── .ym-chat-message--user         ← 用户消息
│   ├── .ym-chat-message--assistant    ← AI 回复
│   └── .ym-chat-system-message        ← 系统提示（如 "Switched to Board X"）
├── .ym-context-bar                    ← Phase 1.1: Board Selector
│   └── .ym-board-selector
├── .ym-chat-input                     ← 输入栏
│
│  ── Phase 1.2 overlay (absolute positioned) ──
├── .ym-history-backdrop               ← 半透明遮罩（点击关闭）
└── .ym-history-panel                  ← 侧滑面板
    ├── .ym-history-header             ← "Conversations" + close
    ├── .ym-history-search             ← search + new-chat button
    └── .ym-history-list               ← 滚动列表
        ├── .ym-history-group-header   ← "Today"
        ├── .ym-history-item.is-active ← 当前对话
        ├── .ym-history-item           ← 其他对话
        ├── .ym-history-group-header   ← "Yesterday"
        ├── .ym-history-item           ← ...
        └── .ym-history-load-more      ← infinite scroll trigger
```

**关键**：`.ym-chat-container` 必须设置 `position: relative`，因为 History Panel 和 Backdrop 都使用 `position: absolute; inset: 0` 定位。在 `styles.css` 中确保：

```css
.ym-chat-container {
  position: relative;
  overflow: hidden; /* 防止面板滑出时产生水平滚动 */
}
```

---

## 4. CSS 引入

在样式入口中引入 history.css（与 board.css 同级）：

```typescript
// esbuild CSS loader
import './style/board.css';
import './style/history.css';
```

或在 `styles.css` 中：

```css
/* styles.css */
@import './src/style/board.css';
@import './src/style/history.css';
```

---

## 5. 数据流总览

```plaintext
User clicks [clock] button in header
    │
    ▼
historyPanel.toggle()
    │
    ├─ Panel slides in from left
    ├─ Calls fetchChats(boardId, page=0, pageSize=20)
    │   │
    │   ▼
    │   chat-view.ts callback → listChats(apiKey, boardId, 0, 20)
    │   │
    │   ▼
    │   API: POST /listChats { board_id, page, page_size }
    │   │
    │   ▼
    │   Returns ChatListResponse → Panel renders time-grouped list
    │
    ▼
User clicks a chat item
    │
    ▼
callbacks.onSelectChat(chatId)
    │
    ├─ Panel closes (slide-out)
    │
    ▼
chat-view.ts → resumeChat(chatId)
    │
    ├─ Set currentChatId = chatId
    ├─ listMessages(apiKey, chatId)
    │   │
    │   ▼
    │   API: POST /listMessages { chat_id }
    │   │
    │   ▼
    │   Returns messages[] → renderMessages()
    │       │
    │       ├─ User messages: msg.content
    │       └─ Assistant messages: extractAssistantContent(msg)
    │
    ├─ getChat(apiKey, chatId) → update header title
    └─ Scroll to bottom


User switches Board (Phase 1.1 → 1.2 bridge)
    │
    ▼
boardContext.onChange fires
    │
    ├─ chat-view.ts → resetChat()
    │   ├─ currentChatId = null
    │   ├─ Clear messages area
    │   ├─ Show "Switched to {boardName}" system message
    │   └─ historyPanel.setActiveChatId(null)
    │
    └─ historyPanel (internal subscription) → resetAndLoad()
        └─ Re-fetches chats for new board


User sends message (no active chat)
    │
    ▼
handleSendMessage(content)
    │
    ├─ createChat(apiKey, { boardId, chatModel, messageMode })
    │   │
    │   ▼
    │   API: POST /createChat { board_id, chat_model, message_mode }
    │   │
    │   ▼
    │   Returns new Chat → currentChatId = chat.id
    │
    ├─ Append user message to UI (optimistic)
    │
    ├─ sendMessage(apiKey, { chatId, content, chatModel, messageMode })
    │   │
    │   ▼
    │   API: POST /sendMessage { chat_id, content, chat_model, message_mode }
    │   │
    │   ▼
    │   Returns assistant response → extractAssistantContent() → append to UI
    │
    └─ getChat() → update header title (API may auto-generate title)
```

---

## 6. Phase 1.1 → 1.2 桥接要点

Phase 1.1 的集成指南中留了两个 TODO，Phase 1.2 现在填充它们：

### 6.1 Board 切换时重置对话

Phase 1.1 集成指南 §3 中的 `onChange` 回调：

```typescript
// Phase 1.1 原始代码（TODO 注释）:
this.unsubBoardChange = this.plugin.boardContext.onChange((board) => {
  console.log('[YouMind] Board changed to:', board?.name ?? 'none');
  // TODO Phase 1.2: Reset chat history panel to new board's chats
});

// Phase 1.2 实现:
this.unsubBoardChange = this.plugin.boardContext.onChange((board) => {
  console.log('[YouMind] Board changed to:', board?.name ?? 'none');
  this.resetChat(); // ← 清空消息 + 重置 chatId + 显示系统提示
  // HistoryPanel 内部也订阅了 boardContext.onChange()，
  // 会自动 resetAndLoad() 刷新对话列表，无需手动触发
});
```

### 6.2 HistoryPanel 的双重 Board 订阅

HistoryPanel 构造函数中已经订阅了 `boardContext.onChange()`。这意味着 Board 切换时有两个订阅者同时响应：

1. **chat-view.ts** 的 `onChange` → 调用 `resetChat()`（清空 UI）

2. **HistoryPanel** 的内部 `onChange` → 调用 `resetAndLoad()`（刷新面板数据，仅在面板打开时）

两者互不干扰，各自处理自己的职责。这是 pub/sub 模式的正常行为。

---

## 7. Settings 类型追加

在 Phase 1.1 的 `lastBoardId` 基础上，追加 chat 相关的默认设置：

```typescript
// src/core/storage/settings.ts

export interface YouMindSettings {
  apiKey: string;
  // Phase 1.1
  lastBoardId?: string;
  // Phase 1.2
  chatModel?: string;      // Default: 'claude-4-6-sonnet'
  messageMode?: 'ask' | 'agent';  // Default: 'agent'
}

export const DEFAULT_SETTINGS: Partial<youmindsettings> = {
  chatModel: 'claude-4-6-sonnet',
  messageMode: 'agent',
};
</youmindsettings>
```

---

## 8. 测试清单

### History Panel 基础功能

- [ ]  点击 header 中的 clock 按钮，History Panel 从左侧滑入

- [ ]  再次点击 clock 按钮，面板滑出关闭

- [ ]  点击 backdrop（面板外半透明区域），面板关闭

- [ ]  按 Escape 键，面板关闭

- [ ]  面板打开时，搜索框自动获得焦点

### 对话列表

- [ ]  面板打开后，显示当前 Board 的对话列表（按时间分组）

- [ ]  当前活跃对话以 accent 色高亮，显示 “Current” 而非时间

- [ ]  无对话时显示 “No conversations yet” 空状态

- [ ]  未选择 Board 时显示 “Select a board to see conversations”

### 搜索

- [ ]  在搜索框输入文字，列表实时过滤（按标题匹配）

- [ ]  搜索无结果时显示 “No conversations match your search”

- [ ]  清空搜索框，恢复完整列表

### 无限滚动

- [ ]  初始加载 20 条对话

- [ ]  滚动到底部附近，自动加载下一页

- [ ]  加载中显示 spinner + “Loading more……”

- [ ]  所有对话加载完毕后，不再触发加载

### 对话恢复

- [ ]  点击历史对话项，面板关闭，消息区加载该对话的消息

- [ ]  Header 标题更新为对话标题

- [ ]  用户消息和 AI 回复正确渲染

- [ ]  消息区自动滚动到底部

### 新对话

- [ ]  点击面板中的 new-chat 按钮（square-pen），面板关闭，消息区清空

- [ ]  Header 标题重置为 “New conversation”

### Board 切换联动

- [ ]  切换 Board 后，消息区清空，显示 “Switched to {boardName}” 系统提示

- [ ]  如果 History Panel 处于打开状态，对话列表自动刷新为新 Board 的对话

- [ ]  currentChatId 重置为 null

### 发送消息

- [ ]  在空白状态发送消息，自动创建新 chat（createChat + sendMessage）

- [ ]  在已恢复的对话中发送消息，直接 sendMessage

- [ ]  用户消息立即显示（乐观渲染），AI 回复在 API 返回后显示

- [ ]  首次消息交换后，header 标题更新为 API 生成的标题

### 删除

- [ ]  hover 对话项时显示删除按钮

- [ ]  点击删除，对话从列表中移除（乐观删除）

- [ ]  删除当前活跃对话后，消息区清空

### 错误处理

- [ ]  API 调用失败时，面板显示错误信息

- [ ]  恢复对话失败时，消息区显示错误提示

- [ ]  发送消息失败时，显示错误消息气泡

---

## 9. 已知限制 & 后续迭代

| 限制 | 说明 | 计划 |
| --- | --- | --- |
| 无服务端删除 | `onDeleteChat` 目前只做 UI 移除，API 端点待确认 | 确认 deleteChat API 后补充 |
| 搜索仅客户端 | 只在已加载的对话中过滤，不搜索未加载的页 | 如果 API 支持 search 参数，可升级为服务端搜索 |
| 消息渲染简化 | 当前用 `setText` 纯文本渲染，未使用 MarkdownRenderer | Phase 1.3 引入 Obsidian MarkdownRenderer 富文本渲染 |
| 无 streaming | sendMessage 等待完整响应后一次性渲染 | Phase 2.x 引入 SSE/streaming 逐字渲染 |
| 无 tool_call 展示 | Assistant 消息中的 tool_call blocks 被过滤掉 | Phase 2.x 引入 Tool Card 组件展示工具调用 |
