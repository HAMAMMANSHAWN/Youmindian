# features/board/board-selector.ts — Board 选择器组件


> 文件路径：`src/features/board/board-selector.ts`

```typescript
import { setIcon } from 'obsidian';
import type { Board } from '../../core/api/types';
import type { BoardContext } from './board-context';

/**
 * BoardSelector — dropdown component for the chat panel header.
 *
 * Visual structure:
 * ┌──────────────────────────────────┐
 * │ [icon] Board Name          [▼]  │  ← Trigger button
 * └──────────────────────────────────┘
 *        │
 *        ▼ (click to open)
 * ┌──────────────────────────────────┐
 * │ 🔍 Search boards...        [↻]  │  ← Search + refresh
 * ├──────────────────────────────────┤
 * │  ● Board Alpha                   │  ← Active (highlighted)
 * │    Board Beta                    │
 * │    Board Gamma                   │
 * │    ...                           │  ← Scrollable list
 * └──────────────────────────────────┘
 *
 * Key behaviors:
 * - Click trigger → toggle dropdown
 * - Type in search → client-side filter (instant, no debounce needed)
 * - Click board item → setBoard() + close dropdown
 * - Click refresh → boardContext.refresh() + rebuild list
 * - Click outside or press Escape → close dropdown
 * - Keyboard navigation: ↑/↓ to move, Enter to select, Escape to close
 */
export class BoardSelector {
  private containerEl: HTMLElement;
  private triggerEl: HTMLElement;
  private dropdownEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private listEl: HTMLElement | null = null;
  private isOpen = false;
  private filteredBoards: Board[] = [];
  private highlightIndex = -1;
  private unsubscribeBoardChange: (() => void) | null = null;

  // Bound handlers (for clean removal)
  private boundOnClickOutside: (e: MouseEvent) => void;
  private boundOnKeydown: (e: KeyboardEvent) => void;

  constructor(
    private parentEl: HTMLElement,
    private boardContext: BoardContext
  ) {
    this.boundOnClickOutside = this.onClickOutside.bind(this);
    this.boundOnKeydown = this.onKeydown.bind(this);

    // Build the trigger button
    this.containerEl = parentEl.createDiv({
      cls: 'ym-board-selector',
    });

    this.triggerEl = this.containerEl.createDiv({
      cls: 'ym-board-selector-trigger',
    });
    this.triggerEl.addEventListener('click', () => this.toggle());

    this.renderTrigger();

    // Subscribe to board changes from other sources
    this.unsubscribeBoardChange = this.boardContext.onChange(() => {
      this.renderTrigger();
    });
  }

  // ============================================================
  // Trigger button rendering
  // ============================================================

  private renderTrigger(): void {
    this.triggerEl.empty();

    const board = this.boardContext.getBoard();
    const isLoading = this.boardContext.getIsLoading();

    // Board icon
    const iconEl = this.triggerEl.createSpan({
      cls: 'ym-board-selector-icon',
    });

    if (isLoading) {
      setIcon(iconEl, 'loader-2');
      iconEl.addClass('ym-spin');
    } else {
      setIcon(iconEl, 'layout-dashboard');
    }

    // Board name
    const nameEl = this.triggerEl.createSpan({
      cls: 'ym-board-selector-name',
    });

    if (isLoading) {
      nameEl.setText('Loading...');
    } else if (board) {
      nameEl.setText(board.name);
      nameEl.setAttribute('title', board.name);
    } else {
      nameEl.setText('No board');
      nameEl.addClass('ym-text-muted');
    }

    // Chevron
    const chevronEl = this.triggerEl.createSpan({
      cls: 'ym-board-selector-chevron',
    });
    setIcon(chevronEl, this.isOpen ? 'chevron-up' : 'chevron-down');
  }

  // ============================================================
  // Dropdown lifecycle
  // ============================================================

  toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;

    this.renderTrigger(); // Update chevron direction

    // Build dropdown
    this.dropdownEl = this.containerEl.createDiv({
      cls: 'ym-board-dropdown',
    });

    // Search row
    const searchRow = this.dropdownEl.createDiv({
      cls: 'ym-board-dropdown-search',
    });

    const searchIconEl = searchRow.createSpan({
      cls: 'ym-board-dropdown-search-icon',
    });
    setIcon(searchIconEl, 'search');

    this.searchInputEl = searchRow.createEl('input', {
      cls: 'ym-board-dropdown-search-input',
      attr: {
        type: 'text',
        placeholder: 'Search boards...',
        spellcheck: 'false',
      },
    });
    this.searchInputEl.addEventListener('input', () => {
      this.onSearchInput();
    });

    // Refresh button
    const refreshBtn = searchRow.createDiv({
      cls: 'ym-board-dropdown-refresh clickable-icon',
      attr: { 'aria-label': 'Refresh board list' },
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.onRefresh(refreshBtn);
    });

    // Board list container
    this.listEl = this.dropdownEl.createDiv({
      cls: 'ym-board-dropdown-list',
    });

    // Populate list — handle loading state (v2 fix)
    if (this.boardContext.getIsLoading()) {
      this.renderLoading();
    } else {
      this.filteredBoards = this.boardContext.getBoards();
      this.highlightIndex = -1;
      this.renderList();
    }

    // Focus search input
    setTimeout(() => this.searchInputEl?.focus(), 0);

    // Global listeners
    document.addEventListener('click', this.boundOnClickOutside, true);
    document.addEventListener('keydown', this.boundOnKeydown, true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;

    this.dropdownEl?.remove();
    this.dropdownEl = null;
    this.searchInputEl = null;
    this.listEl = null;

    this.renderTrigger(); // Update chevron direction

    // Remove global listeners
    document.removeEventListener('click', this.boundOnClickOutside, true);
    document.removeEventListener('keydown', this.boundOnKeydown, true);
  }

  // ============================================================
  // Board list rendering
  // ============================================================

  /**
   * v2 fix: Show a loading indicator when boards are still being fetched.
   * This prevents the user from seeing "No boards found" during initial load.
   */
  private renderLoading(): void {
    if (!this.listEl) return;
    this.listEl.empty();

    const loadingEl = this.listEl.createDiv({
      cls: 'ym-board-dropdown-empty',
    });
    const spinnerEl = loadingEl.createSpan({ cls: 'ym-spin' });
    setIcon(spinnerEl, 'loader-2');
    loadingEl.createSpan().setText(' Loading boards...');
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();

    const currentBoardId = this.boardContext.getBoardId();
    const error = this.boardContext.getError();

    // Error state
    if (error) {
      const errorEl = this.listEl.createDiv({
        cls: 'ym-board-dropdown-error',
      });
      errorEl.setText(error);
      return;
    }

    // Empty state
    if (this.filteredBoards.length === 0) {
      const emptyEl = this.listEl.createDiv({
        cls: 'ym-board-dropdown-empty',
      });
      emptyEl.setText(
        this.searchInputEl?.value
          ? 'No boards match your search'
          : 'No boards found'
      );
      return;
    }

    // Board items
    this.filteredBoards.forEach((board, index) => {
      const itemEl = this.listEl!.createDiv({
        cls: 'ym-board-dropdown-item',
      });

      const isActive = board.id === currentBoardId;
      if (isActive) {
        itemEl.addClass('is-active');
      }
      if (index === this.highlightIndex) {
        itemEl.addClass('is-highlighted');
      }

      // Active indicator
      const indicatorEl = itemEl.createSpan({
        cls: 'ym-board-dropdown-item-indicator',
      });
      if (isActive) {
        setIcon(indicatorEl, 'check');
      }

      // Board icon
      const iconEl = itemEl.createSpan({
        cls: 'ym-board-dropdown-item-icon',
      });
      setIcon(iconEl, 'layout-dashboard');

      // Board name
      const nameEl = itemEl.createSpan({
        cls: 'ym-board-dropdown-item-name',
      });
      nameEl.setText(board.name);

      // Default badge
      if (board.isDefault) {
        const badgeEl = itemEl.createSpan({
          cls: 'ym-board-dropdown-item-badge',
        });
        badgeEl.setText('Default');
      }

      // Click handler
      itemEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectBoard(board);
      });

      // Hover → update highlight
      itemEl.addEventListener('mouseenter', () => {
        this.highlightIndex = index;
        this.updateHighlight();
      });
    });
  }

  private updateHighlight(): void {
    if (!this.listEl) return;
    const items = this.listEl.querySelectorAll('.ym-board-dropdown-item');
    items.forEach((item, i) => {
      item.toggleClass('is-highlighted', i === this.highlightIndex);
    });
  }

  private scrollHighlightIntoView(): void {
    if (!this.listEl) return;
    const items = this.listEl.querySelectorAll('.ym-board-dropdown-item');
    if (this.highlightIndex >= 0 && this.highlightIndex < items.length) {
      items[this.highlightIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  // ============================================================
  // Interactions
  // ============================================================

  private selectBoard(board: Board): void {
    this.boardContext.setBoard(board);
    this.close();
  }

  private onSearchInput(): void {
    const query = this.searchInputEl?.value ?? '';
    const allBoards = this.boardContext.getBoards();

    if (!query.trim()) {
      this.filteredBoards = allBoards;
    } else {
      const lower = query.toLowerCase().trim();
      this.filteredBoards = allBoards.filter(
        (b) =>
          b.name.toLowerCase().includes(lower) ||
          b.description?.toLowerCase().includes(lower)
      );
    }

    this.highlightIndex = -1;
    this.renderList();
  }

  private async onRefresh(buttonEl: HTMLElement): Promise<void> {
    // Spin animation
    buttonEl.addClass('ym-spin');

    try {
      await this.boardContext.refresh();
      this.filteredBoards = this.boardContext.getBoards();

      // Re-apply search filter if active
      if (this.searchInputEl?.value) {
        this.onSearchInput();
      } else {
        this.renderList();
      }
    } finally {
      buttonEl.removeClass('ym-spin');
    }
  }

  private onClickOutside(e: MouseEvent): void {
    if (!this.containerEl.contains(e.target as Node)) {
      this.close();
    }
  }

  private onKeydown(e: KeyboardEvent): void {
    if (!this.isOpen) return;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.close();
        break;

      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        this.highlightIndex = Math.min(
          this.highlightIndex + 1,
          this.filteredBoards.length - 1
        );
        this.updateHighlight();
        this.scrollHighlightIntoView();
        break;

      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        this.highlightIndex = Math.max(this.highlightIndex - 1, 0);
        this.updateHighlight();
        this.scrollHighlightIntoView();
        break;

      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        if (
          this.highlightIndex >= 0 &&
          this.highlightIndex < this.filteredBoards.length
        ) {
          this.selectBoard(this.filteredBoards[this.highlightIndex]);
        }
        break;
    }
  }

  // ============================================================
  // Cleanup
  // ============================================================

  destroy(): void {
    this.close();
    this.unsubscribeBoardChange?.();
    this.containerEl.remove();
  }
}
</void>
```

---

## 设计说明

**Obsidian 原生风格**：整个组件不使用任何第三方 UI 框架，完全基于 Obsidian 的 DOM API（`createDiv`、`createEl`、`createSpan`）和 `setIcon()` 构建。所有样式类名以 `ym-` 为前缀避免与 Obsidian 内置样式冲突，同时通过 CSS 变量确保在 light/dark 主题下都能正常工作。

**键盘导航**：完整支持 ↑/↓ 箭头移动高亮、Enter 选择、Escape 关闭。高亮项自动滚动到可视区域。这对于键盘优先的 Obsidian 用户体验至关重要。

**搜索过滤**：在客户端即时过滤，无需 debounce（board 数量通常 <50，DOM 更新成本极低）。搜索同时匹配 `name` 和 `description`。

**内存安全**：`destroy()` 方法清理所有事件监听器和 DOM 引用。`close()` 移除全局的 click/keydown 监听器。`onChange` 订阅在 destroy 时取消。不会造成内存泄漏。

**刷新机制**：点击刷新按钮时，按钮图标旋转（`ym-spin` CSS 动画），调用 `boardContext.refresh()` 绕过缓存重新拉取 board 列表，然后重新渲染（保留当前搜索过滤条件）。