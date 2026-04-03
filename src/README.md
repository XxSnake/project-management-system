# 应用开发说明

本目录是实际运行的 Next.js 应用。仓库根目录主要放文档、合同存档、备份和测试样例；应用代码、依赖和 Prisma 都在这里。

## 技术栈

- Next.js 16 App Router
- React 19
- Prisma 6
- SQLite
- Recharts
- Tesseract.js
- `pdf-parse` / `pdf-to-img` / `mammoth` / `word-extractor`
- `xlsx`

## 快速启动

在工作区根目录下执行以下操作：

```powershell
cd src
npm install
npx prisma generate
npm run dev
```

如果使用 PowerShell 且系统禁用了 `npm.ps1`，可改用：

```powershell
cd src
cmd /c npm run dev
cmd /c npm run lint
cmd /c npm run build
```

开发完成后至少执行：

```powershell
cmd /c npm run lint
cmd /c npm run build
```

## 环境变量

请参考 [src/.env.example](.env.example)。

当前使用到的变量：

- `DATABASE_URL`
  - Prisma 的 SQLite 连接串
  - 当前仓库默认写法是 `file:./dev.db`
  - 这个相对路径是相对 `prisma/schema.prisma` 解析的，所以默认数据库文件实际位于 `src/prisma/dev.db`
- `ZHIPU_API_KEY`
  - 可选
  - 配置后合同解析优先调用 GLM
- `ZHIPU_API_URL`
  - 可选
  - 默认值已在代码中提供
- `ZHIPU_MODEL`
  - 可选
  - 默认值已在代码中提供

## 目录说明

```text
src/
├─ package.json
├─ .env
├─ .env.example
├─ prisma/
│  ├─ schema.prisma
│  └─ dev.db
├─ public/
└─ src/
   ├─ app/
   │  ├─ page.js                  # 仪表盘
   │  ├─ worklog/page.js          # 工作记录导入与编辑
   │  ├─ contracts/page.js        # 合同上传与入库
   │  ├─ reports/page.js          # 产值报表
   │  ├─ master/
   │  │  ├─ staff/page.js         # 人员管理
   │  │  ├─ projects/page.js      # 项目管理
   │  │  └─ prices/page.js        # 内部指导价
   │  └─ api/                     # 内部 API
   ├─ components/
   │  └─ Sidebar.js
   └─ lib/
      ├─ prisma.js
      ├─ wpsParser.js
      ├─ productionCalculator.js
      ├─ contractParser.js
      ├─ pdfToImages.mjs
      ├─ ocrWorker.mjs
      └─ ocrWorker.cjs
```

## 页面与能力

### 页面

- `/`
  - 仪表盘
  - 展示统计卡片、本月产值排行、最近工作记录、备份记录
- `/worklog`
  - 粘贴 WPS 文本
  - 自动解析后保存工作记录并生成产值
  - 支持编辑和删除
- `/contracts`
  - 上传合同
  - 自动尝试识别合同基础信息和价格清单
  - 人工确认后入库
- `/reports`
  - 查看产值汇总
  - 导出 Excel
- `/master/staff`
  - 管理人员
- `/master/projects`
  - 管理项目及关联合同
- `/master/prices`
  - 管理内部指导价

### API

完整接口见 [../docs/api_reference.md](../docs/api_reference.md)。

最常用接口：

- `POST /api/worklog`
  - 接收 WPS 粘贴文本，解析并保存
- `POST /api/upload`
  - 上传合同并返回识别结果
- `POST /api/contracts`
  - 保存合同和价格清单
- `GET /api/reports`
  - 查询汇总报表
- `GET /api/export`
  - 导出 Excel
- `GET /api/backup`
  - 列出历史备份
- `POST /api/backup`
  - 创建备份

## 核心数据流

### 1. 工作日志导入

`WPS 粘贴文本 -> /api/worklog -> wpsParser -> 自动补人员/项目 -> WorkLog 入库 -> productionCalculator -> ProductionValue`

### 2. 合同导入

`上传文件 -> /api/upload -> 保存到工作区根目录 contracts/ -> contractParser -> 返回识别结果 -> 用户确认 -> /api/contracts 入库`

### 3. 产值报表

`ProductionValue -> /api/reports -> 页面展示`

### 4. Excel 导出

`ProductionValue -> /api/export -> xlsx Buffer 下载`

### 5. 备份

`POST /api/backup -> 复制当前 SQLite -> 工作区根目录 backups/`

## 当前开发约束

- 无鉴权，默认所有页面和接口都属于内部单用户场景
- 没有测试框架，当前用 `lint + build + 手工验证` 做最小回归
- 工作日志导入现在同时支持 WPS 粘贴文本和 `.xlsx / .xls` 文件
- 复杂数量描述会先做本地拆分，少量疑难行再调用 `worklogMatching`
- 合同单价和工作记录的匹配逻辑现在是：
  - 先做本地字符串/别名匹配
  - 本地规则不能稳定判定时，再调用 `worklogMatching`
- 工作日志导入时会自动创建缺失的项目和人员，但不会自动把项目绑定到合同
- 合同识别支持多种文件格式，但效果强依赖文件质量和是否配置 GLM

## 文档优先级

切换开发工具时，建议统一按下面顺序建立上下文：

1. [../README.md](../README.md)
2. 本文件
3. [../docs/architecture.md](../docs/architecture.md)
4. [../docs/api_reference.md](../docs/api_reference.md)
5. [../docs/requirements.md](../docs/requirements.md)

## 模型 API 管理

- 页面入口：`/master/models`
- 配置文件：`src/config/model-providers.json`
- 示例文件：`src/config/model-providers.example.json`
- 接口：
- `GET /api/models`
- `POST /api/models`
- `PUT /api/models`
- `DELETE /api/models`
- `POST /api/models/test`
- Provider types:
  - `openai-compatible`: for `/v1/chat/completions`
  - `glm-ocr-maas`: for `https://open.bigmodel.cn/api/paas/v4/layout_parsing`
- Task bindings:
  - `contractOcr`: scanned PDF / image OCR
  - `contractVision`: vision fallback
  - `contractText`: text extraction and normalization
  - `worklogMatching`: worklog intelligent matching
  - `contractReview`: result review / correction
- Recommended contract pipeline:
  - `contractOcr -> structured local parsing -> contractText -> contractVision fallback`

合同识别已经接入统一模型网关，不再写死在 `ZHIPU_*` 环境变量上。
如果还没有本地配置文件，系统会尝试使用 `.env` 里的 `ZHIPU_API_KEY / ZHIPU_API_URL / ZHIPU_MODEL` 作为默认模型入口。
