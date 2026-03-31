# style/history.css — Chat History 面板样式（Phase 1.2）


> 文件路径：`src/style/history.css`
>
> Phase 1.2 新增：Chat History 侧滑面板的全部样式。与 `board.css` 同级，遵循相同的设计原则——100% Obsidian CSS 变量，零硬编码颜色。

```css
/* ============================================================
   History Panel — Backdrop Overlay
   ============================================================
   Semi-transparent backdrop behind the slide-in panel.
   Click to close (handled in JS).
   ============================================================ */

.ym-history-backdrop {
  position: absolute;
  inset: 0;
  z-index: var(--layer-popover, 100);
  background-color: rgba(0, 0, 0, 0);
  transition: background-color 0.2s ease;
  pointer-events: none;
}

.ym-history-backdrop.is-open {
  background-color: rgba(0, 0, 0, 0.3);
  pointer-events: auto;
}

.theme-dark .ym-history-backdrop.is-open {
  background-color: rgba(0, 0, 0, 0.5);
}

/* ============================================================
   History Panel — Container (Slide-in)
   ============================================================
   Slides in from the left edge of the chat view container.
   Width is fixed at 300px — wide enough for long titles,
   narrow enough to leave the chat area visible behind.
   ============================================================ */

.ym-history-panel {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: calc(var(--layer-popover, 100) + 1);
  width: 300px;
  max-width: 80%;
  display: flex;
  flex-direction: column;
  background-color: var(--background-primary);
  border-right: 1px solid var(--background-modifier-border);
  box-shadow: 2px 0 12px rgba(0, 0, 0, 0.1);
  transform: translateX(-100%);
  transition: transform 0.2s ease;
}

.ym-history-panel.is-open {
  transform: translateX(0);
}

.theme-dark .ym-history-panel {
  box-shadow: 2px 0 12px rgba(0, 0, 0, 0.3);
}

/* ============================================================
   Panel Header
   ============================================================
   "Conversations" title + close button.
   Matches the height and feel of .ym-chat-header.
   ============================================================ */

.ym-history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 8px 14px;
  flex-shrink: 0;
}

.ym-history-title {
  font-size: var(--font-ui-medium);
  font-family: var(--font-interface);
  font-weight: 600;
  color: var(--text-normal);
  line-height: 1.4;
}

.ym-history-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-s);
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.ym-history-close:hover {
  color: var(--text-normal);
  background-color: var(--background-modifier-hover);
}

.ym-history-close svg {
  width: 16px;
  height: 16px;
}

/* ============================================================
   Search Row
   ============================================================
   Search icon + input + new-chat button, in a single row
   below the header. Mirrors board.css search row pattern.
   ============================================================ */

.ym-history-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 8px 10px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--background-modifier-border);
}

.ym-history-search-icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--text-faint);
}

.ym-history-search-icon svg {
  width: 14px;
  height: 14px;
}

.ym-history-search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--font-ui-small);
  font-family: var(--font-interface);
  color: var(--text-normal);
  padding: 4px 0;
  line-height: 1.4;
}

.ym-history-search-input::placeholder {
  color: var(--text-faint);
}

.ym-history-new-chat {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-s);
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.ym-history-new-chat:hover {
  color: var(--text-accent);
  background-color: var(--background-modifier-hover);
}

.ym-history-new-chat svg {
  width: 16px;
  height: 16px;
}

/* ============================================================
   Chat List — Scrollable Container
   ============================================================ */

.ym-history-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

/* Thin scrollbar — same pattern as board.css */
.ym-history-list::-webkit-scrollbar {
  width: 4px;
}

.ym-history-list::-webkit-scrollbar-track {
  background: transparent;
}

.ym-history-list::-webkit-scrollbar-thumb {
  background-color: var(--background-modifier-border);
  border-radius: 4px;
}

/* ============================================================
   Time Group Header
   ============================================================
   "Today", "Yesterday", "This week", etc.
   Sticky within the scroll container for orientation.
   ============================================================ */

.ym-history-group-header {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 14px 4px;
  font-size: var(--font-ui-smaller);
  font-family: var(--font-interface);
  font-weight: 600;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background-color: var(--background-primary);
  line-height: 1.4;
}

/* ============================================================
   Chat Item
   ============================================================
   Each conversation row: icon + title/meta + actions.
   Actions (delete) appear on hover only.
   ============================================================ */

.ym-history-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 14px;
  border-radius: var(--radius-s);
  margin: 1px 6px;
  transition: background-color 0.1s ease;
  position: relative;
}

.ym-history-item.is-clickable {
  cursor: pointer;
}

.ym-history-item.is-clickable:hover {
  background-color: var(--background-modifier-hover);
}

/* Active chat — accent highlight */
.ym-history-item.is-active {
  background-color: var(--background-modifier-active-hover, var(--background-modifier-hover));
}

/* ── Icon ── */

.ym-history-item-icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--text-muted);
}

.ym-history-item.is-active .ym-history-item-icon {
  color: var(--text-accent);
}

.ym-history-item-icon svg {
  width: 16px;
  height: 16px;
}

/* ── Content (title + meta) ── */

.ym-history-item-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ym-history-item-title {
  font-size: var(--font-ui-small);
  font-family: var(--font-interface);
  color: var(--text-normal);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
}

.ym-history-item.is-active .ym-history-item-title {
  color: var(--text-accent);
  font-weight: 500;
}

.ym-history-item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ym-history-item-time {
  font-size: var(--font-ui-smaller);
  font-family: var(--font-interface);
  color: var(--text-faint);
  line-height: 1.4;
}

.ym-history-item.is-active .ym-history-item-time {
  color: var(--text-accent);
  opacity: 0.7;
}

/* ── Status spinner (answering / thinking) ── */

.ym-history-item-status {
  display: flex;
  align-items: center;
  color: var(--text-accent);
}

.ym-history-item-status svg {
  width: 12px;
  height: 12px;
}

/* ── Unread badge ── */

.ym-history-item-unread {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--text-accent);
  flex-shrink: 0;
}

/* ── Actions (hover-only) ── */

.ym-history-item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
  flex-shrink: 0;
  margin-top: 2px;
}

.ym-history-item:hover .ym-history-item-actions {
  opacity: 1;
}

.ym-history-item-delete {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-s);
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.ym-history-item-delete:hover {
  color: var(--text-error, #e74c3c);
  background-color: var(--background-modifier-hover);
}

.ym-history-item-delete svg {
  width: 14px;
  height: 14px;
}

/* ============================================================
   Empty / Error / Loading States
   ============================================================ */

.ym-history-empty,
.ym-history-error {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  text-align: center;
  font-size: var(--font-ui-small);
  font-family: var(--font-interface);
  line-height: 1.5;
}

.ym-history-empty {
  color: var(--text-faint);
}

.ym-history-error {
  color: var(--text-error, #e74c3c);
}

/* ============================================================
   Load More Indicator (infinite scroll)
   ============================================================ */

.ym-history-load-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 16px;
  font-size: var(--font-ui-smaller);
  font-family: var(--font-interface);
  color: var(--text-faint);
  line-height: 1.4;
}

.ym-history-load-more svg {
  width: 14px;
  height: 14px;
}

/* ============================================================
   Spin Animation (reuse from board.css if both loaded,
   otherwise this is a standalone fallback)
   ============================================================ */

@keyframes ym-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

.ym-spin svg {
  animation: ym-spin 0.8s linear infinite;
}
```

