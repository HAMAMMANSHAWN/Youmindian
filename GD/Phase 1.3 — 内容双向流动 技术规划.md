# Phase 1.3 — 内容双向流动 技术规划


## 一句话定义

**让 Obsidian Vault 和 YouMind Cloud 之间的内容不再是两个孤岛——本地笔记可以推送到 Board 成为云端素材，Board 里的资料和作品可以拉取到 Vault 成为本地 Markdown，而 frontmatter 是连接两个世界的纽带。**

---

## 当前状态与目标

### Phase 1.2 结束时我们有什么

| 能力 | 状态 |
| --- | --- |
| 对话（Chat）双向同步 | ✅ 新对话自动创建在云端，历史对话可浏览恢复 |
| 消息操作（复制/插入/保存） | ✅ 4 个操作按钮稳定工作 |
| 摘录（Pick） | ✅ 消息级 + 选区级摘录 |
| Board 选择与切换 | ✅ 下拉选择器 + 上下文隔离 |
| 资料（Material）浏览 | ❌ 完全没有 |
| 作品（Craft）浏览 | ❌ 完全没有 |
| 本地笔记 → YouMind 关联 | ❌ 保存后纯本地，无云端关联 |
| YouMind 内容 → 本地 Vault | ❌ 无法拉取 |

### Phase 1.3 结束时我们要有什么

| 能力 | 目标 |
| --- | --- |
| Board 内容浏览器 | 在侧边栏浏览当前 Board 的 Materials 和 Crafts 树 |
| Pull to Vault | 把云端资料/作品拉取为本地 Markdown 文件 |
| Push to YouMind | 把本地笔记推送到 Board 成为 Note |
| Frontmatter 关联 | 本地文件通过 frontmatter 记录 YouMind ID，建立双向追踪 |
| “保存为新笔记”升级 | 同时创建本地文件 + 云端 Note，自动写入 frontmatter |
| 语义搜索 | 在聊天输入框中搜索 Board 内容并引用 |

---

## 架构设计

### 数据流全景

```plaintext
┌─────────────────────────────────────────────────────────────┐
│                     YouMind Cloud                            │
│                                                              │
│  Board ─┬─ Materials ─┬─ Article (网页文章)                  │
│         │             ├─ Note (用户笔记)                     │
│         │             ├─ Image / Voice / Video               │
│         │             ├─ PDF / Office / Text                 │
│         │             └─ MaterialGroup (文件夹)              │
│         │                                                    │
│         └─ Crafts ────┬─ Page (文档)                         │
│                       ├─ Slides (幻灯片)                     │
│                       ├─ Webpage / AudioPod / Canvas         │
│                       └─ CraftGroup (文件夹)                 │
│                                                              │
│  API: listMaterials, getMaterial, createNote, updateNote      │
│       listCrafts, getCraft, search, createMaterialByUrl      │
└──────────────┬───────────────────────────────┬───────────────┘
               │  Pull (←)                     │  Push (→)
               ▼                               ▲
┌──────────────────────────────────────────────────────────────┐
│                  YouMind for Obsidian Plugin                   │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Content Bridge                                          │ │
│  │                                                          │ │
│  │  ┌──────────────┐  ┌────────────┐  ┌─────────────────┐ │ │
│  │  │ Content      │  │ Frontmatter│  │ Push/Pull       │ │ │
│  │  │ Converter    │  │ Manager    │  │ Engine          │ │ │
│  │  │              │  │            │  │                 │ │ │
│  │  │ YM→MD 转换   │  │ 读写关联ID │  │ 拉取/推送/同步  │ │ │
│  │  │ MD→YM 转换   │  │ 追踪同步态 │  │ 冲突检测       │ │ │
│  │  └──────────────┘  └────────────┘  └─────────────────┘ │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  UI: Board Content Browser (新增 ItemView)               │ │
│  │                                                          │ │
│  │  ┌─────────────────────┐  ┌──────────────────────────┐  │ │
│  │  │ Materials Tab        │  │ Crafts Tab               │  │ │
│  │  │                      │  │                          │  │ │
│  │  │ 📁 Research Papers   │  │ 📝 AI 综述 v2            │  │ │
│  │  │   📄 Transformer..  │  │ 📝 项目计划              │  │ │
│  │  │   📄 Attention Is.. │  │ 🎬 产品演示 Slides       │  │ │
│  │  │ 📄 Meeting Notes     │  │ 📁 Drafts               │  │ │
│  │  │ 🖼️ Architecture..   │  │   📝 Blog Draft          │  │ │
│  │  │                      │  │                          │  │ │
│  │  │ [Pull] [Preview]     │  │ [Pull] [Open in YM]     │  │ │
│  │  └─────────────────────┘  └──────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────┘ │
└───────────────────────────────┬───────────────────────────────┘
                                │
                    Obsidian Vault (local files)
                                │
              ┌─────────────────┴─────────────────┐
              │  youmind/                          │
              │  ├── AI Research/                   │
              │  │   ├── Transformer 论文.md        │
              │  │   └── AI 综述 v2.md              │
              │  └── Content/                       │
              │      └── Blog Draft.md              │
              │                                     │
              │  每个文件的 frontmatter:             │
              │  ---                                │
              │  youmind_id: "uuid"                 │
              │  youmind_board: "uuid"              │
              │  youmind_type: "note"               │
              │  youmind_synced_at: "ISO date"      │
              │  ---                                │
              └─────────────────────────────────────┘
```

