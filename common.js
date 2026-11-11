// common.js — 모든 페이지가 함께 쓰는 연결 코드. config.js 다음에 불러온다.
// 함수 이름·인자 이름은 SQL(01_setup.sql)과 정확히 맞춰 두었다. 화면 코드는 아래 API.* 만 쓴다(sb.rpc 직접 호출 금지).
'use strict';

/* ---------- 0. 화면 아래 버전·연결 상태 표시 ---------- */
const NET_TEXT = {
  live: '● 실시간 연결됨',
  poll: '● 자동 새로고침 중',
  offline: '● 연결이 끊겼어요 · 다시 연결하는 중',
  wait: '● 연결하는 중…'
};
function setNet(state) {
  document.querySelectorAll('#netStatus, [data-net]').forEach(el => {
    el.dataset.state = state;
    if (el.id === 'netStatus') el.textContent = NET_TEXT[state] || '';
  });
}
function showFatal(msg) {
  let box = document.getElementById('fatalBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'fatalBox';
    box.setAttribute('role', 'alert');
    box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;padding:14px 16px;border:2px solid #1f2a26;border-radius:14px;background:#fde9e6;color:#7a1f1b;font-weight:800;font-size:16px;line-height:1.5;font-family:"Nanum Gothic","Malgun Gothic",sans-serif';
    document.body.appendChild(box);
  }
  box.textContent = msg;
}
document.addEventListener('DOMContentLoaded', () => {
  const v = document.getElementById('appVersion');
  if (v) v.textContent = '버전 ' + APP_VERSION;
});

/* ---------- 1. 연결 준비 ---------- */
let sb = null;
function ready() {
  if (sb) return true;
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    showFatal('연결 프로그램을 불러오지 못했어요. 학교 인터넷에서 cdn.jsdelivr.net 과 unpkg.com 이 막혀 있는지 선생님께 알려 주세요.');
    return false;
  }
  if (typeof SUPABASE_URL !== 'string' || !SUPABASE_URL.startsWith('https://') || typeof SUPABASE_KEY !== 'string' || SUPABASE_KEY.length < 20) {
    showFatal('config.js 가 없거나 주소·공개 키가 비어 있어요. GitHub 저장소에 config.js 도 함께 올렸는지 확인해 주세요.');
    return false;
  }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return true;
}

/* ---------- 2. 오류를 쉬운 말로 ---------- */
class GameError extends Error {}           // 학생에게 그대로 보여 줘도 되는 오류(비밀번호 틀림 등)
function friendly(res, fn) {
  const e = res.error || {};
  const msg = String(e.message || '');
  if (res.status === 401 || /Invalid API key|JWT/i.test(msg)) return '공개 키가 맞지 않아요. config.js 의 SUPABASE_KEY 를 확인해 주세요.';
  if (e.code === 'PGRST202' || /Could not find the function/i.test(msg)) return `서버에 ${PREFIX}_${fn} 기능이 아직 없어요. SQL 을 실행했는지 확인하고 1분 뒤 다시 해 주세요.`;
  if (e.code === '42P01' || e.code === 'PGRST205' || /relation .* does not exist|Could not find the table/i.test(msg)) return `서버에 ${PREFIX}_ 표가 아직 없어요. SQL 을 실행했는지 확인하고 1분 뒤 다시 해 주세요.`;
  if (e.code === '42501' || /permission denied/i.test(msg)) return '권한이 없어 막혔어요. 오류 내용을 캡처해서 알려 주세요.';
  if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg) || res.status === 0) return '서버에 연결할 수 없어요. 인터넷을 확인하고, 계속 안 되면 선생님이 Supabase 프로젝트가 일시정지됐는지 확인해 주세요.';
  return '잠시 문제가 생겼어요. 잠시 후 다시 해 주세요. (' + (e.code || res.status || '') + ')';
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// retry: 네트워크 오류일 때 다시 시도할 횟수. 두 번 실행되면 안 되는 기능(방 만들기·입장)은 0.
async function rpc(fn, args, retry = 0) {
  if (!ready()) throw new Error('연결 준비 실패');
  for (let i = 0; ; i++) {
    let res;
    try { res = await sb.rpc(PREFIX + '_' + fn, args); }
    catch (err) { res = { data: null, error: { message: String(err) }, status: 0 }; }
    if (!res.error) {
      if (res.data && res.data.ok === false) throw new GameError(res.data.error);
      return res.data;
    }
    const network = res.status === 0 || /fetch|network|load failed/i.test(String(res.error.message));
    if (!network || i >= retry) throw new Error(friendly(res, fn));
    setNet('offline');
    await sleep(800 * (i + 1));
  }
}

