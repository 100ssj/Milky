// Behavioral tests for Apps Script logic using a private, in-memory Sheets double.
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
let clock=Date.now();
class TestDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
class Sheet{
  constructor(name){this.name=name;this.data=[];}
  getLastRow(){return this.data.length;}
  getRange(row,col,height=1,width=1){const sheet=this;const range={
    getValues(){return Array.from({length:height},(_,r)=>Array.from({length:width},(_,c)=>sheet.data[row-1+r]?.[col-1+c]??''));},
    setValues(values){for(let r=0;r<height;r++){const target=sheet.data[row-1+r]??=[];for(let c=0;c<width;c++){let value=values[r][c];if(typeof value==='string'&&value.startsWith("'"))value=value.slice(1);target[col-1+c]=value;}}return range;},
    setNumberFormat(){return range;},setBackground(){return range;},setFontColor(){return range;},setFontWeight(){return range;}
  };return range;}
  setFrozenRows(){}hideSheet(){}
}
const sheets=new Map(),properties=new Map(),cacheValues=new Map(),logs=[];
const book={getId:()=> 'test-only-private-sheet',getSheetByName:name=>sheets.get(name),insertSheet(name){const sheet=new Sheet(name);sheets.set(name,sheet);return sheet;}};
const propertyStore={getProperty:key=>properties.get(key)||null,setProperty(key,value){properties.set(key,value);return this;},deleteProperty(key){properties.delete(key);return this;},setProperties(values){Object.entries(values).forEach(([k,v])=>properties.set(k,v));return this;}};
const cache={get(key){const item=cacheValues.get(key);return item&&item.expiry>clock?item.value:null;},put(key,value,ttl){cacheValues.set(key,{value,expiry:clock+ttl*1000});},remove:key=>cacheValues.delete(key)};
let busy=false;
const context=vm.createContext({Date:TestDate,console:{log:message=>logs.push(message)},PropertiesService:{getScriptProperties:()=>propertyStore},SpreadsheetApp:{getActiveSpreadsheet:()=>book,openById:id=>{assert.equal(id,book.getId());return book;}},CacheService:{getScriptCache:()=>cache},LockService:{getScriptLock:()=>({locked:false,tryLock(){this.locked=!busy;return this.locked;},hasLock(){return this.locked;},releaseLock(){this.locked=false;}})},Utilities:{
  getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},
  computeDigest:(_,value)=>crypto.createHash('sha256').update(value).digest(),
  computeHmacSha256Signature:(value,key)=>crypto.createHmac('sha256',key).update(value).digest(),
  base64EncodeWebSafe:value=>Buffer.from(value).toString('base64url'),
  formatDate(date,zone,format){assert.equal(zone,'Asia/Seoul');const kst=new Date(date.getTime()+9*3600*1000).toISOString();return format==='yyyy-MM-dd'?kst.slice(0,10):kst.slice(0,19)+'+09:00';}
}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../apps-script/Code.gs'),'utf8'),context);
const plain=value=>JSON.parse(JSON.stringify(value));
function call(action,payload={},token='',requestId=crypto.randomUUID()) {return plain(context.rpc({action,payload,token,requestId}));}
function good(result){assert.equal(result.ok,true,JSON.stringify(result));return result.data;}
context.setupAdmin_();
const teacherPassword=logs.find(text=>text.startsWith('새 교사 비밀번호')).split(': ').at(-1);
assert.ok(teacherPassword.length>=24);
const admin=good(call('join',{role:'teacher',password:teacherPassword}));
const schools=good(call('context',{},admin.token)).schools;
assert.equal(schools.length,2);
assert.notEqual(schools[0].code,schools[1].code);
const login={grade:5,classroom:1,number:1,pin:'123456',code:schools[0].code};
const a=good(call('join',login));
const b=good(call('join',{...login,code:schools[1].code}));
const c=good(call('join',{...login,classroom:2}));
assert.equal(new Set([a.student,b.student,c.student]).size,3);
assert.equal(call('context',{},a.token).ok,false);
assert.equal(call('export',{},a.token).ok,false);
assert.equal(call('responses',{},'invalid-token').ok,false);
assert.ok(!('pin_hash' in a)&&!('salt' in a));
const tasks=good(call('tasks',{},a.token));
assert.equal(tasks.length,3);assert.ok(tasks.every(t=>t.grade===5));
for(const task of tasks){
  const answers={word:{meaning:'잘 듣는 것',clue:'친구의 말을 듣고 제안했다.',example:'=주의 깊게 듣는다'},sentence:{sentence:'계획했다. 그러나 실천하지 못했다.',reason:'대조 관계이다.'},paragraph:{central:task.passage.split('\n')[0],summary:'함께 배우는 공간이다.',question:'무엇을 배울까?'}}[task.kind];
  const body={task:task.id,answers,confidence:'조금 알겠어요'},id=crypto.randomUUID();
  good(call('submit',body,a.token,id));good(call('submit',body,a.token,id));
  good(call('submit',{...body,confidence:'설명할 수 있어요'},a.token));
}
const records=good(call('responses',{},a.token));
assert.equal(records.length,3);assert.ok(records.every(r=>r.revisions.length===2));
assert.equal(good(call('responses',{},b.token)).length,0);
assert.equal(good(call('responses',{},c.token)).length,0);
const wordRecord=records.find(r=>r.kind==='word');
assert.equal(call('feedback',{id:wordRecord.id,feedback:'침입'},a.token).ok,false);
good(call('feedback',{id:wordRecord.id,feedback:'근거를 잘 찾았어요.',observation:'교사 전용'},admin.token));
const studentRecord=good(call('responses',{},a.token)).find(r=>r.id===wordRecord.id);
assert.equal(studentRecord.feedback,'근거를 잘 찾았어요.');assert.ok(!('observation' in studentRecord));
const gradeTask={day:context.day_(),grade:5,kind:'word',title:'학교별 과제',passage:'새 낱말이 나왔다.',target:'낱말',school_id:2};
good(call('task',gradeTask,admin.token));
const exclusive=good(call('tasks',{},b.token)).find(t=>t.school_id===2);
assert.ok(exclusive);assert.ok(!good(call('tasks',{},a.token)).some(t=>t.id===exclusive.id));
assert.equal(call('submit',{task:exclusive.id,answers:{meaning:'뜻',clue:'단서',example:'문장'},confidence:'조금 알겠어요'},a.token).ok,false);
good(call('task',{...gradeTask,day:'2099-01-01'},admin.token));
assert.ok(good(call('tasks',{},b.token)).every(t=>t.day!=='2099-01-01'));
const csv=good(call('export',{filters:{school:schools[0].id,kind:'word'},history:true},admin.token));
assert.ok(csv.includes('온샘초등학교'));assert.ok(!csv.includes('동명초등학교'));assert.ok(csv.includes("'=주의"));
assert.equal(csv.split('\r\n').length,3);
assert.equal(good(call('export',{filters:{school:schools[1].id}},admin.token)).split('\r\n').length,1);
good(call('logout',{},a.token));assert.equal(call('me',{},a.token).ok,false);
const again=good(call('join',login));assert.equal(good(call('responses',{},again.token)).length,3);
for(let i=0;i<6;i++)assert.equal(call('join',{...login,pin:'000000'}).ok,false);
assert.equal(call('join',login).ok,false);
clock+=901000;assert.ok(good(call('join',login)).token);
busy=true;assert.equal(call('submit',{},again.token).code,'BUSY');busy=false;
const active=good(call('join',login));
const preserved=good(call('responses',{},active.token));
assert.equal(call('students',{},active.token).ok,false);
assert.equal(call('reset-student',{id:a.student},active.token).ok,false);
assert.equal(call('reset-student',{id:a.student}).ok,false);
assert.equal(call('reset-student',{id:99999},admin.token).ok,false);
assert.ok(good(call('students',{},admin.token)).every(s=>!('salt' in s)&&!('pin_hash' in s)));
const reset=good(call('reset-student',{id:a.student},admin.token));
assert.match(reset.code,/^[A-F0-9]{8}$/);
assert.equal(call('me',{},active.token).ok,false);
assert.equal(call('join',login).ok,false);
assert.equal(call('me',{},b.token).ok,true);
assert.equal(call('reset-pin',{...login,reset_code:reset.code,pin:'654321',pin_confirm:'111111'}).ok,false);
for(let i=0;i<6;i++)assert.equal(call('reset-pin',{...login,reset_code:'WRONG000',pin:'654321',pin_confirm:'654321'}).ok,false);
assert.equal(call('reset-pin',{...login,reset_code:reset.code,pin:'654321',pin_confirm:'654321'}).ok,false);
clock+=901000;
const replacement=good(call('reset-student',{id:a.student},admin.token));
assert.equal(call('reset-pin',{...login,reset_code:reset.code,pin:'654321',pin_confirm:'654321'}).ok,false);
const restored=good(call('reset-pin',{...login,reset_code:replacement.code.toLowerCase(),pin:'654321',pin_confirm:'654321'}));
assert.deepEqual(good(call('responses',{},restored.token)),preserved);
assert.equal(call('join',login).ok,false);
assert.ok(good(call('join',{...login,pin:'654321'})).token);
assert.equal(call('reset-pin',{...login,reset_code:replacement.code,pin:'123456',pin_confirm:'123456'}).ok,false);
assert.equal(good(call('students',{},admin.token)).find(s=>s.id===a.student).reset_pending,false);
const expired=good(call('reset-student',{id:c.student},admin.token));clock+=31*60000;
assert.equal(call('reset-pin',{...login,classroom:2,reset_code:expired.code,pin:'654321',pin_confirm:'654321'}).ok,false);
context.resetTeacherPassword_();assert.equal(call('me',{},admin.token).ok,false);
assert.equal(sheets.get('답안이력').getLastRow(),7);
const displayed=sheets.get('답안이력').data;
assert.deepEqual(displayed[0].slice(7,11),['학교','학년','반','번호']);
for(const row of displayed.slice(1)){
  const student=sheets.get('학생').data.find(s=>String(s[0])===String(row[2]));
  const school=sheets.get('학교').data.find(s=>String(s[0])===String(student[1]));
  assert.deepEqual(row.slice(7,11).map(String),[school[1],student[2],student[3],student[4]].map(String));
  assert.equal(row[23],row[5]);assert.equal(row[24],row[6]);
}
vm.runInContext(fs.readFileSync(path.join(__dirname,'../apps-script/ActivityBank.gs'),'utf8'),context);
const bank=plain(context.literacyBank_());
assert.equal(bank.length,60);assert.equal(new Set(bank.map(t=>t.passage)).size,60);
for(const grade of [5,6])for(const kind of ['word','sentence','paragraph']){
  const group=bank.filter(t=>t.grade===grade&&t.kind===kind);assert.equal(group.length,10);
  for(const task of group){assert.ok(task.passage.trim());if(kind==='paragraph')assert.ok(task.passage.split('\n').length>=(grade===5?3:4));if(kind==='sentence')assert.equal(task.passage.split('\n').length,2);}
}
const fixedToday=plain(context.dailyTaskIds_({student:a.student,grade:5,school_id:1},good(call('tasks',{},good(call('join',{...login,pin:'654321'})).token))));
bank.forEach(task=>context.createTask_({...task,day:context.day_()},task.request_id));
assert.deepEqual(plain(context.dailyTaskIds_({student:a.student,grade:5,school_id:1},plain(context.rows_('tasks')).filter(t=>Number(t.grade)===5).map(t=>({...t,id:Number(t.id)})))),fixedToday,'adding a bank does not replace the existing daily choice');
const dailyLogin={code:schools[1].code,grade:6,classroom:3,number:4,pin:'123456'};
const seen=new Set();let firstBankTask;
for(let date=0;date<10;date++){
 if(date)clock+=24*3600000;
 const learner=good(call('join',dailyLogin)),daily=good(call('tasks',{},learner.token)).filter(t=>t.daily);
 assert.equal(daily.length,3);assert.equal(new Set(daily.map(t=>t.kind)).size,3);assert.ok(daily.every(t=>t.bank&&t.grade===6));
 assert.deepEqual(good(call('tasks',{},learner.token)).filter(t=>t.daily).map(t=>t.id),daily.map(t=>t.id));
 for(const task of daily){
  assert.ok(!seen.has(task.id),'finished bank tasks must not repeat before exhaustion');seen.add(task.id);
  if(task.kind==='word'&&!firstBankTask)firstBankTask=task;
  const answers={word:{meaning:'서로 힘을 모음',clue:'함께 역할을 나누었다.',example:'친구와 협력했다.'},sentence:{sentence:'비가 왔다. 그래서 안에서 놀았다.',reason:'앞 문장이 까닭이다.'},paragraph:{central:task.passage.split('\n')[0],summary:'핵심 내용을 설명한다.',question:'어떤 예가 더 있을까?'}}[task.kind];
  good(call('submit',{task:task.id,answers,confidence:'조금 알겠어요'},learner.token));
 }
}
assert.equal(seen.size,30);
clock+=24*3600000;
const repeatLearner=good(call('join',dailyLogin)),repeated=good(call('tasks',{},repeatLearner.token)).find(t=>t.daily&&t.kind==='word');
assert.ok(seen.has(repeated.id));
const repeatBody={task:repeated.id,answers:{meaning:'뜻',clue:'단서',example:'활용 문장'},confidence:'조금 알겠어요'};
good(call('submit',repeatBody,repeatLearner.token));good(call('submit',repeatBody,repeatLearner.token));
const repeatedRecords=good(call('responses',{},repeatLearner.token));
assert.equal(repeatedRecords.length,31);
assert.equal(repeatedRecords.filter(r=>r.task===repeated.id).length,2);
assert.equal(repeatedRecords.find(r=>r.task===repeated.id&&r.day===context.day_()).revisions.length,2);
assert.equal(sheets.get('답안이력').data.at(-1)[11],context.day_(),'readable history uses the actual practice date');
const dailyTeacherPassword=logs.filter(text=>text.startsWith('새 교사 비밀번호')).at(-1).split(': ').at(-1);
const dailyAdmin=good(call('join',{role:'teacher',password:dailyTeacherPassword}));
good(call('task',{...gradeTask,grade:6,day:context.day_(),title:'오늘 교사 지정',school_id:2},dailyAdmin.token));
const nextStudent=good(call('join',{...dailyLogin,number:5}));
assert.ok(good(call('tasks',{},nextStudent.token)).some(t=>t.daily&&t.title==='오늘 교사 지정'));
console.log('PASS: roles, privacy, recovery, original history, 60 bank texts, stable daily choices, 10 days without repeats, dated repeat records and teacher priority.');
