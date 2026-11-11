// multi.js — 게임 화면(game.html)과 서버를 잇는 코드. config.js, common.js 다음에 불러온다.
// 게임 본체는 고치지 않는다. 게임이 이 기기에 남기는 저장(localStorage)을 읽어서
//  ① 순위판용 진행 정보를 서버로 보내고 ② 다른 기기에서 이어 할 수 있게 저장을 서버에 올리고
//  ③ 원정 완료를 한 번만 기록하고 ④ 🏆 순위 패널을 보여 준다.
'use strict';
(function () {
  const SLOT = 'approtech3d-save-v1';                 // 게임이 쓰는 저장 칸 이름 (게임 코드와 같아야 함)
  const OWNER = PREFIX + '_slot_owner';               // 지금 저장 칸이 어느 학생 것인지
  const STASH = id => PREFIX + '_save:' + id;         // 학생마다 따로 보관하는 칸
  const MAIN = ['water', 'ger', 'market', 'house'], SIDES = ['qdrum', 'delta'];
  const $ = s => document.querySelector(s);

  let token = myToken(), me = null, kicked = false, finished = false;
  let sender = null, lastStr = null, lastKey = '', dirty = false, lastUp = 0, upBusy = false, finBusy = false, finWait = 0;
  let panelOn = false, stopWatch = null, myRank = null, tmUsed = false;

  /* ---------- 게임 저장 읽기 (게임과 같은 방식) ---------- */
  function decSave(s) {
    if (!s) return null;
    try {
      if (s[0] !== 'E') return JSON.parse(s);
      const r = decodeURIComponent(escape(atob(s.slice(1))));
      const k = 'at3d~'; let o = '';
      for (let i = 0; i < r.length; i++) o += String.fromCharCode(r.charCodeAt(i) ^ k.charCodeAt(i % k.length));
      const S = JSON.parse(o);
      return S && S.v === 1 ? S : null;
    } catch (e) { return null; }
  }
  // 저장 → 순위판에 보여 줄 진행 정보 + 진행 점수(많이 나아갈수록 큼)
  function summarize(S) {
    const vil = S.vil || {}, side = S.side || {}, H = S.hall || {};
    const b = MAIN.filter(v => vil[v] && vil[v].badge).length;
    const st = SIDES.filter(v => side[v] && side[v].done).length;
    const s = MAIN.reduce((a, v) => a + ((vil[v] && vil[v].battle && vil[v].battle.stars) || 0), 0) + ((H.boss && H.boss.stars) || 0);
    const g = Math.min(6, H.met || 0);
    const path = !!S.path, boss = !!(H.boss && H.boss.passed), ds = !!(H.design && H.design.done), d = !!S.done;
    const m = (path ? 1 : 0) + b + (g >= 6 ? 1 : 0) + (boss ? 1 : 0) + (ds ? 1 : 0) + (d ? 1 : 0);
    const stations = MAIN.reduce((a, v) => a + Object.keys((vil[v] && vil[v].done) || {}).length, 0);
    const clues = MAIN.reduce((a, v) => a + Object.keys((vil[v] && vil[v].clues) || {}).length, 0)
      + SIDES.reduce((a, v) => a + Object.keys((side[v] && side[v].clues) || {}).length, 0);
    const fair = S.fair && S.fair.done ? Object.keys(S.fair.done).length : 0;
    const pts = m * 1000 + Math.min(999, stations * 10 + clues * 3 + g * 5 + st * 20 + fair * 5 + (S.hasDex ? 5 : 0));
    const prog = { m, b, s, st, g, path, boss, ds, d };
    if (tmUsed) prog.tm = 1;                            // 교사 모드를 쓴 적이 있으면 순위판에 표시
    return { prog, pts };
  }
  // 여러 저장 중 가장 오래 플레이한 것 고르기 (기기마다 시계가 달라도 안전)
  function choose(list) {
    let best = null, bestPlay = -1;
    list.forEach(s => { const S = decSave(s); if (S && (S.play || 0) > bestPlay) { best = s; bestPlay = S.play || 0; } });
    return best;
  }

  /* ---------- 화면 조각 (게임 위에 얹는 것들) ---------- */
  const css = `
  #atxRankBtn{position:relative}
  #atxRankBtn .dot{position:absolute;right:2px;top:0;width:11px;height:11px;border-radius:50%;border:1.5px solid #fff;background:#9aa5a0}
  #atxRankBtn .dot[data-state=live]{background:#3ccf7a}#atxRankBtn .dot[data-state=poll]{background:#ffd166}#atxRankBtn .dot[data-state=offline]{background:#ff5a4e}
  #atxRank{position:fixed;top:0;right:0;bottom:0;width:min(440px,94vw);z-index:60;display:flex;flex-direction:column;gap:10px;padding:16px 16px calc(12px + env(safe-area-inset-bottom));
    background:linear-gradient(#fdfaf1,#f8f1df);color:#1f2a26;border-left:1px solid #b9aa83;box-shadow:-18px 0 44px rgba(4,10,14,.45);
    transform:translateX(105%);transition:transform .25s ease;font-size:16px;line-height:1.45;-webkit-user-select:none;user-select:none}
  #atxRank.on{transform:none}
  #atxRank .hd{display:flex;align-items:flex-start;gap:10px}
  #atxRank .hd div{flex:1;min-width:0}
  #atxRank .eb{font-size:13px;font-weight:800;color:#5a6a61}
  #atxRank h2{margin:0;font-size:24px;line-height:1.25;color:#1f2a26}
  #atxRank .bt{min-height:44px;padding:4px 14px;border-radius:11px;border:1.5px solid rgba(31,42,38,.3);background:linear-gradient(#fff,#f7f2e6);color:#1f2a26;font-weight:800;font-size:16px}
  #atxRank .mine{background:#e2f3e7;border:1.5px solid #2f8f5b;border-radius:12px;padding:8px 12px;font-weight:800;color:#1f2a26}
  #atxRank .ex{font-size:13.5px;font-weight:700;color:#5a6a61}
  #atxRank .tv{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-weight:800;font-size:14px;color:#1f2a26}
  #atxRank .tv label{display:flex;gap:6px;align-items:center;flex:1 1 200px}
  #atxRank .tv select{flex:1;min-height:40px;border-radius:10px;border:1.5px solid rgba(31,42,38,.4);background:#fff;color:#1f2a26;font:inherit;font-size:15px;padding:2px 8px}
  #atxRank .tv a{min-height:40px;display:inline-flex;align-items:center;padding:4px 12px;border-radius:10px;border:1.5px solid rgba(31,42,38,.3);background:linear-gradient(#fff,#f7f2e6);color:#1f2a26;text-decoration:none}
  #atxRank .ls{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:6px;padding-right:2px}
  #atxRank .r{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #d8cdb2;border-radius:12px;padding:7px 10px;color:#1f2a26}
  #atxRank .r.me{background:#e2f3e7;border-color:#2f8f5b}
  #atxRank .n{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-weight:900;font-size:16px;background:#efe8d6;border:2px solid #cfc4a6;color:#1f2a26}
  #atxRank .r1 .n{background:linear-gradient(#ffe7a0,#f0b93a);border-color:#b98312}
  #atxRank .r2 .n{background:linear-gradient(#f3f5f7,#c4ccd3);border-color:#8f9aa4}
  #atxRank .r3 .n{background:linear-gradient(#f6d2b0,#d08b54);border-color:#9c5f30}
  #atxRank .t{flex:1;min-width:0}
  #atxRank .t b{display:block;font-size:17px;color:#1f2a26;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #atxRank .t>span{display:block;font-size:13px;font-weight:700;color:#5a6a61}
  #atxRank .tg{display:inline-block;margin-left:4px;padding:0 7px;border-radius:999px;background:#2f8f5b;color:#fff;font-size:12px;vertical-align:2px}
  #atxRank .s{flex:none;font-size:13px;font-weight:800;text-align:right;color:#1f2a26}
  #atxRank .s.done{color:#2f8f5b}
  #atxRank .ft{font-size:12.5px;font-weight:700;color:#5a6a61;text-align:center}
  #atxRank #netStatus[data-state=live]{color:#2f8f5b}#atxRank #netStatus[data-state=poll]{color:#b07a00}#atxRank #netStatus[data-state=offline]{color:#c9453f}
  #atxNote{position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:70;max-width:min(680px,94vw);display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center;
    padding:10px 14px;border-radius:14px;background:rgba(12,20,26,.9);border:1px solid rgba(255,255,255,.4);color:#fff;font-weight:700;font-size:15px;line-height:1.45;text-align:center}
  #atxNote a,#atxNote button{min-height:40px;padding:4px 14px;border-radius:999px;background:#fbf6e9;color:#1f2a26;font-weight:800;border:0;text-decoration:none;display:inline-flex;align-items:center}
  .atx-gold{background:linear-gradient(#ffdf8a,#f0b93a)!important;border-color:#b98312!important;color:#3a2a05!important}`;

  function mountUI() {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    // 🏆 버튼: 화면 오른쪽 위 버튼 줄(소리·수첩·지도 옆)에 넣는다
    const b = document.createElement('button');
    b.className = 'hbtn'; b.id = 'atxRankBtn'; b.title = '우리 반 순위'; b.setAttribute('aria-label', '우리 반 순위');
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v5a4 4 0 01-8 0V4z"/><path d="M8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4"/><path d="M12 13v4M8.5 20h7M10 17h4"/></svg><span>순위</span><i class="dot" data-net></i>';
    const done = $('#doneBtn'), right = $('.hud-right');
    if (done && done.parentNode) done.after(b); else if (right) right.prepend(b);
    b.onclick = () => { togglePanel(); b.blur(); const gl = $('#gl'); if (gl) gl.focus(); };
    // 순위 패널
    const p = document.createElement('aside');
    p.id = 'atxRank'; p.setAttribute('aria-label', '우리 반 순위'); p.setAttribute('aria-hidden', 'true');
    p.innerHTML = `<div class="hd"><div><div class="eb" id="atxRoom"></div><h2>🏆 우리 반 순위</h2></div><button class="bt" id="atxClose">닫기 ✕</button></div>
      <div class="mine" id="atxMine">불러오는 중…</div>
      <div class="tv" id="atxTV" hidden><label>다른 반 보기 <select id="atxRoomSel" aria-label="다른 반 보기"></select></label><a href="index.html#teacher">🚪 로비로</a></div>
      <div class="ex">원정을 끝낸 대원은 먼저 끝낸 순서, 아직 원정 중인 대원은 많이 나아간 순서예요. 단계는 모두 9개(기술 시스템의 길 → 마을 배지 4개 → 지구 회의장 → 펑펑왕 → 설계 공방 → 지구 약속)예요.</div>
      <div class="ls" id="atxList"></div>
      <div class="ft"><span id="netStatus"></span> · <span id="appVersion">버전 ${esc(APP_VERSION)}</span></div>`;
    document.body.appendChild(p);
    $('#atxClose').onclick = () => togglePanel(false);
    if (me.teacher) {                              // 선생님: 다른 반 순위로 바꾸기
      $('#atxTV').hidden = false;
      $('#atxRoomSel').onchange = e => {
        const o = e.target.selectedOptions[0]; if (!o) return;
        me.room_id = o.value; me.room_name = o.dataset.name; teacherVisit.set(me.room_id, me.room_name);
        if (stopWatch) { stopWatch(); stopWatch = watchRoom(me.room_id, reloadRank); }
      };
    }
    // Esc 로 패널 닫기 (게임 메뉴보다 먼저 받음)
    window.addEventListener('keydown', e => { if (panelOn && e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); togglePanel(false); } }, true);
    // 원정 완료 화면에 '🏆 순위 보기' 버튼 넣기 + 시작 화면 이름 칸 채우기
    new MutationObserver(addEndButton).observe($('#overlay'), { childList: true, subtree: true });
    new MutationObserver(fillName).observe($('#title'), { childList: true, subtree: true });
  }
  function addEndButton() {
    const e3 = document.querySelector('#overlay #e3');
    if (!e3 || document.getElementById('atxEndRank')) return;
    const b = document.createElement('button');
    b.className = 'btn atx-gold'; b.id = 'atxEndRank'; b.textContent = '🏆 순위 보기';
    b.onclick = () => togglePanel(true);
    e3.parentNode.insertBefore(b, e3.parentNode.firstChild);
  }
  function fillName() {
    const nm = document.querySelector('#title #nm');
    if (nm && !nm.value && me && !nm.dataset.atx) { nm.dataset.atx = '1'; nm.value = me.nickname; }
  }
  function note(html, ms) {
    let n = $('#atxNote');
    if (!n) { n = document.createElement('div'); n.id = 'atxNote'; n.setAttribute('role', 'status'); document.body.appendChild(n); }
    n.innerHTML = html; n.hidden = false;
    clearTimeout(note._t); if (ms) note._t = setTimeout(() => { n.hidden = true; }, ms);
  }
  function toast(html, ms) {        // 게임의 알림 칸을 빌려 씀
    const t = $('#toast'); if (!t) return note(html, ms);
    t.innerHTML = html; t.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms || 4000);
  }
  function setLoad(t) { const el = $('#loadTxt'); if (el) el.textContent = t; }

  /* ---------- 순위 패널 ---------- */
  function togglePanel(on) {
    panelOn = on === undefined ? !panelOn : !!on;
    const p = $('#atxRank'); p.classList.toggle('on', panelOn); p.setAttribute('aria-hidden', String(!panelOn));
    if (panelOn && me && me.teacher) fillRoomSel();
    if (panelOn && !stopWatch && me) stopWatch = watchRoom(me.room_id, reloadRank);
    if (!panelOn && stopWatch) { stopWatch(); stopWatch = null; setNet(kicked ? 'offline' : 'live'); }
  }
  async function fillRoomSel() {
    try {
      const rooms = await listAllRooms(); const sel = $('#atxRoomSel');
      sel.innerHTML = rooms.map(r => `<option value="${r.id}" data-name="${esc(r.name)}">${esc(r.name)}</option>`).join('');
      sel.value = me.room_id;
    } catch (e) { }
  }
  let rLoading = false, rAgain = false;
  async function reloadRank() {
    if (rLoading) { rAgain = true; return; }
    rLoading = true;
    try { renderRank(rankOrder(await listPlayers(me.room_id))); }
    catch (e) { $('#atxList').innerHTML = `<div class="r">${esc(e.message)}</div>`; setNet('offline'); }
    rLoading = false;
    if (rAgain) { rAgain = false; reloadRank(); }
  }
  function renderRank(list) {
    $('#atxRoom').textContent = (me.room_name || '') + ' 방';
    const i = list.findIndex(p => p.id === me.player_id);
    myRank = i >= 0 ? i + 1 : null;
    const mine = list[i];
    if (me.teacher) { $('#atxMine').textContent = `선생님으로 보는 중 · 참가 ${list.length}명 · 완주 ${list.filter(p => p.finished_at).length}명 (선생님은 순위에 들어가지 않아요)`; }
    else $('#atxMine').textContent = mine ? `나: ${myRank}등 / ${list.length}명 · ${mine.finished_at ? '원정 완료!' : stageName(mine.progress)} · ★ 별 ${(mine.progress && mine.progress.s) || 0}개`
      : '내 기록이 아직 없어요. 원정을 시작하면 나타나요.';
    $('#atxList').innerHTML = list.length ? list.map((p, k) => {
      const pr = p.progress || {}, isMe = p.id === me.player_id;
      return `<div class="r ${k < 3 ? 'r' + (k + 1) : ''} ${isMe ? 'me' : ''}"><div class="n">${k + 1}</div>
        <div class="t"><b>${esc(p.nickname)}${isMe ? '<span class="tg">나</span>' : ''}</b><span>${esc(progressText(pr))}</span></div>
        <div class="s ${p.finished_at ? 'done' : ''}">${p.finished_at ? '🏁 완주<br>' + esc(timeText(p.finished_at)) : '원정 중<br>' + esc(stageName(pr))}</div></div>`;
    }).join('') : '<div class="r">아직 들어온 대원이 없어요.</div>';
  }

  /* ---------- 서버와 맞추기 ---------- */
  function onKicked() {
    if (kicked) return;
    kicked = true; setNet('offline');
    if (me && me.teacher) { note('선생님 비밀번호 확인이 안 돼서 원정 기록이 서버에 올라가지 않아요. <a href="index.html#teacher">로비에서 다시 들어가기</a>'); return; }
    note('이 기기의 입장 정보가 더 이상 맞지 않아요. (다른 기기에서 같은 이름으로 들어왔거나 선생님이 내보냈어요) 이 기기의 기록은 서버에 올라가지 않아요. <a href="index.html">로비로 가기</a>');
  }
  async function upload(force) {
    if (kicked || upBusy || !dirty || !lastStr) return;
    if (!force && Date.now() - lastUp < 30000) return;
    upBusy = true; const s = lastStr;
    try {
      const r = me.teacher ? await API.teacherSave(teacherPw.get(), s) : await API.saveGame(token, s);
      if (!(r && r.skipped)) { lastUp = Date.now(); if (s === lastStr) dirty = false; if (!panelOn) setNet('live'); }
    } catch (e) {
      if (e instanceof GameError) { if (/다시 입장|비밀번호/.test(e.message)) onKicked(); else { dirty = false; } }
      else { lastUp = Date.now() - 20000; setNet('offline'); }       // 10초 뒤 다시
    }
    upBusy = false;
  }
  async function finish(sum) {
    if (kicked || finBusy || finished || Date.now() < finWait) return;
    finBusy = true;
    try {
      const r = await API.finish(token, sum.pts, sum.prog);
      finished = true; me.finished_at = r.finished_at;
      toast('🏆 <b>원정 완료 기록이 올라갔어요!</b> 위쪽 ‘순위’ 버튼으로 우리 반 순위를 볼 수 있어요.', 6000);
    } catch (e) {
      if (e instanceof GameError && /다시 입장/.test(e.message)) onKicked();
      else finWait = Date.now() + 8000;
    }
    finBusy = false;
  }
  function tick() {
    const s = store.get(SLOT);
    if (!s) return;
    if (s !== lastStr) { lastStr = s; store.set(STASH(me.player_id), s); store.set(OWNER, me.player_id); dirty = true; }
    const S = decSave(s); if (!S) return;
    const sum = summarize(S);
    const key = JSON.stringify(sum);
    const changed = key !== lastKey;
    if (!me.teacher) {                            // 선생님은 순위에 들어가지 않음
      if (changed) { lastKey = key; if (!kicked) sender(sum.prog, sum.pts); }
      if (S.done && !finished) finish(sum);
    } else lastKey = key;
    upload(changed);
  }
  // 창을 닫거나 다른 앱으로 갈 때: 마지막 저장을 서버에 한 번 더 보냄 (닫히는 중에도 가도록 keepalive)
  function flushNow() {
    try {
      const s = store.get(SLOT); if (!s || kicked) return;
      store.set(STASH(me.player_id), s);
      if (s === lastStr && !dirty) return;
      if (s.length > 60000) return;              // keepalive 한도(64KB)를 넘으면 다음 접속 때 올림
      fetch(SUPABASE_URL + '/rest/v1/rpc/' + PREFIX + (me.teacher ? '_teacher_save' : '_save_game'), {
        method: 'POST', keepalive: true,
        headers: Object.assign({ 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
          SUPABASE_KEY.startsWith('eyJ') ? { Authorization: 'Bearer ' + SUPABASE_KEY } : {}),
        body: JSON.stringify(me.teacher ? { p_teacher_pw: teacherPw.get(), p_data: s } : { p_token: token, p_data: s })
      }).catch(() => { });
    } catch (e) { }
  }

  /* ---------- 교사 모드 (게임 메뉴 → 교사 모드 켜기) ---------- */
  // 비밀번호는 파일에 넣지 않고 Supabase 에서 확인한다 (선생님 메뉴·순위판과 같은 비밀번호).
  window.ATX_TEACHER_CHECK = async pw => {
    if (!pw) return { ok: false, error: '비밀번호를 써 주세요' };
    try { await API.reorderRooms(pw, []); return { ok: true }; }   // 빈 목록이라 아무것도 바뀌지 않고 비밀번호만 확인됨
    catch (e) { return { ok: false, error: e.message }; }
  };
  window.ATX_TEACHER_AUTO = async () => (me && me.teacher && teacherPw.get()) ? window.ATX_TEACHER_CHECK(teacherPw.get()) : { ok: false };
  window.ATX_TEACHER_MODE = on => {
    if (on && me && !me.teacher) { tmUsed = true; store.set(PREFIX + '_tm:' + me.player_id, '1'); lastKey = ''; }
  };

  /* ---------- 시작 ---------- */
  async function prepare() {
    const tv = teacherVisit.get();
    if (!tv && !token) { location.replace('index.html'); return; }
    if (typeof window.ATX_START !== 'function') { showFatal('game.html 이 멀티용 파일이 아니에요. 받은 game.html 을 그대로 다시 올려 주세요.'); return; }
    setLoad('원정 기록을 불러오는 중…');
    let serverSave = null;
    if (tv) {                                     // 선생님: 순위에 안 들어가고, 원정 저장은 서버의 선생님 칸에 (어느 방·어느 컴퓨터에서든 이어짐)
      me = { teacher: true, player_id: 'teacher', room_id: tv.room_id, room_name: tv.room_name, nickname: '선생님' };
      try { const g = await API.teacherLoad(teacherPw.get()); serverSave = (g && g.data) || null; }
      catch (e) {
        if (e instanceof GameError) { teacherPw.clear(); teacherVisit.clear(); showFatal(e.message + ' · 로비의 선생님 메뉴에서 다시 들어가 주세요.'); setTimeout(() => location.replace('index.html#teacher'), 2500); return; }
        setNet('offline');
        setTimeout(() => note('서버에 연결할 수 없어 이 기기에만 저장하며 진행해요. 연결되면 자동으로 올라가요.', 9000), 1500);
      }
    } else try {
      const r = await API.resume(token);
      me = { player_id: r.player_id, room_id: r.room_id, nickname: r.nickname, room_name: r.room_name };
      finished = !!r.finished_at;
      if (r.progress && r.progress.tm) tmUsed = true;
      saveMe(me);
      const g = await API.loadGame(token);
      serverSave = (g && g.data) || null;
    } catch (e) {
      if (e instanceof GameError) { forgetToken(); location.replace('index.html'); return; }
      me = loadMe();                              // 서버가 잠시 안 되면 이 기기 기록으로 시작
      if (!me) { showFatal(e.message); return; }
      setNet('offline');
      setTimeout(() => note('서버에 연결할 수 없어 이 기기에만 저장하며 진행해요. 연결되면 기록이 자동으로 올라가요.', 9000), 1500);
    }
    // 이어 할 저장 고르기: 이 기기 보관본 · 저장 칸(이 학생 것일 때만) · 서버 보관본 중 가장 오래 플레이한 것
    const cands = [store.get(STASH(me.player_id)), serverSave];
    if (store.get(OWNER) === me.player_id) cands.unshift(store.get(SLOT));
    const pick = choose(cands.filter(Boolean));
    if (pick) store.set(SLOT, pick); else store.del(SLOT);   // 다른 학생의 저장이 남아 있으면 비움
    store.set(OWNER, me.player_id);
    tmUsed = !me.teacher && (tmUsed || store.get(PREFIX + '_tm:' + me.player_id) === '1');
    lastStr = pick; dirty = !!pick && pick !== serverSave;

    mountUI();
    sender = makeProgressSender(token, e => { if (/다시 입장/.test(e.message)) onKicked(); });
    setLoad('원정을 준비하고 있어요');
    window.ATX_START();                          // 게임 시작 (원래 게임 그대로)
    if (me.teacher) setTimeout(() => note(`👩‍🏫 선생님으로 <b>${esc(me.room_name)}</b> 방에 들어왔어요. 순위에는 들어가지 않고, 원정 기록은 어느 방에서든 이어져요. 🏆 순위에서 다른 반으로 바꿀 수 있어요.`, 7000), 600);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushNow(); });   // 게임이 먼저 저장한 뒤에 실행됨(등록 순서)
    window.addEventListener('pagehide', flushNow);
    tick(); setInterval(tick, 2000);
  }
  document.addEventListener('DOMContentLoaded', prepare);

  // 시험용 (화면 점검에서만 씀)
  window.ATX_MULTI = { decSave, summarize, choose, togglePanel };
})();
