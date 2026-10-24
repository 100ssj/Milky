// Keep the Google service pending: first paint must not depend on its response.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'../public/app.js'),'utf8');
function boot(hasSession){
  const elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',style:{},insertAdjacentHTML(){},querySelector:child=>element(id+' '+child)});return elements.get(id);};
  const requests=[];let warmed=0;
  const sandbox={document:{querySelector:element,querySelectorAll:()=>[]},
    window:{MILKY_CONFIG:{mode:'sheets'},MilkyCloud:{hasSession:()=>hasSession,isConfigured:()=>true,
      warmup:()=>{warmed++;return new Promise(()=>{});},request:action=>{requests.push(action);return new Promise(()=>{});}}},
    Intl,Date,console,setTimeout,clearTimeout};
  vm.createContext(sandbox);vm.runInContext(source,sandbox);
  return {html:element('#app').innerHTML,requests,warmed,sandbox,element};
}
const first=boot(false);
assert.match(first.html,/학교 입장 코드/);
assert.match(first.html,/활동실 들어가기/);
assert.deepEqual(first.requests,[],'a new visitor must not wait for the me RPC');
assert.equal(first.warmed,1,'connect while the visitor fills the form');
const returning=boot(true);
assert.match(returning.html,/활동실을 열고 있어요/);
assert.match(returning.html,/aria-busy="true"/);
assert.deepEqual(returning.requests,['me']);
assert.doesNotMatch(returning.html,/학교 입장 코드/,'do not race a new login with session restoration');
vm.runInContext(`me={role:'student',student:1,grade:5,classroom:1,number:1};
tasks=Array.from({length:30},(_,i)=>({id:i+1,day:day(),kind:['word','sentence','paragraph'][i%3],bank:true,daily:i<3,title:'활동'+(i+1)}));
responses=[{id:1,task:1,kind:'word',day:'2000-01-01',updated:'2000-01-01T09:00:00',title:'이전 답안',target:'낱말',answers:{meaning:'예전 답안'},revisions:[],confidence:'조금 알겠어요'}];
home();`,returning.sandbox);
const home=returning.element('#app').innerHTML;
assert.equal((home.match(/<article class="card /g)||[]).length,3,'a 30-item bank must render only three daily cards');
assert.match(home,/3개 중 0개/,'a repeated bank activity must not count yesterday as today');
console.log('PASS: first visit renders without Google; returning session shows progress immediately.');
