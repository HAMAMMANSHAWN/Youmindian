# core/api/board.ts — Board API 模块


> 文件路径：`src/core/api/board.ts`
>
> **⚠️ 关键修复 (v2)**：所有端点从 REST GET 改为实测验证的 RPC POST 风格，字段名统一为 `snake_case`。

```typescript
import { requestUrl, RequestUrlParam } from 'obsidian';
import type { Board, BoardListResponse } from './types';

const BASE_URL = 'https://youmind.com/openapi/v1';

/**
 * Board API — handles all board-related YouMind API calls.
 *
 * Design notes:
 * - Uses Obsidian's `requestUrl` for all HTTP calls (handles CORS in Electron).
 * - Dual auth headers: x-api-key (primary) + Authorization Bearer (fallback).
 * - All endpoints are POST with JSON body (RPC-style, live-verified).
 * - All payload fields use snake_case (server requirement, confirmed via WeChat Skill project).
 * - Caches board list in memory with TTL to avoid excessive API calls.
 * - All methods are static — no instantiation needed, just pass apiKey.
 */

// ============================================================
// In-memory cache
// ============================================================

interface CacheEntry<t> {
  data: T;
  timestamp: number;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let boardListCache: CacheEntry<board[]> | null = null;
let defaultBoardCache: CacheEntry<board> | null = null;

function isCacheValid<t>(entry: CacheEntry<t> | null): entry is CacheEntry<t> {
  return entry !== null && Date.now() - entry.timestamp < CACHE_TTL;
}

export function invalidateBoardCache(): void {
  boardListCache = null;
  defaultBoardCache = null;
}

// ============================================================
// HTTP helpers
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
 *
 * All YouMind OpenAPI endpoints are POST with JSON body (RPC-style).
 * This was confirmed via live testing on 2026-03-31 — GET/REST-style
 * paths like `/boards` or `/boards/{id}` are NOT the live endpoints.
 *
 * @param path - API path (e.g., '/listBoards')
 * @param apiKey - YouMind API key
 * @param body - Request body (snake_case fields)
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
// Public API
// ============================================================

/**
 * Fetch all boards for the authenticated user.
 *
 * Endpoint: POST /listBoards
 * Body: {} (no required params, returns all boards)
 *
 * Results are cached for 5 minutes to keep the board selector
 * responsive without hammering the API.
 *
 * @param apiKey - YouMind API key
 * @param forceRefresh - bypass cache and fetch fresh data
 */
export async function listBoards(
  apiKey: string,
  forceRefresh = false
): Promise<board[]> {
  if (!forceRefresh && isCacheValid(boardListCache)) {
    return boardListCache.data;
  }

  const result = await apiPost<boardlistresponse>(
    '/listBoards',
    apiKey,
    {}
  );

  // API may return { data: [...] } or a flat array — handle both
  const boards = Array.isArray(result) ? result : (result.data ?? []);

  boardListCache = { data: boards, timestamp: Date.now() };
  return boards;
}

/**
 * Fetch a single board by ID.
 *
 * Endpoint: POST /getBoard
 * Body: { board_id: "uuid" }
 *
 * Not cached — used for targeted lookups (e.g., verifying a board still exists).
 *
 * @param apiKey - YouMind API key
 * @param boardId - UUID of the board
 */
export async function getBoard(
  apiKey: string,
  boardId: string
): Promise<board> {
  return apiPost<board>('/getBoard', apiKey, {
    board_id: boardId,   // snake_case — server requirement
  });
}

/**
 * Fetch the user's default board.
 *
 * Endpoint: POST /getDefaultBoard
 * Body: {}
 *
 * Cached separately from the board list since this is called on plugin load
 * to set the initial board context.
 *
 * @param apiKey - YouMind API key
 * @param forceRefresh - bypass cache
 */
export async function getDefaultBoard(
  apiKey: string,
  forceRefresh = false
): Promise<board> {
  if (!forceRefresh && isCacheValid(defaultBoardCache)) {
    return defaultBoardCache.data;
  }

  const board = await apiPost<board>('/getDefaultBoard', apiKey, {});

  defaultBoardCache = { data: board, timestamp: Date.now() };
  return board;
}

/**
 * Search boards by name (client-side filter).
 *
 * The YouMind API doesn't expose a server-side board search endpoint,
 * so we filter the cached board list locally. This is fine because
 * board counts are typically small (<50).
 *
 * @param apiKey - YouMind API key
 * @param query - search string (case-insensitive substring match)
 */
export async function searchBoards(
  apiKey: string,
  query: string
): Promise<board[]> {
  const boards = await listBoards(apiKey);
  if (!query.trim()) return boards;

  const lowerQuery = query.toLowerCase().trim();
  return boards.filter(
    (b) =>
      b.name.toLowerCase().includes(lowerQuery) ||
      b.description?.toLowerCase().includes(lowerQuery)
  );
}
</board[]></board></board></board></board></boardlistresponse></board[]></t></string,></t></string,></t></t></t></board></board[]></t>
```

---

## 与 v1 的关键差异

| 项目 | v1 （有问题） | v2 （已修复） |
| --- | --- | --- |
| HTTP 方法 | `GET` (`apiGet`) | `POST` (`apiPost`) |
| 端点路径 | `/boards? page=1&pageSize=100` | `/listBoards` |
| 获取单个 Board | `GET /boards/${boardId}` | `POST /getBoard` body: `{ board_id }` |
| 获取默认 Board | `GET /boards/default` | `POST /getDefaultBoard` body: `{}` |
| 字段命名 | 路径参数 （无 body） | `snake_case` body 字段 |
| 响应兼容 | 仅处理 `result.data` | 兼容 `result.data` 和 flat array |

## 设计说明

**缓存策略**：Board 列表和默认 Board 各自独立缓存，TTL 为 5 分钟。Board 选择器打开时不会每次都发 API 请求，但用户可以通过下拉刷新按钮手动 `forceRefresh`。`invalidateBoardCache()` 供外部在需要时（如创建新 Board 后）清除缓存。

**搜索实现**：由于 YouMind API 没有 Board 搜索端点，搜索在客户端完成。大多数用户的 Board 数量在 50 个以内，客户端过滤的性能完全足够。搜索支持对 `name` 和 `description` 的大小写不敏感子串匹配。

**错误处理**：所有 API 调用在非 2xx 响应时抛出带有状态码和路径的描述性错误，方便上层组件（Board Selector）捕获并展示用户友好的错误提示。

**响应格式兼容**：`listBoards` 同时处理 `{ data: [...] }` 包装格式和直接返回数组的情况，因为 YouMind API 的不同端点可能有不同的响应结构。