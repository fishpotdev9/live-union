# 虎牙展示适配器 2026.11.08.2

入口为 `index.ts` 的 `adapter:PlatformPresentation`，静态依赖同目录 `presentation.cjs` 和 `presentation.d.cts`，没有 spikes 路径或运行时文件加载。主进程将 `adapter.build(prefs)` 的固定脚本交给对应虎牙主文档执行；页面不获得本地文件、IPC或Node入口。生产诊断在 `Symbol.for('live-union.presentation.result')`，状态只使用 OperationResult 枚举，原因来自下表固定集合。诊断由不可信网页产生，不能作为权限依据或真实兼容性通过证据。

## 整理与边界

播放器、原生聊天列表和发送框始终留在原生文档/原父节点。命名style负责几何及已保留祖先黑色底；原生控制条尺寸/定位，以及独立的opacity/pointer-events/透明背景按属性记录并可恢复。原生display/visibility保持自然行为，不再强制display。撤销时移除自有style，仅恢复仍由适配器持有的属性；原生回写更新恢复基线。不调用媒体控制、导航、登录、清晰度、声音、弹幕或发送API，不读取文本、输入值、凭据或消息。

`#J_playerMain`、`#J_roomPlayerLayer`、`.player-wrap`、`.room-core`、`#chatRoom`、`#chat-room__list` 是当前识别入口。完整聊天根由列表与唯一原生输入框的最低共同祖先确定。礼物条识别源于已实测G0同父结构：stage之后唯一24..54px原生控制分支，再之后唯一56..96px礼物分支；还验证宽度、非媒体/非输入和其他分支是否存在可见歧义。允许额外零尺寸分支、不同总分支数和子节点数；不再要求15/9/4。歧义则完整页回退，不隐藏未知分支。此结构判断仍需更多真实房间验证，尺寸/顺序不是平台公开协议。

视频完整使用可用高度按实际比例（未知时16:9）contain，取消60px永久预留。控制条为活动时临时叠层，空闲不占游戏高度。聊天关闭最低尝试180×120 CSS px；聊天打开仍要求用户宽度至少320，`.5`允许剩余播放器预览宽至少128，高度按原生发送分支/输入框实际高度加80px列表预算预检；允许524×272副框保留340px原生聊天与完整预览。完整聊天/列表/发送区域/横向溢出仍有后置校验；不自动收起聊天或改变字号、质量。

空闲控制条opacity为0且pointer-events为none（含自有样式覆盖子树），鼠标活动、底部悬停、原生焦点或拖动时恢复，1600ms无活动后收起。静止在视频中部不会永久hold；指针离开整个player会清悬停状态。SDK进度/样式更新不延长idle；相同CSS不重复写入。焦点/拖动/原生hover保持显示；菜单只查固定语义及有限可见几何，排除聊天、隐藏/透明节点和祖先。菜单存在时单个计时器继续等待关闭；外部点击/Escape可释放菜单hold，不吞事件或改变焦点。未知的无语义外置portal仍需实际验证；保留完整原页入口。

窄房间保留完整原生控制树，原生菜单可能需要房间放大；宽不足原生条初始宽度或高度不足300，或平台自然隐藏控制条时，返回 `applied / controls-need-zoom`。自然display:none/visibility:hidden不消耗几何修复预算，也不以零rect宣称失败。可见控制条仍须在本房间底部规定区域内，视频须严格完整contain；新的验收不变量是“完整画面+明确临时overlay+idle透明且不拦截”，不是删除原来的位置保护。已确认空60px占位仅取消底色/边框/命中，不删除节点。窄菜单完整可用性待真实验证。

resize及媒体本身的尺寸变化按帧合并；不足尺寸、目标移除或索引选择器路径变化会清理style/观察器/监听器，并同步把诊断更新为unsupported。pagehide清理并记录restored。重复安装先撤销上一版本，旧回调不能覆盖新状态。原生消息变化不读取正文、不会触发整页扫描或重排。

| 状态 | 固定原因 |
| --- | --- |
| applied | 无原因，或 `controls-need-zoom` |
| restored | 无原因，或 `page-hidden` |
| notReady | `document-not-ready`、`player-not-ready`、`input-not-ready` |
| unsupported | `invalid-preferences`、`style-collision`、`structure`、`player-structure`、`chat-structure`、`chat-too-narrow`、`structure-changed`、`space`、`layout`、`chat-layout` |
| failed | `layout-error` |

## 检查与未验证

