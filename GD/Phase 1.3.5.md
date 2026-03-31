# Phase 1.3.5 — Slides / Webpage / AudioPod / Canvas 导出 (Codex 指令)

## 前置状态（已完成，不要重复实现）

以下能力已完成并通过验证，本轮不要破坏：

- Chat View（对话、历史、消息操作栏）
- Board 选择器（下拉切换 Board，上下文隔离）
- Pick 摘录（消息级 + 选区级）
- Save 动作拆分（`Save to Vault` / `Save as YouMind Note`）
- Push 三层入口（命令面板 / 右键菜单 / 编辑器按钮）
- Frontmatter Manager（读写 `youmind_id`、`youmind_board`、`youmind_type`、`youmind_synced_at`、`youmind_source`）
- `getSyncStatus(file)` 三态判断（`unlinked` / `synced` / `modified`）
- Save Confirm Panel（保存确认浮层，支持事后切换 Board）
- Browser View（`src/browser-view.ts`）展示 Materials / Crafts 树，支持类型化预览与 resizer
- Preview Panel 按类型分发渲染（Markdown / 图片 / 音视频 / Fallback）
- Pull to Vault 核心逻辑（`src/pull-service.ts` + `src/content-converter.ts`）
- Pull Confirm Panel（`src/pull-confirm-panel.ts`）
- ImageDownloader（`src/image-downloader.ts`）
- Material Pull 图片本地下载（Image / Article / PDF 内联图片）
- API 方法：`listMaterials`、`listCrafts`、`getMaterial`、`getCraft`、`createNote`、`updateNote`、`moveMaterials`、`listBoards`

---

## 本轮目标

Phase 1.3.5 的目标是让以下 Craft 类型也支持 Pull to Vault：

- `slides`
- `webpage`
- `audio-pod`
- `canvas`

当前问题：

- Browser View 中只有 `page` 被视为可拉取类型
- 其他 Craft 类型只能 “Open in YouMind”
- 这些类型其实都包含有价值的内容，至少应导出成可用的 Markdown

本轮目标：

| 类型 | 导出策略 | 核心价值 |
| --- | --- | --- |
| Slides | 场景大纲 + 缩略图 + 文本内容 | 保留演示结构 |
| Webpage | 截图 + 元信息 + 源码链接 | 保留视觉预览和访问入口 |
| AudioPod | 防御性文本提取 | 至少保留可提取文本 |
| Canvas | 防御性文本提取 | 为罕见类型提供兜底导出 |

用户价值：

- Browser View 不再有明显 “不能拉取的死角”
- Pull 后的文件在本地可搜索、可离线回顾、可继续整理
- 即使未知 DTO 结构无法完全解析，也至少保留标题和来源链接

---

## 约束

- 所有图标使用 Obsidian 内置 Lucide，通过 `setIcon()` 调用
- 保持当前扁平 `src/` 目录，不做目录级重构
- `npm run build` 必须通过
- 不破坏已有 chat / history / board / pick / save / push / browser / pull / image-download 功能
- 新类型导出失败时静默回退到 Fallback 模板，不中断 Pull 流程
- 复用 `ImageDownloader` 处理 Slides 缩略图和 Webpage 截图

---

## 关键背景

### 1. WebpageDto（已通过 API 实证验证）

真实字段中至少包含：

```json
{
  "$class": "WebpageDto",
  "id": "019d2fb1-dad7-7624-b4b1-33431db8db12",
  "type": "webpage",
  "title": "新街住宅 · 开关插座点位标注图",
  "boardId": "019b9b9d-68cd-712d-bbd9-17de08ae68b0",
  "content": "",
  "contentUrl": "https://cdn.gooo.ai/artifacts/019d2fb1-2439-7f89-b78b-35a25ca56d79/index.html",
  "screenshot": "https://cdn.gooo.ai/web-images/e9c575c7e5884800f1c0a3680d54c337a9bb5c92126370dd0f54bbb4e3dd26e9.png"
}
```

