import {notFound} from "next/navigation";
import {paths,articleById} from "../../../lib/content";
import {Icon} from "../../ui/icons";
import {LearningMap} from "../../ui/learning-map";
export function generateStaticParams(){return paths.map(p=>({id:p.id}));}
export default async function PathPage({params}:{params:Promise<{id:string}>}){
 const {id}=await params;const p=paths.find(p=>p.id===id);if(!p)notFound();
 const lessons=p.ids.map(id=>{const a=articleById(id)!;return {id:a.id,title:a.title,minutes:a.minutes,icon:a.icon};});
 return <div className="path-detail"><a href="/paths" className="back-link"><Icon name="arrow-left" size={15}/>学习路径</a><h1>{p.title}</h1><p className="article-lead">{p.summary}</p><LearningMap path={p} lessons={lessons}/></div>;
}
