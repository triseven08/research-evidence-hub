"use client";
import {useState,useEffect,useRef,createContext,useContext,useCallback} from "react";
import {usePathname} from "next/navigation";
import {articles,categories,searchArticles,articleHref,paths} from "../../lib/content";
import {Icon} from "./icons";
import {AskPanel} from "./ask-panel";
const AskContext=createContext<()=>void>(()=>{});
export const useAsk=()=>useContext(AskContext);
export function Modal({children,onClose,label,drawer=false}:{children:React.ReactNode;onClose:()=>void;label:string;drawer?:boolean}) {
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{const before=document.activeElement as HTMLElement;const node=ref.current;const items=()=>Array.from(node?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input,textarea,select,[tabindex="0"]')||[]);items()[0]?.focus();const listener=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();if(e.key==="Tab"){const all=items(),first=all[0],last=all.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};document.addEventListener("keydown",listener);const overflow=document.body.style.overflow;document.body.style.overflow="hidden";return()=>{document.removeEventListener("keydown",listener);document.body.style.overflow=overflow;before?.focus();};},[onClose]);
 return <div className={`overlay ${drawer?"drawer-overlay":""}`} onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={ref} role="dialog" aria-modal="true" aria-label={label} className={drawer?"ask-panel":"search-dialog"}>{children}</div></div>;
}
export function Shell({children}:{children:React.ReactNode}) {
 const pathname=usePathname();const [search,setSearch]=useState(false),[ask,setAsk]=useState(false),[menu,setMenu]=useState(false),[query,setQuery]=useState("");
 const closeSearch=useCallback(()=>setSearch(false),[]),closeAsk=useCallback(()=>setAsk(false),[]);
 const articleId=pathname?.startsWith("/knowledge/")?pathname.split("/")[2]:undefined;
 const [learningPathId,setLearningPathId]=useState<string>();
 useEffect(()=>{const id=new URLSearchParams(window.location.search).get("path");setLearningPathId(paths.find(p=>p.id===id&&p.ids.includes(articleId||""))?.id);},[pathname,articleId]);
 const article=articles.find(a=>a.id===articleId);const mode=pathname?.startsWith("/paths")||learningPathId?"学习路径":pathname?.startsWith("/benchmarks")?"Benchmark":pathname?.startsWith("/explore")||pathname?.startsWith("/replays")||pathname?.startsWith("/experiments")?"前沿探索":"知识库";
 useEffect(()=>{setMenu(false);},[pathname]);
 useEffect(()=>{const handler=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();setSearch(v=>!v);}};window.addEventListener("keydown",handler);return()=>window.removeEventListener("keydown",handler);},[]);
 return <AskContext.Provider value={()=>setAsk(true)}><div className="workspace"><a className="skip-link" href="#main">跳转到内容</a>
 <aside className={`sidebar ${menu?"is-open":""}`} aria-label="主导航"><a href="/" className="brand"><span className="brand-mark">研</span><span>研知台</span><span className="brand-dot"/></a>
 <button className="sidebar-search" onClick={()=>setSearch(true)}><Icon name="search" size={16}/><span>搜索知识</span><kbd>⌘ K</kbd></button>
 <nav className="main-nav">{[{href:"/",label:"知识库",icon:"book"},{href:"/paths",label:"学习路径",icon:"route"},{href:"/benchmarks",label:"Benchmark",icon:"chart"},{href:"/explore",label:"前沿探索",icon:"compass"}].map(n=><a key={n.href} href={n.href} className={mode===n.label?"nav-item active":"nav-item"} aria-current={mode===n.label?"page":undefined}><Icon name={n.icon}/><span>{n.label}</span></a>)}</nav>
 <div className="sidebar-section"><div className="sidebar-caption">主题</div>{categories.map((c,i)=><a href={`/?category=${encodeURIComponent(c)}`} className="topic-link" key={c}><span className={`topic-dot dot-${i}`}/>{c}</a>)}</div>
 <div className="sidebar-bottom"><button className="nav-item" onClick={()=>setAsk(true)}><Icon name="ask"/><span>向知识库提问</span><Icon name="arrow-up-right" size={15}/></button><a className="repo-link" href="https://github.com/triseven08/research-evidence-hub" target="_blank" rel="noreferrer">项目源码<Icon name="external" size={12}/></a></div></aside>
 {menu&&<button aria-label="关闭导航" className="mobile-scrim" onClick={()=>setMenu(false)}/>}
 <div className="main-frame"><header className="topbar"><button className="icon-button mobile-menu" aria-label="打开导航" aria-expanded={menu} onClick={()=>setMenu(v=>!v)}><Icon name="menu"/></button><div className="breadcrumbs"><a href={mode==="知识库"?"/":mode==="学习路径"?"/paths":mode==="Benchmark"?"/benchmarks":"/explore"}>{mode}</a>{article&&<><Icon name="chevron" size={13}/><span>{article.title}</span></>}{pathname?.startsWith("/replays/")&&<><Icon name="chevron" size={13}/><span>工具调用回放</span></>}</div><div className="top-actions"><button className="icon-button" aria-label="搜索知识" onClick={()=>setSearch(true)}><Icon name="search" size={17}/></button><button className="plain-button ask-button" onClick={()=>setAsk(true)}><Icon name="ask" size={16}/>提问</button></div></header>
 <main id="main" className="main-content">{children}</main><footer className="site-footer"><span>研知台</span><a href="https://github.com/triseven08/research-evidence-hub" target="_blank" rel="noreferrer">GitHub<Icon name="arrow-up-right" size={12}/></a></footer></div>
 {search&&<Modal onClose={closeSearch} label="搜索知识"><div className="search-input-row"><Icon name="search"/><input aria-label="搜索词" placeholder="搜索概念、工具或评测…" value={query} onChange={e=>setQuery(e.target.value)}/><button className="icon-button" aria-label="关闭搜索" onClick={closeSearch}><Icon name="x"/></button></div><div className="search-results">{searchArticles(query).map(a=><a key={a.id} href={articleHref(a)} onClick={()=>{setSearch(false);setQuery("");}}><Icon name={a.icon}/><div><strong>{a.title}</strong><span>{a.category}</span></div><Icon name="enter" size={14}/></a>)}{searchArticles(query).length===0&&<div className="empty-state">没有找到相关内容，试试“工具调用”或“MCP”。</div>}</div><div className="search-foot">选择内容开始阅读 <kbd>Esc 关闭</kbd></div></Modal>}
 {ask&&<AskPanel articleId={articleId} onClose={closeAsk}/>}
 </div></AskContext.Provider>;
}
