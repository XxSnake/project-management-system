# API 参考

本文档描述当前仓库内已实现的内部 API。所有接口都位于 `src/src/app/api/`，默认是给前端页面直接调用的，无鉴权。

## 通用说明

- 返回格式以 JSON 为主
- 导出和备份下载接口返回文件流
- 当前没有统一错误码规范，通常使用 HTTP 状态码 + `{ error: string }`

## 1. 人员 `GET/POST/DELETE /api/staff`

### `GET /api/staff`

用途：

- 获取全部人员

返回：

- `Staff[]`

### `POST /api/staff`

用途：

- 新增人员

请求体：

```json
{
  "name": "张三",
  "phone": "13800000000",
  "role": "检测员"
}
```

### `DELETE /api/staff`

用途：

- 删除人员

请求体：

```json
{
  "id": 1
}
```

## 2. 项目 `GET/POST/DELETE /api/projects`

### `GET /api/projects`

用途：

- 获取全部项目
- 包含关联合同

### `POST /api/projects`

用途：

- 新增项目

请求体：

```json
{
  "name": "弥渡县第一完全中学项目",
  "status": "进行中",
  "phase": "主体施工",
  "contractId": 3
}
```

### `DELETE /api/projects`

请求体：

```json
{
  "id": 1
}
```

## 3. 内部指导价 `GET/POST/DELETE /api/prices`

### `GET /api/prices`

用途：

- 获取全部内部指导价

### `POST /api/prices`

请求体：

```json
{
  "testItemName": "沉降观测",
  "unit": "点",
  "unitPrice": 35
}
```

### `DELETE /api/prices`

请求体：

```json
{
  "id": 1
}
```

## 4. 合同 `GET/POST/DELETE /api/contracts`

### `GET /api/contracts`

用途：

- 获取合同
- 包含价格清单和关联项目

### `POST /api/contracts`

用途：

- 保存合同及其价格清单

请求体示例：

```json
{
  "contractNo": "JC-2025-012",
  "clientName": "某建设单位",
  "partyB": "某检测公司",
  "filePath": "E:\\work space\\项目管理系统开发\\contracts\\1700000000_xxx.pdf",
  "signedDate": "2025-03-10",
  "notes": "工程: 某某项目",
  "priceItems": [
    {
      "testItemName": "沉降观测",
      "quantity": 100,
      "unit": "点",
      "unitPrice": 35
    }
  ]
}
```

### `DELETE /api/contracts`

请求体：

```json
{
  "id": 1
}
```

## 5. 工作日志 `GET/POST/DELETE /api/worklog`

### `GET /api/worklog`

查询参数：

- `month=YYYY-MM`
  - 可选
  - 仅返回指定月份数据

用途：

- 获取工作日志列表
- 包含项目、参与人员、产值记录

### `POST /api/worklog`

用途：

- 解析 WPS 粘贴文本并保存

请求体：

```json
{
  "rawText": "2026/03/10\t某项目\t沉降观测\t26点\t张三、李四\t3#楼"
}
```

返回示例：

```json
{
  "saved": 3,
  "errors": [],
  "total": 3
}
```

说明：

- 导入时会自动创建缺失的项目和人员
- 保存后立即尝试计算产值

### `DELETE /api/worklog`

用途：

- 批量删除工作日志

请求体：

```json
{
  "ids": [12, 13, 14]
}
```

返回示例：

```json
{
  "success": true,
  "deletedCount": 3
}
```

## 6. 工作日志单条 `PUT/DELETE /api/worklog/[id]`

### `PUT /api/worklog/[id]`

用途：

- 更新单条工作日志
- 重建人员关联
- 清空并重算该条产值

请求体：

```json
{
  "workDate": "2026-03-10",
  "projectName": "某项目",
  "testContent": "沉降观测",
  "quantity": 26,
  "unit": "点",
  "remarks": "3#楼",
  "staffNames": ["张三", "李四"]
}
```

### `DELETE /api/worklog/[id]`

用途：

- 删除单条工作日志

## 7. 报表 `GET /api/reports`

查询参数：

- `month=YYYY-MM`
  - 可选
- `groupBy=staff|project`
  - 可选
  - 默认 `staff`

用途：

- 聚合 `ProductionValue`
- 返回人员汇总或项目汇总

返回示例：

### `groupBy=staff`

```json
[
  {
    "staffName": "张三",
    "staffId": 1,
    "total": 1200,
    "count": 8
  }
]
```

### `groupBy=project`

```json
[
  {
    "projectName": "某项目",
    "projectId": 2,
    "total": 3500,
    "count": 15
  }
]
```

