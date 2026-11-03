import {notFound} from "next/navigation";
import replays from "../../../content/replays.json";
import authorReplays from "../../../content/author-replays.json";
import extraReplays from "../../../content/extra-replays.json";
import {ReplayPlayer,type Replay} from "../../ui/replay-player";
const allReplays=[...replays,...authorReplays,...extraReplays];
export function generateStaticParams(){return allReplays.map(r=>({id:r.id}));}
export default async function ReplayPage({params}:{params:Promise<{id:string}>}){const {id}=await params;const replay=allReplays.find(r=>r.id===id);if(!replay)notFound();return <ReplayPlayer replay={replay as Replay}/>;}
