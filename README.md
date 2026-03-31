# YouMindian

**YouMindian 是一个让 YouMind 云端 AI Agent 能够操控本地 Obsidian Vault 的桥梁插件。**  
它把一个原本只能在浏览器里用的 Web AI，变成了一个能读写本地知识库、组织笔记工作流、同时保留 YouMind 云端能力的 Obsidian 插件。

## 一句话定义

**YouMindian = YouMind 的云端大脑 + Obsidian 的本地文件系统 + 插件桥梁层。**

它不是一个普通聊天面板，而是一个双向桥接系统：

- 云端 AI 可以理解并利用 YouMind 的 Board、素材、Craft、语义搜索、多模型和工具链
- 本地插件可以把 AI 的意图安全地落地到 Obsidian Vault
- 用户既能把本地内容推送到 YouMind，也能把云端内容拉回 Obsidian

## 为什么需要这个插件

### YouMind 的本质

YouMind 是一个**云端 AI 创作工作室**，它擅长：

- Board 知识组织
- 多媒体素材标注与 AI 理解
- Claude / GPT-5 / Gemini / DeepSeek 多模型切换
- Agent 模式下的搜索、生图、Research、Skill 工作流
- Craft 创作与云端协作

它的局限也很明显：**它是 Web 应用，无法直接操作用户本地文件。**

### Obsidian 的本质

Obsidian 是一个**本地优先的私人知识库**，它擅长：

- 本地 Markdown 笔记
- 离线可用
- 高自由度插件生态
- 数据长期可迁移、用户完全掌控

它的局限是：**它没有原生的云端 AI 工作室能力。**

### 我们要解决的问题

这个插件要把两者接起来：

- 让 YouMind 的云端 Agent 能安全地影响本地 Vault
- 让 Obsidian 的本地内容进入 YouMind 的 Board / Document / Note 体系
- 让用户在一个侧边栏里同时得到本地与云端的能力

## 核心架构

### 总体思路

我们采用的是 **Bridge Layer（桥梁层）** 架构：

1. YouMind Agent 在云端思考、规划、调用云端工具
2. 插件通过 OpenAPI 与云端交互
3. 插件在本地解释 AI 的输出与意图
4. 本地 Vault 操作由插件安全执行，而不是让云端 AI 直接拥有文件系统权限

### 架构全景

```text
YouMind Cloud (API)              Plugin (Bridge)                Obsidian Vault (Local)
┌─────────────────┐     ┌──────────────────────────┐     ┌──────────────────┐
│ Chat / Agent    │◄───►│ YouMind API Client        │     │ Markdown files   │
│ Boards          │     │ Action Interpreter        │◄───►│ Frontmatter      │
│ Materials/Crafts│     │ Content Converter         │     │ Folders          │
│ Search          │     │ Security Layer            │     │                  │
│ Tools / Skills  │     └──────────────────────────┘     └──────────────────┘
└─────────────────┘
```

### Bridge Layer 为什么重要

这层是插件的心脏。

与本地 CLI Agent 方案不同，这个项目不直接在用户电脑上 spawn 一个云端模型的本地代理，而是：

- 用 YouMind OpenAPI 调用云端 Agent
- 让插件负责“解释”和“执行”
- 让所有本地写入都经过插件控制

好处是：

- 更安全：AI 不直接拥有本地文件系统权限
- 更灵活：不绑定单一模型
- 更强：可以同时使用云端工具链和本地 Vault 操作
- 更易审计：插件可以记录、确认、限制本地操作

## 与 Claudian 的区别

| 维度 | Claudian | youmindian |
| --- | --- | --- |
| AI 运行位置 | 本地 CLI / Agent SDK | 云端 YouMind API |
| 本地文件操作 | Agent 直接执行 | 插件桥梁层执行 |
| 知识边界 | 本地 Vault | Vault + YouMind Boards / Materials / Crafts |
| 模型选择 | Claude 为主 | Claude / GPT-5 / Gemini / DeepSeek |
| 云端工具 | 有限 | 搜索 / 生图 / 生视频 / Research / Skills |
| 依赖 | 需要本地 CLI | 只需 API Key |

