# Phase 1.3.1.1 — 保存确认浮层 (实现指令)


## 前置状态（已完成，不要重复实现）

以下功能已经在前两轮中完成并通过验证，**本轮不要修改这些逻辑**：

- ✅ **Save 动作拆分**：消息操作栏保存按钮已拆为 “Save to Vault”（纯本地）和 “Save as YouMind Note”（双写）两个选项，通过 Obsidian `Menu` 弹出

- ✅ **Push 三层入口**：命令面板 / 文件管理器右键 / 编辑器右上角状态按钮 均已实现

- ✅ `getSyncStatus(file)`：已实现 `unlinked` / `synced` / `modified` 三态判断

- ✅ `youmind_source: 'local'`：已加入 FrontmatterManager 类型

- ✅ **Push 结构化返回**：首次创建 / 更新 / 失败 均有明确 Notice 反馈

---

## 本轮目标

**将 “Save as YouMind Note” 和 “Push current note to YouMind” 成功后的黑底 **`new Notice()`** 替换为可交互的保存确认浮层**，让用户能：

1. 看到内容保存到了哪个 Board

2. 点击切换到其他 Board（云端移动 + 本地文件迁移 + frontmatter 更新）

3. 点击 “去 YouMind 查看” 在浏览器中打开

对齐 YouMind Chrome 插件的保存确认体验。

## 约束

- 所有图标使用 Obsidian 内置的 **Lucide** 图标库，通过 `import { setIcon } from "obsidian"` 调用，**绝不使用 emoji**

- 图标颜色通过 CSS `color` 属性控制（Lucide SVG 使用 `currentColor`）

- 图标大小通过 CSS 变量 `--icon-size` 控制

- 保持现有文件结构不变（扁平 `src/` 目录），不引入子目录

- `npm run build` 必须通过

- 不破坏现有的 chat / history / board / pick / save / push 功能

---

## 变更清单

### 1. 新增文件：`src/save-confirm-panel.ts`

保存确认浮层组件。“Save as YouMind Note” 和 “Push” 成功后调用此组件替代 `new Notice()`。

**类定义：**

```typescript
import { App, setIcon } from "obsidian";

interface SaveConfirmOptions {
  app: App;
  noteId: string;           // 刚创建/更新的 Note ID
  boardId: string;          // 当前 Board ID
  boardName: string;        // 当前 Board 名称
  boards: BoardInfo[];      // 所有可用 Board 列表
  isUpdate: boolean;        // true = 更新已有 Note, false = 新建
  onBoardChanged?: (newBoardId: string, newBoardName: string) => Promise<void>;
  onOpenInYouMind?: () => void;
}

interface BoardInfo {
  id: string;
  name: string;
  iconName?: string;   // YouMind Board icon name（尝试映射到 Lucide）
  iconColor?: string;  // YouMind Board icon color
}
</void>
```

**浮层 DOM 结构：**

```html
<div class="youmind-save-confirm"><div class="youmind-save-confirm-header">
    <span class="youmind-save-confirm-icon"></span>  <!-- setIcon: "check-circle", color: green -->
    <span class="youmind-save-confirm-label">已保存到</span>
    <button class="youmind-save-confirm-close"></button>  <!-- setIcon: "x" --></div><div class="youmind-save-confirm-board-row">
    <button class="youmind-save-confirm-board-btn">
      <span class="youmind-board-icon"></span>  <!-- setIcon: mapped lucide name -->
      <span class="youmind-board-name">堪舆术</span>
      <span class="youmind-board-chevron"></span>  <!-- setIcon: "chevron-down" -->
    </button>
    <button class="youmind-save-confirm-open-btn">
      <span></span>  <!-- setIcon: "external-link" -->
      <span>去 YouMind 查看</span>
    </button></div><!-- Board 下拉列表（默认隐藏） --><div class="youmind-save-confirm-dropdown" style="display:none">
    <div class="youmind-save-confirm-search">
      <span></span>  <!-- setIcon: "search" -->
      <input type="text" placeholder="搜索...">
    </div>
    <div class="youmind-save-confirm-board-list">
      <!-- 动态渲染 Board 列表项 -->
    </div></div><div class="youmind-save-confirm-timer">
    <span>5 秒后自动关闭</span></div></div>
```

