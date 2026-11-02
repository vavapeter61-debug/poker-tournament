import { createClient } from '@supabase/supabase-js';
import './style.css';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const slug = params.get('id');
const mode = params.get('mode') || 'admin';
const pin = params.get('pin') || '';
const config = {
  ...(window.POKER_CONFIG || {}),
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || window.POKER_CONFIG?.supabaseUrl,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || window.POKER_CONFIG?.supabaseAnonKey,
};
let supabase, channel, state, timerHandle, lastTick = 0, isAdmin = mode !== 'board';
let busy = false;

const defaults = () => ({
  title: 'POKER TOURNAMENT',
  buyIn: 0, prizePool: 0, payouts: [{ rank: 1, percent: 50 }, { rank: 2, percent: 30 }, { rank: 3, percent: 20 }],
  level: 0, running: false, endsAt: null, remaining: 900, duration: 900,
  players: 30, entries: 30, eliminated: 0, chipsPerEntry: 10000, totalChips: 300000,
  breakMode: false, bgPreset: 'black-gold', bgImage: '',
  levels: [
    { minutes:15, sb:100, bb:200, ante:0 },
    { minutes:15, sb:100, bb:300, ante:0 },
    { minutes:15, sb:200, bb:400, ante:0 },
    { minutes:15, sb:200, bb:600, ante:0 },
    { minutes:15, sb:300, bb:600, ante:100 },
    { minutes:15, sb:400, bb:800, ante:100 }
  ]
});
const fmt = n => `${Math.floor(n/60).toString().padStart(2,'0')}:${Math.floor(n%60).toString().padStart(2,'0')}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const avg = () => state.players > 0 ? Math.floor(state.totalChips / state.players) : 0;
const remainingNow = () => state.running && state.endsAt ? Math.max(0, Math.ceil((state.endsAt - Date.now())/1000)) : state.remaining;

function shell() {
  $('#app').innerHTML = `
  <header><div><b>♠ POKER CLOCK</b><small>TOURNAMENT MANAGEMENT</small></div><span id="connection" class="pill">CONNECTING</span></header>
  <nav><button id="adminTab" class="tab">관리자</button><button id="boardTab" class="tab">전광판</button></nav>
  <main>
    <section id="board" class="board">
      <div class="board-head"><div class="brand-mark">♠</div><div class="board-title"><span class="eyebrow">TOURNAMENT CLOCK</span><span id="title">POKER TOURNAMENT</span></div><span id="status" class="live-status">READY</span></div>
      <div class="arena-grid">
        <div class="timer-panel">
          <div class="level-label">CURRENT LEVEL <strong id="level">LEVEL 1</strong></div>
          <div class="dial-wrap">
            <svg class="dial" viewBox="0 0 240 240" role="img" aria-label="남은 시간 원형 표시">
              <circle class="dial-track" cx="120" cy="120" r="108"></circle>
              <circle id="dialProgress" class="dial-progress" cx="120" cy="120" r="108"></circle>
            </svg>
            <div class="dial-center"><div class="clock" id="clock">15:00</div><div class="sub">TIME REMAINING</div></div>
          </div>
        </div>
        <div class="blind-panel">
          <div class="panel-kicker">CURRENT BLINDS</div>
          <div class="blind-value"><span>SMALL BLIND</span><strong id="sb">100</strong></div>
          <div class="blind-divider"></div>
          <div class="blind-value"><span>BIG BLIND</span><strong id="bb">200</strong></div>
          <div class="blind-divider"></div>
          <div class="blind-value ante-value"><span>ANTE</span><strong id="ante">0</strong></div>
          <div id="nextBlinds" class="next-blinds"><div class="next-blinds-heading">NEXT LEVEL <span id="nextLevelLabel">LEVEL 2</span></div><div class="next-blinds-values"><span>SB <b id="nextSb">200</b></span><span>BB <b id="nextBb">400</b></span></div></div>
        </div>
      </div>
      <div class="stats">
        <div class="stat-card"><span>PLAYERS LEFT</span><b id="playersBoard">30</b></div>
        <div class="stat-card"><span>AVERAGE STACK</span><b id="avgBoard">10,000</b></div>
        <div class="stat-card"><span>TOTAL CHIPS</span><b id="chipsBoard">300,000</b></div>
      </div>
      <div class="board-foot"><span>ENTRIES <b id="entriesBoard">30</b></span><i></i><span>ELIMINATED <b id="outBoard">0</b></span></div>
      <section id="prizeBoard" class="prize-board" hidden><div class="prize-heading"><span>PRIZE POOL</span><strong id="prizePoolBoard">₩0</strong></div><div id="payoutBoard" class="payout-board"></div></section>
      <div id="boardControls" class="controls"><button id="boardStart" class="accent">▶ 시작</button><button id="boardNext">다음 레벨 ⏭</button></div>
    </section>
    <section id="admin" class="admin">
      <div class="card"><h2>대회 정보</h2><label>전광판 중앙 상단 문구<input id="titleInput" value="POKER TOURNAMENT" maxlength="48" placeholder="예: SATURDAY MAIN EVENT"></label>
        <div class="formgrid">
          <label>현재 생존 인원<input id="playersInput" type="number" min="0"></label>
          <label>총 엔트리<input id="entriesInput" type="number" min="0"></label>
          <label>탈락자<input id="outInput" type="number" min="0"></label>
          <label>엔트리당 지급 칩<input id="chipsPerEntryInput" type="number" min="0" step="1000"></label>
          <label>바이인 금액 (원)<input id="buyInInput" type="number" min="0" step="10000" placeholder="예: 50000"></label>
          <label>총 칩 수량<input id="chipsInput" type="number" min="0" readonly></label>
        </div><button id="saveStats" class="accent full">참가자 정보 저장</button>
        <p class="hint">총 칩 수량 = 엔트리당 지급 칩 × 총 엔트리입니다. 리엔트리도 총 엔트리에 포함해 주세요. 평균 스택은 총 칩 ÷ 생존 인원으로 계산됩니다.</p>
      </div>
      <div class="card prize-admin"><div class="row"><h2>프라이즈 / 상금 배분</h2><button id="addPayout">＋ 순위 추가</button></div>
        <div class="prize-pool-summary"><span>전체 상금 (엔트리 × 바이인)</span><strong id="prizePoolInput">₩0</strong></div>
        <div class="payout-head"><span>순위</span><span>지급 비율 (%)</span><span>지급 금액</span><span></span></div>
        <div id="payoutRows"></div>
        <div class="payout-total"><span>배분 비율 합계</span><strong id="payoutPercentTotal">0%</strong></div>
        <p id="payoutHint" class="hint">전체 상금을 입력하고 각 순위의 지급 비율을 설정하세요. 합계가 100%가 되도록 조정할 수 있습니다.</p>
        <button id="savePrize" class="accent full">상금 구조 저장</button>
      </div>
      <div class="card"><div class="row"><h2>블라인드 구조</h2><button id="addLevel">＋ 레벨 추가</button></div>
        <div class="level-head"><span>LEVEL</span><span>분</span><span>SB</span><span>BB</span><span>ANTE</span><span></span></div>
        <div id="levels"></div><button id="saveLevels" class="accent full">블라인드 저장</button>
      </div>
      <div class="card"><h2>전광판 배경</h2>
        <label>기본 배경 선택<select id="bgPreset"><option value="black-gold">블랙 · 골드</option><option value="casino-green">카지노 그린</option><option value="red-velvet">레드 벨벳</option><option value="navy">딥 네이비</option></select></label>
        <label>원하는 이미지 업로드<input id="bgUpload" type="file" accept="image/*"></label>
        <p class="hint">선택한 배경은 관리자 화면과 전광판에 함께 적용됩니다. 업로드 이미지는 전송·동기화를 위해 자동으로 축소 및 압축됩니다. 동기화 안정성을 위해 압축 후 약 600KB 이하 이미지만 저장할 수 있습니다.</p>
        <button id="clearBg" class="full">업로드 이미지 제거</button>
      </div>
      <div class="card"><h2>타이머 제어</h2><div class="controls"><button id="start" class="accent">▶ 시작</button><button id="pause">Ⅱ 일시정지</button><button id="next">다음 레벨 ⏭</button><button id="reset">↺ 레벨 초기화</button></div>
        <label>남은 시간 (초)<input id="manualTime" type="number" min="0"></label><button id="setTime" class="full">시간 적용</button>
      </div>
      <div class="card"><h2>공유 주소</h2><p class="hint">전광판 주소를 TV 브라우저에서 열어 주세요. 관리자 주소와 PIN은 공유하지 마세요.</p><label>전광판 URL<input id="boardUrl" readonly></label><button id="copyUrl" class="full">전광판 주소 복사</button></div>
    </section>
  </main><footer id="message">실시간 연결 준비 중</footer>`;
}
function setMode(m) {
  const board = m === 'board';
  $('#admin').hidden = board || !isAdmin;
  $('#board').classList.toggle('big', board);
  $('#adminTab').classList.toggle('active', !board);
  $('#boardTab').classList.toggle('active', board);
  $('#boardControls').hidden = board || !isAdmin;
}
function render() {
  if (!state) return;
  const l = state.levels[state.level] || state.levels[0];
  const r = remainingNow();
  const duration = Math.max(1, Number(state.duration) || Number(state.levels[state.level]?.minutes || 15) * 60);
  const ratio = Math.max(0, Math.min(1, r / duration));
  const circumference = 2 * Math.PI * 108;
  $('#dialProgress').style.strokeDasharray = `${circumference}`;
  $('#dialProgress').style.strokeDashoffset = `${circumference * (1-ratio)}`;
  $('#dialProgress').classList.toggle('urgent', r <= 60 && r > 0);
  $('#title').textContent = state.title || 'POKER TOURNAMENT';
  applyBoardBackground();
  const prizePool = Math.max(0, Number(state.prizePool) || 0);
  const payouts = Array.isArray(state.payouts) ? state.payouts : [];
  $('#prizeBoard').hidden = prizePool <= 0 || payouts.length === 0;
  $('#prizePoolBoard').textContent = `₩${prizePool.toLocaleString()}`;
  $('#payoutBoard').innerHTML = payouts.slice().sort((a,b)=>Number(a.rank)-Number(b.rank)).map(p=>`<div class="payout-item"><span>${Number(p.rank)}${Number(p.rank)===1?'ST':Number(p.rank)===2?'ND':Number(p.rank)===3?'RD':'TH'}</span><b>${Number(p.percent).toLocaleString(undefined,{maximumFractionDigits:2})}%</b><strong>₩${Math.floor(prizePool*Number(p.percent)/100).toLocaleString()}</strong></div>`).join('');
  $('#level').textContent = state.breakMode ? 'BREAK' : `LEVEL ${state.level+1}`;
  $('#clock').textContent = fmt(r);
  $('#status').textContent = state.running ? '● RUNNING' : r === 0 ? 'LEVEL ENDED' : 'Ⅱ PAUSED';
  $('#sb').textContent = state.breakMode ? '—' : Number(l.sb).toLocaleString();
  $('#bb').textContent = state.breakMode ? '—' : Number(l.bb).toLocaleString();
  $('#ante').textContent = state.breakMode ? '—' : Number(l.ante).toLocaleString();
  const nextBlind = state.levels[state.level + 1];
  $('#nextBlinds').hidden = !nextBlind;
  if (nextBlind) {
    $('#nextLevelLabel').textContent = `LEVEL ${state.level + 2}`;
    $('#nextSb').textContent = Number(nextBlind.sb).toLocaleString();
    $('#nextBb').textContent = `${Number(nextBlind.bb).toLocaleString()}(${Number(nextBlind.ante).toLocaleString()})`;
  }
  $('#playersBoard').textContent = Number(state.players).toLocaleString();
  $('#avgBoard').textContent = avg().toLocaleString();
  $('#chipsBoard').textContent = Number(state.totalChips).toLocaleString();
  $('#entriesBoard').textContent = Number(state.entries).toLocaleString();
  $('#outBoard').textContent = Number(state.eliminated).toLocaleString();
  $('#boardStart').textContent = state.running ? 'Ⅱ 일시정지' : '▶ 시작';
  $('#manualTime').value = r;
  if (isAdmin) {
    $('#titleInput').value = state.title || '';
    const bgSelect=$('#bgPreset'); if(bgSelect) bgSelect.value=state.bgPreset||'black-gold';
    $('#buyInInput').value = state.buyIn || 0;
    $('#prizePoolInput').textContent = `₩${(Number(state.entries || 0) * Number(state.buyIn || 0)).toLocaleString()}`;
    $('#playersInput').value = state.players; $('#entriesInput').value = state.entries;
    $('#outInput').value = state.eliminated; $('#chipsPerEntryInput').value = state.chipsPerEntry ?? 10000; $('#chipsInput').value = (Number(state.entries)||0) * (Number(state.chipsPerEntry ?? 10000)||0);
  }
}
function applyBoardBackground() {
  const board=$('#board'); if(!board||!state)return;
  const presets={
    'black-gold':'radial-gradient(ellipse at 50% -20%,#302516 0%,#111 52%,#050505 100%)',
    'casino-green':'radial-gradient(ellipse at 50% 0%,#164b36 0%,#09271d 55%,#030b08 100%)',
    'red-velvet':'radial-gradient(ellipse at 50% 0%,#64232b 0%,#2b0d13 58%,#090304 100%)',
    'navy':'radial-gradient(ellipse at 50% 0%,#203d61 0%,#0b1a2b 58%,#03070d 100%)'
  };
  const preset=presets[state.bgPreset]||presets['black-gold'];
  const background=state.bgImage?`linear-gradient(rgba(0,0,0,.68),rgba(0,0,0,.78)),url("${state.bgImage}")`:preset;
  board.style.backgroundImage=background;
  board.style.backgroundSize=state.bgImage?'cover':'auto';
  board.style.backgroundPosition='center';
  document.body.style.backgroundImage=state.bgImage?`linear-gradient(rgba(0,0,0,.78),rgba(0,0,0,.86)),url("${state.bgImage}")`:preset;
  document.body.style.backgroundSize=state.bgImage?'cover':'auto';
  document.body.style.backgroundPosition='center';
  document.body.style.backgroundAttachment='fixed';
}
function compressBackground(file) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader(); reader.onerror=()=>reject(new Error('파일을 읽을 수 없습니다.'));
    reader.onload=()=>{const img=new Image();img.onerror=()=>reject(new Error('이미지를 열 수 없습니다.'));img.onload=()=>{
      const maxW=1600,maxH=900,scale=Math.min(1,maxW/img.width,maxH/img.height);
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
      const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/jpeg',.72));
    };img.src=reader.result;};reader.readAsDataURL(file);
  });
}

function drawLevels() {
  $('#levels').innerHTML = state.levels.map((l,i)=>`<div class="level-row" data-i="${i}">
    <b>${i+1}</b>${['minutes','sb','bb','ante'].map(k=>`<input type="number" min="0" data-k="${k}" value="${esc(l[k])}" aria-label="레벨 ${i+1} ${k}">`).join('')}
    <button class="delete" data-delete="${i}" aria-label="삭제">×</button></div>`).join('');
}
function updatePayoutSummary() {
  const payouts = Array.isArray(state.payouts) ? state.payouts : [];
  const pool = Math.max(0, Number($('#entriesInput')?.value ?? state.entries) || 0) * Math.max(0, Number($('#buyInInput')?.value ?? state.buyIn) || 0);
  [...$('#payoutRows').querySelectorAll('.payout-row')].forEach((row,i)=>{
    const amount = row.querySelector('.payout-amount');
    if (amount) amount.textContent = `₩${Math.floor(pool*Number(payouts[i]?.percent||0)/100).toLocaleString()}`;
  });
  const total = payouts.reduce((sum,p)=>sum+Number(p.percent||0),0);
  $('#payoutPercentTotal').textContent = `${Number(total.toFixed(2))}%`;
  $('#payoutPercentTotal').classList.toggle('complete', Math.abs(total-100)<0.001);
  $('#payoutHint').textContent = Math.abs(total-100)<0.001 ? '상금 배분 비율 합계가 100%입니다.' : `현재 ${Number(total.toFixed(2))}% 배분 · 남은 비율 ${Number((100-total).toFixed(2))}%`;
}
function drawPayouts() {
  const payouts = Array.isArray(state.payouts) ? state.payouts : [];
  const pool = Math.max(0, Number($('#entriesInput')?.value ?? state.entries) || 0) * Math.max(0, Number($('#buyInInput')?.value ?? state.buyIn) || 0);
  $('#payoutRows').innerHTML = payouts.map((p,i)=>`<div class="payout-row" data-i="${i}"><input type="number" min="1" step="1" data-pk="rank" value="${esc(p.rank)}" aria-label="지급 순위"><input type="number" min="0" max="100" step="0.1" data-pk="percent" value="${esc(p.percent)}" aria-label="지급 비율"><strong class="payout-amount">₩${Math.floor(pool*Number(p.percent)/100).toLocaleString()}</strong><button class="delete" data-payout-delete="${i}" aria-label="순위 삭제">×</button></div>`).join('');
  updatePayoutSummary();
}
async function persist(next) {
  if (!isAdmin || busy) return;
  busy = true;
  const { error } = await supabase.rpc('poker_update_tournament', { p_slug: slug, p_pin: pin, p_state: next });
  busy = false;
  if (error) { message('저장 실패: '+error.message); return; }
  state = next; render(); message('서버에 저장됨 · 모든 전광판에 반영');
}
function message(s) { $('#message').textContent = s; }
async function command(fn) {
  const next = structuredClone(state);
  const r = remainingNow();
  next.remaining = r; next.running = false; next.endsAt = null;
  fn(next);
  await persist(next);
}
function startTimer() {
  if (!state || !isAdmin) return;
  if (state.running) {
    command(n=>{n.running=false;n.remaining=remainingNow();});
  } else if (remainingNow() > 0) {
    command(n=>{n.running=true;n.endsAt=Date.now()+n.remaining*1000;});
  }
}
function nextLevel() {
  command(n=>{
    if(n.level < n.levels.length-1){
      n.level++;
      n.breakMode=false;
      n.remaining=Math.max(1,Number(n.levels[n.level].minutes)||15)*60;
      n.duration=n.remaining;
      n.running=true;
      n.endsAt=Date.now()+n.remaining*1000;
    } else {
      n.running=false;
      n.remaining=0;
      n.endsAt=null;
    }
  });
}
function attachEvents() {
  $('#adminTab').onclick=()=>setMode('admin');$('#boardTab').onclick=()=>setMode('board');
  $('#bgPreset').onchange=()=>command(n=>{n.bgPreset=$('#bgPreset').value;n.bgImage='';});
  $('#clearBg').onclick=()=>command(n=>{n.bgImage='';});
  $('#bgUpload').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;if(!file.type.startsWith('image/')){message('이미지 파일만 업로드할 수 있습니다.');return;}try{const data=await compressBackground(file);if(data.length>600000){message('압축 후에도 이미지가 큽니다. 해상도가 낮거나 용량이 작은 이미지로 시도해 주세요.');return;}await command(n=>{n.bgImage=data;});message('배경 이미지가 저장되었습니다.');}catch(err){message('이미지 처리 실패: '+err.message);}};
  $('#start').onclick=startTimer;$('#boardStart').onclick=startTimer;
  $('#pause').onclick=()=>command(n=>{n.running=false;});
  $('#next').onclick=nextLevel;$('#boardNext').onclick=nextLevel;
  $('#reset').onclick=()=>command(n=>{n.remaining=Number(n.levels[n.level].minutes)*60;n.duration=n.remaining;n.breakMode=false;});
  $('#setTime').onclick=()=>command(n=>{n.remaining=Math.max(0,Number($('#manualTime').value)||0);});
  const updateCalculatedChips=()=>{ $('#chipsInput').value=(Math.max(0,Number($('#entriesInput').value)||0)*Math.max(0,Number($('#chipsPerEntryInput').value)||0)).toLocaleString('en-US').replace(/,/g,''); };
  const updateCalculatedPrize=()=>{const pool=Math.max(0,Number($('#entriesInput').value)||0)*Math.max(0,Number($('#buyInInput').value)||0);$('#prizePoolInput').textContent=`₩${pool.toLocaleString()}`;updatePayoutSummary();};
  $('#entriesInput').oninput=()=>{updateCalculatedChips();updateCalculatedPrize();}; $('#chipsPerEntryInput').oninput=updateCalculatedChips; $('#buyInInput').oninput=updateCalculatedPrize;
  $('#saveStats').onclick=()=>command(n=>{
    n.title=$('#titleInput').value.trim()||'POKER TOURNAMENT';
    n.players=Math.max(0,Number($('#playersInput').value)||0);n.entries=Math.max(0,Number($('#entriesInput').value)||0);
    n.eliminated=Math.max(0,Number($('#outInput').value)||0);n.chipsPerEntry=Math.max(0,Number($('#chipsPerEntryInput').value)||0);n.totalChips=n.entries*n.chipsPerEntry;n.buyIn=Math.max(0,Number($('#buyInInput').value)||0);n.prizePool=n.entries*n.buyIn;
  });
  $('#addPayout').onclick=()=>{state.payouts.push({rank:state.payouts.length+1,percent:0});drawPayouts();};
  $('#payoutRows').onclick=e=>{const i=e.target.dataset.payoutDelete;if(i!==undefined){state.payouts.splice(Number(i),1);drawPayouts();}};
  $('#payoutRows').oninput=e=>{const row=e.target.closest('.payout-row');if(!row||!e.target.dataset.pk)return;const i=Number(row.dataset.i),key=e.target.dataset.pk;state.payouts[i][key]=Math.max(key==='rank'?1:0,Number(e.target.value)||0);updatePayoutSummary();};
  $('#savePrize').onclick=()=>{
    const rows=[...$('#payoutRows').querySelectorAll('.payout-row')];
    const payouts=rows.map(row=>({rank:Math.max(1,Math.floor(Number(row.querySelector('[data-pk=rank]').value)||1)),percent:Math.max(0,Number(row.querySelector('[data-pk=percent]').value)||0)}));
    const ranks=payouts.map(p=>p.rank);
    if(new Set(ranks).size!==ranks.length)return message('같은 순위가 중복되어 있습니다.');
    if(payouts.some(p=>p.percent>100))return message('각 순위의 비율은 100% 이하여야 합니다.');
    command(n=>{n.title=$('#titleInput').value.trim()||'POKER TOURNAMENT';n.entries=Math.max(0,Number($('#entriesInput').value)||0);n.buyIn=Math.max(0,Number($('#buyInInput').value)||0);n.prizePool=n.entries*n.buyIn;n.totalChips=n.entries*n.chipsPerEntry;n.payouts=payouts.sort((a,b)=>a.rank-b.rank);});
  };
  $('#addLevel').onclick=()=>{state.levels.push({minutes:15,sb:0,bb:0,ante:0});drawLevels();};
  $('#levels').onclick=e=>{const i=e.target.dataset.delete;if(i!==undefined){if(state.levels.length===1)return message('레벨은 최소 1개가 필요합니다.');state.levels.splice(Number(i),1);state.level=Math.min(state.level,state.levels.length-1);drawLevels();}};
  $('#saveLevels').onclick=()=>{const rows=[...$('#levels').querySelectorAll('.level-row')];const next=structuredClone(state);next.levels=rows.map(row=>Object.fromEntries([...row.querySelectorAll('input')].map(x=>[x.dataset.k,Math.max(0,Number(x.value)||0)])));next.level=Math.min(next.level,next.levels.length-1);next.running=false;next.endsAt=null;next.remaining=next.levels[next.level].minutes*60;next.duration=next.remaining;persist(next);};
  $('#copyUrl').onclick=async()=>{try{await navigator.clipboard.writeText($('#boardUrl').value);message('전광판 주소를 복사했습니다.');}catch{message('주소를 길게 눌러 복사해 주세요.');}};
}
async function connect() {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    shell();$('#connection').textContent='SETUP REQUIRED';
    message('배포 설정 필요: config.js에 Supabase URL과 anon key를 입력한 뒤 다시 실행하세요.');
    $('#admin').hidden=false;$('#board').hidden=true;return;
  }
  supabase=createClient(config.supabaseUrl,config.supabaseAnonKey);
  shell();
  if (!slug) { renderCreate(); return; }
  const {data,error}=await supabase.from('poker_tournaments').select('state').eq('slug',slug).single();
  if(error){message('대회를 찾을 수 없습니다: '+error.message);return;}
  state={...defaults(),...data.state};
  if(!Array.isArray(state.payouts))state.payouts=[];
  isAdmin=mode!=='board' && !!pin;
  $('#connection').textContent='● CONNECTED';
  if(isAdmin){$('#boardUrl').value=`${location.origin}${location.pathname}?id=${encodeURIComponent(slug)}&mode=board`; }
  drawLevels();drawPayouts();render();setMode(mode==='board'?'board':'admin');attachEvents();
  channel=supabase.channel('poker-'+slug).on('postgres_changes',{event:'UPDATE',schema:'public',table:'poker_tournaments',filter:`slug=eq.${slug}`},payload=>{state={...defaults(),...payload.new.state};drawLevels();drawPayouts();render();}).subscribe();
  timerHandle=setInterval(()=>{if(state?.running){if(remainingNow()<=0){if(isAdmin){message('레벨 종료 · 다음 레벨로 자동 전환합니다.');nextLevel();}else{state={...state,running:false,remaining:0,endsAt:null};render();}}else render();}},250);
}
function renderCreate(){
 $('#app').innerHTML=`<header><div><b>♠ POKER CLOCK</b><small>새 토너먼트 만들기</small></div></header>
 <main><section class="card"><h2>대회 생성</h2><label>대회 ID (영문·숫자)<input id="newSlug" placeholder="saturday-main-event"></label>
 <label>관리자 PIN (6자리 이상)<input id="newPin" type="password" inputmode="numeric" placeholder="관리자 비밀번호"></label>
 <button id="create" class="accent full">대회 생성</button><p class="hint">생성 후 관리자 주소와 전광판 주소가 발급됩니다. PIN은 안전하게 보관하세요.</p></section></main>`;
 $('#create').onclick=async()=>{
  const s=$('#newSlug').value.trim().toLowerCase(),p=$('#newPin').value;
  if(!/^[a-z0-9-]{3,40}$/.test(s)||p.length<6)return alert('대회 ID는 영문 소문자·숫자·하이픈 3~40자, PIN은 6자 이상으로 입력하세요.');
  const {error}=await supabase.rpc('poker_create_tournament',{p_slug:s,p_pin:p,p_state:defaults()});
  if(error)return alert(error.message);
  location.href=`${location.pathname}?id=${encodeURIComponent(s)}&mode=admin&pin=${encodeURIComponent(p)}`;
 };
}
connect();
