# 工程建设第三方检测项目管理系统

这是一个面向第三方工程检测业务的单用户内部管理系统，用于把日常工作记录、合同单价和人员产值结算串起来。

当前仓库不是通用“项目管理系统”模板，真实业务方向已经收敛为：

- 工作日志导入与清洗（支持 WPS 粘贴与文件解析）
- 合同上传、多模型识别（OCR/视觉/文本处理）与单价清单入库
- 模型入口网关配置与任务路由（支持 OpenAI 兼容与 GLM-OCR）
- 人员 / 项目 / 内部指导价主数据管理
- 产值统计、报表导出
- 本地 SQLite 数据备份

## 文档入口

为了便于在多个开发工具之间切换，文档按“规划”和“实现”分层管理：

- 产品需求稿: [docs/requirements.md](docs/requirements.md)
- 交互设计稿: [docs/interaction_design.md](docs/interaction_design.md)
- 当前实现架构: [docs/architecture.md](docs/architecture.md)
- 当前 API 参考: [docs/api_reference.md](docs/api_reference.md)
- 应用启动与开发说明: [src/README.md](src/README.md)

推荐阅读顺序：

1. 先看本文件，理解工作区布局
2. 再看 `src/README.md`，确认如何启动和验证
3. 再看 `docs/architecture.md` 和 `docs/api_reference.md`
4. 做产品层改动时，再回到 `docs/requirements.md` / `docs/interaction_design.md`

## 工作区结构

```text
.
├─ README.md                  # 工作区入口说明
├─ docs/                      # 产品文档与实现文档
├─ contracts/                 # 已上传合同文件存档
├─ backups/                   # 数据库备份快照
├─ test file/                 # 样例文件与实验数据
└─ src/                       # 实际 Next.js 应用
   ├─ README.md               # 应用级开发说明
   ├─ package.json
   ├─ prisma/                 # 数据库和 schema
   ├─ config/                 # 运行时配置（模型网关配置等）
   ├─ public/
   └─ src/                    # App Router 与业务代码
```

## 当前已实现模块

- **仪表盘**：首页汇总人员、项目、工作记录、合同和最近备份，包含产值预估等视图
- **工作记录**：支持粘贴 WPS 表格文本并自动解析入库，工作详情自动匹配
- **合同管理**：支持上传 PDF / Word / 图片合同，通过统一模型网关调用多模型流水线（OCR预处理 + 视觉/大语言模型提取）
- **模型 API 管理**：UI界面维护多套模型提供商（OpenAI compatible 及 GLM-OCR），配置具体任务调度
- **主数据管理**：人员、项目、内部指导价维护
- **报表**：按人员 / 项目汇总产值，支持 Excel 数据导出
- **备份**：创建 SQLite 快照并下载历史备份

## 当前系统边界

- 单用户、本地使用，无登录鉴权
- 数据库为 SQLite
- 产值匹配目前依赖检测项名称的精确与模型智能匹配 fallback
- “标准规范联动预警”仍属于规划项，尚未落地

## 多工具协作约定

为了避免不同工具读到不同上下文，建议统一遵守以下约定：

- 需求层决策以 `docs/requirements.md` 为主
- 实现层事实以 `src/README.md`、`docs/architecture.md`、`docs/api_reference.md` 为主
- 修改数据库、接口、目录结构时，同步更新上述实现文档
- 新增业务能力时，在文档中明确“已实现 / 规划中 / 已废弃”
- 涉及运行时目录时，明确区分工作区根目录和 `src/` 应用目录
