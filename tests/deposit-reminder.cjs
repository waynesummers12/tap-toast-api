const assert=require('node:assert/strict'), root=require('node:path').resolve(__dirname,'..');
const mock=(p,exports)=>{const id=require.resolve(p);require.cache[id]={id,filename:id,loaded:true,exports}};
let sessions=[],emails=[],fail=false,noUrl=false;
mock(root+'/node_modules/stripe',class {constructor(){this.checkout={sessions:{create:async(p,options)=>{sessions.push({p,options});return {url:noUrl?null:'https://example.invalid/pay'}}}}}});
class MockResend {
 constructor() {
  this.emails = { send: async (p, options) => {
   emails.push({p, options});
   return fail ? {error:{message:'test failure'}} : {data:{id:'test'}};
  }};
 }
}
mock(root+'/node_modules/resend', {Resend: MockResend});
const event={id:'11111111-1111-4111-8111-111111111111',event_date:'2027-06-15',deposit_amount:360.25,balance_due:360.25,deposit_paid:false,balance_paid:false,event_status:'imported',customers:{name:'Test <Client>',email:'test@example.invalid'}};
mock(root+'/dist/lib/supabase',{supabase:{auth:{getUser:async()=>({data:{user:{email:'admin@example.invalid'}}})},from(){const q={select(){return q},eq(){return q},single:async()=>({data:event})};return q}}});
process.env.TAP_TOAST_ADMIN_EMAILS='admin@example.invalid';
const express=require(root+'/node_modules/express'),app=express();app.use(express.json());app.use(require(root+'/dist/routes/emailRoutes').default);
(async()=>{const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{
 const post=(auth=true)=>fetch('http://127.0.0.1:'+server.address().port+'/reminder',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer test'}:{})},body:JSON.stringify({eventId:event.id,type:'deposit_reminder',request_id:'22222222-2222-4222-8222-222222222222'})});
 const original=JSON.stringify(event);assert.equal((await post()).status,200);assert.equal(JSON.stringify(event),original);
 assert.equal(sessions[0].p.line_items[0].price_data.unit_amount,36025);assert.equal(sessions[0].p.metadata.type,'deposit');assert.equal(sessions[0].p.metadata.event_id,event.id);
 assert.equal(emails[0].p.to,event.customers.email);assert.match(emails[0].p.html,/href="https:\/\/example.invalid\/pay"/);assert.match(emails[0].p.html,/\$360.25/);assert.match(emails[0].p.html,/Test &lt;Client&gt;/);
 assert.equal(emails[0].options.idempotencyKey,sessions[0].options.idempotencyKey);
 for(const [field,value] of [['deposit_paid',true],['balance_paid',true],['event_status','cancelled'],['status','cancelled']]) {const old=event[field],n=sessions.length;event[field]=value;assert.equal((await post()).status,409);assert.equal(sessions.length,n);if(old===undefined)delete event[field];else event[field]=old}
 let n=sessions.length;event.deposit_amount=0;assert.equal((await post()).status,400);assert.equal(sessions.length,n);event.deposit_amount=360.25;
 n=sessions.length;assert.equal((await post(false)).status,401);assert.equal(sessions.length,n);
 noUrl=true;let sent=emails.length;assert.equal((await post()).status,500);assert.equal(emails.length,sent);noUrl=false;
 fail=true;assert.equal((await post()).status,500);fail=false;
 event.venue='mountain-view';event.package_key='classic';event.package_name='Classic';assert.equal((await post()).status,200);assert.equal(sessions.at(-1).p.metadata.venue,'mountain-view');assert.match(sessions.at(-1).p.cancel_url,/package=classic/);
 console.log('PASS: deposit reminder link, cents, recipient, escaped content, metadata, idempotency, paid/cancelled guards, authorization and provider failures. No real emails or payments.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);process.exitCode=1});
