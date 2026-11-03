"use client";

import { useState } from "react";
import type { Checkpoint } from "../../lib/learning-paths";
import { useLearningProgress } from "./learning-progress";
import { Icon } from "./icons";
import "./learning-map.css";

export function LessonCheckpoint({ checkpoint, pathId, articleId, nextHref }: {
  checkpoint: Checkpoint; pathId: string; articleId: string; nextHref?: string;
}) {
  const { completed, complete } = useLearningProgress();
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<"correct" | "incorrect" | null>(null);
  const [saved, setSaved] = useState(true);
  const done = completed.includes(articleId);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (selected === null) return;
    if (selected !== checkpoint.answer) { setResult("incorrect"); return; }
    setResult("correct");
    setSaved(complete(pathId, articleId));
  }

  return <section className="lesson-checkpoint" aria-labelledby="checkpoint-heading">
    <div className="checkpoint-heading"><h2 id="checkpoint-heading">过关一题</h2>{done && <span><Icon name="check" size={15} />已通过</span>}</div>
    <form onSubmit={submit}>
      <fieldset><legend>{checkpoint.question}</legend>
        {checkpoint.choices.map((choice, index) => <label className={`checkpoint-choice ${selected === index ? "is-selected" : ""}`} key={choice}>
          <input type="radio" name="checkpoint" value={index} checked={selected === index} onChange={() => { setSelected(index); setResult(null); }} />
          <span>{choice}</span>
        </label>)}
      </fieldset>
      <div className="checkpoint-actions"><button className="primary-button" type="submit" disabled={selected === null}>检查答案<Icon name="check" size={16} /></button>
        {(done || result === "correct") && <a className="checkpoint-next" href={nextHref || `/paths/${pathId}`}>{nextHref ? "进入下一关" : "返回地图"}<Icon name="arrow-right" size={16} /></a>}
      </div>
      <div aria-live="polite" className="checkpoint-feedback">
        {result === "incorrect" && <p>再想一想，或<a href={`#${checkpoint.section}`}>回看相关内容</a>。</p>}
        {result === "correct" && <p className="is-correct">回答正确。{checkpoint.explanation}</p>}
        {!saved && <p role="alert">浏览器未能保存进度，关闭页面后可能丢失。</p>}
      </div>
    </form>
  </section>;
}
