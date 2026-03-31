# features/board/board-context.ts — Board 上下文管理


> 文件路径：`src/features/board/board-context.ts`
>
> **⚠️ v2 修复**：`isLoading` 变化时触发 `notifyListeners()`，让 BoardSelector 能正确显示 loading 状态。

```typescript
import type { Board } from '../../core/api/types';
import {
  listBoards,
  getDefaultBoard,
  invalidateBoardCache,
} from '../../core/api/board';

/**
 * Listener callback type — invoked whenever the active board or loading state changes.
 */
type BoardChangeListener = (board: Board | null) => void;

/**
 * BoardContext — singleton state manager for the currently selected board.
 *
 * This is the single source of truth for "which board am I working with?"
 * across the entire plugin. The Chat panel, Material Browser, Push commands,
 * and @ mention system all read from here.
 *
 * Design rationale:
 * - Obsidian plugins don't have a React-style state tree, so we use a
 *   lightweight pub/sub pattern. Any component can subscribe to board
 *   changes via onChange() and will be notified synchronously.
 * - The context persists the last-used boardId to plugin settings so
 *   it survives restarts. On first load, it falls back to the user's
 *   default board from the API.
 * - Board list is fetched lazily on first access and cached upstream
 *   in the board API module.
 *
 * v2 fix: notifyListeners() is now called when isLoading changes,
 * so the BoardSelector trigger can show/hide the loading spinner.
 */
export class BoardContext {
  private currentBoard: Board | null = null;
  private boards: Board[] = [];
  private listeners: Set<boardchangelistener> = new Set();
  private isLoading = false;
  private error: string | null = null;

  constructor(
    private apiKey: string,
    private persistBoardId: (boardId: string) => void,
    private loadPersistedBoardId: () => string | null
  ) {}

  // ============================================================
  // Initialization
  // ============================================================

  /**
   * Initialize the board context on plugin load.
   *
   * Resolution order:
   * 1. Persisted boardId from settings → verify it still exists
   * 2. User's default board from API
   * 3. First board in the list
   * 4. null (no boards — edge case for brand-new accounts)
   */
  async initialize(): Promise<void> {
    this.setLoading(true);
    this.error = null;

    try {
      // Fetch board list (cached after first call)
      this.boards = await listBoards(this.apiKey);

      // Try to restore persisted board
      const persistedId = this.loadPersistedBoardId();
      if (persistedId) {
        const found = this.boards.find((b) => b.id === persistedId);
        if (found) {
          this.setBoard(found, false); // don't re-persist what we just loaded
          return;
        }
      }

      // Fall back to default board
      try {
        const defaultBoard = await getDefaultBoard(this.apiKey);
        this.setBoard(defaultBoard);
        return;
      } catch {
        // Default board endpoint failed — use first board in list
      }

      // Last resort: first board
      if (this.boards.length > 0) {
        this.setBoard(this.boards[0]);
      } else {
        this.setBoard(null);
      }
    } catch (err: any) {
      this.error = err.message ?? 'Failed to load boards';
      this.setBoard(null);
      console.error('[YouMind] BoardContext initialization failed:', err);
    } finally {
      this.setLoading(false);
    }
  }

  // ============================================================
  // State accessors
  // ============================================================

  /** Currently active board (may be null if no boards exist). */
  getBoard(): Board | null {
    return this.currentBoard;
  }

  /** Currently active board ID, or undefined. */
  getBoardId(): string | undefined {
    return this.currentBoard?.id;
  }

  /** All boards available to the user. */
  getBoards(): Board[] {
    return this.boards;
  }

  /** Whether the initial load or refresh is still in progress. */
  getIsLoading(): boolean {
    return this.isLoading;
  }

  /** Last error message, or null. */
  getError(): string | null {
    return this.error;
  }

  // ============================================================
  // State mutations
  // ============================================================

  /**
   * Switch to a different board.
   *
   * This is the ONLY way to change the active board. It:
   * 1. Updates internal state
   * 2. Persists the choice to settings
   * 3. Notifies all listeners (chat panel rebinds boardId, browser reloads, etc.)
   */
  setBoard(board: Board | null, persist = true): void {
    const prev = this.currentBoard;
    this.currentBoard = board;

    if (board && persist) {
      this.persistBoardId(board.id);
    }

    // Only notify if the board actually changed
    if (prev?.id !== board?.id) {
      this.notifyListeners();
    }
  }

  /**
   * Update loading state and notify listeners.
   *
   * v2 fix: This ensures the BoardSelector trigger re-renders
   * when loading starts/ends, showing the spinner correctly.
   */
  private setLoading(loading: boolean): void {
    if (this.isLoading !== loading) {
      this.isLoading = loading;
      this.notifyListeners();
    }
  }

  /**
   * Refresh the board list from API (bypasses cache).
   * Useful after creating a new board or when the user pulls to refresh.
   */
  async refresh(): Promise<void> {
    this.setLoading(true);
    this.error = null;

    try {
      invalidateBoardCache();
      this.boards = await listBoards(this.apiKey, true);

      // If current board was deleted, fall back
      if (
        this.currentBoard &&
        !this.boards.find((b) => b.id === this.currentBoard!.id)
      ) {
        const fallback = this.boards.length > 0 ? this.boards[0] : null;
        this.setBoard(fallback);
      } else {
        // Board list changed but current board still exists — notify anyway
        // so the dropdown can update its list
        this.notifyListeners();
      }
    } catch (err: any) {
      this.error = err.message ?? 'Failed to refresh boards';
      console.error('[YouMind] Board refresh failed:', err);
    } finally {
      this.setLoading(false);
    }
  }

  // ============================================================
  // Pub/Sub
  // ============================================================

  /**
   * Subscribe to board changes. Returns an unsubscribe function.
   *
   * Listeners are called when:
   * - The active board changes (setBoard)
   * - Loading state changes (setLoading)
   * - Board list is refreshed
   *
   * Usage:
   * ```typescript
   * const unsub = boardContext.onChange((board) => {
   *   console.log('Board changed to:', board?.name);
   * });
   * // Later, in cleanup:
   * unsub();
   * ```
   */
  onChange(listener: BoardChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.currentBoard);
      } catch (err) {
        console.error('[YouMind] Board change listener error:', err);
      }
    }
  }

  // ============================================================
  // Cleanup
  // ============================================================

  /** Remove all listeners. Call on plugin unload. */
  destroy(): void {
    this.listeners.clear();
    this.currentBoard = null;
    this.boards = [];
  }
}
</void></void></boardchangelistener>
```

