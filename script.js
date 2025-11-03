/* ImpulseBet — Champions League Edition
   - 32 real teams, groups A-H, then knockouts
   - Matches scheduled per round (all matches in a round start at same round-hour)
   - 90 real minutes duration
   - Live view, tables, bracket, dynamic cash-out, bets saved per user
   - Auto-restart new season after 6 hours from final
*/

/* ---------------- CONFIG ---------------- */
const MIN_BET = 10;
const MATCH_DURATION_MIN = 90;
const UPDATE_INTERVAL_MS = 15 * 1000; // update loop
const COOL_DOWN_MS = 24 * 60 * 60 * 1000; // wheel cooldown
const AUTO_RESTART_AFTER_MS = 6 * 60 * 60 * 1000;

/* ---------------- DOM ---------------- */
const el = {
  userPoints: document.getElementById('userPoints'),
  userPoints_2: document.getElementById('userPointsDisplay_2'),
  currentUserNameTop: document.getElementById('currentUserName'),
  currentUserNameDisplay: document.getElementById('currentUserNameDisplay'),
  currentUserNameLogged: document.getElementById('currentUserNameDisplayLogged'),
  realTimeClock: document.getElementById('realTimeClock'),
  // auth
  loginForm: document.getElementById('loginForm'),
  loginUserName: document.getElementById('loginUserName'),
  loginPassword: document.getElementById('loginPassword'),
  registerForm: document.getElementById('registerForm'),
  newUserName: document.getElementById('newUserName'),
  newPassword: document.getElementById('newPassword'),
  accountMessage: document.getElementById('accountMessage'),
  loggedInStatus: document.getElementById('loggedInStatus'),
  registrationFormArea: document.getElementById('registrationFormArea'),
  logoutButton: document.getElementById('logoutButton'),
  // views
  matchesList: document.getElementById('matchesList'),
  liveList: document.getElementById('liveList'),
  groupsContainer: document.getElementById('groupsContainer'),
  bracketContainer: document.getElementById('bracketContainer'),
  unsettledBetsList: document.getElementById('unsettledBetsList'),
  settledBetsList: document.getElementById('settledBetsList'),
  rankingList: document.getElementById('rankingList'),
  // betslip
  betslipList: document.getElementById('betslipList'),
  betslipCount: document.getElementById('betslipCount'),
  totalOdd: document.getElementById('totalOdd'),
  potentialWin: document.getElementById('potentialWin'),
  betAmountInput: document.getElementById('combinedBetAmount'),
  placeBetButton: document.getElementById('placeCombinedBetButton'),
  betslipMessage: document.getElementById('betslipMessage'),
  // wheel
  wheelModal: document.getElementById('wheelModal'),
  openWheelMini: document.getElementById('openWheelMini'),
  openWheelMini2: document.getElementById('openWheelMini2'),
  spinWheelButton: document.getElementById('spinWheelButton'),
  spinWheelPageButton: document.getElementById('spinWheelPageButton'),
  modalWheelResult: document.getElementById('modalWheelResult'),
  modalWheelCooldown: document.getElementById('modalWheelCooldown'),
  pageWheelResult: document.getElementById('pageWheelResult'),
  modalClose: document.querySelectorAll('.close-button'),
  spinner: document.getElementById('spinner')
};

/* ---------------- STATE ---------------- */
let currentUserId = localStorage.getItem('currentUserId') || 'default_user';
let currentUserName = localStorage.getItem('currentUserName') || 'Гост';
let userPoints = 1000;
let lastSpinTime = null;

let betslipSelections = [];
let activeBets = []; // loaded for current user
let tournament = null;
let updateTimer = null;

/* --------------- TEAMS --------------- */
const TEAMS = [
  'Manchester City','Real Madrid','Bayern Munich','Barcelona',
  'Paris Saint-Germain','Liverpool','Juventus','Chelsea',
  'Borussia Dortmund','Atletico Madrid','Inter Milan','AC Milan',
  'Benfica','Porto','Ajax','Sevilla',
  'Tottenham','RB Leipzig','Napoli','Monaco',
  'Villarreal','Zenit','PSV','Sporting CP',
  'Marseille','Olympique Lyon','Feyenoord','Bayer Leverkusen',
  'Shakhtar Donetsk','Celtic','Galatasaray','Dynamo Kyiv'
];

/* --------------- Helpers --------------- */
function fmt(n){ return Number(n).toFixed(2); }
function safeNumber(v){ const n=Number(v); return isNaN(n)?0:n; }
async function hashStringSHA256(str){ const enc=new TextEncoder(); const data=enc.encode(str); const h=await crypto.subtle.digest('SHA-256',data); return Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,'0')).join(''); }
function nowMs(){ return Date.now(); }

/* LocalStorage helpers */
function saveUser(key,data){ localStorage.setItem(`user_${key}`, JSON.stringify(data)); }
function loadUser(key){ const raw=localStorage.getItem(`user_${key}`); if(!raw) return null; try{return JSON.parse(raw);}catch(e){return null;} }
function saveTournament(){ localStorage.setItem('tournamentData', JSON.stringify(tournament)); }
function loadTournament(){ const raw=localStorage.getItem('tournamentData'); if(!raw) return null; try{return JSON.parse(raw);}catch(e){return null;} }

