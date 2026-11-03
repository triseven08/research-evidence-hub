# 研知台 · Agent 知识探索

围绕“知识挖掘与探索”，向用户介绍 Agent、工具调用与相关前沿方向。把已有调研整理成可阅读的知识库和学习路径，结合带引用答疑、公开评测结果和工具调用案例帮助理解。

benchmark 展示保留预先录制的工具调用回放：查看任务的工具发现、调用、返回和结果，支持播放/暂停及逐步查看；播放已有记录不调用模型、不执行工具，也不消耗生成额度。

- [需求文档](docs/需求文档.md)：产品范围、Notion Style、调用额度与验收。
- [资料与内容清单](docs/资料清单.md)：已有资料、学习内容和待补充信息。
- [模型与知识库方案](docs/知识库与模型接入方案.md)：DeepSeek、检索、引用和费用控制。

已实现 8 篇知识短文、3 条学习路径及四项 benchmark 专题。前沿探索提供横向对照、来源和条件分组的外部成绩、流程解释及回放；论文成绩不是团队实测，榜单为人工核验快照，不承诺实时更新。LiveMCPBench 与 ToolBench 使用作者公开轨迹的脱敏摘要；HumanMCP 和 MCP-Zero 为论文机制示意。官方榜单截图再发布许可未确认，保留来源入口而不复制其成绩。

视觉采用 [Notion Style](https://www.stylekit.top/zh/styles/notion-style)。内容优先，通过布局、留白和排版表达层次，删除不必要的副标题、说明与装饰。

学习路径以关卡地图组织已有文章，每关配一道概念题，答对后记录完成并推荐下一关。进度存于当前浏览器的 localStorage，无需登录；各关仍可自由阅读。从路径进入文章后，上一关、下一关和返回地图均保留所选路径。题目维护在 `lib/learning-paths.ts`。

前端使用 React / TypeScript 与 Vinext，内容保存在 JSON，额度与缓存保存在 Cloudflare D1。生成服务使用 DeepSeek，密钥只放服务端。正式环境每位访客 100 次/日、3 次/分钟，全站预算上限 5 美元/日，输出上限 2000 tokens。本地可选择测试额度，浏览器不能切换配置。

跨页面跳转使用浏览器原生链接。发布构建曾出现客户端路由拦截点击后抛错，导致文章、学习路径等入口无响应；无需依赖该路由完成阅读跳转。验证导航时须使用生产构建并实际单击，不能仅检查页面地址返回 200。

## 本地运行

需要 Node.js 22.13+。安装后，将 `.env.example` 复制为 `.env.local`，填写自己的 `DEEPSEEK_API_KEY`，并为 `COOKIE_SECRET` 生成至少 24 字符的随机值；再将配置复制为 `.dev.vars`，供本地 Worker 读取。两份文件均被 Git 忽略，不互相发送密钥。

```powershell
npm run install:ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_watery_vermin.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_careless_xorn.sql
npm run dev -- --port 5173 --hostname 127.0.0.1
```

以上 SQL 只在新建本地库时按顺序执行一次。没有模型密钥时仍可阅读和播放回放；问答不会退化成无限制调用。仅本机测试时可在 `.dev.vars` 设置 `APP_ENV=testing`，额度提高到 1000 次/日、20 次/分钟，费用上限仍为 5 美元。

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
