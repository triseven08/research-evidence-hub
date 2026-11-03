export const benchmarkTags=[
 {id:"mcp",label:"MCP 工具",group:"工具环境",description:"工具通过 MCP Server 提供；一个 Server 可以包含多个工具，Server 数与工具数不能直接等同。"},
 {id:"api",label:"REST API",group:"工具环境",description:"工具对应可调用的 Web API；接口可用性、参数和外部服务状态会影响执行。"},
 {id:"end-to-end",label:"端到端",group:"评测目标",description:"从用户任务出发，包含选择和调用工具并评估最终任务结果；分数不只反映检索。"},
 {id:"retrieval",label:"工具检索",group:"评测目标",description:"关注能否从候选工具中找到目标工具；选对工具不必然代表成功执行任务。"},
 {id:"agent-query",label:"模型主动查询",group:"发现方式",description:"模型根据当前任务或执行状态提出工具需求，再由检索器返回候选；可以进行多轮发现。"},
 {id:"pre-retrieval",label:"预检索",group:"发现方式",description:"在模型选择或执行之前，检索器先根据用户查询召回候选；具体召回数和模型方法依实验设置而定。"},
 {id:"direct-selection",label:"给定候选选择",group:"发现方式",description:"模型直接从给定候选工具中选择，不表示所有实验都使用同样数量的候选。"},
 {id:"hierarchical",label:"分层发现",group:"发现方式",description:"按 Server 与工具等层级逐步缩小范围，适合分析目录组织对发现过程的影响。"},
] as const;
export const benchmarkTagIds:Record<string,string[]>={
 livemcpbench:["mcp","end-to-end","agent-query"],
 toolbench:["api","end-to-end","pre-retrieval"],
 humanmcp:["mcp","retrieval","pre-retrieval","direct-selection"],
 "mcp-zero":["mcp","retrieval","agent-query","hierarchical"],
};
export const tagsFor=(id:string)=>benchmarkTags.filter(tag=>benchmarkTagIds[id]?.includes(tag.id));
