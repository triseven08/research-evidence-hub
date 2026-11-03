import {notFound} from "next/navigation";
import {articles,articleById,paths} from "../../../lib/content";
import {Icon} from "../../ui/icons";
import {ArticleAsk} from "../../ui/article-ask";
export function generateStaticParams(){return articles.map(a=>({id:a.id}));}
export default async function ArticlePage({params}:{params:Promise<{id:string}>}){const {id}=await params;const a=articleById(id);if(!a)notFound();const path=paths[0];const index=path.ids.indexOf(a.id);const previous=index>=0?articleById(path.ids[index-1]):undefined;const next=index>=0?articleById(path.ids[index+1]):undefined;
 return <div className="reading-layout"><article className="article-body"><div className="article-meta"><a href={`/?category=${encodeURIComponent(a.category)}`}>{a.category}</a><span>·</span><span>{a.minutes} 分钟</span><span>·</span><span>{a.level}</span></div><h1>{a.title}</h1><p className="article-lead">{a.summary}</p>
 {a.sections.map(s=><section id={s.id} key={s.id}><h2>{s.title}</h2>{s.paragraphs.map((p,i)=><p key={i}>{p}</p>)}{s.flow&&<div className="article-flow">{s.flow.map((step,i)=><div key={step}><span>{step}</span>{i<s.flow!.length-1&&<Icon name="arrow-right" size={16}/>}</div>)}</div>}{s.bullets&&<ul>{s.bullets.map(b=><li key={b}>{b}</li>)}</ul>}{s.code&&<pre><code>{s.code}</code></pre>}</section>)}
 <section className="sources-section" id="sources"><h2>参考资料</h2><ol>{a.sources.map(s=><li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}<Icon name="arrow-up-right" size={14}/></a>{s.version&&<span>{s.version}</span>}</li>)}</ol><div className="review-date">核验于 {a.updatedAt}</div></section>
 <ArticleAsk/>
 {(previous||next)&&<div className="article-pagination">{previous?<a href={`/knowledge/${previous.id}`}><span><Icon name="arrow-left" size={13}/>上一单元</span><strong>{previous.title}</strong></a>:<div/>}{next&&<a href={`/knowledge/${next.id}`} className="next-article"><span>下一单元<Icon name="arrow-right" size={13}/></span><strong>{next.title}</strong></a>}</div>}</article>
 <aside className="article-toc" aria-label="本页目录"><span>本页</span>{a.sections.map(s=><a href={`#${s.id}`} key={s.id}>{s.title}</a>)}<a href="#sources">参考资料</a><div className="toc-divider"/><a href="/paths/first-agent"><Icon name="route" size={15}/>入门学习路径</a><a href="/replays/paper-workflow-demo"><Icon name="play" size={15}/>查看调用过程</a></aside></div>;
}