/* Ensure guest */
function ensureGuest(){ if(!localStorage.getItem('user_default_user')) saveUser('default_user',{ name:'Гост', points:1000, passwordHash:null, activeBets:[], lastSpinTime:null, details:{} }); }

/* --------------- Tournament init --------------- */
/* - We'll create rounds such that all matches in a "round" start at the next round hour (all together),
     then next round of group matches is scheduled after (e.g. next hour) etc.
   - Group stage: each group 6 matches (round-robin). We'll spread matches into sequential "rounds" where
     in each round each team plays at most once. For simplicity we'll build 3 group rounds where each team plays one game per round.
*/

function initTournamentIfMissing(){
  const stored = loadTournament();
  if(stored){ tournament = stored; return; }

  // shuffle teams
  const teams = TEAMS.slice();
  for(let i=teams.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [teams[i],teams[j]]=[teams[j],teams[i]]; }

  const groupNames = ['A','B','C','D','E','F','G','H'];
  const groups = {};
  let idx=0;
  groupNames.forEach(g=>{ groups[g]=[]; for(let k=0;k<4;k++){ groups[g].push(teams[idx++]); } });

  // create group round-robin schedule but organized in 3 rounds:
  // We'll produce 3 rounds per group, each round has 2 matches (so every team plays once per round)
  const matches = [];
  const baseStart = nextRoundHour(new Date());
  const roundsCount = 3;
  // for each round, schedule start at baseStart + r * 60min
  for(let r=0;r<roundsCount;r++){
    const roundStart = new Date(baseStart.getTime() + r*60*60*1000);
    groupNames.forEach(g=>{
      const teamsInG = groups[g];
      // round robin pairings per round (hardcode to ensure each team plays once per round)
      // possible pairing scheme for 4 teams: round 0: [0-1,2-3], round1:[0-2,1-3], round2:[0-3,1-2]
      const pairings = (r===0)? [[0,1],[2,3]] : (r===1)? [[0,2],[1,3]] : [[0,3],[1,2]];
      pairings.forEach(p=>{
        const m = makeMatch('group', teamsInG[p[0]], teamsInG[p[1]], new Date(roundStart).toISOString(), 'group', g);
        matches.push(m);
      });
    });
  }

  tournament = {
    phase: 'groups',
    groups,
    matches, // all group matches scheduled in rounds
    bracket: { roundOf16: [], quarter: [], semi: [], final: [] },
    lastUpdate: Date.now(),
    seasonStart: Date.now(),
    seasonEnd: null,
    autoRestartAt: null
  };

  saveTournament();
}

/* create match */
function makeMatch(stage, home, away, startISO, type='group', tag=null){
  const start = new Date(startISO);
  const end = new Date(start.getTime() + MATCH_DURATION_MIN*60*1000);
  const homeOdd = +(1.6 + Math.random()*1.6).toFixed(2);
  const drawOdd = +(2.8 + Math.random()*0.8).toFixed(2);
  const awayOdd = +(1.6 + Math.random()*1.6).toFixed(2);
  // generate some goal times (sparse)
  const goals = [];
  const p = Math.random();
  const goalCount = p < 0.3 ? Math.floor(Math.random()*2) : Math.floor(Math.random()*4); // 0-3
  for(let i=0;i<goalCount;i++){ goals.push(Math.floor(1+Math.random()*89)); }
  goals.sort((a,b)=>a-b);
  return {
    id: 'm_'+Math.random().toString(36).slice(2,9),
    stage,
    type,
    tag,
    home, away,
    homeOdd, drawOdd, awayOdd,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    status: 'Предстоящ',
    minute: 0,
    scoreHome: 0,
    scoreAway: 0,
    goalTimes: goals,
    events: [],
    _resolved: false
  };
}

/* next round hour */
function nextRoundHour(d){
  const dd = new Date(d);
  dd.setMinutes(0,0,0);
  if(dd.getTime() <= d.getTime()) dd.setHours(dd.getHours()+1);
  return dd;
}

/* --------------- Match simulation & progression --------------- */

