# LiveMCPBench 远程容器复现

## 当前范围（2026-11-03）

- 用户负责 benchmark 部分，对应 T07、T08，以及扩展对比任务。
- 目标论文是 **LiveMCPBench: Can Agents Navigate an Ocean of MCP Tools?**，固定阅读版本 `2508.01780v2`（2026-02-26），不是 LiveMCP-101。
- 用户此前要求完整复现，现已明确要求**剔除无法调用的 API**。当前范围调整为 9 个模型的部分复现，每个模型仍跑全部 95 题；不以新模型替代被剔除模型。3 题试跑只能作为环境诊断，不计为正式成绩。
- 从请求配置及实验矩阵剔除 `sonnet4`、`opus4`、`qwen235`，同时移除依赖它们的生成、裁判与 Sonnet 检索消融。`scope.json` 和最终状态保留排除原因，不将这些项算作模型失败。
- 运行环境是远程服务提供的 **Docker 容器**，可以选择 RTX A6000 或 RTX 4090。脚本在容器内执行，不调用 Docker，不要求挂载 Docker socket，不安装/修改宿主机驱动。
- 本地只编写和测试启动工具；尚未获得远程容器访问、精确模型凭证或实际 GPU 测量结果。

## 资源与完整性的边界

论文附录 G 使用 Ubuntu 22.04、4×A800-80G 和 1TB 内存，在本地部署 Qwen2.5-72B-Instruct 与 Qwen3-Embedding-0.6B，其余模型经 OpenRouter、Anthropic Console、Google AI Studio 调用。A6000（48GB）/4090（24GB）与该环境不同，不能标成硬件完全一致。

本脚本在所选 GPU 上运行 Qwen3-Embedding-0.6B；生成和评分连接**需经预检核验的论文模型接口**。BGE-M3 属于已移除的 Sonnet 消融，不再下载、启动或要求配置其 revision。不自动部署替代 7B 模型，不把量化版本、API 别名或其他提供商视为等价版本。新模板将 9 个候选模型统一映射到 OpenRouter，也可显式配置另行部署的服务；必须核对量化、权重和推理配置。Qwen2.5-72B 当前所列端点为 FP8，不能视为已证明等同论文自部署环境。公开代码的别名含 `int4`，论文对具体量化 checkpoint 的信息不足，需要补充证据。

若“完全复现”要求连硬件、历史模型服务、历史在线数据都相同，现有 A6000/4090 资源及公开材料不足。脚本实现可追溯的 9 模型实验编排，无法保证实时工具返回与论文当时一致，也不能恢复已下线模型。缺项会明确保留，不会自动降级。

## API 排除记录

核对日期为 2026-11-03；这是公开端点/公告查询，不是使用用户账号的付费推理实测，也不代表所有其他托管渠道均不可用。

| 排除模型 | 依据 |
|---|---|
| Claude-Sonnet-4-20250514 | Anthropic 官方 API 已退役；OpenRouter 端点列表为空 |
| Claude-Opus-4-20250514 | Anthropic 官方 API 已退役；OpenRouter 端点列表为空 |
| Qwen3-235B-A22B 原版 | OpenRouter 端点列表为空；不能用 Instruct-2507 等版本代替 |