**行为逻辑（10 条规则）：**

 1. 浮层挂载到 `document.body`，定位在 Obsidian 窗口右上角（`position: fixed; top: 16px; right: 16px;`）

 2. 出现时带 `fadeIn` 动画（CSS `opacity 0→1, translateY -8→0`，200ms）

 3. 启动 5 秒倒计时，倒计时结束后 `fadeOut` 消失

 4. 用户点击 Board 名称按钮 → 展开下拉列表 → **取消倒计时**

 5. 下拉列表中的搜索框：纯前端过滤，按 Board `name` 模糊匹配（`name.toLowerCase().includes(query.toLowerCase())`）

 6. 当前 Board 在列表中显示 `check` 图标标记

 7. 用户选择另一个 Board：

    - 下拉列表收起

    - 浮层显示 “正在移动……”（Board 名称区域显示 `loader` 图标 + CSS 旋转动画）

    - 调用 `onBoardChanged` 回调（内部执行 `moveMaterials` + 本地文件迁移 + frontmatter 更新）

    - 成功后浮层更新为 “已移动到 {新 Board 名称}”，重新启动 3 秒倒计时

    - 失败时浮层显示 “移动失败”（`alert-circle` 图标，红色），保持显示不自动关闭

 8. 点击 “去 YouMind 查看” → `window.open('https://youmind.com/boards/${boardId}? material-id=${noteId}')`

 9. 点击关闭按钮或点击浮层外部区域 → 立即关闭

10. 同一时间只允许一个确认浮层存在，新的浮层会替换旧的

**Board icon 映射逻辑：**

YouMind Board 的 `icon.name` 是 YouMind 自定义的 icon set，不是 Lucide。处理策略：

```typescript
const BOARD_ICON_MAP: Record<string, string=""> = {
  "folder": "folder",
  "book": "book-open",
  "code": "code",
  "music": "music",
  "video": "video",
  "image": "image",
  "globe": "globe",
  "star": "star",
  "heart": "heart",
  "rocket": "rocket",
  "lightbulb": "lightbulb",
  "graduation-cap": "graduation-cap",
  "briefcase": "briefcase",
};

function mapBoardIcon(ymIconName: string): string {
  return BOARD_ICON_MAP[ymIconName] ?? "layout-dashboard";  // 默认回退
}
</string,>
```

Board icon 的 `color` 属性直接通过 `style="color: ${iconColor}"` 应用到图标容器元素上。

---

### 2. 修改文件：`src/api.ts`

新增两个方法：

```typescript
// 移动 Materials 到目标 Board
async moveMaterials(params: {
  items: Array<{
    id: string;       // Material ID
    boardId: string;  // 目标 Board ID
    groupId?: string; // 目标 Group ID（可选）
  }>;
}): Promise<{
  successCount: number;
  failedCount: number;
  failures?: string[];
}> {
  return this.request("POST", "/openapi/v1/moveMaterials", params);
}

// 列出所有 Boards
async listBoards(params?: {
  status?: string;
  fuzzyName?: string;
  withFavorite?: boolean;
}): Promise<array<{ id:="" string;="" name:="" description:="" icon:="" {="" color:="" string="" };="" status:="" type:="" snipscount:="" number;="" thoughtscount:="" craftscount:="" isfavorited?:="" boolean;="" }="">> {
  return this.request("POST", "/openapi/v1/listBoards", params ?? {});
}
</array<{>
```

---

### 3. 修改文件：`src/chat-view.ts`

**仅修改 **`saveAsYouMindNote`** 方法的最后一步**（步骤 1-5 的双写流程不动）：

将现有的 `new Notice("Created as YouMind Note · Board: ...")` 替换为：

