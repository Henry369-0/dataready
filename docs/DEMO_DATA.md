# Retail Operations Demo 数据说明

DataReady 自带一份虚构经营数据，用来让第一次访问项目的人无需准备文件即可跑完整流程。

## 字段

- `date`
- `city`
- `category`
- `merchant_id`
- `merchant_name`
- `orders`
- `gmv`
- `discount_amount`
- `delivery_cost`
- `completion_rate`
- `avg_delivery_time`
- `status`
- `country`

## 设计原则

Demo 不是为了让所有检测规则都触发，而是为了让一条真实工作流自然出现：

```text
上传 / Demo
   ↓
发现明确问题 + 需要判断的问题
   ↓
低风险项自动进入 Cleaning Plan
   ↓
用户确认语义合并
   ↓
Preview
   ↓
Apply
   ↓
Recheck
   ↓
Export
```

所有数据均为程序生成的演示数据，不包含真实企业、真实用户或真实经营信息。