单元测试位于 `tests/unit/huya/`，包含固定脚本构建、恶意/异常偏好、非16:9与小视口contain公式、额外惰性分支及歧义拒绝、聊天不自动改变、重复撤销、resize失败诊断、结构变化、迟到回调与观察器安装失败清理。测试的DOM模型只验证脚本状态/资源和生成样式，不是浏览器布局引擎，更不是平台样本测试。fixture禁止读取消息及输入内容。

实际完成：`node --check src/platforms/huya/presentation.cjs`、`node --test tests/unit/huya/presentation.test.cjs tests/unit/huya/export.test.ts`、项目 `npm run typecheck -- --pretty false`，以及esbuild `bundle:true,write:false`静态打包。首次受沙箱限制的esbuild读目录失败，改为获准只读构建后成功；没有新增依赖、构建输出文件或运行窗口。

生产容器仍需主agent串行验证：多个真实虎牙房间、220×140/180游戏四边无遮挡、放大后全部原生控制与菜单、聊天开关/宽度/输入法及用户发送、完整原页和登录浮层、清晰度切换重建video后的安全恢复、页面改版、DPI、声音/导航计数不变。`applied`与rect仅是当次整理结果，不能据此宣称AT11或三平台P0通过。

`.2`增加 `Symbol.for('live-union.huya.geometry')`，仅用于主agent受限检查：`{viewport:{width,height},stage:{x,y,width,height},video:{x,y,width,height},controls:{x,y,width,height}}`。它在实际布局校验前取值，因此即使随后unsupported/layout并撤销style，仍保留这次失败前的数值，便于定位原生偏移/变换或异步尺寸问题。只发布有限、绝对值不超过1000000的数字，不发布DOMRect对象、属性、正文、账号或URL。新整理尝试/显式恢复清除旧快照；读取方仍须过滤固定schema，不能信任网页诊断作为权限或验收证据。本版本没有猜测九路失败原因、改变几何或放宽布局保护；真实九路仍待定位和复验。

`.3`依据主agent九路focus→equal采样修复两个已定位问题：44.000003px控制条高度使用0.01px误差容差，避免ceil每次加1；控制条旧702/703px inline!important宽度改由可恢复属性约束实际viewport。仅观察控制条自身style变动，每个实际viewport最多3次修复；持续竞争则严格unsupported/layout并撤销，不能为保持applied而放宽width校验。小于0.01px的SDK反馈不消耗修复预算。新增可选 `geometry.controlsStyle`：`computedWidth`、`minWidth`、`inlineWidth`只取parseFloat后的有限数字（非数值CSS值不输出该键），`inlineImportant`仅布尔；不输出raw style。主agent需同步inspection白名单。离线回归覆盖30轮连续重present/376×191与703×272切换、高度不增长、原生重要宽度覆盖及撤销、有限修复和702×272聊天预算；真实修复效果仍需生产容器复验。

`.4`依据07:56:54真实采样修复控制条宽高正确但Y=168、覆盖212px视频的独立定位问题：控制条改用显式 `top=viewportHeight-controlsHeight`，并可恢复地约束position/left/right/top/bottom/transform，避免遗留bottom:60px或translateY(-60px)与视频重叠。属性观察同时检查实际x/y；原有不重叠校验不变。诊断额外输出 `computedPosition`（static/relative/absolute/fixed/sticky/other固定枚举）、可选有限数字computedTop/computedBottom/inlineTop/inlineBottom、transformX/transformY（computed matrix/matrix3d的有限平移，none为0）；不输出原始CSS或矩阵字符串。离线测试模拟错误important定位/变换、严格还原和最新原生基线恢复，并确认即使宽高正确，残余containing-block偏移仍被拒绝。实际生产效果仍由主agent串行复验。

同次138297采样还确认stage同父15分支中的控制条和礼物条全部display:none。`.4`对这个状态仅采用严格例外：15分支、stage第1且9子、唯一控制条第3且9子、唯一礼物条第5且4子、两者原本display:none、无video/input；短暂记录/修改/恢复display以测自然高度，仍要求24..54px控制条和56..96px礼物条。测量不符恢复并unsupported，实际展开只保留原生控制条，礼物条继续收起；任一未识别可见peer仍拒绝。正常可见分支不再以过期父宽的0.8比例识别身份，仍用唯一高度/顺序/包含关系及后置真实矩形校验。没有加入state.update或重用生命周期变更，也没有将原生暂停归因为确定的软件行为；这些继续由主agent实测。

覆盖实现/离线准备：FR05/13/15/20/21/22、NFR03/05/06/08，AT09/11/12/13/24/25。FR23–28继续交由原生页面和用户流程，登录/发送/权益/会话未由本模块新增或验证。

