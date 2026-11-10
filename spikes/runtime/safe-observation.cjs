'use strict';
// Diagnostics are an allowlist of bounded numeric/boolean fields. Never persist page objects.
function number(value, max, min = 0) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}
function media(raw) {
  return {
    status: raw === null ? 'timeout' : 'collected',
    video: Array.isArray(raw?.video) ? raw.video.slice(0,4).map(v=>({
      width:number(v?.width,32768), height:number(v?.height,32768),
      paused:typeof v?.paused === 'boolean' ? v.paused : null,
      readyState:number(v?.readyState,4), currentTime:number(v?.currentTime,1e12),
      frames:number(v?.frames,1e12), dropped:number(v?.dropped,1e12)
    })) : [],
    canvasCount:number(raw?.canvasCount,10000)
  };
}
function fixture(raw) { return { clicks:number(raw?.clicks,1e9),frames:number(raw?.frames,1e12),boot:number(raw?.boot,1e12) }; }
function structure(selectors, raw) {
  return selectors.map((selector,i)=>{
    const value=raw?.[i], rect={};
    for(const key of ['x','y','width','height','count']) {
      const n=number(value?.[key],1e7, key==='x'||key==='y' ? -1e7 : 0);
      rect[key]=n===null?null:Math.round(n);
    }
    return {selector,found:typeof value === 'object' && value !== null,...rect};
  });
}
module.exports = { number, media, fixture, structure };
