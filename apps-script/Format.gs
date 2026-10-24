/** Owner enters the new credential directly in the bound spreadsheet dialog. */
function changeTeacherPassword(){
  if(!Session.getActiveUser().getEmail()||Session.getActiveUser().getEmail()!==Session.getEffectiveUser().getEmail())throw new Error('시트 소유 계정의 편집기에서 실행하세요.');
  const ui=SpreadsheetApp.getUi();
  const first=ui.prompt('교사 비밀번호 변경','새 교사 비밀번호를 직접 입력하세요.',ui.ButtonSet.OK_CANCEL);
  if(first.getSelectedButton()!==ui.Button.OK)return;
  const password=first.getResponseText();
  if(password.length<4){ui.alert('비밀번호는 4자 이상 입력하세요. 변경하지 않았습니다.');return;}
  const second=ui.prompt('교사 비밀번호 확인','같은 비밀번호를 한 번 더 입력하세요.',ui.ButtonSet.OK_CANCEL);
  if(second.getSelectedButton()!==ui.Button.OK)return;
  if(second.getResponseText()!==password){ui.alert('두 비밀번호가 다릅니다. 변경하지 않았습니다.');return;}
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try{
    const salt=random_();
    PropertiesService.getScriptProperties().setProperties({TEACHER_SALT:salt,TEACHER_HASH:secretHash_(password,salt)});
    rows_('sessions').forEach((row,index)=>{if(row.role==='teacher'){update_('sessions',index,{...row,expires:'0'});CacheService.getScriptCache().remove('session:'+row.token_hash);}});
  }finally{lock.releaseLock();}
  console.log('교사 비밀번호 변경 완료. 기존 교사 로그인은 종료했습니다.');
  ui.alert('교사 비밀번호를 변경했습니다. 사이트에서 새 비밀번호로 입장하세요.');
}

