# core/api/chat.ts — Chat API 模块（Phase 1.2）


> 文件路径：`src/core/api/chat.ts`
>
> **Phase 1.2 新增**：Chat API 模块，封装所有对话相关的 YouMind OpenAPI 调用。

```typescript
import { requestUrl, RequestUrlParam } from 'obsidian';
import type {
  Chat,
  ChatListResponse,
  CreateChatParams,
  SendMessageParams,
  Message,
  MessageListResponse,
} from './types';

const BASE_URL = 'https://youmind.com/openapi/v1';

// ============================================================
// HTTP helpers (shared with board.ts — consider extracting to client.ts later)
// ============================================================

function buildHeaders(apiKey: string): Record<string, string=""> {
  return {
    'x-api-key': apiKey,                   // PRIMARY — required (live-verified)
    'Authorization': `Bearer ${apiKey}`,   // FALLBACK — for compatibility
    'Content-Type': 'application/json',
  };
}

/**
 * Generic POST request to YouMind OpenAPI.
 * All endpoints are POST with JSON body (RPC-style, live-verified).
 */
async function apiPost<t>(
  path: string,
  apiKey: string,
  body: Record<string, unknown=""> = {}
): Promise<t> {
  const params: RequestUrlParam = {
    url: `${BASE_URL}${path}`,
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify(body),
  };

  const response = await requestUrl(params);

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `YouMind API error ${response.status}: POST ${path} — ${JSON.stringify(response.json)}`
    );
  }

  return response.json as T;
}

// ============================================================
// Chat API
// ============================================================

/**
 * Create a new chat session.
 *
 * Endpoint: POST /createChat
 * Body: { board_id?, chat_model, message_mode }
 *
 * Returns the newly created Chat object. The chat starts empty —
 * no messages until sendMessage is called.
 *
 * @param apiKey - YouMind API key
 * @param params - Chat creation parameters (camelCase, converted to snake_case)
 */
export async function createChat(
  apiKey: string,
  params: CreateChatParams
): Promise<chat> {
  return apiPost<chat>('/createChat', apiKey, {
    board_id: params.boardId,           // snake_case
    chat_model: params.chatModel,       // snake_case
    message_mode: params.messageMode,   // snake_case
  });
}

/**
 * Send a message to an existing chat.
 *
 * Endpoint: POST /sendMessage
 * Body: { chat_id, content, chat_model, message_mode, at_references? }
 *
 * Returns the assistant's response message. The response content
 * is in blocks[].data — use extractAssistantContent() to extract text.
 *
 * @param apiKey - YouMind API key
 * @param params - Message parameters (camelCase, converted to snake_case)
 */
export async function sendMessage(
  apiKey: string,
  params: SendMessageParams
): Promise<message> {
  return apiPost<message>('/sendMessage', apiKey, {
    chat_id: params.chatId,             // snake_case
    content: params.content,
    chat_model: params.chatModel,       // snake_case
    message_mode: params.messageMode,   // snake_case
    at_references: params.atReferences, // snake_case
  });
}

// ============================================================
// Chat History API
// ============================================================

/**
 * List chats, optionally filtered by board.
 *
 * Endpoint: POST /listChats
 * Body: { board_id?, page?, page_size? }
 *
 * Returns paginated chat list sorted by updatedAt descending (most recent first).
 * Each chat includes metadata (title, status, origin) but NOT messages.
 *
 * Pagination: page is 0-based, pageSize defaults to 20, max 100.
 *
 * @param apiKey - YouMind API key
 * @param boardId - Optional board filter. If provided, only returns chats in that board.
 * @param page - Page number (0-based, default 0)
 * @param pageSize - Items per page (default 20, max 100)
 */
export async function listChats(
  apiKey: string,
  boardId?: string,
  page = 0,
  pageSize = 20
): Promise<chatlistresponse> {
  const body: Record<string, unknown=""> = {
    page,
    page_size: pageSize,   // snake_case
  };
  if (boardId) {
    body.board_id = boardId; // snake_case
  }
  return apiPost<chatlistresponse>('/listChats', apiKey, body);
}

/**
 * Get a single chat by ID.
 *
 * Endpoint: POST /getChat
 * Body: { chat_id }
 *
 * Returns full chat metadata (without messages).
 * Use listMessages() to get the message history.
 *
 * @param apiKey - YouMind API key
 * @param chatId - Chat UUID
 */
export async function getChat(
  apiKey: string,
  chatId: string
): Promise<chat> {
  return apiPost<chat>('/getChat', apiKey, {
    chat_id: chatId,   // snake_case
  });
}

/**
 * List all messages in a chat.
 *
 * Endpoint: POST /listMessages
 * Body: { chat_id }
 *
 * Returns all messages (user + assistant) in chronological order.
 * Assistant messages have content in blocks[].data — use
 * extractAssistantContent() to extract displayable text.
 *
 * NOTE: This endpoint returns ALL messages at once (no pagination).
 * For very long conversations this could be a large payload.
 *
 * @param apiKey - YouMind API key
 * @param chatId - Chat UUID
 */
export async function listMessages(
  apiKey: string,
  chatId: string
): Promise<messagelistresponse> {
  return apiPost<messagelistresponse>('/listMessages', apiKey, {
    chat_id: chatId,   // snake_case
  });
}
</messagelistresponse></messagelistresponse></chat></chat></chatlistresponse></string,></chatlistresponse></message></message></chat></chat></t></string,></t></string,>
```

---

## 与 board.ts 的关系

`chat.ts` 和 `board.ts` 共享相同的 HTTP helper 模式（`buildHeaders`、`apiPost`）。当前阶段两者各自包含一份副本，这是有意为之——在 flat 结构中，这些方法会合并到 `api.ts` 中。等重构到 target 架构时，应提取为 `core/api/client.ts` 共享模块。

## API 字段映射速查

| TypeScript (camelCase) | API body (snake_case) | 用于 |
| --- | --- | --- |
| `boardId` | `board_id` | createChat, listChats |
| `chatId` | `chat_id` | sendMessage, getChat, listMessages |
| `chatModel` | `chat_model` | createChat, sendMessage |
| `messageMode` | `message_mode` | createChat, sendMessage |
| `atReferences` | `at_references` | sendMessage |
| `pageSize` | `page_size` | listChats |

## 设计说明

**无缓存**：与 `board.ts` 不同，chat API 不做客户端缓存。原因是对话数据变化频繁（新消息、状态变化），缓存一致性难以保证。History Panel 自身维护一个简单的内存列表，每次打开时刷新。

**分页策略**：`listChats` 支持分页（0-based page），默认每页 20 条。History Panel 初始加载第一页，用户滚动到底部时加载下一页（infinite scroll）。`listMessages` 不支持分页，一次返回所有消息。

**错误传播**：所有 API 调用在非 2xx 时抛出描述性 Error，由上层 UI（History Panel）捕获并展示用户友好的提示。