---

## 样式设计说明

**侧滑动画**：面板使用 `transform: translateX(-100%)` 初始隐藏在左侧，通过 `.is-open` 切换到 `translateX(0)` 实现滑入。Backdrop 同步从透明渐变到半透明遮罩。两者的 transition 时长统一为 `0.2s ease`，与 Obsidian 原生弹窗的动画节奏一致。面板关闭时，JS 层先移除 `.is-open` 触发滑出动画，200ms 后再从 DOM 移除元素。

**宽度策略**：固定 `300px`，但设置了 `max-width: 80%` 作为窄屏保护。在 Obsidian 的侧边栏中，chat view 的宽度通常在 350–500px 之间，300px 的面板会覆盖大部分区域但仍留有一丝可见的背景，给用户“这是一个临时覆盖层”的视觉暗示。

**Sticky 时间分组**：`.ym-history-group-header` 使用 `position: sticky; top: 0`，当用户在长列表中滚动时，当前时间组的标签会吸附在滚动容器顶部，始终可见。这比 Claudian 的纯列表方式提供了更好的时间定位感。`text-transform: uppercase` + `letter-spacing: 0.04em` 让分组标签在视觉上与对话项明确区分，不会被误读为对话标题。

**Hover 操作**：删除按钮默认 `opacity: 0`，仅在 `.ym-history-item: hover` 时显示。这保持了列表的视觉简洁——用户在浏览时不会被操作按钮干扰，只有当鼠标悬停在特定对话上时才出现删除选项。删除按钮 hover 时变为 `--text-error` 红色，提供明确的“危险操作”视觉警告。

**Active 状态**：当前正在进行的对话使用 `--text-accent` 高亮图标、标题和时间，与 board.css 中 active board 的高亮策略一致。背景使用 `--background-modifier-active-hover`（带 fallback 到 `--background-modifier-hover`），因为不同 Obsidian 版本对这个变量的支持不同。

**Unread 圆点**：6px 的小圆点，使用 `--text-accent` 颜色，出现在 meta 行中时间旁边。这是 YouMind 网页端 chat list 中未读标记的简化版——网页端用数字 badge，插件端用圆点即可（空间有限）。

**Spin 动画复用**：`@keyframes ym-spin` 与 board.css 中定义的完全相同。如果两个 CSS 文件都被加载，浏览器会自动去重同名 keyframes。如果只加载 history.css（理论上不会，但防御性编码），动画也能独立工作。

**z-index 层级**：面板使用 `var(--layer-popover) + 1`，确保在 backdrop（`var(--layer-popover)`）之上。这样点击 backdrop 可以关闭面板，而面板本身的交互不受 backdrop 影响。