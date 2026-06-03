# API 参考

本文档描述当前仓库里已经落地的内部 API。所有接口都位于 `src/src/app/api/`，默认供前端页面直接调用，无鉴权。

## 通用说明

- 返回格式以 JSON 为主
- 导出和备份下载接口返回文件流
- 当前没有统一错误码规范，通常使用 HTTP 状态码 + `{ error: string }`
- 当前没有严格的请求体校验层，调用方需要自己保证字段完整性

## 1. 人员 `/api/staff`

### `GET /api/staff`

用途：

- 获取全部人员

返回：

- `Staff[]`

### `POST /api/staff`

用途：

- 新增人员

请求体示例：

```json
{
  "name": "张三",
  "phone": "13800000000",
  "role": "检测员"
}
```

说明：

- 当前前端页面只直接维护 `name`
- `phone`、`role` 字段仍保留在表里，接口也仍兼容接收

### `PUT /api/staff`

用途：

- 按 ID 更新人员姓名

请求体示例：

```json
{
  "id": 1,
  "name": "张三（修改后）"
}
```

### `DELETE /api/staff`

用途：

- 删除人员

请求体示例：

```json
{
  "id": 1
}
```

## 2. 项目 `/api/projects`

### `GET /api/projects`

用途：

- 获取全部项目
- 包含关联合同
- 合同内会一并带出 `priceItems`

### `POST /api/projects`

用途：

- 新增项目
- 同名项目会返回 `409`

请求体示例：

```json
{
  "name": "弥渡县第一完全中学项目",
  "status": "进行中",
  "phase": "主体施工",
  "contractId": 3,
  "buildingMode": false,
  "noContractExpected": false
}
```

说明：

- `buildingMode=true` 时，`phase` 必须为空
- 开启后，该项目会吸收 `项目名（单体名）` 这种工作记录写法，并把括号内容记到工作记录的 `buildingName`
- `noContractExpected=true` 表示该项目本来就不需要合同；如果已经填了 `contractId`，则不能同时设为 `true`

### `PUT /api/projects`

用途：

- 更新项目基础信息
- 绑定或更换合同
- 如果是“第一次绑定合同”，会自动触发一次历史工作记录补算

请求体示例：

```json
{
  "id": 12,
  "name": "弥渡县第一完全中学项目",
  "status": "进行中",
  "phase": "主体施工",
  "contractId": 3,
  "buildingMode": false,
  "noContractExpected": false
}
```

返回：

- 更新后的项目对象
- 首次绑定合同场景下，额外返回 `retroactiveResult`

说明：

- `noContractExpected` 不传时，保持原值
- 如果这次把项目关联合同，系统会自动把 `noContractExpected` 清成 `false`

### `DELETE /api/projects`

用途：

- 删除单个项目
- 或批量删除项目

请求体示例：

```json
{
  "id": 1
}
```

```json
{
  "ids": [1, 2, 3]
}
```

## 3. 项目详情 `/api/projects/[id]`

### `GET /api/projects/[id]`

用途：

- 获取单个项目详情
- 包含关联合同和合同价目表
- 包含检测记录列表
- 检测记录内会附带来源工作记录和人员信息

返回结构重点：

- `contract`
- `contract.priceItems`
- `buildingMode`
- `buildingSummaries`
- `workLogs[].buildingName`
- `detectionRecords`
- `detectionRecords[].isEdited`
- `repairNeeded`
- `missingDetectionRecordCount`
- `siblingProjects`：当前项目如果已关联合同，会一并返回同合同下的全部项目组
- `siblingProjects[]._count.workLogs`
- `siblingProjects[].workLogs`
- `siblingProjects[].workLogs[].staffMembers`

> 说明：`GET /api/projects/[id]` 现在只返回“是否需要修复”的提示，不再在读取详情时自动补写缺失检测明细。

### `PUT /api/projects/[id]`

用途：

- 只更新当前项目的“无需合同”标记
- 勾选后，当前项目下的无合同工作记录会从 E7 收件箱自动消失

