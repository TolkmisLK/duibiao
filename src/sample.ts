import type { TableData } from './core/types';
const columns=['设备编号','设备名称','位置','负责人','数量'];
function table(name:string,rows:string[][]):TableData{return {name,columns:[...columns],rows:rows.map((row,i)=>({rowNumber:i+2,values:Object.fromEntries(columns.map((col,j)=>[col,row[j]]))})),warnings:[]};}
export function sampleTables():[TableData,TableData]{
return [table('设备清单 · 上周.csv',[
['001','会议摄像头','会议室 A','林然','2'],
['002','无线投屏器','会议室 A','周序','1'],
['003','显示器','设计区','陈禾','4'],
['004','移动硬盘','资料室','林然','3'],
['005','标签打印机','前台','沈知','1'],
['006','拾音麦克风','会议室 B','周序','2'],
]),table('设备清单 · 本周.csv',[
['003','显示器','设计区','陈禾','5'],
['001','会议摄像头','会议室 A','林然','2'],
['002','无线投屏器','会议室 B','周序','1'],
['005','标签打印机','前台','沈知','1'],
['006','拾音麦克风','会议室 B','陈禾','2'],
['007','平板电脑','会议室 A','沈知','2'],
])];}