```typescript
import { SaveConfirmPanel } from "./save-confirm-panel";

// 在 saveAsYouMindNote 方法的最后，替换 Notice：
const boards = await this.plugin.api.listBoards();
const boardInfos: BoardInfo[] = boards.map(b => ({
  id: b.id,
  name: b.name,
  iconName: b.icon?.name,
  iconColor: b.icon?.color,
}));

new SaveConfirmPanel({
  app: this.app,
  noteId: createdNote.id,
  boardId: currentBoardId,
  boardName: currentBoardName,
  boards: boardInfos,
  isUpdate: false,
  onBoardChanged: async (newBoardId, newBoardName) => {
    // a. 云端移动
    await this.plugin.api.moveMaterials({
      items: [{ id: createdNote.id, boardId: newBoardId }]
    });
    // b. 本地文件移动 + frontmatter 更新
    await this.plugin.frontmatterManager.updateBoard(
      localFile, newBoardId, newBoardName, syncRoot
    );
  },
  onOpenInYouMind: () => {
    window.open(`https://youmind.com/boards/${currentBoardId}?material-id=${createdNote.id}`);
  },
});
```

**不要修改 **`saveToVaultOnly`** 方法**——纯本地保存继续用 `new Notice()`，不弹确认浮层。

---

### 4. 修改文件：`src/push-service.ts`

**仅修改 Push 成功后的反馈部分**：

将 Push 成功后的 `new Notice("Created as YouMind Note · Board: ...")` 或 `new Notice("Pushed changes to YouMind · Board: ...")` 替换为 `SaveConfirmPanel`，逻辑与上面 `saveAsYouMindNote` 中的浮层调用完全一致。

```typescript
import { SaveConfirmPanel } from "./save-confirm-panel";

// Push 成功后：
const boards = await this.plugin.api.listBoards();
const boardInfos: BoardInfo[] = boards.map(b => ({
  id: b.id,
  name: b.name,
  iconName: b.icon?.name,
  iconColor: b.icon?.color,
}));

new SaveConfirmPanel({
  app: this.plugin.app,
  noteId: result.noteId,        // Push 返回的 Note ID
  boardId: result.boardId,      // Push 目标 Board ID
  boardName: result.boardName,  // Push 目标 Board 名称
  boards: boardInfos,
  isUpdate: result.isUpdate,    // true = updateNote, false = createNote
  onBoardChanged: async (newBoardId, newBoardName) => {
    await this.plugin.api.moveMaterials({
      items: [{ id: result.noteId, boardId: newBoardId }]
    });
    await this.plugin.frontmatterManager.updateBoard(
      file, newBoardId, newBoardName, syncRoot
    );
  },
  onOpenInYouMind: () => {
    window.open(`https://youmind.com/boards/${result.boardId}?material-id=${result.noteId}`);
  },
});
```

**Push 失败时继续使用 **`new Notice()`** 显示错误**，不弹确认浮层。

**不要修改 **`registerEditorButton`**、右键菜单注册等已有逻辑。**

---

### 5. 修改文件：`src/frontmatter-manager.ts`

新增 `updateBoard` 方法（用于确认浮层切换 Board 后更新本地文件）：

```typescript
/**
 * 更新文件的 Board 关联并移动到新目录
 */
async updateBoard(file: TFile, newBoardId: string, newBoardName: string, syncRoot: string): Promise<tfile> {
  // 1. 更新 frontmatter 中的 youmind_board
  const meta = this.read(file);
  if (meta) {
    await this.write(file, { ...meta, youmind_board: newBoardId });
  }
  // 2. 计算新路径
  const subDir = file.path.includes('/materials/') ? 'materials' : 'crafts';
  const newDir = `${syncRoot}/${newBoardName}/${subDir}`;
  // 3. 确保目录存在
  if (!this.app.vault.getAbstractFileByPath(newDir)) {
    await this.app.vault.createFolder(newDir);
  }
  // 4. 移动文件
  const newPath = `${newDir}/${file.name}`;
  await this.app.vault.rename(file, newPath);
  // 5. 返回新的 TFile 引用
  return this.app.vault.getAbstractFileByPath(newPath) as TFile;
}
</tfile>
```

**不要修改 **`read`**、**`write`**、**`remove`**、**`scanLinkedFiles`**、**`findLocalFile`**、**`getSyncStatus`** 等已有方法。**

---

### 6. 修改文件：`src/types.ts`

新增类型（如果尚未存在）：

```typescript
// Board 信息（用于确认浮层的 Board 列表）
export interface BoardInfo {
  id: string;
  name: string;
  iconName?: string;
  iconColor?: string;
}

// 保存确认浮层选项
export interface SaveConfirmOptions {
  app: App;
  noteId: string;
  boardId: string;
  boardName: string;
  boards: BoardInfo[];
  isUpdate: boolean;
  onBoardChanged?: (newBoardId: string, newBoardName: string) => Promise<void>;
  onOpenInYouMind?: () => void;
}
</void>
```

---

### 7. 样式：追加到 `styles.css`

将以下 CSS 追加到 `styles.css` 文件末尾。**不要修改或删除文件中已有的样式。**

```css
/* ============================================
   Save Confirm Panel
   ============================================ */