请求体示例：

```json
{
  "noContractExpected": true
}
```

说明：

- 这个接口只接受 `noContractExpected`
- 已关联合同的项目不能标记为 `true`

### `POST /api/projects/[id]/repair-inspections`

用途：

- 手动补齐当前项目下缺失的检测明细
- 只补缺失项，已有检测明细的工作记录会跳过
- 可重复调用；重复调用时 `repairedCount` 会回到 `0`

返回字段重点：
- `success`
- `repairedCount`
- `skippedCount`

## 4. 项目检测记录 `/api/projects/[id]/detection-records`

### `POST /api/projects/[id]/detection-records`

用途：

- 在项目详情页手动新增一条检测记录

请求体示例：

```json
{
  "testCategory": "地基基础",
  "testItem": "沉降观测",
  "quantityText": "26点",
  "detectDate": "2026-04-13",
  "reportNo": "BG-2026-001",
  "mainTester": "张三",
  "remarks": "3#楼"
}
```

### `PATCH /api/projects/[id]/detection-records/[rid]`

用途：

- 修改检测记录中的可编辑字段

可编辑字段：

- `testCategory`
- `testItem`
- `quantityText`
- `detectDate`
- `reportNo`
- `reportEditor`
- `mainTester`
- `reviewer`
- `approver`
- `remarks`
- `sequence`

### `DELETE /api/projects/[id]/detection-records/[rid]`

用途：

- 删除单条检测记录

## 5. 项目组整理、合并、补算与上限进度

### `PUT /api/projects/batch-rename`

用途：

- 批量整理同一份合同下的项目组
- 支持三种角色操作：保留独立子项（开启/不开启单体模式）、合并入其他项目、作为单体挂在其他项目下
- 自动处理合并时的工作记录、检测记录与报告转移

请求体示例：

```json
{
  "contractId": 14,
  "parentName": "云南省洱海保护工程",
  "projects": [
    { "id": 811, "role": "subproject", "phase": "一二期" },
    { "id": 836, "role": "merge-into", "mergeTargetId": 811 },
    { "id": 837, "role": "building-under", "buildingParentId": 811, "buildingName": "1#管理房" },
    { "id": 838, "role": "building-mode-self", "phase": null }
  ]
}
```

说明：

- 必须一次性把这份合同下的全部项目都带上
- `parentName` 不能为空
- 同一轮保存里，统一后的 `name + phase` 不能重复
- 如果某个项目已开启 `buildingMode=true`，则不能给它填写 `phase`

返回字段重点：

- `success`
- `contractId`
- `parentName`
- `projects`

## 6. 项目合并、补算与上限进度

### `POST /api/projects/merge`

用途：

- 把多个重复项目合并到一个保留项目
- 会迁移工作记录、检测记录、报告
- 如果保留项目没有合同，且来源项目里有合同，会继承第一份可用合同

请求体示例：

```json
{
  "targetId": 10,
  "sourceIds": [11, 12]
}
```

返回字段：

- `movedWorkLogs`
- `movedDetectionRecords`
- `movedTestReports`
- `deletedProjects`

### `POST /api/projects/retroactive`

用途：

- 手动触发某个项目的历史工作记录补算

请求体示例：

```json
{
  "projectId": 10
}
```

返回字段重点：

- `status`
- `pricingMode`
- `total`
- `calculated`
- `pendingAreaShare`
- `noMatch`
- `exceeded`
- `details`

### `GET /api/projects/cap?projectId=...`

用途：

- 查询项目当前的合同总额、已累计产值、剩余额度和百分比

返回示例：

```json
{
  "projectId": 10,
  "projectName": "某项目",
  "hasContract": true,
  "pricingMode": "mixed",
  "progress": {
    "contractTotal": 50000,
    "cumulative": 12000,
    "remaining": 38000,
    "percentage": 24,
    "exceeded": false
  }
}
```

## 7. 内部指导价 `/api/prices`

### `GET /api/prices`

