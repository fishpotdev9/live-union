import type { HistoryAddress, HistoryNicknameResolver } from '../../shared/history-contracts.ts';

const MAX_BYTES=2*1024*1024;
const TIMEOUT_MS=8000;
type JsonObject=Record<string,unknown>;
function object(value:unknown):JsonObject|undefined {
  return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as JsonObject:undefined;
}
function roomId(value:unknown):string|undefined {
  if(typeof value==='number')return Number.isSafeInteger(value)&&value>0?String(value):undefined;
  return typeof value==='string'&&/^[1-9][0-9]{0,19}$/.test(value)?value:undefined;
}
function nickname(value:unknown):string|undefined {
  if(typeof value!=='string'||value.length>256||/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value))return undefined;
  return value.trim()||undefined;
}

/** Native SSR anchor heading only; never derive identity from titles or scripts. */
function douyuPageNickname(html:string):string|undefined {
  const names:string[]=[];
  const rawTags=new Set(['script','style','textarea','title','xmp','iframe','noembed','noframes','noscript']);
  const inert=new Map<string,number>();let cursor=0;
  while(cursor<html.length){
    const start=html.indexOf('<',cursor);if(start<0)break;
    if(html.startsWith('<!--',start)){const end=html.indexOf('-->',start+4);if(end<0)break;cursor=end+3;continue;}
    if(html.startsWith('<!',start)||html.startsWith('<?',start)){const declaration=/^<[!?](?:"[^"]*"|'[^']*'|[^'">])*>/.exec(html.slice(start));if(!declaration)break;cursor=start+declaration[0].length;continue;}
    const tag=/^<(\/?)([A-Za-z][^\t\n\f\r />]*)(?=[\t\n\f\r />])((?:"[^"]*"|'[^']*'|[^'">])*)>/.exec(html.slice(start));
    if(!tag){cursor=start+1;continue;}cursor=start+tag[0].length;
    const name=tag[2].toLowerCase(),closing=!!tag[1];
    if(!closing&&name==='plaintext')break;
    if(!closing&&rawTags.has(name)){
      const end=new RegExp(`</${name}(?=[\\t\\n\\f\\r />])(?:"[^"]*"|'[^']*'|[^'">])*>`,'i').exec(html.slice(cursor));if(!end)break;cursor+=end.index+end[0].length;continue;
    }
    if(['template','select','svg','math'].includes(name)){inert.set(name,Math.max(0,(inert.get(name)??0)+(closing?-1:1)));continue;}
    if(closing||name!=='h3'||[...inert.values()].some(value=>value>0))continue;
    const attributes=[...tag[3].matchAll(/([^\s=/'">]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)];
    const classes=attributes.filter(value=>value[1].toLowerCase()==='class');
    const native=classes.some(value=>(value[2]??value[3]??value[4]??'').split(/\s+/).some(value=>/^anchorName__[A-Za-z0-9_-]+$/.test(value)||value==='Title-anchorName'));
    if(!native)continue;if(classes.length!==1)return undefined;
    const content=/^([^<]*)<\/h3[\t\n\f\r ]*>/i.exec(html.slice(cursor));if(!content)return undefined;cursor+=content[0].length;
    let invalid=false;
    const text=content[1].replace(/&([^;\s]{1,32});/g,(_full,entity:string)=>{
      const named:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};if(Object.hasOwn(named,entity))return named[entity];
      const numeric=/^#([0-9]+)$/.exec(entity),hex=/^#x([0-9a-f]+)$/i.exec(entity);const code=numeric?Number(numeric[1]):hex?parseInt(hex[1],16):-1;
      if(!Number.isSafeInteger(code)||code<1||code>0x10ffff||code>=0xd800&&code<=0xdfff){invalid=true;return '';}
      return String.fromCodePoint(code);
    });
    const anchor=invalid?undefined:nickname(text);if(!anchor)return undefined;names.push(anchor);
  }
  return names.length===1?names[0]:undefined;
}

/** JSON.parse alone silently accepts duplicate identity fields. Reject duplicate keys. */
function strictJson(raw:string):unknown {
  const value:unknown=JSON.parse(raw);
  const stack:(Set<string>|undefined)[]=[];
  for(let i=0;i<raw.length;i++){
    const c=raw[i];
    if(c==='{')stack.push(new Set());
    else if(c==='[')stack.push(undefined);
    else if(c==='}'||c===']')stack.pop();
    else if(c==='"'){
      const start=i++;
      for(;i<raw.length;i++){if(raw[i]==='\\')i++;else if(raw[i]==='"')break;}
      let next=i+1;while(/\s/.test(raw[next]??'')&&next<raw.length)next++;
      if(raw[next]===':'){
        const key:string=JSON.parse(raw.slice(start,i+1)),keys=stack[stack.length-1];
        if(!keys||keys.has(key))throw new Error('Ambiguous metadata');
        keys.add(key);
      }
    }
  }
  return value;
}

/** Read only an unambiguous, top-level TT_PROFILE_INFO JSON literal, never execute JS. */
function huyaProfile(html:string):JsonObject|undefined {
  const profiles:JsonObject[]=[];
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
    if(/\bsrc\s*=/i.test(match[1]))continue;
    const scriptType=/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(match[1]);
    if(scriptType&&!['','text/javascript','application/javascript'].includes((scriptType[1]??scriptType[2]??scriptType[3]).trim().toLowerCase()))continue;
    const source=match[2];if(!source.includes('TT_PROFILE_INFO'))continue;
    let depth=0;
    for(let i=0;i<source.length;){
      const c=source[i];
      if(c==='"'||c==="'"||c==='`'){
        const quote=c;i++;
        for(;i<source.length;i++){if(source[i]==='\\')i++;else if(source[i]===quote){i++;break;}}
      }else if(source.startsWith('//',i)){const end=source.indexOf('\n',i+2);i=end<0?source.length:end+1;}
      else if(source.startsWith('/*',i)){const end=source.indexOf('*/',i+2);if(end<0)return undefined;i=end+2;}
      // A regex literal can contain assignment-looking text. This metadata-only
      // grammar conservatively rejects slash expressions rather than parsing JS.
      else if(c==='/')return undefined;
      else if(/[A-Za-z_$]/.test(c)){
        const start=i++;while(i<source.length&&/[A-Za-z0-9_$]/.test(source[i]))i++;
        if(source.slice(start,i)!=='TT_PROFILE_INFO')continue;
        // A second reference/assignment or nested object is not a trusted identity source.
        if(depth!==0||profiles.length)return undefined;
        const prefix=source.slice(0,start);
        if(!/(?:^|[;\r\n])\s*(?:(?:var|let|const)\s+|window\.)?$/.test(prefix))return undefined;
        const assignment=/^\s*=\s*(\{)/.exec(source.slice(i));if(!assignment)return undefined;
        const first=i+assignment[0].length-1;let end=first,nesting=0,inString=false;
        for(;end<source.length;end++){
          const ch=source[end];
          if(inString){if(ch==='\\')end++;else if(ch==='"')inString=false;}
          else if(ch==='"')inString=true;
          else if(ch==='{')nesting++;
          else if(ch==='}'&&--nesting===0){end++;break;}
        }
        if(nesting!==0||!/^\s*(?:;|$)/.test(source.slice(end)))return undefined;
        const profile=object(strictJson(source.slice(first,end)));if(!profile)return undefined;
        profiles.push(profile);i=end;
      }else {if(c==='{'||c==='('||c==='[')depth++;else if(c==='}'||c===')'||c===']')depth--;i++;}
    }
  }
  return profiles.length===1?profiles[0]:undefined;
}

async function boundedText(response:Response,signal:AbortSignal):Promise<string|undefined> {
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_BYTES)){
    void response.body?.cancel().catch(()=>{});return undefined;
  }
  if(!response.body)return undefined;
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0,text='';
  const cancel=()=>{void reader.cancel().catch(()=>{});};
  signal.addEventListener('abort',cancel,{once:true});
  try{
    while(!signal.aborted){
      const part=await reader.read();if(signal.aborted)return undefined;
      if(part.done)return text+decoder.decode();
      bytes+=part.value.byteLength;if(bytes>MAX_BYTES){cancel();return undefined;}
      text+=decoder.decode(part.value,{stream:true});
    }
    return undefined;
  }finally{signal.removeEventListener('abort',cancel);cancel();reader.releaseLock();}
}

