# Phase 1.3.2 — Board Content Browser (实现指令)


## 前置状态（已完成，不要重复实现）

以下功能已在前几轮中完成并通过验证，**本轮不要修改这些已有逻辑**：

- ✅ Chat View（对话、历史、消息操作栏）

- ✅ Board 选择器（下拉切换 Board，上下文隔离）

- ✅ Pick 摘录（消息级 + 选区级）

- ✅ Save 动作拆分（“Save to Vault” / “Save as YouMind Note” 两个 Menu 选项）

- ✅ Push 三层入口（命令面板 / 右键菜单 / 编辑器右上角状态按钮）

- ✅ Frontmatter Manager（读写 `youmind_id`、`youmind_board`、`youmind_type`、`youmind_synced_at`、`youmind_source`）

- ✅ `getSyncStatus(file)` 三态判断（`unlinked` / `synced` / `modified`）

- ✅ Save Confirm Panel（保存确认浮层，支持事后切换 Board）

---

## 本轮目标

在 Obsidian 侧边栏新增一个 **Board Content Browser** 视图（`ItemView`），让用户可以浏览当前 Board 的 Materials 和 Crafts 树形结构，预览内容摘要，并为后续的 Pull to Vault（Phase 1.3.3）提供 UI 入口。

**用户价值**：用户第一次能在 Obsidian 里“看到” YouMind Board 里有什么内容，而不是只能在网页端浏览。

---

## 约束

- 所有图标使用 Obsidian 内置的 **Lucide** 图标库，通过 `import { setIcon } from "obsidian"` 调用，**绝不使用 emoji**

- 不引入任何外部图标库或字体

- 图标颜色通过 CSS `color` 属性控制（Lucide SVG 使用 `currentColor`）

- 保持现有文件结构不变（扁平 `src/` 目录），不引入 `views/`、`components/`、`services/` 子目录

- `npm run build` 必须通过

- 不破坏 Phase 1.2 和 1.3.1 的 chat / history / board / pick / save / push 功能

---

## 变更清单

### 1. 新增文件

#### `src/browser-view.ts`

Board Content Browser 的主视图，注册为 Obsidian `ItemView`。

**View 类型常量：**

```typescript
export const BROWSER_VIEW_TYPE = "youmind-browser-view";
```

**类定义：**

```typescript
import { ItemView, WorkspaceLeaf, setIcon, Menu } from "obsidian";

export class BrowserView extends ItemView {
  private plugin: YouMindPlugin;       // 插件主实例引用
  private currentTab: "materials" | "crafts" = "materials";
  private materialsTree: TreeNode[] = [];
  private craftsTree: TreeNode[] = [];
  private linkedFiles: Map<string, tfile=""> = new Map();  // youmind_id → TFile
  private cache: {
    materials: { data: any[] | null; timestamp: number };
    crafts: { data: any[] | null; timestamp: number };
  } = {
    materials: { data: null, timestamp: 0 },
    crafts: { data: null, timestamp: 0 },
  };
  private previewContainer: HTMLElement;
  private listContainer: HTMLElement;
  private loadingEl: HTMLElement;
  private emptyEl: HTMLElement;

  getViewType(): string { return BROWSER_VIEW_TYPE; }
  getDisplayText(): string { return "YouMind Browser"; }
  getIcon(): string { return "library"; }  // Lucide: library
}
</string,>
```

**DOM 结构（**`onOpen`** 中构建）：**

```html
<div class="youmind-browser"><!-- Header --><div class="youmind-browser-header">
    <div class="youmind-browser-board-info">
      <span class="youmind-browser-board-icon"></span>  <!-- setIcon: mapped board icon -->
      <span class="youmind-browser-board-name">AI Research</span>
    </div>
    <button class="youmind-browser-refresh" aria-label="Refresh">
      <!-- setIcon: "refresh-cw" -->
    </button></div>

  <!-- Tab Bar --><div class="youmind-browser-tabs">
    <button class="youmind-browser-tab is-active" data-tab="materials">
      <span></span>  <!-- setIcon: "file-text" -->
      <span>Materials</span>
      <span class="youmind-browser-tab-count">0</span>
    </button>
    <button class="youmind-browser-tab" data-tab="crafts">
      <span></span>  <!-- setIcon: "pen-tool" -->
      <span>Crafts</span>
      <span class="youmind-browser-tab-count">0</span>
    </button></div>

  <!-- Content List --><div class="youmind-browser-list">
    <!-- Loading State -->
    <div class="youmind-browser-loading" style="display:none">
      <span></span>  <!-- setIcon: "loader", add CSS spin animation -->
      <span>Loading...</span>
    </div>
    <!-- Empty State -->
    <div class="youmind-browser-empty" style="display:none">
      <span></span>  <!-- setIcon: "inbox" -->
      <span>No items in this board</span>
    </div>
    <!-- Tree Items (dynamically rendered) --></div>

  <!-- Preview Panel (bottom, collapsible) --><div class="youmind-browser-preview" style="display:none">
    <div class="youmind-browser-preview-header">
      <span class="youmind-browser-preview-icon"></span>
      <span class="youmind-browser-preview-title"></span>
      <button class="youmind-browser-preview-close">
        <!-- setIcon: "x" -->
      </button>
    </div>
    <div class="youmind-browser-preview-body">
      <!-- 内容摘要文本 -->
    </div>
    <div class="youmind-browser-preview-actions">
      <!-- 操作按钮，根据类型动态渲染 -->
    </div></div></div>
```