用途：

- 获取全部内部指导价

### `POST /api/prices`

用途：

- 新增内部指导价

请求体示例：

```json
{
  "testItemName": "沉降观测",
  "unit": "点",
  "unitPrice": 35
}
```

### `DELETE /api/prices`

用途：

- 删除内部指导价

请求体示例：

```json
{
  "id": 1
}
```

## 8. 合同 `/api/contracts`

### `GET /api/contracts`

用途：

- 获取合同列表
- 包含价目表和关联网项目
- `projects[]` 内会返回 `id`、`name`、`phase`

### `POST /api/contracts`

用途：

- 创建合同并保存价目表
- 自动关联已有项目，或按工程名创建项目
- 创建后会对已有工作记录尝试补算

请求体重点：

- `projectName` 和 `projectId` 至少提供一个
- `projectPhase` 可选；用于把合同直接绑定到“同名但不同子项”的项目，或新建带子项的项目
- `pricingMode` 支持 `unit | area | mixed | lumpsum`
- `areaPricingAmount`、`areaPricingArea`
- `lumpSumAmount`
- `priceItems`

请求体示例：

```json
{
  "contractNo": "JC-2025-012",
  "clientName": "某建设单位",
  "partyB": "某检测公司",
  "projectName": "某某项目",
  "projectPhase": "1#楼",
  "filePath": "E:\\work space\\项目管理系统开发\\contracts\\1700000000_xxx.pdf",
  "signedDate": "2025-03-10",
  "pricingMode": "mixed",
  "areaPricingAmount": 12000,
  "areaPricingArea": 3500,
  "priceItems": [
    {
      "testCategory": "地基基础",
      "testItemName": "沉降观测",
      "quantity": 100,
      "unit": "点",
      "unitPrice": 35
    }
  ]
}
```

### `PUT /api/contracts`

用途：

- 更新合同基础信息
- 整体替换价目表
- 可同时修改工程名称
- 可同时调整合同绑定到哪个项目
- 保存后会把受影响项目的历史产值重新计算
- 如果这次保存会把合同继续挂到新的项目上，而该合同下面已经已有别的项目，前端应先让用户选择 `sharedContractMode`

请求体重点：

- `projectPhase`：可选，保存到目标项目的 `phase`
- `sharedContractMode`：可选，`merge | subitem`
- `allowBlankSharedPhase`：仅当 `sharedContractMode='subitem'` 且用户明确确认留空时传 `true`
- 若合同已有关联项目，但这次又要继续挂到新的项目上，且没有传有效的 `sharedContractMode`，接口会返回 `409`

请求体示例：

```json
{
  "id": 5,
  "contractNo": "JC-2025-012",
  "clientName": "某建设单位",
  "partyB": "某检测公司",
  "signedDate": "2025-03-10",
  "pricingMode": "lumpsum",
  "lumpSumAmount": 50000,
  "projectId": 12,
  "projectName": "某某项目（改名后）",
  "projectPhase": "2#楼",
  "sharedContractMode": "subitem",
  "priceItems": [
    {
      "testCategory": "地基基础",
      "testItemName": "沉降观测",
      "quantity": 100,
      "unit": "点",
      "unitPrice": 35
    }
  ]
}
```

当用户明确确认“子项先留空”时，可额外传：

```json
{
  "id": 5,
  "projectId": 12,
  "projectName": "某某项目",
  "projectPhase": null,
  "sharedContractMode": "subitem",
  "allowBlankSharedPhase": true,
  "pricingMode": "unit",
  "priceItems": []
}
```

说明：

- `projectId` 有值时：表示绑定到指定项目；如果同时传了新的 `projectName`，会顺手改这个项目的名字
- `projectId` 为空且有 `projectName` 时：会按工程名称去匹配已有项目；找不到就新建项目并绑定
- 如果改绑到了新项目，旧项目会自动解除合同绑定

返回字段重点：

- `contract`
- `recalculationResults`

### `DELETE /api/contracts`

