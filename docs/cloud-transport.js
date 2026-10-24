/* Cross-origin Sheets transport: MessageChannel + Apps Script's google.script.run.
   No JSONP, no credentials in URLs, and no no-cors submission with unverifiable results. */
window.MilkyCloud = (() => {
  const config=window.MILKY_CONFIG||{}, endpoint=config.appsScriptUrl||'';
  const sessionKey='milky-sheets-session:'+endpoint;
  let token='';try{token=sessionStorage.getItem(sessionKey)||'';}catch{}
  let connection,port,frame;const waiting=new Map(),unconfirmed=new Map();
  const random=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
  function connect(){
    if(connection)return connection;
    connection=new Promise((resolve,reject)=>{
      let url;try{url=new URL(endpoint);}catch{reject(new Error('구글 시트 연결 주소가 아직 설정되지 않았습니다.'));return;}
      if(url.origin!=='https://script.google.com'||!/^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname)){reject(new Error('Apps Script 웹 앱의 /exec 배포 주소를 확인해 주세요.'));return;}
      const nonce=random();url.searchParams.set('origin',location.origin);url.searchParams.set('nonce',nonce);
      const timer=setTimeout(()=>{window.removeEventListener('message',receive);if(frame)frame.remove();connection=null;reject(new Error('구글 시트 연결이 지연됩니다. 교사에게 연결 주소와 배포 권한을 확인해 주세요.'));},45000);
      function receive(event){
        let origin;try{origin=new URL(event.origin);}catch{return;}
        if(origin.protocol!=='https:'||!(origin.hostname==='script.google.com'||origin.hostname==='script.googleusercontent.com'||origin.hostname.endsWith('.googleusercontent.com')))return;
        if(event.data?.type!=='milky-sheets-ready'||event.data.nonce!==nonce||!event.ports[0])return;
        clearTimeout(timer);window.removeEventListener('message',receive);port=event.ports[0];
        port.onmessage=message=>{const item=waiting.get(message.data?.id);if(!item)return;clearTimeout(item.timer);waiting.delete(message.data.id);item.resolve(message.data.result);};port.start();resolve();
      }
      window.addEventListener('message',receive);
      frame=document.createElement('iframe');frame.hidden=true;frame.title='구글 시트 저장 연결';frame.src=url.href;document.body.append(frame);
    });
    return connection;
  }
  async function request(action,payload={}){
    await connect();const mutation=['submit','task'].includes(action),key=action+JSON.stringify(payload);
    const requestId=mutation&&unconfirmed.has(key)?unconfirmed.get(key):random();
    if(mutation)unconfirmed.set(key,requestId);
    for(let attempt=0;attempt<2;attempt++){
      const id=random();const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiting.delete(id);reject(new Error('저장 결과를 확인하지 못했습니다. 입력 내용은 임시 보관됩니다. 다시 제출해 주세요.'));},90000);waiting.set(id,{resolve,reject,timer});port.postMessage({id,request:{action,payload,token,requestId}});});
      if(!result?.ok){if(result?.code==='BUSY'&&attempt===0)continue;if(result?.code==='INPUT')unconfirmed.delete(key);throw new Error(result?.error||'시트 요청을 처리하지 못했습니다.');}
      const data=result.data;
      if(action==='join'){token=data.token;try{sessionStorage.setItem(sessionKey,token);}catch{}delete data.token;}
      if(action==='logout'){token='';try{sessionStorage.removeItem(sessionKey);}catch{}}
      if(mutation)unconfirmed.delete(key);return data;
    }
  }
  return {request,isConfigured:()=>Boolean(endpoint),hasSession:()=>Boolean(token),warmup:connect};
})();