**核心数据模型：**

```typescript
interface TreeNode {
  id: string;                    // 实体 ID
  type: "group" | "material" | "craft";
  title: string;
  icon: string;                  // Lucide 图标名
  entityType?: string;           // material 子类型: note | article | image | voice | video | pdf | office | text-file
  craftType?: string;            // craft 子类型: page | slides | webpage | audio-pod | canvas
  children?: TreeNode[];         // 仅 group 类型有
  isLinked: boolean;             // 是否已有本地关联文件（通过 FrontmatterManager 扫描）
  localPath?: string;            // 本地文件路径（如果已关联）
  isPullable: boolean;           // 是否可拉取到本地
  updatedAt: string;             // 最后更新时间
  contentPreview?: string;       // 内容摘要（前 200 字符）
  url?: string;                  // 原始 URL（article / image / voice / video 类型）
  expanded?: boolean;            // group 展开状态
}
```

**Material 类型 → 图标映射：**

```typescript
const MATERIAL_ICON_MAP: Record<string, string=""> = {
  "article": "globe",
  "note": "sticky-note",
  "image": "image",
  "voice": "headphones",
  "video": "video",
  "pdf": "file-text",
  "office": "file-spreadsheet",
  "text-file": "file-code",
  "other-webpage": "globe",
  "unknown-webpage": "globe",
  "snippet": "scissors",
};

function getMaterialIcon(type: string): string {
  return MATERIAL_ICON_MAP[type] ?? "file";
}
</string,>
```

**Craft 类型 → 图标映射：**

```typescript
const CRAFT_ICON_MAP: Record<string, string=""> = {
  "page": "file-edit",
  "slides": "presentation",
  "webpage": "layout",
  "audio-pod": "podcast",
  "canvas": "frame",
};

function getCraftIcon(type: string): string {
  return CRAFT_ICON_MAP[type] ?? "file";
}
</string,>
```

**可拉取判断逻辑：**

```typescript
const PULLABLE_MATERIAL_TYPES = new Set([
  "article", "note", "image", "text-file"
]);
const PARTIALLY_PULLABLE_MATERIAL_TYPES = new Set([
  "voice", "video", "pdf"
]);
// office 类型不可拉取

const PULLABLE_CRAFT_TYPES = new Set(["page"]);
// slides, webpage, audio-pod, canvas 不可拉取

function isMaterialPullable(type: string): boolean {
  return PULLABLE_MATERIAL_TYPES.has(type) || PARTIALLY_PULLABLE_MATERIAL_TYPES.has(type);
}

function isCraftPullable(type: string): boolean {
  return PULLABLE_CRAFT_TYPES.has(type);
}
```

**数据加载逻辑（**`loadData`** 方法）：**

```typescript
async loadData(forceRefresh = false): Promise<void> {
  const boardId = this.plugin.getCurrentBoardId();
  if (!boardId) {
    this.showEmpty("No board selected");
    return;
  }

  // 缓存检查：5 分钟有效期
  const CACHE_TTL = 5 * 60 * 1000;
  const now = Date.now();

  this.showLoading();

  try {
    // 扫描本地已关联文件
    this.linkedFiles = this.plugin.frontmatterManager.scanLinkedFiles();

    // 加载 Materials
    if (forceRefresh || !this.cache.materials.data || (now - this.cache.materials.timestamp > CACHE_TTL)) {
      const materials = await this.plugin.api.listMaterials({ boardId });
      this.cache.materials = { data: materials, timestamp: now };
    }

    // 加载 Crafts
    if (forceRefresh || !this.cache.crafts.data || (now - this.cache.crafts.timestamp > CACHE_TTL)) {
      const crafts = await this.plugin.api.listCrafts({ boardId });
      this.cache.crafts = { data: crafts, timestamp: now };
    }

    // 构建树
    this.materialsTree = this.buildMaterialTree(this.cache.materials.data!);
    this.craftsTree = this.buildCraftTree(this.cache.crafts.data!);

    // 更新 Tab 计数
    this.updateTabCounts();

    // 渲染当前 Tab
    this.renderCurrentTab();

  } catch (error) {
    this.showError("Failed to load board content");
    console.error("[YouMind Browser]", error);
  }
}
</void>
```

