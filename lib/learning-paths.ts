import { paths } from "./content.ts";

export type LearningPath = typeof paths[number];
export type LessonSummary = { id: string; title: string; minutes: number; icon: string };
export type Checkpoint = { question: string; choices: string[]; answer: number; explanation: string; section: string };

export function learningPathForArticle(pathId: string | undefined, articleId: string) {
  return paths.find(path => path.id === pathId && path.ids.includes(articleId));
}

export const checkpoints: Record<string, Checkpoint> = {
  "what-is-agent": {
    question: "模型提出搜索请求后，谁真正执行搜索？",
    choices: ["模型生成请求时就完成了搜索", "宿主程序校验并执行工具", "用户必须手动执行每一步"],
    answer: 1, explanation: "模型提出下一步动作，宿主程序负责校验和执行，再把结果交回模型。", section: "loop",
  },
  "tool-calling": {
    question: "查询天气的工具缺少必填地点，且上下文没有地点信息，应该怎么做？",
    choices: ["猜测用户最可能所在的城市", "省略地点直接调用", "先向用户补问地点"],
    answer: 2, explanation: "必需参数缺失且无法从已授权上下文获得时，需要先补齐条件。", section: "missing",
  },
  "mcp-architecture": {
    question: "一个 MCP Server 与工具是什么关系？",
    choices: ["一个 Server 可以提供多个工具", "一个 Server 只能提供一个工具", "Server 负责替模型选择所有工具"],
    answer: 0, explanation: "Server 提供协议能力，可以包含搜索、读取和查询等多个工具入口。", section: "roles",
  },
  "tool-discovery": {
    question: "候选工具变少之后，还需要检查什么？",
    choices: ["只要输入变短，就说明任务能力提高了", "关键工具是否被召回，以及任务能否完成", "只比较工具目录的总大小"],
    answer: 1, explanation: "缩小候选集合节省上下文，但遗漏关键工具会影响后续任务。", section: "recall",
  },
  planning: {
    question: "哪两步适合并行执行？",
    choices: ["先查论文 ID，再用该 ID 读取全文", "先创建文件，再修改同一文件", "分别查询两篇互不依赖的论文摘要"],
    answer: 2, explanation: "并行步骤不应依赖彼此尚未得到的输入，也不应产生冲突的状态变化。", section: "dependency",
  },
  "context-and-skills": {
    question: "本网站通过 RAG 把资料交给模型，会发生什么？",
    choices: ["模型在本次输入中收到检索到的证据", "资料被永久写入模型权重", "模型自动读到整个本地文件夹"],
    answer: 0, explanation: "RAG 将检索片段放入本次上下文，让模型据此回答。", section: "context",
  },
  "reading-benchmarks": {
    question: "比较两个模型的评测分数时，首先需要核对什么？",
    choices: ["是否使用相同型号的 GPU", "任务、工具环境与评分条件是否一致", "模型参数量是否完全相同"],
    answer: 1, explanation: "任务范围、工具条件和评分方法决定分数的含义，不能只按数值比较。", section: "scope",
  },
  frontiers: {
    question: "要定位一个多步任务的失败原因，哪种材料更有帮助？",
    choices: ["只比较最终回答的长度", "只检查工具接口是否都返回成功", "检查工具选择、参数、返回与后续决策的轨迹"],
    answer: 2, explanation: "逐步轨迹能区分选错工具、参数错误、结果综合错误和提前停止。", section: "feedback",
  },
};
