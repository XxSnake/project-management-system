# 工程建设第三方检测项目管理系统

语言：中文 | [English](README.en.md)

这是一个面向工程建设第三方检测业务的内部管理系统，用来把工作日志、合同、项目、人员和产值统计放到同一个流程里管理。

它不是通用项目管理模板，而是围绕检测机构的日常工作搭建：从导入工作记录，到识别合同价格清单，再到分配产值、处理异常、导出报表。

## 主要功能

- **工作日志管理**：支持粘贴 WPS 表格文本，也支持上传 Excel 文件；系统会解析工作内容、项目、人员、数量等信息。
- **合同管理**：支持上传 PDF、Word、图片等合同文件，识别合同基础信息和价格清单，并保存到系统中。
- **项目管理**：维护项目、合同关联、子项目、单体工程、项目合并和项目整理。
- **项目审查入口**：集中处理待确认事项，包括疑似重复项目、无合同项目、异常工作记录和批量分配。
- **人员与价格管理**：维护人员、内部指导价和合同单价。
- **产值统计**：按人员、项目、日期等维度统计产值，并支持导出 Excel。
- **模型配置**：支持配置 OpenAI 兼容接口和 GLM-OCR，用于合同识别和智能匹配。
- **数据备份**：支持创建和下载本地 SQLite 数据库备份。

## 技术栈

- Next.js 16
- React 19
- Prisma 6
- SQLite
- Recharts
- Tesseract.js
- xlsx
- pdf-parse / pdf-to-img / mammoth / word-extractor

## 快速启动

进入应用目录：

```powershell
cd src
```

安装依赖：

```powershell
npm install
```

生成数据库客户端：

```powershell
npx prisma generate
```

启动开发服务：

```powershell
npm run dev
```

如果 PowerShell 禁止执行 `npm.ps1`，可以改用：

```powershell
cmd /c npm run dev
```

## 常用检查

开发后建议至少运行：

```powershell
cmd /c npm run lint
cmd /c npm run build
```

## 环境配置

应用目录下有示例文件：

```text
src/.env.example
```

常用配置：

- `DATABASE_URL`：SQLite 数据库地址，默认是 `file:./dev.db`。
- `ZHIPU_API_KEY`：可选，用于模型调用。
- `ZHIPU_API_URL`：可选，模型接口地址。
- `ZHIPU_MODEL`：可选，模型名称。
- `GLM_OCR_API_KEY`：可选，用于 GLM-OCR。
- `GLM_OCR_API_URL`：可选，GLM-OCR 接口地址。
- `GLM_OCR_MODEL`：可选，GLM-OCR 模型名称。

请不要把真实密钥、真实 `.env` 文件或本地数据库推送到 GitHub。

## 工作区结构

```text
.
├─ README.md                  # 语言入口
├─ README.zh-CN.md            # 中文说明
├─ README.en.md               # English README
├─ docs/                      # 需求、交互、架构和接口文档
├─ contracts/                 # 已上传合同文件存档
├─ backups/                   # 数据库备份快照
├─ test file/                 # 样例文件与实验数据
└─ src/                       # 实际运行的 Next.js 应用
   ├─ README.md               # 应用级开发说明
   ├─ package.json
   ├─ prisma/                 # 数据库结构和迁移
   ├─ config/                 # 模型网关配置示例
   ├─ public/
   └─ src/                    # 页面、接口和业务逻辑
```

## 页面入口

- `/`：仪表盘
- `/worklog`：工作日志导入、编辑和拆分
- `/contracts`：合同上传、识别和价格清单入库
- `/reports`：产值报表和导出
- `/master/inbox`：项目审查和异常处理
- `/master/projects`：项目管理
- `/master/staff`：人员管理
- `/master/prices`：内部指导价
- `/master/models`：模型接口配置

## 文档入口

- [产品需求](docs/requirements.md)
- [交互设计](docs/interaction_design.md)
- [实现架构](docs/architecture.md)
- [接口参考](docs/api_reference.md)
- [应用开发说明](src/README.md)

建议阅读顺序：

1. 先看本文件，了解系统用途和启动方式。
2. 再看 `src/README.md`，了解应用目录和开发细节。
3. 再看 `docs/architecture.md` 和 `docs/api_reference.md`。
4. 做产品或交互调整时，再看 `docs/requirements.md` 和 `docs/interaction_design.md`。

## 当前边界

- 系统按内部单用户场景设计，没有登录鉴权。
- 默认数据库是 SQLite。
- 合同识别和智能匹配效果会受到文件质量、模型配置和输入文本质量影响。
- 本地数据库文件可能包含业务数据，不应直接提交。

## 安全提醒

- 不要提交真实 API Key。
- 不要提交 `.env`。
- 不要提交本地数据库、备份文件或客户合同原件，除非已经确认这些内容可以公开。
- 提交前建议运行一次密钥扫描，并确认待提交文件列表。
