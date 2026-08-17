# DataReady v0.1 架构说明

## 1. 架构目标

DataReady v0.1 采用纯前端、Local-first 架构。核心目的不是追求复杂技术栈，而是确保：

- CSV / Excel 在浏览器中即可完成解析；
- 核心体检和清洗不依赖后端；
- 原始数据不需要上传；
- 每种检测和清洗行为都有明确边界；
- UI 与 Data Engine 解耦；
- 将来可以增加 Semantic / AI Provider，但不会重写核心规则引擎。

## 2. 数据流

```text
File / Demo
   │
   ▼
Parser
   │
   ▼
DataRow[]
   │
   ├───────────────┐
   ▼               ▼
Profiler        Detectors
   │               │
   └──────┬────────┘
          ▼
   DiagnosisResult
          │
          ▼
      UI / Issues
          │
          ▼
   CleaningAction[]
          │
    ┌─────┴─────┐
    ▼           ▼
 Preview      Apply
                │
                ▼
            Re-diagnose
                │
                ▼
             Export
```

## 3. 主要模块

### `engine/parser.ts`

负责 CSV / Excel 解析与 Demo 加载，将不同输入统一转换为 `DataRow[]`。

### `engine/profiler.ts`

负责字段理解：

- 类型推断；
- 缺失；
- 唯一值；
- 示例；
- 数值统计。

### `engine/detectors.ts`

负责问题检测。每个 Detector 输出标准化 `DataIssue`，而不是直接修改数据。

### `engine/scoring.ts`

将 Issues 映射到 Data Readiness 五个维度。该模块只用于辅助排序与 Before / After，不承担业务真实性判断。

### `engine/cleaning.ts`

负责：

- Preview；
- 执行 CleaningAction；
- 生成 Change Log；
- 保留历史以支持 Undo。

### `engine/exporters.ts`

负责输出：

- XLSX；
- Cleaning Log CSV；
- Cleaning Recipe JSON；
- pandas Cleaning Script。

## 4. 核心类型

```text
DataRow
ColumnProfile
DataIssue
CleaningAction
PreviewChange
ChangeLogEntry
ReadinessScore
DiagnosisResult
```

`DataIssue` 与 `CleaningAction` 被刻意分开。发现一个异常值，不等于必须产生“删除异常值”的 CleaningAction。

## 5. 状态模型

```text
originalRows  # immutable baseline
workingRows   # current dataset
history[]     # applied action snapshots / logs
selected[]    # actions currently in Cleaning Plan
```

恢复原始数据时直接回到 `originalRows`，而不是尝试反向猜测所有修改。

## 6. Semantic Provider

v0.1 的语义层只做本地智能匹配：

- trim / case normalization；
- 常见城市 alias；
- 文本规范化；
- 轻量相似性判断。

未来 Provider 接口可以扩展为：

```text
SemanticProvider
  ├── LocalSemanticProvider
  └── AiSemanticProvider
```

即使增加 AI，Provider 也只返回建议 / 置信度 / 解释，不能直接 mutate Dataset。

## 7. 为什么不用后端

v0.1 的核心能力不需要账号、数据库、队列或服务端推理。纯静态实现可以显著降低：

- 部署复杂度；
- 隐私风险；
- 开源体验门槛；
- Demo 失败概率。

如果以后需要真实 AI Provider、团队协作或云端历史，再单独增加服务端层。

## 8. 可复现导出

每一种可执行 CleaningAction 都应有稳定的代码模板，例如：

```text
remove_exact_duplicates -> df.drop_duplicates()
normalize_category      -> df[col].replace(mapping)
normalize_date          -> pd.to_datetime(...)
coerce_numeric          -> pd.to_numeric(...)
```

因此 Python Script 来自 Action 序列，而不是让模型根据最终数据反推处理过程。