用途：

- 删除合同
- 删除前会先解除项目的合同绑定

请求体示例：

```json
{
  "id": 1
}
```

## 8. 工作日志 `/api/worklog`

### `GET /api/worklog`

查询参数：

- `month=YYYY-MM`

用途：

- 获取工作日志列表
- 包含项目、合同、参与人员、产值记录

### `POST /api/worklog`

用途：

- 导入工作日志
- 支持“先预览、再确认”的两阶段导入

支持两种提交方式：

- `application/json`：传 `rawText`
- `multipart/form-data`：传 Excel 文件，字段名 `file`

`mode` 说明：

- 不传：保持旧行为，直接导入；缺失项目会自动创建
- `preview`：只解析、不落库；返回每条记录的项目匹配结果
- `commit`：按用户确认后的 `rowAssignments` 落库

`preview` 阶段可用两种输入：

- 继续传 `rawText`
- 或直接传已经整理好的 `rows` 数组（前端预览确认时就是走这个）

JSON 请求体示例：

```json
{
  "rawText": "2026/03/10\t某项目\t沉降观测\t26点\t张三、李四\t3#楼"
}
```

`mode=preview` 请求体示例：

```json
{
  "mode": "preview",
  "source": "preview",
  "originalRows": 1,
  "rows": [
    {
      "rowIndex": 1,
      "workDate": "2026-04-16",
      "projectName": "弥渡县城西片区老旧小区改造建设项目-建宁路西段建设工程",
      "testContent": "轻型动力触探",
      "quantity": 10,
      "unit": "点",
      "staffNames": [],
      "remarks": "预览测试"
    }
  ]
}
```

`mode=commit` 请求体示例：

```json
{
  "mode": "commit",
  "source": "preview",
  "originalRows": 1,
  "rows": [
    {
      "rowIndex": 1,
      "workDate": "2026-04-16",
      "projectName": "弥渡县城西片区老旧小区改造建设项目-建宁路西段建设工程",
      "testContent": "轻型动力触探",
      "quantity": 10,
      "unit": "点",
      "staffNames": [],
      "remarks": "确认导入测试"
    }
  ],
  "rowAssignments": [
    { "rowIndex": 1, "decision": "use-existing", "projectId": 815 }
  ]
}
```

返回字段重点：

- `saved`
- `total`
- `originalRows`
- `expandedItems`
- `pricedCount`
- `workloadOnlyCount`
- `newProjects`
- `pendingAllocations`
- `errors`

`mode=preview` 额外返回：

- `mode`
- `statusCounts`
- `projectOptions`
- `rows[].resolution.status`：`exact | fuzzy | none`
- `rows[].resolution.exactProjectId`
- `rows[].resolution.candidates[]`
- `rows[].resolution.candidates[].projectId`
- `rows[].resolution.candidates[].projectDisplayName`
- `rows[].resolution.candidates[].score`
- `rows[].resolution.candidates[].matchedAs`
- `rows[].resolution.candidates[].buildingName`

`rowAssignments` 支持的决策：

- `use-existing`：落到指定已有项目
- `use-existing-as-building`：落到指定单体建筑模式项目，并写入 `buildingName`
- `create-new`：按 `projectName` 新建项目后再导入

说明：

- 导入时会自动创建缺失的项目和人员
- 保存后立即尝试计算产值
- 面积合同、包干价合同，以及已配置 `lumpSumAmount` 的 mixed 合同如果缺少占比，会通过 `pendingAllocations` 返回待补项目
- mixed 合同如果没有配置 `lumpSumAmount`，即使 `allocationShare` 为空也仍按单价逻辑处理，不会强制进入待补占比队列
- 当导入名与已有项目完全相同，但库里还存在其它近似同名项目时，`mode=preview` 会故意返回 `fuzzy`，让用户手动确认，避免再误挂到错误台账

### `DELETE /api/worklog`

用途：

- 批量删除工作日志

请求体示例：

```json
{
  "ids": [12, 13, 14]
}
```

