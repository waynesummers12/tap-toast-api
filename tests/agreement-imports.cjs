const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const PDFDocument=require('pdfkit');
const JSZip=require('jszip');
const root=path.resolve(__dirname,'..');
const {parseAgreementText,extractAgreement,validateDetails,agreementReviewWarnings}=require(root+'/dist/services/agreementParser');
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
 const portable=parseAgreementText(sample+'\nCity: Golden\n');
 portable.service_type='portable_bar';
 assert(validateDetails(portable));
 for(const [label,value] of [['Bartending','bartending'],['Tap Trailer','tap_trailer'],['Popup Trailer','popup_trailer'],['Portable Bar','portable_bar'],['Dirty Soda Bar','soda']]) {
   assert.equal(parseAgreementText('Service Type: '+label).service_type,value);
   assert(validateDetails({...portable,service_type:value}));
 }
 assert.equal(parseAgreementText('Services Description. Company is also to provide the pop-up camper at the campground. TERM OF SERVICES.').service_type,'popup_trailer');
 assert.equal(parseAgreementText('Services Description. Client is also going to be using the 4 tap trailer. TERM OF SERVICES.').service_type,'tap_trailer');
 assert.equal(parseAgreementText('Services Description. Client agrees to pick up the 4 keg- mobile bar trailer. TERM OF SERVICES.').service_type,'tap_trailer');
 assert.equal(parseAgreementText('Services Description. Company will not provide a tap trailer. TERM OF SERVICES.').service_type,'');
 assert.equal(validateDetails({...portable,city:'x'.repeat(201)}),null);
 assert.equal(validateDetails({...portable,city:42}),null);
 assert.equal(parseAgreementText('Service Type: Portable bar').service_type,'portable_bar');
 assert.equal(parseAgreementText('Services Description. Company will provide a 6 foot portable bar. TERM OF SERVICES.').service_type,'portable_bar');
 assert.equal(parseAgreementText('Services Description. Company will not provide a portable bar. TERM OF SERVICES.').service_type,'');
 assert.equal(parseAgreementText('Venue: Test Venue, Sedalia, CO').city,'Sedalia');
 assert.equal(parseAgreementText('Client Name: Sample Address: A campground in Frisco, CO WHEREAS').city,'Frisco');
 assert.equal(parseAgreementText('Company located in Highlands Ranch, CO. Client Name: Sample WHEREAS').city,'');
 assert.equal(parseAgreementText('City: Golden\nVenue: A place in Frisco, CO').city,'Golden');
 assert.equal(details.event_date,'2026-10-24');assert.equal(details.start_time,'15:30');assert.equal(details.total_price,'1500.00');assert.equal(details.drinks_serving,'Beer, wine, margaritas');assert.equal(details.deposit_paid,false);
 assert(validateDetails(details));
 for(const hours of ['0.5','1','5.5','7.0','168']) assert(validateDetails({...details,hours}));
 for(const hours of ['0','5.25','5.75','168.5','NaN','5.5hours']) assert.equal(validateDetails({...details,hours}),null);
 assert.equal(parseAgreementText('Service hours: 5.5').hours,'5.5');
 assert.equal(parseAgreementText('Service hours: 5.75').hours,'');
 for(const change of [{event_date:'2026-02-30'},{hours:'4.25'},{total_price:'-1'},{deposit_amount:'2000'},{balance_paid:true},{email:'bad'},{service_type:'unknown'}]) assert.equal(validateDetails({...details,...change}),null);
 assert.equal(parseAgreementText('Event Date: 02/30/2026\nDeposit: 50%').event_date,'');assert.equal(parseAgreementText('Deposit: 50%').deposit_amount,'');
 const extracted=await extractAgreement(await pdf(sample),'pdf');assert.equal(extracted.details.event_date,details.event_date);assert.equal(extracted.details.drinks_serving,details.drinks_serving);
 // Sanitized legacy layout: no customer data from a signed agreement is stored here.
 const legacy=`THIS AGREEMENT is effective as of Date: 1/16/2026.
 Company, located in Golden, CO and Client Name: Example Couple for Example Ranch.
 2.1 Client Contact.
 Name: Example Couple
 Email: first@example.invalid second@example.invalid
 Phone number: 303-555-0100 and 303-555-0101
 2.2 Services Description.
 Company is to supply 2 bartender. Company will also supply 2 bars ($100/each).
 Each bartender has 2 hrs travel, 1 hr setup and 30 min cleanup.
 3. TERM OF SERVICES.
 This Agreement remains in effect until Date of events:
 October 1 7 th , 2026. Time TBD - 8 hr service
 4. COMPENSATION OF COMPANY.
 Client shall pay Company as follows: 50% of the $1,170. (11.5 hrs total
 time per bartender at $40/hr. 2 hr travel, 1 hr setup, 8 hr service time,
 30 min cleanup. Rental = $200 and rug $50) is due at time of booking.
 A late payment penalty of 5% applies. Company Signature: Other Person`;
 const legacyDetails=parseAgreementText(legacy);
 assert.equal(legacyDetails.name,'Example Couple');
 assert.equal(legacyDetails.event_date,'2026-10-17');
 assert.equal(legacyDetails.hours,'8');assert.equal(legacyDetails.bartenders_needed,'2');
 assert.equal(legacyDetails.total_price,'1170.00');assert.equal(legacyDetails.deposit_amount,'585.00');
 assert.equal(legacyDetails.service_type,'bartending');
 for(const key of ['start_time','guest_count','location','drinks_serving']) assert.equal(legacyDetails[key],'');
 assert.equal(legacyDetails.deposit_paid,false);assert.equal(legacyDetails.balance_paid,false);
 const legacyPdf=await extractAgreement(await pdf(legacy),'pdf');
 assert.deepEqual(legacyPdf.details,legacyDetails);
 assert(legacyPdf.warnings.some(w=>w.includes('multiple email')));
 assert.equal(parseAgreementText(legacy.replaceAll('8 hr service','8.5 hr service')).hours,'8.5');
 assert.equal(parseAgreementText('2 hr travel, 1 hr setup, 30 min cleanup').hours,'');
 assert.equal(parseAgreementText('Agreement date: 1/16/2026. Signature date: 1/17/2026').event_date,'');
 assert.equal(parseAgreementText('A late payment penalty of 50% of the $1,170 is due at time of booking.').deposit_amount,'');
 assert.equal(parseAgreementText(legacy.replace('50%','150%')).deposit_amount,'');
 assert.equal(parseAgreementText(legacy+'\nTotal Price: $2000').deposit_amount,'');
 assert.equal(parseAgreementText(legacy+'\nDeposit Amount: $300').deposit_amount,'300');
 assert.equal(parseAgreementText(legacy+'\nService Type: Dirty soda').service_type,'soda');

 const cases = [
  ['Date of event: 11/22/2026\nServices Description. Company is to provider client with 1 bartender. Service time from 3:30pm-9pm. TERM OF SERVICES.\nClient shall pay Company as follows: 50% of the $360 is due at time of booking.', {event_date:'2026-11-22',start_time:'15:30',bartenders_needed:'1',total_price:'360.00',deposit_amount:'180.00',hours:'5.5'}],
  ['Date of event Saturday, September 25, 2027.\nCompany is to provide 1 bartender for about 7 hours. Bartenders will be contracted from 3pm-8pm including setup.', {event_date:'2027-09-25',bartenders_needed:'1',start_time:'',hours:''}],
  ['Date of event: 10/10/2026. Company is to provide bartending service (only 1 needed). Client shall pay Company as follows: 50% of the $280 is due at time of booking.', {event_date:'2026-10-10',bartenders_needed:'1',total_price:'280.00',deposit_amount:'140.00'}],
  ['Date of event: June 27th, 2026-June 28th, 2026. Survival. Client shall pay Company as follows: 50% of the $600 rental fee is due at time of booking.', {event_date:'2026-06-27',total_price:'600.00',deposit_amount:'300.00'}],
  ['Company is to provide 2 bartenders for about 9.5 hours (6 hrs of serving, 2 hrs travel, 1 hr setup, 30 min cleanup). Date of event Saturday, October 24th, 2026. Client shall pay Company as follows: 50% of the $7600.00 is due at time of booking.', {hours:'6',bartenders_needed:'2',total_price:'7600.00',deposit_amount:'3800.00'}],
  ['Services Description. Client needs 2 bartenders. Service from (4:00pm-9:45pm). TERM OF SERVICES. Date of event: 5/30/2026 2:00pm-11:15pm includes travel. Client shall pay Company as follows: 50% of the $832 is due at time of booking.', {bartenders_needed:'2',start_time:'16:00',hours:'',total_price:'832.00',deposit_amount:'416.00'}],
  ['Company is to provide 2 bartenders for about 60 to 70 guests. Date of event Saturday, July 18th, 2026. Client shall pay Company as follows: 50% of the $1,200.00 (7.5 hrs, includes $200 security deposit. The total of this event is $1,200.00.', {bartenders_needed:'2',event_date:'2026-07-18',guest_count:'',total_price:'1200.00',deposit_amount:'600.00'}],
 ];
 for (const [source,expected] of cases) {
   const parsed=parseAgreementText(source.replace(/\\n/g,'\n'));
   for(const [key,value] of Object.entries(expected)) assert.equal(parsed[key],value,source+' field '+key);
   const realPdf=await extractAgreement(await pdf(source),'pdf');
   for(const [key,value] of Object.entries(expected)) assert.equal(realPdf.details[key],value,'PDF '+key);
 }
 assert(agreementReviewWarnings(cases[0][0],parseAgreementText(cases[0][0]),'Example 10.22.pdf').some(w=>w.includes('differs from the filename')));
 assert(agreementReviewWarnings(cases[3][0],parseAgreementText(cases[3][0])).some(w=>w.includes('multiple dates')));
 assert(agreementReviewWarnings(cases[6][0],parseAgreementText(cases[6][0])).some(w=>w.includes('guest-count range')));
 // Adjacent PDF text runs must remain adjacent inside email addresses and money.
 const fragmented = await new Promise(resolve=>{
   const doc=new PDFDocument();const chunks=[];doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));
   doc.text('Email: ',{continued:true}).text('test',{continued:true}).text('2026',{continued:true}).text('@example.invalid');
   doc.text('Total Price: $',{continued:true}).text('1,',{continued:true}).text('200.00');doc.end();
 });
 const fragments=await extractAgreement(fragmented,'pdf');
 assert.equal(fragments.details.email,'test2026@example.invalid');assert.equal(fragments.details.total_price,'1200.00');
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
 await db.exec(fs.readFileSync(root+'/supabase/migrations/20261013193906_agreement_city_portable_bar.sql','utf8'));
 await db.exec(fs.readFileSync(root+'/supabase/migrations/20261013194140_agreement_half_hour_service.sql','utf8'));
 await db.exec(fs.readFileSync(root+'/supabase/migrations/20261013204039_agreement_service_options.sql','utf8'));
 const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
 for(const [i,id] of ids.entries()) await db.query('insert into event_agreements(id,file_hash,file_name,storage_path) values($1,$2,$3,$4)',[id,String(i).repeat(64),'test.pdf',id+'/test.pdf']);
 const importEvent=async(id,d=details,allow=false)=>(await db.query('select import_signed_agreement($1,$2,$3) id',[id,JSON.stringify(d),allow])).rows[0].id;
 const id=await importEvent(ids[0]);assert.equal(await importEvent(ids[0]),id);
 assert.equal((await db.query('select count(*)::int n from events')).rows[0].n,1);
 let event=(await db.query('select * from events where id=$1',[id])).rows[0];assert.equal(Number(event.balance_due),1000);assert.equal(event.event_date.toISOString().slice(0,10),'2026-10-24');assert.equal(event.event_status,'imported');assert.equal(event.drinks_serving,details.drinks_serving);
 await assert.rejects(importEvent(ids[1]),/POSSIBLE_DUPLICATE/);
 const id2=await importEvent(ids[1],{...details,deposit_paid:true},true);
 event=(await db.query('select * from events where id=$1',[id2])).rows[0];assert.equal(Number(event.balance_due),1000);
 const id3=await importEvent(ids[2],{...details,event_date:'2026-10-25',name:'Changed name',city:'Golden',service_type:'portable_bar',hours:'5.5',deposit_paid:true,balance_paid:true});
 event=(await db.query('select * from events where id=$1',[id3])).rows[0];assert.equal(Number(event.balance_due),0);assert.equal(Number(event.hours),5.5);assert.equal(event.city,"Golden");assert.equal(event.service_type,"portable_bar");
 for(const type of ['tap_trailer','popup_trailer']) { await db.query('update events set service_type=$1 where id=$2',[type,id3]); assert.equal((await db.query('select service_type from events where id=$1',[id3])).rows[0].service_type,type); }
 assert.equal((await db.query('select count(*)::int n from customers')).rows[0].n,1);assert.equal((await db.query('select name from customers')).rows[0].name,'Test Customer');
 assert.equal((await db.query("select public from storage.buckets where id='event-agreements'")).rows[0].public,false);
 assert.equal((await db.query("select relrowsecurity from pg_class where oid='event_agreements'::regclass")).rows[0].relrowsecurity,true);
 assert.equal((await db.query("select has_function_privilege('anon','import_signed_agreement(uuid,jsonb,boolean)','execute') ok")).rows[0].ok,false);
 assert.equal((await db.query("select has_table_privilege('authenticated','event_agreements','select') ok")).rows[0].ok,false);
 await db.close();
 console.log('PASS: real PDF/Word extraction, scanned-PDF fallback, validation, atomic imports, retries, duplicate detection, payment totals, customer preservation, private bucket, and access restrictions. No live records changed.');
})().catch(error=>{console.error(error);process.exit(1)});