**构建 Material 树（**`buildMaterialTree`** 方法）：**

`listMaterials` API 返回的数据结构（实际验证过的字段）：

```typescript
// 每个 item 的结构：
interface MaterialBoardItem {
  id: string;                        // boardItemId
  boardId: string;
  parentBoardGroupId: string | null;
  rank: string;
  entityType: "snip" | "thought" | "board_group";
  // entityType === "board_group" 时，这是一个 MaterialGroup
  // entityType === "thought" 时，entity.$class 可能是 "NoteDto"
  // entityType === "snip" 时，entity.$class 可能是 "ArticleDto" / "ImageDto" / ...
  snipId: string | null;
  thoughtId: string | null;
  boardGroupId: string | null;       // 非 null 时表示这是一个 group 节点
  entity: {
    $class: string;                  // "NoteDto" | "ArticleDto" | "ImageDto" | "VoiceDto" | "VideoDto" | "PdfDto" | "OfficeDto" | "TextFileDto" | "BoardGroupDto" | ...
    id: string;
    type: string;                    // "note" | "article" | "image" | "voice" | "video" | "pdf" | "office" | "text-file" | "board-group" | ...
    title: string;
    content?: { raw: string; plain: string } | null;   // Note 类型有 content
    url?: string;                    // Article / Image / Voice / Video 类型有 url
    updatedAt: string;
    visibility?: string;
  };
}
```

构建树的逻辑：

```typescript
buildMaterialTree(items: MaterialBoardItem[]): TreeNode[] {
  // 1. 分离 groups 和普通 items
  const groups: Map<string, treenode=""> = new Map();
  const rootItems: TreeNode[] = [];

  // 第一遍：识别所有 group
  for (const item of items) {
    if (item.boardGroupId || item.entityType === "board_group") {
      const groupId = item.boardGroupId ?? item.entity.id;
      if (!groups.has(groupId)) {
        groups.set(groupId, {
          id: groupId,
          type: "group",
          title: item.entity.title ?? "Untitled Group",
          icon: "folder",
          children: [],
          isLinked: false,
          isPullable: false,
          updatedAt: item.entity.updatedAt ?? item.updatedAt,
          expanded: false,
        });
      }
      continue;  // group 节点本身不作为 material 处理
    }
  }

  // 第二遍：将 items 分配到 group 或根级
  for (const item of items) {
    if (item.boardGroupId || item.entityType === "board_group") continue;

    const entityId = item.entity.id;
    const materialType = item.entity.type;
    const linkedFile = this.linkedFiles.get(entityId);

    const node: TreeNode = {
      id: entityId,
      type: "material",
      title: item.entity.title || "Untitled",
      icon: getMaterialIcon(materialType),
      entityType: materialType,
      isLinked: !!linkedFile,
      localPath: linkedFile?.path,
      isPullable: isMaterialPullable(materialType),
      updatedAt: item.entity.updatedAt,
      contentPreview: item.entity.content?.plain?.substring(0, 200),
      url: item.entity.url,
    };

    if (item.parentBoardGroupId && groups.has(item.parentBoardGroupId)) {
      groups.get(item.parentBoardGroupId)!.children!.push(node);
    } else {
      rootItems.push(node);
    }
  }

  // 3. 将非空 groups 放在根级列表前面
  const result: TreeNode[] = [];
  for (const group of groups.values()) {
    if (group.children && group.children.length > 0) {
      result.push(group);
    }
  }
  result.push(...rootItems);

  return result;
}
</string,>
```

**构建 Craft 树（**`buildCraftTree`** 方法）：**

`listCrafts` API 返回的数据结构（实际验证过的字段）：

```typescript
// 每个 item 的结构：
interface CraftItem {
  $class: string;                    // "PageDto" | "SlidesDto" | "WebpageDto" | "AudioPodDto" | "CanvasDto" | "CraftGroupDto"
  id: string;
  boardId: string;
  type: string;                      // "page" | "slides" | "webpage" | "audio-pod" | "canvas" | "craft-group"
  title: string;
  visibility: string;
  status: string | null;
  rank: string;
  parentCraftGroupId: string | null;
  parentId: string | null;
  rootId: string;
  metadata?: {
    content?: { lineCount: number };
  };
  content?: { raw: string; plain: string };  // Page 类型有 content（但 list 接口可能截断）
}
```

