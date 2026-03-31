# Phase 1.3.4 — 图片本地下载 (Codex 指令)


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

- ✅ Browser View（`src/browser-view.ts`）— 侧边栏 ItemView，展示 Materials / Crafts 树，按类型智能预览，可拖拽 resizer

- ✅ Preview Panel 按类型分发渲染（Markdown / 图片 / 音视频 / Fallback）

- ✅ Pull to Vault 核心逻辑（`src/pull-service.ts` + `src/content-converter.ts`）

- ✅ Pull Confirm Panel（`src/pull-confirm-panel.ts`）

- ✅ API 方法：`listMaterials`、`listCrafts`、`getMaterial`、`getCraft`、`createNote`、`updateNote`、`moveMaterials`、`listBoards`

---

## 本轮目标

**Phase 1.3.4 — Pull 增强：图片本地下载**

当前问题：Pull Image 类型 Material 到 Vault 时，生成的 Markdown 引用的是带签名的远程 CDN 链接（`https://cdn.gooo.ai/user-files/xxx?Expires=...&Signature=...`）。这个链接存在两个严重问题：

1. **链接会过期**——CloudFront 签名 URL 有时效限制，过期后图片不可访问

2. **链接极长**——签名参数导致 URL 长达 300+ 字符，在 Obsidian 源码模式下显示为一大段紫色文本，严重影响可读性

本轮目标：**Pull 时将远程图片下载到 Vault 本地附件目录，Markdown 引用改为本地相对路径**。同时处理 Article / PDF 正文中的内联图片。

**用户价值**：拉取的图片永不过期，离线可用，Markdown 引用干净简洁（`![alt](attachments/image.png)`），与 Obsidian 原生图片体验一致。

---

## 约束

- 所有图标使用 Obsidian 内置的 **Lucide** 图标库，通过 `import { setIcon } from "obsidian"` 调用，**绝不使用 emoji**

- 保持现有文件结构不变（扁平 `src/` 目录）

- `npm run build` 必须通过

- 不破坏已有的 chat / history / board / pick / save / push / browser / pull 功能

- 图片下载失败时**静默回退到远程 URL**，不中断 Pull 流程

---

## 关键背景：ImageDto 真实结构

> ⚠️ 通过 API 验证的 ImageDto 字段结构（非常重要，直接影响本轮所有代码）：

```json
{
  "$class": "ImageDto",
  "type": "image",
  "title": "image",
  "url": undefined,
  "albumUrl": undefined,
  "file": {
    "name": "image.png",
    "mimeType": "image/png",
    "size": 335309,
    "storageUrl": "https://youmind-user-files-private.s3.us-west-1.amazonaws.com/user-files/xxx",
    "url": "https://cdn.gooo.ai/user-files/xxx?Expires=1774956576&Key-Pair-Id=K1YV1INCA5FVUW&Signature=..."
  },
  "extra": "{\"hero_image_metadata\":{\"width\":1212,\"height\":1070}}",
  "content": undefined
}
```

**关键点**：

- 图片真实 URL 在 `file.url`（带签名的 CDN 链接），顶层 `url` 和 `albumUrl` 是 `undefined`

- `file.name` 包含原始文件名（如 `image.png`）

- `file.mimeType` 包含 MIME 类型（如 `image/png`）

- `file.size` 包含文件大小（字节）

---

## 变更清单

---

### Part A: 新增文件 `src/image-downloader.ts`

负责图片下载的独立模块。纯 I/O 逻辑，不涉及 UI。