一句话概括：

**Claudian 是“把 AI 请到你家里来干活”，youmindian 是“用家里的遥控器调度整个云端 AI 工厂”。**

## 当前实现状态

### 已实现

- 右侧栏 YouMind Chat 面板
- YouMind OpenAPI 客户端
- `x-api-key` 主鉴权 + `Authorization: Bearer` 兼容
- Chat / Agent 模式切换
- 多模型选择器
- Markdown 渲染
- API Key 设置页与验证按钮
- Board 上下文管理
- Board Selector（输入区上方 context bar）
- Chat History Panel（左侧滑入）
- `listChats` / `getChat` / `listMessages` 对话恢复
- 本地隐藏历史会话（`hiddenChatIds`）
- 消息保存菜单拆分：`Save to Vault` / `Save as YouMind Note`
- `createNote` / `updateNote` 推送链路
- `listMaterials` / `listCrafts` API 基础接入
- 当前笔记 Push 入口（命令面板 / 文件管理器 / 编辑器状态按钮）
- frontmatter 关联与同步状态判断（`unlinked` / `synced` / `modified`）
- 保存成功确认浮层（支持查看目标 Board、切换 Board、打开 YouMind）
- Board Content Browser（Materials / Crafts 树）
- Preview Panel 类型化预览（Markdown / 图片 / 媒体 / Fallback）
- Pull to Vault（Material / Craft 拉取为本地 Markdown）
- Pull 完成确认浮层（支持查看路径、移动到其他文件夹）
- 图片 Material 本地下载与正文内联图片本地化
- Slides / Webpage / AudioPod / Canvas Craft 导出
- 从 Pull 回来的 Note 再 Push 时的覆盖 / 新建选择弹窗
- 提交前敏感信息检查脚本

### 已验证的重要 API 结论

- 外部 OpenAPI 认证以 `x-api-key` 为主
- `Authorization: Bearer` 单独使用时曾返回 `401`
- assistant 回复正文需要优先从 `blocks[].data` 提取
- chat 类请求对外统一使用 `snake_case` 字段更稳妥

## 5 分钟快速上手

### 1. 安装与编译

```bash
npm install
npm run dev
```

### 2. 在 Obsidian 中启用插件

将插件目录放到：

```text
<Vault>/.obsidian/plugins/youmindian/
```

然后在 Obsidian 中：

- 打开 **Settings → Community plugins**
- 启用 **youmindian**
- 使用 **Cmd+P → Reload app without saving** 重新加载

### 3. 配置 API Key

打开：

- **Settings → youmindian**