function updateMatchesAndSimulate(){
  if(!tournament) return;
  const now = Date.now();
  let changed = false;

  // update group matches
  const allMatches = getAllMatches();

  allMatches.forEach(match=>{
    const start = new Date(match.startTime).getTime();
    const end = new Date(match.endTime).getTime();
    if(now < start){
      if(match.status !== 'Предстоящ'){ match.status='Предстоящ'; match.minute=0; changed=true; }
    } else if(now >= start && now < end){
      const elapsedMs = now - start;
      const minute = Math.min(MATCH_DURATION_MIN, Math.floor(elapsedMs/60000));
      if(match.status !== 'На живо'){ match.status='На живо'; changed=true; }
      if(minute !== match.minute){
        match.minute = minute;
        changed = true;
        // check for goalTimes <= minute
        while(match.goalTimes.length && match.goalTimes[0] <= minute){
          const gmin = match.goalTimes.shift();
          // choose scoring team biased by odds
          const wHome = 1 / match.homeOdd;
          const wAway = 1 / match.awayOdd;
          const r = Math.random() * (wHome + wAway);
          const team = (r < wHome) ? 'home' : 'away';
          if(team === 'home') match.scoreHome++;
          else match.scoreAway++;
          match.events.push({ type:'goal', minute:gmin, team, score:[match.scoreHome,match.scoreAway] });
        }
      }
    } else {
      if(match.status !== 'Завършил'){ match.status='Завършил'; match.minute = MATCH_DURATION_MIN; changed=true; }
      // when just finished, trigger resolution
      if(match.status === 'Завършил' && !match._resolved){
        onMatchFinished(match);
        match._resolved = true;
        changed = true;
      }
    }
  });

  // check phase transitions
  if(tournament.phase === 'groups'){
    const anyPending = tournament.matches.some(m=>m.status !== 'Завършил');
    if(!anyPending){
      buildBracketFromGroups();
      tournament.phase = 'roundOf16';
      scheduleBracketMatches('roundOf16');
      changed = true;
    }
  } else if(tournament.phase === 'roundOf16'){
    const pending = (tournament.bracket.roundOf16 || []).some(m=>m.status !== 'Завършил');
    if(!pending && (tournament.bracket.roundOf16||[]).length>0){
      tournament.phase = 'quarter';
      scheduleBracketMatches('quarter');
      changed = true;
    }
  } else if(tournament.phase === 'quarter'){
    const pending = (tournament.bracket.quarter || []).some(m=>m.status !== 'Завършил');
    if(!pending && (tournament.bracket.quarter||[]).length>0){
      tournament.phase = 'semi';
      scheduleBracketMatches('semi');
      changed = true;
    }
  } else if(tournament.phase === 'semi'){
    const pending = (tournament.bracket.semi || []).some(m=>m.status !== 'Завършил');
    if(!pending && (tournament.bracket.semi||[]).length>0){
      tournament.phase = 'final';
      scheduleBracketMatches('final');
      changed = true;
    }
  } else if(tournament.phase === 'final'){
    const pending = (tournament.bracket.final || []).some(m=>m.status !== 'Завършил');
    if(!pending && (tournament.bracket.final||[]).length>0){
      tournament.phase = 'finished';
      tournament.seasonEnd = Date.now();
      tournament.autoRestartAt = Date.now() + AUTO_RESTART_AFTER_MS;
      changed = true;
    }
  }

  if(changed){ tournament.lastUpdate = Date.now(); saveTournament(); renderAll(); }
}

/* build bracket from group standings */
function buildBracketFromGroups(){
  // compute standings per group
  const standings = {};
  Object.keys(tournament.groups).forEach(g=>{
    standings[g] = {};
    tournament.groups[g].forEach(t=> standings[g][t] = { team:t, points:0, gf:0, ga:0, gd:0, played:0, w:0,d:0,l:0 });
  });

  tournament.matches.filter(m=>m.type==='group').forEach(m=>{
    const g = m.tag;
    if(!g) return;
    const h = m.home, a = m.away;
    const hs = m.scoreHome||0, as = m.scoreAway||0;
    standings[g][h].gf += hs; standings[g][h].ga += as; standings[g][h].gd = standings[g][h].gf - standings[g][h].ga; standings[g][h].played++;
    standings[g][a].gf += as; standings[g][a].ga += hs; standings[g][a].gd = standings[g][a].gf - standings[g][a].ga; standings[g][a].played++;
    if(hs>as){ standings[g][h].points += 3; standings[g][h].w++; standings[g][a].l++; }
    else if(hs<as){ standings[g][a].points += 3; standings[g][a].w++; standings[g][h].l++; }
    else { standings[g][h].points +=1; standings[g][a].points +=1; standings[g][h].d++; standings[g][a].d++; }
  });

  // select top2 per group, with tie-breakers pts->gd->gf
  const winners = {};
  Object.keys(standings).forEach(g=>{
    const arr = Object.values(standings[g]);
    arr.sort((x,y)=> { if(y.points!==x.points) return y.points-x.points; if(y.gd!==x.gd) return y.gd-x.gd; return y.gf - x.gf; });
    winners[g] = arr;
  });

  // mapping to form Round of 16 as common UCL mapping
  const mapPairs = [
    ['A','B'],['C','D'],['E','F'],['G','H'],
    ['B','A'],['D','C'],['F','E'],['H','G']
  ];
  const roundOf16 = [];
  mapPairs.forEach(pair=>{
    const t1 = winners[pair[0]][0].team;
    const t2 = winners[pair[1]][1].team;
    roundOf16.push(makeMatch('knockout', t1, t2, nextRoundHour(new Date(Date.now()+1*60*60*1000)).toISOString(), 'roundOf16', null));
  });

  tournament.bracket.roundOf16 = roundOf16;
}

/* schedule bracket matches with hourly spacing */
function scheduleBracketMatches(stage){
  const list = tournament.bracket[stage] || [];
  const start = nextRoundHour(new Date(Date.now()+1*60*60*1000));
  list.forEach((m,i)=>{
    m.startTime = new Date(start.getTime() + i*60*60*1000).toISOString();
    m.endTime = new Date(start.getTime() + i*60*60*1000 + MATCH_DURATION_MIN*60*1000).toISOString();
    m.status = 'Предстоящ'; m.minute = 0; m.scoreHome = 0; m.scoreAway = 0; m.goalTimes = [];
    const gcount = Math.random()<0.6 ? Math.floor(Math.random()*4) : Math.floor(Math.random()*2);
    for(let k=0;k<gcount;k++) m.goalTimes.push(Math.floor(1+Math.random()*89));
    m.goalTimes.sort((a,b)=>a-b); m.events=[]; m._resolved=false;
  });
  saveTournament();
}

/* --------------- Bets and Cash-out --------------- */

