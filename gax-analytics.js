/* GAX anonymous product analytics. No PII, answers, financial inputs or visitor IDs. */
(function(){
 'use strict';
 const host=location.hostname;
 // Live production only. Preview sessions must not contaminate commercial reports.
 if(host!=='gaxsuite.com'&&host!=='www.gaxsuite.com')return;
 const seen=new Set();
 const allowed=new Set([
  'page_view','engaged_visit','meeting_intent',
  'diagnostic_started','question_completed','diagnostic_completed',
  'capacity_used','time_used','goals_used','meeting_opened','form_started'
 ]);
 function track(event,label='',once=true){
  if(!allowed.has(event))return;
  const key=event+':'+label;
  if(once&&seen.has(key))return;
  if(once)seen.add(key);
  // One funnel counter per page load, independent of feature/button counts.
  if(!['page_view','engaged_visit','meeting_intent'].includes(event))track('engaged_visit');
  if(event==='meeting_opened')track('meeting_intent');
  // Only event names and short, fixed category labels; never input values.
  const body=JSON.stringify({event,label});
  try{
   fetch('/api/gax-event',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body,keepalive:true,credentials:'same-origin'
   }).catch(()=>{});
  }catch{}
 }
 track('page_view');
 const sourceLabel=(el)=>{
  if(!el)return 'other';
  if(el.id==='navBtnMeeting')return 'nav';
  if(el.id==='mobileMeetingButton')return 'floating';
  if(el.id==='tCloseBtn')return 'closing';
  if(el.closest('#methodModal'))return 'method';
  return 'other';
 };
 // Capture phase so question progression is read before the site's handler updates it.
 document.addEventListener('click',event=>{
  const target=event.target;
  if(!(target instanceof Element))return;
  const opener=target.closest('[data-open-modal]');
  if(opener)track('meeting_opened',sourceLabel(opener));
  if(target.closest('#question .answer'))track('diagnostic_started');
  if(target.closest('#nextQuestion')){
   const btn=document.getElementById('nextQuestion');
   if(btn?.disabled)return;
   const progress=document.getElementById('progressText')?.textContent||'';
   const match=progress.match(/\d+/);
   const n=match?Number(match[0]):0;
   if(n>=1&&n<=4){
    track('question_completed',String(n));
    if(n===4)track('diagnostic_completed');
   }
  }
  if(target.closest('#goalChoices .goal-chip'))track('goals_used');
 },true);
 document.addEventListener('input',event=>{
  const target=event.target;
  if(!(target instanceof Element))return;
  if(target.matches('#income,#fixed,#variable'))track('capacity_used');
  if(target.matches('#compareMonthly,#yearsA,#yearsB'))track('time_used');
  if(target.closest('#goalConfigs'))track('goals_used');
  if(target.closest('#contactForm'))track('form_started');
 },true);
 document.addEventListener('focusin',event=>{
  const target=event.target;
  if(target instanceof Element&&target.closest('#contactForm input:not([name=website])'))
   track('form_started');
 },true);
})();
