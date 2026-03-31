# Phase 1.3.3 — Pull to Vault (Codex 指令)
# Phase 1.3.3 — Pull to Vault (Codex 指令)


## 前置状态（已完成，不要重复实现）

以下功能已在前几轮中完成并通过验证，**本轮不要修改这些已有逻辑**：

- ✅ Chat View（对话、历史、消息操作栏）

- ✅ Board 选择器（下拉切换 Board，上下文隔离）

- ✅ Pick 摘录（消息级 + 选区级）

- ✅ Save 动作拆分（“Save to Vault” / “Save as YouMind Note”）

- ✅ Push 三层入口（命令面板 / 右键菜单 / 编辑器按钮）

- ✅ Frontmatter Manager（读写 `youmind_id`、`youmind_board`、`youmind_type`、`youmind_synced_at`、`youmind_source`）

- ✅ `getSyncStatus(file)` 三态判断（`unlinked` / `synced` / `modified`）

- ✅ Save Confirm Panel（保存确认浮层，支持事后切换 Board）

- ✅ Browser View（`src/browser-view.ts`）— 侧边栏 ItemView，展示 Materials / Crafts 树，Pull 按钮目前是占位 Notice

- ✅ API 方法：`listMaterials`、`listCrafts`、`getMaterial`、`getCraft`、`createNote`、`updateNote`、`moveMaterials`、`listBoards`

---

## 本轮目标（三合一）

本轮同时完成以下三件事：

### A. Browser View Hotfix（修复 1.3.2 的三个缺陷）

| # | 问题 | 根因 |
| --- | --- | --- |
| BUG-1 | 所有 MaterialGroup 文件夹名称显示为 “Untitled Group” | `buildMaterialTree` 读取 `entity.title`，但 `BoardGroupDto` 的名称字段是 `entity.name` |
| BUG-2 | Preview Panel 只显示截断的纯文本摘要，不能滚动阅读完整内容，图片/网页等类型预览为空白 | `showPreview` 只取 `content.plain` 前几百字做摘要，所有类型走同一套纯文本渲染，没有按类型分发 |
| BUG-3 | Preview Panel 不能拖拽调整大小 | 没有 resizer 分隔条 |

### B. Pull to Vault 核心逻辑

实现内容转换器和拉取服务，把 YouMind 云端的 Material / Craft 内容拉取到本地 Obsidian Vault，建立 frontmatter 关联。

### C. Pull Confirm Panel

Pull 完成后弹出确认浮层（镜像 Save Confirm Panel 的设计），显示文件拉取到了哪个路径，用户可以选择移到 Vault 内的任意文件夹。

**用户价值**：用户第一次能把 YouMind Board 里的内容变成本地 Markdown 文件，在 Obsidian 里阅读、编辑、搜索，并且可以灵活地把拉取的文件放到 Vault 内任意位置。

---

## 约束

- 所有图标使用 Obsidian 内置的 **Lucide** 图标库，通过 `import { setIcon } from "obsidian"` 调用，**绝不使用 emoji**

- 保持现有文件结构不变（扁平 `src/` 目录）

- `npm run build` 必须通过

- 不破坏已有的 chat / history / board / pick / save / push / browser 功能

---

## 变更清单

---

### Part A: Browser View Hotfix

> 以下修改全部在 `src/browser-view.ts` 和 `styles.css` 中进行，不碰其他文件。

#### A1. 修复 MaterialGroup 名称（BUG-1）

**问题**：`listMaterials` API 返回的 `entityType === "board_group"` 条目，其 entity 对象是 `BoardGroupDto`，名称字段是 `entity.name`，不是 `entity.title`（`title` 为 undefined 或 null）。

**修复**：在 `src/browser-view.ts` 的 `buildMaterialTree` 方法中，找到第一遍循环里创建 group 节点的代码，修改 `title` 的取值：

```typescript
// 修复前：
title: item.entity.title ?? "Untitled Group",

// 修复后：
title: item.entity.name ?? item.entity.title ?? "Untitled Group",
```

**只改这一行。** CraftGroup 不需要改（它用的就是 `item.title`，`listCrafts` 返回的 `CraftGroupDto` 确实用 `title` 字段）。

#### A2. Preview Panel 按类型智能预览（BUG-2）

**问题本质**：三层问题叠加。① `showPreview` 只取 `content.plain` 前几百字做纯文本摘要，内容截断；② 所有类型走同一套纯文本渲染，图片/网页等类型预览为空白；③ CSS 写死 `max-height: 150px`，拖大面板后下方全是空白。

**目标效果**：Preview Panel 根据 Material 类型智能切换渲染模式——文本类走 Markdown 渲染（可滚动阅读全文），图片类直接显示图片，网页类显示正文+来源按钮，不可预览类型显示“Open in Browser”按钮。拖拽 resizer 时内容区域自适应。

**类型分发总览**：

| Material 类型 | Preview 模式 | 效果 |
| --- | --- | --- |
| Note / Article / PDF / Text | Markdown 渲染 | 完整文本，可滚动阅读，格式完整 |
| Image | 图片预览 | 直接显示图片（自适应宽度），下方显示描述文本 |
| Voice / Video | 概要 + 转录 Markdown | 顶部有播放源链接按钮，下方渲染概要和转录文本 |
| Office / Slides / Webpage / Canvas | Fallback | 类型图标 + 标题 + “Open in Browser” 按钮 |
| Craft (Page) | Markdown 渲染 | 同文本类 |

**修复分三层：数据获取 + 按类型分发 → 渲染器 → CSS 自适应。**

**A2a. 数据获取 + 按类型分发**

修改 `showPreview` 方法，把截断的摘要替换为完整内容获取 + 类型分发：

```typescript
// ===== 修复前（示意）=====
// showPreview 中获取预览内容的部分：
const previewText = node.content?.substring(0, 500) || "No content";
this.previewBody.textContent = previewText;

// ===== 修复后 =====
// 1. 先显示 loading 占位
this.previewBody.empty();
this.previewBody.textContent = "Loading...";

// 2. 异步获取完整内容并按类型渲染
this.loadFullPreview(node);
```

新增属性和核心分发方法：

```typescript
private currentPreviewId: string | null = null;  // 防止竞态

private async loadFullPreview(node: TreeNode): Promise<void> {
  this.currentPreviewId = node.id;

  try {
    if (node.type === "craft") {
      // Craft (Page) → 统一走 Markdown 渲染
      const detail = await this.plugin.api.getCraft({ id: node.id });
      if (this.currentPreviewId !== node.id) return;
      const content = detail?.content?.plain ?? detail?.content ?? "";
      await this.renderMarkdownPreview(content);
      return;
    }

    // Material → 按 subType 分发
    const detail = await this.plugin.api.getMaterial({ id: node.id, includeBlocks: true });
    if (this.currentPreviewId !== node.id) return;
    if (!detail) {
      this.renderFallbackPreview(node);
      return;
    }

    const materialType: string = detail.type || node.subType || "";

    switch (materialType) {
      case "note":
      case "article":
      case "pdf":
      case "text-file":
        await this.renderTextPreview(detail);
        break;
      case "image":
        this.renderImagePreview(detail);
        break;
      case "voice":
      case "video":
        await this.renderMediaPreview(detail);
        break;
      default:
        // Office, Slides, Webpage, Canvas 等不可预览类型
        this.renderFallbackPreview(node, detail);
        break;
    }

  } catch (error) {
    console.error("[YouMind Preview]", error);
    if (this.currentPreviewId === node.id) {
      this.previewBody.empty();
      this.previewBody.textContent = "Failed to load preview";
    }
  }
}
</void>
```

**A2b. 各类型渲染器**

在文件顶部添加 import：

```typescript
import { MarkdownRenderer } from "obsidian";
```

**① 文本类渲染器（Note / Article / PDF / Text）**

加载完整 Markdown 正文，可滚动阅读，格式完整渲染：

```typescript
private async renderTextPreview(material: any): Promise<void> {
  const parts: string[] = [];

  // 来源 URL（Note 不需要）
  if (material.url && material.type !== "note") {
    parts.push(`> Source: [${material.url}](${material.url})`);
    parts.push("");
  }

  // Overview block（PDF 等）
  const overviewBlock = material.blocks?.find((b: any) => b.type === "overview");
  if (overviewBlock?.content?.plain) {
    parts.push("## Overview");
    parts.push("");
    parts.push(overviewBlock.content.plain);
    parts.push("");
  }

  // 正文
  const body = material.content?.plain ?? material.content ?? "";
  if (body) {
    parts.push(body);
  }

  const markdown = parts.join("
") || "No content available";
  await this.renderMarkdownPreview(markdown);
}
</void>
```

**② 图片渲染器（Image）**

直接在 Preview body 中显示图片，图片自适应宽度（max-width: 100%），下方显示描述文本（如果有）。

