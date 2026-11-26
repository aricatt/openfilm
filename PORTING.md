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

### A. 声明式编辑操作层 ✅ 已移植（craft edit，commit 1d19c76）

**移植中发现的关键事实**：上游最新版已不是空白——`studio/server/ops.mjs` 有完整的
操作式编辑体系（set/move/insert/remove/split/props/fields/track/reorder/captions/
keyframes/stage），`editProjectFilm` 提供事务化写入（整体校验、冲突检测、三人合并），
撤销有 Studio 侧 person-edits。**真正的空白只有两处**：agent 可用的 CLI 入口、以及
headless 撤销日志。

**移植结果**（零上游改动）：
- `openfilm craft edit '<ops json>'`：craft 复合操作 trim/fade/attr/replace/shift/ripple
  翻译为上游 ops；上游 ops 原样透传
- 事务写入经上游 `editProjectFilm`（all-or-none）；rebase 时在新胶片上重新翻译（最多 3 次）
- 自有撤销日志 `.film/craft-edit/`（快照 + jsonl），Studio 不在也能用；
  `--undo` 检测胶片在编辑后被改动则拒绝（`--force` 强制）；`--log` 查看
- 11/11 测试通过（含端到端：编辑→日志→undo 字节级还原、冲突拒绝、dry-run）

**未移植的 ADu 操作**（依赖其他功能组，按需后补）：cue/music/revoice/box-keys/param/stage-ratio。
ADu 的"单轨不重叠拒绝"未移植——上游语义允许重叠（转场），且 fitClipLengths 自行处理。

### B. 成片质量检测 🔶 核心已移植（craft check，commit 21393ff）

**移植中发现的关键事实**：上游 `look` 并非空白——它做逐帧故障检测（白闪、跳帧、
静止帧、黑帧、文字裁切、单色画面、响度）。但那是**技术故障**检测，ADu 的是**剪辑
语言**检测（节奏/运动质量），语义不同，互补不重叠。

**移植结果**（零上游改动）：
- `openfilm craft check <video> [--footage] [--json]`：10fps 小灰帧测量
- 四类检测：hold（定格，呼吸/晃动容差）、drift（缓慢漂移）、move（单次运动过长）、
  scroll（纯滚动过长）；shift/zoom 解释性拟合、cut 切分、burst 计数全套算法重写
- 9/9 测试通过（含编码器噪声标定：静态帧噪声 < STILL_STEP 阈值）

**未移植部分**（依赖外部能力，见决策点）：
- 叠化/主色突变检测（算法最深，BLEND_* 十余个标定阈值）
- 密字/字不停（需 Vision OCR）、数字核对（需 ASR 台词）
- 死句检测（需字幕/台词时间轴，可接上游 captions）
- 字幕条/主持人窗口遮罩（ADu 版式相关）与 look-exempt.json 豁免机制

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

### E. 节拍 / 音乐适配 / 音效 🔶 节拍已移植（craft beats）

**移植结果**（零上游改动）：
- `openfilm craft beats <audio> [--json] [--out]`：完整 DSP 管线重写——ffmpeg 解码
  22.05kHz → 短时频谱（2048/hop 256，双实帧打包 FFT）→ 谱通量 onset（低频加权）→
  加权自相关测速 + comb 精修 → 动态规划节拍跟踪（Ellis 2007）→ 攻击点对齐（含
  反拍检测：底鼓在正拍）→ 强拍相位（底鼓+和声新颖度）→ 小节/段落/重音/进入点/循环点
- 项目内音频旁写 `<name>.beats.json`（按文件哈希缓存），页面可 fetch 踩点动画
- 5/5 测试通过：90/120 BPM 合成点击轨节拍误差 <40ms，强拍落在底鼓上，段落/重音正确

**未移植部分**：
- `music-fit`（音乐按故事点裁剪/拼接）：依赖 cue 概念，待 cue 体系决策后补
- `beat-fx`（踩点特效模板）与 `page-sfx`（页面音效）：属于模板/页面层，缓议
- 曲库/音效库是 ADu 服务端数据资产，不移植；素材源自备

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

### I. 变速斜坡 / retime / 定格 🔶 变速斜坡已移植（craft ramp）

**重要更正**（移植中深查发现）：ADu 的 `adudir-retime` 不是变速！它是**时间轴波纹
重映射**——镜头加长/缩短后下游一切（字幕、cue、模板时间线）跟着移动的纯函数
（retimeMoment/retimeCue）。**此能力已由 craft edit 的 shift/ripple 操作覆盖**。

**变速斜坡移植结果**：
- 注入点比预想干净得多：`film-doc.mjs` 的 `sourceAt` 是 film 时间→素材时间的唯一纯函数，
  导出与精确预览都走它——一处补丁全接管
- 三处核心补丁（均有 craft 标记，上游 film-doc/timeline 回归 90/90 无回归）：
  1. `sourceAt`：曲线分支（预设名或 JSON 点列，积分归一化——恒定曲线恒等于线性）
  2. `hear()`：变速 clip 静音（声音会不均匀拉伸，与 ADu 同决策）
  3. `roll()`：变速 clip 预览不走 playbackRate 自播放，逐帧 seek
- 插件侧：`src/ramp.mjs` 参考实现（5 预设 + 自定义点列）+ `craft ramp` 校验命令
- 语义与 ADu 对齐：clip 长度不变、源区间完整消耗、只改变分布——trim/move/split/导出兼容
- 已知限制：预览播放中变速 clip 逐帧 seek 可能不如自播放流畅（导出不受限）

`still-frame`（定格帧，39 行）：抽一帧成图片 clip，可纯插件实现，工作量小，待做。

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
