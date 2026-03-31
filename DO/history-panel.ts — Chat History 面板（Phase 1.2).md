# features/chat/history-panel.ts — Chat History 面板（Phase 1.2）


> 文件路径：`src/features/chat/history-panel.ts`
>
> **Phase 1.2 新增**：Chat History 侧滑面板，显示当前 Board 的对话列表，支持搜索、恢复、删除。

```typescript
import { setIcon } from 'obsidian';
import type { Chat } from '../../core/api/types';
import type { BoardContext } from '../board/board-context';

/**
 * HistoryPanel — slide-in panel for browsing and resuming past conversations.
 *
 * Design rationale (referencing Claudian + YouMind):
 * - Claudian: history is a dropdown from a header button, inline rename, delete.
 * - YouMind web: history is a sidebar list, grouped by time.
 * - Our approach: slide-in overlay panel (triggered by existing history button),
 *   board-scoped, with search, infinite scroll, and time grouping.
 *
 * Visual structure:
 *
 * ┌──────────────────────────────────┐
 * │ Conversations           [✕]     │  ← Panel header + close button
 * ├──────────────────────────────────┤
 * │ 🔍 Search conversations...      │  ← Search input
 * ├──────────────────────────────────┤
 * │ Today                            │  ← Time group header
 * │ ┌──────────────────────────────┐ │
 * │ │ ● Chat about AI research    │ │  ← Active chat (highlighted)
 * │ │   10:30                      │ │
 * │ └──────────────────────────────┘ │
 * │ ┌──────────────────────────────┐ │
 * │ │   Plugin architecture plan   │ │
 * │ │   09:15            [🗑]      │ │  ← Delete on hover
 * │ └──────────────────────────────┘ │
 * │                                  │
 * │ Yesterday                        │
 * │ ┌──────────────────────────────┐ │
 * │ │   Board selector design      │ │
 * │ │   Mar 30            [🗑]     │ │
 * │ └──────────────────────────────┘ │
 * │                                  │
 * │ ┌──────────────────────────────┐ │
 * │ │     Loading more...          │ │  ← Infinite scroll trigger
 * │ └──────────────────────────────┘ │
 * └──────────────────────────────────┘
 *
 * Key behaviors:
 * - Opens as overlay on left side of chat view (slide-in animation)
 * - Scoped to current board (auto-refreshes when board changes)
 * - Click chat item → fire onSelectChat callback → close panel
 * - Click delete → confirm → fire onDeleteChat callback → remove from list
 * - Search filters by title (client-side, instant)
 * - Infinite scroll: loads next page when scrolled to bottom
 * - Escape or click outside → close panel
 * - Current active chat is highlighted with accent color
 */

// ============================================================
// Types
// ============================================================

export interface HistoryPanelCallbacks {
  /** Called when user selects a chat to resume. */
  onSelectChat: (chatId: string) => Promise<void>;
  /** Called when user creates a new chat (from panel). */
  onNewChat: () => Promise<void>;
  /** Fetch chats from API. Panel doesn't call API directly. */
  fetchChats: (boardId: string, page: number, pageSize: number) => Promise<{
    data: Chat[];
    total: number;
    page: number;
    pageSize: number;
  }>;
}

interface TimeGroup {
  label: string;
  chats: Chat[];
}

// ============================================================
// Component
// ============================================================

export class HistoryPanel {
  private panelEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private isOpen = false;

  // Data
  private allChats: Chat[] = [];
  private filteredChats: Chat[] = [];
  private currentPage = 0;
  private totalChats = 0;
  private isLoadingMore = false;
  private activeChatId: string | null = null;

  // Board context subscription
  private unsubBoardChange: (() => void) | null = null;

  // Bound handlers
  private boundOnClickOutside: (e: MouseEvent) => void;
  private boundOnKeydown: (e: KeyboardEvent) => void;
  private boundOnScroll: () => void;

  private static readonly PAGE_SIZE = 20;

  constructor(
    private containerEl: HTMLElement,
    private boardContext: BoardContext,
    private callbacks: HistoryPanelCallbacks
  ) {
    this.boundOnClickOutside = this.onClickOutside.bind(this);
    this.boundOnKeydown = this.onKeydown.bind(this);
    this.boundOnScroll = this.onScroll.bind(this);

    // Subscribe to board changes — refresh chat list when board switches
    this.unsubBoardChange = this.boardContext.onChange(() => {
      if (this.isOpen) {
        this.resetAndLoad();
      }
    });
  }

  // ============================================================
  // Panel lifecycle
  // ============================================================

  /** Set the currently active chat ID (for highlighting). */
  setActiveChatId(chatId: string | null): void {
    this.activeChatId = chatId;
    if (this.isOpen) {
      this.renderList();
    }
  }

  async open(): Promise<void> {
    if (this.isOpen) return;
    this.isOpen = true;

    // Build panel
    this.panelEl = this.containerEl.createDiv({
      cls: 'ym-history-panel',
    });

    // Backdrop (for click-outside-to-close)
    const backdropEl = this.containerEl.createDiv({
      cls: 'ym-history-backdrop',
    });
    backdropEl.addEventListener('click', () => this.close());

    // Panel header
    const headerEl = this.panelEl.createDiv({
      cls: 'ym-history-header',
    });

    headerEl.createSpan({
      cls: 'ym-history-title',
      text: 'Conversations',
    });

    const closeBtn = headerEl.createDiv({
      cls: 'ym-history-close clickable-icon',
      attr: { 'aria-label': 'Close history' },
    });
    setIcon(closeBtn, 'x');
    closeBtn.addEventListener('click', () => this.close());

    // Search row
    const searchRow = this.panelEl.createDiv({
      cls: 'ym-history-search',
    });

    const searchIconEl = searchRow.createSpan({
      cls: 'ym-history-search-icon',
    });
    setIcon(searchIconEl, 'search');

    this.searchInputEl = searchRow.createEl('input', {
      cls: 'ym-history-search-input',
      attr: {
        type: 'text',
        placeholder: 'Search conversations...',
        spellcheck: 'false',
      },
    });
    this.searchInputEl.addEventListener('input', () => {
      this.onSearchInput();
    });

    // New chat button (inside panel)
    const newChatBtn = searchRow.createDiv({
      cls: 'ym-history-new-chat clickable-icon',
      attr: { 'aria-label': 'New conversation' },
    });
    setIcon(newChatBtn, 'square-pen');
    newChatBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.callbacks.onNewChat();
      this.close();
    });

    // Chat list container
    this.listEl = this.panelEl.createDiv({
      cls: 'ym-history-list',
    });
    this.listEl.addEventListener('scroll', this.boundOnScroll);

    // Global listeners
    document.addEventListener('keydown', this.boundOnKeydown, true);

    // Trigger slide-in animation
    requestAnimationFrame(() => {
      this.panelEl?.addClass('is-open');
      backdropEl.addClass('is-open');
    });

    // Load chats
    await this.resetAndLoad();

    // Focus search
    setTimeout(() => this.searchInputEl?.focus(), 200);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;

    // Trigger slide-out animation
    this.panelEl?.removeClass('is-open');
    const backdrop = this.containerEl.querySelector('.ym-history-backdrop');
    backdrop?.removeClass('is-open');

    // Remove after animation
    setTimeout(() => {
      this.panelEl?.remove();
      this.panelEl = null;
      backdrop?.remove();
      this.listEl = null;
      this.searchInputEl = null;
    }, 200);

    // Remove global listeners
    document.removeEventListener('keydown', this.boundOnKeydown, true);
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  // ============================================================
  // Data loading
  // ============================================================

  private async resetAndLoad(): Promise<void> {
    this.allChats = [];
    this.filteredChats = [];
    this.currentPage = 0;
    this.totalChats = 0;
    this.isLoadingMore = false;

    if (this.searchInputEl) {
      this.searchInputEl.value = '';
    }

    await this.loadPage(0);
  }

  private async loadPage(page: number): Promise<void> {
    const boardId = this.boardContext.getBoardId();
    if (!boardId) {
      this.renderEmpty('Select a board to see conversations');
      return;
    }

    if (page === 0) {
      this.renderLoading();
    }

    this.isLoadingMore = true;

    try {
      const result = await this.callbacks.fetchChats(
        boardId,
        page,
        HistoryPanel.PAGE_SIZE
      );

      if (page === 0) {
        this.allChats = result.data;
      } else {
        this.allChats = [...this.allChats, ...result.data];
      }

      this.totalChats = result.total;
      this.currentPage = page;

      // Apply search filter
      this.applyFilter();
      this.renderList();
    } catch (err: any) {
      if (page === 0) {
        this.renderError(err.message ?? 'Failed to load conversations');
      }
    } finally {
      this.isLoadingMore = false;
    }
  }

  private get hasMorePages(): boolean {
    return this.allChats.length < this.totalChats;
  }

  // ============================================================
  // Search & filter
  // ============================================================

  private onSearchInput(): void {
    this.applyFilter();
    this.renderList();
  }

  private applyFilter(): void {
    const query = this.searchInputEl?.value?.toLowerCase().trim() ?? '';
    if (!query) {
      this.filteredChats = this.allChats;
    } else {
      this.filteredChats = this.allChats.filter((chat) =>
        chat.title.toLowerCase().includes(query)
      );
    }
  }

  // ============================================================
  // Rendering
  // ============================================================

  private renderLoading(): void {
    if (!this.listEl) return;
    this.listEl.empty();

    const loadingEl = this.listEl.createDiv({
      cls: 'ym-history-empty',
    });
    const spinnerEl = loadingEl.createSpan({ cls: 'ym-spin' });
    setIcon(spinnerEl, 'loader-2');
    loadingEl.createSpan().setText(' Loading conversations...');
  }

  private renderEmpty(message: string): void {
    if (!this.listEl) return;
    this.listEl.empty();

    this.listEl.createDiv({
      cls: 'ym-history-empty',
      text: message,
    });
  }

  private renderError(message: string): void {
    if (!this.listEl) return;
    this.listEl.empty();

    this.listEl.createDiv({
      cls: 'ym-history-error',
      text: message,
    });
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();

    if (this.filteredChats.length === 0) {
      const message = this.searchInputEl?.value
        ? 'No conversations match your search'
        : 'No conversations yet';
      this.renderEmpty(message);
      return;
    }

    // Group by time
    const groups = this.groupByTime(this.filteredChats);

    for (const group of groups) {
      // Group header
      this.listEl.createDiv({
        cls: 'ym-history-group-header',
        text: group.label,
      });

      // Chat items
      for (const chat of group.chats) {
        this.renderChatItem(chat);
      }
    }

    // "Load more" indicator
    if (this.hasMorePages && !this.searchInputEl?.value) {
      const loadMoreEl = this.listEl.createDiv({
        cls: 'ym-history-load-more',
      });
      const spinnerEl = loadMoreEl.createSpan({ cls: 'ym-spin' });
      setIcon(spinnerEl, 'loader-2');
      loadMoreEl.createSpan().setText(' Loading more...');
    }
  }

  private renderChatItem(chat: Chat): void {
    if (!this.listEl) return;

    const isActive = chat.id === this.activeChatId;

    const itemEl = this.listEl.createDiv({
      cls: `ym-history-item${isActive ? ' is-active' : ''}`,
    });

    // Icon
    const iconEl = itemEl.createDiv({
      cls: 'ym-history-item-icon',
    });
    setIcon(iconEl, isActive ? 'message-square-dot' : 'message-square');

    // Content
    const contentEl = itemEl.createDiv({
      cls: 'ym-history-item-content',
    });

    const titleEl = contentEl.createDiv({
      cls: 'ym-history-item-title',
    });
    titleEl.setText(chat.title || 'Untitled');
    titleEl.setAttribute('title', chat.title || 'Untitled');

    const metaEl = contentEl.createDiv({
      cls: 'ym-history-item-meta',
    });

    // Time
    metaEl.createSpan({
      cls: 'ym-history-item-time',
      text: isActive ? 'Current' : this.formatDate(chat.updatedAt),
    });

    // Status indicator
    if (chat.status === 'answering' || chat.status === 'thinking') {
      const statusEl = metaEl.createSpan({
        cls: 'ym-history-item-status',
      });
      const statusSpinner = statusEl.createSpan({ cls: 'ym-spin' });
      setIcon(statusSpinner, 'loader-2');
    }

    // Unread badge
    if (chat.hasUnread && !isActive) {
      metaEl.createSpan({
        cls: 'ym-history-item-unread',
      });
    }

    // Actions (visible on hover)
    const actionsEl = itemEl.createDiv({
      cls: 'ym-history-item-actions',
    });

    const deleteBtn = actionsEl.createDiv({
      cls: 'ym-history-item-delete clickable-icon',
      attr: { 'aria-label': 'Delete conversation' },
    });
    setIcon(deleteBtn, 'trash-2');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onDeleteChat(chat);
    });

    // Click to select
    if (!isActive) {
      itemEl.addEventListener('click', async () => {
        try {
          await this.callbacks.onSelectChat(chat.id);
          this.close();
        } catch {
          // Error handled by callback
        }
      });
      itemEl.addClass('is-clickable');
    }
  }

  // ============================================================
  // Time grouping
  // ============================================================

  private groupByTime(chats: Chat[]): TimeGroup[] {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const lastWeek = new Date(today.getTime() - 7 * 86400000);
    const lastMonth = new Date(today.getTime() - 30 * 86400000);

    const groups: Map<string, chat[]=""> = new Map();

    for (const chat of chats) {
      const date = new Date(chat.updatedAt);
      let label: string;

      if (date >= today) {
        label = 'Today';
      } else if (date >= yesterday) {
        label = 'Yesterday';
      } else if (date >= lastWeek) {
        label = 'This week';
      } else if (date >= lastMonth) {
        label = 'This month';
      } else {
        label = 'Older';
      }

      if (!groups.has(label)) {
        groups.set(label, []);
      }
      groups.get(label)!.push(chat);
    }

    // Maintain order: Today → Yesterday → This week → This month → Older
    const order = ['Today', 'Yesterday', 'This week', 'This month', 'Older'];
    return order
      .filter((label) => groups.has(label))
      .map((label) => ({ label, chats: groups.get(label)! }));
  }

  // ============================================================
  // Interactions
  // ============================================================

  private onDeleteChat(chat: Chat): void {
    // Remove from local list immediately (optimistic)
    this.allChats = this.allChats.filter((c) => c.id !== chat.id);
    this.totalChats = Math.max(0, this.totalChats - 1);
    this.applyFilter();
    this.renderList();

    // TODO: Call API to delete chat (Phase 1.2+)
    // For now, only remove from UI. Server-side deletion can be added
    // when the deleteChat API endpoint is confirmed.
  }

  private onClickOutside(e: MouseEvent): void {
    if (this.panelEl && !this.panelEl.contains(e.target as Node)) {
      this.close();
    }
  }

  private onKeydown(e: KeyboardEvent): void {
    if (!this.isOpen) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  }

  private onScroll(): void {
    if (!this.listEl || this.isLoadingMore || !this.hasMorePages) return;
    if (this.searchInputEl?.value) return; // Don't load more during search

    const { scrollTop, scrollHeight, clientHeight } = this.listEl;
    const threshold = 100; // px from bottom

    if (scrollTop + clientHeight >= scrollHeight - threshold) {
      this.loadPage(this.currentPage + 1);
    }
  }

  // ============================================================
  // Utilities
  // ============================================================

  private formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();

    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }

    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }

  // ============================================================
  // Cleanup
  // ============================================================

  destroy(): void {
    this.close();
    this.unsubBoardChange?.();
    this.unsubBoardChange = null;
  }
}
</string,></void></void></void></void></void>
```

