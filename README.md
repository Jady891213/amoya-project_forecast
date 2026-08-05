# 项目测算分析工具

面向财务人员的本地项目测算、计算底稿和报告工具。

当前版本：`v0.6.0`

当前数据结构：Schema v14

## 普通用户启动

双击根目录中与当前系统对应的文件：

```text
启动项目测算.cmd       Windows
启动项目测算.command   macOS
```

浏览器会自动打开 `http://127.0.0.1:4173/projects`，页面数据实时保存到：

```text
data/amoya_project_forecast.db
```

第一次使用需要安装 Node.js 和 pnpm，并在 `src` 执行一次 `pnpm install`。不熟悉技术操作时，让 WorkBuddy先完整阅读根目录 [`AGENTS.md`](AGENTS.md) 并协助完成。

## 当前能力

- 项目与多 Plan 测算方案。
- 业务参数、收入、成本和其他收付款事项。
- 固定金额、逐月填写、受限公式、单价数量和收入比例。
- 含税/未税口径及收付款计划。
- 实时预览、保存、计算和最新结果。
- 可追溯人工调整和计算底稿。
- 单项目业务报告与跨项目多维项目报表。
- V3.1 两表 Excel、打印 PDF 和身份脱敏 AI 分析素材。

## 目录

```text
amoya-project_forecast/
├── AGENTS.md                 WorkBuddy 唯一必读交接入口
├── README.md                 本说明
├── 启动项目测算.cmd           Windows 启动
├── 启动项目测算.command       macOS 启动
├── src/                      完整源码、服务、测试和依赖配置
├── data/                     SQLite 业务数据库
├── docs/                     精简后的当前文档和必要需求素材
└── dist/                     自动生成的网页构建
```

`dist/` 可以删除重建，不是源码或数据，也不提交 Git。

## 开发命令

```bash
cd src
pnpm install
pnpm start:local
pnpm test
pnpm build
```

## 文档

- [产品与数据设计](docs/01_产品与数据设计.md)
- [开发状态与验收](docs/02_开发状态与验收.md)
- [项目交接与使用](docs/03_项目交接与使用.md)
- [原始需求素材](docs/04_需求素材)

业务数据库不提交 Git。升级源码、修改 Schema 或让 Agent 批量处理数据前，请先在页面中执行“备份”。
备份下载与恢复统一使用文件名 `amoya_project_forecast.db`；恢复时可拖入文件或从电脑中选择。
