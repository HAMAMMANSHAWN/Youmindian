# core/api/types.ts — Chat & Message 类型定义（Phase 1.2 补充）


> 将以下 TypeScript 类型追加到 `src/core/api/types.ts`（或在 flat 结构中追加到 `api.ts` 顶部）。
>
> **Phase 1.2 新增**：Chat 和 Message 相关类型，基于 YouMind OpenAPI schema 实测确认。

```typescript
// ============================================================
// Chat Types (Phase 1.2)
// ============================================================

/**
 * Chat origin — describes where the chat was initiated from.
 *
 * API returns snake_case, but we use camelCase in TypeScript.
 * The API client layer handles conversion.
 */
export interface ChatOrigin {
  type: 'snip' | 'board' | 'thought' | 'unknown' | 'webpage' | 'craft';
  id?: string;
  url?: string;
  title?: string;
  content?: string;
  description?: string;
}

/**
 * Chat status — derived from the last assistant message status.
 */
export type ChatStatus = 'not-started' | 'answering' | 'thinking' | 'completed';

/**
 * Chat mode — the type of chat session.
 */
export type ChatMode = 'chat' | 'new_board' | 'custom_assistant' | 'assistant_preview';

/**
 * Chat entity returned by listChats / getChat.
 *
 * Note: API responses use snake_case. These TypeScript interfaces
 * use camelCase for ergonomics. The API client layer converts.
 */
export interface Chat {
  id: string;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  origin: ChatOrigin;
  boardId?: string;
  mode: ChatMode;
  showNewBoardSuggestion: boolean;
  newBoardChatId?: string;
  status?: ChatStatus;
  hasUnread: boolean;
}

/**
 * Paginated chat list response from listChats.
 */
export interface ChatListResponse {
  data: Chat[];
  total: number;
  page: number;
  pageSize: number;
}

// ============================================================
// Message Types (Phase 1.2)
// ============================================================

/**
 * Message block — the primary content unit in assistant messages.
 *
 * CRITICAL: Assistant text lives in blocks[].data, NOT in message.content.
 * Block type is "content" (confirmed live), NOT "text".
 * See AGENTS.md §4.4 for the full extraction chain.
 */
export interface MessageBlock {
  type: 'content' | 'text' | 'tool_call' | 'tool_result' | string;
  data: string;
}

/**
 * Base message fields shared by user and assistant messages.
 */
export interface BaseMessage {
  id: string;
  role: 'user' | 'assistant';
  createdAt: string;
  updatedAt?: string;
}

/**
 * User message — content is in the `content` field directly.
 */
export interface UserMessage extends BaseMessage {
  role: 'user';
  content: string;
}

/**
 * Assistant message — content is in blocks[].data.
 *
 * The DTO class is AssistantMessageV2Dto (confirmed live).
 * Always use extractAssistantContent() to get the text.
 */
export interface AssistantMessage extends BaseMessage {
  role: 'assistant';
  blocks: MessageBlock[];
  content?: string;  // Fallback — may be empty
  text?: string;     // Last resort fallback
}

/**
 * Union type for any message.
 */
export type Message = UserMessage | AssistantMessage;

/**
 * Message list response from listMessages.
 */
export interface MessageListResponse {
  messages: Message[];
  total: number;
}

// ============================================================
// Helper: Extract assistant content (Phase 1.2)
// ============================================================

/**
 * Extracts displayable text from an assistant message.
 *
 * Priority chain (confirmed via live testing):
 * 1. blocks[].data where type is "content" or "text"
 * 2. message.content field
 * 3. message.text field
 * 4. Empty string (should never happen)
 *
 * See AGENTS.md §4.4 for details.
 */
export function extractAssistantContent(message: AssistantMessage | any): string {
  // 1. Primary: blocks[].data
  if (message.blocks?.length > 0) {
    const text = message.blocks
      .filter((b: MessageBlock) => b.type === 'content' || b.type === 'text')
      .map((b: MessageBlock) => b.data)
      .join('
');
    if (text) return text;
  }
  // 2. Fallback: content field
  if (message.content) return message.content;
  // 3. Last resort: text field
  return message.text || '';
}

// ============================================================
// CreateChat / SendMessage params (Phase 1.2)
// ============================================================

/**
 * Parameters for creating a new chat.
 *
 * TypeScript-side uses camelCase. API client converts to snake_case:
 *   boardId      → board_id
 *   chatModel    → chat_model
 *   messageMode  → message_mode
 */
export interface CreateChatParams {
  boardId?: string;
  chatModel: string;
  messageMode: 'ask' | 'agent';
}

/**
 * Parameters for sending a message.
 *
 * TypeScript-side uses camelCase. API client converts to snake_case:
 *   chatId       → chat_id
 *   chatModel    → chat_model
 *   messageMode  → message_mode
 *   atReferences → at_references
 */
export interface SendMessageParams {
  chatId: string;
  content: string;
  chatModel: string;
  messageMode: 'ask' | 'agent';
  atReferences?: string[];
}
```

---

## 设计说明

**类型来源**：所有类型定义直接基于 YouMind OpenAPI schema（通过 `readApi` 实测获取），而非推测。关键字段如 `ChatOrigin.type` 的枚举值（`snip | board | thought | unknown | webpage | craft`）、`ChatStatus` 的枚举值（`not-started | answering | thinking | completed`）都是 schema 中明确定义的。

**extractAssistantContent()**：这个工具函数放在 types.ts 中而非单独文件，因为它与 `AssistantMessage` 类型紧密耦合。任何需要显示 assistant 消息文本的地方都应该调用这个函数，而不是直接访问 `message.content`。

**CreateChatParams 重构**：Phase 1.1 中的 `CreateChatParams` 只有 `boardId`、`model`、`mode` 三个字段。Phase 1.2 将其重命名为 `chatModel` 和 `messageMode`，与 API 的 `snake_case` 字段名（`chat_model`、`message_mode`）更直接对应，减少转换时的认知负担。