## 8. Excel 导出 `GET /api/export`

查询参数：

- `month=YYYY-MM`
  - 可选
- `groupBy=staff|project|detail`

用途：

- 导出 Excel 文件

说明：

- `staff` 导出人员汇总
- `project` 导出项目矩阵汇总
- `detail` 导出明细

## 9. 合同上传与识别 `POST /api/upload`

用途：

- 上传合同文件
- 存入工作区根目录 `contracts/`
- 自动调用 `contractParser`

请求体：

- `multipart/form-data`
- 字段名：`file`

返回字段：

- `success`
- `fileName`
- `savedPath`
- `parsedData`

`parsedData` 常见字段：

- `success`
- `contractNo`
- `clientName`
- `partyB`
- `projectName`
- `signedDate`
- `priceItems`
- `rawText`
- `method`
- `confidence`
- `timeMs`

## 10. 备份 `GET/POST /api/backup`

### `GET /api/backup`

用途：

- 返回历史备份列表

返回示例：

```json
[
  {
    "name": "db_backup_20260315_10-30-00.db",
    "size": 123456,
    "createdAt": "2026-03-15T02:30:00.000Z",
    "downloadUrl": "/api/backup?name=db_backup_20260315_10-30-00.db"
  }
]
```

### `GET /api/backup?name=...`

用途：

- 下载指定历史备份

### `GET /api/backup?download=current`

用途：

- 直接下载当前数据库文件

### `POST /api/backup`

用途：

- 创建新的 SQLite 快照到工作区根目录 `backups/`

返回示例：

```json
{
  "success": true,
  "fileName": "db_backup_20260315_10-30-00.db",
  "backup": {
    "name": "db_backup_20260315_10-30-00.db",
    "size": 123456,
    "createdAt": "2026-03-15T02:30:00.000Z",
    "downloadUrl": "/api/backup?name=db_backup_20260315_10-30-00.db"
  }
}
```

## 11. 模型配置 `GET/POST/PUT/DELETE /api/models`

### `GET /api/models`

用途：

- 读取当前模型提供方列表
- 读取任务绑定关系
- 返回模型配置文件路径

### `POST /api/models`

用途：

- 新增或更新一个模型提供方

请求体示例：

```json
{
  "name": "OpenAI GPT-4.1 mini",
  "providerType": "openai-compatible",
  "apiUrl": "https://api.openai.com/v1/chat/completions",
  "apiKey": "sk-xxx",
  "model": "gpt-4.1-mini",
  "enabled": true,
  "supportsText": true,
  "supportsVision": true,
  "notes": "合同识别主模型"
}
```

GLM-OCR MaaS 示例：

```json
{
  "name": "GLM-OCR",
  "providerType": "glm-ocr-maas",
  "apiUrl": "https://open.bigmodel.cn/api/paas/v4/layout_parsing",
  "apiKey": "your-glm-ocr-key",
  "model": "glm-ocr",
  "enabled": true,
  "supportsText": false,
  "supportsVision": false,
  "supportsOcr": true,
  "notes": "Contract OCR entry"
}
```

### `PUT /api/models`

用途：

- 更新任务与模型的绑定关系

请求体示例：

```json
{
  "taskBindings": {
    "contractOcr": "glm-ocr",
    "contractVision": "openai-gpt41-mini",
    "contractText": "openai-gpt41-mini",
    "worklogMatching": "openai-gpt41-mini",
    "contractReview": null
  }
}
```

说明：

- `contractOcr` 鐢ㄤ簬鎵弿 PDF / 鍥剧墖鍚堝悓鐨?OCR 涓绘祦
- `contractVision` 鐢ㄤ簬 `contractOcr` 涓嶈冻鏃剁殑瑙嗚鍏滃簳
- `contractText` 鐢ㄤ簬鍚堝悓鏂囨湰缁撴灉鐨勬娊鍙栥€佹爣鍑嗗寲鍜岃ˉ鍏?

### `DELETE /api/models`

用途：

- 删除一个本地模型配置

请求体示例：

```json
{
  "id": "openai-gpt41-mini"
}
```

### `POST /api/models/test`

用途：

- 测试模型接口连通性
- 可测试已保存模型，也可测试当前表单中的未保存模型

## 11. 设计上的注意点

- 所有接口都是当前页面的内部后端，不是对外开放 API
- 目前没有版本号
- 目前没有鉴权
- 目前没有严格的 schema 校验层
- 如果未来引入多工具并行开发，建议优先保持：
  - 请求体字段名稳定
  - 返回结果字段语义稳定
  - 文档同步更新