## 9. 单条工作日志 `/api/worklog/[id]`

### `PUT /api/worklog/[id]`

用途：

- 更新单条工作日志
- 重建人员关联
- 删除旧产值并重新计算
- 同步检测记录覆盖层

请求体常用字段：

- `workDate`
- `projectName`
- `testContent`
- `quantity`
- `unit`
- `remarks`
- `staffNames`
- `allocationShare`
- `manualTotalValue`
- `manualValueNote`

请求体示例：

```json
{
  "workDate": "2026-03-10",
  "projectName": "某项目",
  "testContent": "沉降观测",
  "quantity": 26,
  "unit": "点",
  "remarks": "3#楼",
  "staffNames": ["张三", "李四"],
  "allocationShare": "35",
  "manualTotalValue": "",
  "manualValueNote": ""
}
```

返回字段重点：

- `log`
- `calculation`
- `pendingAllocation`

说明：

- `allocationShare` 同时接受百分比写法（如 `35`）和小数写法（如 `0.35`）
- `manualTotalValue > 0` 时，优先按手工产值计算
- `area / lumpsum` 合同填写 `allocationShare` 后会直接按占比折算
- `mixed` 合同只有在合同配置了 `lumpSumAmount > 0` 时才会按 `allocationShare` 走打包部分分摊；否则仍走原来的单价逻辑

### `POST /api/worklog/[id]/split`

用途：

- 保留原记录不动，复制出一条新的工作记录副本
- 新记录默认继承原记录的日期、项目、检测内容、数量、单位、人员、备注
- 新记录的占比和手工产值会清空，保存后重新计算并同步生成检测记录

请求体常用字段：

- `quantity`
- `workDate`
- `projectName`
- `testContent`
- `unit`
- `remarks`
- `staffNames`

请求体示例：

```json
{
  "quantity": 8,
  "workDate": "2026-04-13",
  "projectName": "某项目",
  "testContent": "保温层构造厚度",
  "unit": "组",
  "remarks": "拆出的这一部分",
  "staffNames": ["张三", "李四"]
}
```

返回字段重点：

- `originalLog`
- `splitLog`
- `pendingAllocations`

说明：

- `quantity` 可选；不传时默认复制原记录的数量
- 旧字段 `splitQuantity` 仍兼容，但语义等同于 `quantity`
- 允许 `quantity = 0`
- 不再限制新记录数量必须小于原记录数量
- 原记录的 `quantity / allocationShare / manualTotalValue / productionValues` 不会因为这次复制被修改
- `area / mixed / lumpsum` 合同下，如果原记录或新副本还没确认占比，响应里的 `pendingAllocations` 会把这些记录带回前端继续处理

### `DELETE /api/worklog/[id]`

用途：

- 删除单条工作日志

## 10. 报表与导出

### `GET /api/reports`

查询参数：

- `month=YYYY-MM`
- `groupBy=staff|project`

用途：

- 聚合 `ProductionValue`
- 返回人员汇总或项目汇总

说明：

- `groupBy=project` 时还会返回一些页面直接使用的辅助字段，比如待确认占比数、未签合同数、超限数等

### `GET /api/export`

查询参数：

- `month=YYYY-MM`
- `groupBy=staff|project|detail`

用途：

- 导出 Excel 文件

说明：

- `staff` 导出人员汇总
- `project` 导出项目汇总
- `detail` 导出明细

## 11. 合同上传、批量导入与标准检测项

### `POST /api/upload`

用途：

- 上传单个合同文件
- 保存到工作区根目录 `contracts/`
- 自动调用 `contractParser`
- 对识别出的价目表做一次标准化清洗

请求体：

- `multipart/form-data`
- 字段名：`file`

返回字段重点：

- `fileName`
- `savedPath`
- `parsedData`
- `parsedData.priceItems`
- `parsedData.needsConfirmation`

### `DELETE /api/upload`

用途：

- 清理用户未保存的已上传合同文件

请求体示例：

