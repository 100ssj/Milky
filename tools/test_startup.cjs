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
  return {html:element('#app').innerHTML,requests,warmed};
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
console.log('PASS: first visit renders without Google; returning session shows progress immediately.');
