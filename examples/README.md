# 示例数据与输出

## `retail_operations_dirty.xlsx`

虚构的零售经营数据，用于 DataReady v0.1 Demo。文件中的商家、指标和异常均为演示数据，不对应任何真实企业或业务。

数据规模：约 3,200 行 × 13 列。

主动植入的问题包括：

- 完全重复记录；
- 城市 / 类目命名不一致；
- 日期格式混用；
- `N/A` 等显式空值编码；
- 数值文本与不可解析文本；
- 极端 GMV；
- 负金额；
- `orders = 0` 但 `gmv > 0`；
- 常量字段；
- 部分缺失。

## 示例输出

- `cleaning_recipe.example.json`：机器可读清洗配方；
- `cleaning_log.example.csv`：修改记录；
- `cleaning_script.example.py`：可复现 pandas 脚本。

这些输出用于展示结构，真实运行时会根据用户选中的 Cleaning Plan 动态生成。
