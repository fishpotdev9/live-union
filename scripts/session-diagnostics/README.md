# 会话与重载的离线数值观察

```powershell
node scripts/session-diagnostics/analyze.cjs <sample.jsonl或sample.json>
node --test tests/unit/session-diagnostics/analyze.test.cjs
```

无第三方依赖。输入是既有 `--metrics` / `validation.ts` 生成的受限样本；单个 JSON（可格式化）或 JSONL 均可，`-` 表示 stdin。工具只读取明确提供的文件并向 stdout 输出 JSON，不启动 Electron、不访问网络、不读取任何浏览器配置、Cookie、账号或会话目录，不操作正在运行的应用。不要把浏览器存储或认证数据作为输入。

退出码 0 只表示有数值观察事件，`observationsAvailable:true`。退出码 1 表示有合法输入但没有观察到事件，不能排除事件发生。参数错误、文件不可读或没有任何合法样本退出 2；可解析但不合法的内容仍会输出计数报告。部分坏行不吞掉：报告 `malformedLines`、`invalidRecords`、`invalidRooms`，保留固定原因及输入行号；后续跨坏行比较标记 uncertain。报告本身不保存输入文本或路径。

`loginLossCauseConfirmed:false`、`serverCauseVerified:false`、`completeDiagnosis:false` 始终成立。此工具没有原生登录状态、服务器响应或认证证据；清晰度尺寸变化不能证明掉登录，观察到导航也不能证明由软件、平台或用户触发。未开启诊断时发生的历史事件无法回放。

事件名称固定：

| event | 条件与边界 |
| --- | --- |
| `app-room-runtime-recreated` | 前后 generation 与 WebContents ID 均为正数且至少一个变化。0表示未创建或失败占位，按缺失身份标记 uncertain，恢复成正数不声称重建。仅说明运行身份变化。 |
| `document-navigation-observed` | 同一 generation、WebContents 中主文档导航计数增加。跨运行实例的计数不比较。 |
| `media-observation-epoch-changed` | 选中的媒体观察 epoch 变化；不把它叫作 reload。媒体可能来自子 frame，候选选择也可能改变。文档或运行上下文变化会另标 uncertain。 |
| `media-candidate-instance-changed` | 同一运行身份、导航计数与 epoch，选中的 videoInstance 变化。WeakMap会给遍历到的多个video编号，在两个已存在的广告/主video候选间切换再切回也会变化；此事件只说明观测候选实例更换，不证明元素创建或播放器重建。 |
| `media-dimensions-decreased` | 有效正数宽或高下降。记录实际观察，不推断原生档位、账号权益、网络或登录原因。 |
| `runtime-error` | 前一观察不为 error，后一 navigation 为固定枚举 error。不会把错误正文带入报告，也不把 error 等同 renderer crash。 |

每个 run 内按输入顺序分析，房间编号按该 run 首次出现的稳定 ID 顺序分配。交错 run 独立保存基线；不跨 run 比较。sourceSHA 改变启动新分段并清空比较基线。乱序和重复时间显式计数且跳过，不重排来制造连续性。房间重现、公开房号/平台改变、诊断缺字段、导航计数回退、超过 30 秒的间隔分别记录上下文或 uncertainty。没有事件的 uncertain 比较仍列于 `uncertainComparisons`。

仅接受有界整数、布尔与固定平台/状态枚举；宽高上限32768、videoInstance上限1e12，其余计数上限安全整数。公开房号仅接受可安全转换的正整数。任意字符串形式的运行/内部房间 ID 和64位来源哈希仅在内存中作有界身份比较，输出中只保留顺序编号；不原样输出这些标识。versions、URL、错误文本、页面/聊天内容、Cookie、消息及其他未知字段全部丢弃。输出时间重新标准化为UTC。事件前后只包含白名单数值、布尔和固定枚举，不能替代真实平台或会话验收。
