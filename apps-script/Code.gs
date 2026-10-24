/** Milky: private Sheets storage. Deploy as owner; all RPCs check app sessions. */
const TABLES_ = {
  schools: ['학교', ['id','name','code']],
  students: ['학생', ['id','school_id','grade','classroom','number','salt','pin_hash','created']],
  tasks: ['활동', ['id','day','grade','kind','title','passage','target','hint','school_id','source_note','request_id']],
  history: ['답안이력', ['submission_id','response_id','student','task','answers_json','confidence','saved']],
  feedback: ['피드백', ['response_id','feedback','observation','updated']],
  sessions: ['세션', ['token_hash','role','student','created','expires']]
};
const ANSWERS_ = {word:['meaning','clue','example'],sentence:['sentence','reason'],paragraph:['central','summary','question']};
const CONFIDENCE_ = ['도움이 필요해요','조금 알겠어요','설명할 수 있어요'];
const HISTORY_DISPLAY_HEADERS_=['학교','학년','반','번호','활동일','영역','활동명','핵심 낱말 / 표현','짐작한 뜻','문맥의 단서','활용 문장','연결한 문장','표현 선택 이유','중심 문장','핵심 요약','질문','자기 점검','저장 시각'];

// Editor-visible entry point. Anonymous web-app visitors cannot initialize storage.
function initializeStorage(){
  const active=Session.getActiveUser().getEmail(),effective=Session.getEffectiveUser().getEmail();
  if(!active||active!==effective)throw new Error('시트 소유 계정의 Apps Script 편집기에서 실행해 주세요.');
  setupAdmin_();
}

// Run ONLY in the bound Apps Script editor. Trailing underscore blocks client calls.
function setupAdmin_() {
  const properties=PropertiesService.getScriptProperties();
  const book=SpreadsheetApp.getActiveSpreadsheet();
  if(!book)throw new Error('저장할 구글 시트의 확장 프로그램 > Apps Script에서 실행해 주세요.');
  const previous=properties.getProperty('SPREADSHEET_ID');
  if(previous&&previous!==book.getId())throw new Error('이미 다른 시트에 연결되어 있습니다. 기존 연결을 먼저 확인해 주세요.');
  properties.setProperty('SPREADSHEET_ID',book.getId());
  if(!properties.getProperty('PEPPER'))properties.setProperty('PEPPER',random_()+random_());
  if(!properties.getProperty('ALLOWED_ORIGINS'))properties.setProperty('ALLOWED_ORIGINS','https://100ssj.github.io');
  Object.keys(TABLES_).forEach(key=>{
    const [name,headers]=TABLES_[key];let sheet=book.getSheetByName(name);
    if(!sheet)sheet=book.insertSheet(name);
    if(sheet.getLastRow()===0){sheet.getRange(1,1,1,headers.length).setValues([headers]);sheet.setFrozenRows(1);sheet.getRange(1,1,1,headers.length).setBackground('#24385f').setFontColor('#ffffff').setFontWeight('bold');}
    else if(sheet.getRange(1,1,1,headers.length).getValues()[0].join('|')!==headers.join('|'))throw new Error(name+' 시트의 기존 열이 다릅니다. 덮어쓰지 않았습니다.');
  });
  book.getSheetByName('답안이력').getRange(1,8,1,HISTORY_DISPLAY_HEADERS_.length).setValues([HISTORY_DISPLAY_HEADERS_]);
  if(!rows_('schools').length){
    append_('schools',{id:1,name:'온샘초등학교',code:'OS-'+random_().slice(0,10).toUpperCase()});
    append_('schools',{id:2,name:'동명초등학교',code:'DM-'+random_().slice(0,10).toUpperCase()});
  }
  if(!rows_('tasks').length)seedTasks_();
  if(!properties.getProperty('TEACHER_HASH'))resetTeacherPassword_();
  book.getSheetByName('세션').hideSheet();
  console.log('설정 완료. 학교 코드는 비공개 시트의 학교 탭에서 확인하세요. 시트 자체는 학생에게 공유하지 않습니다.');
}

