# 贡献指南

感谢参与对表。提交变更前，请先确认问题可复现，并让实现、测试与中英文文档保持一致。

## 开发环境

需要 Node.js 22.12 或更高版本。

```bash
npm ci
npm run dev
```

## 提交变更

1. 为一个明确的问题创建聚焦变更，避免夹带无关格式化或依赖升级。
2. 新功能或行为修复应补充能验证关键边界的测试。
3. 若用户可见行为、文件限制或隐私边界变化，同步更新 [README](README.md)、[英文说明](docs/README.en.md)或[使用指南](docs/USER-GUIDE.zh-CN.md)。
4. 提交前运行：

```bash
npm run test
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
```

如果某项检查因环境限制无法运行，请在 Pull Request 中明确列出未验证项和原因，不要把其他检查结果当作替代证据。

## 报告问题

普通缺陷可在 [GitHub Issues](https://github.com/TolkmisLK/duibiao/issues) 中提交，并包含：

- 可复现的最小步骤；
- 期望结果与实际结果；
- 浏览器、操作系统和文件类型；
- 已去除敏感内容的最小样例文件或数据结构；
- 相关错误信息或截图。

请勿在公开 Issue 中上传真实业务表、个人信息、密钥或其他敏感数据。安全漏洞请按[安全政策](SECURITY.md)私下报告。

## 代码约定

- 保持 TypeScript 类型明确，解析和比较逻辑应可独立测试。
- 错误提示应说明用户可以采取的下一步，不暴露文件内容。
- 新增解析格式或提高限制前，应评估内存、超时和恶意文件边界。
- Git 提交说明使用中文，简洁描述实际变更。

提交贡献即表示你同意按项目的 [MIT License](LICENSE) 提供该贡献。