```json
{
  "filePath": "E:\\work space\\项目管理系统开发\\contracts\\1700000000_xxx.pdf"
}
```

### `GET /api/upload/batch`

用途：

- 获取当前批量合同导入任务列表

### `POST /api/upload/batch`

用途：

- 新建一批合同识别任务

请求体：

- `multipart/form-data`
- 字段名：`files`

### `GET /api/upload/batch/[id]`

用途：

- 获取某个批量任务详情
- 也可通过 `?itemId=...` 获取单个识别项详情

### `POST /api/upload/batch/[id]`

用途：

- 更新批量任务项状态

支持的 `action`：

- `mark_saved`
- `skip_item`
- `delete_item`

### `GET /api/standard-items`

用途：

- 获取标准检测项列表
- 同时返回平铺结构和分组结构

返回字段：

- `items`
- `grouped`

## 12. 报告 `/api/test-reports`

### `GET /api/test-reports`

查询参数：

- `month=YYYY-MM`
- `projectId`

用途：

- 获取报告记录列表
- 包含项目、合同、角色人员、报告产值

### `POST /api/test-reports`

用途：

- 批量导入报告记录
- 按行解析粘贴文本

请求体示例：

```json
{
  "rawText": "2026/04/10\tBG-2026-001\t某项目\t沉降观测\t1\t份\t张三\t李四\t王五\t赵六",
  "projectId": 10
}
```

说明：

- 每行至少包含：日期、报告编号、项目名、检测内容、数量、单位、编写、主检、审核、批准
- 如果带 `projectId`，会强制所有行挂到该项目下

### `DELETE /api/test-reports`

用途：

- 批量删除报告记录

请求体示例：

```json
{
  "ids": [12, 13]
}
```

### `PUT /api/test-reports/[id]`

用途：

- 更新单条报告记录
- 重建角色分配并重算报告产值

### `DELETE /api/test-reports/[id]`

用途：

- 删除单条报告记录

## 13. 备份 `/api/backup`

### `GET /api/backup`

用途：

- 返回历史备份列表

### `GET /api/backup?name=...`

用途：

- 下载指定历史备份

### `GET /api/backup?download=current`

用途：

- 直接下载当前数据库文件

### `POST /api/backup`

用途：

- 创建新的 SQLite 快照到工作区根目录 `backups/`

## 14. 模型配置 `/api/models`

### `GET /api/models`

用途：

- 读取模型提供方列表
- 读取任务绑定关系
- 返回模型配置文件路径

### `POST /api/models`

用途：

- 新增或更新一个模型提供方

请求体常用字段：

- `name`
- `providerType`
- `apiUrl`
- `apiKey`
- `model`
- `enabled`
- `supportsText`
- `supportsVision`
- `supportsOcr`
- `notes`

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

任务说明：

- `contractOcr`：扫描版 PDF / 图片合同 OCR
- `contractVision`：OCR 不足时的视觉补充识别
- `contractText`：文本抽取、标准化和补全
- `worklogMatching`：工作日志智能匹配
- `contractReview`：结果复核

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

## 15. 异常收件箱 `/api/inbox/*`

### `GET /api/inbox/exceptions`

用途：

- 读取异常收件箱列表
- 返回各异常分类当前未处理数量

常用查询参数：

- `type`：异常类型；可传 `invalid-quantity`、`missing-staff`、`no-price-match`、`pending-area-share`、`contract-incomplete`、`workload-only`、`fuzzy-project-duplicate`、`exceeded`
- `projectId`：按项目过滤
- `page`：页码
- `pageSize`：每页条数

返回结果要点：

- `counts`：各分类数量，含 `total`
- `items`：当前页记录
- `total` / `page` / `pageSize`

`items` 常用字段：

- `itemType`：`worklog` 或 `project-fuzzy-match`
- `workLogId`
- `workDate`
- `projectId`
- `projectName`
- `contractId`
- `contractNo`
- `pricingMode`
- `testContent`
- `quantity`
- `unit`
- `staffNames`
- `exceptions`
- `allocationShare`
- `allocationSharePercent`
- `manualTotalValue`
- `contractSummary`

