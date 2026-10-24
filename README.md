# dsh-gen

给 [DeepSeek Harness](https://github.com/deepseek-ai) 用的「技能 / 预设」管理器，思路类似 Gemini 的 Gems。

它管理两种东西，两者**机制完全不同**：

| | 技能（Skill） | 预设（Preset） |
| --- | --- | --- |
| 是什么 | 一个**角色**：身份 + 行为准则 + 可挂载的知识文档 | 一段**提示词文本**：常用指令、格式要求、回答准则 |
| 选中后 | 给当前会话**绑定角色**，注入系统提示 | 把文本**填入输入框**，等你发送 |
| 可挂知识 | 是 | 否 |
| 典型用途 | 「代笔人（写手模式）」「严苛读者」 | 「翻译成英文」「按这个格式输出」 |

除此之外：

- 设置面板新增 **Dsh-Gen** 页，用两个标签页分别管理技能与预设。
- 每个启用的技能会注册成 DSH 的 **runtime skill**，出现在模型的技能目录里。
- 会话输入框左侧有一个**选择器**，可以在技能卡组与预设卡组之间切换。
- 知识文件是**真拷贝**，删技能时一起删除；原文件之后移动或改名都不影响已挂载的副本。

---

## 目录

- [功能](#功能)
- [安装](#安装)
- [使用](#使用)
- [工作原理](#工作原理)
- [文件结构与关联](#文件结构与关联)
- [数据存储](#数据存储)
- [开发](#开发)
- [常见问题](#常见问题)
- [许可](#许可)

---

## 功能

### 设置面板：Dsh-Gen

页面顶部是 **技能 / 预设** 两个标签（各自带数量），右侧是操作区：

| 按钮 | 作用 |
| --- | --- |
| **导入** | 从 `.json` / `.dshgen` 文件导入技能或预设 |
| **备份全部** | 把全部技能与预设（含知识文件内容）打包成一个 JSON 下载 |
| **新建** | 下拉菜单，选择新建**技能**或**预设** |

**新建下拉菜单**从按钮右下方展开，只做垂直位移，不会横向跳动。

#### 技能列表

每张卡显示头像、名称、说明、知识文件数与更新时间。卡片上有六个操作：

| 图标 | 作用 |
| --- | --- |
| 对话气泡 | 在 `dsh-gen` 工作区新建会话，并直接绑定该技能的角色 |
| 复制 | 克隆技能（知识文件一并复制） |
| 铅笔 | 打开编辑器修改 |
| 下载 | 导出这一个技能为 JSON |
| 垃圾桶 | 删除技能（连同其知识文件） |
| 眼睛 | 控制该技能是否出现在会话内选择器里 |

（图标来自 [QingIcon](https://qingicon.com)，MIT）

#### 预设列表

卡片显示预设内容的前 46 个字。操作有：新建对话、克隆、编辑、导出、删除、隐藏。

> 预设的「新建对话」只开一个**普通会话**，不绑定角色——因为预设不是角色。

#### 技能编辑器

整页两栏。左栏 `名称 / 说明 / 指令 / 知识`（外加 `停用知识引用`），右栏实时预览。
左上角返回列表，右上角保存。

- **从模板选择**：内置 5 个开箱可用的技能模板，点一下自动填好名称、说明与指令：

  | 模板 | 说明 |
  | --- | --- |
  | 代码审查规范官 | 按严重程度分级指出问题，给可执行的修改建议 |
  | 技术架构评估师 | 评估方案的扩展性、成本与风险，给出取舍建议 |
  | 技术文档撰写员 | 把零散信息整理成结构清晰、可直接交付的文档 |
  | 问题排查与根因分析专家 | 现象分析 → 假设推导 → 验证定位 → 根因治理 |
  | 数据清洗与转换顾问 | 识别脏数据，给出清洗规则与转换脚本 |

- **指令预览支持 Markdown**：标题、有序/无序列表、代码块（带复制按钮）、表格、引用块、加粗都按对话里的样子渲染。代码块和表格超宽时在预览区内滚动，不会撑破布局。
- **知识挂载**：可以在**首次保存之前**就添加文件，随保存一起落盘，不必先存一次再加。
- **查看文件内容**：点击知识行可打开文档查看器，见下。

#### 预设编辑器

只有 `名称` 与 `内容` 两个字段，右栏预览显示「预设内容」。刻意保持极简——
预设就是一段要粘进输入框的文字，不需要指令、知识这些技能专属的概念。

#### 文档查看器

点知识文件打开，带 **预览 / 源码** 切换：

- **预览**：用与「指令」预览相同的 Markdown 渲染器，标题、列表、代码块、表格、引用都能正确显示。Markdown 类文件（`.md` / `.markdown` / `.mdx` / `.txt`）默认进这个模式。
- **源码**：等宽字体的原始文本，缩进与换行保持字面意义。非 Markdown 文件默认进这个模式。
- 顶部显示文件大小，右侧有**复制全文**。
- 超过 128KB 的文件只预览前 128KB，会明确标注。
- 二进制文件不尝试解码，直接提示改用文件工具读取。

### 会话内选择器

输入框工具行上的胶囊按钮。点开后是**扇形卡组**，每页 5 张。

**底部控制条**：

```
[切换查看预设] │ ← ●● → │ 共 N  第 x/y 组
```

- 最左侧的切换按钮在**技能卡组**与**预设卡组**之间切换。按钮文案是「切换查看 X」，
  其中 X 是**点击后会切到的那一类**，不是当前正在看的那一类。
- 中间是翻页箭头与组数圆点（组数超过 6 时圆点退化为 `1/12` 文字）。
- 右侧显示总数与当前组号。

**三种选法**：

| 操作 | 技能卡 | 预设卡 |
| --- | --- | --- |
| 单击 | 绑定当前会话的角色 | 内容填入输入框 |
| 滚轮 | 逐张切换高亮，不滚动背后页面 | 同左 |
| 长按拖拽 | 按住约 0.22 秒「入手」，上拖松手即「出牌」 | 同左，松手后填入输入框 |

**长按拖拽的细节**：

- 按住后卡片放大 1.08、上浮 26px、随指针倾斜（±14°），其余卡片降到 50% 透明度。
- 松手时向上超过 42px（或水平超过 92px）判定为出牌，卡片飞向上方淡出。
- 未达阈值则回落原位，不选中。
- 单击仍然是最快路径，不受长按影响。

**其他行为**：

- 弹出层锚定在胶囊按钮**正中央**（`translateX(-50%)`），带升起动效。
- **静置 60 秒无操作自动收纳**，期间任何指针/滚轮/按键操作都会重新计时。
- 弹出层**上半部分完全透明**，卡片直接浮在对话之上；只有底部控制条是实体胶囊。
- 技能卡显示说明摘要（最多 46 字，两行截断）；预设卡显示提示词摘要，元信息标注「提示词预设」。

### 角色注入

技能选中后以**系统提示**的形式注入会话，不是塞进输入框，因此不会被后续提问稀释。

注入内容包含技能名称、说明、指令，以及知识文件的绝对路径清单。
绑定关系按会话 id 实时查表，所以给已存在的会话换技能，**下一轮立即生效**。

### 数据容错

- `gens.json` 被外部修改（手动编辑、恢复备份）时，宿主会按 `mtime:size` 检测并自动重读，同时重新注册技能。
- 知识文件的绝对路径失效时（数据目录搬家、跨机器恢复备份），读取会**自动按文件名在该技能的知识目录里找回**，并把修复后的路径写回存储。
- 备份与克隆走同一套修复逻辑；确实找不到的文件会在备份完成后弹窗列出，不会静默丢失。

---

## 安装

### 前置条件

- 已安装 DeepSeek Harness（桌面版或 `dsh` CLI）
- Node.js `^22.19.0 || >=24.0.0`

### 方式一：从压缩包安装（推荐给使用者）

```bash
# 1. 解压到任意目录，例如
#    Windows: C:\Users\<你>\.dsh\plugins\dsh-gen
#    macOS/Linux: ~/.dsh/plugins/dsh-gen

# 2. 进入目标 profile 目录
cd ~/.dsh/profiles/desktop

# 3. 用 DSH 自带的 pnpm 安装（注意用 file: 前缀指向解压目录）
node ~/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.cjs \
  add file:C:/Users/<你>/.dsh/plugins/dsh-gen --offline
```

### 方式二：手动挂载

1. 把项目目录放到 `~/.dsh/profiles/desktop/node_modules/dsh-gen`
   （Windows 下建议用目录联接，便于改代码即时生效）：

   ```bat
   mklink /J "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-gen" "C:\path\to\dsh-gen"
   ```

2. 编辑 `~/.dsh/profiles/desktop/package.json`，在两处登记：

   ```json
   {
     "dependencies": {
       "dsh-gen": "file:C:/path/to/dsh-gen"
     },
     "dsh": {
       "profile": {
         "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-gen"]
       }
     }
   }
   ```

3. 重启 DSH。

### 验证安装

启动后打开 **设置 → Dsh-Gen**，能看到「技能 / 预设」两个标签即安装成功。
插件加载痕迹写在 `$DSH_HOME/dsh-gen/load-trace.log`，排查问题时先看它。

---

## 使用

### 新建一个技能

1. 设置 → Dsh-Gen → **新建 → 技能**
2. 填写 **名称**（必填）与 **说明**（会出现在选择器卡片上，建议一两句话说清用途）
3. 在 **指令** 里写角色设定，支持 Markdown；也可以点右上角 **从模板选择** 起步
4. 在 **知识** 里添加本地文档（可选），右侧预览会同步显示
5. 点右上角 **保存**

### 新建一个预设

1. 设置 → Dsh-Gen → **新建 → 预设**
2. 填写 **名称** 与 **内容**
3. 保存后自动回到**预设**标签页

### 在对话里使用

**技能**：

- 从设置页：点卡片上的对话气泡，直接开一个绑定好角色的新会话。
- 从会话里：点输入框左侧的胶囊，在**技能**卡组里选一张，当前会话立刻切换角色。
- 取消角色：打开选择器，点底部「取消技能角色」。

**预设**：

- 打开选择器，点底部切换按钮进入**预设**卡组，选一张。
- 内容会写进输入框，检查后再发送。
- 也可以长按拖拽「出牌」，效果相同。

### 备份与迁移

- **备份全部**：导出全部技能与预设（含知识文件内容）为一个 JSON。
- **导入**：把这个 JSON 或单个技能的导出文件喂回去。
- 换机器时也可以直接拷贝整个 `$DSH_HOME/dsh-gen/` 目录。

---

## 工作原理

### 技能如何注册

插件加载时读取存储，为每个**启用且 kind 为 skill** 的条目调用：

```js
ctx.skills.register({
  name,          // kebab-case，中文名会退化成 skill-<id 后缀>
  description,   // 以「技能名」开头，便于模型匹配中文标题
  content,       // Markdown 正文：## 指令 + ## 知识库（含绝对路径）
  resourceBase: { kind: 'directory', path },
  metadata,
});
```

模型通过 DSH 的 `skill` 工具按需加载这些条目。**预设不注册成 skill**，它只是文本。

### 角色如何注入会话

插件注册了一个全局 system prompt 区段，其正文是一个**按会话 id 查表**的函数：

```
会话 id → 技能 id → 该技能的名称/说明/指令/知识路径
```

这样做的两个好处：

1. 角色是**系统级设定**，不会因为用户后续提问而失效；
2. 给已存在的会话切换技能，**下一轮立即生效**，不需要重建会话。

绑定关系存在 `gens.json` 的 `bindings` 字段里，删除技能时会一并清理。

### 预设如何进入输入框

预设不走角色通道，它要的是「把文本放进输入框」。实现上有两条路径，优先官方 API：

1. **`conversation.input.setDraft(text)`** — 会话自己的草稿存储。输入框就是从这里渲染的，
   所以写进去的文本会正常参与重渲染与撤销，行为和手动输入一致。
2. **DOM 兜底** — 若当前组合下拿不到 `conversation` 服务，则直接写 live 的
   `<textarea>` / contenteditable，用原生 value setter 让 React 的受控输入感知到变化。

两者都失败时会明确弹窗提示，不会静默丢弃。

### 前端如何拿到数据

宿主端（`lib/index.js`）通过 `TypertRemoteService` 暴露 14 个 RPC 方法：

| 方法 | 用途 |
| --- | --- |
| `listGens` | 读取全部技能与预设，附工作区信息 |
| `saveGen` | 新建或更新（同一事务里可附带知识文件与删除项） |
| `deleteGen` | 删除条目及其知识文件 |
| `addKnowledge` / `removeKnowledge` | 单独增删知识文件 |
| `readKnowledgeFile` | 读取知识文件内容（含 128KB 预览上限与路径自动修复） |
| `cloneGen` | 克隆技能或预设 |
| `exportGen` / `exportAllGens` | 导出单个 / 全部 |
| `importPackage` | 导入导出包 |
| `openWorkspace` | 取回 `dsh-gen` 工作区的 id 与路径 |
| `bindSession` / `unbindSession` / `sessionBinding` | 会话与技能的绑定关系 |

浏览器端（`lib/client.js`）用 `ctx.remote.$mount()` 挂载这些描述符，
再通过 `ctx.get('remote.dshGen')` 调用。

---

## 文件结构与关联

```
dsh-gen/
├── package.json        插件清单：入口、导出、DSH 集成声明、peer 依赖
├── cordis.patch.yml    向 Cordis 插件树插入本插件的补丁行
├── README.md           本文档
├── LICENSE             MIT
├── .gitignore          排除用户数据与构建产物
├── .npmignore          发布时排除开发文件
└── lib/
    ├── index.js        宿主端：存储、RPC、技能注册、提示注入、工作区
    └── client.js       浏览器端：设置页 UI、选择器、查看器、RPC 描述符
```

### 各文件职责与关联

**`package.json`** — 插件身份的来源，DSH 靠它发现插件：

```json
{
  "main": "lib/index.js",          // 宿主端入口
  "exports": {
    "./client": "./lib/client.js"  // 浏览器端入口
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },      // 自动注册进插件树
    "client": { "platform": "web", "inject": [...] }  // 让前端 bundle 被发现
  }
}
```

- `dsh.bundle.patch` 指向 `cordis.patch.yml`，DSH 启动时据此把插件插入 Cordis 树。
- `dsh.client` 声明这是一个 Web 端插件，并列出它依赖的前端服务。
- `peerDependencies` 只声明宿主会提供的包（`cordis`、`typert-protocol`、`react`），
  因此**插件本身不需要打包 node_modules**。

**`cordis.patch.yml`** — 三行插件树补丁：

```yaml
- insert:
    - id: dsh-gen
      name: dsh-gen
```

**`lib/index.js`（宿主端）** — 模块顶层 `export const name = 'dsh-gen'`，`apply(ctx)` 里完成：

1. 建立 `$DSH_HOME/dsh-gen` 目录并注册为工作区（标题 `dsh-gen`）
2. 读取 / 写入 `gens.json`（按 `mtime:size` 检测外部改动并自动重读）
3. 为每个启用的**技能**注册 runtime skill（预设跳过）
4. 注册 system prompt 区段做角色注入
5. 通过 `TypertRemoteService` 暴露 RPC
6. 写 `load-trace.log` 记录加载过程

**`lib/client.js`（浏览器端）** — 用 `window.__ModuleLoader__.load({ id, factory })` 包装，
在 `apply(ctx)` 里挂两个 UI 槽位：

| 槽位 | 组件 | 说明 |
| --- | --- | --- |
| `settings.section` | `DshGenSection` | 设置页的 Dsh-Gen 选项卡 |
| `conversation.input.left` | `PickerHost` → `SkillPicker` | 输入框工具行的选择器 |

`PickerHost` 是一层薄包装：它负责拿到 `conversation` 服务并解析出当前会话的
`conversationInput`，传给 `SkillPicker`，让预设能写进草稿存储。拿不到时选择器自行降级。

同时用 `ctx.remote.$mount()` 挂载与宿主端对应的 RPC 描述符。

**关联链路**（一次「保存技能」的完整路径）：

```
设置页点保存
  → client.js 调 api.saveGen({...})
  → RPC 序列化，走 connection 到宿主
  → index.js 的 DshGenService.saveGen
  → runtime.save()：写 gens.json + 拷贝知识文件 + syncSkills()
  → 返回最新 view
  → client.js 用返回值刷新界面（并按 kind 切到对应标签页）
```

**关联链路**（选中一张预设卡）：

```
选择器点预设卡
  → client.js 的 choose(gen)，gen.kind === 'preset'
  → insertPromptIntoComposer(text, conversationInput)
  → conversation.input.setDraft(text)          ← 首选
  → 失败则写 DOM textarea / contenteditable    ← 兜底
  → 两条都失败 → 弹窗提示
```

---

## 数据存储

所有用户数据都在 `$DSH_HOME/dsh-gen/`（`DSH_HOME` 默认是 `~/.dsh`）：

```
$DSH_HOME/dsh-gen/
├── gens.json                技能、预设与绑定关系
├── knowledge/<条目 id>/...   挂载的知识文件副本
└── load-trace.log           加载痕迹（有 256KB 上限）
```

`gens.json` 结构：

```jsonc
{
  "version": 1,
  "gens": [
    {
      "id": "gen_xxx",
      "kind": "skill",             // "skill" | "preset"
      "name": "技能名",
      "description": "说明",
      "instructions": "指令或提示词（Markdown）",
      "disableKnowledge": false,   // 停用知识引用（预设恒为 true）
      "enabled": true,             // 是否注册为 runtime skill
      "pickerHidden": false,       // 是否在会话内选择器中隐藏
      "knowledge": [               // 预设恒为空数组
        { "id": "k_xxx", "name": "文档名", "fileName": "磁盘文件名",
          "path": "绝对路径", "bytes": 1234, "addedAt": "ISO 时间" }
      ],
      "createdAt": "ISO 时间",
      "updatedAt": "ISO 时间"
    }
  ],
  "bindings": {
    "session-xxxx": "gen_xxx"      // 会话 → 技能（预设不参与）
  }
}
```

> **注意**：`gens.json` 是**用户数据**，不在本项目仓库里，也不应该提交到 Git。
> 换机器时备份整个 `$DSH_HOME/dsh-gen/` 目录即可。

---

## 开发

### 本地开发

推荐用目录联接（Windows）或符号链接（macOS/Linux）把项目挂进 profile，
这样改完代码刷新窗口即可看到效果，不必反复安装：

```bash
# macOS / Linux
ln -s /path/to/dsh-gen ~/.dsh/profiles/desktop/node_modules/dsh-gen
```

```bat
:: Windows
mklink /J "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-gen" "C:\path\to\dsh-gen"
```

- 改 `lib/index.js`（宿主端）：DSH 的 HMR 会重新加载插件行。
- 改 `lib/client.js`（浏览器端）：需要**刷新页面**。

### 语法检查

```bash
node --check lib/index.js
node --check lib/client.js
```

### 打包

```bash
# 只打包 npm files 白名单里的文件
npm pack
```

### 代码约定

- 注释用英文，界面文案用中文。
- 界面里「gen」统一称「技能」或「预设」，不使用英文副标题与装饰性符号。
- 图标统一用 QingIcon 的 24×24 / 2px 描边规格，`stroke: currentColor` 以继承按钮状态色。
- 动效统一用 `cubic-bezier(.22, 1, .36, 1)` 这类带轻微过冲的曲线，时长 0.14–0.46s。
- 浮层不要用 `backdrop-filter`：全视口模糊会在 Electron 里触发整页重栅格化，表现为黑闪。

---

## 常见问题

**装完设置页看不到 Dsh-Gen 选项卡？**

先看 `$DSH_HOME/dsh-gen/load-trace.log` 有没有 `apply() entered`。
没有说明宿主端没加载，通常是 profile 的 `bundles` 里没加 `dsh-gen`，或 `node_modules` 里没有这个包。

**技能注册名为什么是 `skill-xxxxxx` 而不是我填的中文名？**

DSH 的 skill 名必须是 kebab-case ASCII（`^[a-z0-9]+(-[a-z0-9]+)*$`）。
中文名无法直接转成合法名字，因此退回 `skill-<id 后缀>`。
**展示名始终是你填的名字**，技能描述里也以「你的名字」开头，方便模型匹配。

**预设为什么不出现在模型的技能目录里？**

预设不是技能。它只会在你从选择器里选中时，把内容写进输入框。
需要「角色」请用技能。

**新建预设后保存，为什么没进技能列表？**

它进了**预设**标签页。保存时会按条目的 `kind` 自动切到对应标签，
两个列表是分开的。

**知识文件放在哪？原文件删了会怎样？**

选中时会把文件**复制**到 `$DSH_HOME/dsh-gen/knowledge/<条目 id>/`。
原文件之后移动、改名、删除都不影响已挂载的副本。删除条目时副本一起删除。

**查看文件内容时提示「磁盘文件不存在」怎么办？**

插件会先尝试按文件名在该条目的知识目录里自动找回。
若仍失败，说明文件确实已丢失，需要重新上传。

**给会话切换技能要重新开对话吗？**

不需要。角色注入是每次组装系统提示时按会话 id 实时查表，切换后下一轮就生效。

**会话内选择器里的技能不见了？**

可能被卡片上的眼睛图标关掉了（卡片元信息会显示「会话内已隐藏」）。
到设置页用眼睛图标重新打开即可。也可能只是切换到了「预设」模式——看底部控制条最左侧的按钮。

**备份为什么提示「有 N 个文件在磁盘上找不到」？**

备份会把知识文件的**内容**一起打包。若某些文件已从磁盘丢失，
备份仍会完成，但会明确列出未包含的项，避免你误以为备份是完整的。

---

## 许可

[MIT](./LICENSE)

图标来自 [QingIcon](https://qingicon.com)（[asorn/qingicon-open](https://github.com/asorn/qingicon-open)，MIT），
仅以内联 SVG path 形式使用，不引入运行时依赖。