/* ---------- 3. 서버 기능 목록 (SQL 함수와 인자 이름이 1:1로 맞음) ---------- */
const API = {
  ping:           ()                       => rpc('ping', {}, 2),
  // 선생님
  createRoom:     (tpw, name, roomPw)      => rpc('create_room',         { p_teacher_pw: tpw, p_name: name, p_room_pw: roomPw }),
  updateRoom:     (tpw, roomId, name, pw)  => rpc('admin_update_room',   { p_teacher_pw: tpw, p_room: roomId, p_name: name, p_room_pw: pw || '' }),
  deleteRoom:     (tpw, roomId)            => rpc('admin_delete_room',   { p_teacher_pw: tpw, p_room: roomId }),
  reorderRooms:   (tpw, roomIds)           => rpc('admin_reorder',       { p_teacher_pw: tpw, p_room_ids: roomIds }),
  endRoom:        (tpw, roomId)            => rpc('admin_end_room',      { p_teacher_pw: tpw, p_room: roomId }),
  removePlayer:   (tpw, playerId)          => rpc('admin_remove_player', { p_teacher_pw: tpw, p_player: playerId }),
  resetRoom:      (tpw, roomId)            => rpc('admin_reset_room',    { p_teacher_pw: tpw, p_room: roomId }),
  setPin:         (tpw, playerId, pin)     => rpc('admin_set_pin',       { p_teacher_pw: tpw, p_player: playerId, p_pin: pin }),
  cleanup:        (tpw, days)              => rpc('cleanup',             { p_teacher_pw: tpw, p_days: days || 30 }),
  // 학생
  joinRoom:       (roomId, roomPw, nick, pin) => rpc('join_room',        { p_room: roomId, p_room_pw: roomPw, p_nick: nick, p_pin: pin }),
  resume:         (token)                  => rpc('resume',              { p_token: token }, 2),
  updateProgress: (token, progress, score) => rpc('update_progress',     { p_token: token, p_progress: progress, p_score: score == null ? null : score }, 1),
  finish:         (token, score, progress) => rpc('finish',              { p_token: token, p_score: score, p_progress: progress || null }, 3),
  saveGame:       (token, data)            => rpc('save_game',           { p_token: token, p_data: data }, 1),
  loadGame:       (token)                  => rpc('load_game',           { p_token: token }, 2),
};

/* ---------- 4. 읽기 (공개해도 되는 칸만) ---------- */
async function readTable(build) {             // build: 연결이 준비된 뒤에 질의를 만드는 함수
  if (!ready()) throw new Error('연결 준비 실패');
  let res;
  try { res = await build(); } catch (err) { res = { error: { message: String(err) }, status: 0 }; }
  if (res.error) throw new Error(friendly(res, 'read'));
  return res.data || [];
}
const listRooms = () => readTable(() => sb.from(PREFIX + '_rooms').select('id,name,status,sort_order,created_at')
  .eq('status', 'open').order('sort_order', { ascending: true }).order('created_at', { ascending: false }).limit(100));
const listAllRooms = () => readTable(() => sb.from(PREFIX + '_rooms').select('id,name,status,sort_order,created_at')
  .order('sort_order', { ascending: true }).order('created_at', { ascending: false }).limit(200));
const listPlayers = roomId => readTable(() => sb.from(PREFIX + '_players').select('id,nickname,progress,score,score_at,finished_at,last_seen,created_at')
  .eq('room_id', roomId).order('created_at', { ascending: true }));
// 선착순: 서버 완주 시각이 빠른 순 (한 방에 같은 이름은 DB 가 막으므로 중복 없음)
function finishOrder(players) {
  return players.filter(p => p.finished_at).sort((a, b) => new Date(a.finished_at) - new Date(b.finished_at));
}
// 순위: ① 원정을 끝낸 대원은 먼저 끝낸 순서(선착순) ② 아직 원정 중인 대원은 많이 나아간 순서, 같으면 먼저 도달한 순서
function rankOrder(players) {
  const done = finishOrder(players);
  const going = players.filter(p => !p.finished_at).sort((a, b) =>
    (b.score - a.score) || (new Date(a.score_at) - new Date(b.score_at)) || (new Date(a.created_at) - new Date(b.created_at)));
  return done.concat(going);
}

/* ---------- 5. 재접속 토큰 (새로고침해도 같은 학생) ---------- */
const TOKEN_KEY = PREFIX + '_token';
const ME_KEY = PREFIX + '_me';
const store = {
  get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del: k => { try { localStorage.removeItem(k); } catch (e) { } }
};
const myToken = () => store.get(TOKEN_KEY);
const saveToken = t => store.set(TOKEN_KEY, t);
const forgetToken = () => { store.del(TOKEN_KEY); store.del(ME_KEY); };
// 이 기기에서 마지막으로 들어간 학생 정보(서버가 잠시 안 될 때 게임을 이어 하기 위해)
const saveMe = me => store.set(ME_KEY, JSON.stringify(me));
const loadMe = () => { try { return JSON.parse(store.get(ME_KEY) || 'null'); } catch (e) { return null; } };

