# showMe for Mac

纸感极简的原生 macOS 文本编辑器，底部抽屉里装着 36 个开发者小工具。SwiftUI + AppKit，不套网页。

- **编辑器**
  - 每个文件一个标签页。
  - 自动识别编码（UTF-8 / UTF-16 / GB18030）和换行符，保存时原样写回。
  - 语法高亮，⌥⇧F 格式化。支持 JSON、XML、JS/TS、CSS/SCSS/Less、HTML/Vue、Markdown、YAML、GraphQL、SQL。
- **自动留存**：没保存的内容随时写进会话存档。直接退出 App，下次打开原样恢复。
- **工具抽屉**：选中一段文字，按 ⇧⌘T 交给工具处理；没有选区时处理整篇文档。结果可以复制、替换选中内容，或在新标签页打开。⌘K 搜索全部工具和命令。
- **中文 / English**：在设置（⌘,）或 ⌘K 里随时切换，无需重启。
- **外观**：跟随系统的浅色 / 深色，有 4 种强调色可选。

## 安装

需要 macOS 14 或更新版本，以及 Xcode（或 Command Line Tools）。

```bash
git clone https://github.com/a2675258581-crypto/showMe.git
cd showMe
macos/scripts/build-app.sh --install   # 构建并复制到「应用程序」，然后打开
```

只构建、不安装：`macos/scripts/build-app.sh`，生成的 App 在 `macos/build/showMe.app`。
加 `--universal` 会同时编出 Apple 芯片和 Intel 两种架构，这需要完整的 Xcode。

GitHub Actions 每次推送都会构建一份通用版本，作为构件 `showMe-macOS` 上传。
从网页下载的 App 没有开发者签名，第一次打开要先去掉隔离标记：

```bash
xattr -dr com.apple.quarantine /Applications/showMe.app
```

## 开发

```
macos/
  Package.swift
  Sources/
    ShowMeCore/   纯逻辑，只依赖 Foundation，Linux 上也能编译测试
      Foundation/   有序 JSON、双语文案、脚本引擎接口
      Editor/       语言识别、语法高亮、编码与换行、字数统计
      Crypto/       MD5 / SHA 系列 / HMAC / AES / DES（纯 Swift）
      Tools/        36 个工具：ToolSpec 描述字段与运行逻辑，界面自动生成
    ShowMe/       macOS App（SwiftUI + AppKit）
      App/          入口、设置、菜单、纸面配色
      Workspace/    标签页、打开保存、会话存档
      Editor/       NSTextView 编辑器、标题区
      Views/        顶栏、工具抽屉、⌘K 面板
      Tools/        需要整页界面的工具：API 调试、二维码、图片
      Engine/       JavaScriptCore 引擎（prettier 等）
  Resources/      Info.plist、图标、engine/showme-engine.js
  engine/         JS 引擎源码：npm run build:engine 重新打包
  scripts/        build-app.sh、test-linux.sh
```

- **测试**
  - macOS 上运行 `cd macos && swift test`。
  - 没有 Mac 时运行 `macos/scripts/test-linux.sh`，用 Docker 里的 Swift 6.2。
- **新增工具**
  1. 在 `ShowMeCore/Tools/` 里写一个 `ToolSpec`：字段、输入方式，以及 `run`（纯函数，返回 `ToolResult`）。
  2. 把它加进对应批次的 `all`。抽屉里的表单和结果展示都会自动生成。
  3. 所有文案用 `LocalizedText("中文", "English")` 或 `input.t("中文", "English")`。
- **格式化引擎**
  - `engine/engine.js` 打包了 prettier、sql-formatter、js-yaml、marked 和 cronstrue。
  - 改动后在仓库根目录运行 `npm run build:engine`，产物 `Resources/engine/showme-engine.js` 要一起提交。