关键点：

- `contentUrl` 是 HTML 源码的 CDN 链接
- `screenshot` 是可直接访问的公开截图链接
- `content` 可能为空字符串

### 2. SlidesDto（已通过 API 实证验证）

关键事实：

- `craft.content.raw` 是 JSON 字符串
- 解析后主要结构位于 `parsed.timeline.scenes`
- 每个 `scene.mediaAssets[0].genMedia` 内包含场景核心信息

重点字段：

- `genMedia.title`
- `genMedia.playUrl`
- `genMedia.pptType`
- `genMedia.content`

其中 `genMedia.content` 常包含：

- `NARRATIVE GOAL:`
- `KEY CONTENT:`
- `VISUAL:`
- `LAYOUT:`

导出时优先保留：

- `KEY CONTENT`
- 可选保留 `NARRATIVE GOAL`
- 不导出 `VISUAL` 和 `LAYOUT` 这类图片生成提示词

### 3. AudioPodDto（Schema 中存在，但无真实实例验证）

重要修正：

- OpenAPI Schema 中确实存在 `AudioPodDto`
- 但当前没有拿到真实实例验证其深层结构
- 不能假设存在 `blocks`、`segments`、`speakers` 等路径

处理原则：

- 只做防御性实现
- 优先尝试 `content.plain`
- 再尝试 `content.raw`
- 再尝试 `content` 自身
- 如果是 JSON 字符串，则 `JSON.parse` 后递归提取文本
- 任一步失败都不能导致 Pull 崩溃

### 4. CanvasDto（Schema 中存在，但实际使用里极罕见）

重要修正：

- OpenAPI Schema 中存在 `CanvasDto`
- 但用户日常感知的 “Canvas” 实际很可能是 `WebpageDto`
- 也就是说：YouMind 里常见的交互式可视化页面应按 `webpage` 处理
- 真正的 `canvas` 类型需要保留支持，但只能做防御性兜底

处理原则与 AudioPod 相同：

- 不依赖任何猜测的深层路径
- 使用通用文本提取
- 解析失败静默回退

---

## 实现策略

### Part A: 修改 `src/content-converter.ts`

核心思路：

- 将 `craftToMarkdown` 改为 `async`
- 从只处理 `page` 扩展为按 `type` 分发
- 对 `slides` / `webpage` 支持图片下载
- 对 `audio-pod` / `canvas` 使用防御性文本提取

### A1. `craftToMarkdown` 改为 async + 按类型分发

```ts
async craftToMarkdown(
  craft: Record<string, unknown>,
  boardId: string,
  imageDownloader?: ImageDownloader,
  mdFilePath?: string,
): Promise<ConvertedContent> {
  const type = readString(craft, "type") ?? "page";

  switch (type) {
    case "page":
      return this.convertPage(craft, boardId);
    case "slides":
      return this.convertSlides(craft, boardId, imageDownloader, mdFilePath);
    case "webpage":
      return this.convertWebpage(craft, boardId, imageDownloader, mdFilePath);
    case "audio-pod":
      return this.convertAudioPod(craft, boardId);
    case "canvas":
      return this.convertCanvas(craft, boardId);
    default:
      return this.convertCraftFallback(craft, boardId);
  }
}
```

### A2. 提取 `convertPage`

原有 `page` 逻辑保持不变，只是从旧的 `craftToMarkdown` 中拆出来。

### A3. 新增 `convertSlides`

目标输出：

- 标题
- deck 基本信息
- 每个 scene 的标题
- 每个 scene 的缩略图
- `KEY CONTENT`
- 可选 `NARRATIVE GOAL`

建议结构：