依据：[Anthropic 退役公告](https://platform.claude.com/docs/en/about-claude/model-deprecations)、[Sonnet 端点](https://openrouter.ai/api/v1/models/anthropic/claude-sonnet-4/endpoints)、[Opus 端点](https://openrouter.ai/api/v1/models/anthropic/claude-opus-4/endpoints)、[Qwen235 端点](https://openrouter.ai/api/v1/models/qwen/qwen3-235b-a22b/endpoints)。

保留的 9 个模型仍须逐一通过账号、模型身份、参数与工具调用预检；Gemini 2.5 Pro 的账号权限及 GPT-5 的参数兼容性不能由“存在端点”推定。若预检失败，保留异常并停止，不静默删减更多模型。

## 一次配置、一键执行

在专用于 benchmark 的远程容器内检出本仓库。需要 Linux x86_64、Python ≥3.11（含 venv）、git，以及已经透传的 NVIDIA GPU/驱动。模型、Python/npm 包和在线工具需要容器网络可达；部分 MCP 服务还依赖浏览器、系统库或其他后端。启动器可以创建隔离的 uv/Python/Node 环境，但不会自动改宿主机、安装 Docker daemon 或通过删减工具绕过缺失依赖。

```bash
# 创建配置；已有模型配置仅移除上述 3 个条目，其余字段和 env 保留。
bash scripts/run-benchmark.sh init

# 查看当前部分复现矩阵与排除清单，不下载、不调用模型。
bash scripts/run-benchmark.sh plan

# 配置完成后静态检查。
bash scripts/run-benchmark.sh check

# 执行当前范围：预检 → GPU embedding → 9 模型主实验 → 裁判复评 → 导出。
bash scripts/run-benchmark.sh run --run-id paper-v2-available9
```

`init` 生成两份本地忽略文件。已有配置再次执行 `init` 时只删除 3 个排除模型的条目，保留其他模型的接口、凭证变量名和证据，不自动重写既有接口映射。旧 env 中未使用的变量无需提供值。

1. `.env.local`：OpenRouter 凭证、Qwen3 Embedding 的 **40 位 Hugging Face revision SHA**、GPU 配置、超时。不要填可变的 `main`/`latest`。启动器保留平台提供的 `CUDA_VISIBLE_DEVICES`；配置文件可显式覆盖。
2. `paper-models.json`：9 个保留模型各自的 request ID、base URL/密钥环境变量名、允许的响应模型名、版本与提供方证据。模板中的名称是待核对的映射，不代表已验证在线可用。`version_evidence` 和 `provider_evidence` 必须填写可追溯说明，`allowed_response_models` 必须准确填写。

原始实现统一使用 OpenAI Python SDK 的 Chat Completions。当前模板通过 OpenRouter 接入 9 个候选模型，需要确认实际路由至指定版本/提供方，且保留原调用语义。脚本不会将不支持的参数静默移除：温度 0.7、每次最多 4096 输出 token、工具调用和原重试策略均沿用上游代码。若某端点不兼容，会在开始正式实验前失败。

当前版本尚未自动锁定 OpenRouter 提供方，也未接入本地 Qwen3-32B-AWQ 的下载与服务启动；默认仍为 9 个生成/裁判模型走 API。免费 A6000 上部署 Qwen3-32B、调整共享显存以及独立 3 题诊断是后续工作，不属于此版本已验证能力。详见 [提交前审计](LiveMCPBench审计.md)。

GPU 仅加载 Qwen3 embedding 完成当前全部生成组。默认输入上限 8192，超长输入失败而非静默截断。每次正式运行记录 GPU、驱动、权重 revision、Python 包与运行配置。A6000 为推理与上下文提供更多显存余量；两种卡均须实际验证 CUDA/vLLM 兼容性。

脚本自动安装 vLLM 0.11.0 到独立环境，不覆盖容器现有 PyTorch。需要足够持久化磁盘保存上游、模型缓存和所有运行产物。应使用平台持久化目录保存仓库、`.benchmark/` 和 `private-results/`。

## 自动实验范围

全部使用 95 个不同任务，任务顺序来自固定上游数据，不抽样、不按结果筛选。

主实验模型：GPT-5、GPT-5-Mini、GPT-4.1、GPT-4.1-Mini、DeepSeek-R1-0528、DeepSeek-V3-0324、Qwen3-32B、Qwen2.5-72B-Instruct、Gemini-2.5-Pro。请求 ID 与响应身份必须在运行时分别核验。

| 实验 | 生成组 | 评分组 | 口径 |
|---|---:|---:|---|
| 表 2 主实验子集 | 9 | 9 | Qwen3 embedding、top-5；DeepSeek-V3-0324 裁判 |
| 表 4 第二裁判子集 | 0 | 9 | 同一批主实验轨迹，改用 Qwen2.5-72B |
| 裁判一致性/关键点对比子集 | 0 | 14 | 原评审集合剔除 3 个不可调用模型后剩 7 个 × 人工/自动关键点；使用已公开的 Sonnet 人工标注轨迹 |

共 32 个评分组，包含 **855 个任务生成、3040 个任务评分**，自动关键点另有约 665 次提取调用，还不包括重试和预检。费用须按实际模型端点另行估算；配置不会自动购买或追加额度。

移除表 3 的全部 Sonnet 检索消融，不生成该表或相应 McNemar 结果，也不使用其他模型代替。Kendall τ-b 只比较保留的 9 个模型，投票只使用保留的 7 个裁判，均记录参与列表，不能视为原论文完整模型集合的统计复现。

这里区分两种证据：主实验轨迹来自本次真实执行；裁判一致性实验使用上游发布的历史轨迹与对应人工标签，不能说成新生成轨迹，也不能把历史人工标签用于评价新轨迹。

## 固定版本与公开材料差异

上游固定为 `icip-cas/LiveMCPBench@36a51a1065dda49c1e503b87edf33a1e0b331a74`。该提交时间早于论文 v2；脚本与论文逐项核对，但不能假定这个提交已经表达 v2 全部实验细节。

本地核验结果：

| 文件/参数 | 公开材料现状 | 启动器处理 |
|---|---|---|
| 默认执行配置和工具元数据 | 69 Server / 525 工具 | 恢复同提交下 `original_clean_config.json`、`original_tools.json`，校验 70/527 |
| 原始检索索引 | 71 条 Server / 528 工具，其中 `Asset Price MCP` 不在执行配置 | 仅剔除该不可执行索引别名，保留其余原始向量与摘要，验证最终 70/527 |
| top-k 默认值 | README/代码默认工具数 3，论文主实验 5 | 明确设置主实验 5；当前范围不执行消融 |
| 启动时重新生成索引 | 可能引入新的摘要/向量或额外 API 调用 | 在隔离工作副本中禁用这一行；显式指定冻结索引路径，记录修改与文件哈希 |
| embedding 一致性 | 原始索引缺少完整 checkpoint/预处理说明 | 每个 Server 描述重算向量，检查维度与余弦相似度≥0.999；不匹配就停止，不自动换索引 |
| BGE 消融 | 原实验依赖 Sonnet 4 | 当前范围已排除，不要求 BGE 权重或索引 |
| Agent 与评审行为 | SDK 参数、提示、重试、工具结果截断和评分提取均在公开代码中 | 保留原实现；外层仅采集用量、校验模型身份、保存轨迹和完整分母 |
| 异常任务 | 上游评分可能跳过或将不可解析响应记 0 | 单独记录 infra/judge error；保留原输出，不算正常模型失败 |
| `Steps` | 原始 Sonnet 轨迹 95 题消息总数均值为 20.0947，与表 2 的 20.09 对应 | 统计全部 messages；额外记录 route、execute、不同 server/tool 对与 API token 用量 |

适配层显式向 MCP Copilot 子进程传递检索端点、索引和 top-k 设置，使用当前 Python 解释器；不将生成 API 密钥传给该子进程。Copilot 初始化失败立即记录为环境异常。模型探针使用与 Agent 相容的自动工具选择，检查返回的工具名和参数，不额外要求接口支持强制指定工具。

所有 70 个 Server 都执行初始化和 `list_tools`，工具名及输入 schema 必须与原元数据一致才能进入正式任务。检查失败不删 Server；`docker-mcp` 等后端若在现有容器中不可用，会成为复现阻塞。`@latest` 包版本、服务实现变化和在线数据漂移仍需记录容器镜像及运行来源，schema 一致不等于行为完全相同。

生成实验之间分别准备原始数据附件副本，固定 `/root/...` 路径；同一配置内按上游顺序持续运行。只替换启动器自己创建的符号链接，遇到容器里已有的同名数据路径就停止，避免覆盖。除此之外的工具持久状态仍需用容器快照或人工复核保证配置间独立，脚本不声称提供完整容器级隔离。

## 输出、中断与验收

原始产物写入 `private-results/<run-id>/`，目录默认仅当前用户可读写，不自动进入网站或公开目录：

- `config.json`、`matrix.json`、`task_ids.json`、`scope.json`：配置指纹、当前计划、95 个任务 ID、排除模型与实验及原因。
- `inventory.json`、`tool-health.json`、`gpu.txt`、各环境包清单：实际环境证据。
- `<实验ID>/tasks.json`、`summary.json`：每题最终状态及 `N=S+F+I+J+U`。
- 每题 `trajectory.json`、`partial.json`、原始评分输出、用量：追溯与诊断。
- `judge-responses.json`：保留裁判原始文本，严格校验唯一 Status，再与上游解析结果交叉核对；歧义响应计为评分异常。
- `tables/`：表 2/4 子集、一致性、7 裁判投票和 9 模型 Kendall τ-b 的可复算数据。缺失值不填 0；不生成表 3 或新 Claude 标注模板。
- `reproduction-review.json`：当前部分复现范围的人工证据清单；填写运行目录内的证据文件相对路径、审核人和时间。
- `reproduction-status.json`：自动阶段、人工阶段及当前范围完成状态 `scope_complete`；`complete` 和 `full_paper_complete` 始终为 false，防止误标为完整论文复现。

题目覆盖或证据文件不全时，汇总表的成功率留空并标记未完成，不生成对应排名/投票统计。重新分析会清除过期的派生表；所有模型成功率相同导致 Kendall τ-b 无定义时，导出 JSON null 而非 NaN。公开轨迹的人工标签缺失也会阻止当前范围通过验收。

```bash
# 仅继续未启动的计划任务；不会把已失败任务重新抽到成功。
bash scripts/run-benchmark.sh run --run-id paper-v2-available9 --resume

# 补充人工证据后仅重新计算统计，不调用模型。
bash scripts/run-benchmark.sh analyze --run-id paper-v2-available9
```

每题启动前持久化 in-flight 状态，成功后原子写回。被中断的 attempt 保留为异常，不会在 resume 中悄悄重跑；需要重复实验时使用新 run ID，并披露旧 attempt。恢复要求模型、数据、脚本、参数和端点指纹相同。每个配置的原始轨迹只能计入本次对应的正式尝试。

退出码：`0` 表示命令成功（run/analyze 时要求当前范围的 `scope_complete=true`）；`2` 表示资源/配置阻塞、未完成项或人工证据缺失；`130` 表示中断。退出码 0 也不代表论文完整复现；不能仅凭“进程结束”认定实验范围以外的工作已完成。超时是外层 watchdog，不作为论文的新增轮数限制，也不会把超时转成普通失败分数。

自动编排结束仍需复核保留模型的版本/量化/提供方、工具环境、检索预处理、论文与代码差异、保留结果及排除说明和费用口径。人工证据不由脚本伪造。被移除的新 Claude 人工分析不再阻塞当前范围验收，但完整论文复现仍为 false。

范围变更后使用新 run ID。旧 12 模型运行不能用新版 `--resume` 接续，也不能用新版 `analyze` 重新解释成 9 模型运行；代码指纹和矩阵检查会拒绝混用。

## 本地验证

```bash
python3 -m unittest discover -s tests -v
bash -n scripts/run-benchmark.sh
bash scripts/run-benchmark.sh plan
# 可选：与已下载的固定上游快照做 70/527 集成核验。
LIVEMCPBENCH_TEST_UPSTREAM=/path/to/LiveMCPBench python3 -m unittest discover -s tests -v
```

本地无远程 GPU 和所需模型凭证，因此此处验证的是脚本、统计、失败/中断处理和上游快照，不是实际模型推理或全量论文复现。

## 原始依据

- [论文 v2（§3–4、附录 G–H）](https://arxiv.org/html/2508.01780v2)
- [固定上游代码](https://github.com/icip-cas/LiveMCPBench/tree/36a51a1065dda49c1e503b87edf33a1e0b331a74)
- [vLLM 0.11.0 pooling 模型](https://docs.vllm.ai/en/v0.11.0/models/pooling_models.html)
- [NVIDIA RTX A6000](https://www.nvidia.com/en-gb/products/workstations/quadro/rtx-a6000/)、[RTX 4090](https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/rtx-4090/)