---

## 子阶段拆解

### Phase 1.3.1 — Frontmatter 关联体系 + “保存为新笔记”升级

**目标**：建立本地文件与 YouMind 实体之间的关联机制，让“保存为新笔记”同时在云端创建 Note。

#### Frontmatter 规范

每个与 YouMind 关联的本地文件，在 frontmatter 中记录以下字段：

```yaml
---
youmind_id: "019d4219-6105-7beb-8b48-15a65b2b4d03"      # YouMind 实体 ID
youmind_board: "019acf76-e987-7e71-98a6-ebfa09f25206"     # 所属 Board ID
youmind_type: "note"                                       # 实体类型: note | article | page | image | voice | video | pdf
youmind_synced_at: "2026-03-31T15:00:00.000Z"             # 最后同步时间
youmind_source: "push"                                     # 来源: push (本地→云端) | pull (云端→本地)
---
```

#### Frontmatter Manager 模块

```typescript
// core/vault/frontmatter.ts

interface YouMindFrontmatter {
  youmind_id: string;
  youmind_board: string;
  youmind_type: 'note' | 'article' | 'page' | 'image' | 'voice' | 'video' | 'pdf' | 'text' | 'office';
  youmind_synced_at: string;   // ISO 8601
  youmind_source: 'push' | 'pull';
}

class FrontmatterManager {
  /**
   * 从本地文件读取 YouMind 关联信息
   * 返回 null 表示该文件未与 YouMind 关联
   */
  read(file: TFile): YouMindFrontmatter | null;

  /**
   * 写入或更新 YouMind 关联信息到文件 frontmatter
   * 保留文件中已有的其他 frontmatter 字段
   */
  write(file: TFile, meta: YouMindFrontmatter): Promise<void>;

  /**
   * 移除文件的 YouMind 关联信息
   */
  remove(file: TFile): Promise<void>;

  /**
   * 扫描 Vault 中所有已关联的文件
   * 返回 Map<youmind_id, tfile="">
   */
  scanLinkedFiles(): Map<string, tfile="">;

  /**
   * 检查某个 YouMind ID 是否已经有对应的本地文件
   */
  findLocalFile(youmindId: string): TFile | null;
}
</string,></youmind_id,></void></void>
```

#### “保存为新笔记”升级

当前的“Save as note”按钮只做 `vault.create()`。升级后的流程：

```plaintext
用户点击 "Save as note"
    │
    ├── 1. 在 YouMind 云端创建 Note
    │       POST /openapi/v1/createNote
    │       {
    │         boardId: currentBoardId,
    │         title: chatTitle,
    │         content: markdownContent,
    │         genTitle: false
    │       }
    │       → 返回 { id: "note-uuid", ... }
    │
    ├── 2. 在本地 Vault 创建 .md 文件
    │       路径: youmind/{boardName}/{title}.md
    │       内容: frontmatter + markdown
    │
    └── 3. 写入 frontmatter 关联
            ---
            youmind_id: "note-uuid"
            youmind_board: "board-uuid"
            youmind_type: "note"
            youmind_synced_at: "2026-03-31T15:00:00.000Z"
            youmind_source: "push"
            ---
```

