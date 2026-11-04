# 研知台 · Agent 知识探索

围绕“知识挖掘与探索”，向用户介绍 Agent、工具调用与相关前沿方向。把已有调研整理成可阅读的知识库和学习路径，结合带引用答疑、公开评测结果和工具调用案例帮助理解。

benchmark 展示保留预先录制的工具调用回放：查看任务的工具发现、调用、返回和结果，支持播放/暂停及逐步查看；播放已有记录不调用模型、不执行工具，也不消耗生成额度。

- [需求文档](docs/需求文档.md)：产品范围、Notion Style、调用额度与验收。
- [资料与内容清单](docs/资料清单.md)：已有资料、学习内容和待补充信息。
- [模型与知识库方案](docs/知识库与模型接入方案.md)：DeepSeek、检索、引用和费用控制。

已实现 8 篇知识短文、3 条学习路径及四项 benchmark 专题。Benchmark 提供横向对照、来源和条件分组的外部成绩、流程解释及回放；论文成绩不是团队实测，榜单为人工核验快照，不承诺实时更新。LiveMCPBench 与 ToolBench 使用作者公开轨迹的脱敏摘要；HumanMCP 和 MCP-Zero 为论文机制示意。官方榜单截图再发布许可未确认，保留来源入口而不复制其成绩。

