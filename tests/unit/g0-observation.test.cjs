const test = require('node:test');
const assert = require('node:assert/strict');
const safe = require('../../spikes/runtime/safe-observation.cjs');
test('remote values cannot become arbitrary diagnostic text or objects',()=>{
  const secret='SENSITIVE_SENTINEL';
  const result=safe.media({video:[{width:secret,height:{cookie:secret},paused:secret,frames:Infinity,dropped:-2,currentTime:NaN,readyState:8,extra:secret}],canvasCount:secret,fixture:{boot:secret},token:secret});
  assert.equal(JSON.stringify(result).includes(secret),false);
  assert.deepEqual(result.video[0],{width:null,height:null,paused:null,readyState:null,currentTime:null,frames:null,dropped:null});
  assert.equal('fixture' in result,false);
});
test('valid media evidence retains numbers and booleans, with bounded arrays',()=>{
  const result=safe.media({video:Array.from({length:20},()=>({width:1920,height:1080,paused:false,readyState:4,currentTime:50,frames:3000,dropped:3})),canvasCount:2});
  assert.equal(result.video.length,4);
  assert.equal(result.video[0].width,1920);
  assert.equal(result.video[0].paused,false);
  assert.equal(result.video[0].frames,3000);
  assert.equal(result.canvasCount,2);
});
test('timeouts remain distinct from observations with no media',()=>{
  assert.equal(safe.media(null).status,'timeout');
  assert.equal(safe.media({video:[]}).status,'collected');
});
test('structure labels come only from caller allowlist and rectangle values are finite',()=>{
  const result=safe.structure(['#known'],[{selector:'SENSITIVE_SENTINEL',x:-2.5,y:Infinity,width:'SENSITIVE_SENTINEL',height:100,count:1}]);
  assert.equal(JSON.stringify(result).includes('SENSITIVE_SENTINEL'),false);
  assert.deepEqual(result,[{selector:'#known',found:true,x:-2,y:null,width:null,height:100,count:1}]);
});
test('fixture diagnostics also reject nonnumeric fields',()=>{
  assert.deepEqual(safe.fixture({clicks:'secret',frames:{text:'secret'},boot:NaN}),{clicks:null,frames:null,boot:null});
});
test('frame probe rejects page text and arbitrary attributes, keeps only generated index paths',()=>{
  const inspect=require('../../spikes/runtime/inspection.cjs');
  const result=inspect.sanitize({body:[{path:'body > div:nth-child(5)',x:0,y:0,width:100,height:100,mediaTime:'SENSITIVE_SENTINEL',text:'SENSITIVE_SENTINEL'},{path:'body#SENSITIVE_SENTINEL'}],targets:[[{path:'body',paused:false,mediaWidth:1920}]],known:[{path:'SENSITIVE_SENTINEL'}],parentAccessible:'SENSITIVE_SENTINEL',blancPath:'SENSITIVE_SENTINEL'});
  assert.equal(JSON.stringify(result).includes('SENSITIVE_SENTINEL'),false);
  assert.equal(result.body[0].path,'body > div:nth-child(5)');
  assert.equal(result.body[1].path,null);
  assert.equal(result.targets[0][0].mediaWidth,1920);
  assert.equal(result.parentAccessible,false);
});