function addSelectionToBetslip(matchId, home, away, type, odd){
  if(betslipSelections.some(s=>s.matchId===matchId && s.type===type)){ showBetslipMsg('Вече имате тази селекция в фиша.', true); return; }
  betslipSelections.push({ matchId, home, away, type, odd });
  renderBetslip();
}

function removeSelectionFromBetslip(idx){
  if(idx<0||idx>=betslipSelections.length) return;
  betslipSelections.splice(idx,1); renderBetslip();
}

function calculateTotalOdd(){ return betslipSelections.reduce((acc,s)=>acc*(Number(s.odd)||1),1); }

function renderBetslip(){
  if(!el.betslipList) return;
  el.betslipList.innerHTML='';
  if(betslipSelections.length===0){
    const li=document.createElement('li'); li.className='empty-message'; li.textContent='Няма избрани срещи.'; el.betslipList.appendChild(li);
    el.totalOdd.textContent='1.00'; el.potentialWin.textContent='0.00'; el.placeBetButton.disabled=true; el.betslipCount.textContent='(0)'; return;
  }
  betslipSelections.forEach((s,i)=>{
    const li=document.createElement('li'); li.className='betslip-selection';
    li.innerHTML = `<div style="flex:1;text-align:left"><div><strong>${s.home} vs ${s.away}</strong></div><div style="font-size:0.9em;color:#9fb0d6">${s.type} (@ ${fmt(s.odd)})</div></div><div><button class="remove-selection" data-idx="${i}">×</button></div>`;
    el.betslipList.appendChild(li);
  });
  el.betslipList.querySelectorAll('.remove-selection').forEach(btn=> btn.onclick = (e)=> removeSelectionFromBetslip(Number(e.currentTarget.dataset.idx)));
  const totalOdd = calculateTotalOdd();
  const amount = safeNumber(el.betAmountInput ? el.betAmountInput.value : MIN_BET);
  el.totalOdd.textContent = fmt(totalOdd);
  el.potentialWin.textContent = fmt(amount * totalOdd);
  el.placeBetButton.disabled = false;
  el.betslipCount.textContent = `(${betslipSelections.length})`;
}

function showBetslipMsg(msg, err=false){
  if(!el.betslipMessage) return; el.betslipMessage.textContent = msg; el.betslipMessage.className = err ? 'log error' : 'log success';
  setTimeout(()=>{ if(el.betslipMessage){ el.betslipMessage.textContent=''; el.betslipMessage.className='log'; } },4000);
}

function placeCombinedBet(){
  if(betslipSelections.length===0){ showBetslipMsg('Изберете поне една среща.', true); return; }
  const amount = safeNumber(el.betAmountInput.value);
  if(amount < MIN_BET){ showBetslipMsg(`Минимален залог ${MIN_BET}`, true); return; }
  if(amount > userPoints){ showBetslipMsg('Нямате достатъчно точки.', true); return; }
  const totalOdd = calculateTotalOdd();
  const potentialWin = amount * totalOdd;
  userPoints -= amount;
  const bet = { id:'b_'+Date.now(), timePlaced:new Date().toLocaleString('bg-BG'), amount, totalOdd, potentialWin, selections:JSON.parse(JSON.stringify(betslipSelections)), status:'Очакване', resultText:null };
  activeBets.push(bet);
  saveCurrentUser();
  betslipSelections = []; renderBetslip(); renderAll();
  showBetslipMsg(`Залог ${bet.id} е направен. Потенциал: ${fmt(potentialWin)}`, false);
}

/* find match by id across all matches */
function getAllMatches(){
  let arr = (tournament.matches||[]).slice();
  ['roundOf16','quarter','semi','final'].forEach(k=>{ if(tournament.bracket && tournament.bracket[k]) arr = arr.concat(tournament.bracket[k]); });
  return arr;
}
function findMatchById(id){ return getAllMatches().find(m=>m.id===id); }
function findMatchBySel(sel){ return findMatchById(sel.matchId) || getAllMatches().find(m=>m.home===sel.home && m.away===sel.away); }

/* calculate cashout for a bet (combined) */
function calculateCashOutForBet(bet){
  let base = bet.amount;
  let combinedMult = 1;
  for(const sel of bet.selections){
    const match = findMatchBySel(sel);
    if(!match){ combinedMult *= sel.odd; continue; }
    if(match.status !== 'На живо'){ combinedMult *= sel.odd; continue; }
    const youBetHome = (sel.type === '1');
    const advantage = (match.scoreHome - match.scoreAway) * (youBetHome ? 1 : -1);
    const progress = Math.min(1, match.minute / MATCH_DURATION_MIN);
    let multiplier = 1;
    if(advantage > 0) multiplier = 1 + 0.6 * (1 - progress);
    else if(advantage === 0) multiplier = 1 - 0.15 * progress;
    else multiplier = Math.max(0.2, 0.5 - 0.4 * progress);
    const implied = sel.odd;
    const selCashMult = Math.max(0.2, Math.min(3.0, multiplier * (implied/2)));
    combinedMult *= selCashMult;
  }
  const cash = Math.max(Math.round(base * combinedMult * 100)/100, base*0.2);
  return Math.max(0, cash);
}

