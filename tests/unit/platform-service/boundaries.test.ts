import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { safeInspection, inspectionScript } from '../../../src/main/bootstrap/inspection.ts';
import { operationResult, operationFilter, dynamicOperationScript } from '../../../src/platforms/shared/observation.ts';

test('operation boundaries retain supported states and finite reason vocabulary without arbitrary text',()=>{
  for(const status of ['applied','restored','unsupported','notReady','failed']){
    assert.deepEqual(operationResult({status,reason:'structure',token:'secret'}),{status,reason:'structure'});
  }
  for(const raw of [null,undefined,[],false,3,'account-token-chat',{status:'not-a-contract-status',reason:'https://sensitive.example/?token=private'}]) {
    assert.deepEqual(operationResult(raw),{status:'failed',reason:'unknown'});
  }
  const context=createContext({value:{status:'unsupported',reason:'insufficient-space',account:'private-account',token:'private-token',chat:'private-chat'}});
  const filtered=runInContext(`(${operationFilter})(value)`,context);
  assert.deepEqual(structuredClone(filtered),{status:'unsupported',reason:'insufficient-space'});
  assert.equal(runInContext(dynamicOperationScript,createContext({})),null);
  runInContext("globalThis[Symbol.for('live-union.presentation.result')]=value",context);
  assert.deepEqual(structuredClone(runInContext(dynamicOperationScript,context)),{status:'unsupported',reason:'insufficient-space'});
});

