# 建筑师专属工作台 ArchWorkbench v2.1.0
面向建筑师全流程的 AI 智能体桌面工作台（简体中文）。15 个智能体，覆盖方案设计、初步设计、施工图设计、施工配合、竣工五阶段（详见 docs/01-规划.md）。

## Windows 使用
- 便携版：双击 `ArchWorkbench-Portable-2.1.0.exe`（免安装）
- 或解压 `ArchWorkbench-win-x64.zip`，运行 `ArchWorkbench.exe`
## 浏览器预览
直接用 Chrome/Edge 打开 `src/index.html`。
## 源码运行
```
npm install
npm start            # 桌面版
npm test             # 自动化测试（需先 npx playwright install chromium）
npm run dist:win     # 打包 Windows
```
## AI 接口
工具 → 设置：选择"调用 AI 接口"，填写 Endpoint（如 https://api.deepseek.com/v1、http://localhost:11434/v1）、API Key、模型。未配置或调用失败时使用离线模拟，结果标注【模拟输出】。
文档见 docs/，截图见 screenshots/。

## v2.0 变更
专业桌面 UI（菜单/工具栏/阶段树/标签/属性/输出问题面板/状态栏）；15 个对齐国内设计院实务的智能体；本地 Remix Icon 图标（无 emoji）；Word/MD/CSV 交付；20 个端到端用户故事测试。

## v2.1 变更
无边框标题栏与窗口控制、命令面板（Ctrl+K）、设计令牌体系、骨架屏与流式输出、Toast、文档卡片、分组表单与即时校验、总览 KPI 与阶段时间线、键盘导航；40 个自动化测试。

## v2.2：AI 主导，人工确认
- **AI 自动推进**（Ctrl+P）：
  - 从任务书到竣工验收共 11 步，由 AI 依次填写参数、调用规则工具、生成成果，并给出下一步建议。
  - 人工在检查点确认签字，或写明意见后退回 AI 重做。
- **AI 填写 / AI 草拟**：任一智能体都可以由 AI 起草，规则引擎负责编号和校验。
- **AI 助手**（Ctrl+L）：常驻对话面板，自动带入项目上下文。
- **接入 DeepSeek 等 OpenAI 兼容接口**：在"AI 设置"中选择服务商预设并填写 API Key。支持 SSE 流式输出、首字超时，失败时自动回退。

## v2.3 可用性
- 更紧凑的层级与粘性主操作；打开智能体可自动 AI 填写（可关）。
- 记住上次项目/智能体；资源管理器含阶段轨道与「最近」；状态栏常驻流水线进度。
- 标签溢出菜单与拖拽排序；命令面板「最近」分组；Ctrl+1…9 / Ctrl+Z / Ctrl+Shift+F。
- 记录多选批量闭合/删除，破坏性操作可撤销。

## v2.4
- 院标 `.docx` 导出与 10 套空模板（工具 → 院标 Word 模板）。
- 预载成都中学示例项目；首次启动新手引导。
- Windows 便携版带自定义图标。
