/* UI language for the typist console. Independent of the subtitle channel language. */
(function (global) {
  const KEY = 'sub.ui.lang';
  const DICT = {
    ko: {
      brand: 'PRJ-LOCAL_SUB', onAir: 'ON AIR', offAir: 'OFF AIR', noLink: '연결 없음',
      subLang: '자막 언어', delay: '딜레이', sync: '동기화', buffer: '버퍼',
      bufOk: '정상', bufWait: '대기', bufFail: '실패', bufOff: '연결 끊김',
      connected: '연결된 사람', me: '나', roleTypist: '속기', roleBroadcast: '송출',
      noVideo: '영상 입력 없음', noVideoSub: 'RTMP/SRT 연동 예정 · <code>?video=&lt;url&gt;</code> 로 임시 삽입',
      noSignal: 'NO SIGNAL', preview: '송출 미리보기',
      monitor: '실시간 모니터링', monitorIdle: '상대 속기사 입력 대기 중', typing: '입력 중',
      tabHistory: '최근 전송', tabHotkeys: '핫키',
      stWait: '송출 대기', stLive: '송출 중', stDone: '완료', stFail: '전송 실패', stRevoked: '회수됨',
      actCancel: '취소', actRetry: '재전송', actRevoke: '회수',
      histEmpty: '아직 전송한 자막이 없습니다.', count: '건',
      send: '전송', delayLabel: '전송 딜레이', shared: '방 공통',
      btnRevoke: '직전 회수', btnClear: '화면 비우기',
      placeholder: '자막 입력 후 Enter 전송   ·   Shift+Enter 줄바꿈',
      hkTitle: '핫키 설정',
      hkHint: '키 칸을 클릭하고 원하는 조합을 누르세요. 브라우저·운영체제가 먼저 가져가는 조합과 편집·입력기 단축키는 자동으로 거부됩니다.',
      hkColKey: '단축키', hkColLabel: '표시 이름', hkColText: '입력할 문장',
      hkLabel: '표시 이름', hkText: '입력할 문장',
      hkSave: '저장하고 닫기', hkCancel: '취소', hkAdd: '+ 핫키 추가', hkDel: '삭제',
      hkSaved: '핫키를 저장했습니다', hkEmpty: '등록된 핫키가 없습니다',
      hkSetup: '핫키 등록', hkSettings: '핫키 설정',
      hkPress: '조합을 누르세요…', hkUnset: '미지정',
      hkBadKey: '수식키 조합 또는 F1–F10만 지정할 수 있습니다',
      hkReserved: '이 프로그램이 이미 쓰는 키입니다',
      hkDup: '다른 핫키와 겹칩니다',
      hkBlockOs: '브라우저·운영체제가 먼저 가로채는 조합이라 쓸 수 없습니다',
      hkBlockBrowser: '브라우저 기본 단축키입니다',
      hkBlockEdit: '텍스트 편집 단축키라 입력에 방해됩니다',
      hkBlockIme: '한/영 전환 등 입력기 단축키입니다',
      hkSafe: '안전한 조합: Alt+글자 · Ctrl+Shift+글자 · Ctrl+Shift+숫자 · F1–F10',
      hkConflict: '사용 불가',
      warnNoBroadcast: '⚠ 송출 화면이 접속되어 있지 않습니다.',
      warnDupName: '⚠ 같은 이름의 속기사가 둘 이상입니다. 이름을 클릭해 구분되게 바꾸세요.',
      warnManyBc: (n) => `⚠ 송출 화면이 ${n}개 연결되어 있습니다. 쓰지 않는 창을 닫으세요 — 미리보기가 섞입니다.`,
      warnOffline: '⚠ 서버 연결 끊김 — 전송 불가. 서버(npm start)를 확인하세요.',
      tOffline: '서버 연결이 끊겼습니다', tFail: '전송 실패 — 핫키 옆 재전송을 누르세요',
tCleared: '송출 자막을 모두 숨겼습니다',
      tCancelled: '대기 중 자막을 취소했습니다', tRevoked: '방금 보낸 자막을 회수했습니다',
      tNothing: '회수할 자막이 없습니다', tRetried: '재전송했습니다', tNotOnline: '아직 서버에 연결되지 않았습니다',
      tDelayBy: (who, s) => `${who}가 딜레이를 ${s}s로 변경`,
      confirmClear: '지금 송출 중인 자막과 대기 중인 자막을 모두 숨깁니다. 진행할까요?',
      renamePrompt: '표시할 이름',
    },
    en: {
      brand: 'PRJ-LOCAL_SUB', onAir: 'ON AIR', offAir: 'OFF AIR', noLink: 'NO LINK',
      subLang: 'Subtitle', delay: 'Delay', sync: 'Sync', buffer: 'Buffer',
      bufOk: 'OK', bufWait: 'Queued', bufFail: 'Failed', bufOff: 'Offline',
      connected: 'Connected', me: 'me', roleTypist: 'Typist', roleBroadcast: 'Output',
      noVideo: 'No video input', noVideoSub: 'RTMP/SRT planned · use <code>?video=&lt;url&gt;</code> to embed',
      noSignal: 'NO SIGNAL', preview: 'On-air preview',
      monitor: 'Live monitor', monitorIdle: 'Waiting for the other typist', typing: 'typing',
      tabHistory: 'Recent', tabHotkeys: 'Hotkeys',
      stWait: 'Queued', stLive: 'On air', stDone: 'Done', stFail: 'Failed', stRevoked: 'Pulled',
      actCancel: 'Cancel', actRetry: 'Retry', actRevoke: 'Pull',
      histEmpty: 'Nothing sent yet.', count: '',
      send: 'Send', delayLabel: 'Send delay', shared: 'room-wide',
      btnRevoke: 'Pull last', btnClear: 'Hide all',
      placeholder: 'Type and press Enter   ·   Shift+Enter newline',
      hkTitle: 'Hotkeys',
      hkHint: 'Click a key field and press your combination. Combos the browser or OS claims, and editing/IME shortcuts, are rejected automatically.',
      hkColKey: 'Shortcut', hkColLabel: 'Label', hkColText: 'Text to insert',
      hkLabel: 'Label', hkText: 'Text to insert',
      hkSave: 'Save & close', hkCancel: 'Cancel', hkAdd: '+ Add hotkey', hkDel: 'Delete',
      hkSaved: 'Hotkeys saved', hkEmpty: 'No hotkeys yet',
      hkSetup: 'Set up hotkeys', hkSettings: 'Hotkey settings',
      hkPress: 'Press a combination…', hkUnset: 'unset',
      hkBadKey: 'Use a modifier combo or F1–F10',
      hkReserved: 'This app already uses that key',
      hkDup: 'Conflicts with another hotkey',
      hkBlockOs: 'The browser or OS intercepts this before the page sees it',
      hkBlockBrowser: 'That is a browser shortcut',
      hkBlockEdit: 'That is a text-editing shortcut and would break typing',
      hkBlockIme: 'That is an input-method (language toggle) shortcut',
      hkSafe: 'Safe combos: Alt+letter · Ctrl+Shift+letter · Ctrl+Shift+digit · F1–F10',
      hkConflict: 'unavailable',
      warnNoBroadcast: '⚠ No output screen is connected.',
      warnDupName: '⚠ Two typists share the same name. Click your name to change it.',
      warnManyBc: (n) => `⚠ ${n} output screens are connected. Close the ones you are not using — the preview mixes them.`,
      warnOffline: '⚠ Disconnected — cannot send. Check the server (npm start).',
      tOffline: 'Disconnected from the server', tFail: 'Send failed — use Retry in the list',
tCleared: 'Hid all on-air subtitles',
      tCancelled: 'Queued subtitle cancelled', tRevoked: 'Pulled your last subtitle',
      tNothing: 'Nothing to pull', tRetried: 'Resent', tNotOnline: 'Not connected yet',
      tDelayBy: (who, s) => `${who} set the delay to ${s}s`,
      confirmClear: 'This hides every on-air and queued subtitle. Continue?',
      renamePrompt: 'Display name',
    },
  };

  const LANG_NAMES = {
    ko: { ko: '한국어', en: 'Korean' }, en: { ko: '영어', en: 'English' },
    es: { ko: '스페인어', en: 'Spanish' }, ja: { ko: '일본어', en: 'Japanese' },
    zh: { ko: '중국어', en: 'Chinese' },
  };

  let cur = 'ko';
  try { cur = localStorage.getItem(KEY) || 'ko'; } catch (e) {}
  if (!DICT[cur]) cur = 'ko';

  const listeners = [];
  const api = {
    get lang() { return cur; },
    t(key, ...args) {
      const v = DICT[cur][key];
      return typeof v === 'function' ? v(...args) : (v == null ? key : v);
    },
    langName(code) {
      const e = LANG_NAMES[code];
      return e ? e[cur] : String(code || '').toUpperCase();
    },
    set(lang) {
      if (!DICT[lang] || lang === cur) return;
      cur = lang;
      try { localStorage.setItem(KEY, lang); } catch (e) {}
      document.documentElement.lang = lang;
      listeners.forEach((fn) => fn(lang));
    },
    onChange(fn) { listeners.push(fn); },
  };
  global.I18N = api;
})(window);
