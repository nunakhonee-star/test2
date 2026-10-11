import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=new URL('../',import.meta.url);
const allowed=new Set(['index.html','main.js','calc.js','style.css','config.js','settings.js','tariffs.js','data/tariffs.json']);
const types={html:'text/html',js:'text/javascript',css:'text/css',json:'application/json'};
const server=createServer(async(req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
 if(!allowed.has(name)){res.writeHead(404);res.end('Not found');return;}
 try{const bytes=await readFile(new URL(name,root));res.writeHead(200,{'Content-Type':(types[name.split('.').pop()]||'application/octet-stream')+'; charset=utf-8','Cache-Control':'no-store'});res.end(bytes);}catch{res.writeHead(500);res.end('File unavailable');}
});
server.on('error',e=>{console.error('Preview failed: '+e.message);process.exitCode=1;});
server.listen(8766,'127.0.0.1',()=>{console.log('Solar Office Pro: http://127.0.0.1:8766/ - close this window to stop.');if(process.platform==='win32'&&!process.argv.includes('--no-browser'))spawn('powershell.exe',['-NoProfile','-Command',"Start-Process 'http://127.0.0.1:8766/'"],{windowsHide:true,stdio:'ignore'});});
