import {paths} from "../../lib/content";
import {Icon} from "../ui/icons";
import {LearningPathList} from "../ui/learning-map";

export default function PathsPage(){return <div className="paths-page"><div className="page-heading"><div className="page-icon"><Icon name="route" size={30}/></div><h1>学习路径</h1></div><LearningPathList paths={paths}/></div>;}
