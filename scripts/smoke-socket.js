/* Headless check of the S2 relay: room isolation, server-side delay, pending cancel, state_sync. */
const { io } = require('socket.io-client');
const URL = process.env.URL || 'http://localhost:3000';

// the server may be password protected; pick the password up the same way it does
function password() {
  if (process.env.SUB_PASSWORD) return process.env.SUB_PASSWORD;
  try { return (require('../config.local.json').auth || {}).password || ''; } catch (e) { return ''; }
}
const PW = password();

const log = [];
const ok = (c, m) => { log.push(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) process.exitCode = 1; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function mk(lang, role, name) {
  const s = io(URL, { transports: ['websocket'] });
  const got = { typing: [], subs: [], pending: [], peers: [], sync: null, delay: [] };
  s.on('typing_update', (d) => got.typing.push(d));
  s.on('subtitle_new', (d) => got.subs.push(d));
  s.on('pending_add', (d) => got.pending.push(d));
  const drop = (d) => got.pending = got.pending.filter((p) => p.pendingId !== d.pendingId);
  s.on('pending_cancel', drop);
  s.on('pending_done', drop);
  s.on('peers', (d) => got.peers = d);
  s.on('state_sync', (d) => got.sync = d);
  s.on('delay_changed', (d) => got.delay.push(d));
  s.on('connect', () => s.emit('join', { lang, role, name, pw: PW }));
  s.on('auth_failed', () => { console.error('FAIL  인증 거부됨 — 비밀번호를 확인하세요'); process.exit(1); });
  return { s, got, name };
}

(async () => {
  // an unrelated client (a browser tab left open) may share the room; measure deltas, not totals
  const probe = mk('ko', 'broadcast', 'PROBE');
  await wait(400);
  const BASE = probe.got.peers.length;   // includes PROBE itself
  probe.s.close();
  await wait(200);

  const A = mk('ko', 'typist', 'A');
  const B = mk('ko', 'typist', 'B');
  const BC = mk('ko', 'broadcast', 'BC');
  const EN = mk('en', 'typist', 'EN-A');
  await wait(400);

  ok(A.got.peers.length === BASE + 2, `peers: ko방 신규 3명 인식 (기준 ${BASE - 1} + 3 = ${BASE + 2}, 실제 ${A.got.peers.length})`);
  ok(EN.got.peers.length === 1, `peers: en방 격리 1명 (실제 ${EN.got.peers.length})`);
  ok(A.got.peers.every((p) => p.host), 'peers: host(컴퓨터명) 필드 채워짐');

  A.s.emit('typing_update', { text: '입력중...' });
  await wait(200);
  ok(B.got.typing.some((t) => t.text === '입력중...'), 'typing_update: 상대 타이피스트 수신');
  ok(BC.got.typing.length === 0, 'typing_update: 송출 화면 미수신');
  ok(EN.got.typing.length === 0, 'typing_update: 타 언어방 미수신');

  B.s.emit('delay_set', { delayMs: 800 });
  await wait(200);
  ok(A.got.delay.some((d) => d.delayMs === 800 && d.by === 'B'), 'delay_set: 방 전체 공통 반영 + 변경자 표시');

  A.s.emit('subtitle_send', { localId: 'x1', text: '지연 테스트' });
  await wait(200);
  ok(A.got.pending.length === 1, 'pending_add: 대기 항목 통지');
  ok(BC.got.subs.length === 0, 'delay: 800ms 전 송출 미발화');
  await wait(900);
  ok(BC.got.subs.length === 1 && BC.got.subs[0].text === '지연 테스트', 'subtitle_new: 딜레이 후 송출 발화');
  ok(A.got.pending.length === 0, 'pending_done: 대기 배지 해제');

  A.s.emit('subtitle_send', { localId: 'x2', text: '취소될 자막' });
  await wait(150);
  const pid = A.got.pending[0] && A.got.pending[0].pendingId;
  A.s.emit('subtitle_cancel', { pendingId: pid });
  await wait(1000);
  ok(!BC.got.subs.some((s) => s.text === '취소될 자막'), 'subtitle_cancel: 대기 중 취소 시 미발화');

  B.s.emit('delay_set', { delayMs: 0 });
  await wait(150);
  for (let i = 1; i <= 6; i++) A.s.emit('subtitle_send', { localId: 'n' + i, text: '줄' + i });
  await wait(400);
  ok(BC.got.subs.length === 7, `연타 6개 전량 수신 (총 ${BC.got.subs.length}, 기대 7)`);

  const LATE = mk('ko', 'broadcast', 'LATE');
  await wait(400);
  ok(LATE.got.sync && LATE.got.sync.lines.length === 4, `state_sync: 링버퍼 4줄 복구 (실제 ${LATE.got.sync && LATE.got.sync.lines.length})`);
  ok(LATE.got.sync.lines[3].text === '줄6', 'state_sync: 최신 자막이 마지막');
  ok(LATE.got.sync.delayMs === 0, 'state_sync: 방 딜레이값 동기화');

  BC.s.emit('clear_all');
  await wait(200);
  const LATE2 = mk('ko', 'broadcast', 'L2');
  await wait(400);
  ok(LATE2.got.sync.lines.length === 0, 'clear_all: 버퍼 비움');

  B.s.close();
  await wait(300);
  ok(A.got.peers.length === BASE + 3, `disconnect: 이탈 반영 (기대 ${BASE + 3}, 실제 ${A.got.peers.length})`);

  console.log(log.join('\n'));
  console.log(`\n${log.filter((l) => l.startsWith('PASS')).length}/${log.length} passed`);
  [A, BC, EN, LATE, LATE2].forEach((c) => c.s.close());
  process.exit(process.exitCode || 0);
})();