构建树的逻辑：

```typescript
buildCraftTree(items: CraftItem[]): TreeNode[] {
  const groups: Map<string, treenode=""> = new Map();
  const rootItems: TreeNode[] = [];

  // 第一遍：识别所有 craft-group
  for (const item of items) {
    if (item.type === "craft-group") {
      groups.set(item.id, {
        id: item.id,
        type: "group",
        title: item.title ?? "Untitled Group",
        icon: "folder",
        children: [],
        isLinked: false,
        isPullable: false,
        updatedAt: item.updatedAt ?? "",
        expanded: false,
      });
    }
  }

  // 第二遍：将 crafts 分配到 group 或根级
  for (const item of items) {
    if (item.type === "craft-group") continue;
    // 跳过子页面（只显示根级 page）
    if (item.parentId && item.parentId !== item.rootId) continue;

    const linkedFile = this.linkedFiles.get(item.id);

    const node: TreeNode = {
      id: item.id,
      type: "craft",
      title: item.title || "Untitled",
      icon: getCraftIcon(item.type),
      craftType: item.type,
      isLinked: !!linkedFile,
      localPath: linkedFile?.path,
      isPullable: isCraftPullable(item.type),
      updatedAt: item.updatedAt ?? "",
      contentPreview: item.content?.plain?.substring(0, 200),
    };

    if (item.parentCraftGroupId && groups.has(item.parentCraftGroupId)) {
      groups.get(item.parentCraftGroupId)!.children!.push(node);
    } else {
      rootItems.push(node);
    }
  }

  const result: TreeNode[] = [];
  for (const group of groups.values()) {
    if (group.children && group.children.length > 0) {
      result.push(group);
    }
  }
  result.push(...rootItems);

  return result;
}
</string,>
```

**渲染树节点（**`renderTreeNode`** 方法）：**

每个树节点渲染为以下 DOM 结构：

```html
<!-- 普通 item --><div class="youmind-browser-item" data-id="{id}" data-type="{type}"><div class="youmind-browser-item-row">
    <span class="youmind-browser-item-icon"></span>  <!-- setIcon: node.icon -->
    <span class="youmind-browser-item-title">{title}</span>
    <span class="youmind-browser-item-status"></span>  <!-- 已关联: setIcon "check", 绿色 -->
    <span class="youmind-browser-item-actions">
      <!-- 可拉取 & 未关联: "download" 按钮 (Phase 1.3.3 实现，本轮只预留位置) -->
      <!-- 所有类型: "external-link" 按钮 (在 YouMind 中打开) -->
    </span></div></div>

<!-- Group item --><div class="youmind-browser-group" data-id="{id}"><div class="youmind-browser-group-header">
    <span class="youmind-browser-group-chevron"></span>  <!-- setIcon: "chevron-right" / "chevron-down" -->
    <span class="youmind-browser-group-icon"></span>  <!-- setIcon: "folder" / "folder-open" -->
    <span class="youmind-browser-group-title">{title}</span>
    <span class="youmind-browser-group-count">{children.length}</span></div><div class="youmind-browser-group-children" style="display:none">
    <!-- 子节点递归渲染 --></div></div>
```

**交互行为：**

1. **Tab 切换**：点击 Materials / Crafts tab，切换 `currentTab`，重新渲染列表。切换时保留缓存数据，不重新请求 API。

2. **Group 展开/收起**：点击 group header 切换 `expanded` 状态，展开/收起子列表。展开时 chevron 从 `chevron-right` 变为 `chevron-down`，folder 图标从 `folder` 变为 `folder-open`。

3. **单击 item**：在底部 Preview Panel 中显示内容摘要。如果 `contentPreview` 为空，按需调用 `getMaterial(id)` 或 `getCraft(id)` 获取详情，缓存 10 分钟。

4. **右键 item**：弹出 Obsidian `Menu`，包含：

   - "Open in YouMind"（`external-link` 图标）：`window.open(url)`

   - "Copy YouMind Link"（`link` 图标）：复制 URL 到剪贴板

   - 如果 `isPullable && ! isLinked`："Pull to Vault"（`download` 图标）— **本轮只显示菜单项，onClick 中用 **`new Notice("Pull to Vault will be available in Phase 1.3.3")`** 占位**

   - 如果 `isLinked`："Open Local File"（`file` 图标）：打开本地关联文件

