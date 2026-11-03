"use client";

import type { LearningPath, LessonSummary } from "../../lib/learning-paths";
import { pathProgress } from "../../lib/learning-progress";
import { useLearningProgress } from "./learning-progress";
import { Icon } from "./icons";
import "./learning-map.css";

export function LearningPathList({ paths }: { paths: LearningPath[] }) {
  const { completed } = useLearningProgress();
  return <div className="learning-path-list">{paths.map((path, index) => {
    const state = pathProgress(path.ids, completed);
    return <a className="learning-path-entry" href={`/paths/${path.id}`} key={path.id}>
      <span className="learning-path-number">0{index + 1}</span>
      <div className="learning-path-copy">
        <div className="learning-path-level">{path.level}</div>
        <h2>{path.title}</h2>
        <p>{path.summary}</p>
        <div className="learning-path-preview" aria-label={`${state.count} / ${state.total} 关已通过`}>
          {path.ids.map((id, i) => <span key={id} className={completed.includes(id) ? "is-complete" : ""}>
            {completed.includes(id) ? <Icon name="check" size={13} /> : i + 1}
          </span>)}
          <span className="learning-path-count">{state.count} / {state.total}</span>
        </div>
      </div>
      <span className="learning-path-action">{state.count === state.total ? "查看地图" : state.count ? "继续闯关" : "开始闯关"}<Icon name="arrow-right" size={17} /></span>
    </a>;
  })}</div>;
}

export function LearningMap({ path, lessons }: { path: LearningPath; lessons: LessonSummary[] }) {
  const { completed } = useLearningProgress();
  const state = pathProgress(path.ids, completed);
  const next = lessons.find(lesson => lesson.id === state.nextId);

  return <>
    <div className="learning-map-summary">
      <div className="learning-map-progress">
        <span>{state.count === state.total ? "全部通关" : `已通过 ${state.count} / ${state.total} 关`}</span>
        <progress max={state.total} value={state.count} aria-label="路径完成进度" />
      </div>
      {next && <a className="primary-button" href={`/knowledge/${next.id}?path=${path.id}`}>
        {state.count ? "继续闯关" : "开始第一关"}<Icon name="arrow-right" size={16} />
      </a>}
    </div>
    <ol className="learning-map" aria-label={`${path.title}关卡地图`}>
      {lessons.map((lesson, index) => {
        const done = completed.includes(lesson.id);
        const current = lesson.id === state.nextId;
        const status = done ? "已通过" : current ? "下一关" : "未开始";
        return <li className={`learning-map-stop ${done ? "is-complete" : ""} ${current ? "is-current" : ""}`} key={lesson.id}>
          {index < lessons.length - 1 && <svg className="learning-map-connector" viewBox="0 0 130 136" aria-hidden="true"><path d={index % 2 === 0 ? "M 0 0 C 0 68, 130 68, 130 136" : "M 130 0 C 130 68, 0 68, 0 136"} /></svg>}
          <a className="learning-map-node" href={`/knowledge/${lesson.id}?path=${path.id}`} aria-current={current ? "step" : undefined}>
            <span className="learning-map-marker">{done ? <Icon name="check" size={24} /> : String(index + 1).padStart(2, "0")}</span>
            <span className="learning-map-node-copy"><span className="learning-map-status">{status}<span>·</span>{lesson.minutes} 分钟</span><strong>{lesson.title}</strong></span>
            <Icon name="arrow-right" size={18} />
          </a>
        </li>;
      })}
      <li className={`learning-map-finish ${state.count === state.total ? "is-complete" : ""}`}><span><Icon name="done" size={24} /></span>{state.count === state.total ? "已完成这条路径" : "完成全部关卡"}</li>
    </ol>
  </>;
}