/* resolve bets when matches finish */
function resolveBetsOnMatchFinish(match){
  activeBets.forEach(b=>{
    if(b.status !== 'Очакване') return;
    // check if all involved matches finished
    const involved = b.selections.map(s=>findMatchBySel(s)).filter(Boolean);
    if(involved.length === 0) return; // can't resolve
    if(involved.some(im=>im.status !== 'Завършил')) return;
    // determine outcome
    let won = true;
    for(const sel of b.selections){
      const mm = findMatchBySel(sel);
      if(!mm){ won = false; break; }
      const home = mm.scoreHome||0, away = mm.scoreAway||0;
      if(sel.type === '1' && home <= away){ won = false; break; }
      if(sel.type === '2' && away <= home){ won = false; break; }
      if(sel.type === 'X' && home !== away){ won = false; break; }
    }
    if(won){
      b.status = 'Печеливш';
      userPoints += b.potentialWin;
      b.resultText = `Печеливш (+${fmt(b.potentialWin)})`;
    } else {
      b.status = 'Губещ';
      b.resultText = 'Губещ';
    }
  });
  saveCurrentUser();
}

/* when a match finished */
function onMatchFinished(m){
  resolveBetsOnMatchFinish(m);
}

/* --------------- Rendering --------------- */

function renderMatchesUpcoming(){
  if(!el.matchesList) return;
  // upcoming matches that are not started and belong to current round (closest start time)
  const upcoming = tournament.matches.filter(m=>m.status==='Предстоящ').sort((a,b)=> new Date(a.startTime)-new Date(b.startTime));
  if(upcoming.length===0){ el.matchesList.innerHTML = '<p class="muted">Няма предстоящи мачове за момента.</p>'; return; }
  // group by startTime of earliest round (so we show the whole round)
  const earliest = upcoming[0].startTime;
  const roundMatches = upcoming.filter(m=>m.startTime === earliest);
  el.matchesList.innerHTML = '';
  roundMatches.forEach(m=>{
    const div = document.createElement('div'); div.className='match-card';
    const left = document.createElement('div'); left.className='match-left';
    left.innerHTML = `<div><div class="match-teams">${m.home} vs ${m.away}</div><div class="match-competition">${m.type==='group'?'Група '+m.tag: m.type}</div></div>`;
    const right = document.createElement('div'); right.className='match-odds';
    right.innerHTML = `<div class="match-status">Започва: ${new Date(m.startTime).toLocaleString('bg-BG',{hour:'2-digit',minute:'2-digit'})}</div>`;
    const odds = document.createElement('div'); odds.className='match-odds';
    odds.innerHTML = `<button class="odd-button" data-id="${m.id}" data-type="1" data-odd="${m.homeOdd}">${fmt(m.homeOdd)}</button>
                      <button class="odd-button" data-id="${m.id}" data-type="X" data-odd="${m.drawOdd}">${fmt(m.drawOdd)}</button>
                      <button class="odd-button" data-id="${m.id}" data-type="2" data-odd="${m.awayOdd}">${fmt(m.awayOdd)}</button>`;
    div.appendChild(left); div.appendChild(odds); div.appendChild(right);
    el.matchesList.appendChild(div);
  });
  document.querySelectorAll('.odd-button').forEach(b=> b.onclick = (e)=> {
    const id = e.currentTarget.dataset.id; const type = e.currentTarget.dataset.type; const odd = Number(e.currentTarget.dataset.odd);
    const m = findMatchById(id); if(!m) return; addSelectionToBetslip(m.id, m.home, m.away, type, odd);
  });
}

function renderLiveMatches(){
  if(!el.liveList) return;
  const live = getAllMatches().filter(m=>m.status==='На живо').sort((a,b)=> new Date(a.startTime)-new Date(b.startTime));
  if(live.length===0){ el.liveList.innerHTML = '<p class="muted">В момента няма мачове на живо.</p>'; return; }
  el.liveList.innerHTML = '';
  live.forEach(m=>{
    const div = document.createElement('div'); div.className='match-card';
    const left = document.createElement('div'); left.className='match-left';
    left.innerHTML = `<div><div class="match-teams">${m.home} vs ${m.away}</div><div class="match-competition">${m.type==='group'?'Група '+m.tag:m.type}</div></div>`;
    const mid = document.createElement('div'); mid.innerHTML = `<div class="match-score">${m.scoreHome}:${m.scoreAway}</div>`;
    const right = document.createElement('div'); right.className='match-status';
    right.innerHTML = `На живо — ${m.minute}'`;
    div.appendChild(left); div.appendChild(mid); div.appendChild(right);
    el.liveList.appendChild(div);
  });
}