/** Editor-only formatting. Does not change the web app's source tables. */
function formatTeacherWorkbook(){
  if(!Session.getActiveUser().getEmail()||Session.getActiveUser().getEmail()!==Session.getEffectiveUser().getEmail())throw new Error('시트 소유 계정의 편집기에서 실행하세요.');
  const book=SpreadsheetApp.getActiveSpreadsheet();
  if(!book)throw new Error('연결된 시트에서 실행하세요.');
  const names=['학교','학생','활동','답안이력','피드백','세션'];
  const before=names.map(name=>JSON.stringify(book.getSheetByName(name).getDataRange().getValues()));
  const navy='#24385f',ink='#203456',pale='#eef3fb';
  const widths={학교:[65,210,220],학생:[65,85,75,75,85,120,120,215],활동:[65,125,75,90,270,440,190,320,90,240,120],답안이력:[140,90,90,90,540,180,220],피드백:[95,420,420,220],세션:[120,90,90,220,220]};
  for(const name of names){
    const sheet=book.getSheetByName(name),cols=widths[name].length;
    sheet.setHiddenGridlines(true);sheet.setFrozenRows(1);sheet.setFrozenColumns(name==='학교'?0:1);
    sheet.setTabColor(name==='학교'?'#6e83a8':name==='활동'?'#526e9f':'#b0bdd3');
    const range=sheet.getRange(1,1,sheet.getMaxRows(),cols);
    range.setFontFamily('Arial').setFontSize(11).setFontColor(ink).setVerticalAlignment('top').setWrap(true);
    widths[name].forEach((width,index)=>sheet.setColumnWidth(index+1,width));
    const existing=sheet.getBandings();
    if(!existing.length){const band=range.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY);band.setHeaderRowColor(navy).setFirstRowColor('#ffffff').setSecondRowColor(pale);}
    sheet.getRange(1,1,1,cols).setBackground(navy).setFontColor('#ffffff').setFontWeight('bold').setVerticalAlignment('middle');
    sheet.setRowHeight(1,34);
    if(sheet.getLastRow()>1)sheet.autoResizeRows(2,sheet.getLastRow()-1);
  }
  book.getSheetByName('학생').hideColumns(6,2);
  book.getSheetByName('활동').hideColumns(11);
  book.getSheetByName('답안이력').hideColumns(1,2);
  // A separate reading surface leaves machine-readable header names intact.
  if(book.getSheetByName('교사용 현황'))throw new Error('교사용 현황 탭이 이미 있어 덮어쓰지 않았습니다.');
  const s=book.insertSheet('교사용 현황',0);
  s.setTabColor(navy);s.setHiddenGridlines(true);
  s.getRange('A1:F31').setFontFamily('Arial').setFontSize(11).setFontColor(ink).setVerticalAlignment('middle');
  s.setColumnWidth(1,24);s.setColumnWidth(2,280);s.setColumnWidths(3,2,115);s.setColumnWidth(5,130);s.setColumnWidth(6,24);
  s.setRowHeights(1,31,28);
  s.getRange('B2').setValue('은하수 문해 기초 활동 현황').setFontSize(16).setFontWeight('bold');
  s.setRowHeight(2,38);
  s.getRange('B3').setFormula('="기준일  "&TEXT(TODAY(),"yyyy.mm.dd")').setFontColor('#647797');
  s.getRange('B5:C9').setValues([['전체 현황','누적 / 오늘'],['등록 학생',''],['누적 저장 횟수',''],['오늘 저장 횟수',''],['등록 활동','']]);
  s.getRange('C6').setFormula('=COUNTA(\'학생\'!A2:A)');
  s.getRange('C7').setFormula('=COUNTA(\'답안이력\'!A2:A)');
  s.getRange('C8').setFormula('=COUNTIFS(\'답안이력\'!G2:G,">="&TEXT(TODAY(),"yyyy-mm-dd"),\'답안이력\'!G2:G,"<"&TEXT(TODAY()+1,"yyyy-mm-dd"))');
  s.getRange('C9').setFormula('=COUNTA(\'활동\'!A2:A)');
  s.getRange('B12:E14').setValues([['학교별 학생 등록','5학년','6학년','전체'],['온샘초등학교','','',''],['동명초등학교','','','']]);
  for(let row=13;row<=14;row++){
    const id=row-12;
    s.getRange(row,3).setFormula('=COUNTIFS(\'학생\'!B2:B,"'+id+'",\'학생\'!C2:C,"5")');
    s.getRange(row,4).setFormula('=COUNTIFS(\'학생\'!B2:B,"'+id+'",\'학생\'!C2:C,"6")');
    s.getRange(row,5).setFormula('=SUM(C'+row+':D'+row+')');
  }
  s.getRange('B17:D20').setValues([['활동 영역별 등록','5학년','6학년'],['어휘','',''],['문장','',''],['문단','','']]);
  ['word','sentence','paragraph'].forEach((kind,index)=>{
    [5,6].forEach((grade,column)=>s.getRange(18+index,3+column).setFormula('=COUNTIFS(\'활동\'!D2:D,"'+kind+'",\'활동\'!C2:C,"'+grade+'")'));
  });
  s.getRange('B23').setValue('기록 확인').setFontWeight('bold');
  s.getRange('B24').setFormula('=HYPERLINK("https://100ssj.github.io/Milky/","학생 답안과 피드백 보기")');
  s.getRange('C24:E24').merge().setValue('사이트에서 교사로 입장').setFontColor('#647797');
  [['B25','답안이력','답안 저장 이력 원본'],['B26','활동','등록 활동과 지문'],['B27','학교','학교별 입장 코드']].forEach(([cell,name,label])=>s.getRange(cell).setFormula('=HYPERLINK("#gid='+book.getSheetByName(name).getSheetId()+'","'+label+'")'));
  s.getRange('B29:E30').merge().setValue('누적 저장 횟수에는 답안을 수정한 뒤 다시 저장한 횟수도 포함합니다. 학생 답안은 사이트의 교사 화면에서 읽을 수 있습니다.').setWrap(true).setFontColor('#647797');
  ['B5:C5','B12:E12','B17:D17'].forEach(a1=>s.getRange(a1).setBackground(navy).setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center'));
  ['B6:C9','B13:E14','B18:D20'].forEach(a1=>s.getRange(a1).setBackground(pale));
  ['C6:C9','C13:E14','C18:D20'].forEach(a1=>s.getRange(a1).setNumberFormat('#,##0').setHorizontalAlignment('right'));
  s.getRange('C6:C9').setFontSize(14).setFontWeight('bold');
  book.setSpreadsheetTimeZone('Asia/Seoul');
  book.setActiveSheet(s);s.getRange('B2').activate();
  SpreadsheetApp.flush();
  const after=names.map(name=>JSON.stringify(book.getSheetByName(name).getDataRange().getValues()));
  if(before.some((value,index)=>value!==after[index]))throw new Error('원본 데이터 변경 여부를 확인하세요.');
  const values=s.getRange('B5:E20').getDisplayValues();
  if(values.flat().some(value=>/^#(REF!|ERROR!|VALUE!|NAME\?|N\/A|DIV\/0!)/.test(value)))throw new Error('현황 수식을 확인하세요.');
  console.log('완료: 교사용 현황 생성, 원본 값과 열 이름 보존, 수식 오류 없음.');
}

/** Backfill readable student identity alongside the untouched source columns. */
function showStudentAuthors(){
  if(!Session.getActiveUser().getEmail()||Session.getActiveUser().getEmail()!==Session.getEffectiveUser().getEmail())throw new Error('시트 소유 계정의 편집기에서 실행하세요.');
  const book=SpreadsheetApp.getActiveSpreadsheet(),sheet=book.getSheetByName('답안이력');
  const before=sheet.getRange(1,1,Math.max(sheet.getLastRow(),1),7).getValues();
  const header=sheet.getRange(1,8,1,HISTORY_DISPLAY_HEADERS_.length).getValues()[0];
  if(header.some((v,i)=>v&&v!==HISTORY_DISPLAY_HEADERS_[i]))throw new Error('기존 추가 열이 있어 덮어쓰지 않았습니다.');
  const students=new Map(rows_('students').map(s=>[s.id,s])),tasks=new Map(rows_('tasks').map(t=>[t.id,t])),schools=new Map(rows_('schools').map(s=>[s.id,s]));
  const display=rows_('history').map(row=>{
    const student=students.get(row.student),task=tasks.get(row.task);
    if(!student||!task||!schools.has(student.school_id))throw new Error('학생 또는 활동 연결을 확인하세요.');
    return historyDisplay_(row,{...student,school_name:schools.get(student.school_id).name},task).map(v=>{const text=String(v==null?'':v);return /^[=+\-@]/.test(text)?"'"+text:text;});
  });
  sheet.getRange(1,8,1,HISTORY_DISPLAY_HEADERS_.length).setValues([HISTORY_DISPLAY_HEADERS_]);
  if(display.length)sheet.getRange(2,8,display.length,HISTORY_DISPLAY_HEADERS_.length).setNumberFormat('@').setValues(display);
  sheet.getRange(1,8,sheet.getMaxRows(),HISTORY_DISPLAY_HEADERS_.length).setFontFamily('Arial').setFontSize(11).setFontColor('#203456').setWrap(true).setVerticalAlignment('top');
  sheet.getRange(1,8,1,HISTORY_DISPLAY_HEADERS_.length).setBackground('#24385f').setFontColor('#ffffff').setFontWeight('bold').setVerticalAlignment('middle');
  sheet.getRange(2,8,sheet.getMaxRows()-1,HISTORY_DISPLAY_HEADERS_.length).setBackground('#eef3fb');
  [190,65,65,65,120,85,260,180,320,320,320,320,320,320,320,320,180,220].forEach((w,i)=>sheet.setColumnWidth(8+i,w));
  sheet.setFrozenColumns(0);sheet.setFrozenRows(1);sheet.hideColumns(1,7);
  if(display.length)sheet.autoResizeRows(2,display.length);
  const dashboard=book.getSheetByName('교사용 현황');
  if(dashboard)dashboard.getRange('B25').setFormula('=HYPERLINK("#gid='+sheet.getSheetId()+'","학생별 활동 기록 보기")');
  SpreadsheetApp.flush();
  const after=sheet.getRange(1,1,before.length,7).getValues();
  if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('원본 데이터 변경 여부를 확인하세요.');
  book.setActiveSheet(sheet);sheet.getRange('H1').activate();
  console.log('완료: '+display.length+'개 저장 이력에 학교·학년·반·번호를 표시했습니다. 원본 7개 열은 보존했습니다.');
}