.youmind-save-confirm {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 9999;
  width: 320px;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  padding: 12px 16px;
  animation: youmind-fade-in 200ms ease-out;
  font-size: var(--font-ui-small);
}

.youmind-save-confirm.is-closing {
  animation: youmind-fade-out 200ms ease-in forwards;
}

@keyframes youmind-fade-in {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes youmind-fade-out {
  from { opacity: 1; transform: translateY(0); }
  to   { opacity: 0; transform: translateY(-8px); }
}

/* Header row */
.youmind-save-confirm-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.youmind-save-confirm-icon {
  color: var(--text-success);
  --icon-size: 18px;
  flex-shrink: 0;
}

.youmind-save-confirm-label {
  flex: 1;
  font-weight: 500;
  color: var(--text-normal);
}

.youmind-save-confirm-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 2px;
  border-radius: 4px;
  --icon-size: 14px;
}

.youmind-save-confirm-close:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}

/* Board row */
.youmind-save-confirm-board-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.youmind-save-confirm-board-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  padding: 6px 10px;
  cursor: pointer;
  flex: 1;
  min-width: 0;
  font-size: var(--font-ui-small);
  color: var(--text-normal);
}

.youmind-save-confirm-board-btn:hover {
  background: var(--background-modifier-hover);
}

.youmind-board-icon {
  --icon-size: 16px;
  flex-shrink: 0;
}

.youmind-board-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.youmind-board-chevron {
  --icon-size: 14px;
  color: var(--text-muted);
  flex-shrink: 0;
  transition: transform 150ms ease;
}

.youmind-save-confirm-board-btn.is-open .youmind-board-chevron {
  transform: rotate(180deg);
}

.youmind-save-confirm-open-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--interactive-accent);
  color: var(--text-on-accent);
  border: none;
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: var(--font-ui-smaller);
  white-space: nowrap;
  flex-shrink: 0;
}

.youmind-save-confirm-open-btn:hover {
  background: var(--interactive-accent-hover);
}

.youmind-save-confirm-open-btn .svg-icon {
  --icon-size: 14px;
}

/* Dropdown */
.youmind-save-confirm-dropdown {
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  background: var(--background-primary);
  margin-bottom: 8px;
  max-height: 280px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.youmind-save-confirm-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--background-modifier-border);
}

.youmind-save-confirm-search .svg-icon {
  --icon-size: 14px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.youmind-save-confirm-search input {
  border: none;
  background: none;
  outline: none;
  flex: 1;
  font-size: var(--font-ui-small);
  color: var(--text-normal);
}

.youmind-save-confirm-board-list {
  overflow-y: auto;
  max-height: 220px;
}

.youmind-save-confirm-board-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: var(--font-ui-small);
  color: var(--text-normal);
}

.youmind-save-confirm-board-item:hover {
  background: var(--background-modifier-hover);
}

.youmind-save-confirm-board-item.is-current {
  background: var(--background-secondary);
}

.youmind-save-confirm-board-item .youmind-board-icon {
  --icon-size: 16px;
  flex-shrink: 0;
}

.youmind-save-confirm-board-item .youmind-board-check {
  --icon-size: 14px;
  color: var(--text-success);
  margin-left: auto;
  flex-shrink: 0;
}

/* Timer */
.youmind-save-confirm-timer {
  text-align: right;
  font-size: var(--font-ui-smaller);
  color: var(--text-faint);
}

/* Loading state */
.youmind-save-confirm-loading .youmind-board-icon {
  animation: youmind-spin 1s linear infinite;
}

@keyframes youmind-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

/* Error state */
.youmind-save-confirm-error .youmind-save-confirm-icon {
  color: var(--text-error);
}
```

---

## Icon 映射参考

所有图标均为 Lucide icon name，通过 `setIcon(element, name)` 调用。

| 用途 | Lucide icon name |
| --- | --- |
| 保存成功 | `check-circle` |
| 关闭浮层 | `x` |
| 去 YouMind 查看 | `external-link` |
| Board 下拉箭头 | `chevron-down` |
| 搜索框 | `search` |
| 当前 Board 标记 | `check` |
| 加载中 | `loader` |
| 错误 | `alert-circle` |
| Board 默认图标 | `layout-dashboard` |

---

## 数据流总结

### Save as YouMind Note（触发浮层）

```plaintext
用户点击消息操作栏 → 选择 "Save as YouMind Note"
    → createNote → 本地文件 → 完整 frontmatter（现有逻辑不变）
    → 弹出 SaveConfirmPanel（替换原来的 Notice）
    → 用户可选择切换 Board → moveMaterials + 本地文件迁移 + frontmatter 更新
    → 或 5 秒后自动关闭
