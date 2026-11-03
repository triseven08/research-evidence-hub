export type ReplayInfo={outcome:string;position:string;method:string;analysis:string;assessment:string};
export const replayInteraction:Record<string,{conversation:string;tools:string}>={
 "live-arxiv":{conversation:"单轮：1 次用户请求",tools:"多轮：1 次检索、1 次工具执行"},
 "live-parking":{conversation:"单轮：1 次用户请求",tools:"多轮：1 次检索、2 次工具执行"},
 "live-sales-chart":{conversation:"单轮：1 次用户请求",tools:"多轮：12 次检索、11 次工具执行"},
 "live-bib-failure":{conversation:"单轮：1 次用户请求",tools:"多轮：11 次检索、8 次工具执行"},
 "toolbench-training-joke":{conversation:"单轮：1 次用户请求",tools:"多轮：2 次 API 查询，再提交回答"},
 "toolbench-tree":{conversation:"单轮：1 次用户请求",tools:"多轮：多个 API 查询，展示调用树的一条路径"},
 "toolbench-giveup":{conversation:"单轮：1 次用户请求",tools:"多轮：3 次 API 查询，随后放弃"}
};
export const replayInfo:Record<string,ReplayInfo>={
 "live-bib-failure":{outcome:"作者评审：失败",position:"公开轨迹文件第 67 条；任务 ID 71a7a42a-54af-4552-ad9b-d36f4912cc1c",method:"Claude-Sonnet-4-20250514；Qwen3-Embedding-0.6B 检索；DeepSeek-V3 评审",assessment:"作者评审记录为失败，但该条记录没有提供详细理由。",analysis:"轨迹中模型尝试 11 次工具检索及 8 次工具执行，经过多次参数校验错误后成功读取参考文献，但写文件调用仍报错；最终只在回答里提供文本，没有完成 Word 文件交付。这是依据可见轨迹的分析，不是作者评审给出的理由。"},
 "live-sales-chart":{outcome:"作者评审：成功",position:"公开轨迹文件第 16 条；任务 ID 4de2e9f7-f3ea-4d02-8532-0a1b0b530609",method:"Claude-Sonnet-4-20250514；Qwen3-Embedding-0.6B 检索；DeepSeek-V3 评审",assessment:"作者评审判为成功，依据包括读取表格、生成图片及工具记录中的文件存在信息。",analysis:"该轨迹含单次用户请求、12 次工具检索及 11 次工具执行。Agent 遇到未知工具、图片获取受限和 Python 启动超时后继续查找替代方案，最终得到保存及文件存在的返回。本回放压缩相邻检索与重复尝试，不代表每条原始消息；文件内容未由本站独立复核。"},
 "live-arxiv":{outcome:"作者评审：成功",position:"公开轨迹文件第 27 条；任务 ID 7bda47e8-1b8b-4f1f-b67c-573a81417d36",method:"Claude-Sonnet-4-20250514；MCP Copilot，Qwen3-Embedding-0.6B 检索；DeepSeek-V3 评审",assessment:"作者评审将此题标为成功，认为回答覆盖论文介绍；其推断含有全文信息。",analysis:"可观察到的成功因素是按论文 ID 找到 get_paper_data，返回标题、作者和摘要后生成介绍。局限是任务标注还要求读取全文，但公开消息没有看到 fetch 全文调用；评审把全面的介绍视作全文内容的间接证据，这一判断应保留争议。"},
 "live-parking":{outcome:"作者评审：失败",position:"公开轨迹文件第 3 条；任务 ID dda8ea55-629c-4ae8-ab87-0c81477ae615",method:"Claude-Sonnet-4-20250514；MCP Copilot，Qwen3-Embedding-0.6B 检索；DeepSeek-V3 评审",assessment:"作者评审标为失败：回答未提供具体停车设施，景点地址也未完整给出。",analysis:"停车查询返回空列表，Agent 未能提供任务要求的停车点；附近地点虽然有结果，回答仍未补足可读地址。空列表本身不代表附近现实中没有停车场，单凭日志也无法确定是数据覆盖还是检索条件导致。"},
 "toolbench-giveup":{outcome:"模型放弃；样例 win=false",position:"官方 G2 示例，文件 ID 10（不推断为完整任务集的第 10 条）",method:"ChatGPT-DFSDT；具体模型版本和独立评分器未记录",assessment:"最终调用 Finish 并选择 give_up_and_restart，公开样例 win=false；尚未找到独立 ToolEval 逐题评分。",analysis:"两次包裹查询分别返回未找到与空响应，邮编查询超时，模型没有得到完成任务所需的信息并放弃。记录支持这些直接原因，但不能据此认定服务永久不可用或运单和邮编无效。"},
 "toolbench-training-joke":{outcome:"人工核对：回答覆盖两项要求；无独立评分",position:"第三方镜像训练集第 12 条（row_idx 11），非排行榜测试集",method:"ToolBench 训练数据生成轨迹；具体模型版本和独立评分器未记录",assessment:"两次工具均有返回，最终回答同时包含笑话和数字性质。此为本站对可见内容的核对，不是官方逐题评分。",analysis:"模型分别调用笑话与数字知识 API，并在最终回答中合并两项结果。该轨迹属于训练数据镜像，不能用作模型榜单测试成绩或推断具体模型在测试集上通过。"},
 "toolbench-tree":{outcome:"输出存在目标不匹配；官方逐题评分未确认",position:"官方 G1 示例，文件 ID 10（不推断为整个任务集的第 10 条）",method:"ChatGPT-DFSDT；具体模型版本和评分器未记录",assessment:"可见最终回答将 ACT 机构的详情作为 Gondrand 联系方式，且没有列出完整机构。官方逐题评分未核实。",analysis:"模型能取得机构列表和 ACT 详情，但详情查询参数选择了 ACT 而不是目标 Gondrand。接口成功返回不代表目标选择正确；本分析依据公开路径作人工核对，不冒充官方失败判定。"},
 "human-demo-success":{outcome:"教学假设：命中；不是模型实测",position:"教学构造；非 HumanMCP 已核验任务",method:"模拟直接选择；没有真实模型或评分器",assessment:"教学示例把选择名称与预设目标做精确匹配。",analysis:"假设选中的 search_repositories 与预设目标相同，因而命中；本案例没有实际模型预测或真实评测成绩。"},
 "human-demo-failure":{outcome:"教学假设：未命中；不是模型实测",position:"教学构造；非 HumanMCP 已核验任务",method:"模拟直接选择；没有真实模型或评分器",assessment:"教学示例把选择名称与预设目标做精确匹配。",analysis:"假设模型选择读取文件的 get_file_contents，而目标是仓库搜索；因此按预设目标不命中。这是构造情境，不能推断真实模型为何出错。"},
 "zero-demo-success":{outcome:"教学假设：命中；不是模型实测",position:"官方 matcher 测试输入 github_repo_search；输出为教学构造",method:"模拟分层匹配；没有运行真实模型或检索器",assessment:"目标及候选结果由本站为教学假设，不是官方测试输出。",analysis:"假设 GitHub 服务和 search_repositories 均匹配预设需求，因此命中；不能据此推断官方模型成绩。"},
 "zero-demo-failure":{outcome:"教学假设：未命中；不是模型实测",position:"官方 matcher 测试输入 github_repo_search；输出为教学构造",method:"模拟分层匹配；没有运行真实模型或检索器",assessment:"目标及候选结果由本站为教学假设，不是官方测试输出。",analysis:"假设系统返回读取文件工具而非预设的仓库搜索工具，目标未命中；不能据此推断官方模型成绩。"},
};
