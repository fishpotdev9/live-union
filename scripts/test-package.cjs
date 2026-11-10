'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const candidate=process.argv.includes('--candidate');
const hidden=process.argv.includes('--hidden'),quick=process.argv.includes('--quick');
const publicNickname=process.argv.includes('--public-nickname');
if(process.argv.slice(2).some(arg=>!['--candidate','--hidden','--quick','--public-nickname'].includes(arg)))throw Error('Unsupported package test flag');
const root=path.resolve(__dirname,'..'),source=path.join(root,candidate?'.local/candidate-release':'release','Live Union-win32-x64');
async function regularTree(directory){
  for(const entry of await fs.readdir(directory,{withFileTypes:true})){
    if(entry.isSymbolicLink())throw Error('Refusing package link');
    if(entry.isDirectory())await regularTree(path.join(directory,entry.name));else if(!entry.isFile())throw Error('Refusing package entry');
  }
}
async function run(executable,cwd,token,mode){
  return new Promise((resolve,reject)=>{
    const args=['--self-test',`--self-test-token=${token}`,...(hidden?['--self-test-hidden']:[]),...(mode==='restart'?['--self-test-restart']:mode==='upgrade'?['--self-test-history-upgrade']:mode==='public-name'?['--self-test-public-nickname']:quick?[]:['--self-test-cycles'])];
    const child=spawn(executable,args,{cwd,windowsHide:hidden,stdio:['ignore','pipe','ignore']});
    let pending='',result;const timer=setTimeout(()=>{child.kill();reject(Error('Packaged fixture timed out'));},240000);
    child.stdout.on('data',data=>{
      pending+=data.toString('utf8');const lines=pending.split(/\r?\n/);pending=lines.pop().slice(-65536);
      for(const line of lines)if(line.startsWith('LIVE_UNION_SELF_TEST ')){try{result=JSON.parse(line.slice('LIVE_UNION_SELF_TEST '.length));}catch{}}
    });
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);if(code===0&&result?.passed)resolve(result);else{const error=Error(`Packaged fixture failed after ${result?.checks?.length??0} checks`);error.fixtureResult=result;reject(error);}});
  });
}
(async()=>{
  await regularTree(source);
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'live-union-package-smoke-')),token=crypto.randomUUID();
  const upgradeToken=crypto.randomUUID(),copied=path.join(temporary,'app'),profile=path.join(os.tmpdir(),`live-union-self-test-${token}`),upgradeProfile=path.join(os.tmpdir(),`live-union-self-test-${upgradeToken}`);
  const publicToken=crypto.randomUUID(),publicProfile=path.join(os.tmpdir(),`live-union-self-test-${publicToken}`);
  try{
    await fs.cp(source,copied,{recursive:true,errorOnExist:true,force:false});
    const executable=path.join(copied,'Live Union.exe');
    const first=await run(executable,temporary,token,'first'),restart=await run(executable,temporary,token,'restart');
    // Old application data contains registered workspaces but no history store.
    // Copy only generated Config files, never real or fixture browser sessions.
    await regularTree(path.join(profile,'Config'));
    await fs.cp(path.join(profile,'Config'),path.join(upgradeProfile,'Config'),{recursive:true,errorOnExist:true,force:false,filter:entry=>path.basename(entry)!=='History'});
    const historyUpgrade=await run(executable,temporary,upgradeToken,'upgrade');
    const publicNicknameResult=publicNickname?await run(executable,temporary,publicToken,'public-name'):undefined;
    const screenshotDirectory=path.join(root,'.local','history-validation');await fs.mkdir(screenshotDirectory,{recursive:true});
    const screenshots=[];
    for(const width of [980,1920]){const name=`history-${width}.png`;await fs.copyFile(path.join(profile,name),path.join(screenshotDirectory,name));screenshots.push(path.relative(root,path.join(screenshotDirectory,name)));}
    if(publicNickname)for(const width of [220,700]){const name=`nickname-header-${width}.png`;await fs.copyFile(path.join(publicProfile,name),path.join(screenshotDirectory,name));screenshots.push(path.relative(root,path.join(screenshotDirectory,name)));}
    const report={at:new Date().toISOString(),kind:'standalone-packaged-local-fixture',candidate,hidden,quick,screenshots,copiedOutsideSourceTree:true,cwdOutsideSourceTree:true,
      asarSha256:crypto.createHash('sha256').update(await fs.readFile(path.join(source,'resources','app.asar'))).digest('hex'),
      first,restart,historyUpgrade,publicNickname:publicNicknameResult,realPlatforms:false,performance:false,upgrade:'local-generated-config-only'};
    await fs.mkdir(path.join(root,'.local'),{recursive:true});await fs.writeFile(path.join(root,'.local',candidate?'package-smoke-candidate.json':'package-smoke.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({kind:report.kind,hidden,quick,firstPassed:first.passed,restartPassed:restart.passed,historyUpgradePassed:historyUpgrade.passed,publicNicknamePassed:publicNicknameResult?.passed,checks:[first.checks.length,restart.checks.length,historyUpgrade.checks.length,...(publicNicknameResult?[publicNicknameResult.checks.length]:[])],screenshots,realPlatforms:false,performance:false}));
  }finally{
    for(const target of [temporary,profile,upgradeProfile,publicProfile]){
      const absolute=path.resolve(target);
      if(path.dirname(absolute)!==path.resolve(os.tmpdir())||!/^live-union-(package-smoke-|self-test-)[0-9a-z-]+$/i.test(path.basename(absolute)))throw Error('Unexpected smoke cleanup target');
      try{await regularTree(absolute);await fs.rm(absolute,{recursive:true,force:true,maxRetries:5,retryDelay:100});}catch(error){if(error.code!=='ENOENT')throw error;}
    }
  }
})().catch(async error=>{
  if(error.fixtureResult){await fs.mkdir(path.join(root,'.local'),{recursive:true});await fs.writeFile(path.join(root,'.local','package-smoke-failed.json'),JSON.stringify({at:new Date().toISOString(),kind:'standalone-packaged-local-fixture-failed',result:error.fixtureResult,realPlatforms:false},null,2)+'\n');}
  console.error('Standalone packaged fixture failed; no real platform profile was used.');process.exitCode=1;
});