```ts
private async convertSlides(
  craft: Record<string, unknown>,
  boardId: string,
  imageDownloader?: ImageDownloader,
  mdFilePath?: string,
): Promise<ConvertedContent> {
  try {
    const raw = isRecord(craft.content) ? craft.content.raw : craft.content;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const scenes = Array.isArray(parsed?.timeline?.scenes) ? parsed.timeline.scenes : [];

    if (scenes.length === 0) {
      return this.convertCraftFallback(craft, boardId);
    }

    const parts: string[] = [];
    parts.push(`# ${readString(craft, "title") ?? "Untitled Slides"}`, "");
    parts.push(`> Slides deck with ${scenes.length} scenes`);
    parts.push(`> [Open in YouMind](https://youmind.com/crafts/${readString(craft, "id") ?? ""})`, "");

    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index];
      const genMedia = scene?.mediaAssets?.[0]?.genMedia;
      const sceneTitle = genMedia?.title || `Scene ${index + 1}`;
      const pptType = genMedia?.pptType ? ` (${genMedia.pptType})` : "";

      parts.push(`## ${index + 1}. ${sceneTitle}${pptType}`, "");

      if (genMedia?.playUrl) {
        let imageRef = genMedia.playUrl;
        if (imageDownloader && mdFilePath) {
          const fileName = `slide_${index + 1}_${this.sanitizeFileName(sceneTitle)}.jpeg`;
          const downloaded = await imageDownloader.download(genMedia.playUrl, fileName, mdFilePath);
          if (downloaded) {
            imageRef = downloaded.relativePath;
          }
        }
        parts.push(`![${sceneTitle}](${imageRef})`, "");
      }

      const contentText = typeof genMedia?.content === "string" ? genMedia.content : "";
      const keyContent = this.extractSlidesSection(contentText, "KEY CONTENT");
      const narrativeGoal = this.extractSlidesSection(contentText, "NARRATIVE GOAL");

      if (keyContent) {
        parts.push(keyContent, "");
      }
      if (narrativeGoal) {
        parts.push(`> ${narrativeGoal}`, "");
      }
    }

    return {
      markdown: parts.join("\n"),
      frontmatter: this.buildFrontmatter(readString(craft, "id") ?? "", boardId, "slides", "pull"),
      suggestedFileName: this.sanitizeFileName(readString(craft, "title") ?? "Untitled Slides"),
      subfolder: "crafts",
    };
  } catch {
    return this.convertCraftFallback(craft, boardId);
  }
}
```

辅助方法：

- `extractSlidesSection(content, "KEY CONTENT")`
- `extractSlidesSection(content, "NARRATIVE GOAL")`

```ts
private extractSlidesSection(content: string, sectionName: string): string | null {
  if (!content.trim()) {
    return null;
  }

  const markers = ["NARRATIVE GOAL:", "KEY CONTENT:", "VISUAL:", "LAYOUT:"];
  const startMarker = `${sectionName}:`;
  const startIndex = content.indexOf(startMarker);

  if (startIndex === -1) {
    return null;
  }

  const afterStart = content.slice(startIndex + startMarker.length);
  let endIndex = afterStart.length;

  for (const marker of markers) {
    if (marker === startMarker) {
      continue;
    }
    const markerIndex = afterStart.indexOf(marker);
    if (markerIndex !== -1 && markerIndex < endIndex) {
      endIndex = markerIndex;
    }
  }

  const extracted = afterStart.slice(0, endIndex).replace(/\\n/g, "\n").trim();
  return extracted || null;
}
```

### A4. 新增 `convertWebpage`

目标输出：

- 标题
- YouMind 链接
- 本地或远程截图
- HTML 源码链接
- 纯文本内容（如果有）

```ts
private async convertWebpage(
  craft: Record<string, unknown>,
  boardId: string,
  imageDownloader?: ImageDownloader,
  mdFilePath?: string,
): Promise<ConvertedContent> {
  const parts: string[] = [];
  const title = readString(craft, "title") ?? "Untitled Webpage";
  const screenshot = readString(craft, "screenshot");
  const contentUrl = readString(craft, "contentUrl") ?? readString(craft, "content_url");
  const body = this.extractTextContent(craft.content);

  parts.push(`# ${title}`, "");
  parts.push(`> Webpage craft`);
  parts.push(`> [Open in YouMind](https://youmind.com/crafts/${readString(craft, "id") ?? ""})`, "");

  if (screenshot) {
    let imageRef = screenshot;
    if (imageDownloader && mdFilePath) {
      const downloaded = await imageDownloader.download(
        screenshot,
        `${this.sanitizeFileName(title)}_screenshot.png`,
        mdFilePath,
      );
      if (downloaded) {
        imageRef = downloaded.relativePath;
      }
    }
    parts.push(`![${title}](${imageRef})`, "");
  }

  if (contentUrl) {
    parts.push(`**HTML Source:** [${contentUrl}](${contentUrl})`, "");
  }

  if (body) {
    parts.push("## Content", "", body, "");
  }

  if (!screenshot && !contentUrl && !body) {
    parts.push("This webpage has no extractable content. Open in YouMind to view.");
  }

  return {
    markdown: parts.join("\n"),
    frontmatter: this.buildFrontmatter(readString(craft, "id") ?? "", boardId, "webpage", "pull"),
    suggestedFileName: this.sanitizeFileName(title),
    subfolder: "crafts",
  };
}
```

### A5. 新增 `convertAudioPod`

这里不要假设真实结构，只使用通用提取：

```ts
private convertAudioPod(craft: Record<string, unknown>, boardId: string): ConvertedContent {
  try {
    const textContent = this.extractTextContent(craft.content);
    if (!textContent) {
      return this.convertCraftFallback(craft, boardId);
    }

    const parts = [
      `# ${readString(craft, "title") ?? "Untitled AudioPod"}`,
      "",
      `> AudioPod transcript`,
      `> [Open in YouMind](https://youmind.com/crafts/${readString(craft, "id") ?? ""})`,
      "",
      "---",
      "",
      textContent,
      "",
    ];

    return {
      markdown: parts.join("\n"),
      frontmatter: this.buildFrontmatter(readString(craft, "id") ?? "", boardId, "audio-pod", "pull"),
      suggestedFileName: this.sanitizeFileName(readString(craft, "title") ?? "Untitled AudioPod"),
      subfolder: "crafts",
    };
  } catch {
    return this.convertCraftFallback(craft, boardId);
  }
}
```

### A6. 新增 `convertCanvas`

Canvas 同样采用防御性策略：

```ts
private convertCanvas(craft: Record<string, unknown>, boardId: string): ConvertedContent {
  try {
    const textContent = this.extractTextContent(craft.content);
    if (!textContent) {
      return this.convertCraftFallback(craft, boardId);
    }

    const parts = [
      `# ${readString(craft, "title") ?? "Untitled Canvas"}`,
      "",
      `> Canvas content`,
      `> [Open in YouMind](https://youmind.com/crafts/${readString(craft, "id") ?? ""})`,
      "",
      "---",
      "",
      textContent,
      "",
    ];

    return {
      markdown: parts.join("\n"),
      frontmatter: this.buildFrontmatter(readString(craft, "id") ?? "", boardId, "canvas", "pull"),
      suggestedFileName: this.sanitizeFileName(readString(craft, "title") ?? "Untitled Canvas"),
      subfolder: "crafts",
    };
  } catch {
    return this.convertCraftFallback(craft, boardId);
  }
}
```

### A7. 新增通用文本提取方法

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

private extractTextContent(content: unknown): string {
  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return this.extractTextFromString(content);
  }

  if (isRecord(content)) {
    const plain = readString(content, "plain");
    if (plain) {
      return plain;
    }

    const raw = readString(content, "raw");
    if (raw) {
      return this.extractTextFromString(raw);
    }

    return this.extractTextFromObject(content);
  }

  return "";
}

private extractTextFromString(value: string): string {
  try {
    const parsed = JSON.parse(value);
    return this.extractTextFromObject(parsed) || value.trim();
  } catch {
    return value.trim();
  }
}

private extractTextFromObject(value: unknown): string {
  const texts: string[] = [];
  this.collectStringsFromObject(value, texts, 0);
  return texts.join("\n\n").trim();
}

private collectStringsFromObject(value: unknown, texts: string[], depth: number): void {
  if (depth > 10 || value == null) {
    return;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      trimmed.length > 10 &&
      !trimmed.startsWith("http://") &&
      !trimmed.startsWith("https://") &&
      !/^[a-f0-9-]{20,}$/i.test(trimmed)
    ) {
      texts.push(trimmed);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      this.collectStringsFromObject(item, texts, depth + 1);
    }
    return;
  }

  if (typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      this.collectStringsFromObject(child, texts, depth + 1);
    }
  }
}
```

