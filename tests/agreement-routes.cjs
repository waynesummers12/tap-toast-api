const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const express=require(root+'/node_modules/express');
const PDFDocument=require('pdfkit');
const records=[];const files=new Map();let imports=0;
const mock={auth:{getUser:async token=>({data:{user:token==='admin'?{email:'admin@example.invalid'}:{email:'other@example.invalid'}}})},from(){
 let values,match=()=>true;
 const q={select(){return q},eq(k,v){match=r=>r[k]===v;return q},insert(v){values=v;return q},async maybeSingle(){return {data:records.find(match)||null}},async single(){if(values){records.push(values);return {data:values}}return {data:records.find(match)}}};return q;
},storage:{from(){return {upload:async(p,b)=>{files.set(p,b);return {error:null}},remove:async paths=>{paths.forEach(p=>files.delete(p));return {error:null}},createSignedUrl:async p=>({data:{signedUrl:'https://example.invalid/private-download/'+p}})}}},rpc:async()=>{imports++;return {data:'11111111-1111-4111-8111-111111111111'}}};
const libPath=require.resolve(root+'/dist/lib/supabase');require.cache[libPath]={id:libPath,filename:libPath,loaded:true,exports:{supabase:mock}};
process.env.TAP_TOAST_ADMIN_EMAILS='admin@example.invalid';
const router=require(root+'/dist/routes/agreementRoutes').default;
(async()=>{
 const app=express();app.use(express.json());app.use('/api/agreements',router);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try {
 const base=`http://127.0.0.1:${server.address().port}/api/agreements`;
 assert.equal((await fetch(base+'/upload',{method:'POST'})).status,401);
 assert.equal((await fetch(base+'/upload',{method:'POST',headers:{Authorization:'Bearer other'}})).status,403);
 const buf=await new Promise(resolve=>{let chunks=[];const doc=new PDFDocument();doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.text('Client Name: Example\nEvent Date: 10/24/2026');doc.end()});
 const upload=async(buffer=buf,name='agreement.pdf')=>{const f=new FormData();f.append('agreement',new Blob([buffer]),name);return fetch(base+'/upload',{method:'POST',headers:{Authorization:'Bearer admin'},body:f})};
 let res=await upload();let data=await res.json();assert.equal(res.status,201,JSON.stringify(data));assert.equal(data.details.name,'Example');assert.equal(records.length,1);assert.equal(files.size,1);const id=data.agreement.id;
 res=await upload();data=await res.json();assert.equal(res.status,200);assert.equal(data.agreement.id,id);assert.equal(records.length,1);
 assert.equal((await upload(Buffer.from('bad'),'agreement.txt')).status,400);assert.equal((await upload(Buffer.from('bad'),'agreement.pdf')).status,422);assert.equal((await upload(Buffer.alloc(10*1024*1024+1),'agreement.pdf')).status,400);
 const importRes=await fetch(base+'/'+id+'/import',{method:'POST',headers:{Authorization:'Bearer admin','Content-Type':'application/json'},body:JSON.stringify({reviewed:false,details:data.details})});assert.equal(importRes.status,400);assert.equal(imports,0);
 records[0].event_id='11111111-1111-4111-8111-111111111111';res=await fetch(base+'/event/'+records[0].event_id,{headers:{Authorization:'Bearer admin'}});assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');assert.match((await res.json()).agreement.url,/private-download/);
 console.log('PASS: HTTP authorization, real multipart upload/extraction, duplicate uploads, malformed/oversized files, review required, and private download links. All storage and account services mocked.');
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);process.exit(1)});