function renderTournamentTables(){
  if(!el.groupsContainer) return;
  el.groupsContainer.innerHTML = '';
  const groups = tournament.groups;
  Object.keys(groups).forEach(g=>{
    // build standings table for group g
    const stats = {};
    groups[g].forEach(t=> stats[t] = {team:t, played:0,w:0,d:0,l:0,gf:0,ga:0,gd:0,pts:0});
    tournament.matches.filter(m=>m.type==='group' && m.tag===g).forEach(m=>{
      const h=m.home, a=m.away, hs=m.scoreHome||0, as=m.scoreAway||0;
      stats[h].played++; stats[a].played++;
      stats[h].gf += hs; stats[h].ga += as; stats[h].gd = stats[h].gf - stats[h].ga;
      stats[a].gf += as; stats[a].ga += hs; stats[a].gd = stats[a].gf - stats[a].ga;
      if(hs>as){ stats[h].w++; stats[h].pts += 3; stats[a].l++; }
      else if(hs<as){ stats[a].w++; stats[a].pts += 3; stats[h].l++; }
      else { stats[h].d++; stats[a].d++; stats[h].pts +=1; stats[a].pts +=1; }
    });
    const arr = Object.values(stats).sort((x,y)=> { if(y.pts!==x.pts) return y.pts-x.pts; if(y.gd!==x.gd) return y.gd-x.gd; return y.gf-x.gf; });
    const box = document.createElement('div'); box.className='group-table';
    let html = `<h4>Група ${g}</h4><table><thead><tr><th>#</th><th>Отбор</th><th>М</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead><tbody>`;
    arr.forEach((row,i)=> html += `<tr><td>${i+1}</td><td>${row.team}</td><td>${row.played}</td><td>${row.w}</td><td>${row.d}</td><td>${row.l}</td><td>${row.gf}</td><td>${row.ga}</td><td>${row.gd}</td><td>${row.pts}</td></tr>`);
    html += '</tbody></table>';
    box.innerHTML = html;
    el.groupsContainer.appendChild(box);
  });
}

function renderBracket(){
  if(!el.bracketContainer) return;
  el.bracketContainer.innerHTML = '';
  // show columns for Round of 16, Quarter, Semi, Final depending on availability
  const stages = [
    {key:'roundOf16', title:'1/8 финал'},
    {key:'quarter', title:'1/4 финал'},
    {key:'semi', title:'Половина (1/2)'},
    {key:'final', title:'Финал'}
  ];
  const columns = document.createElement('div'); columns.style.display='flex'; columns.style.gap='12px'; columns.style.flexWrap='wrap';
  stages.forEach(st=>{
    const arr = tournament.bracket[st.key] || [];
    const col = document.createElement('div'); col.className='bracket-column';
    const heading = document.createElement('h4'); heading.style.color='#ffd66b'; heading.textContent = st.title;
    col.appendChild(heading);
    if(arr.length === 0) {
      const ph = document.createElement('div'); ph.className='bracket-match'; ph.textContent='— няма мачове —'; col.appendChild(ph);
    } else {
      arr.forEach(m=>{
        const box = document.createElement('div'); box.className='bracket-match';
        box.innerHTML = `<div style="font-weight:800">${m.home} vs ${m.away}</div><div style="font-size:0.9rem;color:#9fb0d6">${m.status==='Предстоящ'?'Започва: '+new Date(m.startTime).toLocaleString('bg-BG',{hour:'2-digit',minute:'2-digit'}) : m.status==='На живо'?'На живо — '+m.minute+"'" : 'Резултат: '+(m.scoreHome||0)+':'+(m.scoreAway||0)}</div>`;
        col.appendChild(box);
      });
    }
    columns.appendChild(col);
  });
  el.bracketContainer.appendChild(columns);
}

/* render my bets with live cashout */
function renderMyBets(){
  if(!el.unsettledBetsList || !el.settledBetsList) return;
  const unsettled = activeBets.filter(b=>b.status==='Очакване');
  const settled = activeBets.filter(b=>b.status!=='Очакване');
  if(unsettled.length===0) el.unsettledBetsList.innerHTML = '<tr><td colspan="6">Няма активни залози.</td></tr>';
  else {
    el.unsettledBetsList.innerHTML = unsettled.map(b=>{
      const sels = b.selections.map(s=>`${s.home} vs ${s.away} (${s.type} @ ${fmt(s.odd)})`).join('<br>');
      const liveSelMatches = b.selections.map(s=>findMatchBySel(s)).filter(Boolean);
      let cashHtml = '-';
      if(liveSelMatches.length>0){
        const cashVal = calculateCashOutForBet(b);
        cashHtml = `<div style="display:flex;flex-direction:column;gap:6px;"><div><strong>${fmt(cashVal)}</strong> точки</div><div><button class="action-button cash-btn" data-bet="${b.id}">Cash Out</button></div></div>`;
      }
      return `<tr><td>${b.id}<br><small>${b.timePlaced}</small></td><td style="text-align:left">${sels}</td><td>${fmt(b.totalOdd)}</td><td>${fmt(b.amount)}</td><td>${fmt(b.potentialWin)}</td><td>${cashHtml}</td></tr>`;
    }).join('');
    document.querySelectorAll('.cash-btn').forEach(btn=> btn.onclick = (e)=> {
      const id = e.currentTarget.dataset.bet; const bet = activeBets.find(x=>x.id===id); if(!bet) return;
      const cash = calculateCashOutForBet(bet); userPoints += cash; bet.status = `Cash Out ${fmt(cash)}`; saveCurrentUser(); renderAll();
    });
  }
  el.settledBetsList.innerHTML = settled.length>0 ? settled.map(b=>{
    const sels = b.selections.map(s=>`${s.home} vs ${s.away} (${s.type} @ ${fmt(s.odd)})`).join('<br>');
    return `<tr><td>${b.id}<br><small>${b.timePlaced}</small></td><td style="text-align:left">${sels}</td><td>${fmt(b.totalOdd)}</td><td>${fmt(b.amount)}</td><td>${b.resultText||'-'}</td><td>${b.status}</td></tr>`;
  }).join('') : '<tr><td colspan="6">Няма уредени залози.</td></tr>';
}

