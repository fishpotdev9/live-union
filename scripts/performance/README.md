# 九路性能离线分析

无依赖的 Node CJS 工具，只读取 `src/main/bootstrap/validation.ts` 输出的受限数值诊断和可选的既有 hardware 日志。不会运行 Electron、访问网页、采集硬件、读取浏览器配置或会话。阈值来自 `docs/evidence/performance/BASELINE.md`，没有阈值覆盖参数。

```powershell
node scripts/performance/analyze.cjs .local/validation/<run>/samples.jsonl
node scripts/performance/analyze.cjs .local/validation/<run>/samples.jsonl --hardware .local/hardware
node --test tests/unit/performance/analyze.test.cjs
```

位置参数也可为 `-`，从标准输入接收 JSONL。`--hardware` 可以重复，接受单个 JSON/JSONL 文件或目录；目录只读取直接子级 `.json`/`.jsonl` 文件。兼容 `scripts/sample-hardware.ps1` 的 pretty JSON。JSON 报告写到 stdout；工具本身不写报告文件。退出码 0 表示某个完整连续段满足被分析的数值条件，1 表示未通过或数据不足，2 表示参数/文件读取错误。错误不回显输入文本或路径。

`measuredCriteriaPass` 只表示受限诊断中的数值条件满足。`completePass` 和 `fullAt30Pass` 始终为 false：离线计数无法认证真实输入，也不能替代无遮挡人工观察、原生高清档位、源目标帧率、听感、100 次交互、P07 或三平台功能验收。报告明确列出这些未验证内容。没有 hardware 全系统 CPU 采样时 CPU 为 `unverified`，不能用 Electron 进程 CPU 相加代替。

每个连续合格段独立预热 5 分钟，然后分析最多 60 分钟。9 个固定 ID、三平台各 3 个、至少 1920×1080、未暂停、可见、非最小化、无放大/原页覆盖、无可见辅助窗、窗口有焦点和合法自动模板均需持续满足。失焦单独记录为遮挡未验证。任一不合格样本中断连续段；运行/来源/ID/主文档导航次数、播放器身份、画面尺寸或声音意图改变，以及计数/媒体时间回退也拆段。分段永不拼接。选用通过段优先，其次合格稳定覆盖最长的段，其余段和问题仍保留。

采样间隔允许漂移，上限 30 秒；缺口超过上限会拆段。按真实时间计算 60 秒帧率及 300 秒丢帧滑动窗口；窗口从每个样本及其相应窗口边界开始，并在相邻样本间线性插值。此估计无法描述两次采样之间的瞬时卡顿，不宣称像素级呈现测量。

`frames` 是 `getVideoPlaybackQuality().totalVideoFrames`，包含已丢帧；实际呈现帧率估计使用 `Δ(frames − dropped) / 秒`，总帧率另记。丢帧率为 `Δdropped / Δframes`。零进度不算通过。内存首/末 5 分钟采用时间加权均值；private bytes 与 working set 分开，working set 相加可能重复统计共享页。应用进程 CPU 保持 Electron API 的原始百分比口径，按 PID 提供摘要。

CPU 日志需有同一 `sourceSha256`、9 房间、合法 0–100 的 `systemCpuPercent`，`sourceSampleAt` 必须精确对应该连续段样本，采集时间与源样本相差不超过 30 秒。稳定小时首尾边界各容许 30 秒采样偏移，中间间隔不超过 30 秒；不足时标未验证。P95 使用 nearest-rank。现有 hardware 格式没有 runId，精确源样本时间与来源哈希共同约束归属。

输出只含白名单数值、固定原因代码、标准化时间、平台枚举、数值 PID 和哈希身份。房间原 ID、原 runId、平台房号、URL、页面正文和未知字段不复制到报告。即使没有合格段，也提供原始媒体计数的每路摘要和观测跨度；它们不等同于连续合格覆盖。
