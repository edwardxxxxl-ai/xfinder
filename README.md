# X Following Markdown Exporter

[中文说明](#中文说明) | [English](#english)

![App Screenshot](./assets/app-screenshot.png)

## English

Local web app that exports an X account's following list as Markdown by reusing your logged-in Arc session on macOS.

### What It Does

- Input any X handle, such as `@odysseyml`
- Reuse your active Arc login session for X
- Fetch that account's following list
- Generate Markdown output
- Copy or download the result as a `.md` file

### How It Works

This project does not use official X API credentials.

Instead, it:

1. Runs a local Node server
2. Temporarily switches the active Arc tab to `x.com/home`
3. Executes a small in-page script through Arc AppleScript support
4. Reads the following list through X's current web endpoints
5. Returns the result to the local web app as Markdown

This makes the tool easy to run locally, but also tightly couples it to:

- Arc being installed
- Arc AppleScript behavior
- Your existing X login session in Arc
- X's current web endpoint behavior

### Requirements

- macOS
- Arc browser installed
- Arc open on the machine
- Logged into X inside Arc
- Node.js installed

### Run Locally

```bash
git clone https://github.com/edwardxxxxl-ai/x-following-markdown-exporter.git
cd x-following-markdown-exporter
npm start
```

Then open:

```bash
http://127.0.0.1:4321
```

### Input

Accepted input examples:

- `odysseyml`
- `@odysseyml`

### Output Format

Example output:

```md
# X Following

Source: @odysseyml
Exported at: 2026-03-06T03:08:15.471Z
Total: 5

- @HuangRenee3
- @JonathanSadeghi
- @BreezeChai
```

### Project Structure

```text
server.js           Local HTTP server and Arc/X export logic
public/index.html   Single-page UI
public/styles.css   Frontend styling
```

### Limitations

- This is a local automation workflow, not a hosted SaaS app
- It currently depends on Arc, not Chrome or Safari
- X may change internal endpoints at any time
- If Arc blocks AppleScript or X changes page behavior, the exporter may break
- The app temporarily reuses the active Arc tab and then restores its URL

### Safety Notes

- The app runs locally on your machine
- It does not require storing X credentials in this repo
- It relies on your already authenticated Arc browser session

Review the code before using it with any sensitive account.

## 中文说明

这是一个本地网页工具：在 macOS 上复用你已经登录在 Arc 里的 X 会话，把任意账号的关注列表导出成 Markdown。

### 它能做什么

- 输入任意 X 用户名，例如 `@odysseyml`
- 复用你当前 Arc 中的 X 登录态
- 抓取该账号的关注列表
- 生成 Markdown 文本
- 支持复制或下载为 `.md` 文件

### 工作原理

这个项目不依赖官方 X API Key。

它的流程是：

1. 在本机启动一个 Node 服务
2. 临时把 Arc 当前标签切到 `x.com/home`
3. 通过 Arc 的 AppleScript 能力注入一小段页内脚本
4. 读取 X 当前网页可用的关注列表接口
5. 把结果回传给本地网页，并生成 Markdown

这也意味着它依赖以下前提：

- 你的机器上安装了 Arc
- Arc 仍然支持当前这套 AppleScript 控制方式
- 你已经在 Arc 中登录了 X
- X 当前网页接口没有发生破坏性变化

### 运行要求

- macOS
- 已安装 Arc 浏览器
- Arc 处于打开状态
- Arc 中已登录 X
- 本机已安装 Node.js

### 本地运行

```bash
git clone https://github.com/edwardxxxxl-ai/x-following-markdown-exporter.git
cd x-following-markdown-exporter
npm start
```

然后打开：

```bash
http://127.0.0.1:4321
```

### 输入格式

支持下面两种形式：

- `odysseyml`
- `@odysseyml`

### 输出格式

输出结果是 Markdown，例如：

```md
# X Following

Source: @odysseyml
Exported at: 2026-03-06T03:08:15.471Z
Total: 5

- @HuangRenee3
- @JonathanSadeghi
- @BreezeChai
```

### 项目结构

```text
server.js           本地 HTTP 服务与 Arc/X 导出逻辑
public/index.html   单页前端
public/styles.css   前端样式
```

### 当前限制

- 这是本地自动化工具，不是托管 SaaS
- 目前只适配 Arc，没有适配 Chrome 或 Safari
- X 内部网页接口未来可能随时变动
- 如果 Arc 限制 AppleScript，或 X 改了页面逻辑，这个工具就可能失效
- 工具会临时复用当前 Arc 活动标签页，完成后再把 URL 切回去

### 安全说明

- 工具完全运行在本地
- 仓库本身不保存你的 X 账号密码
- 它依赖的是你 Arc 浏览器中已经存在的登录态

如果你要把它用于敏感账号，建议先自行审查代码。

## License

MIT