> **⚠️ 关键：ImageDto 的真实图片 URL 在 **`file.url`** 字段**
>
> 通过 `getMaterial` 拿到的 ImageDto 结构如下（已验证）：
>
> ```plaintext
> {
>   "$class": "ImageDto",
>   "type": "image",
>   "url": undefined,          // ← 顶层没有 url
>   "albumUrl": undefined,     // ← 也没有 albumUrl
>   "file": {
>     "name": "image.png",
>     "mimeType": "image/png",
>     "storageUrl": "https://youmind-user-files-private.s3...",  // S3 私有地址
>     "url": "https://cdn.gooo.ai/user-files/xxx?Expires=...&Signature=..."  // ← 真实图片 URL
>   }
> }
> ```
>
> 所以必须优先读 `material.file?.url`，否则图片预览和 Pull 保存都会是空白。

```typescript
/**
 * 从 Material DTO 中提取图片 URL
 * ImageDto 的真实图片地址在 file.url（带签名的 CDN 链接），
 * 顶层 url/albumUrl 对于 file 来源的图片是 undefined。
 * 查找优先级：file.url → url → albumUrl → file.storageUrl
 */
private resolveImageUrl(material: any): string {
  return material.file?.url
    ?? material.url
    ?? material.albumUrl
    ?? material.file?.storageUrl
    ?? "";
}

private renderImagePreview(material: any): void {
  this.previewBody.empty();
  this.previewBody.addClass("is-image-preview");

  const imageUrl = this.resolveImageUrl(material);

  if (imageUrl) {
    const imgContainer = this.previewBody.createDiv({ cls: "youmind-preview-image-container" });
    const img = imgContainer.createEl("img", {
      attr: {
        src: imageUrl,
        alt: material.title || "Image preview",
      },
    });

    // 图片加载失败时显示 fallback
    img.addEventListener("error", () => {
      imgContainer.empty();
      imgContainer.textContent = "Image failed to load";
      imgContainer.addClass("is-error");
    });
  }

  // 描述文本
  const description = material.content?.plain ?? material.content ?? "";
  if (description) {
    const descEl = this.previewBody.createDiv({ cls: "youmind-preview-image-desc" });
    descEl.textContent = description;
  }

  // 如果既没有图片也没有描述
  if (!imageUrl && !description) {
    this.previewBody.textContent = "No image available";
  }
}
```

**③ 音视频渲染器（Voice / Video）**

显示概要 + 转录文本（Markdown 渲染），顶部有播放源链接按钮：

```typescript
private async renderMediaPreview(material: any): Promise<void> {
  this.previewBody.empty();

  // 顶部：来源链接按钮（如果有 URL）
  if (material.url) {
    const sourceBar = this.previewBody.createDiv({ cls: "youmind-preview-source-bar" });
    const sourceBtn = sourceBar.createEl("a", {
      cls: "youmind-preview-source-btn",
      attr: { href: material.url, target: "_blank" },
    });
    const btnIcon = sourceBtn.createSpan();
    setIcon(btnIcon, material.type === "video" ? "play-circle" : "headphones");
    sourceBtn.createSpan({ text: `Open ${material.type === "video" ? "Video" : "Audio"} Source` });
  }

  // 正文区域：概要 + 转录
  const parts: string[] = [];

  const overviewBlock = material.blocks?.find((b: any) => b.type === "overview");
  if (overviewBlock?.content?.plain) {
    parts.push("## Overview");
    parts.push("");
    parts.push(overviewBlock.content.plain);
    parts.push("");
  }

  const transcriptBlock = material.blocks?.find((b: any) => b.type === "transcript");
  if (transcriptBlock?.content?.plain) {
    parts.push("## Transcript");
    parts.push("");
    parts.push(transcriptBlock.content.plain);
  }

  // 如果没有 blocks，用 content 兜底
  if (parts.length === 0) {
    const fallback = material.content?.plain ?? material.content ?? "";
    if (fallback) {
      parts.push(fallback);
    }
  }

  if (parts.length > 0) {
    const contentEl = this.previewBody.createDiv({ cls: "youmind-preview-media-content" });
    await MarkdownRenderer.render(
      this.app,
      parts.join("
"),
      contentEl,
      "",
      this
    );
  } else {
    const emptyEl = this.previewBody.createDiv({ cls: "youmind-preview-empty" });
    emptyEl.textContent = `This ${material.type} has no transcript yet.`;
  }
}
</void>
```

**④ 不可预览类型的 Fallback 渲染器（Office / Slides / Webpage / Canvas 等）**

显示类型图标 + 标题 + “Open in Browser” 按钮：

```typescript
private renderFallbackPreview(node: TreeNode, material?: any): void {
  this.previewBody.empty();
  this.previewBody.addClass("is-fallback-preview");

  const wrapper = this.previewBody.createDiv({ cls: "youmind-preview-fallback" });

  // 类型图标
  const iconEl = wrapper.createDiv({ cls: "youmind-preview-fallback-icon" });
  const iconName = this.getTypeIcon(material?.type || node.subType || "");
  setIcon(iconEl, iconName);

  // 标题
  const titleEl = wrapper.createDiv({ cls: "youmind-preview-fallback-title" });
  titleEl.textContent = node.title || material?.title || "Untitled";

  // 类型标签
  const typeEl = wrapper.createDiv({ cls: "youmind-preview-fallback-type" });
  typeEl.textContent = (material?.type || node.subType || "unknown").toUpperCase();

  // "Open in Browser" 按钮
  const url = material?.url;
  if (url) {
    const btnEl = wrapper.createEl("a", {
      cls: "youmind-preview-fallback-btn",
      attr: { href: url, target: "_blank" },
    });
    const btnIconEl = btnEl.createSpan();
    setIcon(btnIconEl, "external-link");
    btnEl.createSpan({ text: "Open in Browser" });
  }

  // 如果没有外部 URL，提供 YouMind 链接
  if (!url && node.id) {
    const ymUrl = `https://youmind.com/materials/${node.id}`;
    const btnEl = wrapper.createEl("a", {
      cls: "youmind-preview-fallback-btn",
      attr: { href: ymUrl, target: "_blank" },
    });
    const btnIconEl = btnEl.createSpan();
    setIcon(btnIconEl, "external-link");
    btnEl.createSpan({ text: "Open in YouMind" });
  }
}

/**
 * 根据 material type 返回对应的 Lucide 图标名
 */
private getTypeIcon(type: string): string {
  const iconMap: Record<string, string=""> = {
    note: "file-text",
    article: "globe",
    image: "image",
    voice: "headphones",
    video: "play-circle",
    pdf: "file-text",
    "text-file": "file-text",
    office: "file-spreadsheet",
    slides: "presentation",
    webpage: "layout",
    canvas: "layout-dashboard",
  };
  return iconMap[type] || "file";
}
</string,>
```

**⑤ 通用 Markdown 渲染方法（供文本类和 Craft 共用）**

```typescript
private async renderMarkdownPreview(markdown: string): Promise<void> {
  this.previewBody.empty();

  await MarkdownRenderer.render(
    this.app,
    markdown,
    this.previewBody,
    "",       // sourcePath（Preview 不需要解析相对链接，传空）
    this      // component（用于生命周期管理）
  );
}
</void>
```

> **为什么用 **`MarkdownRenderer.render`** 而不是第三方库？**
>
> - Obsidian 内置，零依赖
>
> - 自动继承用户的主题样式（暗色/亮色、字体、代码高亮）
>
> - 支持 callouts、代码块语法高亮、数学公式等 Obsidian 特有语法
>
> - `this`（Component）参数确保渲染的子组件在 Preview 关闭时自动清理

**A2c. CSS 自适应**

修改 `styles.css` 中的两个样式块：

`.youmind-browser-preview`：

```css
/* ===== 修复前 ===== */
.youmind-browser-preview {
  border-top: 1px solid var(--background-modifier-border);
  max-height: 40%;
  overflow-y: auto;
  flex-shrink: 0;
}

/* ===== 修复后 ===== */
.youmind-browser-preview {
  border-top: none;
  min-height: 80px;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}
```

`.youmind-browser-preview-body`：

```css
/* ===== 修复前 ===== */
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