### A8. 新增 `convertCraftFallback`

```ts
private convertCraftFallback(craft: Record<string, unknown>, boardId: string): ConvertedContent {
  const type = readString(craft, "type") ?? "unknown";
  const title = readString(craft, "title") ?? "Untitled";
  const id = readString(craft, "id") ?? "";

  return {
    markdown: [
      `# ${title}`,
      "",
      `> ${type} craft`,
      `> [Open in YouMind](https://youmind.com/crafts/${id})`,
      "",
      `This ${type} craft could not be fully converted. Open the link above to view it in YouMind.`,
      "",
    ].join("\n"),
    frontmatter: this.buildFrontmatter(id, boardId, type, "pull"),
    suggestedFileName: this.sanitizeFileName(title),
    subfolder: "crafts",
  };
}
```

---

## Part B: 修改 `src/pull-service.ts`

### B1. 调整 `craftToMarkdown` 调用为 async

此前如果 `craftToMarkdown` 是同步方法，这里要改成 `await`。

### B2. 传入 `imageDownloader` 和 `mdFilePath`

Craft 类型也需要图片下载，所以和 Material Pull 一样要传：

- `this.imageDownloader`
- 预估的 Markdown 目标路径 `mdFilePath`

路径计算建议直接复用当前 PullService 里 Material Pull 的思路：

```ts
const previewFileName = this.converter.sanitizeFileName(
  readTitle(detail, "Untitled Craft"),
);
const syncRoot = this.plugin.settings.syncRoot || "youmind";
const sanitizedBoardName = this.converter.sanitizeFileName(boardName);
const estimatedMdPath = normalizePath(
  `${syncRoot}/${sanitizedBoardName}/crafts/${previewFileName}.md`,
);
```

说明：

- 这个路径是 Pull 前的“预估目标路径”
- 主要用于给 `ImageDownloader` 计算附件目录和相对路径
- 真正写入时仍可继续走现有的去重逻辑，避免重名覆盖

示意：

```ts
const converted = await this.converter.craftToMarkdown(
  detail,
  boardId,
  this.imageDownloader,
  estimatedMdPath,
);
```

---

## Part C: 修改 `src/browser-view.ts`

### C1. 扩展可拉取 Craft 类型

将 `PULLABLE_CRAFT_TYPES` 扩为：

```ts
const PULLABLE_CRAFT_TYPES = new Set(["page", "slides", "webpage", "audio-pod", "canvas"]);
```

### C2. 调整 Craft 预览

建议行为：

- `slides`：优先显示第一张图或简短说明
- `webpage`：显示截图和 `contentUrl`
- `audio-pod` / `canvas`：显示文本预览或 fallback 说明

但这里要注意：

- 预览逻辑可以简化
- Pull 成功比预览精细度更重要
- 对 `audio-pod` / `canvas` 不要写死猜测字段路径

---

## 修改总览

| 文件 | 动作 | 说明 |
| --- | --- | --- |
| `src/content-converter.ts` | 修改 | `craftToMarkdown` 改为 async，新增 `convertSlides` / `convertWebpage` / `convertAudioPod` / `convertCanvas` / `convertCraftFallback` / 通用文本提取辅助方法 |
| `src/pull-service.ts` | 修改 | 适配 async `craftToMarkdown`，传入 `imageDownloader` 和 `mdFilePath` |
| `src/browser-view.ts` | 修改 | 扩展可拉取 Craft 类型，并同步预览与 Pull 按钮行为 |

---

## 数据流

### Slides

```text
User clicks Pull
  -> getCraft(id)
  -> craftToMarkdown(type=slides)
  -> parse content.raw JSON
  -> extract timeline.scenes
  -> download scene thumbnails
  -> generate markdown outline
  -> create local file