/** Canonical room identity only; the full page profile never leaves this parser. */
export function parseHuyaHistoryIdentity(html:string):string|undefined {
  try{return roomId(huyaProfile(html)?.profileRoom);}catch{return undefined;}
}

export function createHistoryNicknameResolver(fetchImpl:typeof fetch=fetch):HistoryNicknameResolver {
  return async(address:HistoryAddress,externalSignal:AbortSignal):Promise<string|undefined>=>{
    let timeout:ReturnType<typeof setTimeout>|undefined;
    let onAbort:(()=>void)|undefined;
    try{
      if(externalSignal.aborted||!address||roomId(address.platformRoomId)!==address.platformRoomId)return undefined;
      const id=address.platformRoomId,platform=address.platform;
      let url:string;
      if(platform==='douyu'&&address.canonicalUrl===`https://www.douyu.com/${id}`)url=`https://www.douyu.com/betard/${id}`;
      else if(platform==='huya'&&address.canonicalUrl===`https://www.huya.com/${id}`)url=`https://www.huya.com/${id}`;
      else if(platform==='bilibili'&&address.canonicalUrl===`https://live.bilibili.com/${id}`)url=`https://api.live.bilibili.com/xlive/web-room/v1/index/getInfoByRoom?room_id=${id}`;
      else return undefined;
      const controller=new AbortController();
      // Resolve even when a failing transport does not settle its aborted fetch/read.
      const aborted=new Promise<undefined>(resolve=>{
        onAbort=()=>{controller.abort();resolve(undefined);};
        externalSignal.addEventListener('abort',onAbort,{once:true});
        timeout=setTimeout(onAbort,TIMEOUT_MS);
      });
      const lookup=async():Promise<string|undefined>=>{
        const response=await fetchImpl(url,{credentials:'omit',redirect:'error',signal:controller.signal});
        const contentType=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        // Some existing rooms (e.g. 5556) return an informational HTML page
        // from betard while their canonical public room page has native SSR.
        if(platform==='douyu'&&response.ok&&contentType==='text/html'&&!controller.signal.aborted&&!response.redirected&&(!response.url||response.url===url)){
          void response.body?.cancel().catch(()=>{});
          const page=await fetchImpl(address.canonicalUrl,{credentials:'omit',redirect:'error',signal:controller.signal});
          if(controller.signal.aborted||!page.ok||page.redirected||(page.url&&page.url!==address.canonicalUrl)||page.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='text/html'){void page.body?.cancel().catch(()=>{});return undefined;}
          const html=await boundedText(page,controller.signal);return html===undefined||controller.signal.aborted?undefined:douyuPageNickname(html);
        }
        const allowed=platform==='huya'?contentType==='text/html':contentType==='application/json';
        if(controller.signal.aborted||!response.ok||!allowed||response.redirected||(response.url&&response.url!==url)){
          void response.body?.cancel().catch(()=>{});return undefined;
        }
        const raw=await boundedText(response,controller.signal);if(raw===undefined||controller.signal.aborted)return undefined;
        if(platform==='huya'){
          const profile=huyaProfile(raw);
          return roomId(profile?.profileRoom)===id?nickname(profile?.nick):undefined;
        }
        const result=object(strictJson(raw));
        if(platform==='douyu'){
          const room=object(result?.room);
          return roomId(room?.room_id)===id?nickname(room?.nickname):undefined;
        }
        if(result?.code!==0)return undefined;
        const data=object(result.data),room=object(data?.room_info);
        return roomId(room?.room_id)===id?nickname(object(object(data?.anchor_info)?.base_info)?.uname):undefined;
      };
      return await Promise.race([lookup(),aborted]);
    }catch{return undefined;}
    finally{
      if(timeout!==undefined)clearTimeout(timeout);
      if(onAbort)externalSignal.removeEventListener('abort',onAbort);
    }
  };
}

export const resolveHistoryNickname:HistoryNicknameResolver=createHistoryNicknameResolver();