```typescript
import { App, normalizePath, requestUrl } from "obsidian";

export interface DownloadedImage {
  /** 下载后的 Vault 内相对路径，如 "youmind/AI Research/attachments/image.png" */
  localPath: string;
  /** 相对于引用该图片的 .md 文件的路径，如 "attachments/image.png" */
  relativePath: string;
}

export class ImageDownloader {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * 下载远程图片到 Vault 本地附件目录
   *
   * @param imageUrl   远程图片 URL
   * @param fileName   期望的文件名（如 "screenshot.png"）
   * @param mdFilePath 引用该图片的 .md 文件路径（用于计算相对路径）
   * @returns 下载结果，失败返回 null
   */
  async download(
    imageUrl: string,
    fileName: string,
    mdFilePath: string
  ): Promise<downloadedimage |="" null=""> {
    try {
      // 1. 确定附件目录
      const attachmentDir = this.resolveAttachmentDir(mdFilePath);
      await this.ensureDirectory(attachmentDir);

      // 2. 清洗文件名 + 确定扩展名
      const safeName = this.sanitizeImageFileName(fileName, imageUrl);

      // 3. 去重：如果同名文件已存在，追加数字后缀
      const finalPath = await this.deduplicateImagePath(
        normalizePath(`${attachmentDir}/${safeName}`)
      );

      // 4. 下载图片
      const response = await requestUrl({
        url: imageUrl,
        method: "GET",
      });

      if (response.status !== 200) {
        console.warn(`[YouMind ImageDownloader] HTTP ${response.status} for ${imageUrl}`);
        return null;
      }

      // 5. 写入 Vault
      await this.app.vault.createBinary(finalPath, response.arrayBuffer);

      // 6. 计算相对路径（相对于 .md 文件所在目录）
      const mdDir = mdFilePath.substring(0, mdFilePath.lastIndexOf("/"));
      const relativePath = this.getRelativePath(mdDir, finalPath);

      return { localPath: finalPath, relativePath };

    } catch (error) {
      console.warn("[YouMind ImageDownloader] Download failed:", error);
      return null;
    }
  }

  /**
   * 批量下载图片，返回 URL → 本地路径的映射
   * 用于处理 Article/PDF 正文中的内联图片
   */
  async downloadBatch(
    imageUrls: string[],
    mdFilePath: string
  ): Promise<map<string, downloadedimage="">> {
    const results = new Map<string, downloadedimage="">();

    for (const url of imageUrls) {
      // 从 URL 中提取文件名
      const fileName = this.extractFileNameFromUrl(url);
      const result = await this.download(url, fileName, mdFilePath);
      if (result) {
        results.set(url, result);
      }
    }

    return results;
  }

  // ─── 私有方法 ───

  /**
   * 确定附件目录路径
   * 尊重 Obsidian 的附件目录设置（Settings → Files & Links → Default location for new attachments）
   * 如果设置为 "In subfolder under current folder"，使用该子文件夹名
   * 否则默认在 .md 文件同级创建 "attachments" 子目录
   */
  private resolveAttachmentDir(mdFilePath: string): string {
    const mdDir = mdFilePath.substring(0, mdFilePath.lastIndexOf("/"));

    // 读取 Obsidian 的附件目录设置
    const vaultConfig = (this.app.vault as any).config;
    const attachmentFolderPath = vaultConfig?.attachmentFolderPath;

    if (attachmentFolderPath) {
      if (attachmentFolderPath.startsWith("./")) {
        // "In subfolder under current folder" 模式
        // 例如 "./attachments" → 在 .md 文件同级的 attachments 子目录
        const subFolder = attachmentFolderPath.substring(2);
        return normalizePath(`${mdDir}/${subFolder}`);
      } else if (attachmentFolderPath === "/") {
        // "Vault folder" 模式 → 放在 Vault 根目录
        return "";
      } else {
        // "In the folder specified below" 模式 → 使用指定的绝对路径
        return normalizePath(attachmentFolderPath);
      }
    }

    // 默认：在 .md 文件同级创建 "attachments" 子目录
    return normalizePath(`${mdDir}/attachments`);
  }

  /**
   * 清洗图片文件名，确保安全且有正确扩展名
   */
  private sanitizeImageFileName(fileName: string, imageUrl: string): string {
    // 移除不安全字符
    let safe = fileName
      .replace(/[\\/:*?"<>|#^[\]]/g, "")
      .replace(/\s+/g, "_")
      .trim();

    // 如果文件名为空，用时间戳
    if (!safe || safe === "." || safe === "..") {
      safe = `image_${Date.now()}`;
    }

    // 确保有正确的图片扩展名
    const ext = this.getImageExtension(safe, imageUrl);
    const nameWithoutExt = safe.replace(/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|tiff?)$/i, "");

    return `${nameWithoutExt}.${ext}`;
  }

  /**
   * 从文件名或 URL 推断图片扩展名
   */
  private getImageExtension(fileName: string, imageUrl: string): string {
    // 1. 先从文件名提取
    const fileMatch = fileName.match(/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|tiff?)$/i);
    if (fileMatch) return fileMatch[1].toLowerCase();

    // 2. 从 URL 路径提取（去掉查询参数后）
    try {
      const urlPath = new URL(imageUrl).pathname;
      const urlMatch = urlPath.match(/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|tiff?)$/i);
      if (urlMatch) return urlMatch[1].toLowerCase();
    } catch {
      // URL 解析失败，继续
    }

    // 3. 默认 png
    return "png";
  }

  /**
   * 从 URL 中提取文件名
   */
  private extractFileNameFromUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const segments = pathname.split("/");
      const lastSegment = segments[segments.length - 1];
      if (lastSegment && lastSegment.includes(".")) {
        return decodeURIComponent(lastSegment);
      }
    } catch {
      // URL 解析失败
    }
    return `image_${Date.now()}.png`;
  }

  /**
   * 图片路径去重
   */
  private async deduplicateImagePath(basePath: string): Promise<string> {
    if (!this.app.vault.getAbstractFileByPath(basePath)) {
      return basePath;
    }

    const dotIndex = basePath.lastIndexOf(".");
    const nameWithoutExt = dotIndex > 0 ? basePath.substring(0, dotIndex) : basePath;
    const ext = dotIndex > 0 ? basePath.substring(dotIndex) : ".png";

    let counter = 1;
    let newPath = `${nameWithoutExt}_${counter}${ext}`;
    while (this.app.vault.getAbstractFileByPath(newPath)) {
      counter++;
      newPath = `${nameWithoutExt}_${counter}${ext}`;
    }
    return newPath;
  }

  /**
   * 计算相对路径
   * 从 fromDir 到 toPath 的相对路径
   */
  private getRelativePath(fromDir: string, toPath: string): string {
    // 如果在同一目录或子目录下，直接用相对路径
    if (toPath.startsWith(fromDir + "/")) {
      return toPath.substring(fromDir.length + 1);
    }

    // 否则用 Vault 绝对路径（Obsidian 也支持）
    return toPath;
  }

  /**
   * 确保目录存在，递归创建
   */
  private async ensureDirectory(dirPath: string): Promise<void> {
    if (!dirPath) return;
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
}
</void></string></string,></map<string,></downloadedimage>
```