---

## 与 v1 的关键差异

| 项目 | v1 | v2 |
| --- | --- | --- |
| `isLoading` 变化通知 | ❌ 不通知 listeners | ✅ 通过 `setLoading()` 自动通知 |
| `initialize()` 中 | 直接赋值 `this.isLoading = true` | 调用 `this.setLoading(true)` 触发通知 |
| `refresh()` 中 | 直接赋值 `this.isLoading = true/false` | 调用 `this.setLoading()` 触发通知 |
| `refresh()` 成功后 | 仅在 board 被删除时通知 | 总是通知（board list 可能变化） |
| JSDoc 注释 | 使用 `/*` （被 markdown 吞掉） | 使用 `/**` 标准 JSDoc |

## 设计说明

**单例模式**：BoardContext 在 `main.ts` 中实例化一次，作为插件级别的单例传递给所有需要 board 信息的组件。这避免了多个组件各自维护 board 状态导致的不一致问题。

**持久化策略**：通过构造函数注入 `persistBoardId` 和 `loadPersistedBoardId` 两个回调，将持久化逻辑与 Obsidian 的 `plugin.saveData()` / `plugin.loadData()` 解耦。这样 BoardContext 本身不依赖 Obsidian API，方便单元测试。

**初始化降级链**：`initialize()` 按照 persisted → default → first → null 的优先级逐步降级，确保在任何情况下都能给出一个合理的初始 board（或明确的 null 状态）。

**Pub/Sub 模式**：`onChange()` 返回 unsubscribe 函数，遵循 Obsidian 插件的生命周期管理惯例——组件在 `onClose()` 或 `unload()` 时调用 unsub 即可，不会造成内存泄漏。

**Loading 状态通知**（v2 新增）：`setLoading()` 私有方法确保 `isLoading` 变化时自动通知所有 listeners。这解决了 v1 中 BoardSelector trigger 无法在 loading 开始/结束时重新渲染的问题。