/* ---------- 6. 진행 상황 보내기 (자주 불러도 0.5~1초에 한 번만 보냄, 실패하면 다시) ---------- */
function makeProgressSender(token, onGameError) {
  let pending = null, busy = false, timer = 0;
  const schedule = ms => { if (!timer) timer = setTimeout(flush, ms); };
  async function flush() {
    timer = 0;
    if (busy || !pending) return;
    const job = pending; pending = null; busy = true;
    try {
      const r = await API.updateProgress(token, job.progress, job.score);
      if (r && r.skipped && !pending) pending = job;      // 너무 빨라 건너뛴 경우 최신 값으로 다시
    } catch (e) {
      if (e instanceof GameError) { busy = false; onGameError && onGameError(e); return; } // 토큰이 없어진 경우: 더 보내지 않음
      if (!pending) pending = job;
      setNet('offline');
    }
    busy = false;
    if (pending) schedule(1000);
  }
  return (progress, score) => { pending = { progress, score }; schedule(500); };
}

/* ---------- 7. 실시간 + 자동 새로고침 대비책 ---------- */
// 학교망에서 실시간 연결(WebSocket)이 막히면 8초마다 다시 불러오기로 자동 전환한다.
function watchRoom(roomId, reload) {
  if (!ready()) return () => { };
  let ch = null, joined = false, alive = true, poll = 0, deb = 0, retryT = 0, guardT = 0;
  const kick = () => { clearTimeout(deb); deb = setTimeout(reload, 300); };
  const startPoll = () => { if (!poll) poll = setInterval(reload, 8000); setNet('poll'); };
  const stopPoll = () => { clearInterval(poll); poll = 0; };
  function start() {
    if (!alive) return;
    joined = false;
    setNet('wait');
    ch = sb.channel(PREFIX + ':room:' + roomId + ':' + Math.random().toString(36).slice(2, 7))
      .on('postgres_changes', { event: '*', schema: 'public', table: PREFIX + '_players', filter: 'room_id=eq.' + roomId }, kick)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: PREFIX + '_players' }, kick)   // 삭제는 필터가 안 먹으므로 따로
      .on('postgres_changes', { event: '*', schema: 'public', table: PREFIX + '_rooms', filter: 'id=eq.' + roomId }, kick)
      .subscribe(status => {
        if (!alive) return;
        if (status === 'SUBSCRIBED') { joined = true; stopPoll(); setNet('live'); reload(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          joined = false; startPoll();
          const old = ch; ch = null; try { sb.removeChannel(old); } catch (e) { }
          clearTimeout(retryT); retryT = setTimeout(start, 15000);
        }
      });
    clearTimeout(guardT);
    guardT = setTimeout(() => { if (alive && !joined) startPoll(); }, 10000);   // 10초 안에 안 붙으면 대비책
  }
  const onVisible = () => { if (!document.hidden) reload(); };
  const onOnline = () => reload();
  const onOffline = () => setNet('offline');
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  reload();
  start();
  return function stop() {
    alive = false; stopPoll(); clearTimeout(deb); clearTimeout(retryT); clearTimeout(guardT);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    if (ch) { try { sb.removeChannel(ch); } catch (e) { } }
  };
}

/* ---------- 8. 선생님 비밀번호 (이 탭에서만 기억, 탭을 닫으면 사라짐) ---------- */
const teacherPw = {
  get: () => { try { return sessionStorage.getItem(PREFIX + '_tpw') || ''; } catch (e) { return ''; } },
  set: v => { try { sessionStorage.setItem(PREFIX + '_tpw', v); } catch (e) { } },
  clear: () => { try { sessionStorage.removeItem(PREFIX + '_tpw'); } catch (e) { } }
};

/* ---------- 9. 화면 도우미 ---------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 원정 진행 정보(progress) → 사람이 읽는 글. 숫자에는 항상 뜻을 붙인다.
// 9단계: 기술 시스템의 길 → 마을 배지 4개 → 지구 회의장 손님 6명 → 펑펑왕 대결 → 설계 공방 → 지구 약속(원정 완료)
const ATX_STEPS = 9;
function progressText(p) {
  p = p || {};
  return [`단계 ${p.m || 0}/${ATX_STEPS}`, `배지 ${p.b || 0}/4`, `★ 별 ${p.s || 0}개`].join(' · ');
}
function stageName(p) {
  p = p || {};
  if (p.d) return '원정 완료';
  if (!p.path) return '기술 시스템의 길';
  if ((p.b || 0) < 4) return `마을 원정 (배지 ${p.b || 0}/4)`;
  if ((p.g || 0) < 6) return `지구 회의장 손님 ${p.g || 0}/6`;
  if (!p.boss) return '펑펑왕과 개념 대결';
  if (!p.ds) return '설계 공방';
  return '지구 약속 정하기';
}
function timeText(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function dateTimeText(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  const same = d.toDateString() === now.toDateString();
  return (same ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ') + timeText(iso);
}
