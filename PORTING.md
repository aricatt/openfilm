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


---

## 四、ADu 2.0 对齐分析（2026-11-27，hot-update 2.0.2）

**更新机制**：ADu 采用热更新——`Program Files` 保持 1.5.3 外壳，运行时加载
`%LOCALAPPDATA%\ADuDir\hot-update\` 覆盖层（当前 2.0.2，minNativeVersion 1.5.3）。
**以后做版本对比，对象是这个覆盖层，不是 Program Files。**对比脚本：
`node D:\__MotionGitAnl\cmp-hot20.js <hot-update/motion-studio> <adudir-reconstructed/motion-studio>`。

**diff 规模**：374 个文件中 115 改、35 新增、1 删。绝大多数是用户反馈驱动的
健壮性修复（B2611xx 工单），不是新架构。产品层大变化（移动端、模板中心、
Producer 工作台）在引擎之外，与本移植无关。

### 对已移植功能的影响

| craft 功能 | 2.0 对应模块变化 | 对齐行动 |
|---|---|---|
| duck | `adudir-duck-spec` +14 行：新增 `readDuck`——**JSON 读不出的闪避声明不再让整部影片拒绝渲染**，警告一次按无闪避处理 | ✅ **已对齐**（77adcf0）：craft readDuck 同语义 |
| edit | `adudir-edit` +16 行：undo 变为**媒体感知**——被替换的媒体文件从工程版本记录恢复（adudir-undo-media）；我们的 undo 只快照 film.html | 列为增强项，中优先级 |
| check | `adudir-film-checks` **未变**；look-checks +1 行；preview-check +22 行 | 无需行动 |
| beats | **未变** | 无 |
| ramp | `adudir-speed-ramp` **0 diff**；movie-clock 58→104 行（fork 内部时钟，与我们无关） | 无 |
| still-frame | 39→145 行大扩展：末尾帧回退抽取 + 导出用 exactStill | ✅ **抽取半已移植**（stillFrame+回退，`craft still`）；exactStill 属 fork 渲染管线，不移植 |

### 2.0 新增模块的移植价值评估

| 模块 | 行数 | 是什么 | 评估 |
|---|---|---|---|
| `adudir-mcp/snap-cuts` | 101 | **切分/修剪语音 clip 时切口自动吸附到最近静音**（防卡字/吃尾音），无静音则一行说明 | ✅ **已移植**（6105cec）：`craft edit --snap` |
| `adudir-film-health` + `adudir-film-literals` | 55+71 | 不开浏览器检查工程健康：composition 读不出、页面缺失、页面读了未声明的参数（acorn 静态分析） | 中价值，QA 类，小型 |
| `adudir-caption-marks` | 82 | 字幕逐字时间损坏时**修复而非拒绝**（丢出位时间、不足两处重排） | 属字幕组（F），随字幕组评估 |
| `adudir-roughcut-bake` + `mcp/roughcut-inputs` | 210+ | 口播粗剪**烘焙**：时间线上的粗剪结果固化成新文件，模板重做时不会把重录/停顿读回来 | 口播流程相关，看产品方向 |
| `adudir-local-asr` | — | 本地 whisper.cpp 作为云端 ASR 的备选（credits 不足/离线时） | 依赖 ASR 选型决策，缓议 |
| `adudir-nle-effects` | 30 | 导出剪映/CapCut/FCP/Premiere 时 clip 特效与转场的映射 | 导出互操作，产品层，缓议 |
| `audio-tempo` | 9 | atempo 链工具（0.5–2 每级） | 琐碎，需要时随手写 |
| `adudir-film-closure` | 444 | 工程依赖闭包（打包/版本快照用） | 产品层，缓议 |
| `ASSISTANT_JOBS.md` / `ADUDIR_KEYFRAMES.md` | — | 2.0 新文档 | 值得读：理解他们 agent 架构与关键帧契约 |

### 结论

2.0 对已移植功能**冲击很小**：beats/ramp/film-checks 核心零变化，duck/edit 是健壮性
增强而非语义变化。唯一建议立即对齐的是 duck 的容错（小改动）。新增候选中
**snap-cuts（静音吸附切割）价值最高**且只有 101 行，建议并入下一轮
（与死句检测、still-frame 一起）。

---

## 五、2.0 文档研读结论（2026-11-27，ASSISTANT_JOBS.md + ADUDIR_KEYFRAMES.md）

### ASSISTANT_JOBS.md（接活合同 adu-jobs/11）——agent 桥架构验证

这是外部 LLM 助手驱动 ADu 的完整合同，**验证了 craft 的架构选择**：
- 工作流：`brief → job_start → 执行(ops dispatch) → lint → job_report`——与 craft 的
  「读工程→ops 编辑→check→undo 日志」同构
- 关键设计：**opsCatalog**——操作目录下发给 agent，只许用目录里的操作（craft edit 的
  translateOps 白名单同思路）
- 版本冲突协议：先读后改、rev 对不上重新读（craft 的 editProjectFilm revision 检查同）
- 排队协议：同一时间一张单写工程（craft 是单 CLI 无并发问题，未来做服务化时参考）
- 大改动需用户确认（删超 5 秒、换口播）——craft 暂无此概念，做 agent 服务时参考

**新功能情报**（未移植清单的优先级依据）：
- 口播粗剪工作流：read(逐字稿+规则) → decision(指文字不指时间) → preview(读 kept 不通就撤回) → apply(按词边界落刀+留气口+收紧停顿)。**这是 ADu 最成熟的 agent 工作流设计**，若做口播产品值得深移
- 字幕样式系统极丰富：karaoke 逐字高亮、双语（原文+译文排版规则）、按语言设字体、sizePct 按画面短边百分比——上游字幕系统对比后再定
- `duckBgmForVoice` 操作语义与 craft duck 一致，且明确禁止"按字幕区间画音量曲线压人声"（double-duck 体检项）——**craft check 未来可加 double-duck 检测**

### ADUDIR_KEYFRAMES.md（元素关键帧契约 v1）

完整契约：overrides 扩展 `keys`，通道 x/y/sx/sy/r/opacity，ease 含 cubic-bezier，
纯采样器 `adudir-keyframes.mjs`，文档/预览/导出三端共享。**移植评估**：
- 采样器是纯函数，移植容易（估计 200-300 行）
- 难点在消费端：渲染管线要在逐帧渲染时对元素应用采样值——上游 OpenFilm 已有
  `split` overrides 动画和 CSS @keyframes，**先验证上游能力缺口再决定**
- 决策：暂缓，等关键帧动画成为产品需求再启动

## 六、移植完成状态（2026-11-27 终）

| 命令 | 功能 | 状态 |
|---|---|---|
| `craft duck` | 音频闪避（含 2.0 容错） | ✅ |
| `craft edit` | 操作式编辑+undo（媒体感知）+静音吸附 | ✅ |
| `craft check` | 运动质检+死句+**叠化检测** | ✅ |
| `craft beats` | 节拍网格 | ✅ |
| `craft ramp` | 变速斜坡 | ✅ |
| `craft still` | 抽帧定格 | ✅ |
| `craft health` | 工程体检（无浏览器） | ✅ |

测试 52/52。质量检测剩余：密字/字不停——**需要 vision 模型读帧**，
等 LLM 视觉能力决策后实现（算法本身在 adudir-film-checks 是现成的，
输入只是一帧图+「哪些字够大能读」的 vision 回答）。

## 七、字幕组移植进展（2026-11-27 第二批）

### 已移植
- **uncovered-speech**（commit 430866d）：`craft check --lines` 现在同时对成片做静音检测，
  有声音但无字幕覆盖的段（>=0.3s）报 bad。端到端验证精确：5-7s 无字幕语音段准确报出。
  **与 ADu 的必要偏离**：上游字幕无逐字时间 marks（ADu 私有扩展），覆盖粒度为整行 cue。

### 架构发现（影响字幕组其余三项）
上游 captions.mjs 完全没有逐字时间（WebVTT 标准 cue 级），而 ADu 的 caption-marks /
speech-tail / subtitle-overlap 全部建立在 marks 体系上：
- caption-marks 修复的是 marks 损坏——上游根本没有 marks，无从修复
- speech-tail 依赖最后一个词的结束时间——即 marks
- subtitle-overlap（378 行）消解的是逐字显示的重叠

**决策点**：字幕组剩余三项的前提是把逐字时间引入 craft——这本质上是 ASR 对齐能力
（whisper 逐字时间戳）+ WebVTT 内联时间戳（标准 karaoke 格式）的采纳决策。
建议：做 local-asr/云端 ASR 选型时一并决策，而不是单独移植三个依附模块。

### mosaic（马赛克/局部模糊）
待做，上游确认无。需要渲染层调查（H 组帧网格支撑）。

## 八、逐字字幕体系（2026-11-27 立项，用户已决策：做）

### 设计（与 ADu 的关键差异：落在 WebVTT 标准上）
- **存储**：WebVTT 内联时间戳（karaoke 标准格式 `<00:01.200>` 在词前），不用 ADu 私有 JSON。
  带内联戳的 cue 仍是合法 cue——支持的播放器逐字高亮，不支持的整行显示，影片永不依赖 craft。
- **内存表示**：marks = {index(UTF-16), startMs} 列表，与 ADu 同形，修复算法直接适用。
- **地基已落地** `src/caption-words.mjs`（5/5 测试）：readInlineWords/writeInlineWords 往返一致
  + caption-marks 修复三件套（valid/even/repair，重写实现）。

### 待做（按依赖顺序）
1. **ASR 逐字对齐**：whisper.cpp 本地二进制（对齐 ADu 的 local-asr）或云端。产出 marks。
   `craft captions align <audio> <vtt>`：音频+已有字幕文本 → 写入内联时间戳。选型待定：
   whisper.cpp 无依赖但需分发二进制；faster-whisper 需 python 环境。
2. **写入路径接入**：edit/captions 写 VTT 时统一过 repairCaptionMarks（ADu 教训：一处坏时间全文件拒编）。——待做，小项
3. ~~speech-tail~~ ✅ 已移植（55778e7）：模块+5测试。集成点：口播剪辑工作流落地时接入剪口决策。
4. ~~subtitle-overlap~~ ✅ 重架构落地（71b6cbf）：真相是字幕撞版检测（画面文字压字幕），ADu 依赖
   fork 的浏览器合成管线不可移植——改用 craft check --vision 已有文字块坐标做几何相交，零额外成本。
5. ~~逐字高亮渲染~~ ✅ 验证完毕：**上游全链路已支持**（cueNodes 解析→data-t span→逐帧 past/future 类
   →::cue(:past) 样式），零补丁。craft captions 产出自带 KARAOKE_STYLE（3639bb9）。

### 字幕组终态（2026-11-27）：5/6 完成，仅剩写入路径小项。体系全景：
- caption-words.mjs：内联戳读写+修复三件套
- caption-align.mjs：对齐+VTT 生成+卡拉OK样式
- asr.mjs + bin/captions.mjs：transcribe/align 双模式（MIMO mimo-v2.5-asr 实测精准）
- speech-tail.mjs：语音尾巴检测（待集成口播剪辑流）
- check-collision.mjs：撞版检测（vision 几何版）

### ASR 接入情报（MIMO mimo-v2.5-asr，文档已读）
- **不是** /audio/transcriptions 端点——走 chat/completions + content type `input_audio`（base64 data URL，≤10MB，wav/mp3）
- 模型 `mimo-v2.5-asr`，`asr_options.language`: auto/zh/en，支持流式
- base_url 用已配置的 token-plan-cn 代理（与 vision 同），header `api-key` 或 Bearer 待实测
- **文档未提词级时间戳**——下轮第一件事：实测响应里有没有 timestamps。
  有 → 直接 align；没有 → 混合方案：ASR 出文本/分段 + 静音检测切语音段 + 段内按字均铺
  （caption-words 的 evenCaptionMarks 已具备均铺能力），质量对短视频口播足够。
- 注意 ASR 与 vision 不同模型，llm.json 需扩 asr_model 字段。

## 九、关键帧验证结论（2026-11-27）：G 组关闭，不移植

**验证结果：上游表达能力是 ADu 关键帧系统的超集。**

ADu keyframes（x/y/sx/sy/r/opacity 数据通道+缓动）：本质是为他们的**原生编辑器工具**服务的
数据格式（曲线编辑器、拖拽点位、手势确认占契约一半篇幅）。

上游等价能力（全部已存在，实证 film-doc.mjs）：
- film.html 顶层 `keyframes` 字段：命名 CSS @keyframes
- clip 级 `animation` 引用，translate/scale/rotate 位移（协议禁止关键帧放置 clip 本身，语义清晰）
- EFFECTS 系统 14 通道：blur/brightness/contrast/saturate/hue/glow/trim + **3D（z/rx/ry/ax/ay）**——
  超出 ADu 的 6 通道
- split 逐字/词/行 stagger 动画

**ADu 真正多出来的是编辑器 GUI**（曲线编辑、点位手势），属产品层而非能力层。
对 agent 而言 CSS 文本是天然格式，无移植价值。G 组关闭。

## 状态更新（music-fit + roughcut 轮，commits 97cf636 / 6535e90）

### 新完成
- **music-fit** ✅：`planMusic` 忠实移植（小节对齐故事点/quiet 段/tail 收尾），CLI 生成 craft-edit ops 走既有编辑管线（可撤销）。beats.json 格式与 ADu 完全兼容，缓存复用 craft beats 产物。6/6 单测 + 端到端验证。
- **roughcut-bake** ✅：口播粗剪烘焙。上游把 `#t=` 解析进 `clip.time`（与 ADu 模型一致），扫描逻辑几乎原样。ffmpeg concat + 接缝 12ms 淡入淡出防爆音，按切点哈希缓存不重复烘焙。`--apply` 走 journaled edit 管线可撤销。端到端：两碎片精确烘出 6.000s。6/6 单测。
- 测试总数 96/96。

### 移植总盘点（当前）
- 第一档 9 组核心 ✅ 全完成
- 字幕组 F ✅ **6/6 全清零**（含 captions repair 写入路径修复，53b7569）
- mosaic + audit ✅
- keyframes 组：已关闭（上游原生 CSS keyframes 够用）
- **music-fit / roughcut-bake ✅ 本轮清零**
- 剩余候选：写入路径 repair 扫尾、工作台操作按钮、真实使用反馈迭代

### 下一步建议
真实使用验证优先于新移植。用户实测反馈 > 继续搬功能。