---

### Part B: 修改 `src/content-converter.ts`

将 `ContentConverter` 从纯同步转换升级为支持异步图片下载。核心思路：**转换方法变为 async，接受可选的 **`ImageDownloader`** 参数；有 downloader 时下载图片到本地，没有时回退到远程 URL（保持向后兼容）。**

#### B1. 修改接口：`ConvertedContent` 不变

`ConvertedContent` 接口保持不变，不需要新增字段。图片下载后的本地路径直接写入 `markdown` 字段中的 `![alt](localPath)` 引用。

#### B2. 新增 import

在文件顶部添加：

```typescript
import { ImageDownloader } from "./image-downloader";
```

#### B3. 修改 `materialToMarkdown` 为 async

```typescript
// ===== 修复前 =====
materialToMarkdown(material: any, boardId: string): ConvertedContent {

// ===== 修复后 =====
async materialToMarkdown(
  material: any,
  boardId: string,
  imageDownloader?: ImageDownloader,
  mdFilePath?: string
): Promise<convertedcontent> {
</convertedcontent>
```

switch 内部的调用也要加 `await`：

```typescript
switch (type) {
  case "note":
    return this.convertNote(material, boardId);
  case "article":
    return await this.convertArticle(material, boardId, imageDownloader, mdFilePath);
  case "image":
    return await this.convertImage(material, boardId, imageDownloader, mdFilePath);
  case "voice":
  case "video":
    return this.convertMediaTranscript(material, boardId);
  case "pdf":
    return await this.convertPdf(material, boardId, imageDownloader, mdFilePath);
  case "text-file":
    return this.convertTextFile(material, boardId);
  default:
    return this.convertFallback(material, boardId);
}
```

