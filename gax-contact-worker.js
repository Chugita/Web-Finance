/**
 * GAX contact endpoint for the EXISTING Cloudflare Worker that serves static assets.
 * Deploy as the Worker entrypoint with the existing static assets bound to env.ASSETS.
 * Configuration required (server-side secrets, NEVER in index.html):
 *   RESEND_API_KEY        — Resend transactional mail API key
 *   GAX_MAIL_FROM        — verified sender, e.g. "GAX <contacto@your-verified-domain>"
 *   GAX_MAIL_TO          — destination address for incoming consultations
 *
 * Deployment is intentionally not performed by adding this file to GitHub.
 * Wire this module into the existing Cloudflare Worker route/configuration.
 * The mail request does NOT book a calendar meeting.
 */
const MAX_BYTES=16000;
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
async function postContact(request,env){
 if(!env.RESEND_API_KEY||!env.GAX_MAIL_FROM||!env.GAX_MAIL_TO){
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
 const contact=body?.contact||{};
 const name=clean(contact.name,120),email=clean(contact.email,200),phone=clean(contact.phone,40);
 if(!name||!safeEmail(email)||!phone||body?.contactConsent!==true)
  return json({sent:false,error:'Incomplete contact data or consent'},400);
 const includeSummary=body?.shareSummary===true;
 const summary=includeSummary?clean(body.summary,12000):'';
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
   to:[env.GAX_MAIL_TO],
   reply_to:email,
   subject:'GAX · Nueva solicitud de reunión — '+name.replace(/[\r\n]/g,' '),
   text,html
  });
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
    reply_to:env.GAX_MAIL_TO,
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
  if(url.pathname==='/api/consultas'){
   if(request.method!=='POST')return json({sent:false,error:'Method not allowed'},405);
   return postContact(request,env);
  }
  // Keep current website content/assets unchanged.
  if(env.ASSETS?.fetch)return env.ASSETS.fetch(request);
  return new Response('Static assets binding not configured',{status:503});
 }
};
