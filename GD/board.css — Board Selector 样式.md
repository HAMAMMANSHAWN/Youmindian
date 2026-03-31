# style/board.css — Board Selector 样式


> 文件路径：`src/style/board.css`

```css
/* ============================================================
   Board Selector — Trigger Button
   ============================================================ */

.ym-board-selector {
  position: relative;
  flex-shrink: 1;
  min-width: 0; /* Allow text truncation */
}

.ym-board-selector-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: var(--radius-s);
  cursor: pointer;
  transition: background-color 0.15s ease;
  max-width: 200px;
  user-select: none;
}

.ym-board-selector-trigger:hover {
  background-color: var(--background-modifier-hover);
}

.ym-board-selector-icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--text-muted);
}

.ym-board-selector-icon svg {
  width: 16px;
  height: 16px;
}

.ym-board-selector-name {
  font-size: var(--font-ui-small);
  font-family: var(--font-interface);
  color: var(--text-normal);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
}

.ym-board-selector-name.ym-text-muted {
  color: var(--text-muted);
  font-style: italic;
}

.ym-board-selector-chevron {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--text-faint);
}

.ym-board-selector-chevron svg {
  width: 12px;
  height: 12px;
}

/* ============================================================
   Board Selector — Dropdown Panel
   ============================================================ */

.ym-board-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: var(--layer-popover);
  width: 280px;
  max-height: 360px;
  display: flex;
  flex-direction: column;
  background-color: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

/* Dark theme shadow adjustment */
.theme-dark .ym-board-dropdown {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
}

/* ============================================================
   Dropdown — Search Row
   ============================================================ */

.ym-board-dropdown-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--background-modifier-border);
  flex-shrink: 0;
}

.ym-board-dropdown-search-icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--text-faint);
}

.ym-board-dropdown-search-icon svg {
  width: 14px;
  height: 14px;
}

.ym-board-dropdown-search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--font-ui-small);
  font-family: var(--font-interface);
  color: var(--text-normal);
  padding: 0;
  line-height: 1.4;
}

.ym-board-dropdown-search-input::placeholder {
  color: var(--text-faint);
}

.ym-board-dropdown-refresh {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-s);
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.15s ease;
}

.ym-board-dropdown-refresh:hover {
  color: var(--text-normal);
}

.ym-board-dropdown-refresh svg {
  width: 14px;
  height: 14px;
}

/* ============================================================
   Dropdown — Board List
   ============================================================ */

.ym-board-dropdown-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

/* Thin scrollbar */
.ym-board-dropdown-list::-webkit-scrollbar {
  width: 4px;
}

.ym-board-dropdown-list::-webkit-scrollbar-track {
  background: transparent;
}

.ym-board-dropdown-list::-webkit-scrollbar-thumb {
  background-color: var(--background-modifier-border);
  border-radius: 4px;
}

/* ============================================================
   Dropdown — Board Item
   ============================================================ */

.ym-board-dropdown-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  transition: background-color 0.1s ease;
}

.ym-board-dropdown-item:hover,
.ym-board-dropdown-item.is-highlighted {
  background-color: var(--background-modifier-hover);
}

.ym-board-dropdown-item.is-active {
  color: var(--text-accent);
}

.ym-board-dropdown-item-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  flex-shrink: 0;
  color: var(--text-accent);
}

.ym-board-dropdown-item-indicator svg {
  width: 14px;
  height: 14px;
}

.ym-board-dropdown-item-icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--text-muted);
}

.ym-board-dropdown-item.is-active .ym-board-dropdown-item-icon {
  color: var(--text-accent);
}

.ym-board-dropdown-item-icon svg {
  width: 14px;
  height: 14px;
}

.ym-board-dropdown-item-name {
  flex: 1;
  min-width: 0;
  font-size: var(--font-ui-small);
  font-family: var(--font-interface);
  color: var(--text-normal);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
}

.ym-board-dropdown-item.is-active .ym-board-dropdown-item-name {
  color: var(--text-accent);
  font-weight: 500;
}

.ym-board-dropdown-item-badge {
  flex-shrink: 0;
  font-size: var(--font-ui-smaller);
  font-family: var(--font-interface);
  color: var(--text-faint);
  background-color: var(--background-secondary);
  padding: 1px 6px;
  border-radius: var(--radius-s);
  line-height: 1.4;
}

/* ============================================================
   Dropdown — Empty & Error States
   ============================================================ */

.ym-board-dropdown-empty,
.ym-board-dropdown-error {
  padding: 16px 10px;
  text-align: center;
  font-size: var(--font-ui-small);
  font-family: var(--font-interface);
  line-height: 1.5;
}

.ym-board-dropdown-empty {
  color: var(--text-faint);
}

.ym-board-dropdown-error {
  color: var(--text-error, #e74c3c);
}

/* ============================================================
   Spin Animation (for loading & refresh)
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

**100% Obsidian CSS 变量**：所有颜色、字体、圆角均使用 Obsidian 内置 CSS 变量，零硬编码颜色值。自动适配 light/dark 主题，唯一的例外是 dark 主题下 dropdown 阴影加深（通过 `.theme-dark` 选择器微调）。

**滚动条**：4px 超细滚动条，使用 `--background-modifier-border` 作为 thumb 颜色，与 Obsidian 原生风格一致。

**文字截断**：trigger 按钮和 board 项名称都设置了 `text-overflow: ellipsis`，确保长 board 名称不会撑破布局。

**交互反馈**：hover 和 keyboard highlight 使用 `--background-modifier-hover`,active board 使用 `--text-accent` 高亮并加粗，与 Obsidian 的选中状态风格统一。

**z-index**:dropdown 使用 `--layer-popover`（Obsidian 内置变量），确保在正确的层级显示。