5. **“Open in YouMind” URL 构建**：

   - Material: `https://youmind.com/boards/${boardId}? material-id=${entityId}`

   - Craft: `https://youmind.com/boards/${boardId}? craft-id=${entityId}`

6. **刷新按钮**：点击后调用 `loadData(true)` 强制刷新，刷新按钮添加 CSS 旋转动画（`animation: spin 1s linear`），请求完成后移除动画。

7. **Board 切换联动**：监听 Board 选择器的变更事件。当用户切换 Board 时，清空缓存，重新调用 `loadData()`。Board 名称和图标同步更新。

**Preview Panel 行为：**

```typescript
async showPreview(node: TreeNode): Promise<void> {
  this.previewContainer.style.display = "block";

  // 设置标题和图标
  setIcon(this.previewIconEl, node.icon);
  this.previewTitleEl.textContent = node.title;

  // 设置内容
  let content = node.contentPreview;
  if (!content) {
    // 按需加载详情
    try {
      if (node.type === "material") {
        const detail = await this.plugin.api.getMaterial({ id: node.id });
        content = detail.content?.plain?.substring(0, 500) ?? "No content available";
        node.contentPreview = content;  // 缓存到节点
      } else if (node.type === "craft") {
        const detail = await this.plugin.api.getCraft({ id: node.id });
        content = detail.content?.plain?.substring(0, 500) ?? "No content available";
        node.contentPreview = content;
      }
    } catch {
      content = "Failed to load preview";
    }
  }
  this.previewBodyEl.textContent = content || "No content available";

  // 操作按钮
  this.previewActionsEl.empty();

  if (node.isPullable && !node.isLinked) {
    const pullBtn = this.previewActionsEl.createEl("button", {
      cls: "youmind-browser-preview-btn",
      text: "Pull to Vault",
    });
    setIcon(pullBtn.createSpan({ prepend: true }), "download");
    pullBtn.addEventListener("click", () => {
      new Notice("Pull to Vault will be available in Phase 1.3.3");
    });
  }

  if (node.isLinked && node.localPath) {
    const openLocalBtn = this.previewActionsEl.createEl("button", {
      cls: "youmind-browser-preview-btn",
      text: "Open Local File",
    });
    setIcon(openLocalBtn.createSpan({ prepend: true }), "file");
    openLocalBtn.addEventListener("click", () => {
      const file = this.app.vault.getAbstractFileByPath(node.localPath!);
      if (file instanceof TFile) {
        this.app.workspace.getLeaf(false).openFile(file);
      }
    });
  }

  const openYmBtn = this.previewActionsEl.createEl("button", {
    cls: "youmind-browser-preview-btn",
    text: "Open in YouMind",
  });
  setIcon(openYmBtn.createSpan({ prepend: true }), "external-link");
  openYmBtn.addEventListener("click", () => {
    const boardId = this.plugin.getCurrentBoardId();
    const prefix = node.type === "craft" ? "craft-id" : "material-id";
    window.open(`https://youmind.com/boards/${boardId}?${prefix}=${node.id}`);
  });
}
</void>
```

---

### 2. 修改文件

#### `src/api.ts` — 新增 `listMaterials`、`listCrafts`、`getMaterial`、`getCraft` 方法

> ⚠️ 不要修改已有的 `createNote`、`updateNote`、`sendMessage`、`createChat`、`listBoards`、`moveMaterials` 等方法。

```typescript
// 列出 Board 中的 Materials
async listMaterials(params: {
  boardId: string;
  groupId?: string;
}): Promise<any[]> {
  return this.request("POST", "/openapi/v1/listMaterials", params);
}

// 列出 Board 中的 Crafts
async listCrafts(params: {
  boardId: string;
  groupId?: string;
}): Promise<any[]> {
  return this.request("POST", "/openapi/v1/listCrafts", params);
}

// 获取单个 Material 详情
async getMaterial(params: {
  id: string;
  includeBlocks?: boolean;
}): Promise<any> {
  return this.request("POST", "/openapi/v1/getMaterial", params);
}

// 获取单个 Craft 详情
async getCraft(params: {
  id: string;
  withChildren?: boolean;
}): Promise<any> {
  return this.request("POST", "/openapi/v1/getCraft", params);
}
</any></any></any[]></any[]>
```

#### `src/plugin-class.ts`（或 `src/main.ts`，取决于当前插件入口文件名）— 注册 Browser View

> ⚠️ 不要修改已有的 Chat View 注册、Board 选择器、右键菜单、`active-leaf-change` 监听等逻辑。

在 `onload()` 中新增：

```typescript
// 注册 Browser View
this.registerView(
  BROWSER_VIEW_TYPE,
  (leaf) => new BrowserView(leaf, this)
);

