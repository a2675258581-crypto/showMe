# showMe · 开发者百宝箱

个人开发者工具站：Vite 8 + React 19 + TypeScript + Tailwind CSS 4 + motion。苹果官网风格界面，中文 UI（字符串直接写死）。
除「API 调试」走本机代理外，所有工具 100% 在浏览器本地运行，不上传任何数据。

## 常用命令

- `npm run dev` 开发服务器（含 `/__proxy` 本地代理）
- `npm run typecheck` / `npm run lint` / `npm test`（vitest，覆盖 `src/lib` 与 `server`）
- `npm run build && npm run preview` 生产构建预览（同样带 `/__proxy`）
- `npm run e2e` Playwright 冒烟测试（Chromium 在 `/opt/pw-browsers`，不要 `playwright install`）

## 目录约定

- `src/tools/registry.ts`：所有工具的唯一登记处（id、名称、分类、关键词、图标、懒加载组件）。
- `src/tools/<id>/index.tsx`：工具页面，**默认导出**组件。只写工具主体——标题、图标、面包屑、收藏由 `pages/ToolPage.tsx` 统一渲染。工具私有的子组件放在同目录。
- `src/lib/*.ts`：纯逻辑（不依赖 React/DOM，能在 Node 里跑），每个模块配 `*.test.ts`。参考实现：`lib/case.ts` + `tools/case-converter`。
- `server/`：Node 端代码（`/__proxy` 转发），`proxy-handler.ts` 与框架无关。
- 路径别名 `@/` → `src/`。

## UI 约定（保持苹果风格一致）

- 组件从 `@/components/ui` 引入：`Button`（胶囊，variant primary/secondary/ghost/danger/outline，size sm/md/lg）、`SegmentedControl`（iOS 分段）、`Switch`、`Select`、`Input`/`TextArea`（`mono`）、`Field`、`Panel`/`PanelHeader`、`CopyButton`、`Tabs`、`Slider`、`Notice`/`ErrorNotice`、`DropZone`、`Badge`/`Kbd`、`useToast()`。
- 编辑器：`@/components/editor/CodeEditor`（CodeMirror，`lang` 按需加载）；输入/输出双栏用 `@/components/editor/IOPanel`（自带粘贴/示例/清空/交换/复制/下载/拖入文件与错误提示），自定义布局用 `EditorPane`。
- 颜色只用设计 token：`bg-bg / bg-surface / bg-surface-2 / bg-fill / text-fg / text-fg-2 / text-fg-3 / border-line / text-accent / bg-accent / text-danger / text-success / text-sys-*`。不要写死 `#fff`、`gray-500` 之类，否则深色模式会坏。
- 卡片：`rounded-3xl border border-line bg-surface shadow-card`；小块 `rounded-2xl`。等宽内容加 `font-mono`。
- 动画用 `motion/react`，弹簧优先；全站已包 `MotionConfig reducedMotion="user"`。
- 不要 `console.log`；出错显示在 `ErrorNotice` 里，不要抛出未捕获异常。
- 不使用苹果的 Logo、字体文件或商标文案；字体用系统字体栈。

## 依赖

依赖已在 package.json 中装好（prettier + 插件、sql-formatter、js-yaml、fast-xml-parser、papaparse、cronstrue、cron-parser、hash-wasm、crypto-js、jose、diff、marked、dompurify、qrcode、jsqr、cmdk、lenis…）。新增依赖前先确认现有库不能满足。
