import { parseFile } from './core/parse';
self.onmessage=(event:MessageEvent<{buffer:ArrayBuffer;name:string;sheetName?:string}>)=>{
 try {self.postMessage({data:parseFile(event.data.buffer,event.data.name,event.data.sheetName)});}
 catch(error){self.postMessage({error:error instanceof Error?error.message:'文件解析失败。'});}
};