#### API 层新增

在 `api.ts` 中添加以下方法：

```typescript
// 创建 Note
async createNote(params: {
  content: string;
  title?: string;
  boardId?: string;
  parentBoardGroupId?: string;
  genTitle?: boolean;
}): Promise<{
  id: string;
  title: string;
  content: string;
  type: string;
  boardId: string;
  position: { boardId: string; rank: string; boardItemId: string };
}>;

// 更新 Note
async updateNote(params: {
  id: string;
  title?: string;
  content?: string;
  titleType?: 'default' | 'ai' | 'manual';
}): Promise<{ id: string; title: string; content: string }>;

// 列出 Board 中的 Materials
async listMaterials(params: {
  boardId: string;
  groupId?: string;
}): Promise<boarditem[]>;

// 获取单个 Material 详情
async getMaterial(params: {
  id: string;
  includeBlocks?: boolean;
}): Promise<materialdto>;

// 列出 Board 中的 Crafts
async listCrafts(params: {
  boardId: string;
  groupId?: string;
}): Promise<craftdto[]>;

// 获取单个 Craft 详情
async getCraft(params: {
  id: string;
  withChildren?: boolean;
}): Promise<craftdto>;

// 语义搜索
async search(params: {
  scope: 'library' | 'board';
  query: string;
  boardId?: string;
  topK?: number;
}): Promise<{ results: SearchResult[]; total: number }>;
</craftdto></craftdto[]></materialdto></boarditem[]>
```

#### Vault 目录结构

拉取和推送的文件统一存放在 `youmind/` 目录下，按 Board 名称分组：

```plaintext
vault-root/
├── youmind/                          ← YouMind 同步根目录
│   ├── AI Research/                  ← Board 名称
│   │   ├── materials/                ← 拉取的资料
│   │   │   ├── Transformer 论文.md
│   │   │   └── Attention Is All You Need.md
│   │   └── crafts/                   ← 拉取的作品
│   │       └── AI 综述 v2.md
│   │
│   └── Content Creation/             ← 另一个 Board
│       ├── materials/
│       └── crafts/
│
├── daily/                            ← 用户自己的笔记（不受影响）
├── projects/
└── ...
```

设置项中允许用户自定义同步根目录名称（默认 `youmind`）。

#### 实现要点

1. **createNote 的 content 是纯文本**：API 文档明确说 “Content is plain text”。所以推送时需要把 Markdown 原样传入（YouMind 会自行处理），拉取时 Note 的 content 也是纯文本/Markdown。

2. **文件名清洗**：Board 名称和标题可能包含 `/`、`\`、`:`、`*` 等文件系统非法字符，需要统一清洗。

3. **重名处理**：如果目标文件已存在且 `youmind_id` 匹配，视为更新；如果 `youmind_id` 不匹配，追加数字后缀。

4. **错误处理**：如果云端创建成功但本地写入失败，需要记录 `youmind_id` 以便后续重试关联。

#### 测试计划

- 在聊天中点击 “Save as note”，确认同时在 YouMind 网页端看到新 Note 出现在 Board 中

- 确认本地文件的 frontmatter 包含正确的 `youmind_id` 和 `youmind_board`

- 确认文件保存在 `youmind/{boardName}/` 目录下

- 重复保存同名笔记，确认自动追加数字后缀

- API Key 无效时，确认只创建本地文件并提示云端同步失败

---

### Phase 1.3.2 — Board Content Browser（内容浏览器）

**目标**：在 Obsidian 侧边栏新增一个 ItemView，展示当前 Board 的 Materials 和 Crafts 树形结构。

#### 视图设计

新注册一个 `youmind-browser-view` 类型的 ItemView，放在右侧边栏（与 Chat View 互补）。

```plaintext
┌──────────────────────────────────────┐
│  📋 AI Research                  🔄  │  ← Board 名称 + 刷新按钮
├──────────────────────────────────────┤
│  [Materials]  [Crafts]  [Search]     │  ← Tab 切换
├──────────────────────────────────────┤
│                                      │
│  📁 Research Papers          ▸       │  ← MaterialGroup（可展开）
│    📄 Transformer 论文       ✅ ↓    │  ← 已拉取到本地（✅）+ Pull 按钮
│    📄 Attention Is All..         ↓   │  ← 未拉取 + Pull 按钮
│    🖼️ Architecture Diagram       ↓   │  ← 图片类型
│  📄 Meeting Notes 03-31     ✅       │  ← 已拉取
│  🎙️ AI Podcast Episode          ↓   │  ← 音频类型
│  📹 Demo Video                   🔗  │  ← 视频（只能在 YM 中打开）
│                                      │
│  ─── 20 items ───                    │
│                                      │
├──────────────────────────────────────┤
│  Preview:                            │
│  ┌────────────────────────────────┐  │
│  │ Transformer 论文               │  │
│  │                                │  │
│  │ Attention mechanisms have      │  │
│  │ become an integral part of...  │  │
│  │                                │  │
│  │ [Pull to Vault] [Open in YM]  │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

