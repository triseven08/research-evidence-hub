"use client";
import {useState} from "react";
import type {FigureInfo} from "../../lib/benchmark-figures";
import {figureSteps} from "../../lib/benchmark-figure-steps";
export function BenchmarkDiagram({figure,id}:{figure:FigureInfo;id:string}){
 const [active,setActive]=useState(0);const steps=figureSteps[id];if(!steps?.length)return null;const step=steps[active];const [x,y,w,h]=step.box;
 return <section className="diagram-section"><h2>跟着论文原图看流程</h2><p>{figure.explanation}</p><p className="benchmark-note">点击“下一步”查看图中对应区域及解释。图片来自论文，描边和阴影是本站添加的阅读引导。</p><div className="figure-walkthrough"><div className="figure-stage-scroll"><div className="figure-original"><img src={figure.image} alt={figure.label}/><span className="figure-highlight" aria-hidden="true" style={{left:`${x}%`,top:`${y}%`,width:`${w}%`,height:`${h}%`}}/></div></div><div className="figure-explanation" aria-live="polite"><div><span>步骤 {active+1} / {steps.length}</span><h3>{step.title}</h3><p>{step.text}</p></div></div><div className="figure-controls"><button onClick={()=>setActive(0)} disabled={active===0}>重置</button><div><button onClick={()=>setActive(i=>i-1)} disabled={active===0}>上一步</button><button className="figure-next" onClick={()=>setActive(i=>i+1)} disabled={active===steps.length-1}>下一步</button></div></div></div><p className="paper-figure-credit">{figure.label} · <a href={figure.paper} target="_blank" rel="noreferrer">查看论文原图 ↗</a>；原图无法加载时请打开论文。</p></section>;
}
