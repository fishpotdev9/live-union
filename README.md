# Live Union

Windows 多平台直播工作台。在同一个窗口混合观看虎牙、斗鱼和哔哩哔哩直播，保留平台原生播放器、登录和聊天。

**当前是开发测试版，尚未完成正式版验收。** 已知问题和验证范围见[兼容性说明](docs/compatibility.md)。

## 功能

- 按实际添加/关闭自然支持不同房间数量，没有固定4/8/9路模式。
- 等大、1主多副和自由编辑；拖动、缩放、重叠、置顶和临时放大保持运行实例。
- 每间独立发声/静音、独听、多路发声和全部静音，声音选择独立于布局。
- 每间原生聊天侧栏独立开关，保留原生发送框及飘屏弹幕；空间不足时可恢复完整原网页。
- 保存组合与布局；历史记录支持平台/主播昵称/房号/URL搜索、点击添加和已开实例定位。
- 主播昵称显示在历史和房间标题，公开信息暂不可用时回退房号。

应用在本机运行，无自建账号、云后端、AI运行依赖或直播流转发。登录和验证码在平台自己的页面完成。本项目不自动发送消息、关注、送礼或付款。

## 使用已构建的Windows包

发布后的程序包可从[Releases](https://github.com/fishpotdev9/live-union/releases)下载。解压整个文件夹后运行`Live Union.exe`，保留所有相邻文件。当前文件夹包未签名，没有安装器或自动更新。

平台账号、房间配置和历史保存在本机应用数据目录。它们不随程序分发，不应上传到Issue或仓库。新添加房间默认静音。

## 从源码运行

已测试目标：Windows 11 x64，Node.js 24.12或更高的Node.js 24版本，npm。

```powershell
npm ci
npm run runtime:prepare
npm run runtime:install
npm run typecheck
npm run test:unit
npm run build
npm start
```

Electron运行时需要单独准备；不要假设`npm ci`已经下载完成。准备脚本只下载固定官方Windows x64 ZIP并核对SHA-256。网络受限时，可手动下载官方原始ZIP，然后执行：

```powershell
npm run runtime:prepare -- C:\Downloads\electron-v45.2.3-win32-x64.zip
npm run runtime:install
```

构建Windows文件夹包：

```powershell
npm run build
npm run package:check
npm run package
```

运行`release/Live Union-win32-x64/Live Union.exe`。完整源码与构建说明见[SOURCE_CODE.md](SOURCE_CODE.md)。

## 测试范围

```powershell
npm run typecheck
npm run test:unit
node scripts/test-package.cjs --hidden --quick
```

包测试使用隐藏窗口、独立临时数据和生成的本地无音轨页面，不读取日常浏览器会话。它验证原生容器、界面和存储流程，不能代替三平台真实账号、播放、发送或九路长时性能验证。`--public-nickname`是显式启用的公开昵称接口检查，会访问指定官方房间的匿名元数据。

## 贡献与问题

请先阅读[贡献说明](CONTRIBUTING.md)。报告故障时提供版本、平台、公开房号、复现步骤及预期/实际结果；不要上传Cookie、令牌、二维码、账号信息、聊天正文或整个浏览器数据目录。敏感问题处理见[SECURITY.md](SECURITY.md)。

## 许可证

Copyright (C) 2026 fishpot9。

本项目原创源码采用 **GNU GPL第3版，仅第3版（GPL-3.0-only）**。分发受其约束的修改版本时应保留许可并提供相应源码，完整条款见[LICENSE](LICENSE)。第三方组件保持各自许可，见[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

本项目独立于各直播平台，不表示平台授权、合作或背书。