`.6`对常驻灰/白底问题采用上述最小临时叠层策略。geometry.controlsStyle新增overlay/shown/nativeVisible三个布尔状态，公共APP/Runtime/PlatformPresentation接口仍1.0，诊断读取者应继续固定白名单。新增离线回归：进度mutation不推迟idle、同shown连续pointermove不重建CSS、离开整房清底部悬停、hover/焦点/滑杆拖动/原生菜单保持、隐藏及聊天菜单排除、native display自然变化、全部timer/listener/背景撤销和旧计时器隔离。只运行Node单测与类型检查，本轮没有启动Electron、控制桌面、读取会话或增加依赖。根agent需在用户允许的窗口串行证明真实灰白块消失、活动再现、清晰度/弹幕菜单、完整原页、布局无导航且音频不变；本说明不表示真实验收通过。

可见性竞争与几何竞争分别有每实际viewport最多3次修复预算。正常pointer/focus活动不消耗预算，同值原生opacity回写不视为竞争；native display/visibility隐藏完全不参与争抢。持续修改opacity/pointer-events/背景造成冲突时撤销并unsupported/layout，清理所有timer/listener/observer，不持续写inline造成反馈循环。本轮实际通过33项虎牙目标单测、`node --check`及项目typecheck；离线DOM模型不证明真实CSS命中、半透明背景或无语义portal表现。

`.7`针对根agent独立隐藏Chromium fixture已复现的机制，先可恢复地设置控制条根的 `transition-property:none!important` 与 `animation-name:none!important`，再写自有opacity/背景/pointer-events。仅接管这两个长属性，不改transition/animation shorthand、duration、timing或子控件动画；完整原页准确恢复原长属性值和优先级。真实dev.3失败几何与此机制相符，但尚未证明虎牙线上CSS的具体transition值。保留同步opacity必须为0，另外以底部三个固定点 `elementFromPoint` 检查不能命中controls子树；失败仍撤销，未放宽idle透明/命中不变量。

诊断 `geometry.controlsStyle` 新增可选 `computedOpacity`（有限0..1）与 `idleClickThrough` 布尔；不返回命中元素、正文、原始CSS或任何账号数据，跨进程仍由root白名单过滤。新增VM回归模拟该已由Chromium复现的插值机制、混合priority的长属性恢复、子控件动画不改及透明但实际命中控件时拒绝；35项目标单测通过。这些VM检查仍不是浏览器或平台通过记录；原生Chromium fixture由主agent运行，本agent没有启动Electron/桌面/会话，真实灰白条和菜单等待许可后复验。

主agent随后已执行隐藏离屏Chromium对照：有/无0.3秒transition的真实computed opacity、命中、活动/闲置与原样恢复均通过。dev.4源码于20:46–20:50 JST经用户允许桌面复验：三间虎牙九路闲置无灰白条，257085放大后原生清晰度菜单与弹幕滑杆可用，不透明度80→48→80并精确还原，WC/导航/静音保持。早期启动仍出现暂时回退，未覆盖所有页面变体/聊天开启/窄菜单/DPI；dev.4独立包与长时性能未验。主记录为docs/evidence/integration/2026-11-07-huya-idle-controls.md，包含首版真实失败，不以本轮窄项通过替代P0。

## 2026.11.08更新

`.1`修复真实340204鼠标移入后原生bottom回写被误计为几何竞争：right/bottom只有在实际锚定矩形仍正确时不计冲突，其他属性仍检查；实际rect容差与原最终后检一致为1 CSS px，最终contain/overlay/idle保护不变。H.1/dev.6真实悬停和清晰度菜单通过，但布局重呈现另有player-structure，保留失败。

`.2`有效同版本compact更新保留已确认原生节点、style、observer/listener及计时器；检查原路径/包含、唯一video/input、当前分支顺序与未知可见peer，再应用布局。不会为了重新present而撤掉样式、重猜已隐藏bar。真实结构变化、invalid/完整原页/版本变化仍完整清理；重复更新不重置竞争预算或延长idle。聊天显示后重新测量真实input/发送分支及空间预算，原生仍零高度时明确回退。

43项目标单测及全341通过；增强隐藏Chromium对比H.7 hover失败/H.1重呈现失败/H.2通过，且验证初始隐藏聊天、同状态资源与清理。dev.7只生成独立候选，真实桌面复验用户已推迟，当前release仍dev.6。匿名冷启动仍有player-structure，未通过完整平台兼容。完整过程和哈希见`docs/evidence/integration/2026-11-08-huya-hover.md`。
