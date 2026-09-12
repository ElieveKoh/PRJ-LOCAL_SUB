// Exercise blockReason() outside the browser by lifting it out of app.js
const fs=require('fs');
const src=fs.readFileSync('public/typist/app.js','utf8');
const start=src.indexOf('  const IS_MAC =');
const end=src.indexOf('  function comboOf(e)');
const body=src.slice(start,end).replace(/const IS_MAC = .*/, 'const IS_MAC = false;');
const extra=src.slice(src.indexOf('  const isFn ='), src.indexOf('  function comboLabel'));
const fn=new Function(body+extra+'return {blockReason, comboValid};')();
const {blockReason, comboValid}=fn;

const cases=[
  // [combo, expected null(=ok) or reason]
  ['Ctrl+KeyW','hkBlockOs'], ['Meta+KeyW','hkBlockOs'], ['Ctrl+KeyT','hkBlockOs'],
  ['Ctrl+Shift+KeyN','hkBlockOs'], ['Alt+F4','hkBlockOs'], ['F11','hkBlockOs'], ['F12','hkBlockOs'],
  ['Ctrl+Shift+KeyI','hkBlockOs'], ['Meta+Space','hkBlockOs'], ['Meta+KeyH','hkBlockOs'],
  ['Ctrl+Space','hkBlockIme'], ['Shift+Space','hkBlockIme'], ['Alt+Backquote','hkBlockIme'],
  ['HangulMode','hkBlockIme'],
  ['Ctrl+KeyC','hkBlockEdit'], ['Meta+KeyV','hkBlockEdit'], ['Ctrl+KeyA','hkBlockEdit'],
  ['Ctrl+KeyR','hkBlockBrowser'], ['Meta+KeyP','hkBlockBrowser'], ['Ctrl+KeyF','hkBlockBrowser'],
  ['Ctrl+Digit1','hkBlockBrowser'], ['Meta+Digit3','hkBlockBrowser'], ['Alt+ArrowLeft','hkBlockBrowser'],
  ['Enter','hkReserved'], ['Escape','hkReserved'], ['Ctrl+Backspace','hkReserved'], ['Ctrl+KeyZ','hkReserved'],
  ['Ctrl+Enter',null],  // freed up now that immediate-send is gone
  ['Meta+Enter',null],
  // these must stay usable
  ['Alt+KeyQ',null], ['Alt+KeyA',null], ['Ctrl+Shift+Digit1',null], ['Ctrl+Shift+KeyQ','hkBlockOs'],  // Cmd+Shift+Q logs out on macOS
  ['F1',null], ['F5',null], ['F10',null], ['Alt+Digit5',null], ['Ctrl+Shift+Period',null],
];
let bad=0;
for (const [c,exp] of cases){
  const got=blockReason(c);
  if(got!==exp){bad++;console.log(`MISMATCH ${c}: got ${got} expected ${exp}`);}
}
const vcases=[['KeyA',false],['Shift+KeyA',false],['F1',true],['F11',false],['Alt+KeyA',true],['Ctrl+Shift+KeyA',true]];
for (const [c,exp] of vcases){
  const got=comboValid(c);
  if(got!==exp){bad++;console.log(`VALID MISMATCH ${c}: got ${got} expected ${exp}`);}
}
console.log(bad===0?`ALL PASS (${cases.length+vcases.length} cases)`:`${bad} FAILED`);
process.exit(bad?1:0);
