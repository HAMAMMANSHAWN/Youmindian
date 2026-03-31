# core/api/types.ts — Board 相关类型定义


> 将以下 TypeScript 代码添加到 `src/core/api/types.ts` 中（如已有该文件则追加 Board 相关类型）。
>
> **⚠️ v2 修复**：修正泛型语法、补充 snake_case 字段约定说明。

```typescript
// ============================================================
// Board Types
// ============================================================

/**
 * YouMind Board entity returned by API.
 *
 * Note: API responses use snake_case field names. These TypeScript
 * interfaces use camelCase for ergonomics. The API client layer
 * (board.ts, chat.ts) is responsible for converting between the two.
 */
export interface Board {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  coverUrl?: string;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Paginated response wrapper used by listBoards etc.
 *
 * Some endpoints return { data: T[], total, page, pageSize }.
 * Others may return a flat array. The API client handles both cases.
 */
export interface PaginatedResponse<t> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Board list API response.
 */
export type BoardListResponse = PaginatedResponse<board>;

// ============================================================
// Chat Types (Board-related additions)
// ============================================================

/**
 * Parameters for creating a new chat.
 *
 * IMPORTANT: These are the TypeScript-side (camelCase) field names.
 * The API client MUST convert to snake_case before sending:
 *   boardId   → board_id
 *   model     → chat_model
 *   mode      → message_mode
 *
 * See AGENTS.md §4.3 for the full field mapping.
 */
export interface CreateChatParams {
  boardId?: string;
  model: string;
  mode: 'ask' | 'agent';
}

/**
 * Board context state — tracks the currently selected board
 * and provides reactive updates to dependent components.
 */
export interface BoardContextState {
  currentBoard: Board | null;
  boards: Board[];
  isLoading: boolean;
  error: string | null;
}
</board></t>
```