// 添加 Ribbon 按钮打开 Browser
this.addRibbonIcon("library", "YouMind Browser", () => {
  this.activateBrowserView();
});

// 添加命令
this.addCommand({
  id: "open-youmind-browser",
  name: "Open Board Content Browser",
  callback: () => {
    this.activateBrowserView();
  },
});
```

新增 `activateBrowserView` 方法：

```typescript
async activateBrowserView(): Promise<void> {
  const { workspace } = this.app;

  // 检查是否已经打开
  let leaf = workspace.getLeavesOfType(BROWSER_VIEW_TYPE)[0];
  if (!leaf) {
    // 在右侧边栏打开
    const rightLeaf = workspace.getRightLeaf(false);
    if (rightLeaf) {
      await rightLeaf.setViewState({
        type: BROWSER_VIEW_TYPE,
        active: true,
      });
      leaf = rightLeaf;
    }
  }
  if (leaf) {
    workspace.revealLeaf(leaf);
  }
}
</void>
```

**Board 切换事件传递**：

当前 Board 选择器切换 Board 时，需要通知 Browser View 刷新。在 Board 切换的回调中新增：

```typescript
// 在 Board 切换回调中（已有逻辑之后追加）：
const browserLeaves = this.app.workspace.getLeavesOfType(BROWSER_VIEW_TYPE);
for (const leaf of browserLeaves) {
  const view = leaf.view as BrowserView;
  view.onBoardChanged();
}
```

`BrowserView` 中的 `onBoardChanged` 方法：

```typescript
onBoardChanged(): void {
  // 清空缓存
  this.cache = {
    materials: { data: null, timestamp: 0 },
    crafts: { data: null, timestamp: 0 },
  };
  // 更新 header 中的 Board 名称和图标
  this.updateBoardInfo();
  // 重新加载数据
  this.loadData();
}
```

#### `src/types.ts` — 新增类型定义

> ⚠️ 不要修改已有的 `BoardInfo`、`SaveConfirmOptions`、`SyncStatus` 等类型。

```typescript
// Browser View 树节点
export interface TreeNode {
  id: string;
  type: "group" | "material" | "craft";
  title: string;
  icon: string;
  entityType?: string;
  craftType?: string;
  children?: TreeNode[];
  isLinked: boolean;
  localPath?: string;
  isPullable: boolean;
  updatedAt: string;
  contentPreview?: string;
  url?: string;
  expanded?: boolean;
}
```

#### `src/styles.css` — 追加 Browser View 样式

> ⚠️ 不要修改已有的 chat / save-confirm 样式。在文件末尾追加。

```css
/* ============================================
   Browser View
   ============================================ */

.youmind-browser {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* Header */
.youmind-browser-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--background-modifier-border);
}

.youmind-browser-board-info {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.youmind-browser-board-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.youmind-browser-board-icon svg {
  width: 16px;
  height: 16px;
}

.youmind-browser-board-name {
  font-weight: 600;
  font-size: var(--font-ui-small);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.youmind-browser-refresh {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 4px;
  border-radius: var(--radius-s);
  display: flex;
  align-items: center;
}

.youmind-browser-refresh:hover {
  color: var(--text-normal);
  background: var(--background-modifier-hover);
}

.youmind-browser-refresh svg {
  width: 16px;
  height: 16px;
}

.youmind-browser-refresh.is-spinning svg {
  animation: youmind-spin 1s linear infinite;
}

@keyframes youmind-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Tab Bar */
.youmind-browser-tabs {
  display: flex;
  border-bottom: 1px solid var(--background-modifier-border);
  padding: 0 8px;
}

.youmind-browser-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  transition: color 0.15s, border-color 0.15s;
}

.youmind-browser-tab:hover {
  color: var(--text-normal);
}

.youmind-browser-tab.is-active {
  color: var(--text-normal);
  border-bottom-color: var(--interactive-accent);
}

.youmind-browser-tab svg {
  width: 14px;
  height: 14px;
}

.youmind-browser-tab-count {
  font-size: var(--font-ui-smaller);
  color: var(--text-faint);
  background: var(--background-modifier-hover);
  padding: 0 5px;
  border-radius: var(--radius-s);
  min-width: 18px;
  text-align: center;
}

/* Content List */
.youmind-browser-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

/* Loading & Empty States */
.youmind-browser-loading,
.youmind-browser-empty,
.youmind-browser-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 16px;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

.youmind-browser-loading svg,
.youmind-browser-empty svg,
.youmind-browser-error svg {
  width: 24px;
  height: 24px;
}

.youmind-browser-loading svg {
  animation: youmind-spin 1s linear infinite;
}

.youmind-browser-error svg {
  color: var(--text-error);
}

/* Tree Items */
.youmind-browser-item {
  padding: 0 8px;
}

.youmind-browser-item-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: var(--radius-s);
  cursor: pointer;
  transition: background 0.1s;
}