```

### Push current note（触发浮层）

```plaintext
用户触发 Push（编辑器按钮 / 右键菜单 / 命令面板）
    → 读 frontmatter → createNote 或 updateNote（现有逻辑不变）
    → 弹出 SaveConfirmPanel（替换原来的 Notice）
    → 用户可选择切换 Board → moveMaterials + 本地文件迁移 + frontmatter 更新
    → 或 5 秒后自动关闭
```

### Save to Vault（不触发浮层）

```plaintext
用户点击消息操作栏 → 选择 "Save to Vault"
    → 纯本地保存（现有逻辑不变）
    → 继续使用 new Notice()，不弹确认浮层
```

### Push 失败（不触发浮层）

```plaintext
Push 失败
    → 继续使用 new Notice() 显示错误信息，不弹确认浮层
```

---

## API 参考

### `moveMaterials`

```plaintext
POST /openapi/v1/moveMaterials
```

请求体：

```json
{
  "items": [
    {
      "id": "material-uuid",
      "boardId": "target-board-uuid",
      "groupId": "optional-group-uuid"
    }
  ]
}
```

响应：

```json
{
  "successCount": 1,
  "failedCount": 0,
  "failures": []
}
```

### `listBoards`

```plaintext
POST /openapi/v1/listBoards
```

请求体（可选）：

```json
{
  "status": "in-progress",
  "fuzzyName": "search term",
  "withFavorite": true
}
```

响应：Board 对象数组，每个包含 `id`, `name`, `icon: { name, color }` 等字段。

---

## 验收标准

1. **确认浮层出现**

   - “Save as YouMind Note” 成功后弹出确认浮层（不再是黑底 Notice）

   - “Push current note to YouMind” 成功后弹出确认浮层（不再是黑底 Notice）

   - “Save to Vault” 继续使用 Notice，不弹浮层

   - Push 失败继续使用 Notice，不弹浮层

2. **浮层基础交互**

   - 浮层显示当前 Board 名称 + Lucide 图标（非 emoji）

   - 浮层显示 “去 YouMind 查看” 按钮，点击在浏览器打开正确 URL

   - 无操作 5 秒后自动关闭（带 fadeOut 动画）

   - 点击关闭按钮或浮层外部立即关闭

3. **Board 切换**

   - 点击 Board 名称展开下拉列表，倒计时取消

   - 下拉列表显示所有 Board，当前 Board 有 `check` 标记

   - 搜索框能过滤 Board 列表

   - 选择其他 Board 后：云端 Note 移动成功 + 本地文件迁移到新目录 + frontmatter 中 `youmind_board` 更新

   - 移动成功后浮层更新为 “已移动到 {新 Board 名称}”

   - 移动失败时浮层显示错误状态，不自动关闭

4. **不破坏现有功能**

   - `npm run build` 通过

   - Chat 发送/接收/历史恢复正常

   - Board 切换正常

   - Pick（摘录）正常

   - Save to Vault / Save as YouMind Note 的保存逻辑不变

   - Push 三层入口（命令面板/右键/编辑器按钮）正常工作

   - 编辑器右上角同步状态按钮正常显示

---

## 不做的事情（明确排除）

- 不修改 Save 拆分逻辑（已完成）

- 不修改 Push 三层入口逻辑（已完成）

- 不修改 `registerEditorButton` 逻辑（已完成）

- 不修改 `getSyncStatus` 逻辑（已完成）

- 不做 Browser ItemView（1.3.2 的内容）

- 不做 Pull 服务（1.3.3 的内容）

- 不做 Chat 内搜索入口（1.3.5 的内容）

- 不做 Pick 的确认浮层接入（后续再统一）

- 不拆分 `styles.css` 为多个文件

- 不引入子目录结构

- 不做 “创建新项目” 入口（确认浮层的 Board 列表中暂不加）