function resetTeacherPassword_(){
  const properties=PropertiesService.getScriptProperties(),password=random_().slice(0,24),salt=random_();
  properties.setProperties({TEACHER_SALT:salt,TEACHER_HASH:secretHash_(password,salt)});
  rows_('sessions').forEach((row,index)=>{if(row.role==='teacher'){update_('sessions',index,{...row,expires:'0'});CacheService.getScriptCache().remove('session:'+row.token_hash);}});
  console.log('새 교사 비밀번호 (공개 저장소에 올리지 마세요): '+password);
}

function doGet(e){
  const p=(e&&e.parameter)||{},origins=String(PropertiesService.getScriptProperties().getProperty('ALLOWED_ORIGINS')||'').split(',');
  if(!origins.includes(p.origin)||!/^[-\w]{24,100}$/.test(p.nonce||''))return HtmlService.createHtmlOutput('GitHub 사이트에서 접속해 주세요.');
  const template=HtmlService.createTemplateFromFile('Bridge');
  template.originJSON=JSON.stringify(p.origin);template.nonceJSON=JSON.stringify(p.nonce);
  return template.evaluate().setTitle('Milky Sheets connection').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function rpc(request){
  let lock;
  try{
    if(!request||typeof request!=='object'||JSON.stringify(request).length>45000)fail_('요청 내용을 확인해 주세요.');
    const action=String(request.action||''),body=request.payload||{};
    if(!['join','logout','me','context','tasks','responses','submit','task','feedback','export','students','reset-student','reset-pin'].includes(action))fail_('지원하지 않는 요청입니다.');
    const write=['join','logout','submit','task','feedback','reset-student','reset-pin'].includes(action);
    if(write){lock=LockService.getScriptLock();if(!lock.tryLock(20000))return {ok:false,code:'BUSY',error:'제출이 몰리고 있습니다. 잠시 후 다시 시도해 주세요.'};}
    if(action==='join')return {ok:true,data:join_(body)};
    if(action==='reset-pin')return {ok:true,data:resetPin_(body)};
    const session=session_(request.token);
    if(action==='logout'){
      const hashed=tokenHash_(request.token);const sessions=rows_('sessions'),index=sessions.findIndex(r=>r.token_hash===hashed);
      if(index>=0)update_('sessions',index,{...sessions[index],expires:'0'});
      CacheService.getScriptCache().remove('session:'+hashed);return {ok:true,data:{ok:true}};
    }
    if(action==='me')return {ok:true,data:identity_(session)};
    if(action==='context'){teacher_(session);return {ok:true,data:{schools:rows_('schools').map(s=>({...s,id:Number(s.id)}))}};}
    if(action==='students'){teacher_(session);return {ok:true,data:studentList_()};}
    if(action==='reset-student'){teacher_(session);return {ok:true,data:resetStudent_(body)};}
    if(action==='tasks')return {ok:true,data:tasks_(session)};
    if(action==='responses')return {ok:true,data:responses_(session)};
    if(action==='submit')return {ok:true,data:submit_(session,body,request.requestId)};
    if(action==='task'){teacher_(session);return {ok:true,data:createTask_(body,request.requestId)};}
    if(action==='feedback'){teacher_(session);return {ok:true,data:feedback_(body)};}
    if(action==='export'){teacher_(session);return {ok:true,data:export_(session,body)}};
  }catch(error){return {ok:false,code:error.milky?'INPUT':'INTERNAL',error:error.milky?error.message:'시트 연결을 처리하지 못했습니다. 교사에게 문의해 주세요.'};}
  finally{if(lock&&lock.hasLock())lock.releaseLock();}
}

function join_(body){
  const teacher=body.role==='teacher',school=teacher?null:rows_('schools').find(s=>s.code===String(body.code||'').trim().toUpperCase());
  const grade=Number(body.grade),classroom=Number(body.classroom),number=Number(body.number),pin=String(body.pin||'');
  const key='login:'+tokenHash_(teacher?'teacher':String(body.code)+'|'+grade+'|'+classroom+'|'+number);
  const cache=CacheService.getScriptCache(),failures=Number(cache.get(key)||0);
  if(failures>=6)fail_('입력 오류가 반복되었습니다. 15분 후 다시 시도하거나 교사에게 문의해 주세요.');
  const reject=message=>{cache.put(key,String(failures+1),900);fail_(message);};
  let student='';
  if(teacher){
    const p=PropertiesService.getScriptProperties();
    if(!p.getProperty('TEACHER_HASH')||!equal_(secretHash_(String(body.password||''),p.getProperty('TEACHER_SALT')),p.getProperty('TEACHER_HASH')))reject('교사 비밀번호를 확인해 주세요.');
  }else{
    if(!school)reject('학교 입장 코드를 확인해 주세요.');
    if(![5,6].includes(grade)||!Number.isInteger(classroom)||classroom<1||classroom>30||!Number.isInteger(number)||number<1||number>60||!/^\d{6}$/.test(pin))fail_('학년, 반(1~30), 번호(1~60), 숫자 6자리 비밀번호를 확인해 주세요.');
    const students=rows_('students');let row=students.find(s=>s.school_id===school.id&&Number(s.grade)===grade&&Number(s.classroom)===classroom&&Number(s.number)===number);
    if(row){if(PropertiesService.getScriptProperties().getProperty('RESET_'+row.id))reject('선생님에게 받은 재설정 코드로 비밀번호를 다시 정해 주세요.');if(!equal_(row.pin_hash,secretHash_(pin,row.salt)))reject('학생 비밀번호가 일치하지 않습니다.');}
    else{const salt=random_();row={id:next_(students,'id'),school_id:school.id,grade,classroom,number,salt,pin_hash:secretHash_(pin,salt),created:now_()};append_('students',row);}
    student=Number(row.id);
  }
  cache.remove(key);
  const token=random_()+random_(),created=Date.now(),session={token_hash:tokenHash_(token),role:teacher?'teacher':'student',student,created,expires:created+8*3600*1000};
  append_('sessions',session);cache.put('session:'+session.token_hash,JSON.stringify(session),600);
  return {...identity_(session),token};
}

function session_(token){
  if(!/^[a-f0-9]{64}$/.test(String(token||'')))fail_('다시 입장해 주세요.');
  const hashed=tokenHash_(token),cache=CacheService.getScriptCache(),cached=cache.get('session:'+hashed);
  const session=cached?JSON.parse(cached):rows_('sessions').find(s=>s.token_hash===hashed);
  if(!session||Number(session.expires)<=Date.now())fail_('입장 시간이 만료되었습니다. 다시 입장해 주세요.');
  if(!cached)cache.put('session:'+hashed,JSON.stringify(session),600);
  return session;
}
function identity_(session){
  if(session.role==='teacher')return {role:'teacher',expires:Number(session.expires)/1000};
  const student=rows_('students').find(s=>Number(s.id)===Number(session.student));if(!student)fail_('학생 계정을 확인해 주세요.');
  const school=rows_('schools').find(s=>s.id===student.school_id);if(!school)fail_('학교 정보를 확인해 주세요.');
  return {role:'student',student:Number(student.id),school_id:Number(school.id),school_name:school.name,grade:Number(student.grade),classroom:Number(student.classroom),number:Number(student.number),expires:Number(session.expires)/1000};
}
function teacher_(session){if(session.role!=='teacher')fail_('교사 권한이 필요합니다.');}
function revokeStudentSessions_(id){rows_('sessions').forEach((s,i)=>{if(s.role==='student'&&Number(s.student)===Number(id)){update_('sessions',i,{...s,expires:'0'});CacheService.getScriptCache().remove('session:'+s.token_hash);}});}
function studentList_(){
  const schools=new Map(rows_('schools').map(s=>[s.id,s.name])),p=PropertiesService.getScriptProperties();
  return rows_('students').map(s=>({id:Number(s.id),school_id:Number(s.school_id),school_name:schools.get(s.school_id),grade:Number(s.grade),classroom:Number(s.classroom),number:Number(s.number),reset_pending:Boolean(p.getProperty('RESET_'+s.id))}));
}
function resetStudent_(body){
  const student=rows_('students').find(s=>Number(s.id)===Number(body.id));if(!student)fail_('등록된 학생을 선택해 주세요.');
  const code=random_().slice(0,8).toUpperCase(),salt=random_(),expires=Date.now()+30*60000;
  PropertiesService.getScriptProperties().setProperty('RESET_'+student.id,JSON.stringify({salt,hash:secretHash_(code,salt),expires}));
  CacheService.getScriptCache().remove('reset:'+tokenHash_(student.school_id+'|'+student.grade+'|'+student.classroom+'|'+student.number));
  revokeStudentSessions_(student.id);
  return {code,expires,student:Number(student.id)};
}
function resetPin_(body){
  const school=rows_('schools').find(s=>s.code===String(body.code||'').trim().toUpperCase());
  const grade=Number(body.grade),classroom=Number(body.classroom),number=Number(body.number),pin=String(body.pin||'');
  if(!school||![5,6].includes(grade)||!Number.isInteger(classroom)||!Number.isInteger(number))fail_('학교·학년·반·번호와 재설정 코드를 확인해 주세요.');
  if(!/^\d{6}$/.test(pin)||pin!==String(body.pin_confirm||''))fail_('새 비밀번호는 같은 숫자 6자리로 두 번 입력하세요.');
  const students=rows_('students'),index=students.findIndex(s=>s.school_id===school.id&&Number(s.grade)===grade&&Number(s.classroom)===classroom&&Number(s.number)===number);
  const key='reset:'+tokenHash_(school.id+'|'+grade+'|'+classroom+'|'+number),cache=CacheService.getScriptCache(),failures=Number(cache.get(key)||0);
  if(failures>=6)fail_('재설정 코드 입력 오류가 반복되었습니다. 15분 후 다시 시도해 주세요.');
  const student=students[index],p=PropertiesService.getScriptProperties(),entry=student&&p.getProperty('RESET_'+student.id),reset=entry?JSON.parse(entry):null;
  if(!reset||reset.expires<=Date.now()||!equal_(reset.hash,secretHash_(String(body.reset_code||'').trim().toUpperCase(),reset.salt))){cache.put(key,String(failures+1),900);fail_('학교·학년·반·번호와 재설정 코드 또는 유효시간을 확인해 주세요.');}
  const salt=random_();update_('students',index,{...student,salt,pin_hash:secretHash_(pin,salt)});
  revokeStudentSessions_(student.id);p.deleteProperty('RESET_'+student.id);cache.remove(key);
  cache.remove('login:'+tokenHash_(String(body.code)+'|'+grade+'|'+classroom+'|'+number));
  return join_({...body,role:'student'});
}
function tasks_(session){
  const identity=identity_(session);
  return rows_('tasks').filter(t=>session.role==='teacher'||(Number(t.grade)===identity.grade&&t.day<=day_()&&(!t.school_id||Number(t.school_id)===identity.school_id))).map(t=>({...t,id:Number(t.id),grade:Number(t.grade),school_id:t.school_id?Number(t.school_id):null})).sort((a,b)=>b.day.localeCompare(a.day)||a.id-b.id);
}
function responses_(session){
  const taskMap=new Map(rows_('tasks').map(t=>[t.id,t])),students=new Map(rows_('students').map(s=>[s.id,s])),schools=new Map(rows_('schools').map(s=>[s.id,s]));
  const feedback=new Map(rows_('feedback').map(f=>[f.response_id,f])),records=new Map();
  for(const h of rows_('history')){
    if(session.role!=='teacher'&&Number(h.student)!==Number(session.student))continue;
    const task=taskMap.get(h.task),student=students.get(h.student);if(!task||!student)continue;
    let record=records.get(h.response_id);
    if(!record){const f=feedback.get(h.response_id)||{};record={...task,id:Number(h.response_id),task:Number(h.task),student:Number(h.student),school_id:Number(student.school_id),school_name:schools.get(student.school_id).name,grade:Number(student.grade),classroom:Number(student.classroom),number:Number(student.number),created:h.saved,revisions:[],feedback:f.feedback||''};if(session.role==='teacher')record.observation=f.observation||'';delete record.request_id;records.set(h.response_id,record);}
    record.answers=JSON.parse(h.answers_json);record.confidence=h.confidence;record.updated=h.saved;record.revisions.push({answers:record.answers,confidence:h.confidence,saved:h.saved});
  }
  return [...records.values()].sort((a,b)=>b.updated.localeCompare(a.updated)||b.id-a.id);
}
function submit_(session,body,requestId){
  if(session.role!=='student')fail_('학생으로 입장해 주세요.');
  if(!/^[-\w]{20,100}$/.test(String(requestId||'')))fail_('제출 식별자가 올바르지 않습니다.');
  const identity=identity_(session),task=tasks_(session).find(t=>t.id===Number(body.task));if(!task)fail_('참여할 수 없는 활동입니다.');
  const answers=body.answers,keys=ANSWERS_[task.kind];
  if(!answers||typeof answers!=='object'||Array.isArray(answers)||Object.keys(answers).sort().join('|')!==[...keys].sort().join('|')||keys.some(k=>typeof answers[k]!=='string'||!answers[k].trim()||answers[k].length>2000))fail_('모든 답안을 2,000자 이내로 작성해 주세요.');
  if(task.kind==='paragraph'&&!task.passage.split('\n').includes(answers.central))fail_('중심 문장을 선택해 주세요.');
  if(!CONFIDENCE_.includes(body.confidence))fail_('자기 점검을 선택해 주세요.');
  const history=rows_('history'),duplicate=history.find(h=>h.submission_id===requestId&&Number(h.student)===identity.student);
  if(duplicate)return {ok:true,saved:duplicate.saved};
  const previous=history.find(h=>Number(h.student)===identity.student&&Number(h.task)===task.id),saved=now_();
  append_('history',{submission_id:requestId,response_id:previous?previous.response_id:next_(history,'response_id'),student:identity.student,task:task.id,answers_json:JSON.stringify(answers),confidence:body.confidence,saved},{identity,task});
  return {ok:true,saved};
}
function createTask_(body,requestId){
  const day=String(body.day||''),grade=Number(body.grade),kind=String(body.kind||''),title=String(body.title||'').trim(),passage=String(body.passage||'').trim();
  const target=String(body.target||'').trim(),hint=String(body.hint||'').trim(),source_note=String(body.source_note||'').trim(),school_id=body.school_id?Number(body.school_id):'';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||isNaN(Date.parse(day))||![5,6].includes(grade)||!ANSWERS_[kind]||!title||title.length>100||!passage||passage.length>6000||target.length>300||hint.length>1000||source_note.length>500)fail_('활동 내용을 확인해 주세요.');
  if(kind!=='paragraph'&&!target)fail_('핵심 낱말 또는 접속 표현을 입력해 주세요.');
  if(kind==='paragraph'&&passage.split('\n').filter(s=>s.trim()).length<2)fail_('문단의 각 문장을 줄 바꾸어 2문장 이상 입력해 주세요.');
  if(school_id&&!rows_('schools').some(s=>Number(s.id)===school_id))fail_('대상 학교를 확인해 주세요.');
  const tasks=rows_('tasks');if(requestId&&tasks.some(t=>t.request_id===requestId))return {ok:true};
  append_('tasks',{id:next_(tasks,'id'),day,grade,kind,title,passage,target,hint,school_id,source_note,request_id:requestId||random_()});return {ok:true};
}
function feedback_(body){
  const id=String(body.id),feedback=String(body.feedback||'').trim(),observation=String(body.observation||'').trim();
  if(feedback.length>2000||observation.length>2000)fail_('피드백과 관찰은 각각 2,000자 이내로 작성해 주세요.');
  if(!rows_('history').some(h=>h.response_id===id))fail_('답안을 찾을 수 없습니다.');
  const rows=rows_('feedback'),index=rows.findIndex(r=>r.response_id===id),row={response_id:id,feedback,observation,updated:now_()};
  if(index<0)append_('feedback',row);else update_('feedback',index,row);return {ok:true};
}
function export_(session,body){
  const filters=body.filters||{},history=Boolean(body.history),rows=[['학생ID','학교','학년','반','번호','활동ID','활동일','영역','활동','핵심 낱말/접속 표현','짐작한 뜻','문맥 단서','활용 문장','연결한 문장','표현 선택 이유','중심 문장','요약','질문','자기점검','현재 교사 피드백','현재 교사 관찰','저장시각','저장차례']];
  const allowed=['school','grade','classroom','number','kind','day'];
  for(const r of responses_(session).filter(r=>allowed.every(k=>!filters[k]||String(r[k==='school'?'school_id':k])===String(filters[k])))){
    const snapshots=history?r.revisions:[{answers:r.answers,confidence:r.confidence,saved:r.updated}];
    snapshots.forEach((v,i)=>rows.push([r.student,r.school_name,r.grade,r.classroom,r.number,r.task,r.day,r.kind,r.title,r.target,...['meaning','clue','example','sentence','reason','central','summary','question'].map(k=>v.answers[k]||''),v.confidence,r.feedback,r.observation,v.saved,history?i+1:r.revisions.length]));
  }
  return '\ufeff'+rows.map(row=>row.map(value=>{let s=String(value==null?'':value);if(/^\s*[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');
}
function rows_(key){
  const [name,headers]=TABLES_[key],sheet=book_().getSheetByName(name);if(!sheet)fail_('시트 초기 설정이 필요합니다.');
  if(sheet.getLastRow()<2)return [];
  return sheet.getRange(2,1,sheet.getLastRow()-1,headers.length).getValues().filter(row=>row[0]!=='').map(row=>Object.fromEntries(headers.map((h,i)=>[h,String(row[i]==null?'':row[i])])));
}
function historyDisplay_(row,identity,task){
  const answers=JSON.parse(row.answers_json);
  return [identity.school_name,identity.grade,identity.classroom,identity.number,task.day,{word:'어휘',sentence:'문장',paragraph:'문단'}[task.kind],task.title,task.target,...['meaning','clue','example','sentence','reason','central','summary','question'].map(k=>answers[k]||''),row.confidence,row.saved];
}
function append_(key,row,display){const [name,headers]=TABLES_[key],sheet=book_().getSheetByName(name);let values=headers.map(k=>row[k]==null?'':row[k]);if(key==='history'&&display)values=values.concat(historyDisplay_(row,display.identity,display.task));write_(sheet,sheet.getLastRow()+1,values);}
function update_(key,index,row){const [name,headers]=TABLES_[key];write_(book_().getSheetByName(name),index+2,headers.map(k=>row[k]==null?'':row[k]));}
function write_(sheet,row,values){sheet.getRange(row,1,1,values.length).setNumberFormat('@').setValues([values.map(v=>{const s=String(v);return /^[=+\-@]/.test(s)?"'"+s:s;})]);}
function book_(){const id=PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');if(!id)fail_('먼저 시트 초기 설정을 실행해 주세요.');return SpreadsheetApp.openById(id);}
function random_(){return Utilities.getUuid().replace(/-/g,'');}
function secretHash_(value,salt){const pepper=PropertiesService.getScriptProperties().getProperty('PEPPER');if(!pepper)fail_('서버 초기 설정이 필요합니다.');return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(String(salt)+'|'+String(value),pepper));}
function tokenHash_(token){return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(token)));}
function equal_(a,b){a=String(a||'');b=String(b||'');let result=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)result|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return result===0;}
function next_(rows,key){return rows.reduce((max,row)=>Math.max(max,Number(row[key])||0),0)+1;}
function day_(){return Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd');}
function now_(){return Utilities.formatDate(new Date(),'Asia/Seoul',"yyyy-MM-dd'T'HH:mm:ssXXX");}
function fail_(message){const error=new Error(message);error.milky=true;throw error;}
function seedTasks_(){
  for(const grade of [5,6]){
    createTask_({day:day_(),grade,kind:'word',title:'문맥 속 낱말 탐정',passage:'학급 회의에서 민지는 친구들의 의견을 경청한 뒤 두 의견의 장점을 합친 방법을 제안했다.',target:'경청',hint:'친구들의 의견을 들은 뒤 어떤 행동을 했는지 단서를 찾아보세요.'},'seed-word-'+grade);
    createTask_({day:day_(),grade,kind:'sentence',title:'두 문장 사이의 다리',passage:'일회용품을 줄이기로 했다.\n축제 준비 시간에는 종이컵이 많이 사용되었다.',target:'그러나 / 그래서 / 왜냐하면',hint:'두 문장의 관계를 생각하며 연결하세요.'},'seed-sentence-'+grade);
    createTask_({day:day_(),grade,kind:'paragraph',title:'문단의 중심을 찾아서',passage:'학교 텃밭은 함께 배우는 교실이다.\n씨앗의 변화를 관찰하며 식물이 자라는 과정을 배운다.\n물을 주는 순서를 정하면서 책임을 나누는 방법도 익힌다.\n수확물을 나누며 배려의 의미를 생각한다.',hint:'여러 문장을 아우르는 중심 내용을 찾아 내 말로 간추려 보세요.'},'seed-paragraph-'+grade);
  }
}