#### 数据模型

```typescript
// Material 列表项（来自 listMaterials API）
interface MaterialListItem {
  boardItemId: string;           // Board Item ID
  entityType: 'snip' | 'thought' | 'board_group';
  entity: {
    id: string;                  // Material 实体 ID
    type: MaterialType;          // article | note | image | voice | video | pdf | office | text-file
    title: string;
    content?: string;            // Note 类型有内容
    url?: string;                // 网页/媒体类型有 URL
    updatedAt: string;
    visibility: 'private' | 'public';
  };
  parentBoardGroupId?: string;   // 所属 Group
  rank: string;                  // 排序
}

type MaterialType = 'article' | 'note' | 'image' | 'voice' | 'video'
  | 'pdf' | 'office' | 'text-file' | 'other-webpage' | 'unknown-webpage' | 'snippet';

// Craft 列表项（来自 listCrafts API）
interface CraftListItem {
  id: string;
  type: CraftType;               // page | slides | webpage | audio-pod | canvas | craft-group
  title: string;
  boardId: string;
  groupId?: string;              // 所属 CraftGroup
  updatedAt: string;
}

type CraftType = 'page' | 'slides' | 'webpage' | 'audio-pod' | 'canvas';
```

#### 树形结构构建

Materials 和 Crafts 都支持一层分组（MaterialGroup / CraftGroup）。构建树的逻辑：

```typescript
interface TreeNode {
  id: string;
  type: 'group' | 'material' | 'craft';
  title: string;
  icon: string;                  // Lucide 图标名
  children?: TreeNode[];         // 仅 group 有
  entityType?: string;           // material 的子类型
  isLinked: boolean;             // 是否已有本地关联文件
  localPath?: string;            // 本地文件路径（如果已关联）
}

function buildMaterialTree(items: MaterialListItem[], linkedFiles: Map<string, tfile="">): TreeNode[] {
  // 1. 分离 groups 和 items
  // 2. items 按 parentBoardGroupId 分组
  // 3. 未分组的 items 放在根级
  // 4. 对每个 item 检查 linkedFiles 中是否有对应的 youmind_id
  // 5. 返回树形结构
}
</string,>
```

#### 图标映射

| Material Type | 图标 | 可拉取 |
| --- | --- | --- |
| article | `globe` | ✅ 转为 Markdown |
| note | `sticky-note` | ✅ 直接 Markdown |
| image | `image` | ✅ 保存图片 + Markdown 引用 |
| voice | `headphones` | ⚠️ 拉取转录文本 |
| video | `video` | ⚠️ 拉取转录文本 |
| pdf | `file-text` | ⚠️ 拉取概要/标注 |
| office | `file-spreadsheet` | ❌ 仅链接 |
| text-file | `file-code` | ✅ 直接文本 |

| Craft Type | 图标 | 可拉取 |
| --- | --- | --- |
| page | `file-edit` | ✅ 转为 Markdown |
| slides | `presentation` | ❌ 仅链接（包含生成的图片/视频） |
| webpage | `layout` | ❌ 仅链接 |
| audio-pod | `podcast` | ❌ 仅链接 |
| canvas | `frame` | ❌ 仅链接 |

#### 操作按钮

每个列表项根据类型显示不同的操作：