> Note 和 TextFile 不含图片，保持同步。Voice/Video 的转录文本也不含图片。只有 Image、Article、PDF 需要异步下载。

#### B4. 重写 `convertImage` — 核心改动

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

/**
 * 从 ImageDto 中提取原始文件名
 * 优先用 file.name，其次用 title，最后用时间戳
 */
private resolveImageFileName(material: any): string {
  return material.file?.name
    ?? (material.title ? `${material.title}.png` : `image_${Date.now()}.png`);
}

private async convertImage(
  material: any,
  boardId: string,
  imageDownloader?: ImageDownloader,
  mdFilePath?: string
): Promise<convertedcontent> {
  const parts: string[] = [];

  const imageUrl = this.resolveImageUrl(material);

  if (imageUrl) {
    let imageRef = imageUrl;  // 默认用远程 URL

    // 如果有 downloader 和目标路径，尝试下载到本地
    if (imageDownloader && mdFilePath) {
      const fileName = this.resolveImageFileName(material);
      const downloaded = await imageDownloader.download(imageUrl, fileName, mdFilePath);
      if (downloaded) {
        imageRef = downloaded.relativePath;
      }
      // 下载失败时 imageRef 保持为远程 URL（静默回退）
    }

    parts.push(`![${material.title || "image"}](${imageRef})`);
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
</convertedcontent>
```

#### B5. 修改 `convertArticle` — 处理正文内联图片

Article 的正文（`content.plain`）中可能包含 Markdown 图片引用 `![alt](url)`。需要扫描这些引用，把远程图片下载到本地，替换为本地路径。

```typescript
private async convertArticle(
  material: any,
  boardId: string,
  imageDownloader?: ImageDownloader,
  mdFilePath?: string
): Promise<convertedcontent> {
  const parts: string[] = [];

  if (material.url) {
    parts.push(`> Source: ${material.url}`);
    parts.push("");
  }

  let body = material.content?.plain ?? material.content ?? "";

  // 下载正文中的内联图片
  if (body && imageDownloader && mdFilePath) {
    body = await this.downloadInlineImages(body, imageDownloader, mdFilePath);
  }

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
</convertedcontent>
```

#### B6. 修改 `convertPdfSummary` → `convertPdf` — 同样处理内联图片

```typescript
private async convertPdf(
  material: any,
  boardId: string,
  imageDownloader?: ImageDownloader,
  mdFilePath?: string
): Promise<convertedcontent> {
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

  let body = material.content?.plain ?? material.content ?? "";

  // 下载正文中的内联图片
  if (body && imageDownloader && mdFilePath) {
    body = await this.downloadInlineImages(body, imageDownloader, mdFilePath);
  }

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
</convertedcontent>
```

#### B7. 新增 `downloadInlineImages` — 扫描并替换正文中的远程图片

```typescript
/**
 * 扫描 Markdown 正文中的远程图片引用，下载到本地并替换路径
 * 匹配 ![alt](https://...) 格式
 * 只处理 http/https 开头的 URL，跳过已经是本地路径的引用
 */
private async downloadInlineImages(
  markdown: string,
  imageDownloader: ImageDownloader,
  mdFilePath: string
): Promise<string> {
  // 匹配 Markdown 图片语法：![任意alt](http开头的URL)
  const imageRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  const matches: Array<{ full: string; alt: string; url: string }> = [];

  let match;
  while ((match = imageRegex.exec(markdown)) !== null) {
    matches.push({ full: match[0], alt: match[1], url: match[2] });
  }

  if (matches.length === 0) return markdown;

  // 逐个下载并替换（不并发，避免过载）
  let result = markdown;
  for (const m of matches) {
    const fileName = imageDownloader["extractFileNameFromUrl"]
      ? this.extractFileNameFromUrl(m.url)
      : `inline_${Date.now()}.png`;

    const downloaded = await imageDownloader.download(m.url, fileName, mdFilePath);
    if (downloaded) {
      // 替换为本地路径
      result = result.replace(m.full, `![${m.alt}](${downloaded.relativePath})`);
    }
    // 下载失败时保留原始远程 URL
  }

  return result;
}

/**
 * 从 URL 中提取文件名（供内联图片使用）
 */
private extractFileNameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/");
    const lastSegment = segments[segments.length - 1];
    if (lastSegment && lastSegment.includes(".")) {
      return decodeURIComponent(lastSegment);
    }
  } catch {
    // URL 解析失败
  }
  return `inline_image_${Date.now()}.png`;
}
</string>
```

#### B8. 不变的方法

以下方法**不需要修改**，保持原样：

- `craftToMarkdown` — Craft 内容是纯 Markdown 文本，不含远程图片引用（Craft 的图片已经是 YouMind 内部管理的）

- `markdownToNote` — Push 方向，不涉及图片下载

- `convertNote` — Note 是用户创建的纯文本，不含远程图片

- `convertMediaTranscript` — 转录文本不含图片

- `convertTextFile` — 纯文本不含图片

- `convertFallback` — 只生成链接文本

- `buildFrontmatter` — 不变

- `sanitizeFileName` — 不变

- `resolveImageUrl` — 已在 1.3.3 修补，保持不变

---

### Part C: 修改 `src/pull-service.ts`

PullService 需要适配 ContentConverter 的 async 变更，并传入 ImageDownloader 实例。

#### C1. 新增 import 和属性

```typescript
// 在文件顶部添加：
import { ImageDownloader } from "./image-downloader";

// 在 PullService 类中新增属性：
private imageDownloader: ImageDownloader;

// 在构造函数中初始化：
constructor(app: App, plugin: any) {
  this.app = app;
  this.plugin = plugin;
  this.converter = new ContentConverter();
  this.imageDownloader = new ImageDownloader(app);  // 新增
}
```

#### C2. 修改 `pull` 方法 — 传入 imageDownloader 和预计算的 mdFilePath

核心改动：在调用 `materialToMarkdown` 之前，先预计算出 .md 文件将要写入的路径，这样 ImageDownloader 才能知道附件目录在哪里。

```typescript
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

    // 3. 预计算 .md 文件路径（用于图片下载时确定附件目录）
    const previewFileName = this.converter.sanitizeFileName(
      detail.title || (entityType === "craft" ? "Untitled Page" : "Untitled")
    );
    const subfolder = entityType === "craft" ? "crafts" : "materials";
    const syncRoot = this.plugin.settings.syncRootFolder || "youmind";
    const sanitizedBoardName = this.converter.sanitizeFileName(boardName);
    const estimatedMdPath = normalizePath(
      `${syncRoot}/${sanitizedBoardName}/${subfolder}/${previewFileName}.md`
    );

    // 4. 转换为 Markdown（带图片下载）
    const converted = entityType === "material"
      ? await this.converter.materialToMarkdown(detail, boardId, this.imageDownloader, estimatedMdPath)
      : this.converter.craftToMarkdown(detail, boardId);

    // 5. 确定本地路径并写入
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
</pullresult>
```

#### C3. 修改 `updateExisting` — 同样传入 imageDownloader

```typescript
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
    ? await this.converter.materialToMarkdown(detail, boardId, this.imageDownloader, existingFile.path)
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
</pullresult>
```

#### C4. 其他方法不变

以下方法**保持原样不修改**：

- `pullBatch` — 内部调用 `this.pull()`，自动获得图片下载能力

- `moveFile` — 移动 .md 文件，不涉及图片（附件目录是独立的）

- `fetchDetail` — 不变

- `writeFile` — 不变

- `buildFileContent` — 不变

- `deduplicatePath` — 不变

- `ensureDirectory` — 不变

- `sleep` — 不变

---

### Part D: 修改 `src/browser-view.ts` — Preview 中的图片渲染器

Preview 中的 `renderImagePreview` 不需要改动——它直接用远程 URL 显示图片，这是预览场景，不需要下载到本地。签名 URL 在预览时是有效的（刚从 API 拿到），只有保存到 Vault 后才会过期。

**所以 **`src/browser-view.ts`** 本轮不做任何修改。**

---

## 不做的事情

### 本轮不实现（后续规划）

- ❌ 不实现实时同步（双向自动同步）— 规划在 Phase 1.4

- ❌ 不实现冲突合并 — 规划在 Phase 1.5

- ❌ 不实现 Slides / Webpage / AudioPod / Canvas 的内容拉取 — 规划在 Phase 1.3.5

- ❌ 不实现图片上传回 YouMind（Push 方向的图片处理）— 后续规划

- ❌ 不处理 Voice/Video 的音视频文件下载（只处理图片）

### 本轮不修改（防回归）

- ❌ 不修改 Chat View 逻辑

- ❌ 不修改 Save / Push 逻辑

- ❌ 不修改 Save Confirm Panel 逻辑

- ❌ 不修改 Pull Confirm Panel 逻辑

- ❌ 不修改 Browser View 的 Preview 渲染逻辑

- ❌ 不引入子目录结构（保持扁平 `src/`）

---

## 修改总览

### 新增文件

| 文件 | 职责 |
| --- | --- |
| `src/image-downloader.ts` | 图片下载模块：下载远程图片到 Vault 附件目录，处理文件名去重、扩展名识别、相对路径计算 |

### 修改文件

| 文件 | 改动 |
| --- | --- |
| `src/content-converter.ts` | `materialToMarkdown` 变 async;`convertImage` 支持下载图片到本地；`convertArticle` 和 `convertPdf` 支持下载正文内联图片；新增 `downloadInlineImages` 方法 |
| `src/pull-service.ts` | 新增 `ImageDownloader` 实例；`pull` 和 `updateExisting` 传入 downloader 和 mdFilePath |

### 不修改的文件

| 文件 | 原因 |
| --- | --- |
| `src/browser-view.ts` | Preview 用远程 URL 即可，不需要下载 |
| `src/pull-confirm-panel.ts` | 不涉及图片逻辑 |
| `src/types.ts` | 不需要新增类型 |
| `src/plugin-class.ts` | 不需要改动 |
| `src/frontmatter-manager.ts` | 不需要改动 |
| `src/api.ts` | 不需要改动 |
| `styles.css` | 不需要新增样式 |

---

## Vault 目录结构示例

Pull Image 类型 Material 后的本地文件结构：

```plaintext
vault-root/
├── youmind/
│   ├── AI Research/
│   │   ├── materials/
│   │   │   ├── attachments/                    ← 图片附件目录（自动创建）
│   │   │   │   ├── screenshot.png              ← 下载的图片
│   │   │   │   ├── architecture_diagram.png
│   │   │   │   └── inline_image_1.png          ← Article 正文中的内联图片
│   │   │   ├── Transformer 论文.md             ← Article（正文中的图片引用已替换为本地路径）
│   │   │   ├── Screenshot.md                   ← Image 类型
│   │   │   └── Meeting Notes.md
│   │   └── crafts/
│   │       └── AI 综述 v2.md
```

Image 类型 Pull 后的 .md 文件内容：

```markdown
---
youmind_id: "019b5987-d8c9-70ef-8194-bb0679ce1d65"
youmind_board: "019acf76-e987-7e71-98a6-ebfa09f25206"
youmind_type: "image"
youmind_synced_at: "2026-03-31T18:30:00.000Z"
youmind_source: "pull"
---

![image](attachments/image.png)
```

Article 类型 Pull 后，正文中的内联图片也被替换：

```markdown
---
youmind_id: "..."
youmind_board: "..."
youmind_type: "article"
youmind_synced_at: "..."
youmind_source: "pull"
---

> Source: https://example.com/article

This is the article content with an inline image:

![diagram](attachments/diagram.png)

More text follows...
```

---

## 数据流

### Pull Image Material（新流程）

```plaintext
用户在 Browser View 点击 "Pull to Vault"
  → PullService.pull()
    → getMaterial(id, includeBlocks=true)
    → 预计算 .md 文件路径 estimatedMdPath
    → ContentConverter.materialToMarkdown(detail, boardId, imageDownloader, estimatedMdPath)
      → convertImage()
        → resolveImageUrl() → "https://cdn.gooo.ai/user-files/xxx?Expires=...&Signature=..."
        → resolveImageFileName() → "image.png"
        → ImageDownloader.download(url, "image.png", estimatedMdPath)
          → resolveAttachmentDir() → "youmind/AI Research/materials/attachments"
          → requestUrl(GET url) → 下载图片二进制
          → vault.createBinary("youmind/.../attachments/image.png", arrayBuffer)
          → 返回 { localPath: "youmind/.../attachments/image.png", relativePath: "attachments/image.png" }
        → markdown = "![image](attachments/image.png)"   ← 本地相对路径！
    → 写入 .md 文件
  → 弹出 PullConfirmPanel
```

### Pull Article with Inline Images（新流程）

```plaintext
PullService.pull()
  → ContentConverter.materialToMarkdown()
    → convertArticle()
      → 获取正文 body = "...![fig1](https://cdn.gooo.ai/...)..."
      → downloadInlineImages(body, imageDownloader, mdFilePath)
        → 正则匹配所有 ![alt](https://...) 引用
        → 逐个下载到 attachments/ 目录
        → 替换为本地路径 "...![fig1](attachments/fig1.png)..."
      → 返回替换后的 markdown
```

### 下载失败回退

```plaintext
ImageDownloader.download()
  → requestUrl() 失败（网络错误 / 404 / 超时）
  → 返回 null
→ convertImage() 中 downloaded === null
  → imageRef 保持为远程 URL
  → markdown = "![image](https://cdn.gooo.ai/...?Expires=...)"   ← 回退到远程 URL
```

---

## 验收标准

### A. Image 类型 Pull — 图片本地下载

- [ ]  Pull Image 类型 Material → 本地创建 .md 文件 + 图片文件

- [ ]  图片文件保存在 .md 文件同级的 `attachments/` 子目录下

- [ ]  .md 文件中的图片引用是本地相对路径 `![alt](attachments/xxx.png)`，不是远程 URL

- [ ]  在 Obsidian 阅读视图中，图片正常显示

- [ ]  图片文件名来自 `file.name`（如 `image.png`），不是乱码或时间戳

- [ ]  图片扩展名正确（.png / .jpg / .webp 等，根据原始文件）

### B. 文件名处理

- [ ]  图片文件名中的特殊字符被清洗（`\/:*?"<>|` 等）

- [ ]  同名图片自动追加数字后缀（`image.png` → `image_1.png` → `image_2.png`）

- [ ]  文件名为空时使用时间戳兜底（`image_1711900000000.png`）

### C. Obsidian 附件目录设置

- [ ]  如果 Obsidian 设置了 `attachmentFolderPath = "./assets"`，图片保存到 `assets/` 而不是 `attachments/`

- [ ]  如果设置为绝对路径（如 `media`），图片保存到 Vault 根目录下的 `media/`

- [ ]  如果没有设置（默认），图片保存到 .md 文件同级的 `attachments/`

### D. Article / PDF 内联图片

- [ ]  Pull Article 类型 Material，正文中的 `![alt](https://...)` 远程图片被下载到本地

- [ ]  正文中的图片引用被替换为本地相对路径

- [ ]  Pull PDF 类型 Material，正文中的内联图片同样被处理

- [ ]  非图片的 URL（如 `[link](https://...)`）不受影响

### E. 下载失败回退

- [ ]  网络断开时，图片下载失败，.md 文件中保留远程 URL（不是空白）

- [ ]  远程 URL 返回 404 时，同样回退到远程 URL

- [ ]  下载失败不中断 Pull 流程，.md 文件仍然正常创建

- [ ]  控制台输出 warn 级别日志（不是 error）

### F. 更新已有文件

- [ ]  对已关联的 Image item 执行 “Update from YouMind”，图片重新下载到本地

- [ ]  更新后 .md 文件中的图片引用仍然是本地相对路径

### G. 批量拉取

- [ ]  Group “Pull All” 批量拉取时，每个 Image 类型都正确下载图片

- [ ]  批量拉取不会因为某个图片下载失败而中断整个流程

### H. 回归确认

- [ ]  Note 类型 Pull 不受影响（无图片下载逻辑）

- [ ]  Voice/Video 类型 Pull 不受影响

- [ ]  Craft (Page) 类型 Pull 不受影响

- [ ]  Browser View Preview 仍然正常（用远程 URL 显示图片）

- [ ]  `npm run build` 通过

- [ ]  已有的 chat / save / push 功能不受影响