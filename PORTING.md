# ADu 特有功能清单与移植规划

> 本文档盘点 ADu Director 在 OpenFilm 之上独立扩展的功能，评估每一项相对上游
> OpenFilm 最新版（#537+）的空白度，并给出移植分档、形态与顺序。
>
> 数据来源：`adudir-reconstructed/motion-studio`（ADu Director 1.5.3 安装包提取）
> 与上游 `packages/openfilm`（commit 6948906）的逐文件对照。
>
> 移植原则：**看思路、自己写**。ADu 的 `adudir-*` 代码是其私有财产，本仓库中的
> 实现均为参照功能效果的重写，不复制其代码表达。

## 一、总览

| # | 功能组 | ADu 参考规模 | 上游现状 | 档位 | 移植形态 |
|---|--------|------------|---------|------|---------|
| A | 声明式编辑操作层（edit ops + 撤销） | ~1800 行 | **空白** | 一 | craft 插件命令 |
| B | 成片质量检测（film checks） | ~2100 行 | **空白** | 一 | craft 插件命令 |
| C | 音频闪避（ducking） | ~800 行 | **空白**（预留了挂载点） | 一 | craft 插件 + 极小核心补丁 |
| D | MCP 工具桥 | ~4000 行 | **空白** | 一 | craft 插件命令（stdio server） |
| E | 节拍检测 / 音乐适配 / 音效 | ~1500 行 | **空白** | 一 | craft 插件命令 |
| F | 字幕增强（重叠/ASR/语音尾巴） | ~2000 行 | **部分已有** | 一(择优) | 增量移植，先深查 |
| G | 关键帧动画系统 | ~700 行 | **部分已有** | 一(择优) | 编译到 CSS keyframes，先验证 |
| H | 视觉特效（抠像/马赛克/转场） | ~1300 行 | **大部分已有** | 二(缺口) | 仅移植缺口项 |
| I | 变速斜坡 / retime / 定格 | ~700 行 | **空白**（静态 speed 有） | 一 | craft 插件 + 核心补丁 |
| J | 分层渲染管线 / HDR | ~2200 行 | 无 | 二 | 核心重写，成本最高，缓议 |
| K | 模板体系（本地创作部分） | ~2500 行 | 无 | 二 | 看产品定位 |
| L | 基础设施杂项 | ~6000 行 | — | 按需 | 只移植被依赖的 |
| M | ADu 商业/产品化逻辑 | ~4000 行 | — | **不移植** | — |

## 二、第一档详述

### A. 声明式编辑操作层

**是什么**：把「剪辑」抽象为声明式操作（按片段、淡入淡出、台词、cue 修改），而非直接
patch 文本。每次操作：写入前整体校验 → 说明改了什么 → 可逐条撤销（`--undo` 带变更
检测）→ 操作日志。编辑以 `by: "author"` 语义写入，与 Studio 手动修改区分。

**ADu 参考**：`adudir-edit.mjs`（1268 行）、`adudir-film-writer`、`adudir-track-map`、
`adudir-track-identity`、`adudir-edit-copy-guide`

**上游现状**：空白。上游 agent 直接读写 film.html 文本，插件 `edit` 仅有
`add`/`look` 两个命令，无操作抽象、无撤销。

**为什么是地基**：MCP 工具桥（D）的每个写操作都需要「记录原因 + 可撤销」语义；
质量检测（B）修复问题也需要通过操作层写入。**最先或第二个移植**。

### B. 成片质量检测

**是什么**：基于渲染结果（而非猜帧）的成片 QA：定格检测、缓慢漂移、单次运动过长、
纯滚动过长、静止时间占比、「死句」（静止画面配长台词）等。

**ADu 参考**：`adudir-film-checks.mjs`（1123 行）、`adudir-look-checks`、
`adudir-preview-check`、`adudir-render-verify`

**上游现状**：空白。上游 `look` 只出 contact sheet + 响度，无内容质量判断。

**价值**：AI 生成视频的品控核心——agent 出片后自检，发现问题经操作层（A）修复。