/* ===== 修复后 ===== */
.youmind-browser-preview-body {
  padding: 8px 12px;
  font-size: var(--font-ui-small);
  line-height: 1.6;
  word-break: break-word;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
```

> 修复后的 body 样式说明：
>
> - 移除 `white-space: pre-wrap`（Markdown 渲染后不需要保留原始换行）
>
> - 移除 `color: var(--text-muted)`（让渲染内容继承 Obsidian 主题正常文字颜色）
>
> - `line-height` 调整为 1.6（与 Obsidian 默认阅读视图一致）
>
> - `flex: 1` + `min-height: 0` 确保内容区域填满 Preview 面板剩余空间
>
> - `overflow-y: auto` 内容超出时显示滚动条

**A2d. Preview 类型特化 CSS**

追加到 `styles.css`：

```css
/* ============================================
   Preview — Markdown 渲染微调
   ============================================ */
.youmind-browser-preview-body p {
  margin: 0.4em 0;
}

.youmind-browser-preview-body h1,
.youmind-browser-preview-body h2,
.youmind-browser-preview-body h3,
.youmind-browser-preview-body h4 {
  margin: 0.6em 0 0.3em;
  font-size: 1em;
  font-weight: 600;
}

.youmind-browser-preview-body h1 { font-size: 1.2em; }
.youmind-browser-preview-body h2 { font-size: 1.1em; }

.youmind-browser-preview-body pre {
  font-size: 0.85em;
  padding: 6px 8px;
  border-radius: 4px;
  overflow-x: auto;
}

.youmind-browser-preview-body blockquote {
  margin: 0.4em 0;
  padding-left: 10px;
  border-left: 2px solid var(--text-faint);
  color: var(--text-muted);
}

.youmind-browser-preview-body ul,
.youmind-browser-preview-body ol {
  margin: 0.3em 0;
  padding-left: 1.5em;
}

/* ============================================
   Preview — 图片类型
   ============================================ */
.youmind-preview-image-container {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 4px 0;
}

.youmind-preview-image-container img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
}

.youmind-preview-image-container.is-error {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80px;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

.youmind-preview-image-desc {
  padding: 8px 0 0;
  font-size: var(--font-ui-small);
  color: var(--text-muted);
  line-height: 1.5;
}

/* ============================================
   Preview — 音视频来源按钮
   ============================================ */
.youmind-preview-source-bar {
  padding: 0 0 8px;
  border-bottom: 1px solid var(--background-modifier-border);
  margin-bottom: 8px;
}

.youmind-preview-source-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  background: var(--background-secondary);
  color: var(--text-normal);
  font-size: var(--font-ui-smaller);
  text-decoration: none;
  cursor: pointer;
}

.youmind-preview-source-btn:hover {
  background: var(--background-modifier-hover);
}

.youmind-preview-source-btn svg {
  width: 14px;
  height: 14px;
}

.youmind-preview-media-content {
  flex: 1;
  min-height: 0;
}

.youmind-preview-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60px;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

/* ============================================
   Preview — Fallback（不可预览类型）
   ============================================ */
.youmind-preview-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px 16px;
  min-height: 120px;
}

.youmind-preview-fallback-icon {
  color: var(--text-faint);
}

.youmind-preview-fallback-icon svg {
  width: 36px;
  height: 36px;
}

.youmind-preview-fallback-title {
  font-weight: 500;
  font-size: var(--font-ui-small);
  color: var(--text-normal);
  text-align: center;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.youmind-preview-fallback-type {
  font-size: var(--font-ui-smaller);
  color: var(--text-faint);
  letter-spacing: 0.5px;
}

.youmind-preview-fallback-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 6px;
  background: var(--interactive-accent);
  color: var(--text-on-accent);
  font-size: var(--font-ui-small);
  text-decoration: none;
  cursor: pointer;
  margin-top: 4px;
}

.youmind-preview-fallback-btn:hover {
  background: var(--interactive-accent-hover);
}

.youmind-preview-fallback-btn svg {
  width: 14px;
  height: 14px;
}
```

#### A3. Preview Panel 可拖拽调整大小（BUG-3）

**A3a. 新增属性和 DOM 元素**

在 `BrowserView` 类中新增属性：

```typescript
private resizerEl: HTMLElement;
private previewHeight: number = 200;
```

在 `onOpen` 方法中，在 `listContainer` 和 `previewContainer` 之间插入 resizer：

```typescript
// 在创建完 listContainer 之后、创建 previewContainer 之前：
this.resizerEl = contentEl.createDiv({ cls: "youmind-browser-resizer" });
```

**A3b. 拖拽逻辑**

在 `onOpen` 末尾调用 `this.setupResizer()`，新增方法：

```typescript
private setupResizer(): void {
  let startY = 0;
  let startHeight = 0;

  const onMouseMove = (e: MouseEvent) => {
    const delta = startY - e.clientY;
    const newHeight = Math.max(80, Math.min(startHeight + delta, this.containerEl.clientHeight * 0.7));
    this.previewHeight = newHeight;
    this.previewContainer.style.height = `${newHeight}px`;
    e.preventDefault();
  };

  const onMouseUp = () => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    this.resizerEl.removeClass("is-dragging");
    document.body.removeClass("youmind-resizing");
  };

  this.resizerEl.addEventListener("mousedown", (e: MouseEvent) => {
    startY = e.clientY;
    startHeight = this.previewContainer.clientHeight || this.previewHeight;
    this.resizerEl.addClass("is-dragging");
    document.body.addClass("youmind-resizing");
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    e.preventDefault();
  });
}
```

**A3c. 修改 showPreview / close**

```typescript
// showPreview 方法开头，修改 display 设置：
// 修复前：
this.previewContainer.style.display = "block";
// 修复后：
this.previewContainer.style.display = "flex";
this.previewContainer.style.height = `${this.previewHeight}px`;
this.resizerEl.style.display = "block";

// preview close 按钮的事件处理中，追加：
this.resizerEl.style.display = "none";
```

**A3d. 新增 CSS（追加到 styles.css）**

```css
/* Resizer between list and preview */
.youmind-browser-resizer {
  height: 6px;
  cursor: ns-resize;
  flex-shrink: 0;
  display: none;
  position: relative;
  background: transparent;
}

.youmind-browser-resizer::after {
  content: "";
  position: absolute;
  left: 25%;
  right: 25%;
  top: 50%;
  height: 2px;
  border-radius: 1px;
  background: var(--background-modifier-border);
  transition: background 0.15s;
}

.youmind-browser-resizer:hover::after,
.youmind-browser-resizer.is-dragging::after {
  background: var(--interactive-accent);
}

body.youmind-resizing {
  cursor: ns-resize !important;
  user-select: none !important;
}
```

---

### Part B: Pull to Vault 核心逻辑

#### B1. 新增文件 `src/content-converter.ts`

负责 YouMind 内容和本地 Markdown 之间的双向转换。纯逻辑模块，不涉及 UI。

```typescript
import { YouMindFrontmatter } from "./types";

export class ContentConverter {

  /**
   * 将 YouMind Material 转换为本地 Markdown
   */
  materialToMarkdown(material: any, boardId: string): ConvertedContent {
    const type: string = material.type;

    switch (type) {
      case "note":
        return this.convertNote(material, boardId);
      case "article":
        return this.convertArticle(material, boardId);
      case "image":
        return this.convertImage(material, boardId);
      case "voice":
      case "video":
        return this.convertMediaTranscript(material, boardId);
      case "pdf":
        return this.convertPdfSummary(material, boardId);
      case "text-file":
        return this.convertTextFile(material, boardId);
      default:
        return this.convertFallback(material, boardId);
    }
  }

  /**
   * 将 YouMind Craft (Page) 转换为本地 Markdown
   */
  craftToMarkdown(craft: any, boardId: string): ConvertedContent {
    const content = craft.content?.plain ?? craft.content ?? "";
    return {
      markdown: content,
      frontmatter: this.buildFrontmatter(craft.id, boardId, "page", "pull"),
      suggestedFileName: this.sanitizeFileName(craft.title || "Untitled Page"),
      subfolder: "crafts",
    };
  }