.youmind-browser-item-row:hover {
  background: var(--background-modifier-hover);
}

.youmind-browser-item-row.is-selected {
  background: var(--background-modifier-active-hover);
}

.youmind-browser-item-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.youmind-browser-item-icon svg {
  width: 16px;
  height: 16px;
}

.youmind-browser-item-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-ui-small);
}

.youmind-browser-item-status {
  flex-shrink: 0;
  color: var(--color-green);
}

.youmind-browser-item-status svg {
  width: 12px;
  height: 12px;
}

.youmind-browser-item-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s;
}

.youmind-browser-item-row:hover .youmind-browser-item-actions {
  opacity: 1;
}

.youmind-browser-item-actions button {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 2px;
  border-radius: var(--radius-s);
  display: flex;
  align-items: center;
}

.youmind-browser-item-actions button:hover {
  color: var(--text-normal);
  background: var(--background-modifier-hover);
}

.youmind-browser-item-actions button svg {
  width: 14px;
  height: 14px;
}

/* Group Items */
.youmind-browser-group {
  padding: 0 8px;
}

.youmind-browser-group-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: var(--radius-s);
  cursor: pointer;
  transition: background 0.1s;
}

.youmind-browser-group-header:hover {
  background: var(--background-modifier-hover);
}

.youmind-browser-group-chevron {
  flex-shrink: 0;
  color: var(--text-faint);
}

.youmind-browser-group-chevron svg {
  width: 12px;
  height: 12px;
  transition: transform 0.15s;
}

.youmind-browser-group.is-expanded > .youmind-browser-group-header .youmind-browser-group-chevron svg {
  transform: rotate(90deg);
}

.youmind-browser-group-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.youmind-browser-group-icon svg {
  width: 16px;
  height: 16px;
}

.youmind-browser-group-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-ui-small);
  font-weight: 500;
}

.youmind-browser-group-count {
  font-size: var(--font-ui-smaller);
  color: var(--text-faint);
}

.youmind-browser-group-children {
  padding-left: 16px;
}

/* Preview Panel */
.youmind-browser-preview {
  border-top: 1px solid var(--background-modifier-border);
  max-height: 40%;
  overflow-y: auto;
  flex-shrink: 0;
}

.youmind-browser-preview-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--background-modifier-border);
}

.youmind-browser-preview-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.youmind-browser-preview-icon svg {
  width: 16px;
  height: 16px;
}

.youmind-browser-preview-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  font-size: var(--font-ui-small);
}

.youmind-browser-preview-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 2px;
  border-radius: var(--radius-s);
  display: flex;
}

.youmind-browser-preview-close:hover {
  color: var(--text-normal);
  background: var(--background-modifier-hover);
}

.youmind-browser-preview-close svg {
  width: 14px;
  height: 14px;
}

.youmind-browser-preview-body {
  padding: 8px 12px;
  font-size: var(--font-ui-small);
  color: var(--text-muted);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 150px;
  overflow-y: auto;
}

.youmind-browser-preview-actions {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--background-modifier-border);
}

.youmind-browser-preview-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--radius-s);
  border: 1px solid var(--background-modifier-border);
  background: var(--background-primary);
  cursor: pointer;
  font-size: var(--font-ui-smaller);
  color: var(--text-normal);
  transition: background 0.1s, border-color 0.1s;
}

.youmind-browser-preview-btn:hover {
  background: var(--background-modifier-hover);
  border-color: var(--background-modifier-border-hover);
}

