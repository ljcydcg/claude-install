# Claude / Codex Manager

这是一个 Windows 桌面程序，用于管理：

- OpenAI Codex CLI（npm 包：`@openai/codex`）
- Anthropic Claude Code CLI（npm 包：`@anthropic-ai/claude-code`）

主要功能：

1. 一键安装/更新 Codex CLI 和 Claude Code CLI；
2. 自定义安装根目录；
3. 自定义 npm 全局 prefix，避免污染系统 Node 目录；
4. 配置中转 `base_url` 和 `key`；
5. 生成 Windows CMD 与 Git Bash 环境加载脚本。

## 启动开发版

```bash
cd /d/claude-install
npm start
```

## 打包 Windows 程序

```bash
cd /d/claude-install
npm run build:win
```

打包产物在：

```text
D:\claude-install\dist
```

## 默认安装目录

```text
D:\ai-cli-tools
D:\ai-cli-tools\npm-global
```

## 生成的环境脚本

安装/应用配置后会生成：

```text
D:\ai-cli-tools\ai-cli-env.cmd
D:\ai-cli-tools\ai-cli-env.sh
```

在 cmd 里使用：

```cmd
D:\ai-cli-tools\ai-cli-env.cmd
codex --version
claude --version
```

在 Git Bash 里使用：

```bash
source /d/ai-cli-tools/ai-cli-env.sh
codex --version
claude --version
```

## 说明

- Codex 常用变量：`OPENAI_BASE_URL`、`OPENAI_API_KEY`。
- Claude Code 官方常用变量：`ANTHROPIC_API_KEY`；本程序也写入 `ANTHROPIC_BASE_URL`，是否生效取决于 Claude Code 当前版本对中转接口的支持。
- 如果 Claude Code 不读取 `ANTHROPIC_BASE_URL`，可在 Claude Code 自身配置或代理层配置中转。