- **Pull to Vault**（↓）：拉取内容到本地 Vault（仅可拉取类型显示）

- **Open in YouMind**（🔗）：在浏览器中打开 YouMind 网页端

- **Preview**：点击列表项在下方预览区显示摘要

#### 与 Board 选择器的联动

Browser View 和 Chat View 共享同一个 `BoardContext`。切换 Board 时，Browser 自动刷新内容列表。

#### 缓存策略

- 首次打开 Browser 时调用 `listMaterials` + `listCrafts` 获取完整列表

- 结果缓存 5 分钟，手动刷新按钮可强制重新加载

- `getMaterial` / `getCraft` 的详情在 Preview 时按需加载，缓存 10 分钟

#### 测试计划

- 打开 Browser View，确认显示当前 Board 的所有 Materials 和 Crafts

- 切换 Board，确认列表自动刷新

- 展开 MaterialGroup，确认子项正确显示

- 已拉取的项目显示 ✅ 标记

- 点击 “Open in YouMind” 确认在浏览器中打开正确的 URL

---

### Phase 1.3.3 — Pull to Vault（拉取到本地）

**目标**：把 YouMind 云端的 Material 或 Craft 内容拉取到本地 Vault，建立 frontmatter 关联。

#### Content Converter 模块

```typescript
// core/bridge/content-converter.ts

class ContentConverter {
  /**
   * 将 YouMind Material 转换为本地 Markdown
   */
  materialToMarkdown(material: MaterialDto): ConvertedContent {
    switch (material.type) {
      case 'note':
        // Note 的 content 就是纯文本/Markdown，直接使用
        return {
          markdown: material.content,
          frontmatter: {
            youmind_id: material.id,
            youmind_board: material.boardId,
            youmind_type: 'note',
            youmind_synced_at: new Date().toISOString(),
            youmind_source: 'pull',
          },
        };

      case 'article':
        // 网页文章：提取正文内容
        // getMaterial 返回的 content 是文章正文
        // 额外添加来源 URL 作为元信息
        return {
          markdown: this.formatArticle(material),
          frontmatter: { ... },
        };

      case 'image':
        // 图片：创建 Markdown 图片引用
        // ![title](imageUrl)
        return {
          markdown: `![${material.title}](${material.url})

${material.content ?? ''}`,
          frontmatter: { ... },
        };

      case 'voice':
      case 'video':
        // 音视频：拉取转录文本（需要 includeBlocks=true）
        // 如果有 overview block，也一并拉取
        return {
          markdown: this.formatTranscript(material),
          frontmatter: { ... },
        };

      case 'pdf':
        // PDF：拉取概要和标注
        return {
          markdown: this.formatPdfSummary(material),
          frontmatter: { ... },
        };

      default:
        // 其他类型：创建链接文件
        return {
          markdown: `# ${material.title}

