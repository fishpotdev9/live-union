import type { AppCommand } from '../../shared/app-contracts.ts';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roomOnly=new Set(['removeRoom','reloadRoom','selectRoom','raiseRoom','soloAudio','showRoomMenu','setAudio','setChat','setChatWidth','setPrimary','setZoom','setNative','geometryBegin','geometryDelta','geometryEnd']);
function fail():never{throw new Error('无效的工作台命令');}
export function validateCommand(raw:unknown,scope:{role:'toolbar'|'room';roomId?:string}):AppCommand {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return fail();
  const value=raw as Record<string,unknown>,type=value.type;
  if(typeof type!=='string')return fail();
  const allowedKeys=['type'];
  const take=(key:string,check:(v:unknown)=>boolean)=>{allowedKeys.push(key);if(!check(value[key]))return fail();return value[key];};
  const isId=(v:unknown)=>typeof v==='string'&&uuid.test(v);
  const isBool=(v:unknown)=>typeof v==='boolean';
  const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=100000;
  if(scope.role==='room'&&type!=='getState'&&(!roomOnly.has(type)||value.roomId!==scope.roomId))return fail();
  const result:Record<string,unknown>={type};
  if(roomOnly.has(type))result.roomId=take('roomId',isId);
  switch(type){
    case 'getState':case 'muteAll':case 'arrange':case 'undoGeometry':case 'toggleFullscreen':case 'clearHistory':
    case 'removeRoom':case 'reloadRoom':case 'selectRoom':case 'raiseRoom':case 'soloAudio':case 'showRoomMenu':case 'setPrimary':break;
    case 'addRoom':result.url=take('url',v=>typeof v==='string'&&v.length>0&&v.length<=2048);break;
    case 'addHistoryRoom':case 'removeHistoryRoom':result.historyId=take('historyId',isId);break;
    case 'setHistoryOpen':result.open=take('open',isBool);break;
    case 'refreshHistoryMetadata':result.historyIds=take('historyIds',v=>Array.isArray(v)&&v.length<=40&&v.every(isId)&&new Set(v).size===v.length);break;
    case 'setAudio':result.allowed=take('allowed',isBool);break;
    case 'setChat':case 'setAllChat':result.visible=take('visible',isBool);break;
    case 'setChatWidth':result.widthDip=take('widthDip',v=>typeof v==='number'&&Number.isFinite(v)&&v>=140&&v<=500);break;
    case 'setTemplate':result.template=take('template',v=>v==='equal'||v==='focus');break;
    case 'setFree':if(value.fromCurrent!==undefined)result.fromCurrent=take('fromCurrent',isBool);break;
    case 'setZoom':case 'setNative':result.enabled=take('enabled',isBool);break;
    case 'geometryBegin':result.gestureId=take('gestureId',isId);result.kind=take('kind',v=>v==='move'||v==='resize');break;
    case 'geometryDelta':result.gestureId=take('gestureId',isId);result.dx=take('dx',finite);result.dy=take('dy',finite);break;
    case 'geometryEnd':result.gestureId=take('gestureId',isId);break;
    case 'renameWorkspace':case 'saveWorkspaceAs':result.name=take('name',v=>typeof v==='string'&&v.trim().length>0&&v.length<=80&&!/[\x00-\x1f\x7f]/.test(v));break;
    case 'openWorkspace':result.workspaceId=take('workspaceId',isId);break;
    default:return fail();
  }
  if(Object.keys(value).some(key=>!allowedKeys.includes(key)))return fail();
  return result as unknown as AppCommand;
}