  /**
   * 将本地 Markdown 转换为 YouMind Note 内容
   * 剥离 frontmatter，转换 Obsidian 特有语法
   */
  markdownToNote(rawContent: string): string {
    let content = rawContent;

    // 1. 剥离 frontmatter（--- ... ---）
    const fmRegex = /^---
[\s\S]*?
---
?/;
    content = content.replace(fmRegex, "");

    // 2. 转换 Obsidian 内部链接
    // [[link|display]] → display
    content = content.replace(/\[\[([^\]]*?)\|([^\]]*?)\]\]/g, "$2");
    // [[link]] → link
    content = content.replace(/\[\[([^\]]*?)\]\]/g, "$1");

    // 3. 转换嵌入
    // ![[embedded note]] → > Embedded: embedded note
    content = content.replace(/!\[\[([^\]]*?)\]\]/g, "> Embedded: $1");

    // 4. 移除 Obsidian 注释
    // %%comment%% → (移除)
    content = content.replace(/%%[\s\S]*?%%/g, "");

    // 5. 保留 callouts、tags、标准 markdown
    return content.trim();
  }

  // ─── 私有转换方法 ───

  private convertNote(material: any, boardId: string): ConvertedContent {
    const content = material.content?.plain ?? material.content ?? "";
    return {
      markdown: content,
      frontmatter: this.buildFrontmatter(material.id, boardId, "note", "pull"),
      suggestedFileName: this.sanitizeFileName(material.title || "Untitled Note"),
      subfolder: "materials",
    };
  }

  private convertArticle(material: any, boardId: string): ConvertedContent {
    const parts: string[] = [];

    if (material.url) {
      parts.push(`> Source: ${material.url}`);
      parts.push("");
    }

    const body = material.content?.plain ?? material.content ?? "";
    if (body) {
      parts.push(body);
    }

    return {
      markdown: parts.join("
"),
      frontmatter: this.buildFrontmatter(material.id, boardId, "article", "pull"),
      suggestedFileName: this.sanitizeFileName(material.title || "Untitled Article"),
      subfolder: "materials",
    };
  }

  /**
   * 从 Material DTO 中提取图片 URL
   * ImageDto 的真实图片地址在 file.url（带签名的 CDN 链接），
   * 顶层 url/albumUrl 对于 file 来源的图片是 undefined。
   * 查找优先级：file.url → url → albumUrl → file.storageUrl
   *
   * 已验证的 ImageDto 结构：
   * {
   *   "$class": "ImageDto",
   *   "url": undefined,       // 顶层没有
   *   "file": {
   *     "url": "https://cdn.gooo.ai/user-files/xxx?Expires=...&Signature=...",  // ← 真实地址
   *     "storageUrl": "https://youmind-user-files-private.s3..."                // S3 兜底
   *   }
   * }
   */
  private resolveImageUrl(material: any): string {
    return material.file?.url
      ?? material.url
      ?? material.albumUrl
      ?? material.file?.storageUrl
      ?? "";
  }

  private convertImage(material: any, boardId: string): ConvertedContent {
    const parts: string[] = [];

    const imageUrl = this.resolveImageUrl(material);
    if (imageUrl) {
      parts.push(`![${material.title || "image"}](${imageUrl})`);
      parts.push("");
    }

    const description = material.content?.plain ?? material.content ?? "";
    if (description) {
      parts.push(description);
    }

    return {
      markdown: parts.join("
"),
      frontmatter: this.buildFrontmatter(material.id, boardId, "image", "pull"),
      suggestedFileName: this.sanitizeFileName(material.title || "Untitled Image"),
      subfolder: "materials",
    };
  }

  private convertMediaTranscript(material: any, boardId: string): ConvertedContent {
    const parts: string[] = [];

    if (material.url) {
      parts.push(`> Source: ${material.url}`);
      parts.push("");
    }

    // 提取 overview block
    const overviewBlock = material.blocks?.find((b: any) => b.type === "overview");
    if (overviewBlock?.content?.plain) {
      parts.push("## Overview");
      parts.push("");
      parts.push(overviewBlock.content.plain);
      parts.push("");
    }

    // 提取 transcript block
    const transcriptBlock = material.blocks?.find((b: any) => b.type === "transcript");
    if (transcriptBlock?.content?.plain) {
      parts.push("## Transcript");
      parts.push("");
      parts.push(transcriptBlock.content.plain);
    }

    // 如果没有 blocks，用 content 兜底
    if (parts.length <= 2) {
      const fallback = material.content?.plain ?? material.content ?? "";
      if (fallback) {
        parts.push(fallback);
      }
    }

    if (parts.length === 0) {
      parts.push(`> This ${material.type} has no transcript yet. Open in YouMind to view.`);
    }

    return {
      markdown: parts.join("
"),
      frontmatter: this.buildFrontmatter(material.id, boardId, material.type, "pull"),
      suggestedFileName: this.sanitizeFileName(material.title || `Untitled ${material.type}`),
      subfolder: "materials",
    };
  }

  private convertPdfSummary(material: any, boardId: string): ConvertedContent {
    const parts: string[] = [];

    if (material.url) {
      parts.push(`> Source: [PDF](${material.url})`);
      parts.push("");
    }

    const overviewBlock = material.blocks?.find((b: any) => b.type === "overview");
    if (overviewBlock?.content?.plain) {
      parts.push("## Overview");
      parts.push("");
      parts.push(overviewBlock.content.plain);
      parts.push("");
    }

    const body = material.content?.plain ?? material.content ?? "";
    if (body) {
      parts.push(body);
    }

    if (parts.length === 0) {
      parts.push(`> This PDF has no extracted content yet. Open in YouMind to view.`);
    }

    return {
      markdown: parts.join("
"),
      frontmatter: this.buildFrontmatter(material.id, boardId, "pdf", "pull"),
      suggestedFileName: this.sanitizeFileName(material.title || "Untitled PDF"),
      subfolder: "materials",
    };
  }

  private convertTextFile(material: any, boardId: string): ConvertedContent {
    const content = material.content?.plain ?? material.content ?? "";
    return {
      markdown: content,
      frontmatter: this.buildFrontmatter(material.id, boardId, "text-file", "pull"),
      suggestedFileName: this.sanitizeFileName(material.title || "Untitled Text"),
      subfolder: "materials",
    };
  }

  private convertFallback(material: any, boardId: string): ConvertedContent {
    return {
      markdown: `> This material is available in YouMind: [Open in YouMind](https://youmind.com/materials/${material.id})`,
      frontmatter: this.buildFrontmatter(material.id, boardId, material.type ?? "unknown", "pull"),
      suggestedFileName: this.sanitizeFileName(material.title || "Untitled"),
      subfolder: "materials",
    };
  }

  // ─── 工具方法 ───

  private buildFrontmatter(
    entityId: string,
    boardId: string,
    type: string,
    source: "push" | "pull"
  ): YouMindFrontmatter {
    return {
      youmind_id: entityId,
      youmind_board: boardId,
      youmind_type: type,
      youmind_synced_at: new Date().toISOString(),
      youmind_source: source,
    };
  }

  sanitizeFileName(name: string): string {
    return name
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 200);
  }
}

export interface ConvertedContent {
  markdown: string;
  frontmatter: YouMindFrontmatter;
  suggestedFileName: string;
  subfolder: "materials" | "crafts";
}
```

---

#### B2. 新增文件 `src/pull-service.ts`

负责 Pull 的完整流程：获取详情 → 转换 → 写入文件 → 更新 frontmatter。

```typescript
import { App, TFile, normalizePath } from "obsidian";
import { ContentConverter, ConvertedContent } from "./content-converter";
import { YouMindFrontmatter } from "./types";

export interface PullOptions {
  entityId: string;
  entityType: "material" | "craft";
  boardId: string;
  boardName: string;
}

export interface PullResult {
  success: boolean;
  filePath?: string;
  error?: string;
  action?: "created" | "updated" | "skipped";
  title?: string;
}

export class PullService {
  private app: App;
  private plugin: any;  // YouMindPlugin 类型
  private converter: ContentConverter;

  constructor(app: App, plugin: any) {
    this.app = app;
    this.plugin = plugin;
    this.converter = new ContentConverter();
  }

  /**
   * 拉取单个实体到本地 Vault
   */
  async pull(options: PullOptions): Promise<pullresult> {
    const { entityId, entityType, boardId, boardName } = options;

    try {
      // 1. 检查是否已有本地关联文件
      const existingFile = this.plugin.frontmatterManager.findLocalFile(entityId);

      if (existingFile) {
        return await this.updateExisting(existingFile, entityId, entityType, boardId);
      }

      // 2. 获取完整内容
      const detail = await this.fetchDetail(entityId, entityType);
      if (!detail) {
        return { success: false, error: "Failed to fetch content from YouMind" };
      }

      // 3. 转换为 Markdown
      const converted = entityType === "material"
        ? this.converter.materialToMarkdown(detail, boardId)
        : this.converter.craftToMarkdown(detail, boardId);

      // 4. 确定本地路径并写入
      const filePath = await this.writeFile(converted, boardName);

      return {
        success: true,
        filePath,
        action: "created",
        title: detail.title || converted.suggestedFileName,
      };

    } catch (error: any) {
      console.error("[YouMind Pull]", error);
      return {
        success: false,
        error: error.message || "Unknown error during pull",
      };
    }
  }

  /**
   * 批量拉取
   */
  async pullBatch(
    items: PullOptions[],
    onProgress?: (completed: number, total: number, currentTitle: string) => void
  ): Promise<{ succeeded: number; failed: number; skipped: number; results: PullResult[] }> {
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    const results: PullResult[] = [];

    for (let i = 0; i < items.length; i++) {
      onProgress?.(i, items.length, items[i].entityId);

      const result = await this.pull(items[i]);
      results.push(result);

      if (result.success) {
        if (result.action === "skipped") {
          skipped++;
        } else {
          succeeded++;
        }
      } else {
        failed++;
      }

      // 避免 API 限流
      if (i < items.length - 1) {
        await this.sleep(200);
      }
    }

    onProgress?.(items.length, items.length, "");
    return { succeeded, failed, skipped, results };
  }

  /**
   * 移动已拉取的文件到新路径
   */
  async moveFile(currentPath: string, targetFolder: string): Promise<string |="" null=""> {
    try {
      const file = this.app.vault.getAbstractFileByPath(currentPath);
      if (!(file instanceof TFile)) return null;

      // 确保目标目录存在
      await this.ensureDirectory(targetFolder);

      const newPath = normalizePath(`${targetFolder}/${file.name}`);

      // 去重
      let finalPath = newPath;
      if (this.app.vault.getAbstractFileByPath(finalPath) && finalPath !== currentPath) {
        const ext = ".md";
        const nameWithoutExt = finalPath.slice(0, -ext.length);
        let counter = 1;
        finalPath = `${nameWithoutExt} ${counter}${ext}`;
        while (this.app.vault.getAbstractFileByPath(finalPath)) {
          counter++;
          finalPath = `${nameWithoutExt} ${counter}${ext}`;
        }
      }

      await this.app.vault.rename(file, finalPath);
      return finalPath;
    } catch (error) {
      console.error("[YouMind Pull] moveFile error:", error);
      return null;
    }
  }

  // ─── 私有方法 ───

  private async fetchDetail(entityId: string, entityType: "material" | "craft"): Promise<any> {
    if (entityType === "material") {
      return await this.plugin.api.getMaterial({ id: entityId, includeBlocks: true });
    } else {
      return await this.plugin.api.getCraft({ id: entityId });
    }
  }

  private async updateExisting(
    existingFile: TFile,
    entityId: string,
    entityType: "material" | "craft",
    boardId: string
  ): Promise<pullresult> {
    const detail = await this.fetchDetail(entityId, entityType);
    if (!detail) {
      return { success: false, error: "Failed to fetch content from YouMind" };
    }

    const converted = entityType === "material"
      ? this.converter.materialToMarkdown(detail, boardId)
      : this.converter.craftToMarkdown(detail, boardId);

    const fileContent = this.buildFileContent(converted.frontmatter, converted.markdown);
    await this.app.vault.modify(existingFile, fileContent);

    return {
      success: true,
      filePath: existingFile.path,
      action: "updated",
      title: detail.title || converted.suggestedFileName,
    };
  }

  private async writeFile(converted: ConvertedContent, boardName: string): Promise<string> {
    const syncRoot = this.plugin.settings.syncRootFolder || "youmind";
    const sanitizedBoardName = this.converter.sanitizeFileName(boardName);

    const basePath = normalizePath(
      `${syncRoot}/${sanitizedBoardName}/${converted.subfolder}/${converted.suggestedFileName}.md`
    );

    const finalPath = await this.deduplicatePath(basePath);

    const dirPath = finalPath.substring(0, finalPath.lastIndexOf("/"));
    await this.ensureDirectory(dirPath);

    const fileContent = this.buildFileContent(converted.frontmatter, converted.markdown);
    await this.app.vault.create(finalPath, fileContent);

    return finalPath;
  }

  private buildFileContent(frontmatter: YouMindFrontmatter, markdown: string): string {
    const fm = [
      "---",
      `youmind_id: "${frontmatter.youmind_id}"`,
      `youmind_board: "${frontmatter.youmind_board}"`,
      `youmind_type: "${frontmatter.youmind_type}"`,
      `youmind_synced_at: "${frontmatter.youmind_synced_at}"`,
      `youmind_source: "${frontmatter.youmind_source}"`,
      "---",
      "",
    ].join("
");

    return fm + markdown;
  }

  private async deduplicatePath(basePath: string): Promise<string> {
    const existing = this.app.vault.getAbstractFileByPath(basePath);
    if (!existing) return basePath;

    if (existing instanceof TFile) {
      const fm = this.plugin.frontmatterManager.read(existing);
      if (fm?.youmind_id) {
        return basePath;
      }
    }

    const ext = ".md";
    const nameWithoutExt = basePath.slice(0, -ext.length);
    let counter = 1;
    let newPath = `${nameWithoutExt} ${counter}${ext}`;
    while (this.app.vault.getAbstractFileByPath(newPath)) {
      counter++;
      newPath = `${nameWithoutExt} ${counter}${ext}`;
    }
    return newPath;
  }

  async ensureDirectory(dirPath: string): Promise<void> {
    const parts = dirPath.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (!existing) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
</void></void></string></string></pullresult></any></string></pullresult>
```

---

### Part C: Pull Confirm Panel

#### C1. 新增文件 `src/pull-confirm-panel.ts`

Pull 完成后弹出的确认浮层。镜像 Save Confirm Panel 的设计，但方向相反：Save Confirm 让用户选云端 Board，Pull Confirm 让用户选本地 Vault 文件夹。

```typescript
import { App, TFolder, setIcon } from "obsidian";

export interface PullConfirmOptions {
  app: App;
  filePath: string;              // 文件当前路径（默认路径）
  title: string;                 // 拉取的内容标题
  isUpdate: boolean;             // true = 更新已有文件, false = 新建
  onFolderChanged?: (newFolder: string) => Promise<string |="" null="">;  // 返回新路径或 null（失败）
  onOpenFile?: () => void;       // 在 Obsidian 中打开文件
}
</string>
```

**浮层 DOM 结构：**

```html
<div class="youmind-pull-confirm"><!-- Header --><div class="youmind-pull-confirm-header">
    <span class="youmind-pull-confirm-icon"></span>  <!-- setIcon: "check-circle", green -->
    <span class="youmind-pull-confirm-label">已拉取到</span>
    <button class="youmind-pull-confirm-close"></button>  <!-- setIcon: "x" --></div>

  <!-- Path row --><div class="youmind-pull-confirm-path-row">
    <button class="youmind-pull-confirm-path-btn">
      <span class="youmind-pull-confirm-folder-icon"></span>  <!-- setIcon: "folder" -->
      <span class="youmind-pull-confirm-path-text">youmind/AI Research/materials</span>
      <span class="youmind-pull-confirm-chevron"></span>  <!-- setIcon: "chevron-down" -->
    </button>
    <button class="youmind-pull-confirm-open-btn">
      <span></span>  <!-- setIcon: "file" -->
      <span>打开文件</span>
    </button></div>

  <!-- Folder picker dropdown（默认隐藏） --><div class="youmind-pull-confirm-dropdown" style="display:none">
    <div class="youmind-pull-confirm-search">
      <span></span>  <!-- setIcon: "search" -->
      <input type="text" placeholder="搜索文件夹...">
    </div>
    <div class="youmind-pull-confirm-folder-list">
      <!-- 动态渲染 Vault 文件夹列表 -->
    </div></div>

  <!-- Timer --><div class="youmind-pull-confirm-timer">
    <span>5 秒后自动关闭</span></div></div>
```

**完整类实现：**

```typescript
export class PullConfirmPanel {
  private el: HTMLElement;
  private options: PullConfirmOptions;
  private timer: ReturnType<typeof settimeout=""> | null = null;
  private countdown: number = 5;
  private countdownInterval: ReturnType<typeof setinterval=""> | null = null;
  private dropdownOpen: boolean = false;
  private currentPath: string;

  constructor(options: PullConfirmOptions) {
    this.options = options;
    this.currentPath = options.filePath;
    this.el = this.render();
    document.body.appendChild(this.el);
    this.startAutoClose();
  }

  private render(): HTMLElement {
    const el = document.createElement("div");
    el.className = "youmind-pull-confirm";

    // ── Header ──
    const header = el.createDiv({ cls: "youmind-pull-confirm-header" });

    const iconEl = header.createSpan({ cls: "youmind-pull-confirm-icon" });
    setIcon(iconEl, "check-circle");

    const label = header.createSpan({ cls: "youmind-pull-confirm-label" });
    label.textContent = this.options.isUpdate ? "已更新" : "已拉取到";

    const closeBtn = header.createEl("button", { cls: "youmind-pull-confirm-close" });
    setIcon(closeBtn, "x");
    closeBtn.addEventListener("click", () => this.close());

    // ── Path row ──
    const pathRow = el.createDiv({ cls: "youmind-pull-confirm-path-row" });

    const pathBtn = pathRow.createEl("button", { cls: "youmind-pull-confirm-path-btn" });
    const folderIcon = pathBtn.createSpan({ cls: "youmind-pull-confirm-folder-icon" });
    setIcon(folderIcon, "folder");

    const pathText = pathBtn.createSpan({ cls: "youmind-pull-confirm-path-text" });
    pathText.textContent = this.getDisplayPath(this.currentPath);

    const chevron = pathBtn.createSpan({ cls: "youmind-pull-confirm-chevron" });
    setIcon(chevron, "chevron-down");

    pathBtn.addEventListener("click", () => this.toggleDropdown(pathBtn, pathText));

    const openBtn = pathRow.createEl("button", { cls: "youmind-pull-confirm-open-btn" });
    setIcon(openBtn.createSpan(), "file");
    openBtn.createSpan({ text: "打开文件" });
    openBtn.addEventListener("click", () => {
      this.options.onOpenFile?.();
      this.close();
    });

    // ── Dropdown ──
    const dropdown = el.createDiv({ cls: "youmind-pull-confirm-dropdown" });
    dropdown.style.display = "none";

    const searchRow = dropdown.createDiv({ cls: "youmind-pull-confirm-search" });
    const searchIcon = searchRow.createSpan();
    setIcon(searchIcon, "search");
    const searchInput = searchRow.createEl("input", {
      type: "text",
      placeholder: "搜索文件夹...",
    });

    const folderList = dropdown.createDiv({ cls: "youmind-pull-confirm-folder-list" });

    // 搜索过滤
    searchInput.addEventListener("input", () => {
      this.renderFolderList(folderList, searchInput.value);
    });

    // 初始渲染文件夹列表
    this.renderFolderList(folderList, "");

    // ── Timer ──
    const timerEl = el.createDiv({ cls: "youmind-pull-confirm-timer" });
    timerEl.createSpan({ text: "5 秒后自动关闭" });

    // 点击浮层外部关闭
    setTimeout(() => {
      document.addEventListener("click", this.onOutsideClick);
    }, 100);

    return el;
  }

  private onOutsideClick = (e: MouseEvent) => {
    if (!this.el.contains(e.target as Node)) {
      this.close();
    }
  };

  private getDisplayPath(filePath: string): string {
    // 显示文件所在的文件夹路径（不含文件名）
    const lastSlash = filePath.lastIndexOf("/");
    return lastSlash >= 0 ? filePath.substring(0, lastSlash) : "/";
  }

  private toggleDropdown(pathBtn: HTMLElement, pathText: HTMLElement): void {
    const dropdown = this.el.querySelector(".youmind-pull-confirm-dropdown") as HTMLElement;
    if (!dropdown) return;

    this.dropdownOpen = !this.dropdownOpen;
    dropdown.style.display = this.dropdownOpen ? "flex" : "none";
    pathBtn.toggleClass("is-open", this.dropdownOpen);

    if (this.dropdownOpen) {
      // 停止自动关闭倒计时
      this.cancelAutoClose();
      // 聚焦搜索框
      const input = dropdown.querySelector("input") as HTMLInputElement;
      input?.focus();
    } else {
      // 重新开始倒计时
      this.startAutoClose();
    }
  }

  private renderFolderList(container: HTMLElement, filter: string): void {
    container.empty();

    // 获取 Vault 内所有文件夹
    const folders = this.getAllFolders();
    const currentFolder = this.getDisplayPath(this.currentPath);

    // 添加 Vault 根目录
    const allFolders = ["/", ...folders];

    // 过滤
    const filtered = filter
      ? allFolders.filter(f => f.toLowerCase().includes(filter.toLowerCase()))
      : allFolders;

    for (const folder of filtered) {
      const item = container.createDiv({ cls: "youmind-pull-confirm-folder-item" });
      if (folder === currentFolder) {
        item.addClass("is-current");
      }

      const itemIcon = item.createSpan({ cls: "youmind-pull-confirm-folder-item-icon" });
      setIcon(itemIcon, "folder");

      const itemName = item.createSpan({ cls: "youmind-pull-confirm-folder-item-name" });
      itemName.textContent = folder === "/" ? "Vault 根目录" : folder;

      if (folder === currentFolder) {
        const checkEl = item.createSpan({ cls: "youmind-pull-confirm-folder-check" });
        setIcon(checkEl, "check");
      }

      item.addEventListener("click", async () => {
        if (folder === currentFolder) return;

        // 显示 loading
        item.addClass("is-loading");
        setIcon(itemIcon, "loader");

        const targetFolder = folder === "/" ? "" : folder;
        const newPath = await this.options.onFolderChanged?.(targetFolder);

        if (newPath) {
          this.currentPath = newPath;
          // 更新路径显示
          const pathText = this.el.querySelector(".youmind-pull-confirm-path-text");
          if (pathText) pathText.textContent = this.getDisplayPath(newPath);

          // 更新标签文字
          const label = this.el.querySelector(".youmind-pull-confirm-label");
          if (label) label.textContent = "已移动到";

          // 关闭下拉
          this.dropdownOpen = false;
          const dropdown = this.el.querySelector(".youmind-pull-confirm-dropdown") as HTMLElement;
          if (dropdown) dropdown.style.display = "none";
          const pathBtn = this.el.querySelector(".youmind-pull-confirm-path-btn");
          pathBtn?.removeClass("is-open");

          // 重新开始倒计时
          this.startAutoClose();
        } else {
          // 移动失败
          item.removeClass("is-loading");
          setIcon(itemIcon, "alert-circle");
          setTimeout(() => setIcon(itemIcon, "folder"), 2000);
        }
      });
    }
  }

  private getAllFolders(): string[] {
    const folders: string[] = [];
    const recurse = (folder: TFolder) => {
      for (const child of folder.children) {
        if (child instanceof TFolder) {
          folders.push(child.path);
          recurse(child);
        }
      }
    };
    recurse(this.options.app.vault.getRoot());
    return folders.sort();
  }

  private startAutoClose(): void {
    this.cancelAutoClose();
    this.countdown = 5;
    this.updateTimerText();

    this.countdownInterval = setInterval(() => {
      this.countdown--;
      this.updateTimerText();
      if (this.countdown <= 0) {
        this.close();
      }
    }, 1000);
  }

  private cancelAutoClose(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    const timerEl = this.el.querySelector(".youmind-pull-confirm-timer span");
    if (timerEl) timerEl.textContent = "";
  }

  private updateTimerText(): void {
    const timerEl = this.el.querySelector(".youmind-pull-confirm-timer span");
    if (timerEl) timerEl.textContent = `${this.countdown} 秒后自动关闭`;
  }

  private close(): void {
    this.cancelAutoClose();
    document.removeEventListener("click", this.onOutsideClick);
    this.el.addClass("is-closing");
    setTimeout(() => {
      this.el.remove();
    }, 200);
  }
}
</typeof></typeof>
```

#### C2. Pull Confirm Panel CSS

追加到 `styles.css` 末尾：

```css
/* ============================================
   Pull Confirm Panel
   ============================================ */

.youmind-pull-confirm {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 9999;
  width: 360px;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  padding: 12px 16px;
  animation: youmind-pull-fade-in 200ms ease-out;
  font-size: var(--font-ui-small);
}

.youmind-pull-confirm.is-closing {
  animation: youmind-pull-fade-out 200ms ease-in forwards;
}

@keyframes youmind-pull-fade-in {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes youmind-pull-fade-out {
  from { opacity: 1; transform: translateY(0); }
  to   { opacity: 0; transform: translateY(-8px); }
}

/* Header */
.youmind-pull-confirm-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.youmind-pull-confirm-icon {
  color: var(--text-success);
  flex-shrink: 0;
}

.youmind-pull-confirm-icon svg {
  width: 18px;
  height: 18px;
}

.youmind-pull-confirm-label {
  flex: 1;
  font-weight: 500;
  color: var(--text-normal);
}

.youmind-pull-confirm-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 2px;
  border-radius: 4px;
}

.youmind-pull-confirm-close:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}

.youmind-pull-confirm-close svg {
  width: 14px;
  height: 14px;
}

/* Path row */
.youmind-pull-confirm-path-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.youmind-pull-confirm-path-btn {
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

.youmind-pull-confirm-path-btn:hover {
  background: var(--background-modifier-hover);
}

.youmind-pull-confirm-folder-icon svg {
  width: 16px;
  height: 16px;
}

.youmind-pull-confirm-folder-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.youmind-pull-confirm-path-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.youmind-pull-confirm-chevron {
  flex-shrink: 0;
  color: var(--text-muted);
  transition: transform 150ms ease;
}

.youmind-pull-confirm-chevron svg {
  width: 14px;
  height: 14px;
}

.youmind-pull-confirm-path-btn.is-open .youmind-pull-confirm-chevron {
  transform: rotate(180deg);
}

.youmind-pull-confirm-open-btn {
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

.youmind-pull-confirm-open-btn:hover {
  background: var(--interactive-accent-hover);
}

.youmind-pull-confirm-open-btn svg {
  width: 14px;
  height: 14px;
}

/* Dropdown */
.youmind-pull-confirm-dropdown {
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  background: var(--background-primary);
  margin-bottom: 8px;
  max-height: 280px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.youmind-pull-confirm-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--background-modifier-border);
}

.youmind-pull-confirm-search svg {
  width: 14px;
  height: 14px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.youmind-pull-confirm-search input {
  border: none;
  background: none;
  outline: none;
  flex: 1;
  font-size: var(--font-ui-small);
  color: var(--text-normal);
}

.youmind-pull-confirm-folder-list {
  overflow-y: auto;
  max-height: 220px;
}

.youmind-pull-confirm-folder-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: var(--font-ui-small);
  color: var(--text-normal);
}

.youmind-pull-confirm-folder-item:hover {
  background: var(--background-modifier-hover);
}

.youmind-pull-confirm-folder-item.is-current {
  background: var(--background-secondary);
}

.youmind-pull-confirm-folder-item-icon svg {
  width: 16px;
  height: 16px;
}

.youmind-pull-confirm-folder-item-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.youmind-pull-confirm-folder-item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.youmind-pull-confirm-folder-check svg {
  width: 14px;
  height: 14px;
  color: var(--text-success);
}

.youmind-pull-confirm-folder-check {
  margin-left: auto;
  flex-shrink: 0;
}

.youmind-pull-confirm-folder-item.is-loading .youmind-pull-confirm-folder-item-icon svg {
  animation: youmind-spin 1s linear infinite;
}

/* Timer */
.youmind-pull-confirm-timer {
  text-align: right;
  font-size: var(--font-ui-smaller);
  color: var(--text-faint);
}
```

---

### Part D：接入 — 修改 `src/browser-view.ts`

> ⚠️ 不要修改 Browser View 的整体结构、Tab 切换、Group 展开/收起、Board 联动等已有逻辑。只修改 Pull 相关的占位代码，以及新增 Pull Confirm 的调用。

#### D1. 引入新模块

在文件顶部添加 import：

```typescript
import { PullService, PullResult } from "./pull-service";
import { PullConfirmPanel } from "./pull-confirm-panel";
```

在 `BrowserView` 类中添加属性：

```typescript
private pullService: PullService;
```

在构造函数或 `onOpen` 中初始化：

```typescript
this.pullService = new PullService(this.app, this.plugin);
```

#### D2. 替换右键菜单中的 Pull 占位

找到右键菜单中 “Pull to Vault” 的占位代码（包含 `new Notice("Pull to Vault will be available in Phase 1.3.3")` 的位置），替换 onClick 回调为：

```typescript
onClick: async () => {
  await this.executePull(node);
}
```

#### D3. 替换 Preview Panel 中的 Pull 按钮占位

找到 `showPreview` 方法中创建 “Pull to Vault” 按钮的位置，替换 onClick 回调为同样的 `this.executePull(node)`。

#### D4. 新增 `executePull` 方法

```typescript
private async executePull(node: TreeNode): Promise<void> {
  const boardId = this.plugin.getCurrentBoardId();
  const boardName = this.plugin.getCurrentBoardName();

  if (!boardId || !boardName) {
    new Notice("No board selected");
    return;
  }

  new Notice(`Pulling "${node.title}"...`);

  const result = await this.pullService.pull({
    entityId: node.id,
    entityType: node.type === "craft" ? "craft" : "material",
    boardId,
    boardName,
  });

  if (result.success && result.filePath) {
    // 更新节点状态
    node.isLinked = true;
    node.localPath = result.filePath;
    this.renderCurrentTab();

    // 弹出 Pull Confirm Panel
    new PullConfirmPanel({
      app: this.app,
      filePath: result.filePath,
      title: result.title || node.title,
      isUpdate: result.action === "updated",
      onFolderChanged: async (newFolder: string) => {
        const newPath = await this.pullService.moveFile(result.filePath!, newFolder);
        if (newPath) {
          node.localPath = newPath;
          this.renderCurrentTab();
        }
        return newPath;
      },
      onOpenFile: () => {
        const filePath = node.localPath || result.filePath;
        const file = this.app.vault.getAbstractFileByPath(filePath!);
        if (file instanceof TFile) {
          this.app.workspace.getLeaf(false).openFile(file);
        }
      },
    });
  } else {
    new Notice(`Pull failed: ${result.error}`);
  }
}
</void>
```

#### D5. 新增 Group “Pull All” 按钮

在 `renderTreeNode` 方法中，为 group 节点的 header 添加 “Pull All” 按钮（仅当 group 内有可拉取的未关联 item 时显示）：

```typescript
if (node.type === "group" && node.children) {
  const pullableChildren = node.children.filter(
    child => child.isPullable && !child.isLinked
  );

  if (pullableChildren.length > 0) {
    const pullAllBtn = groupActions.createEl("button", {
      cls: "youmind-browser-group-action",
      attr: { "aria-label": `Pull ${pullableChildren.length} items` },
    });
    setIcon(pullAllBtn, "download");
    pullAllBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await this.executePullBatch(node, pullableChildren);
    });
  }
}
```

#### D6. 新增 `executePullBatch` 方法

```typescript
private async executePullBatch(groupNode: TreeNode, items: TreeNode[]): Promise<void> {
  const boardId = this.plugin.getCurrentBoardId();
  const boardName = this.plugin.getCurrentBoardName();

  if (!boardId || !boardName) {
    new Notice("No board selected");
    return;
  }

  const pullOptions = items.map(item => ({
    entityId: item.id,
    entityType: (item.type === "craft" ? "craft" : "material") as "material" | "craft",
    boardId,
    boardName,
  }));

  const progressNotice = new Notice(`Pulling 0/${items.length}...`, 0);

  const result = await this.pullService.pullBatch(
    pullOptions,
    (completed, total, _currentTitle) => {
      progressNotice.setMessage(`Pulling ${completed}/${total}...`);
    }
  );

  progressNotice.hide();

  // 更新节点状态
  for (const item of items) {
    const linkedFile = this.plugin.frontmatterManager.findLocalFile(item.id);
    if (linkedFile) {
      item.isLinked = true;
      item.localPath = linkedFile.path;
    }
  }

  this.renderCurrentTab();

  // 汇总反馈
  const parts: string[] = [];
  if (result.succeeded > 0) parts.push(`${result.succeeded} pulled`);
  if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
  if (result.failed > 0) parts.push(`${result.failed} failed`);
  new Notice(`Pull complete: ${parts.join(", ")}`);
}
</void>
```

#### D7. 右键菜单新增 “Update from YouMind”

对于已关联（`isLinked === true`）的 item，在右键菜单中新增更新选项：

```typescript
if (node.isLinked) {
  menu.addItem((item) => {
    item
      .setTitle("Update from YouMind")
      .setIcon("refresh-cw")
      .onClick(async () => {
        await this.executePull(node);
      });
  });
}
```

---

### Part E：辅助修改

#### E1. `src/types.ts` — 确认 YouMindFrontmatter 类型

> ⚠️ 不要修改已有类型。只确认以下类型存在，如果不存在则添加。

```typescript
export interface YouMindFrontmatter {
  youmind_id: string;
  youmind_board: string;
  youmind_type: string;
  youmind_synced_at: string;
  youmind_source: "push" | "pull" | "local";
}
```

#### E2. `src/plugin-class.ts` — 确认 `getCurrentBoardName` 方法

> ⚠️ 不要修改已有逻辑。只确认以下方法存在，如果不存在则添加。

```typescript
getCurrentBoardName(): string | null {
  return this.currentBoardName ?? null;
}
```

如果当前只有 `getCurrentBoardId()` 而没有 `getCurrentBoardName()`，需要新增。Board 选择器在切换时应该同时保存 boardId 和 boardName。

#### E3. `src/frontmatter-manager.ts` — 确认 `findLocalFile` 方法

> ⚠️ 不要修改已有逻辑。只确认以下方法存在。

```typescript
findLocalFile(youmindId: string): TFile | null {
  const linkedFiles = this.scanLinkedFiles();
  return linkedFiles.get(youmindId) ?? null;
}
```

#### E4. `styles.css` — 追加 Pull 相关补充样式

```css
/* ============================================
   Pull to Vault — 补充样式
   ============================================ */

/* Group 级别的 Pull All 按钮 */
.youmind-browser-group-action {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 2px;
  border-radius: var(--radius-s);
  display: flex;
  align-items: center;
  opacity: 0;
  transition: opacity 0.15s;
}

.youmind-browser-group-header:hover .youmind-browser-group-action {
  opacity: 1;
}

.youmind-browser-group-action:hover {
  color: var(--text-normal);
  background: var(--background-modifier-hover);
}

.youmind-browser-group-action svg {
  width: 14px;
  height: 14px;
}
```

---

## 不做的事情

### 本轮不实现（后续规划）

- ❌ 不实现实时同步（双向自动同步）— 规划在 Phase 1.4

- ❌ 不实现冲突合并（采用“最后写入胜出”策略）— 规划在 Phase 1.5

- ❌ 不实现图片本地下载（图片类型只创建 Markdown 引用）— 规划在 Phase 1.3.4

- ❌ 不实现 Slides / Webpage / AudioPod / Canvas 的内容拉取（只创建链接文件）— 规划在 Phase 1.3.5

### 本轮不修改（防回归）

- ❌ 不修改 Chat View 逻辑

- ❌ 不修改 Save / Push 逻辑

- ❌ 不修改 Save Confirm Panel 逻辑

- ❌ 不引入子目录结构（保持扁平 `src/`）

---

## Vault 目录结构示例

Pull 完成后，默认本地文件结构如下（用户可通过 Pull Confirm Panel 移到任意位置）：

```plaintext
vault-root/
├── youmind/                              ← 同步根目录（可在设置中自定义）
│   ├── AI Research/                      ← Board 名称
│   │   ├── materials/                    ← 拉取的资料
│   │   │   ├── Transformer 论文.md       ← Article 类型
│   │   │   ├── Meeting Notes.md          ← Note 类型
│   │   │   ├── AI Podcast Episode.md     ← Voice 类型（转录文本）
│   │   │   └── Architecture Diagram.md   ← Image 类型（图片引用）
│   │   └── crafts/                       ← 拉取的作品
│   │       └── AI 综述 v2.md             ← Page 类型
│   │
│   └── Content Creation/                 ← 另一个 Board
│       ├── materials/
│       └── crafts/
│
├── my-notes/                             ← 用户可以把拉取的文件移到这里
│   └── Transformer 论文.md               ← 通过 Pull Confirm 移动后的位置
│
├── daily/                                ← 用户自己的笔记（不受影响）
└── ...
```

每个拉取的文件都包含 frontmatter：

```yaml
---
youmind_id: "019d427d-fcd4-7245-b220-570eca006277"
youmind_board: "019acf76-e987-7e71-98a6-ebfa09f25206"
youmind_type: "note"
youmind_synced_at: "2026-03-31T17:30:00.000Z"
youmind_source: "pull"
---

（正文内容）
```

---

## 数据流总结

### Pull 单个 item

```plaintext
用户在 Browser View 点击 "Pull to Vault"（右键菜单或 Preview 按钮）
  → PullService.pull()
    → getMaterial(id, includeBlocks=true) 或 getCraft(id)
    → ContentConverter.materialToMarkdown() 或 craftToMarkdown()
    → 写入文件到 youmind/{Board}/{type}/{title}.md
    → 写入 frontmatter
  → 弹出 PullConfirmPanel
    → 显示 "已拉取到 youmind/AI Research/materials"
    → 用户可点击文件夹选择器，选择 Vault 内任意文件夹
    → 选择后 PullService.moveFile() 移动文件
    → 或 5 秒后自动关闭
  → Browser View 刷新，item 显示 ✅ 标记
```

### Pull 批量（Group）

```plaintext
用户在 Group header 点击 download 按钮
  → PullService.pullBatch()
    → 逐个 pull，每个间隔 200ms
    → 进度 Notice "Pulling 3/10..."
  → 完成后汇总 Notice "Pull complete: 8 pulled, 2 skipped"
  → Browser View 刷新
  （批量拉取不弹 Pull Confirm Panel，只用 Notice 汇总）
```

---

## Icon 映射总表（本轮新增 + Hotfix）

| 场景 | Lucide 图标名 | 用途 |
| --- | --- | --- |
| Pull 按钮 | `download` | 拉取到本地 |
| Pull All (Group) | `download` | 批量拉取 |
| Update from YM | `refresh-cw` | 更新已关联文件 |
| Pull Confirm 成功 | `check-circle` | 浮层顶部图标（绿色） |
| Pull Confirm 关闭 | `x` | 关闭浮层 |
| Pull Confirm 文件夹 | `folder` | 路径按钮图标 |
| Pull Confirm 下拉 | `chevron-down` | 展开文件夹列表 |
| Pull Confirm 搜索 | `search` | 搜索文件夹 |
| Pull Confirm 当前 | `check` | 当前文件夹标记 |
| Pull Confirm 打开 | `file` | 打开文件按钮 |
| Pull Confirm 加载 | `loader` | 移动中动画 |
| Pull Confirm 失败 | `alert-circle` | 移动失败 |
| Preview Fallback 类型 | 按类型映射 | `file-text` / `globe` / `image` / `headphones` / `play-circle` / `file-spreadsheet` / `presentation` / `layout` / `layout-dashboard` |
| Preview 外部链接 | `external-link` | “Open in Browser” 按钮 |
| Preview 音频源 | `headphones` | 音频来源按钮 |
| Preview 视频源 | `play-circle` | 视频来源按钮 |

---

## 验收标准

### A. Browser Hotfix

- [ ]  打开有 MaterialGroup 的 Board（如 “Wiki 搭建资料”），所有文件夹显示真实名称，不再显示 “Untitled Group”

- [ ]  CraftGroup 名称仍然正常（回归确认）

- [ ]  单击 Note/Article 类型 item，Preview Panel 显示完整 Markdown 渲染内容（标题、加粗、列表、代码块、引用等格式正确）

- [ ]  Preview 内容不截断，可以上下滚动阅读全文

- [ ]  单击 Image 类型 item，Preview 直接显示图片（自适应宽度），下方显示描述文本

- [ ]  单击 Voice/Video 类型 item，Preview 顶部显示播放源按钮，下方渲染概要和转录文本

- [ ]  单击 Office/Slides 等不可预览类型，Preview 显示类型图标 + 标题 + “Open in Browser” 按钮

- [ ]  点击 “Open in Browser” 按钮能在默认浏览器中打开对应链接

- [ ]  拖拽 resizer 增大 Preview 面板后，可见内容区域跟着变大（不是下方空白），滚动条自适应

- [ ]  快速切换不同 item 时，Preview 不会显示上一个 item 的内容（防竞态）

- [ ]  Preview Panel 和列表之间有可拖拽的分隔条

- [ ]  向上拖拽增大 Preview 面积（最大 70%），向下拖拽缩小（最小 80px）

- [ ]  拖拽过程中不会选中文字

### B. 单个 Material 拉取

- [ ]  右键 Note 类型 Material → “Pull to Vault” → 本地创建

- [ ]  文件路径为

- [ ]  文件 frontmatter 包含正确的

- [ ]  拉取完成后 Browser View 中该 item 显示绿色 ✅ 标记

### C. 不同 Material 类型

- [ ]  Article 类型：正文前有

- [ ]  Image 类型：正文包含

- [ ]  Voice/Video 类型（有转录）：包含

- [ ]  Voice/Video 类型（无转录）：包含提示信息

- [ ]  PDF 类型：包含概要内容

- [ ]  Office 类型：创建链接文件（fallback）

### D. Craft (Page) 拉取

- [ ]  右键 Page 类型 Craft → “Pull to Vault” → 本地创建

- [ ]  文件路径为

- [ ]  frontmatter 包含

### E. 更新已有文件

- [ ]  对已关联 item 右键 → “Update from YouMind” → 本地文件内容被更新

- [ ]  

- [ ]  文件路径不变

### F. 批量拉取

- [ ]  Group 节点上显示 download 按钮（仅当有可拉取的未关联 item 时）

- [ ]  点击后显示进度 Notice

- [ ]  完成后显示汇总

- [ ]  所有成功拉取的 item 显示 ✅ 标记

### G. Pull Confirm Panel

- [ ]  单个 Pull 成功后弹出确认浮层（不是黑底 Notice）

- [ ]  浮层显示文件所在的文件夹路径

- [ ]  点击 “打开文件” 在 Obsidian 中打开拉取的文件

- [ ]  点击文件夹路径展开下拉列表，显示 Vault 内所有文件夹

- [ ]  搜索框能过滤文件夹列表

- [ ]  选择其他文件夹后，文件自动移动到新位置

- [ ]  移动成功后浮层更新为 “已移动到 {新路径}”

- [ ]  无操作 5 秒后自动关闭（带 fadeOut 动画）

- [ ]  展开下拉列表时暂停倒计时

- [ ]  点击浮层外部立即关闭

- [ ]  批量拉取不弹浮层（只用 Notice 汇总）

### H. 边界情况

- [ ]  文件名包含特殊字符时自动清洗

- [ ]  同名文件已存在且无

- [ ]  目标目录不存在时自动递归创建

- [ ]  API 请求失败时显示错误 Notice，不崩溃

- [ ]  网络断开时 Preview 显示 “Failed to load preview”，不崩溃

### I. markdownToNote 转换（Push 方向，供后续使用）

- [ ]  

- [ ]  

- [ ]  

- [ ]  

- [ ]  Frontmatter 被完整剥离

- [ ]  标准 Markdown（callouts、tags、code blocks）→ 保留不变