const assert=require('node:assert/strict'); const root=require('node:path').resolve(__dirname,'..');
const mockModule=(p,exports)=>{const id=require.resolve(p);require.cache[id]={id,filename:id,loaded:true,exports}};
let sessions=[],emails=[],rejectEmail=false;
class Stripe {constructor(){this.checkout={sessions:{create:async p=>{sessions.push(p);return {url:'https://example.invalid/checkout'}}}}}}
class Resend {constructor(){this.emails={send:async p=>{emails.push(p);return rejectEmail?{error:{message:'Simulated provider rejection'}}:{data:{id:'fake'}}}}}}
mockModule(root+'/node_modules/stripe',Stripe);mockModule(root+'/node_modules/resend',{Resend});
const event={id:'11111111-1111-4111-8111-111111111111',deposit_amount:360,balance_due:360,total_price:720,deposit_paid:false,balance_paid:false,event_date:'2026-11-22',customer:{name:'Test',email:'test@example.invalid'}};
mockModule(root+'/dist/lib/supabase',{supabase:{auth:{getUser:async()=>({data:{user:{email:'admin@example.invalid'}}})},from(){const q={select(){return q},eq(){return q},single:async()=>({data:event})};return q}}});
process.env.TAP_TOAST_ADMIN_EMAILS='admin@example.invalid';const express=require(root+'/node_modules/express');
const app=express();app.use(express.json());app.use(require(root+'/dist/routes/stripeRoutes').default);
(async()=>{const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{const post=(path,type)=>fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer test'},body:JSON.stringify({event_id:event.id,type})});
const state=JSON.stringify(event);
for(const action of ['deposit','invoice','balance']){
 event.deposit_paid=action==='balance';emails=[];
 let r=await post('/send-'+action,action);assert.equal(r.status,200);assert.equal(emails.length,1);
 assert.equal(emails[0].to,'test@example.invalid');assert.equal(sessions.at(-1).line_items[0].price_data.unit_amount,36000);
 assert.equal(sessions.at(-1).metadata.type,action==='balance'?'balance':'deposit');
 assert(emails[0].html.includes('https://example.invalid/checkout'));assert(!sessions.at(-1).payment_method_types);
 if(action==='invoice'){assert.match(emails[0].subject,/Invoice/);assert.match(emails[0].html,/\$720.00/);assert.match(emails[0].html,/Deposit requested now/)}
}
event.deposit_paid=false;assert.equal(JSON.stringify(event),state);
// Public checkout safeguards: assert rejected requests never reach Stripe.
const publicCheckout=(type,authenticated=false,overrides={})=>fetch('http://127.0.0.1:'+server.address().port+'/create-checkout-session',{method:'POST',headers:{'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer test'}:{})},body:JSON.stringify({event_id:event.id,type,...overrides})});
async function blockedCheckout(type,status,authenticated=false,overrides={}) {
 const before=sessions.length; const response=await publicCheckout(type,authenticated,overrides);
 assert.equal(response.status,status); assert.equal(sessions.length,before);
}
const originalEvent=JSON.stringify(event);
let checkout=await publicCheckout('deposit');assert.equal(checkout.status,200);
assert.equal(sessions.at(-1).line_items[0].price_data.unit_amount,36000);
assert.equal(sessions.at(-1).metadata.type,'deposit');assert(!sessions.at(-1).payment_method_types);
assert.equal(JSON.stringify(event),originalEvent);
event.deposit_paid=true;await blockedCheckout('deposit',409);
checkout=await publicCheckout('balance',true);assert.equal(checkout.status,200);
assert.equal(sessions.at(-1).metadata.type,'balance');
event.balance_paid=true;await blockedCheckout('deposit',409);await blockedCheckout('balance',409,true);
event.balance_paid=false;event.deposit_paid=false;
for(const field of ['event_status','status']) {
 event[field]='cancelled'; await blockedCheckout('deposit',409);await blockedCheckout('balance',409,true);delete event[field];
}
await blockedCheckout('balance',409,true);await blockedCheckout('balance',401);
await blockedCheckout('deposit',400,false,{event_id:'invalid'});
event.deposit_amount=0;await blockedCheckout('deposit',400);event.deposit_amount=360;
event.deposit_paid=true;event.balance_due=0;await blockedCheckout('balance',400,true);
event.balance_due=360;event.deposit_paid=false;
assert.equal(JSON.stringify(event),originalEvent);
rejectEmail=true;
for(const action of ['deposit','invoice','balance']){event.deposit_paid=action==='balance';assert.equal((await post('/send-'+action,action)).status,502)}
rejectEmail=false;
let before=sessions.length;event.deposit_paid=true;assert.equal((await post('/send-deposit','deposit')).status,409);assert.equal(sessions.length,before);
event.balance_paid=true;assert.equal((await post('/send-invoice','invoice')).status,409);event.balance_paid=false;
event.event_status='cancelled';assert.equal((await post('/send-balance','balance')).status,409);delete event.event_status;
event.deposit_paid=false;assert.equal((await post('/send-balance','balance')).status,409);
event.customer.email='';assert.equal((await post('/send-deposit','deposit')).status,400);event.customer.email='test@example.invalid';
event.deposit_amount=0;assert.equal((await post('/send-deposit','deposit')).status,400);event.deposit_amount=360;
assert.equal((await fetch('http://127.0.0.1:'+server.address().port+'/send-invoice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event_id:event.id})})).status,401);
console.log('PASS: all three email actions, correct recipient and cents, distinct invoice summary, provider failures, paid/cancelled/invalid-email guards, authorization, and no payment state mutations. All external services mocked.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);process.exit(1)});