### C. 音频闪避 ✅ 已移植（craft duck）

**是什么**：旁白/人声出现时背景乐自动降低音量的闪避曲线（attack/release/follow）。

**ADu 参考**：`adudir-duck.mjs`（248 行）、`adudir-duck-curve/follow/spec`、
`adudir-volume-envelope`

**移植结果**（commit `2261bb0`）：
- 声明式：`data-craft-duck` 挂在 `<audio>`/`<video>` 上，协议零改动（`data-*` 本就允许）
- 全参数：under/speech/pause/ratio/threshold/attack/release/hold/from-to/over 窗口
- 增益按 10ms 网格计算，缓存于 `.film/craft-duck/`（功率测量也按内容哈希缓存）
- 注入走上游预留的 `defineProcessor` + clip chain，核心补丁仅 `shared.mjs`/`timeline.mjs`
  两处共约 10 行（透出 attrs/id + 调用 hook），均有 `craft:` 标记
- 验证：6/6 插件测试通过（含端到端混音测量），上游 sound/timeline/film-doc 100/100 无回归
- 已知限制：预览（Studio AudioWorklet）暂未接入（上游 chain 预览接线本身未完成）；
  变速 clip 的被跟随功率按 speed 映射已处理，但变速音乐本身的闪避未测

### D. MCP 工具桥

**是什么**：stdio MCP server（官方 `@modelcontextprotocol/sdk`），把引擎能力封装
为工具集：影片读写、媒体、模板、反转、导出等。写操作强制 `why` 参数并记入项目活动，
可逐条撤销。

**ADu 参考**：`src/adudir-mcp/`（server + tools-film/media/template/reverse/get/run/
sealed/shot + captions-lines + locate 等约 15 个文件）

**上游现状**：空白（上游只有 agent 侧，无 MCP 服务面）。

**价值**：你们 LLM 自接——这正是 LLM 与引擎之间的工具层。**依赖 A（操作层）先行**。

### E. 节拍 / 音乐适配 / 音效

**是什么**：BGM 节拍检测、按节拍点切镜头/踩点特效、音乐长度适配（自动裁剪/循环到
成片长度）、页面音效。ADu 参考：`adudir-beats`（412 行）、`adudir-beat-fx`、
`adudir-music-fit`、`adudir-page-sfx`。

**上游现状**：空白（无 beat 相关实现）。

**注意**：`adudir-music-library`/`sfx-library` 曲库音效库是 ADu 的服务端数据资产，
只移植能力不移植数据；素材源你们自备。

### F. 字幕增强（择优增量）

**上游已有**：WebVTT 字幕轨道完整读写、时间线绘制、Studio 编辑、导出
（`src/captions.mjs`），近期 #494/#524/#525 持续增强。

**ADu 增量部分**（值得移植的空白）：`adudir-subtitle-overlap`（字幕重叠消解）、
`adudir-asr-context`（ASR 上下文纠错）、`adudir-speech-tail`（语音尾巴检测）、
`adudir-uncovered-speech`（无字幕覆盖的语音段 QA）、`adudir-caption-window`。

**移植前必须深查上游 captions.mjs 现状，只补真正缺的。**

### G. 关键帧动画（择优验证）

**上游已有**：协议级 CSS `@keyframes` + `split` overrides（按字/词/行交错动画）。

**ADu 增量**：`adudir-keyframes`——"有界声明式元素动画"，文档/预览/导出三端共享的
受约束动画系统。可能是编译到 CSS keyframes 的 authoring 层。**先验证上游 `split`
+ CSS 动画能否表达，能则此组价值大减。**

### I. 变速斜坡 / retime / 定格

**上游现状**：`speed` 仅静态 0.1–100，无时间重映射。

**ADu 增量**：`adudir-speed-ramp`（变速斜坡）、`adudir-retime`、
`adudir-still-frame`（定格帧）、`adudir-source-clock/movie-clock`（时钟映射）。

