# 贡献指南

[English](../CONTRIBUTING.md) · **简体中文**

我们热烈欢迎对 SJMCL 作出任何形式的贡献，包括提交议题、开发新功能、完善文档等。🥰

以下指南介绍如何为 SJMCL 作出贡献。请在提交议题或拉取请求前花几分钟阅读这些指南。

## 行为准则

我们采用了一份所有项目参与者都应遵守的[行为准则](CODE_OF_CONDUCT.zh-Hans.md)。请花一点时间阅读其全文，了解哪些行为可以接受，哪些行为不会被容忍。

## 报告错误

我们使用 [GitHub Issues](https://github.com/UNIkeEN/SJMCL/issues) 跟踪和处理问题。请使用“错误报告”议题模板，提供有助于我们确认问题的信息，例如复现步骤、预期行为、运行环境以及其他补充信息。

报告问题前，请确保已经搜索过现有议题。

## 提出功能建议

如果您希望提出新功能建议或开发新功能，我们建议先创建议题（使用“功能建议”模板）并与核心团队讨论。这个过程有助于我们判断该功能是否适合 SJMCL，并在开始开发前进一步完善想法。

<!-- ### 您的第一个拉取请求（待完善）-->

## 提交拉取请求

核心团队会定期查看拉取请求。我们将审查您的拉取请求，然后合并、要求修改，或在说明原因后将其关闭。

**提交拉取请求前**，请确保完成以下事项：

- Fork 本仓库并创建您自己的分支。
- 在本地测试改动，确保其符合预期。
- 必要时更新文档。
- 确保代码风格和提交信息符合项目规范。（提交信息不符合规范的 PR 可能会被关闭，或在合并时压缩为单个提交。）
- 确保代码通过 lint 检查（`pnpm lint-staged`）。提示：执行 `git commit` 时会自动运行 lint 检查。
- 最后，请确保所有 GitHub CI 检查均通过。

## 开发流程

### 准备工作

本项目使用 **[Tauri v2](https://v2.tauri.app/)**。请确保已经安装 [Node.js >=22](https://nodejs.org/) 和 [Rust >=1.98.1](https://www.rust-lang.org/learn/get-started)。

我们推荐使用 `pnpm` 作为前端包管理器。克隆仓库后，使用以下命令安装依赖：

```bash
pnpm install
```

### 配置环境变量

将 `src-tauri/.env.template` 文件复制到仓库根目录并命名为 `.env`，根据模板中的注释填写所需的环境变量。

这些值将作为编译时常量嵌入 Rust 后端。

### 本地运行

以开发模式运行项目。

```bash
pnpm tauri dev
```

### 检查代码风格

我们使用 `ESLint` 和 `Prettier` 检查前端代码，并使用 `rustfmt` 检查后端代码，以确保代码风格一致。

```bash
pnpm lint-staged
```

也可以使用以下命令手动检查并修复格式问题：

```bash
# 前端部分
pnpm eslint "src/**/*.{js,jsx,ts,tsx}" --no-fix    # 检查
pnpm eslint "src/**/*.{js,jsx,ts,tsx}" --fix       # 修复

# 后端部分（Linux、macOS 或 Windows 上的 Git Bash）
rustfmt --check src-tauri/src/**/*.rs              # 检查
rustfmt src-tauri/src/**/*.rs                      # 修复

# 后端部分（Windows PowerShell）
cd src-tauri
cargo fmt -- --check src/**/*.rs                   # 检查
cargo fmt -- src/**/*.rs                           # 修复
```

如果使用 VS Code 开发本项目，我们建议在工作区设置中将 `rust-analyzer.check.command` 设为 `clippy`，以进行更严格的代码检查。

### 构建

在仓库根目录手动构建。Windows 默认生成 NSIS 安装包：

```bash
pnpm run tauri build
```

该命令会先执行前端生产构建，再编译 Rust 后端并打包。Windows 的 `dev` 和 `build` 会自动使用与 `scripts/local-check.ps1` 相同的 stable Rust 兼容参数，以绕过当前 nightly 编译 `azalea-entity` 时的编译器崩溃。请先安装 stable 和 nightly Rust 工具链。

安装包输出到 `src-tauri/target/release/bundle/nsis/`。当前版本为 `1.4.0-miu`，版本号在 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 中保持一致，工作区 crate 的版本由 Cargo 继承。

如需跨平台编译、打包为特定格式或了解更多信息，请参阅 Tauri 官方的[分发指南](https://tauri.app/distribute/)。

### GitHub 手动构建安装包

将改动推送到 GitHub 仓库的默认分支后，打开 **Actions → Build installers (manual) → Run workflow**，选择要构建的分支并运行。此 workflow 仅支持手动触发，不会因 push 或 tag 自动执行。

两个平台都构建成功后，workflow 会将安装包发布到 **Releases**，并在运行摘要中给出下载页面链接。Tag 使用 `v<package.json 版本号>`；当前为 `v1.4.0-miu`，带有 prerelease 后缀的版本会标记为预发布。同一 commit 重跑会更新其安装包；若同名 tag 已指向其他 commit，会停止发布，需要先修改版本号，不会移动已有 tag。

安装包也会保存在该次运行页面的 **Artifacts** 中：

- `SJMCL-windows-x64-installer`：Windows x64 NSIS `.exe` 安装包。
- `SJMCL-macos-universal-installer`：兼容 Intel 和 Apple Silicon 的通用 `.dmg` 安装包。

Artifacts 保留 14 天，仅上传上述安装包，不上传便携版、MSI 或单独的 `.app`。Windows 安装包未签名；macOS 使用临时签名（ad-hoc），未经过 Apple 公证。

若需内置 CurseForge API Key，在仓库 **Settings → Secrets and variables → Actions** 中添加 `SJMCL_CURSEFORGE_API_KEY` secret。未设置也可以编译，但使用 CurseForge 需要用户自行配置 API Key。CI 不读取本地 `.env`。

## 成为协作者

如果您是一名活跃贡献者，并希望与 SJMCL 团队更紧密地合作，共同推进项目开发 💪，请通过 [launcher@sjmc.club](mailto:launcher@sjmc.club) 联系我们。