test('safeInspection copies only approved selectors/tags and finite rectangles/counts at every nesting level',()=>{
  const node={tag:'VIDEO',box:{x:-25.5,y:0,width:1920,height:1080,token:'private-token'},children:0,account:'private-account',chat:'private-chat'};
  const raw={
    viewport:{width:Infinity,height:1080,account:'private-account'},account:'private-account',token:'private-token',chat:'private-chat',
    selectors:[
      {selector:'video',count:1,nodes:[node],chat:'private-chat'},
      {selector:'[data-account="private-account"]',count:1,nodes:[node]},
      {selector:'#chatRoom',count:NaN,nodes:[{tag:'ACCOUNT-TOKEN',box:{x:NaN,y:-Infinity,width:100001,height:'private-chat'},children:'private-account'}]},
    ],
    videos:[{account:'private-account',ancestors:[{...node,siblings:[{...node,tag:'SCRIPT',children:Infinity}]}]}],
  };
  assert.deepEqual(safeInspection(raw),{
    viewport:{width:null,height:1080},
    selectors:[
      {selector:'video',count:1,nodes:[{tag:'VIDEO',box:{x:-25.5,y:0,width:1920,height:1080},children:0}]},
      {selector:'#chatRoom',count:null,nodes:[{tag:'OTHER',box:{x:null,y:null,width:null,height:null},children:null}]},
    ],
    videos:[{ancestors:[{tag:'VIDEO',box:{x:-25.5,y:0,width:1920,height:1080},children:0,siblings:[{tag:'OTHER',box:{x:-25.5,y:0,width:1920,height:1080},children:null}]}]}],
  });
  assert.doesNotMatch(JSON.stringify(safeInspection(raw)),/private|account|token|chat"/);
});

test('inspection bounds selectors/nodes/videos/ancestors/siblings independently and handles nonrecords',()=>{
  const node={tag:'DIV',box:{x:0,y:0,width:100,height:100},children:100000};
  const ancestor={...node,siblings:Array(30).fill(node)};
  const raw={viewport:{width:100000,height:-100000},selectors:Array(30).fill({selector:'video',count:100001,nodes:Array(10).fill(node)}),videos:Array(10).fill({ancestors:Array(20).fill(ancestor)})};
  const result=safeInspection(raw);
  assert.equal(result.selectors.length,15);assert.ok(result.selectors.every(value=>value.nodes.length===4&&value.count===null));
  assert.equal(result.videos.length,4);assert.ok(result.videos.every(value=>value.ancestors.length===8));
  assert.ok(result.videos.every(value=>value.ancestors.every(ancestor=>ancestor.siblings.length===24)));
  for(const invalid of [undefined,null,5,'private-account',[],()=>({token:'private-token'})])assert.deepEqual(safeInspection(invalid),{viewport:{width:null,height:null},selectors:[],videos:[]});
});

test('the generated inspection probe never returns node text, attribute values or unknown tag names',()=>{
  const node:any={tagName:'SECRET-TAG',textContent:'private-chat',innerHTML:'private-token',attributes:{account:'private-account'},children:[],parentElement:null,matches(selector:string){return this.tagName==='VIDEO'&&selector==='video';},getBoundingClientRect:()=>({x:1,y:2,width:300,height:200})};
  const video={...node,tagName:'VIDEO'};video.parentElement=node;
  const context=createContext({innerWidth:1200,innerHeight:800,document:{querySelectorAll(selector:string){return selector==='video'?[video]:[];}}});
  // Electron returns a structured clone across the renderer/main boundary.
  const raw=structuredClone(runInContext(inspectionScript,context));
  const result=safeInspection(raw);
  assert.equal(result.selectors.find(value=>value.selector==='video')?.nodes[0].tag,'VIDEO');
  assert.deepEqual(result.videos[0].ancestors.map(value=>value.tag),['VIDEO','OTHER']);
  assert.deepEqual(result.videos[0].ancestors.map(value=>value.matches),[['video'],[]]);
  assert.doesNotMatch(JSON.stringify(raw),/private|SECRET-TAG|textContent|innerHTML|attributes|account|token/);
  assert.doesNotMatch(JSON.stringify(result),/private|SECRET-TAG|textContent|innerHTML|attributes|account|token/);
});

test('Bilibili failure geometry is bounded before crossing and after crossing the renderer boundary',()=>{
  const box={x:1,y:2,width:300,height:40,clientWidth:300,scrollWidth:301,value:'private-chat',token:'private-token'};
  const geometry={stage:'layout',part:'input-child',inputChildIndex:1,overflowDepth:-1,viewport:{width:702,height:272,chatWidth:380},chat:box,panel:box,list:box,sendRoot:box,input:box,textarea:box,inputChildren:Array(10).fill(box),inputAncestors:Array(20).fill(box),account:'private-account'};
  const context=createContext({innerWidth:702,innerHeight:272,geometry,document:{querySelectorAll(){return[];}}});
  runInContext("globalThis[Symbol.for('live-union.bilibili.chat-geometry')]=geometry",context);
  const raw=structuredClone(runInContext(inspectionScript,context));
  const result=safeInspection(raw).bilibiliGeometry!;
  assert.equal(result.stage,'layout');assert.equal(result.part,'input-child');
  assert.equal(result.inputChildren.length,3);assert.equal(result.inputAncestors.length,8);
  assert.equal(result.textarea.scrollWidth,301);
  assert.doesNotMatch(JSON.stringify(raw),/private|value|account|token/);
  assert.doesNotMatch(JSON.stringify(result),/private|value|account|token/);
  const hostile=safeInspection({bilibiliGeometry:{...geometry,stage:'private-chat',part:'private-account',inputChildIndex:Infinity,textarea:{...box,width:100001}}}).bilibiliGeometry!;
  assert.equal(hostile.stage,'unknown');assert.equal(hostile.part,'unknown');assert.equal(hostile.inputChildIndex,null);assert.equal(hostile.textarea.width,null);
});

test('Huya overlay visibility diagnostics accept only booleans and read each flag once',()=>{
  let reads=0;
  const controlsStyle={overlay:true,nativeVisible:true,computedOpacity:0,idleClickThrough:true,token:'private-token'};
  Object.defineProperty(controlsStyle,'shown',{get(){reads++;return reads===1?false:'private-chat';}});
  const context=createContext({innerWidth:702,innerHeight:272,geometry:{controlsStyle},document:{querySelectorAll(){return[];}}});
  runInContext("globalThis[Symbol.for('live-union.huya.geometry')]=geometry",context);
  const raw=structuredClone(runInContext(inspectionScript,context));
  const result=safeInspection(raw).huyaGeometry!.controlsStyle;
  assert.equal(reads,1);
  assert.equal(result.overlay,true);assert.equal(result.shown,false);assert.equal(result.nativeVisible,true);
  assert.equal(result.computedOpacity,0);assert.equal(result.idleClickThrough,true);
  const hostile=safeInspection({huyaGeometry:{controlsStyle:{overlay:'private-token',shown:{text:'private-chat'},nativeVisible:Infinity,computedOpacity:1.01,idleClickThrough:'private-token'}}}).huyaGeometry!.controlsStyle;
  for(const key of ['overlay','shown','nativeVisible','computedOpacity','idleClickThrough'])assert.equal(key in hostile,false);
  for(const value of [-0.01,Infinity,NaN,'private-token'])assert.equal('computedOpacity' in safeInspection({huyaGeometry:{controlsStyle:{computedOpacity:value}}}).huyaGeometry!.controlsStyle,false);
  assert.doesNotMatch(JSON.stringify(raw)+JSON.stringify(result)+JSON.stringify(hostile),/private|token/);
});