> This material is available in YouMind: [Open](https://youmind.com/materials/${material.id})
`,
          frontmatter: { ... },
        };
    }
  }

  /**
   * 将 YouMind Craft (Page) 转换为本地 Markdown
   */
  craftToMarkdown(craft: CraftDto): ConvertedContent {
    // getCraft 返回的 content 是 plain text
    // Page 类型的 content 本身就是 Markdown 格式
    return {
      markdown: craft.content,
      frontmatter: {
        youmind_id: craft.id,
        youmind_board: craft.boardId,
        youmind_type: 'page',
        youmind_synced_at: new Date().toISOString(),
        youmind_source: 'pull',
      },
    };
  }

  /**
   * 将本地 Markdown 转换为 YouMind Note 内容
   * 剥离 frontmatter，转换 Obsidian 内部链接
   */
  markdownToNote(content: string): string {
    // 1. 剥离 frontmatter（--- ... ---）
    // 2. 将 Obsidian 内部链接 [[note]] 转换为标准链接
    // 3. 返回纯文本内容
    return stripped;
  }
}

interface ConvertedContent {
  markdown: string;
  frontmatter: YouMindFrontmatter;
}
```

#### Pull 流程

```plaintext
用户在 Browser 中点击 "Pull to Vault"
    │
    ├── 1. 检查是否已有本地关联文件
    │       FrontmatterManager.findLocalFile(youmindId)
    │       → 如果有：提示 "已存在，是否覆盖更新？"
    │
    ├── 2. 获取完整内容
    │       getMaterial(id, includeBlocks=true)  或  getCraft(id)
    │
    ├── 3. 转换为 Markdown
    │       ContentConverter.materialToMarkdown(material)
    │       → { markdown, frontmatter }
    │
    ├── 4. 确定本地路径
    │       youmind/{boardName}/materials/{title}.md
    │       或 youmind/{boardName}/crafts/{title}.md
    │
    ├── 5. 写入文件
    │       vault.create(path, frontmatter + markdown)
    │       或 vault.modify(existingFile, updated content)  // 覆盖更新
    │
    └── 6. 更新 Browser 中的状态
            该项目显示 ✅ 标记
            Notice: "Pulled to youmind/AI Research/materials/论文标题.md"
```

#### 批量拉取

支持选中多个项目或整个 Group 批量拉取：

- 在 Group 节点上显示 “Pull All” 按钮

- 批量拉取时显示进度条

- 已存在的文件默认跳过，可选择“全部覆盖”

#### 测试计划

- 拉取一个 Note 类型的 Material，确认内容和 frontmatter 正确

- 拉取一个 Article 类型的 Material，确认正文提取正确

- 拉取一个 Page 类型的 Craft，确认 Markdown 内容正确

- 拉取一个 Video 类型的 Material（有转录），确认转录文本被提取

- 重复拉取同一个 Material，确认提示“已存在”并可选择覆盖

- 拉取后在 YouMind 网页端修改内容，再次拉取确认更新

---

### Phase 1.3.4 — Push to YouMind（推送到云端）

**目标**：把本地 Vault 中的 Markdown 笔记推送到 YouMind Board 成为 Note.

#### Push 入口

三个入口：

1. **命令面板**：`YouMind: Push current note to Board` — 推送当前打开的笔记

2. **右键菜单**：在文件浏览器中右键 → “Push to YouMind”

3. **Chat 操作栏**：现有的 “Save as note” 按钮升级（1.3.1 已覆盖）

#### Push 流程

```plaintext
用户触发 Push
    │
    ├── 1. 读取文件内容和 frontmatter
    │       FrontmatterManager.read(file)
    │
    ├── 2. 检查是否已有云端关联
    │       → 如果有 youmind_id：走更新流程（updateNote）
    │       → 如果没有：走创建流程（createNote）
    │
    ├── 3a. 创建流程
    │       ContentConverter.markdownToNote(content)  // 剥离 frontmatter
    │       POST createNote({
    │         boardId: currentBoardId,
    │         title: file.basename,
    │         content: strippedContent,
    │         genTitle: false
    │       })
    │       → 返回 { id: "note-uuid" }
    │       → FrontmatterManager.write(file, { youmind_id, youmind_board, ... })
    │
    ├── 3b. 更新流程
    │       ContentConverter.markdownToNote(content)
    │       POST updateNote({
    │         id: existingYoumindId,
    │         content: strippedContent,
    │         title: file.basename
    │       })
    │       → FrontmatterManager.write(file, { ...existing, youmind_synced_at: now })
    │
    └── 4. 反馈
            Notice: "Pushed to YouMind Board: AI Research"
            Browser View 刷新列表
```

#### Board 选择

Push 时默认使用当前选中的 Board。如果用户想推送到其他 Board，提供一个简单的 Board 选择弹窗（复用现有的 BoardSelector 逻辑，但以 Modal 形式呈现）。

#### 内容转换注意事项

Obsidian Markdown 到 YouMind Note 的转换需要处理：

| Obsidian 特有语法 | 处理方式 |
| --- | --- |
| `[[internal link]]` | 转为 `internal link`（去掉双括号） |
| `[[link\|display]]` | 转为 `display` |
| `![[embedded note]]` | 转为 `> Embedded: embedded note` |
| `%%comment%%` | 移除 |
| Frontmatter `---...---` | 剥离（不推送到云端） |
| Callouts `> [! note]` | 保留（YouMind 支持标准 blockquote） |
| Tags `#tag` | 保留 |

#### 测试计划

- 推送一个新笔记到 Board，确认在 YouMind 网页端可见

- 确认推送后本地文件 frontmatter 被更新

- 修改本地笔记后再次推送，确认云端内容更新（而非创建新 Note）

- 推送包含 Obsidian 内部链接的笔记，确认链接被正确转换

- 推送到非当前 Board，确认 Board 选择弹窗工作正常

---

### Phase 1.3.5 — 语义搜索集成

**目标**：在聊天输入框中支持搜索 Board 内容，为后续的 @ 引用系统打基础。

#### 搜索入口

在 Chat View 的输入框上方添加一个搜索按钮（🔍），点击后弹出搜索面板：

```plaintext
┌────────────────────────────────────┐
│ 🔍 Search in AI Research...        │
├────────────────────────────────────┤
│                                    │
│ 📄 Transformer 论文          0.92  │  ← 相关度分数
│    "Attention mechanisms have..."  │  ← 匹配片段
│                                    │
│ 📝 AI 综述 v2                0.87  │
│    "Recent advances in large..."   │
│                                    │
│ 📄 Meeting Notes             0.71  │
│    "Discussed the new model..."    │
│                                    │
│ [Insert reference] [Preview]       │
└────────────────────────────────────┘
```

#### API 调用

```typescript
const results = await this.plugin.api.search({
  scope: 'board',
  query: userQuery,
  boardId: currentBoardId,
  topK: 10,
});
```

#### 搜索结果操作

- **Insert reference**：在输入框中插入 `@【标题】(id: xxx; type: material)` 格式的引用，Agent 会在上下文中看到这个引用

- **Preview**：在搜索面板中展开显示匹配的文本片段

- **Pull to Vault**：如果该内容尚未拉取到本地，提供快速拉取按钮

这个搜索面板是 Phase 1.5 完整 @ 引用系统的前置基础。

#### 测试计划

- 在搜索框输入关键词，确认返回相关的 Materials 和 Crafts

- 点击 “Insert reference”，确认引用格式正确插入到输入框

- 发送包含引用的消息，确认 Agent 能理解引用的内容

- 搜索无结果时显示友好提示

---

## 设置项新增

在 Settings Tab 中新增以下配置：

```typescript
interface YouMindSettings {
  // ... 现有设置 ...

  // Phase 1.3 新增
  syncRootFolder: string;          // 同步根目录名称，默认 "youmind"
  pullConflictStrategy: 'skip' | 'overwrite' | 'ask';  // 拉取冲突策略
  pushOnSave: boolean;             // 保存时自动推送（默认 false，Phase 1.3 不实现自动推送）
  browserViewPosition: 'left' | 'right';  // Browser View 位置
}
```

---

## 文件结构变更

Phase 1.3 完成后，项目结构应该演进为：

```plaintext
src/
├── main.ts                        # 插件入口（更新：注册 Browser View）
├── api.ts                         # API Client（更新：新增 Material/Craft/Note/Search 方法）
│
├── views/
│   ├── chat-view.ts               # Chat View（从 main.ts 拆出）
│   └── browser-view.ts            # 新增：Board Content Browser View
│
├── components/
│   ├── board-selector.ts          # Board 选择器（从 main.ts 拆出）
│   ├── history-panel.ts           # History Panel（从 main.ts 拆出）
│   ├── material-tree.ts           # 新增：Material 树形组件
│   ├── craft-tree.ts              # 新增：Craft 树形组件
│   ├── preview-panel.ts           # 新增：内容预览组件
│   ├── search-panel.ts            # 新增：搜索面板组件
│   └── board-picker-modal.ts      # 新增：Board 选择弹窗
│
├── services/
│   ├── frontmatter-manager.ts     # 新增：Frontmatter 关联管理
│   ├── content-converter.ts       # 新增：内容双向转换
│   ├── pull-service.ts            # 新增：拉取服务
│   └── push-service.ts            # 新增：推送服务
│
├── styles/
│   ├── chat.css                   # Chat 样式（从 styles.css 拆出）
│   └── browser.css                # 新增：Browser 样式
│
└── types.ts                       # 类型定义
```

**注意**：当前所有代码都在 `main.ts`（1551 行）和 `api.ts` 两个文件中。Phase 1.3 的代码量会显著增加，建议在开始 1.3 之前先做一次代码拆分重构，把 Chat View、Board Selector、History Panel 等组件从 `main.ts` 中拆出为独立文件。这不是功能变更，纯粹是代码组织优化，可以作为 Phase 1.3.0 的前置任务。

---

## 实施顺序与依赖关系

```plaintext
Phase 1.3.0  代码拆分重构（前置）
    │         把 main.ts 拆分为独立模块
    │         不改变任何功能行为
    ▼
Phase 1.3.1  Frontmatter 关联 + "保存为新笔记"升级
    │         建立关联体系基础
    │         "Save as note" 同时创建云端 Note
    ▼
Phase 1.3.2  Board Content Browser
    │         新增侧边栏 ItemView
    │         展示 Materials + Crafts 树
    │         依赖 1.3.1 的 FrontmatterManager（检测已拉取状态）
    ▼
Phase 1.3.3  Pull to Vault
    │         从 Browser 拉取内容到本地
    │         依赖 1.3.1 的 Frontmatter + 1.3.2 的 Browser UI
    ▼
Phase 1.3.4  Push to YouMind
    │         从本地推送笔记到 Board
    │         依赖 1.3.1 的 Frontmatter
    ▼
Phase 1.3.5  语义搜索集成
             在 Chat 中搜索 Board 内容
             依赖 1.3.2 的数据层（Material/Craft 类型定义）
```

---

## API 能力总结

| 操作 | API | 关键参数 | 返回 |
| --- | --- | --- | --- |
| 列出 Board 资料 | `listMaterials` | boardId, groupId? | BoardItem[] （含 entity 详情） |
| 获取资料详情 | `getMaterial` | id, includeBlocks? | MaterialDto （多态） |
| 列出 Board 作品 | `listCrafts` | boardId, groupId? | CraftDto[] （多态） |
| 获取作品详情 | `getCraft` | id, withChildren? | CraftDto （多态） |
| 创建笔记 | `createNote` | content, title?, boardId?, genTitle? | NoteDto |
| 更新笔记 | `updateNote` | id, title?, content? | NoteDto |
| 语义搜索 | `search` | scope, query, boardId?, topK? | SearchResult[] |
| 通过 URL 创建资料 | `createMaterialByUrl` | url, boardId?, title? | MaterialDto |
| 删除资料 | `trashMaterial` | id | void |
| 创建资料分组 | `createMaterialGroup` | boardId, name | GroupDto |
| 创建作品分组 | `createCraftGroup` | boardId, title | GroupDto |
| 移动资料 | `moveMaterials` | materialIds, boardId?, groupId? | void |
| 移动作品 | `moveCrafts` | craftIds, boardId?, groupId? | void |

---

## 风险与注意事项

1. **Note 的 content 是纯文本**：`createNote` 和 `updateNote` 的 content 字段是 plain text。YouMind 内部会对 Note 内容做自己的处理（比如 AI 标题生成）。推送 Markdown 时直接传原文即可，不需要额外转换格式。

2. **Material 类型多态**：`getMaterial` 返回的是一个 discriminated union（通过 `$class` 或 `type` 字段区分）。不同类型的 Material 有不同的字段结构，Content Converter 需要为每种类型写专门的转换逻辑。

3. **Craft 类型限制**：只有 `page` 类型的 Craft 有可提取的 Markdown 内容。`slides`、`webpage`、`audio-pod`、`canvas` 类型的内容结构复杂，Phase 1.3 只提供“在 YouMind 中打开”的链接，不尝试拉取。

4. **大量 Materials 的性能**：一个 Board 可能有几百个 Materials。`listMaterials` 返回全部项目（含 entity 详情），首次加载可能较慢。需要做好 loading 状态和缓存。

5. **Frontmatter 污染**：在用户的笔记中写入 `youmind_*` 字段可能被视为“污染”。设置中应提供选项让用户选择是否写入 frontmatter，或者使用 Obsidian 的 `.obsidian/plugins/youmind/` 目录存储关联映射（但这样就无法跨设备同步关联信息）。

6. **并发冲突**：用户可能同时在 YouMind 网页端和 Obsidian 中编辑同一个 Note。Phase 1.3 不实现实时同步，采用“最后写入胜出”策略，但在 Pull/Push 时检测时间戳差异并提示用户。