填入你的 YouMind API Key，然后点击 **Validate API key**。  
可在 [https://youmind.com/settings/api-keys](https://youmind.com/settings/api-keys) 获取或管理 API Key。

### 4. 打开聊天面板

- 点击左侧 ribbon 图标
- 或使用命令 **Open youmindian**

### 5. 体验当前核心功能

你现在应该能直接体验：

- 发送真实 YouMind Chat / Agent 消息
- 切换模型
- 切换 Board 上下文
- 打开历史对话面板并恢复旧会话
- 浏览当前 Board 下的 Materials / Crafts，并按类型预览内容
- 将 Material / Craft Pull 到本地 Vault，自动建立 frontmatter 关联
- 将消息保存到本地 Vault 或双写为 YouMind Note
- 将当前笔记推送到 YouMind，并查看同步状态
- 在 Pull 图片、Article、PDF 时尽量将图片落到本地附件目录
- 将 Slides / Webpage / AudioPod / Canvas Craft 也导出到本地
- 对从 YouMind Pull 回来的 Note，Push 时可选择覆盖原条目或新建条目

## 界面导览

当前侧边栏主要由四个区域组成：

### Header

- 左侧品牌图标
- 中间当前对话标题
- 右侧新建对话按钮
- 右侧历史按钮

### Messages

- 用户消息右对齐
- AI 消息左对齐并支持 Markdown 渲染
- 系统消息用于提示 Board 切换、错误和加载结果

### Context Bar

- 位于消息区和输入区之间
- 显示当前 Board
- 支持搜索、切换、刷新 Board

### Input Area

- 模型选择器
- Ask / Agent 模式切换
- 多行输入框
- 发送按钮

### History Panel（Phase 1.2）

- 从左侧滑入
- 按当前 Board 查看对话历史
- 支持搜索
- 支持分页加载
- 支持恢复历史对话
- 支持本地隐藏会话

## 迄今为止的更新历史

### Phase 0：最小侧边栏

- 清理官方 sample plugin 结构
- 用 `main.ts` 建立最小可见的 Obsidian 右侧栏面板
- 完成基础设置页与插件入口

### Phase 1：真实聊天能力

- 新增 `api.ts`
- 接入 `createChat` / `sendMessage`
- 支持真实 API 调用而不是本地 echo
- 处理 loading、错误提示、Markdown 渲染、复制回复

### Phase 1.1：Board Selector 接入 Chat View

- 新增 Board API 和 Board 类型
- 实现 `BoardContext`
- 在输入区上方增加 Board context bar
- 支持 Board 搜索、刷新、持久化恢复
- 切换 Board 时立即重置当前对话环境

### Phase 1.2：History Panel 接入 Chat View

- 将旧的顶部覆盖式历史层升级为左侧滑入式 History Panel
- 支持按当前 Board 拉取历史对话
- 支持本地搜索、分页加载、恢复历史消息
- 支持 unread 标记、active 状态、answering / thinking 状态指示
- 支持本地隐藏会话，不删除云端记录
- 保持与 Board 切换行为一致：切换 Board 后当前对话立即 reset

### Phase 1.3：内容双向流动基础能力

- 消息保存动作拆分为 `Save to Vault` 和 `Save as YouMind Note`
- 打通 `createNote` / `updateNote`，支持消息双写和当前笔记 Push
- 增加 `youmind_source` 与 frontmatter 关联字段，建立本地文件和云端实体追踪基础
- 实现 `getSyncStatus(file)`，区分 `unlinked` / `synced` / `modified`
- 提供 3 个 Push 入口：命令面板、文件管理器右键、编辑器状态按钮
- 新增保存确认浮层，支持查看目标 Board、切换 Board、跳转 YouMind
- 补齐 `listMaterials` / `listCrafts` API，为后续 Browser / Pull 能力铺路

### Phase 1.3.2：Board Content Browser

- 新增 Browser View，按当前 Board 展示 Materials / Crafts 树
- 支持分组展开、图标映射、基础搜索与刷新
- 增加 Preview Panel，为后续 Pull 与类型化预览打基础

### Phase 1.3.3：Pull to Vault

- 修复 Browser View 分组标题、Preview Panel 截断与不可拖拽等问题
- Preview Panel 按类型分发渲染：文本走 Markdown，图片直接预览，媒体显示摘要与转录
- 打通 `getMaterial` / `getCraft` 到本地 Markdown 的转换链路
- 新增 Pull to Vault，支持将 Material / Craft 拉取到 Vault 并写入 frontmatter 关联
- 新增 Pull Confirm Panel，拉取后可查看目标路径并移动到 Vault 内其他文件夹

### Phase 1.3.4：图片本地下载增强

- Pull 图片类 Material 时，优先下载到 Vault 本地附件目录并改写为相对路径引用
- 处理 Article / PDF 正文中的远程内联图片，尽量同步为本地附件
- 下载失败时静默回退到远程 URL，不中断整体 Pull 流程

### Phase 1.3.5：Craft Pull 扩展

- 将 Craft Pull 从 `page` 扩展到 `slides`、`webpage`、`audio-pod`、`canvas`
- Slides 导出支持解析场景结构、抽取 `KEY CONTENT`，并尽量下载缩略图到本地附件目录
- Webpage 导出支持保留截图、HTML 源码链接和可提取文本内容
- AudioPod / Canvas 采用防御性文本提取策略，未知结构时静默回退到链接模板
- Browser View 同步开放以上 Craft 类型的 Pull 按钮与基础预览

### Phase 1.3.6：Pull Note 再 Push 保护

- 当本地文件来自 YouMind Pull 的 Note 时，Push 前弹出选择：覆盖原云端 Note 或新建一条新的 YouMind Note
- 新增 Push 取消分支，用户取消后不再弹出失败提示
- 对原本由 Push 创建的 Note，继续优先走更新链路
- 覆盖更新失败时自动回退为新建 Note，尽量保证 Push 成功

## 当前文件结构

当前仓库仍然是 **flat 结构**，不是最终目标架构。仓库目录当前也仍是 `youmindian/`：

```text
youmindian/
├── main.ts
├── api.ts
├── styles.css
├── manifest.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── AGENTS.md
├── CLAUDE.md
└── README.md
```

## 目标架构（Roadmap）

后续会逐步重构为：

```text
src/
├── main.ts
├── core/
│   ├── api/
│   ├── vault/
│   ├── bridge/
│   ├── security/
│   └── storage/
├── features/
│   ├── chat/
│   ├── board/
│   ├── browser/
│   ├── push/
│   ├── mention/
│   └── inline-edit/
├── shared/
├── style/
└── utils/
```

这是目标设计，不是当前现实代码结构。

## 开发约定

### 技术栈

- TypeScript
- Obsidian Plugin API
- `requestUrl`
- `setIcon`
- `MarkdownRenderer`
- esbuild
- Obsidian CSS variables only

### UI 规则

- 不使用 emoji
- 不硬编码颜色
- 图标统一使用 Obsidian 内置 Lucide
- 按钮优先使用 `clickable-icon`
- 必须兼容亮色 / 暗色主题

### API 规则

- Base URL: `https://youmind.com/openapi/v1`
- 认证头：

```ts
headers: {
  'x-api-key': apiKey,
  'Authorization': `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
}
```

- 外部 payload 优先使用：
  - `board_id`
  - `chat_id`
  - `chat_model`
  - `message_mode`

## 本地开发

安装依赖：

```bash
npm install
```

开发编译：

```bash
npm run dev
```

生产构建：

```bash
npm run build
```

敏感信息检查：

```bash
npm run check:secrets
```

## 提交前检查

提交或同步到 GitHub 前，建议固定执行：

```bash
git status --short
npm run check:secrets
npm run build
```

并且遵守这些规则：

1. 优先按文件精确 `git add`，不要默认使用 `git add -A`
2. 不提交 `data.json`
3. 不提交 `.specstory/`
4. 不提交 `.env*`、`*.local`、密钥文件
5. 如果真实 token / API key 曾进入 tracked file，即使后来删除，也应该轮换

## 近期路线图

### Phase 1.4

- `@` 引用系统
- YouMind / Vault 双源引用
- frontmatter 关联的继续完善
- 本地文件与云端实体的移动 / 更新同步细节

### Phase 1.5
- Semantic Search
- Smart Context

### Phase 2+

- Action Interpreter
- Vault write / insert / create note 等本地执行能力
- 安全权限模式（Safe / Auto / YOLO）
- Tool cards 可视化
- Inline Edit + diff preview

## 长期愿景

最终目标不是“在 Obsidian 里接一个聊天窗口”，而是：

**让用户在任何设备上使用 YouMind 的云端 AI，同时把结果可靠、安全地落到本地 Obsidian Vault。**

当桥梁层、权限系统、双向同步和远程指令能力成熟后，youmindian 会成为：

- 云端 AI 的本地执行器
- 本地知识库的云端增强层
- YouMind 与 Obsidian 之间真正的双向工作流桥梁