视觉采用 [Notion Style](https://www.stylekit.top/zh/styles/notion-style)。内容优先，通过布局、留白和排版表达层次，删除不必要的副标题、说明与装饰。

学习路径以关卡地图组织已有文章，每关配一道概念题，答对后记录完成并推荐下一关。同篇文章在三条路径间共享通关状态，兼容已有按路径保存的进度。进度存于当前浏览器的 localStorage，无需登录；各关仍可自由阅读。从路径进入文章后，上一关、下一关和返回地图均保留所选路径。题目维护在 `lib/learning-paths.ts`。

提问面板保存最近 50 条问题、回答与引用，以及当前草稿；关闭重开、切换页面和刷新后可恢复，通过“历史记录”查看。历史存于当前站点的浏览器 localStorage，查看记录不会请求模型，也不恢复过期的额度快照。回答等待期间关闭面板，返回结果仍会保存；刷新中断的请求不会自动重试。

助手的系统提示词包含项目定位、实际知识条目、学习路径和功能边界。问候与功能介绍直接回答；课题问题优先引用检索片段，未检索到充分依据时仍可用模型知识解释，由后端加上“未检索到足以支持此回答的知识库依据，以下结论仅供参考”。模型返回回答依据类型，页面和本地历史保留该区分。所有新生成均经过额度与费用预留，缓存命中不新增调用。

前端使用 React / TypeScript 与 Vinext，内容保存在 JSON，额度与缓存保存在 Cloudflare D1。生成服务使用 DeepSeek，密钥只放服务端。正式环境每位访客 100 次/日、3 次/分钟，全站预算上限 5 美元/日，输出上限 2000 tokens。本地可选择测试额度，浏览器不能切换配置。

输入预算默认 12000（实现按完整消息的 UTF-8 字节数保守限制），为项目背景、最长问题和证据预留空间；输出上限不变。已有部署如显式设置了 `API_CONTEXT_MAX_TOKENS=4000`，升级时应改为 `12000`；配置过小导致完整指令和问题放不下时会在调用前提示缩短问题。

跨页面跳转使用浏览器原生链接。发布构建曾出现客户端路由拦截点击后抛错，导致文章、学习路径等入口无响应；无需依赖该路由完成阅读跳转。验证导航时须使用生产构建并实际单击，不能仅检查页面地址返回 200。

## 本地运行

需要 Node.js 22.13+。本地答疑只需要一个模型密钥：

```powershell
npm ci
copy .env.example .dev.vars   # 填入 DEEPSEEK_API_KEY
npm run dev                   # http://127.0.0.1:5173
```

本地访问时服务端会自动使用**进程内存储**代替 D1，并允许省略 `COOKIE_SECRET`（使用固定的本地开发密钥）。因此不必建库、不必跑迁移，知识库、学习路径、回放和带引用答疑都能直接使用。进程重启后额度与回答缓存清零；生产环境仍然使用 D1。

### 本地 API 配置选项

本地开发读取 `.dev.vars`（由 Wrangler/Vite 插件注入 Worker 环境）；`.env.local` 只用于本机脚本与构建工具。两份文件都被 Git 忽略，不要提交真实密钥。

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `DEEPSEEK_API_KEY` | 提问必填 | 空 | 仅服务端读取。为空时浏览与回放正常，提问返回「答疑服务暂不可用」 |
| `DEEPSEEK_MODEL` | 否 | `deepseek-flash` | 必须是该值，否则服务端返回「答疑服务尚未配置完成」 |
| `COOKIE_SECRET` | 生产必填 | 本地使用内置开发值 | 至少 24 字符；本地省略时自动使用开发密钥 |
| `QUOTA_STORE` | 否 | 本地为 `memory` | 设为 `d1` 可在本地使用真实 D1 存储 |
| `APP_ENV` | 否 | `production` | 设为 `testing` 且仅本机访问时启用提高后的额度 |
| `DEEPSEEK_BASE_URL` | 否 | `https://api.deepseek.com` | 代理或兼容端点 |
| `DEEPSEEK_MAX_OUTPUT_TOKENS` | 否 | `2000` | 单次输出上限 |
| `API_USER_DAILY_LIMIT` / `API_TEST_USER_DAILY_LIMIT` | 否 | 100 / 1000 | 每位访客每日次数 |
| `API_USER_MINUTE_LIMIT` / `API_TEST_USER_MINUTE_LIMIT` | 否 | 3 / 20 | 每位访客每分钟次数 |
| `API_IP_DAILY_LIMIT` / `API_TEST_IP_DAILY_LIMIT` | 否 | 500 / 3000 | 单个 IP 每日次数 |
| `API_IP_MINUTE_LIMIT` / `API_TEST_IP_MINUTE_LIMIT` | 否 | 10 / 60 | 单个 IP 每分钟次数 |
| `API_SITE_DAILY_LIMIT` / `API_TEST_SITE_DAILY_LIMIT` | 否 | 1000 / 3000 | 全站每日次数 |
| `API_SITE_DAILY_BUDGET_USD` | 否 | `5.00` | 全站每日费用护栏 |
| `API_USER_CONCURRENCY` / `API_SITE_CONCURRENCY` | 否 | 1 / 2 | 并发上限 |
| `API_QUESTION_MAX_CHARS` | 否 | `2000` | 问题长度上限 |
| `API_CONTEXT_MAX_TOKENS` | 否 | `4000` | 检索证据预算 |
| `API_TIMEOUT_SECONDS` | 否 | `30` | 上游超时 |

需要与生产一致的 D1 行为时，在 `.dev.vars` 增加 `QUOTA_STORE=d1`，并按顺序执行一次迁移：

```powershell
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_watery_vermin.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_careless_xorn.sql
```

`npm test` 检查额度、竞态、引用、检索与实验导入，`npm run typecheck` 检查类型。已完成 15 道真实模型验收题与两道修复复测；本地记录 16 次上游请求，按峰时费率保守核算约 0.0053 美元。版本差异题检验解释口径，不代表已经运行两个版本的 benchmark。

## 内容与实验

审核后的正文维护在 `content/articles.json` 和 `content/benchmarks.json`，外部成绩快照在 `content/benchmark-results.json`，作者轨迹摘要在 `content/author-replays.json`，学习路径在 `lib/content.ts`。仅 `review_status=reviewed` 的文章进入检索；原始调研附件不直接公开。

四项 benchmark 已对照固定版本来源核验，具体差异见 [资料清单](docs/资料清单.md#2026-11-03-内容核验)。成绩保留表格位置、样本量及未知运行时间；回放区分事件返回状态、作者评审和本站内容核对。ToolBench 成绩采用 README 的明确 Win Rate 表，避免官网 CSV 子集列的指标混用。

团队自行评测属于可选扩展，并非首版必交成果。若团队未来进行评测，可将脱敏后的 `{experiment,replays}` JSON 交给平台，数据结构见 `lib/experiments.ts`；`tests/experiments.test.ts` 中的 fixture 只用于校验，不发布为成绩。

```powershell
npm run import:experiment -- ./private-results/run.json --check
npm run import:experiment -- ./private-results/run.json
```

导入会检查状态分母、逐题结果、运行/任务/尝试与回放关联、连续事件顺序及常见凭证字段。导入后核对 `content/experiments.json` 与 `content/replays.json`，再提交发布。未知 token/费用保留 `null`，子集单独标记；回放只能展示已保存事件，不执行其中的命令。

项目仍按团队的周二至周四开发窗口规划。依据本地校园赛细则：周三晚应冻结演示，周四 12:00 截止修改；最新截止与材料要求以学校通知为准。交付需准备 README、源码、官方模板海报与不超过 3 分钟的视频。

本仓库原创内容采用 [MIT](LICENSE)；第三方资料遵循各自许可。原始实训附件与未脱敏日志不直接发布，论文报告成绩、团队实测和预设演示分开展示。