当 `itemType=project-fuzzy-match` 时，常用字段改为：

- `projectId`
- `projectName`
- `projectStatus`
- `phase`
- `buildingMode`
- `contractId`
- `contractNo`
- `projectCreatedAt`
- `fuzzyMatchedAt`
- `candidateProjectIds`
- `candidateProjects[]`

### `POST /api/inbox/acknowledge`

用途：

- 把某条异常标记为“已知忽略”
- 对 `exceeded`（E9）来说，语义不是“忽略错误”，而是“接受当前 cap 后的截断结果，不再提醒”

请求体示例：

```json
{
  "workLogId": 5279,
  "exceptionType": "no-price-match"
}
```

补充说明：

- `exceptionType` 也可以传 `exceeded`
- 当 `exceptionType=exceeded` 时，工作记录会继续保留当前 cap 后的产值，只是从异常收件箱里消失
- E8 `fuzzy-project-duplicate` 不走这个接口；项目疑似重名要用专门的确认/合并接口

### `POST /api/inbox/reset-acknowledgement`

用途：

- 取消某条异常的“已知忽略”

请求体示例：

```json
{
  "workLogId": 5279,
  "exceptionType": "no-price-match"
}
```

补充说明：

- E8 `fuzzy-project-duplicate` 不走这个接口；它不是 worklog 的“忽略/取消忽略”模型

### `POST /api/inbox/fuzzy-match/confirm`

用途：

- 把一条 E8“项目疑似重名”记录标记为“确认保持独立”
- 标记后这条项目会从 E8 收件箱消失

请求体示例：

```json
{
  "projectId": 812
}
```

返回字段重点：

- `success`
- `projectId`
- `fuzzyMatchStatus`：固定为 `confirmed-distinct`

### `POST /api/inbox/fuzzy-match/merge`

用途：

- 把一条 E8“项目疑似重名”记录并入候选项目
- 只允许并到当前候选列表里的目标项目
- 底层复用现有项目合并逻辑，会迁移工作记录、检测记录、报告，并删除来源项目

请求体示例：

```json
{
  "projectId": 812,
  "targetProjectId": 811
}
```

返回字段重点：

- `success`
- `targetProjectId`
- `targetProject`
- `movedWorkLogs`
- `movedDetectionRecords`
- `movedTestReports`
- `deletedProjects`

### `POST /api/inbox/batch-allocate`

用途：

- 批量给 E5“缺占比”记录写入占比
- 接口只接受同一合同下的一组记录；跨合同会直接报错

请求体示例：

```json
{
  "items": [
    { "workLogId": 5436, "allocationShare": 0.333334 },
    { "workLogId": 5435, "allocationShare": 0.333333 },
    { "workLogId": 5434, "allocationShare": 0.333333 }
  ]
}
```

返回结果要点：

- `ok`
- `updatedCount`
- `items`：每条记录的更新结果

## 16. 手动触发项目判重 `/api/internal/*`

### `POST /api/internal/run-fuzzy-match`

用途：

- 手动触发一条或多条项目的后台判重
- 主要用于排查和复验；正常用户流程还是以项目保存后的异步扫描为主

请求体示例：

```json
{
  "projectId": 812
}
```

```json
{
  "projectIds": [812, 813],
  "limit": 6,
  "threshold": 0.72
}
```

返回字段重点：

- `success`
- `results[]`
- `results[].projectId`
- `results[].status`：可能为 `pending-review`、`distinct`、`error`、`missing`
- `results[].candidateIds`
- `results[].reason`

## 17. 设计注意点

- 所有接口都是当前页面的内部后端，不是对外开放 API
- 目前没有版本号
- 目前没有鉴权
- 如果后续继续多机、多助手并行开发，优先保证：
  - 请求体字段名稳定
  - 返回结果字段语义稳定
  - 文档与真实代码同步更新
