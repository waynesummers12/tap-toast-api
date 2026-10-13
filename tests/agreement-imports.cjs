const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const PDFDocument=require('pdfkit');
const JSZip=require('jszip');
const root=path.resolve(__dirname,'..');
const {parseAgreementText,extractAgreement,validateDetails}=require(root+'/dist/services/agreementParser');
const sample=`Client Name: Test Customer
Email: test@example.invalid
Phone: 303-555-0100
Event Date: October 24, 2026
Start Time: 3:30 PM
Venue: Test Venue, Golden
Service Hours: 4
Bartenders Needed: 2
Guest Count: 50
Total Price: $1,500.00
Deposit Amount: $500.00
Drinks Serving: Beer, wine, margaritas
Service Type: Bartending`;
async function pdf(text){return new Promise(resolve=>{const doc=new PDFDocument();const chunks=[];doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.text(text);doc.end()})}
(async()=>{
 const details=parseAgreementText(sample);
 assert.equal(details.event_date,'2026-10-24');assert.equal(details.start_time,'15:30');assert.equal(details.total_price,'1500.00');assert.equal(details.drinks_serving,'Beer, wine, margaritas');assert.equal(details.deposit_paid,false);
 assert(validateDetails(details));
 for(const change of [{event_date:'2026-02-30'},{hours:'4.5'},{total_price:'-1'},{deposit_amount:'2000'},{balance_paid:true},{email:'bad'},{service_type:'unknown'}]) assert.equal(validateDetails({...details,...change}),null);
 assert.equal(parseAgreementText('Event Date: 02/30/2026\nDeposit: 50%').event_date,'');assert.equal(parseAgreementText('Deposit: 50%').deposit_amount,'');
 const extracted=await extractAgreement(await pdf(sample),'pdf');assert.equal(extracted.details.event_date,details.event_date);assert.equal(extracted.details.drinks_serving,details.drinks_serving);
 const blank=await extractAgreement(await pdf(''),'pdf');assert.match(blank.warnings[0],/scan/);assert.equal(blank.details.name,'');
 await assert.rejects(extractAgreement(Buffer.from('not a PDF'),'pdf'));
 const zip=new JSZip();zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+sample.split('\n').map(line=>'<w:p><w:r><w:t>'+line+'</w:t></w:r></w:p>').join('')+'</w:body></w:document>');
 const word=await extractAgreement(await zip.generateAsync({type:'nodebuffer'}),'docx');assert.equal(word.details.name,details.name);assert.equal(word.details.drinks_serving,details.drinks_serving);
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table customers(id uuid primary key default gen_random_uuid(),name text,email text unique,phone text);
 create table events(id uuid primary key default gen_random_uuid(),customer_id uuid references customers(id),event_date date,start_time text,location text,hours integer,bartenders_needed integer,bartenders integer,guest_count integer,total_price numeric,custom_total_price numeric,deposit_amount numeric,deposit_paid boolean,balance_paid boolean,balance_due numeric,event_status text,status text,service_type text);
 grant usage on schema public to service_role; grant all on customers,events to service_role;`);
 const migration=fs.readdirSync(root+'/supabase/migrations').find(n=>n.endsWith('_signed_agreement_imports.sql'));
 await db.exec(fs.readFileSync(root+'/supabase/migrations/'+migration,'utf8'));
 const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
 for(const [i,id] of ids.entries()) await db.query('insert into event_agreements(id,file_hash,file_name,storage_path) values($1,$2,$3,$4)',[id,String(i).repeat(64),'test.pdf',id+'/test.pdf']);
 const importEvent=async(id,d=details,allow=false)=>(await db.query('select import_signed_agreement($1,$2,$3) id',[id,JSON.stringify(d),allow])).rows[0].id;
 const id=await importEvent(ids[0]);assert.equal(await importEvent(ids[0]),id);
 assert.equal((await db.query('select count(*)::int n from events')).rows[0].n,1);
 let event=(await db.query('select * from events where id=$1',[id])).rows[0];assert.equal(Number(event.balance_due),1000);assert.equal(event.event_date.toISOString().slice(0,10),'2026-10-24');assert.equal(event.event_status,'imported');assert.equal(event.drinks_serving,details.drinks_serving);
 await assert.rejects(importEvent(ids[1]),/POSSIBLE_DUPLICATE/);
 const id2=await importEvent(ids[1],{...details,deposit_paid:true},true);
 event=(await db.query('select * from events where id=$1',[id2])).rows[0];assert.equal(Number(event.balance_due),1000);
 const id3=await importEvent(ids[2],{...details,event_date:'2026-10-25',name:'Changed name',deposit_paid:true,balance_paid:true});
 event=(await db.query('select * from events where id=$1',[id3])).rows[0];assert.equal(Number(event.balance_due),0);
 assert.equal((await db.query('select count(*)::int n from customers')).rows[0].n,1);assert.equal((await db.query('select name from customers')).rows[0].name,'Test Customer');
 assert.equal((await db.query("select public from storage.buckets where id='event-agreements'")).rows[0].public,false);
 assert.equal((await db.query("select relrowsecurity from pg_class where oid='event_agreements'::regclass")).rows[0].relrowsecurity,true);
 assert.equal((await db.query("select has_function_privilege('anon','import_signed_agreement(uuid,jsonb,boolean)','execute') ok")).rows[0].ok,false);
 assert.equal((await db.query("select has_table_privilege('authenticated','event_agreements','select') ok")).rows[0].ok,false);
 await db.close();
 console.log('PASS: real PDF/Word extraction, scanned-PDF fallback, validation, atomic imports, retries, duplicate detection, payment totals, customer preservation, private bucket, and access restrictions. No live records changed.');
})().catch(error=>{console.error(error);process.exit(1)});
