# B站页面整理适配器

版本 `2026.11.07.4`；实现冻结 `app-contracts.ts` 1.0 的 `PlatformPresentation`。入口 `index.ts` 导出 `adapter`，`presentation.cjs` 生成随应用打包的固定脚本，声明由 `presentation.d.cts` 提供。正式代码不依赖或加载 `spikes/`，没有新增依赖。`.3`新增失败前几何诊断；`.4`允许至少128px的完整视频预览以适配跨格主副，原生聊天和输入校验不变。

## 行为

- 从主文档寻找唯一原生房间；支持最多两层、总计24个同源 iframe。保留 iframe、原生播放器、列表、发送区的节点身份和父子关系，不导航或重挂载，不读写媒体源、声音、暂停、清晰度、输入值、消息或账号。
- 核心选择器：`#live-player`、`.chat-history-panel`、`.chat-history-list`、`.chat-input-ctnr`，并校验播放器与聊天在同一section的左右分支、video/textarea唯一。依据来自此前G0同源 `/blanc/数字` 房间的结构采样；不是平台稳定DOM协议，也不承诺所有活动页支持。
- 同时释放 iframe 和房间section祖先的层叠/变换条件，可撤销隐藏路径外普通兄弟区，保留脚本/样式等资源节点。原生播放器控制/弹幕子树整体保留。
- 视频使用16:9区域与 `object-fit:contain`；`chatVisible=false` 时任意正尺寸视口继续contain，包括原生响应布局已把聊天缩成零尺寸的情况。小视口不代表原生菜单已经舒适可用，用户可放大或恢复完整页。
- `chatVisible=true` 时保留完整原生历史与发送分支。原生响应式规则可能在九路小视口把发送祖先隐藏，不能把隐藏前的零矩形当成结构缺失：新版先用同一样式日志可撤销地展开列表、发送与textarea父链，再测实际自然发送高度及历史附加区；不以固定109px或其他最低值代替测量。保留原生历史高度规则，避免把消息内容自然高度当成布局尺寸。
- 应用后及resize时检查聊天、列表、发送区、原生输入直系分支、textarea及父链边界；检查原生输入父链的clientWidth/scrollWidth，存在溢出、越界、零尺寸或仍无法测量时整组撤销。播放器预览至少128px、历史预留至少120px；不够空间返回 `unsupported/insufficient-chat-space`，最终输入几何不合格返回 `unsupported/chat-layout`。不自动缩字、裁输入或隐藏用户选择的聊天来宣称成功。
- `compact=false`、替换版本或重应用之前均dispose旧closure。仅恢复自己仍持有的样式属性及优先级，保留平台后来重新接管的属性；清理观察器、rAF及监听。
- resize、有限结构观察、iframe load、pagehide、原生全屏变化均可触发安全撤销。监听结构父节点的直接childList，不监听消息正文，不做高频全页扫描。可见语义dialog会回退；自定义登录/验证浮层仍可能无法识别，操作前应进入完整原生页。

## 状态与集成

生产状态键：`Symbol.for('live-union.bilibili.presentation.state')`，含版本和dispose；与G0完全隔离。动态结果发布到统一 `Symbol.for('live-union.presentation.result')`，只含固定 `status/reason`。主进程仍须白名单校验，并按房间与generation处理；页面中的Symbol不是安全或验收依据。

状态为 `applied/restored/unsupported/notReady/failed`。`applied/candidate-layout` 仅代表样式操作及相应几何检查完成，不能证明完整游戏画面、无遮挡、真实播放、登录或聊天验收通过。常见退化为 `native-overlay`、`native-fullscreen`、`insufficient-space`、`insufficient-chat-space`、`native-send-geometry`、`chat-layout`、`structure-invalidated`；其他固定错误只表达结构、偏好或恢复失败，不返回页面文本/异常正文。

`.3` 在主文档host发布固定诊断 `Symbol.for('live-union.bilibili.chat-geometry')`，在撤销前保存当次测量/布局失败快照；恢复完整页不会用已回退的矩形覆盖该快照。只含：

- `stage`：`measure/layout/fallback`；`part`：`none/viewport/chat/history-root/panel/list/send-root/input/textarea/input-child/input-ancestor/overflow/structure/overlay`。
- `viewport`：`width/height/chatWidth`；`chat/panel/list/sendRoot/input/textarea`各含 `x/y/width/height/clientWidth/scrollWidth`。
- `inputChildren`最多3组同样的数字矩形；`inputAncestors`从textarea向上最多8组；`inputChildIndex/overflowDepth`以-1表示不适用。
- 数字限制在±1000000，保留两位小数；缺失或非有限值用-1。不返回DOM、选择器属性、URL、文本、账号或异常正文。根诊断读取者仍须固定字段/枚举白名单校验；该不可信页面对象不是权限或验收依据。

主agent报告另一个房间545068在相同272高和320/380px聊天宽度仍回退为chat-layout，现有样本在回退后采集，无法定位失败前哪个分支越界。`.3` 先保留保护并采样，不把持续播放/帧增长或另一个房间的几何成功当成它的聊天通过。272高容器内保留原生滚动列表仍是后续修复目标。

根集成者需要把异步Symbol结果读入已有service并校验；本模块没有修改service、公共接口或根装配。无跨源绕过：找不到可访问的完整房间时返回不支持，保留完整原网页入口。

## 本任务已执行检查

```powershell
node --check src/platforms/bilibili/presentation.cjs
node --check tests/unit/bilibili/fixture.cjs
node --check tests/unit/bilibili/presentation.test.cjs
node --test tests/unit/bilibili/presentation.test.cjs tests/unit/bilibili/export.test.ts
.\node_modules\.bin\tsc.cmd --noEmit
```

实际结果：语法检查与tsc均退出0；17项Node测试全部通过。覆盖冻结导出、偏好重建/状态白名单、同源及直接房间、缺结构/重复/跨源、小视口、原生聊天空间、resize回退、结构失效、全屏/语义浮层、版本替换、幂等撤销与新平台样式保留。新增702×272/320px响应式隐藏祖先回归：发送区和输入开始均为零尺寸，显示原父链后才有自然尺寸；测量后仍零高、横向溢出或textarea越界都必须撤销。诊断回归覆盖撤销前溢出矩形保留、输入子分支固定序号、有限数字/枚举、非有限数据脱敏。fixture只建模有限CSS几何，不计算真实浏览器绘制，媒体、输入和文本敏感属性读写会抛错。

本任务子agent没有运行真实平台、桌面、会话、Electron构建或打包。主agent于2026-11-07 07:43:03 UTC串行复验后提供几何结果：B站7734200房间在九路场景、702×272视口、chatWidth320下，setChat true返回applied；chat/list约320×165，发送祖先约320×107且y165，输入区约288×46且y213，textarea约145×45且clientWidth/scrollWidth均145。所有这些区域在272px高内；**这仅是该房间该时刻的几何复验，没有发送消息，不能据此判IME、实际发送、其他房间或九路整体验收通过**。正式证据由主agent维护。

正式版本下的四角/顶部可见、菜单命中、原生聊天/IME、清晰度、会话、偏好联动、其他B房间/全局九路聊天及持续性能仍待主agent串行实测。此前矩形正确但主站导航遮盖视频的G0问题说明：不能用几何数值或这些纯测试代替可见验证。

需求覆盖：FR05、FR13至FR15、FR20至FR24与NFR03/05/06/08；关联SP05、AT09至AT14、AT24/25/28/29。这是相关实现和离线覆盖，不是全部验收项通过声明。
