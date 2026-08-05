# WorkBuddy 项目接手入口

本文件是接手本项目时唯一必须先读的入口。适用于 WorkBuddy、Codex 或其他协助财务用户使用和修改项目的 Agent。读完本文件后，再按当前任务打开对应文档；不要要求财务用户先理解源码结构。

## 1. 先理解使用者

- 主要使用者是财务人员，不要求理解 Node.js、TypeScript、SQLite、端口或构建目录。
- 用户说“打开、启动、填项目、算一下、导出”时，Agent 应主动完成技术步骤，再用业务语言说明结果。
- 不要让用户在单 HTML、PWA、服务端、数据库格式之间做技术选择；当前正式方式已经固定。
- 操作前先检查真实目录、Git 状态和数据库；不要覆盖用户未提交改动或业务数据。

## 2. 当前唯一运行方式

```text
React 页面
  → 本机 TypeScript 服务
  → 语义化 HTTP API
  → SQLite 文件 data/amoya_project_forecast.db
```

- 当前软件版本：`v0.7.4`，唯一版本源是 `src/package.json`。
- 当前数据结构：Schema v15。
- 正式地址：`http://127.0.0.1:4173/projects`。
- 已删除旧单 HTML、PWA/OPFS 运行入口和浏览器数据库持久化；不要恢复。
- `dist/` 只是 `pnpm build` 自动生成的网页文件，不是源码或数据，可以删除重建，不提交 Git。

## 3. 帮用户启动

普通用户直接双击根目录：

```text
启动项目测算_Windows.cmd       Windows
启动项目测算_macOS.command     macOS
```

开发或排查启动：

```bash
cd src
pnpm install
pnpm start:local
```

局域网模式不是默认启动方式。需要让同一家庭或办公网络中的另一台设备临时访问时，WorkBuddy 必须先向用户确认“是否允许同一网络的其他设备访问项目数据”；只有得到明确同意后，才可以在 `src` 执行：

```bash
pnpm start:lan
```

该模式会同时打印本机地址和局域网地址。同一网络的设备用浏览器打开打印出的局域网地址即可。未获得确认时始终使用 `pnpm start:local` 或根目录启动文件。只允许在可信网络临时开启，使用结束后关闭服务；不要通过公网、端口映射或公共 Wi-Fi 暴露业务数据。

`start:local` 会先构建到根目录 `dist/`，再启动服务并自动打开浏览器。

如果提示找不到 pnpm：

1. 检查是否安装 Node.js。
2. 安装或启用 pnpm；优先使用 Node.js 自带的 Corepack，不能使用时再单独安装 pnpm。
3. 在 `src` 执行 `pnpm install`。
4. 再让用户双击启动文件。

这是一台电脑一次性的环境准备，完成后不应要求财务用户日常使用命令行。

## 4. 数据安全

- 正式业务数据在 `data/amoya_project_forecast.db`，Git 不提交 `.db`。
- 页面保存会实时同步数据库；重要修改、结构升级或交给 Agent 前先使用页面“备份”。备份和恢复统一使用 `amoya_project_forecast.db`，不要改名。
- 服务运行时不要使用其他 SQLite 软件写同一个 `.db`。
- Git 只保护代码，数据库必须单独备份；仅克隆仓库不会带回用户真实数据。
- 临时数据库或验证产物必须带 `TMP to delete`，验证结束主动清理。
- 修改 Schema 前先备份；当前仍是开发阶段，可以重建参考开发库，但不得擅自重建用户真实库。

## 5. 用户业务流程

```text
项目列表
  → 进入项目并选择 Plan
  → 配置参数、收入、成本和收付款事项
  → 保存
  → 计算
  → 检查计算底稿，可保存人工调整
  → 查看项目报告、Excel、打印 PDF 或 AI 分析素材
```

- Project 保存项目编码、项目名称、申报部门和状态。
- Plan 是项目下的独立测算方案，保存起止期间和完整测算配置。
- Scenario 当前固定为“基准场景”。
- 未指定 Plan 时进入排序最前的有效方案；不存在默认 Plan。
- 每个 Plan 只保留最新原始结果、最终事实和一条计算状态；不存在前台 Run 历史。

## 6. 关键计算规则

- 统一行项目类型：参数、收入、成本、其他收款、其他付款。
- 收入、成本预测项必须归属末级指标；收入为两级、成本为三级。父级和成本大类只做递归汇总，不写重复事实。
- 新建项目首个“方案 1”预置 4 条收入和 15 条成本零金额预测项，全部默认不生成现金；新建空白 Plan 不预置。
- 支持固定金额、逐月填写、受限公式、收入“单价 × 数量”和成本“按收入比例”。
- 公式只允许四则运算、括号、百分数、参数引用和其他预测项引用；必须检查缺失、除零和循环依赖。
- 金额统一使用 Decimal.js 和十进制字符串，不使用 JavaScript 浮点数。
- 收入成本以未税金额进入损益事实；含税、未税、免税和收付款规则由共享计算引擎处理。
- 保存配置不写事实；点击“计算”成功后才替换当前 Plan 最新原始事实。
- 人工调整只写 `fact_metric_adjustment`，不回写项目配置，不参与预测公式、税额和自动现金计划。
- 保存人工调整后立即更新最终事实和派生指标，无需再次计算。
- 报告、项目报表和 Excel 必须统一读取 `fact_metric_value`，页面不得另算一套。

