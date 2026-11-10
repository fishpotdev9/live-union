/** Public platform metadata only. Never return page/account fields or response text. */
export function douyuLiveState(raw:unknown):'live'|'offline'|'unknown'{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return'unknown';
  const room=(raw as Record<string,unknown>).room;
  if(!room||typeof room!=='object'||Array.isArray(room))return'unknown';
  const status=(room as Record<string,unknown>).show_status;
  return status===1||status==='1'?'live':status===2||status==='2'?'offline':'unknown';
}