/* ranking */
function getRegisteredUsers(){
  const arr=[];
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);
    if(!key) continue;
    if(key.startsWith('user_')){
      try{ const id = key.slice(5); const data = JSON.parse(localStorage.getItem(key)); if(id==='default_user' && data.name==='Гост') continue; arr.push({id,name:data.name||'Неизвестен',points:Number(data.points||0)}); }catch(e){}
    }
  }
  return arr;
}
function renderRanking(){
  if(!el.rankingList) return;
  const list = getRegisteredUsers().sort((a,b)=>b.points-a.points);
  if(list.length===0){ el.rankingList.innerHTML = '<p class="muted">Все още няма регистрирани участници.</p>'; return; }
  const rows = list.map((u,i)=>`<tr class="${u.id===currentUserId?'ranking-user-row':''}"><td>${i+1}</td><td>${u.name}</td><td>—</td><td>—</td><td>${fmt(u.points)}</td></tr>`).join('');
  el.rankingList.innerHTML = `<table class="bets-table"><thead><tr><th>Място</th><th>Име</th><th>W</th><th>L</th><th>Точки</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* --------------- Save / Load user --------------- */
function saveCurrentUser(){
  if(!currentUserId || currentUserId==='default_user'){
    saveUser('default_user',{ name:'Гост', points:userPoints, passwordHash:null, activeBets:[], lastSpinTime:lastSpinTime, details:{} }); return;
  }
  const stored = loadUser(currentUserId) || {};
  stored.name = currentUserName; stored.points = userPoints; stored.activeBets = activeBets; stored.lastSpinTime = lastSpinTime;
  saveUser(currentUserId, stored);
  localStorage.setItem('currentUserId', currentUserId); localStorage.setItem('currentUserName', currentUserName);
}
function loadCurrentUser(){
  ensureGuest();
  const uid = localStorage.getItem('currentUserId') || 'default_user';
  currentUserId = uid;
  const user = loadUser(uid) || loadUser('default_user');
  currentUserName = (user && user.name) || 'Гост';
  userPoints = Number((user && user.points) || 1000);
  activeBets = (user && user.activeBets) || [];
  lastSpinTime = (user && user.lastSpinTime) || null;
}

/* --------------- Wheel --------------- */
function canSpinNow(){ if(!lastSpinTime) return true; return (Date.now()-lastSpinTime) >= COOL_DOWN_MS; }
function spinWheel(){
  if(!canSpinNow()){ if(el.modalWheelResult) el.modalWheelResult.textContent='Колелото е в cooldown.'; return; }
  const rewards=[50,100,150,200,300,400,500,1000]; const reward = rewards[Math.floor(Math.random()*rewards.length)];
  userPoints += reward; lastSpinTime = Date.now(); saveCurrentUser(); if(el.modalWheelResult) el.modalWheelResult.textContent=`Спечелихте ${reward} точки!`; renderAll();
}
function checkWheelUI(){
  const remaining = lastSpinTime ? Math.max(0, COOL_DOWN_MS - (Date.now()-lastSpinTime)) : 0;
  if(el.modalWheelCooldown) el.modalWheelCooldown.textContent = remaining>0 ? `Cooldown: ${Math.floor(remaining/3600000)} ч.` : '';
  if(el.pageWheelResult) el.pageWheelResult.textContent = remaining>0 ? `Cooldown: ${Math.floor(remaining/3600000)} ч.` : '';
  if(el.spinWheelButton) el.spinWheelButton.disabled = remaining>0;
  if(el.spinWheelPageButton) el.spinWheelPageButton.disabled = remaining>0;
}

/* --------------- Utility --------------- */

/* resolve bets when any match finished: already invoked in update loop */

/* --------------- Main render --------------- */
function renderAll(){
  if(el.userPoints) el.userPoints.textContent = fmt(userPoints);
  if(el.userPoints_2) el.userPoints_2.textContent = fmt(userPoints);
  if(el.currentUserNameTop) { el.currentUserNameTop.textContent = currentUserName; if(currentUserId!=='default_user') el.currentUserNameTop.classList.add('logged-user'); else el.currentUserNameTop.classList.remove('logged-user'); }
  if(el.currentUserNameDisplay) el.currentUserNameDisplay.textContent = currentUserName;
  if(el.currentUserNameLogged) el.currentUserNameLogged.textContent = currentUserName;
  renderMatchesUpcoming();
  renderLiveMatches();
  renderTournamentTables();
  renderBracket();
  renderMyBets();
  renderBetslip();
  renderRanking();
  checkWheelUI();
}

/* --------------- Update Loop --------------- */
function startUpdateLoop(){
  if(updateTimer) clearInterval(updateTimer);
  updateTimer = setInterval(()=>{
    updateMatchesAndSimulate();
    // ensure bets resolved for matches that finished
    getAllMatches().forEach(m=>{ if(m.status==='Завършил' && !m._resolved){ onMatchFinished(m); m._resolved = true; } });
    // check auto restart
    if(tournament && tournament.phase === 'finished' && tournament.autoRestartAt && Date.now() >= tournament.autoRestartAt){
      // reset tournament
      localStorage.removeItem('tournamentData');
      initTournamentIfMissing();
    }
    renderAll();
  }, UPDATE_INTERVAL_MS);
}

/* --------------- Auth handlers --------------- */
async function handleRegister(e){ if(e && e.preventDefault) e.preventDefault();
  const username = (el.newUserName && el.newUserName.value || '').trim();
  const password = (el.newPassword && el.newPassword.value || '').trim();
  if(!username || username.length<3) return showAccountMessage('Потребителско име (мин.3)', true);
  if(!password || password.length<4) return showAccountMessage('Парола (мин.4)', true);
  const id = username.toLowerCase().replace(/\s+/g,'_');
  if(loadUser(id)) return showAccountMessage('Потребител вече съществува', true);
  const ph = await hashStringSHA256(password);
  const userObj = { name: username, points:1000, passwordHash:ph, activeBets:[], lastSpinTime:null, details:{} };
  saveUser(id,userObj); showAccountMessage('Успешна регистрация! Влезте.', false);
  if(el.loginUserName) el.loginUserName.value = username;
  if(el.loginPassword) el.loginPassword.value = '';
}
async function handleLogin(e){ if(e && e.preventDefault) e.preventDefault();
  const username = (el.loginUserName && el.loginUserName.value || '').trim();
  const password = (el.loginPassword && el.loginPassword.value || '').trim();
  if(!username || !password) return showAccountMessage('Попълнете полетата', true);
  const id = username.toLowerCase().replace(/\s+/g,'_');
  const stored = loadUser(id);
  if(!stored) return showAccountMessage('Акаунт не съществува', true);
  const ph = await hashStringSHA256(password);
  if(stored.passwordHash !== ph) return showAccountMessage('Грешна парола', true);
  currentUserId = id; currentUserName = stored.name; userPoints = Number(stored.points||1000); activeBets = stored.activeBets || []; lastSpinTime = stored.lastSpinTime || null;
  localStorage.setItem('currentUserId', currentUserId); localStorage.setItem('currentUserName', currentUserName);
  showAccountMessage(`Здравей, ${currentUserName}!`, false); saveCurrentUser(); renderAll();
}
function handleLogout(e){ if(e && e.preventDefault) e.preventDefault();
  saveCurrentUser();
  currentUserId = 'default_user'; currentUserName = 'Гост'; localStorage.removeItem('currentUserId'); localStorage.removeItem('currentUserName');
  loadCurrentUser(); renderAll(); showAccountMessage('Излезохте успешно', false);
}
function showAccountMessage(msg, err=false){ if(!el.accountMessage) return; el.accountMessage.textContent = msg; el.accountMessage.className = err ? 'log error' : 'log success'; setTimeout(()=>{ if(el.accountMessage){ el.accountMessage.textContent=''; el.accountMessage.className='log'; } },4000); }

/* --------------- Init --------------- */
document.addEventListener('DOMContentLoaded', async ()=>{
  ensureGuest(); initTournamentIfMissing(); loadCurrentUser();

  // wire forms/buttons
  if(el.registerForm) el.registerForm.onsubmit = handleRegister;
  if(el.loginForm) el.loginForm.onsubmit = handleLogin;
  if(el.logoutButton) el.logoutButton.onclick = handleLogout;
  if(el.placeBetButton) el.placeBetButton.onclick = placeCombinedBet;
  if(el.openWheelMini) el.openWheelMini.onclick = ()=>{ if(el.wheelModal) el.wheelModal.style.display='block'; checkWheelUI(); };
  if(el.openWheelMini2) el.openWheelMini2.onclick = ()=>{ if(el.wheelModal) el.wheelModal.style.display='block'; checkWheelUI(); };
  if(el.spinWheelButton) el.spinWheelButton.onclick = spinWheel;
  if(el.spinWheelPageButton) el.spinWheelPageButton.onclick = spinWheel;
  el.modalClose.forEach(cb=> cb.onclick = ()=>{ if(el.wheelModal) el.wheelModal.style.display='none'; });

  // menu switching
  document.querySelectorAll('.menu-button').forEach(btn=>{
    btn.onclick = (e)=>{ document.querySelectorAll('.menu-button').forEach(b=>b.classList.remove('active')); e.currentTarget.classList.add('active'); const target = e.currentTarget.dataset.target; document.querySelectorAll('.content-section').forEach(sec=>{ if(sec.id===target) sec.classList.add('active'); else sec.classList.remove('active'); }); };
  });

  // tabs
  document.querySelectorAll('.tab-button').forEach(tab=> {
    tab.onclick = (e)=> { document.querySelectorAll('.tab-button').forEach(t=>t.classList.remove('active')); e.currentTarget.classList.add('active'); const id=e.currentTarget.dataset.tab; document.querySelectorAll('.tab-content').forEach(c=>{ c.classList.remove('active'); if(c.id===id) c.classList.add('active'); }); };
  });

  // betslip amount update
  if(el.betAmountInput) el.betAmountInput.oninput = ()=>{ const amount = safeNumber(el.betAmountInput.value); const tot = calculateTotalOdd(); el.potentialWin.textContent = fmt(amount * tot); };

  // clock
  if(el.realTimeClock) { el.realTimeClock.textContent = new Date().toLocaleTimeString('bg-BG'); setInterval(()=>{ el.realTimeClock.textContent = new Date().toLocaleTimeString('bg-BG'); },1000); }

  // initial render
  renderAll();

  // start update loop
  startUpdateLoop();
});

/* expose some helpers for debugging in console */
window.ImpulseBet = { initTournamentIfMissing, tournament, renderAll, saveCurrentUser, loadCurrentUser, calculateCashOutForBet };
