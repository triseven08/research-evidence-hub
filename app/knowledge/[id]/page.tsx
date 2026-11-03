import {notFound} from "next/navigation";
import {articles,articleById,paths} from "../../../lib/content";
import {Icon} from "../../ui/icons";
import {ArticleAsk} from "../../ui/article-ask";
import {checkpoints,learningPathForArticle} from "../../../lib/learning-paths";
import {LessonCheckpoint} from "../../ui/lesson-checkpoint";
export function generateStaticParams(){return articles.map(a=>({id:a.id}));}
export default async function ArticlePage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{path?:string}>}){
 const {id}=await params;const {path:pathId}=await searchParams;const a=articleById(id);if(!a)notFound();
 const path=learningPathForArticle(pathId,id);const index=path?.ids.indexOf(id)??-1;
 const previous=path&&index>0?articleById(path.ids[index-1]):undefined;const next=path?articleById(path.ids[index+1]):undefined;
 const lessonHref=(lessonId:string)=>`/knowledge/${lessonId}?path=${path!.id}`;
 return <div className="reading-layout"><article className="article-body">
 {path&&<div className="learning-article-context"><a href={`/paths/${path.id}`}><Icon name="arrow-left" size={15}/>{path.title}</a><span>第 {index+1} / {path.ids.length} 关</span></div>}
 <div className="article-meta"><a href={`/?category=${encodeURIComponent(a.category)}`}>{a.category}</a><span>·</span><span>{a.minutes} 分钟</span><span>·</span><span>{a.level}</span></div><h1>{a.title}</h1><p className="article-lead">{a.summary}</p>
 {a.sections.map(s=><section id={s.id} key={s.id}><h2>{s.title}</h2>{s.paragraphs.map((p,i)=><p key={i}>{p}</p>)}{s.flow&&<div className="article-flow">{s.flow.map((step,i)=><div key={step}><span>{step}</span>{i<s.flow!.length-1&&<Icon name="arrow-right" size={16}/>}</div>)}</div>}{s.bullets&&<ul>{s.bullets.map(b=><li key={b}>{b}</li>)}</ul>}{s.code&&<pre><code>{s.code}</code></pre>}</section>)}
 {path&&checkpoints[id]&&<LessonCheckpoint key={`${path.id}:${id}`} checkpoint={checkpoints[id]} pathId={path.id} articleId={id} nextHref={next?lessonHref(next.id):undefined}/>}
 <section className="sources-section" id="sources"><h2>参考资料</h2><ol>{a.sources.map(s=><li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}<Icon name="arrow-up-right" size={14}/></a>{s.version&&<span>{s.version}</span>}</li>)}</ol><div className="review-date">核验于 {a.updatedAt}</div></section>
 <ArticleAsk/>
 {path&&<div className="article-pagination">{previous?<a href={lessonHref(previous.id)}><span><Icon name="arrow-left" size={13}/>上一关</span><strong>{previous.title}</strong></a>:<a href={`/paths/${path.id}`}><span><Icon name="route" size={13}/>关卡地图</span><strong>{path.title}</strong></a>}{next?<a href={lessonHref(next.id)} className="next-article"><span>下一关<Icon name="arrow-right" size={13}/></span><strong>{next.title}</strong></a>:<a href={`/paths/${path.id}`} className="next-article"><span>返回地图<Icon name="arrow-right" size={13}/></span><strong>{path.title}</strong></a>}</div>}</article>
 <aside className="article-toc" aria-label="本页目录"><span>本页</span>{a.sections.map(s=><a href={`#${s.id}`} key={s.id}>{s.title}</a>)}{path&&checkpoints[id]&&<a href="#checkpoint-heading">过关一题</a>}<a href="#sources">参考资料</a><div className="toc-divider"/>{(path?[path]:paths.filter(p=>p.ids.includes(id))).map(p=><a key={p.id} href={`/paths/${p.id}`}><Icon name="route" size={15}/>{p.title}</a>)}<a href="/replays/paper-workflow-demo"><Icon name="play" size={15}/>查看调用过程</a></aside></div>;
}