**移植成本**：变速需要渲染层支持——**核心补丁候选**，需先评估上游 render/host
的时间采样架构。`still-frame`（抽一帧定格成图片clip）可纯插件实现。

## 三、第二档（看产品定位再定）

| 组 | 说明 |
|---|------|
| J. 分层渲染 + HDR | FFmpeg 原生渲染普通素材保原始分辨率/动态范围，浏览器只画透明叠加层。画质性能上限，但嵌在重写度 89% 的 render.mjs 中，成本最高。画质非卖点则上游渲染够用 |
| K. 模板本地创作 | scaffold/author/generator。模板生态是产品级决策；`.motion` 格式有 adudir-open 公开文档可依。发布/市场部分不移植（见下） |
| H 缺口项 | `adudir-mosaic`（马赛克/局部模糊，上游无）、`adudir-frame-*`（帧网格/形状，渲染支撑）。chroma-key/dissolve 上游大概率已有，先验证 |

## 四、不移植（ADu 商业/产品化私有逻辑）

- `adudir-sealed`：加密封闭模板（MotionGit 付费模板保护，密钥在桌面主进程）
- `adudir-template-publish`：MotionGit Creator API 客户端（`mgk_` key 体系）
- `adudir-beta` / `beta-copy`：内测门控
- `adudir-audit`：审计计费（789 行）
- `adudir-machine-queue` / `resource-budget`：多机渲染基础设施
- `adudir-code-identity` / `linked-identity` / `assistant-name`：产品身份体系
- `desktop/` 全部 28 文件：ADu Electron 壳桥接（上游有自己的 desktop app）
- `adudir-redact`：遥测脱敏
- `lib/film-motion` 等 vendored 库：按上游等价物处理

## 五、移植架构约定

### 形态：`craft` 单插件多命令

参照 ADu 的 `adu-motion <command>` 形态，所有移植功能集中在**一个插件**里：

```
packages/openfilm/plugins/craft/
  SKILL.md          agent 使用指南
  openfilm.json     社区窗口元数据
  package.json      bin 命令注册
  bin/
    duck.mjs        openfilm craft duck …
    edit.mjs        openfilm craft edit …
    check.mjs       openfilm craft check …
    beats.mjs       …
    mcp.mjs         stdio MCP server
  src/              插件内共享逻辑（envelope、film 读写、活动日志……）
```

- 命令风格：`openfilm craft <feature> [args]`，与上游 `openfilm color look` 一致
- 单插件原因：功能间共享底层（操作层/包络/undo 日志），拆多插件会重复
- **零上游文件修改**：插件直接 import `../../src/*.mjs`（只读引用）

### 隔离规则

1. 所有新代码在 `plugins/craft/` 内，文件名不带任何 adu 字样
2. 极少数必须的核心补丁（如 sound-engine clip chain 挂载、变速采样）：
   - 单独成文件（如 `src/craft-sound-chain.mjs`），上游文件只加一行 import/挂载
   - 改动处注释 `// craft:` 标记，合并上游时一眼可辨
3. 插件内逻辑对上游 API 变化敏感属正常——用测试显性暴露，而非合并冲突

### 命名

`craft`：剪辑工艺。简短、契合功能本质、与上游插件（adobe/canva/canvas/color/
dropbox/edit/frameio/notion/screening/vimeo）不重名。

## 六、移植顺序

| 序 | 功能 | 理由 |
|---|------|------|
| 1 | C 音频闪避 | 最小最独立，建立插件模式样板 |
| 2 | A 编辑操作层 | 地基，D/B 都依赖它 |
| 3 | B 质量检测 | Agent 品控闭环 |
| 4 | D MCP 工具桥 | LLM 接入面 |
| 5 | E 节拍/音乐 | 独立增值 |
| 6 | I 变速/定格 | 需核心补丁评估，放后 |
| 7 | F/G/H 重叠组 | 逐项深查后择优增量 |

每步：先深读 ADu 参考实现 + 上游对应机制 → 写移植设计（命令面/数据结构/集成点）
→ 实现 + 测试 → commit。