```

### Webpage

```text
User clicks Pull
  -> getCraft(id)
  -> craftToMarkdown(type=webpage)
  -> download screenshot
  -> include contentUrl
  -> create local file
```

### AudioPod / Canvas

```text
User clicks Pull
  -> getCraft(id)
  -> craftToMarkdown(type=audio-pod/canvas)
  -> extractTextContent(content)
  -> if empty: fallback
  -> create local file
```

---

## 导出示例

### Slides

```markdown
# Deck Title

> Slides deck with 4 scenes
> [Open in YouMind](https://youmind.com/crafts/xxx)

## 1. Cover (cover)

![Cover](attachments/slide_1_cover.jpeg)

Title: YouMind for Obsidian
Subtitle: Cloud AI + Local Vault
```

### Webpage

```markdown
# Webpage Title

> Webpage craft
> [Open in YouMind](https://youmind.com/crafts/xxx)

![Webpage Title](attachments/webpage_title_screenshot.png)

**HTML Source:** [https://cdn.gooo.ai/artifacts/.../index.html](https://cdn.gooo.ai/artifacts/.../index.html)
```

### AudioPod

```markdown
# Podcast Title

> AudioPod transcript
> [Open in YouMind](https://youmind.com/crafts/xxx)

---

这里是通过 extractTextContent 提取到的文本内容。
如果无法提取，则回退为仅保留标题和 YouMind 链接的 fallback 模板。
```

### Canvas

```markdown
# Canvas Title

> Canvas content
> [Open in YouMind](https://youmind.com/crafts/xxx)

---

这里是通过 extractTextContent 提取到的文本内容。
如果无法提取，则回退为仅保留标题和 YouMind 链接的 fallback 模板。
```

---

## 验收标准

### 构建验证

- `npm run build` 通过

### Slides

- Browser View 中 `slides` 可见 Pull 按钮
- Pull 后生成本地 Markdown
- Markdown 包含场景标题
- 缩略图优先下载到本地附件目录
- JSON 解析失败时回退到 fallback

### Webpage

- Browser View 中 `webpage` 可见 Pull 按钮
- Pull 后包含截图
- 截图优先下载到本地附件目录
- Markdown 包含 `contentUrl`
- 无内容时仍保留标题和 YouMind 链接

### AudioPod

- Browser View 中 `audio-pod` 可见 Pull 按钮
- Pull 时不会因未知 DTO 结构崩溃
- `content.plain` / `content.raw` / `content` 至少尝试一轮
- JSON 字符串可递归提取文本
- 提取失败时使用 fallback

### Canvas

- Browser View 中 `canvas` 可见 Pull 按钮
- Pull 时不会因未知 DTO 结构崩溃
- 使用与 AudioPod 相同的防御性文本提取
- 提取失败时使用 fallback

### 回归验证

- `page` 类型行为不变
- Material Pull 行为不变
- Browser View 现有功能不受影响
- Pull Confirm Panel 现有行为不受影响

---

## 注意事项

1. `Canvas` 在产品语义上和 `webpage` 容易混淆，但代码里必须按真实 `type` 区分处理。
2. `audio-pod` 和 `canvas` 当前没有真实实例可稳定验证，代码必须偏保守。
3. 这一轮的首要目标是“可导出且不崩”，不是把未知类型一次性完美结构化。
4. 如果未来拿到真实 `AudioPodDto` / `CanvasDto` 样本，再做针对性增强，不要现在硬猜字段。