完整业务与数据口径见 [`docs/01_产品与数据设计.md`](docs/01_产品与数据设计.md)。

## 7. 代码入口

```text
src/app/                         React 页面与交互
src/server/                      本地服务、语义 API、仓储与事务
src/shared/                      前后端共享类型和确定性计算引擎
src/config/prompts/              版本化 AI 分析提示词
src/config/profitMetricHierarchy.ts 收入成本指标树唯一配置
src/app/storage/sqlite/          当前 Schema 与初始化
src/app/mocks/                   五个参考项目配置
```

重点文件：

- `src/server/index.ts`：本地服务与 `dist/`、`.db` 入口。
- `src/server/semanticApiRouter.ts`：语义化 HTTP 路由；不得恢复通用 SQL API。
- `src/server/projectWorkspaceService.ts`：项目工作区聚合保存和读取。
- `src/server/services/calculationService.ts`：计算、人工调整和最终事实事务。
- `src/shared/calculation/`：公式、预测、税、现金和指标的唯一计算实现。
- `src/config/profitMetricHierarchy.ts`：4 个收入分类、5 个成本大类和 15 个成本末级分类；页面不开放维护，需要由 WorkBuddy 修改并重新构建。
- `src/app/pages/ProjectWorkspacePage.tsx`：项目配置、底稿、报告和操作指引。
- `src/app/pages/MultidimensionalViewPage.tsx`：跨项目项目报表。
- `src/shared/reporting/pivotLayout.ts`：项目报表页面与 Excel 共用的多级表头合并规则。
- `src/server/services/pivotWorkbookService.ts`：项目报表所见即所得 Excel。
- `src/app/components/FinancialGrid.tsx`：统一财务表格选区、复制和粘贴。
- `src/server/services/reportPresentationService.ts`：页面和 Excel 共用报告模型。
- `src/server/services/reportWorkbookService.ts`：固定两表 Excel。
- `src/config/prompts/ai-analysis-prompt-v1.md`：AI 素材功能当前唯一提示词正文。

旧单 HTML 专用的 `LegacyApp`、前端仓储和 OPFS Worker 已删除。不要重新建立前后端两套仓储或两套计算逻辑。

## 8. UI 与产品约束

- 面向财务人员，默认 12–16px，紧凑、清晰、少层级，避免 IT 管理后台术语。
- 项目工作区固定为“项目配置—计算底稿—项目报告”。
- 项目工作区第一行将测算方案及方案操作固定右对齐，“指引”以无边框链接放在“方案对比”右侧并以分割线区隔；不常显无交互的场景文案。第二行左对齐切换三个页面，保存状态与当前页面操作固定右对齐。
- 项目配置使用一张统一行项目表，选中行后右侧挤压抽屉编辑。
- 逐月填写直接在主表黄色单元格中完成，支持 Excel 区域粘贴。
- 计算底稿允许调整基础叶子值；汇总、规则现金和派生指标只读。
- 项目报表是只读多维视图，背景、行轴和列轴支持维度卡片拖拽、成员选择和多级合并表头；方案可显示为“项目（方案）”或“仅方案”。项目内“方案对比”默认使用完整指标树，列轴按“年度 → 方案”展开，当前视图可直接下载 Excel。
- 项目报告遵循 V3.1 业务报告故事线；Excel 固定为“测算报告、月度明细”两张表。
- 工具不调用 AI；只导出版本化提示词和身份脱敏 Excel。财务数值仍是真实数据，必须保留风险提示。
- 左侧品牌名称为“项目测算”，红色 B 标识同时承担侧栏展开/收起；软件版本取自 `src/package.json`。
- 展开侧栏固定为 188px，收起为 54px；窄窗口不得挤压侧栏及本地数据库卡片。
- 主数据和指标管理表支持拖动表头分隔线调整列宽，设置只保存在当前浏览器，不写数据库。

## 9. 修改与验证

开始工作：

```bash
git status --short
```

结束前至少执行：

```bash
cd src
pnpm test
pnpm build
```

- UI 小改可在构建通过后做目标页面检查；计算、Schema、导出和数据变更必须运行相关测试。
- 浏览器自动化结束后关闭 browser/context，并清理 Playwright/Chrome for Testing 残留。
- 新功能或修复递增 `src/package.json` 第三位版本号，页面从这里读取，不另写死。
- 提交说明使用中文。
- 更新当前结论时只维护精简后的三份文档，不重新创建逐阶段重复契约和验收文件。

## 10. 文档入口

- [`README.md`](README.md)：项目简介和运行入口。
- [`docs/01_产品与数据设计.md`](docs/01_产品与数据设计.md)：当前产品、数据和计算口径。
- [`docs/02_开发状态与验收.md`](docs/02_开发状态与验收.md)：当前完成状态和验收原则。
- [`docs/03_项目交接与使用.md`](docs/03_项目交接与使用.md)：财务用户与 WorkBuddy 交接说明。
- `docs/04_需求素材/`：六份历史交付文件和 V3.1 业务样例，只作需求、回放和输出样式证据，不作为当前代码契约；不要按原型中的旧字段覆盖当前实现。