---

## 设计说明

**侧滑面板 vs Dropdown**：Claudian 用 header 内的 dropdown 显示 history。我们选择侧滑面板（slide-in overlay），原因是：(1) 对话列表可能很长（几十到上百条），dropdown 的 max-height 限制不够；(2) 侧滑面板有更大的空间展示时间分组和搜索；(3) 与 YouMind 网页端的侧边栏 history 更一致。

**Board 联动**：面板订阅 `boardContext.onChange()`，当用户切换 Board 时自动重新加载对话列表。这是 Phase 1.1 Board Selector 和 Phase 1.2 History 的核心联动点。

**时间分组**：对话按 `updatedAt` 分为 Today / Yesterday / This week / This month / Older 五个组。参考 Claudian 的 `formatDate()` 方法，但增加了分组 header 以提升可扫描性。

**Infinite Scroll**：初始加载 20 条，滚动到底部 100px 范围内自动加载下一页。搜索时禁用 infinite scroll（因为搜索是客户端过滤已加载的数据）。

**乐观删除**：点击删除后立即从 UI 移除（不等 API 响应），提升交互流畅度。API 删除端点待确认后补充。

**回调模式**：面板不直接调用 API，而是通过 `HistoryPanelCallbacks` 回调。这使得面板可以被 chat-view.ts 控制，保持单向数据流。