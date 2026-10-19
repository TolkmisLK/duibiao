import type { TableData } from './core/types';
export function parseInWorker(file: File, sheetName?: string): Promise<TableData> {
  return new Promise((resolve,reject)=>{
    const worker = new Worker(new URL('./parse.worker.ts',import.meta.url),{type:'module'});
    let settled=false;
    const finish=(error?:Error,value?:TableData)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();error?reject(error):resolve(value!);};
    const timer=setTimeout(()=>finish(new Error('解析超过 20 秒。请减少行数或将工作表另存为 CSV 后重试。')),20000);
    worker.onmessage=(event:MessageEvent<{data?:TableData;error?:string}>)=>event.data.error?finish(new Error(event.data.error)):finish(undefined,event.data.data);
    worker.onerror=()=>finish(new Error('无法解析该文件，请检查文件格式并重新选择。'));
    file.arrayBuffer().then(buffer=>{if(!settled)worker.postMessage({buffer,name:file.name,sheetName},[buffer]);},()=>finish(new Error('读取文件失败，请重新选择文件。')));
  });
}
