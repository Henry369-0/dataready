# 参与贡献

感谢关注 DataReady。

这个项目刻意保持范围很小：**帮助用户在分析前发现数据问题，并安全、可解释地完成准备。** 因此我们更欢迎提高可靠性的贡献，而不是单纯增加功能数量。

## 最有价值的贡献

- 修复检测误报 / 漏报；
- 增加清晰、可复现的测试数据；
- 改进 Issue Card 的解释和 Preview；
- 完善无障碍与键盘交互；
- 改进 Cleaning Script / Recipe 的可复现性；
- 提升 CSV / Excel 边界兼容性；
- 补充文档中的规则边界。

## 本地开发

```bash
npm install
npm run dev
```

提交前：

```bash
npm run check
```

## 新增检测规则时

请说明：

1. 这个问题为什么会影响分析；
2. 如何确定性地检测；
3. 哪些情况可能误报；
4. Issue 应属于 Critical / Warning / Suggestion 哪一级；
5. 是否应该生成 CleaningAction；
6. 如果生成，风险等级是 Low / Medium / High；
7. 是否能 Preview / Undo / 导出脚本。

如果第 2 条无法说清楚，规则更可能属于 Semantic Provider，而不是核心 Detector。

## 产品原则

请尽量避免：

- “AI 判断了，所以直接改”；
- 将异常值默认删除；
- 为了功能数量增加复杂页面；
- 将 DataReady 变成 BI / Excel / ETL 平台；
- 把 API Key 暴露给浏览器。