.youmind-browser-preview-btn svg {
  width: 14px;
  height: 14px;
}
```

---

### 3. 不做的事情

- ❌ 不实现 Pull to Vault 的实际拉取逻辑（Phase 1.3.3）

- ❌ 不实现语义搜索面板（Phase 1.3.5）

- ❌ 不实现批量拉取

- ❌ 不实现拖拽排序

- ❌ 不实现 Material / Craft 的创建、删除、编辑操作

- ❌ 不修改 Save 拆分逻辑

- ❌ 不修改 Push 三层入口逻辑

- ❌ 不修改 Save Confirm Panel 逻辑

- ❌ 不修改 Chat View 逻辑

- ❌ 不引入子目录结构（保持扁平 `src/`）

---

## Icon 映射总表

| 场景 | Lucide 图标名 | 用途 |
| --- | --- | --- |
| Browser View 图标 | `library` | View 标签页图标 |
| 刷新按钮 | `refresh-cw` | Header 刷新 |
| Materials Tab | `file-text` | Tab 图标 |
| Crafts Tab | `pen-tool` | Tab 图标 |
| Loading | `loader` | 加载动画（带 spin） |
| Empty State | `inbox` | 空状态 |
| Error State | `alert-circle` | 错误状态 |
| Group 展开 | `chevron-right` / `chevron-down` | 展开/收起指示 |
| Group 图标 | `folder` / `folder-open` | 文件夹 |
| Article | `globe` | 网页文章 |
| Note | `sticky-note` | 用户笔记 |
| Image | `image` | 图片 |
| Voice | `headphones` | 音频 |
| Video | `video` | 视频 |
| PDF | `file-text` | PDF 文件 |
| Office | `file-spreadsheet` | Office 文件 |
| Text File | `file-code` | 文本文件 |
| Snippet | `scissors` | 摘录片段 |
| Page (Craft) | `file-edit` | 文档 |
| Slides (Craft) | `presentation` | 幻灯片 |
| Webpage (Craft) | `layout` | 网页 |
| AudioPod (Craft) | `podcast` | 播客 |
| Canvas (Craft) | `frame` | 画布 |
| 已关联标记 | `check` | 绿色小勾 |
| Pull 按钮 | `download` | 拉取到本地 |
| Open in YM | `external-link` | 在 YouMind 中打开 |
| Copy Link | `link` | 复制链接 |
| Open Local | `file` | 打开本地文件 |
| Preview 关闭 | `x` | 关闭预览面板 |

---

## API Schema 参考

### `listMaterials`

```plaintext
POST /openapi/v1/listMaterials
Body: { boardId: string, groupId?: string }
Returns: Array<materialboarditem>  (见上方数据模型)
</materialboarditem>
```

### `listCrafts`

```plaintext
POST /openapi/v1/listCrafts
Body: { boardId: string, groupId?: string }
Returns: Array<craftitem>  (见上方数据模型)
</craftitem>
```

### `getMaterial`

```plaintext
POST /openapi/v1/getMaterial
Body: { id: string, includeBlocks?: boolean }
Returns: MaterialDto (多态，通过 $class 区分)
```

### `getCraft`

```plaintext
POST /openapi/v1/getCraft
Body: { id: string, withChildren?: boolean }
Returns: CraftDto (多态，通过 $class 区分)
```

---

## 验收标准

### A. View 注册与打开

- [ ]  Ribbon 栏出现 `library` 图标按钮，点击后在右侧边栏打开 Browser View

- [ ]  命令面板中出现 “Open Board Content Browser” 命令

- [ ]  重复点击不会打开多个 Browser View（复用已有 leaf）

- [ ]  View 标签页显示 “YouMind Browser” 标题和 `library` 图标

### B. 数据加载与展示

- [ ]  打开 Browser View 后自动加载当前 Board 的 Materials 和 Crafts

- [ ]  Materials Tab 显示正确的项目数量（Tab 计数）

- [ ]  Crafts Tab 显示正确的项目数量

- [ ]  每个 item 显示正确的类型图标

- [ ]  MaterialGroup / CraftGroup 显示为可展开的文件夹节点

- [ ]  Group 内的子项正确嵌套显示

- [ ]  已关联本地文件的 item 显示绿色 `check` 标记

### C. 交互

- [ ]  点击 Tab 切换 Materials / Crafts 列表

- [ ]  点击 Group header 展开/收起子列表

- [ ]  单击 item 在底部 Preview Panel 显示内容摘要

- [ ]  右键 item 弹出上下文菜单

- [ ]  “Open in YouMind” 在浏览器中打开正确的 URL

- [ ]  “Copy YouMind Link” 复制正确的 URL 到剪贴板

- [ ]  已关联 item 右键菜单包含 “Open Local File”，点击后打开本地文件

### D. Board 联动与缓存

- [ ]  切换 Board 后 Browser View 自动刷新，显示新 Board 的内容

- [ ]  Header 中的 Board 名称随切换更新

- [ ]  刷新按钮点击后重新加载数据，按钮显示旋转动画

- [ ]  5 分钟内切换 Tab 不重新请求 API（使用缓存）

- [ ]  强制刷新后缓存被清空

### E. 边界情况

- [ ]  空 Board（无 Materials 和 Crafts）显示空状态提示

- [ ]  未选择 Board 时显示 “No board selected” 提示

- [ ]  API 请求失败时显示错误状态，不崩溃

- [ ]  大量 items（100+）时列表滚动流畅

- [ ]  `npm run build` 通过，无类型错误