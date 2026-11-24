/**
 * GAX contact endpoint for the EXISTING Cloudflare Worker that serves static assets.
 * Deploy as the Worker entrypoint with the existing static assets bound to env.ASSETS.
 * Configuration required (server-side secrets, NEVER in index.html):
 *   RESEND_API_KEY        — Resend transactional mail API key
 *   GAX_MAIL_FROM        — verified sender, e.g. "GAX <contacto@your-verified-domain>"
 *   GAX_MAIL_TO          — optional override; default jmpatt@grupoabax.com
 *
 * Deployment is intentionally not performed by adding this file to GitHub.
 * Wire this module into the existing Cloudflare Worker route/configuration.
 * The mail request does NOT book a calendar meeting.
 */
const DEFAULT_GAX_MAIL_TO='jmpatt@grupoabax.com';
const MAX_BYTES=16000;
const MAX_SUMMARY=12000;
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{
 status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
});
const clean=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
const safeEmail=s=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)&&s.length<=200;
const asHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function sendMail(env,message){
 const response=await fetch('https://api.resend.com/emails',{
  method:'POST',
  headers:{'Authorization':'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
  body:JSON.stringify(message)
 });
 if(!response.ok)throw new Error('Mail provider rejected request: '+response.status);
 return response.json();
}

/**
 * Anonymous aggregate conversion measurement.
 * No cookies, visitor identifiers, phone numbers, emails, diagnostic answers,
 * revenue figures or other financial data are sent to Analytics Engine.
 * Each accepted event adds a single counter to an event type and optional label.
 */
const GAX_ALLOWED_EVENTS=new Set([
 'page_view','engaged_visit','meeting_intent',
 'diagnostic_started','question_completed','diagnostic_completed',
 'capacity_used','time_used','goals_used',
 'meeting_opened','form_started','form_sent'
]);
const GAX_ALLOWED_LABELS=new Set([
 '1','2','3','4','nav','floating','closing','method','other',''
]);
function recordGaxEvent(env,name,label=''){
 if(!GAX_ALLOWED_EVENTS.has(name)||!env.GAX_EVENTS?.writeDataPoint)return false;
 const safeLabel=GAX_ALLOWED_LABELS.has(label)?label:'other';
 try{
  env.GAX_EVENTS.writeDataPoint({
   blobs:[name,safeLabel],
   doubles:[1],
   indexes:[name]
  });
  return true;
 }catch(error){
  console.warn('Anonymous analytics write failed');
  return false;
 }
}
async function postGaxEvent(request,env){
 const origin=request.headers.get('Origin');
 if(!origin)return json({ok:false},403);
 try{
  if(new URL(origin).origin!==new URL(request.url).origin)return json({ok:false},403);
 }catch{return json({ok:false},403);}
 if(!(request.headers.get('Content-Type')||'').toLowerCase().includes('application/json'))
  return json({ok:false},415);
 if(!env.GAX_EVENTS||!env.EVENT_RATE_LIMITER)return json({ok:false},503);
 const address=request.headers.get('CF-Connecting-IP');
 if(!address)return json({ok:false},403);
 let payload;
 try{
  const raw=await request.text();
  if(raw.length>256)return json({ok:false},413);
  payload=JSON.parse(raw);
 }catch{return json({ok:false},400);}
 if(!GAX_ALLOWED_EVENTS.has(payload?.event)||payload.event==='form_sent')
  return json({ok:false},400); // Only server confirms delivered contact emails.
 try{
  const quota=await env.EVENT_RATE_LIMITER.limit({key:address});
  if(!quota.success)return json({ok:false},429);
 }catch{return json({ok:false},503);}
 const written=recordGaxEvent(env,payload.event,typeof payload.label==='string'?payload.label:'');
 if(!written)return json({ok:false,error:'Analytics temporarily unavailable'},503);
 return json({ok:true});
}

async function postContact(request,env){
 if(!env.RESEND_API_KEY||!env.GAX_MAIL_FROM){
  return json({sent:false,error:'Email service not configured'},503);
 }
 const origin=request.headers.get('Origin');
 // This is a same-origin API, not a public cross-origin mail relay.
 if(origin){
  try{if(new URL(origin).origin!==new URL(request.url).origin)
    return json({sent:false,error:'Origin not allowed'},403);}
  catch{return json({sent:false,error:'Invalid origin'},403);}
 }
 const media=request.headers.get('Content-Type')||'';
 if(!media.includes('application/json'))return json({sent:false,error:'JSON required'},415);
 const declaredSize=Number(request.headers.get('Content-Length')||0);
 if(declaredSize>MAX_BYTES)return json({sent:false,error:'Request too large'},413);
 let body;
 try{
  const raw=await request.text();
  if(raw.length>MAX_BYTES)return json({sent:false,error:'Request too large'},413);
  body=JSON.parse(raw);
 }catch{return json({sent:false,error:'Invalid JSON'},400);}
 // Reject automated submissions that explicitly fill the hidden website field.
 if(typeof body?.website==='string'&&body.website.trim())return json({sent:true,booked:false});
 const contact=body?.contact||{};
 const name=clean(contact.name,120),email=clean(contact.email,200),phone=clean(contact.phone,40);
 if(!name||name.length<2||!safeEmail(email)||!phone||phone.replace(/\D/g,'').length<7||body?.contactConsent!==true)
  return json({sent:false,error:'Incomplete contact data or consent'},400);
 // Per-IP limiter applied before the two transactional mail requests.
 // RATE LIMITER must be configured in wrangler.jsonc. Reject if unavailable
 // to avoid silently opening an unrestricted email relay.
 if(!env.CONTACT_RATE_LIMITER)return json({sent:false,error:'Contact protection unavailable'},503);
 const address=request.headers.get('CF-Connecting-IP');
 if(!address)return json({sent:false,error:'Client address unavailable'},503);
 try{
  const quota=await env.CONTACT_RATE_LIMITER.limit({key:address});
  if(!quota.success)return json({sent:false,error:'Too many requests. Try again later.'},429);
 }catch(error){
  console.error('Contact rate-limit failure',error);
  return json({sent:false,error:'Contact service temporarily unavailable'},503);
 }
 const includeSummary=body?.shareSummary===true;
 const summary=includeSummary?clean(body.summary,MAX_SUMMARY):'';
 const recipient=safeEmail(env.GAX_MAIL_TO||'')?env.GAX_MAIL_TO:DEFAULT_GAX_MAIL_TO;
 const now=new Date().toISOString();
 const rows=[
  'Nueva solicitud desde GAX',
  '',
  'Nombre: '+name,
  'Email: '+email,
  'Teléfono/WhatsApp: '+phone,
  'Recibida: '+now,
  '',
  includeSummary?'Resumen financiero autorizado:':'La persona no autorizó compartir sus respuestas financieras.',
  includeSummary?summary:'',
  '',
  'La consulta NO confirma día ni horario de reunión.'
 ];
 const text=rows.join('\n');
 const html='<div style="font-family:Arial,sans-serif;line-height:1.6">'+
  '<h2>Nueva solicitud desde GAX</h2><pre style="white-space:pre-wrap;font-family:inherit">'+asHtml(text)+'</pre></div>';
 try{
  await sendMail(env,{
   from:env.GAX_MAIL_FROM,
   to:[recipient],
   reply_to:email,
   subject:'GAX · Nueva solicitud de reunión — '+name.replace(/[\r\n]/g,' '),
   text,html
  });
  recordGaxEvent(env,'form_sent'); // Advisor email successfully accepted by Resend.
  // The visitor receives an acknowledgement, with their consented summary,
  // but NEVER an invented date/time or calendar booking.
  const receipt='Hola '+name+',\n\nRecibimos tu solicitud de conversación en GAX. '+
   'Te contactaremos para coordinar una fecha y un horario.\n\n'+
   (includeSummary?'Este es el resumen que compartiste:\n\n'+summary+'\n\n':'')+
   'Los cálculos son orientativos y no garantizan rendimientos.\n\nGAX';
  try{
   await sendMail(env,{
    from:env.GAX_MAIL_FROM,
    to:[email],
    reply_to:recipient,
    subject:'GAX · Recibimos tu consulta',
    text:receipt
   });
  }catch(error){
   console.warn('Advisor was notified; visitor receipt failed',error);
  }
  return json({sent:true,booked:false});
 }catch(error){
  console.error('Failed to deliver contact request',error);
  return json({sent:false,error:'Delivery failed'},502);
 }
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/api/gax-event'){
   if(request.method!=='POST')return json({ok:false},405);
   return postGaxEvent(request,env);
  }
  if(url.pathname==='/api/consultas'){
   if(request.method!=='POST')return json({sent:false,error:'Method not allowed'},405);
   return postContact(request,env);
  }
  // Keep current website content/assets unchanged.
  if(env.ASSETS?.fetch)return env.ASSETS.fetch(request);
  return new Response('Static assets binding not configured',{status:503});
 }
};
