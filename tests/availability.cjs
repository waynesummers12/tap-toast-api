const assert = require('node:assert/strict');
const root = require('node:path').resolve(__dirname, '..');
let rows = [], fail = false, writes = 0;
const client = { from(table) {
  let statuses;
  const q = {
    select() { return q }, order() { return q },
    in(field, values) { assert.equal(field, 'event_status'); statuses = values; return q },
    range: async (start, end) => ({data: rows.filter(r => statuses.includes(r.event_status)).slice(start, end + 1), error: fail ? new Error('offline') : null}),
    upsert() { writes++; return q }, insert() { writes++; return q },
    single: async () => ({data: {id:'11111111-1111-4111-8111-111111111111'}}),
  }; return q;
}};
const mock = (p, exports) => { const id = require.resolve(p); require.cache[id] = {id, filename:id, loaded:true, exports} };
mock(root+'/node_modules/@supabase/supabase-js', {createClient:()=>client});
mock(root+'/dist/lib/supabase', {supabase:client});
const {reservedSlots, hasReservationConflict, bookingWindow} = require(root+'/dist/services/availabilityService');
const express = require(root+'/node_modules/express');
const app = express(); app.use(express.json()); app.use('/events',require(root+'/dist/routes/eventRoutes').default); app.use(require(root+'/dist/routes/bookingRoutes').default);
(async () => {
  rows = [{event_status:'imported',event_date:'2027-06-15',start_time:'16:00',hours:5.5}];
  assert.equal(await hasReservationConflict(client,'2027-06-15','15:00',2),true);
  assert.equal(await hasReservationConflict(client,'2027-06-15','22:00',1),true);
  assert.equal(await hasReservationConflict(client,'2027-06-15','22:30',1),false);
  assert.equal(await hasReservationConflict(client,'2027-06-15','10:00',5),false);
  assert.equal((await reservedSlots(client))[0].start,'2027-06-15T16:00:00');
  rows[0].event_status='confirmed'; assert.equal(await hasReservationConflict(client,'2027-06-15','16:00',1),true);
  rows[0].event_status='cancelled'; assert.equal(await hasReservationConflict(client,'2027-06-15','16:00',1),false);
  rows[0].event_status='pending'; assert.equal(await hasReservationConflict(client,'2027-06-15','16:00',1),false);
  rows[0]={event_status:'imported',event_date:'2027-06-15',start_time:null,hours:5};
  assert.equal(await hasReservationConflict(client,'2027-06-15','10:00',1),true);
  rows[0]={event_status:'imported',event_date:'2027-06-15',start_time:'23:00',hours:12};
  assert.equal(await hasReservationConflict(client,'2027-06-16','10:00',1),true);
  assert.equal(await hasReservationConflict(client,'2027-06-16','12:00',1),false);
  assert.equal(bookingWindow('2027-02-30','12:00',1),null);
  assert.equal(bookingWindow('2027-06-15','26:00',1),null);
  rows=Array.from({length:1001},(_,i)=>({event_status:'imported',event_date:'2027-06-15',start_time:'16:00',hours:5}));
  assert.equal((await reservedSlots(client)).length,1001);
  rows=rows.slice(0,1);
  const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  try {
    const base='http://127.0.0.1:'+server.address().port;
    const payload={name:'Test',email:'test@example.invalid',event_date:'2027-06-15',start_time:'16:00',hours:3,bartenders:1,guests:50,location:'Test',booking_mode:'full',pricing_tier:'essentials',rental_delivery_selected:false,rental_ice_cooler_selected:false,setup_hour_selected:false,cocktail_tap_quantity:0};
    const post=path=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    for(const path of ['/events/create','/book-event']) {writes=0;assert.equal((await post(path)).status,409);assert.equal(writes,0)}
    assert.equal((await (await fetch(base+'/events/booked-slots')).json()).length,1);
    fail=true;
    for(const path of ['/events/create','/book-event']) {writes=0;assert.equal((await post(path)).status,503);assert.equal(writes,0)}
    fail=false;rows=[];
    for(const path of ['/events/create','/book-event']) assert.equal((await post(path)).status,200);
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r))}
  console.log('PASS: imported/confirmed/cancelled/pending, buffers, half hours, missing times, overnight, invalid dates, pagination, both booking routes conflict/error/success. No live data changed.');
})().catch(e=>{console.error(e);process.exitCode=1});
