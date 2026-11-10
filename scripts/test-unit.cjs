'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function discover(dir) {
  return fs.readdirSync(dir, { withFileTypes:true }).flatMap(entry => {
    const file=path.join(dir,entry.name);
    return entry.isDirectory() ? discover(file) : entry.isFile() && /\.test\.(?:cjs|ts)$/.test(entry.name) ? [file] : [];
  });
}
const files=discover(path.join(root,'tests/unit')).sort();
if(!files.length) throw new Error('No unit tests discovered');
const result=spawnSync(process.execPath,['--test',...files],{cwd:root,stdio:'inherit',windowsHide:true});
if(result.error) throw result.error;
process.exitCode=result.status ?? 1;
