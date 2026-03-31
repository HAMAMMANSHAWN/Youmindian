# youmindian项目梳理：完成与待办 


根据你提供的两份文档，我来梳理一下项目的完成状态和待做事项。

---

## 已完成的阶段

**Phase 1.1 — Board Selector** ✅\
**Phase 1.2 — Chat History** ✅

**Phase 1.3 系列（Bridge 双向桥接）** — 大部分已完成：

- ✅ Browser View（材料/Craft 树形浏览、类型智能预览、可拖拽 resizer）

- ✅ Pull to Vault 核心逻辑（content-converter + pull-service + pull-confirm-panel）

- ✅ ImageDownloader（图片本地下载、去重、扩展名识别）

- ✅ Material Pull 图片本地下载（Image / Article / PDF 内联图片）

- ✅ Pick 摘录（消息级 + 选区级）

- ✅ Save 动作拆分（Save to Vault / Save as YouMind Note）

- ✅ Push 三层入口（命令面板 / 右键菜单 / 编辑器按钮）

- ✅ Frontmatter Manager + getSyncStatus 三态判断

- ✅ Save Confirm Panel

- ✅ **Phase 1.3.5** — Slides / Webpage / AudioPod / Canvas 导出

---

## 尚未完成的内容

### Phase 1 剩余项

| 编号 | 功能 | 说明 | 状态 |
| --- | --- | --- | --- |
| **1.3a** | **Material Browser** 完善 | Browser View 已实现基础功能，但 Roadmap 中提到的完整 tree view（含 groups 层级展开）、preview panel 的深度打磨可能还有收尾工作 | 🔶 大部分完成，需确认是否有遗留 |
| **1.3b** | **Push to YouMind 增量更新** | Push 三层入口已完成，但 Roadmap 中提到的 `updateDocument`（基于 frontmatter 中 `youmind_id` 做增量更新而非每次新建）是否已实现？以及 `createMaterialByUrl`（保存 URL 为素材）功能 | 🔶 需确认增量更新逻辑 |
| **1.5** | **@ References 双源引用** | 统一搜索面板（YouMind + Vault 双源），输入框中 `@` 触发自动补全，引用 YouMind 素材/Craft 或 Vault 本地文件作为聊天上下文 | ❌ 未开始 |

### Phase 2 — Agent 驱动的 Vault 操作（杀手级功能）

这是整个插件区别于普通 AI 聊天插件的核心差异化能力，**完全未开始**：

| 编号 | 功能 | 说明 |
| --- | --- | --- |
| **2.1** | **Agent → Vault 操作** | AI 输出直接保存到 Vault、插入光标位置、批量创建笔记、Plan Mode（复杂操作先展示计划再执行）。这需要实现 `action-interpreter.ts`（将 Agent 的 tool_calls 翻译为本地操作）和完整的 Security Layer（Safe/Auto/YOLO 三级权限） |
| **2.2** | **Tool 可视化** | 可折叠的 Tool Cards（搜索、图片生成、文件操作等），带进度指示器。目前消息渲染可能只展示纯文本，tool_calls 的结构化展示尚未实现 |
| **2.3** | **Tool 控制面板** | 每个 tool 的开关（required/auto/none）、Skill 选择器，让用户精细控制 Agent 可以使用哪些工具 |

### Phase 3 — 聊天体验打磨

| 编号 | 功能 | 说明 |
| --- | --- | --- |
| **3.1** | **消息悬停工具栏** | 复制、插入到光标、保存到 YouMind/Vault、重新生成、停止生成 |
| **3.2** | **输入增强** | 输入历史、拖拽/粘贴图片、斜杠命令（`/push`、`/pull`、`/search`） |

### Phase 4 — 语义搜索与智能上下文

| 编号 | 功能 | 说明 |
| --- | --- | --- |
| **4.1** | **全局语义搜索 Modal** | 跨整个 Library 或 Board 范围的语义搜索，类似 Obsidian 的 Quick Switcher 但搜索 YouMind 云端内容 |
| **4.2** | **智能上下文** | 自动附加当前笔记为聊天上下文、选中文本发送到 Chat、右键菜单集成、Inline Edit + diff 预览（Claudian 风格的行内编辑） |

### Phase 5 — 打磨与高级功能

设置页面完善、键盘快捷键、Obsidian URI scheme 支持、响应式布局、代码块增强、远程 Vault 控制（WebSocket，长期愿景）。

---

## 建议的优先级排序

从用户价值和技术依赖关系来看，我建议接下来的推进顺序：

**第一优先级：Phase 1.5（@ References）**\
这是 Phase 2 的前置依赖——Agent 要操作 Vault，用户得先能在聊天中引用本地文件和 YouMind 内容。而且它直接提升日常聊天的实用性，让用户可以"带着上下文提问"。

**第二优先级：Phase 2.1 + 2.2（Agent → Vault 操作 + Tool 可视化）**\
这是项目的核心卖点——"远程遥控云端 AI 工厂，产品送回本地"。没有这个功能，插件本质上只是一个嵌在 Obsidian 里的 YouMind 聊天窗口。建议 2.1 和 2.2 一起做，因为 Agent 返回 tool_calls 时需要同时有执行能力和展示能力。

**第三优先级：Phase 3.1（消息悬停工具栏）**\
这是低成本高回报的体验提升，且与 2.1 的"Save to Vault"/"Insert at cursor"动作天然衔接。

**后续再做：** Phase 2.3 → 3.2 → 4.1 → 4.2 → 5

