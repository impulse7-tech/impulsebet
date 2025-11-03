/* ImpulseBet — Champions League Edition (frontend-only)
   Features:
   - 32 real teams, groups A-H, then eliminations (R16 -> QF -> SF -> Final)
   - Matches scheduled every round hour; 90 real minutes duration
   - Live matches view (separate), pre-match shown in "Залози"
   - Dynamic live score simulation and events
   - Cash-out dynamic calculation (updates live)
   - User accounts (localStorage), bets, betslip, save/load
   - Auto restart new season 6h after final
*/

/* ================== CONFIG ================== */
const MIN_BET = 10;
const MATCH_DURATION_MIN = 90;
const UPDATE_INTERVAL_MS = 15 * 1000; // update every 15s
const COOL_DOWN_MS = 24 * 60 * 60 * 1000; // wheel cooldown
const AUTO_RESTART_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours after final

/* ================== DOM ================== */
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
  userFirstName: document.getElementById('userFirstName'),
  userLastName: document.getElementById('userLastName'),
  userEmail: document.getElementById('userEmail'),
  accountMessage: document.getElementById('accountMessage'),
  loggedInStatus: document.getElementById('loggedInStatus'),
  registrationFormArea: document.getElementById('registrationFormArea'),
  logoutButton: document.getElementById('logoutButton'),

  // views
  matchesList: document.getElementById('matchesList'),
  liveList: document.getElementById('liveList'),
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

/* ================== STATE ================== */
let currentUserId = localStorage.getItem('currentUserId') || 'default_user';
let currentUserName = localStorage.getItem('currentUserName') || 'Гост';
let userPoints = 1000;
let lastSpinTime = null;

let betslipSelections = [];
let activeBets = []; // bets of current user (loaded)
let tournament = null; // holds groups, bracket, matches
let updateTimer = null;
let matchSimTimer = null;

/* ================== TEAMS (32 real teams) ================== */
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

/* ================== Helpers ================== */
function fmt(n){ return Number(n).toFixed(2); }
function nowMs(){ return Date.now(); }
function safeNumber(v){ const n=Number(v); return isNaN(n)?0:n; }

/* SHA-256 */
async function hashStringSHA256(str){
  const enc = new TextEncoder();
  const data = enc.encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

/* LocalStorage helpers */
function saveUser(key,data){ localStorage.setItem(`user_${key}`, JSON.stringify(data)); }
function loadUser(key){ const raw = localStorage.getItem(`user_${key}`); if(!raw) return null; try{return JSON.parse(raw);}catch(e){return null;} }
function saveTournament(){ localStorage.setItem('tournamentData', JSON.stringify(tournament)); }
function loadTournament(){ const raw = localStorage.getItem('tournamentData'); if(!raw) return null; try{return JSON.parse(raw);}catch(e){return null;} }

/* Initialize guest user */
function ensureGuest(){
  if(!localStorage.getItem('user_default_user')){
    saveUser('default_user',{ name:'Гост', points:1000, passwordHash:null, activeBets:[], lastSpinTime:null, details:{} });
  }
}

/* ================== TOURNAMENT: create groups, schedule matches ================== */
function initTournamentIfMissing(){
  const existing = loadTournament();
  if(existing){
    tournament = existing;
    return;
  }

  // shuffle teams
  const teams = TEAMS.slice();
  for(let i=teams.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [teams[i],teams[j]]=[teams[j],teams[i]]; }

  // 8 groups A-H of 4
  const groups = {};
  const groupNames = ['A','B','C','D','E','F','G','H'];
  let idx=0;
  groupNames.forEach(g=>{
    groups[g]=[];
    for(let k=0;k<4;k++){ groups[g].push(teams[idx++]); }
  });

  // Create matches for group stage: round-robin (each pair)
  const matches = [];
  // We'll schedule matches starting from next round hour, every hour there will be several matches.
  const startBase = nextRoundHour(new Date()); // Date
  let schedulePointer = new Date(startBase).getTime(); // ms
  const msHour = 60*60*1000;

  // for each group, build pairings (6 matches per group)
  groupNames.forEach(g=>{
    const t = groups[g];
    const pairs = [
      [0,1],[2,3],[0,2],[1,3],[0,3],[1,2]
    ];
    pairs.forEach(p=>{
      const start = new Date(schedulePointer); // schedule sequentially across hours
      const match = makeMatch(g, t[p[0]], t[p[1]], start.toISOString(), 'group', g);
      matches.push(match);
      // advance pointer: put multiple matches per hour across groups
      schedulePointer += Math.floor(msHour/2); // half-hour spacing, so multiple matches per hour
    });
  });

  // Build tournament object
  tournament = {
    phase: 'groups',
    groups: groups,
    matches: matches,
    bracket: {
      roundOf16: [],
      quarter: [],
      semi: [],
      final: []
    },
    lastUpdate: Date.now(),
    seasonStart: Date.now(),
    seasonEnd: null,
    autoRestartAt: null
  };

  saveTournament();
}

/* create match object */
function makeMatch(stage, home, away, startISO, type='group', tag=null){
  const start = new Date(startISO);
  const end = new Date(start.getTime() + MATCH_DURATION_MIN*60*1000);
  // odds random reasonable
  const homeOdd = +(1.6 + Math.random()*1.8).toFixed(2);
  const drawOdd = +(2.8 + Math.random()*1.0).toFixed(2);
  const awayOdd = +(1.8 + Math.random()*1.8).toFixed(2);
  // precompute random goal times (sparse) — realistic: 0-90
  const goals = [];
  const goalCount = Math.random() < 0.55 ? Math.floor(Math.random()*4) : Math.floor(Math.random()*2); // 0-3 usually
  for(let i=0;i<goalCount;i++){
    const t = Math.floor(1 + Math.random()*89);
    goals.push(t);
  }
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
    goalTimes: goals, // times (minutes) when goals will happen; will be randomly assigned to teams as simulation runs
    assignedGoalTeams: [], // filled dynamically
    events: []
  };
}

/* get next round hour Date object */
function nextRoundHour(d){
  const dd = new Date(d);
  dd.setMinutes(0,0,0);
  if(dd.getTime() <= d.getTime()) dd.setHours(dd.getHours()+1);
  return dd;
}

/* ================== Match status updater / simulator ================== */
function updateMatchesAndSimulate(){
  if(!tournament) return;
  const now = Date.now();
  let changed = false;

  tournament.matches.forEach(match=>{
    const start = new Date(match.startTime).getTime();
    const end = new Date(match.endTime).getTime();

    if(now < start){
      if(match.status !== 'Предстоящ'){ match.status='Предстоящ'; match.minute=0; changed = true; }
    } else if(now >= start && now < end){
      // live
      const elapsedMs = now - start;
      const minute = Math.min(MATCH_DURATION_MIN, Math.floor(elapsedMs/60000));
      if(match.status !== 'На живо'){ match.status='На живо'; changed = true; }
      if(minute !== match.minute){
        match.minute = minute;
        changed = true;
        // Check for goals that should occur at this minute
        // assign random team for each matching goal time
        while(match.goalTimes.length && match.goalTimes[0] <= minute){
          const gmin = match.goalTimes.shift();
          // randomly choose scoring team biased slightly by odds: lower odd => stronger
          const weightHome = 1/(match.homeOdd);
          const weightAway = 1/(match.awayOdd);
          const total = weightHome + weightAway;
          const r = Math.random()*total;
          const teamScored = (r < weightHome) ? 'home' : 'away';
          if(teamScored === 'home') match.scoreHome++;
          else match.scoreAway++;
          // add event
          const ev = {type:'goal', minute:gmin, team:teamScored, score:[match.scoreHome,match.scoreAway]};
          match.events.push(ev);
        }
      }
    } else if(now >= end){
      if(match.status !== 'Завършил'){ match.status='Завършил'; match.minute = MATCH_DURATION_MIN; changed = true; }
    }
  });

  // If group stage finished (all group matches finished), progress to next phase
  if(tournament.phase === 'groups'){
    const anyPending = tournament.matches.some(m=>m.type==='group' && m.status!=='Завършил');
    if(!anyPending){
      // compute group tables and advance top2 from each group to Round of 16
      buildBracketFromGroups();
      tournament.phase = 'roundOf16';
      // schedule roundOf16 matches starting at next round hour + 1 hour
      scheduleBracketMatches('roundOf16');
      changed = true;
    }
  } else if(tournament.phase === 'roundOf16'){
    const anyPending = tournament.bracket.roundOf16.some(m=>m.status!=='Завършил');
    if(!anyPending && tournament.bracket.roundOf16.length>0){
      tournament.phase='quarter';
      scheduleBracketMatches('quarter');
      changed = true;
    }
  } else if(tournament.phase === 'quarter'){
    const anyPending = tournament.bracket.quarter.some(m=>m.status!=='Завършил');
    if(!anyPending && tournament.bracket.quarter.length>0){
      tournament.phase='semi';
      scheduleBracketMatches('semi');
      changed = true;
    }
  } else if(tournament.phase === 'semi'){
    const anyPending = tournament.bracket.semi.some(m=>m.status!=='Завършил');
    if(!anyPending && tournament.bracket.semi.length>0){
      tournament.phase='final';
      scheduleBracketMatches('final');
      changed = true;
    }
  } else if(tournament.phase === 'final'){
    const anyPending = tournament.bracket.final.some(m=>m.status!=='Завършил');
    if(!anyPending && tournament.bracket.final.length>0){
      // tournament finished
      tournament.phase='finished';
      tournament.seasonEnd = Date.now();
      tournament.autoRestartAt = Date.now() + AUTO_RESTART_AFTER_MS;
      changed = true;
      // award champion etc (no need for complexity here)
    }
  }

  if(changed) { tournament.lastUpdate = Date.now(); saveTournament(); renderAll(); }
}

/* build group tables and bracket */
function buildBracketFromGroups(){
  // compute standings per group: simple metric points (3/1/0), then goal diff, then goals
  const groupStandings = {};
  const groups = tournament.groups;
  // initialize
  Object.keys(groups).forEach(g=>{
    groupStandings[g] = {};
    groups[g].forEach(team=>{ groupStandings[g][team] = {team, points:0, gf:0, ga:0, gd:0}; });
  });

  // accumulate results from group matches
  tournament.matches.filter(m=>m.type==='group').forEach(match=>{
    const g = match.tag; // group
    if(!g) return;
    const home = match.home, away = match.away;
    const hs = match.scoreHome||0, as = match.scoreAway||0;
    groupStandings[g][home].gf += hs; groupStandings[g][home].ga += as; groupStandings[g][home].gd = groupStandings[g][home].gf - groupStandings[g][home].ga;
    groupStandings[g][away].gf += as; groupStandings[g][away].ga += hs; groupStandings[g][away].gd = groupStandings[g][away].gf - groupStandings[g][away].ga;
    if(hs>as){ groupStandings[g][home].points += 3; }
    else if(hs<as){ groupStandings[g][away].points += 3; }
    else { groupStandings[g][home].points +=1; groupStandings[g][away].points +=1; }
  });

  // build bracket: top2 from each group
  const roundOf16 = [];
  // For deterministic pairing, use common UCL mapping A1 vs B2, C1 vs D2, E1 vs F2, G1 vs H2, B1 vs A2, D1 vs C2, F1 vs E2, H1 vs G2
  const mapping = [
    ['A','B'],['C','D'],['E','F'],['G','H'],
    ['B','A'],['D','C'],['F','E'],['H','G']
  ];
  const groupNames = Object.keys(groups);
  // sort each group
  const winners = {};
  groupNames.forEach(g=>{
    const arr = Object.values(groupStandings[g]);
    arr.sort((a,b)=> {
      if(b.points!==a.points) return b.points-a.points;
      if(b.gd!==a.gd) return b.gd-a.gd;
      return b.gf - a.gf;
    });
    winners[g] = arr;
  });

  mapping.forEach(pair=>{
    const g1 = pair[0], g2 = pair[1];
    const team1 = winners[g1][0].team;
    const team2 = winners[g2][1].team;
    // make match object with start time later
    roundOf16.push(makeMatch('knockout', team1, team2, nextRoundHour(new Date(Date.now()+2*60*60*1000)).toISOString(), 'roundOf16', null));
  });

  tournament.bracket.roundOf16 = roundOf16;
}

/* schedule bracket matches; simple spacing: each match an hour apart starting next round hour */
function scheduleBracketMatches(stage){
  const list = tournament.bracket[stage] || [];
  const start = nextRoundHour(new Date(Date.now()+1*60*60*1000));
  let ptr = start.getTime();
  list.forEach((m,i)=>{
    m.startTime = new Date(ptr + i*60*60*1000).toISOString();
    m.endTime = new Date(ptr + i*60*60*1000 + MATCH_DURATION_MIN*60*1000).toISOString();
    m.status = 'Предстоящ';
    m.minute = 0;
    m.scoreHome = 0; m.scoreAway = 0; m.events = []; m.goalTimes = [];
    // assign new goalTimes
    const gcount = Math.random()<0.5?Math.floor(Math.random()*4):Math.floor(Math.random()*2);
    for(let k=0;k<gcount;k++){ m.goalTimes.push(Math.floor(1+Math.random()*89)); }
    m.goalTimes.sort((a,b)=>a-b);
  });
  saveTournament();
}

/* ================== Rendering ================== */
function renderMatchesUpcoming(){
  if(!el.matchesList) return;
  const upcoming = tournament.matches.filter(m=>m.status==='Предстоящ').slice(0,30);
  if(upcoming.length===0){ el.matchesList.innerHTML = '<p class="muted">Няма предстоящи мачове за момента.</p>'; return; }
  el.matchesList.innerHTML = '';
  upcoming.forEach(m=>{
    const div = document.createElement('div'); div.className='match-card';
    const left = document.createElement('div'); left.className='match-left';
    left.innerHTML = `<div><div class="match-teams">${m.home} vs ${m.away}</div><div class="match-competition">${m.type === 'group' ? 'Група '+m.tag : (m.type || '')}</div></div>`;
    const right = document.createElement('div'); right.className='match-odds';
    right.innerHTML = `<div class="match-status">Започва: ${new Date(m.startTime).toLocaleString('bg-BG', {hour: '2-digit', minute:'2-digit'})}</div>`;
    div.appendChild(left); div.appendChild(right);
    // odds to add to betslip
    const odds = document.createElement('div'); odds.className='match-odds';
    odds.innerHTML = `<button class="odd-button" data-id="${m.id}" data-type="1" data-odd="${m.homeOdd}">${fmt(m.homeOdd)}</button>
                      <button class="odd-button" data-id="${m.id}" data-type="X" data-odd="${m.drawOdd}">${fmt(m.drawOdd)}</button>
                      <button class="odd-button" data-id="${m.id}" data-type="2" data-odd="${m.awayOdd}">${fmt(m.awayOdd)}</button>`;
    div.appendChild(odds);
    el.matchesList.appendChild(div);
  });
  // attach handlers
  document.querySelectorAll('.odd-button').forEach(b=>{
    b.onclick = (e)=>{
      const id = e.currentTarget.dataset.id;
      const type = e.currentTarget.dataset.type;
      const odd = Number(e.currentTarget.dataset.odd);
      const m = findMatchById(id);
      if(!m) return;
      addSelectionToBetslip(m.id, m.home, m.away, type, odd);
    };
  });
}

function renderLiveMatches(){
  if(!el.liveList) return;
  const live = tournament.matches.filter(m=>m.status==='На живо').concat(
    (tournament.bracket.roundOf16||[]).filter(m=>m.status==='На живо'),
    (tournament.bracket.quarter||[]).filter(m=>m.status==='На живо'),
    (tournament.bracket.semi||[]).filter(m=>m.status==='На живо'),
    (tournament.bracket.final||[]).filter(m=>m.status==='На живо')
  );
  if(live.length===0){ el.liveList.innerHTML = '<p class="muted">В момента няма мачове на живо.</p>'; return; }
  el.liveList.innerHTML = '';
  live.forEach(m=>{
    const div = document.createElement('div'); div.className='match-card';
    const left = document.createElement('div'); left.className='match-left';
    left.innerHTML = `<div>
      <div class="match-teams">${m.home} vs ${m.away}</div>
      <div class="match-competition">${m.type==='group'?'Група '+m.tag: (m.type || '')}</div>
    </div>`;
    const mid = document.createElement('div'); mid.innerHTML = `<div class="match-score">${m.scoreHome}:${m.scoreAway}</div>`;
    const right = document.createElement('div'); right.className='match-status';
    right.innerHTML = `На живо — ${m.minute}'`;
    div.appendChild(left); div.appendChild(mid); div.appendChild(right);
    el.liveList.appendChild(div);
  });
}

/* my bets rendering with live cashout */
function renderMyBets(){
  if(!el.unsettledBetsList || !el.settledBetsList) return;
  const unsettled = activeBets.filter(b=>b.status==='Очакване');
  const settled = activeBets.filter(b=>b.status!=='Очакване');
  if(unsettled.length===0) el.unsettledBetsList.innerHTML = '<tr><td colspan="6">Няма активни залози.</td></tr>';
  else{
    el.unsettledBetsList.innerHTML = unsettled.map(b=>{
      const sels = b.selections.map(s=>`${s.home} vs ${s.away} (${s.type} @ ${fmt(s.odd)})`).join('<br>');
      // If any selection is live, compute cashout
      let cashHtml = '-';
      const liveSelMatches = b.selections.map(s=>findMatchBySel(s)).filter(Boolean);
      if(liveSelMatches.length>0){
        // compute combined cashout as product of per-match multipliers (approx)
        const cashVal = calculateCashOutForBet(b);
        cashHtml = `<div style="display:flex;flex-direction:column;gap:6px;">
                      <div><strong>${fmt(cashVal)}</strong> точки</div>
                      <div><button class="action-button cash-btn" data-bet="${b.id}">Cash Out</button></div>
                    </div>`;
      } else {
        cashHtml = '—';
      }
      return `<tr>
        <td>${b.id}<br><small>${b.timePlaced}</small></td>
        <td style="text-align:left">${sels}</td>
        <td>${fmt(b.totalOdd)}</td>
        <td>${fmt(b.amount)}</td>
        <td>${fmt(b.potentialWin)}</td>
        <td>${cashHtml}</td>
      </tr>`;
    }).join('');
    // attach cash handlers
    document.querySelectorAll('.cash-btn').forEach(btn=>{
      btn.onclick = (e)=>{
        const id = e.currentTarget.dataset.bet;
        const bet = activeBets.find(x=>x.id==id);
        if(!bet) return;
        const cash = calculateCashOutForBet(bet);
        userPoints += cash;
        bet.status = `Cash Out ${fmt(cash)}`;
        saveCurrentUser();
        renderAll();
      };
    });
  }

  el.settledBetsList.innerHTML = settled.length>0 ? settled.map(b=>{
    const sels = b.selections.map(s=>`${s.home} vs ${s.away} (${s.type} @ ${fmt(s.odd)})`).join('<br>');
    return `<tr>
      <td>${b.id}<br><small>${b.timePlaced}</small></td>
      <td style="text-align:left">${sels}</td>
      <td>${fmt(b.totalOdd)}</td>
      <td>${fmt(b.amount)}</td>
      <td>${b.resultText || '-'}</td>
      <td>${b.status}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="6">Няма уредени залози.</td></tr>';
}

/* find match by id across groups/bracket */
function findMatchById(id){
  let m = tournament.matches.find(x=>x.id===id);
  if(m) return m;
  for(const key of ['roundOf16','quarter','semi','final']){
    const arr = tournament.bracket[key]||[];
    const mm = arr.find(x=>x.id===id);
    if(mm) return mm;
  }
  return null;
}

/* find match by selection (matchId stored or by home/away) */
function findMatchBySel(sel){
  return findMatchById(sel.matchId) || tournament.matches.find(m=>m.home===sel.home && m.away===sel.away);
}

/* calculate cashout for a bet (combining selections) */
function calculateCashOutForBet(bet){
  // For each selection that is live, compute multiplier for that selection;
  // combine them multiplicatively and apply to stake.
  let base = bet.amount;
  let combinedMult = 1;
  for(const sel of bet.selections){
    const match = findMatchBySel(sel);
    if(!match) { combinedMult *= sel.odd; continue; }
    if(match.status !== 'На живо'){ combinedMult *= sel.odd; continue; }
    // determine advantage: + if bet aligns with team leading
    const youBetHome = (sel.type === '1');
    const advantage = (match.scoreHome - match.scoreAway) * (youBetHome ? 1 : -1);
    const progress = match.minute / MATCH_DURATION_MIN;
    let multiplier = 1;
    if(advantage > 0) multiplier = 1 + 0.5 * (1 - progress); // early lead => bigger premium
    else if(advantage === 0) multiplier = 1 - 0.2 * progress; // equal => slightly less
    else multiplier = Math.max(0.2, 0.5 - 0.3 * progress); // losing => small
    // to keep cashout conservative, apply factor relative to original odd
    const implied = sel.odd;
    const selCashMult = Math.max(0.2, Math.min(2.0, multiplier * (implied/2))); // clamp
    combinedMult *= selCashMult;
  }
  // return value
  const cash = Math.max( Math.round(base * combinedMult * 100)/100, base*0.2 );
  return Math.max(0, cash);
}

/* render betslip */
function renderBetslip(){
  if(!el.betslipList) return;
  el.betslipList.innerHTML = '';
  if(betslipSelections.length===0){
    const li = document.createElement('li'); li.className='empty-message'; li.textContent='Няма избрани срещи.'; el.betslipList.appendChild(li);
    el.totalOdd.textContent='1.00'; el.potentialWin.textContent='0.00'; el.placeBetButton.disabled=true; el.betslipCount.textContent='(0)';
    return;
  }
  betslipSelections.forEach((s,i)=>{
    const li = document.createElement('li'); li.className='betslip-selection';
    li.innerHTML = `<div style="flex:1;text-align:left"><div><strong>${s.home} vs ${s.away}</strong></div><div style="font-size:0.9em;color:#9fb0d6">${s.type} (@ ${fmt(s.odd)})</div></div><div><button class="remove-selection" data-idx="${i}">×</button></div>`;
    el.betslipList.appendChild(li);
  });
  el.betslipList.querySelectorAll('.remove-selection').forEach(btn=> btn.onclick = (e)=>{ const idx=Number(e.currentTarget.dataset.idx); betslipSelections.splice(idx,1); renderBetslip(); });
  const totalOdd = betslipSelections.reduce((acc,s)=>acc * (s.odd||1),1);
  const amount = safeNumber(el.betAmountInput ? el.betAmountInput.value : MIN_BET);
  el.totalOdd.textContent = fmt(totalOdd);
  el.potentialWin.textContent = fmt(amount * totalOdd);
  el.placeBetButton.disabled = false;
  el.betslipCount.textContent = `(${betslipSelections.length})`;
}

/* add selection */
function addSelectionToBetslip(matchId, home, away, type, odd){
  if(betslipSelections.some(s=>s.matchId===matchId && s.type===type)){ showBetslipMsg('Вече имате тази селекция в фиша.',true); return; }
  betslipSelections.push({ matchId, home, away, type, odd });
  renderBetslip();
}

/* show betslip message */
function showBetslipMsg(msg, err=false){
  if(!el.betslipMessage) return;
  el.betslipMessage.textContent = msg; el.betslipMessage.className = err? 'log error':'log success';
  setTimeout(()=>{ if(el.betslipMessage){ el.betslipMessage.textContent=''; el.betslipMessage.className='log'; } },4000);
}

/* place combined bet */
function placeCombinedBet(){
  if(betslipSelections.length===0){ showBetslipMsg('Изберете поне една среща.',true); return; }
  const amount = safeNumber(el.betAmountInput.value);
  if(amount < MIN_BET){ showBetslipMsg(`Минимален залог ${MIN_BET}`,true); return; }
  if(amount > userPoints){ showBetslipMsg('Нямате достатъчно точки.',true); return; }
  const totalOdd = betslipSelections.reduce((acc,s)=>acc*(s.odd||1),1);
  const potentialWin = amount * totalOdd;
  userPoints -= amount;
  const bet = {
    id: 'b_'+Date.now(),
    timePlaced: new Date().toLocaleString('bg-BG'),
    amount, totalOdd, potentialWin,
    selections: JSON.parse(JSON.stringify(betslipSelections)),
    status: 'Очакване',
    resultText: null
  };
  activeBets.push(bet);
  saveCurrentUser();
  betslipSelections = [];
  renderBetslip(); renderAll();
  showBetslipMsg(`Залог ${bet.id} е направен. Потенциал: ${fmt(potentialWin)}`, false);
}

/* resolve bets when matches finish */
function resolveBetsOnMatchFinish(m){
  // go through activeBets and check if any bet includes this match; if all selections resolved, mark bet
  activeBets.forEach(b=>{
    if(b.status !== 'Очакване') return;
    const involved = b.selections.map(s=>findMatchBySel(s)).filter(Boolean);
    // if any involved match is still not finished -> skip
    if(involved.some(im=>im.status !== 'Завършил')) return;
    // all involved finished -> determine outcome
    let won = true;
    for(const sel of b.selections){
      const mm = findMatchBySel(sel);
      if(!mm){ won = false; break; }
      // determine selection result
      const home = mm.scoreHome, away = mm.scoreAway;
      if(sel.type === '1' && home <= away) { won = false; break; }
      if(sel.type === '2' && away <= home) { won = false; break; }
      if(sel.type === 'X' && home !== away) { won = false; break; }
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

/* when any match becomes finished, call resolveBetsOnMatchFinish */
function onMatchFinished(m){
  resolveBetsOnMatchFinish(m);
}

/* ================== user save/load ================== */
function saveCurrentUser(){
  // save current user's points and bets to localStorage
  if(!currentUserId || currentUserId==='default_user'){
    saveUser('default_user', { name:'Гост', points:userPoints, passwordHash:null, activeBets:[], lastSpinTime:lastSpinTime, details:{} });
    return;
  }
  const stored = loadUser(currentUserId) || {};
  stored.name = currentUserName;
  stored.points = userPoints;
  stored.activeBets = activeBets;
  stored.lastSpinTime = lastSpinTime;
  saveUser(currentUserId, stored);
  // update currentUserName in storage
  localStorage.setItem('currentUserId', currentUserId);
  localStorage.setItem('currentUserName', currentUserName);
}

/* load current user's data */
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

/* ================== wheel (kept simple) ================== */
function canSpinNow(){ if(!lastSpinTime) return true; return (Date.now() - lastSpinTime) >= COOL_DOWN_MS; }
function spinWheel(){
  if(!canSpinNow()){ if(el.modalWheelResult) el.modalWheelResult.textContent='Колелото е в cooldown.'; return; }
  const rewards = [50,100,150,200,300,400,500,1000];
  const reward = rewards[Math.floor(Math.random()*rewards.length)];
  userPoints += reward; lastSpinTime = Date.now();
  saveCurrentUser(); if(el.modalWheelResult) el.modalWheelResult.textContent=`Спечелихте ${reward} точки!`; renderAll();
}
function checkWheelUI(){
  const remaining = lastSpinTime ? Math.max(0, COOL_DOWN_MS - (Date.now()-lastSpinTime)) : 0;
  if(el.modalWheelCooldown) el.modalWheelCooldown.textContent = remaining>0 ? `Cooldown: ${Math.floor(remaining/3600000)} ч.` : '';
  if(el.pageWheelResult) el.pageWheelResult.textContent = remaining>0 ? `Cooldown: ${Math.floor(remaining/3600000)} ч.` : '';
  if(el.spinWheelButton) el.spinWheelButton.disabled = remaining>0;
  if(el.spinWheelPageButton) el.spinWheelPageButton.disabled = remaining>0;
}

/* ================== Render all main UI ================== */
function renderAll(){
  // top
  if(el.userPoints) el.userPoints.textContent = fmt(userPoints);
  if(el.userPoints_2) el.userPoints_2.textContent = fmt(userPoints);
  if(el.currentUserNameTop) { el.currentUserNameTop.textContent = currentUserName; if(currentUserId!=='default_user') el.currentUserNameTop.classList.add('logged-user'); else el.currentUserNameTop.classList.remove('logged-user'); }
  if(el.currentUserNameDisplay) el.currentUserNameDisplay.textContent = currentUserName;
  if(el.currentUserNameLogged) el.currentUserNameLogged.textContent = currentUserName;
  // matches
  renderMatchesUpcoming();
  renderLiveMatches();
  // bets
  renderMyBets();
  // betslip
  renderBetslip();
  // ranking
  renderRanking();
  checkWheelUI();
}

/* ranking: list all users by points */
function getRegisteredUsers(){
  const arr = [];
  for(let i=0;i<localStorage.length;i++){
    const key = localStorage.key(i);
    if(!key) continue;
    if(key.startsWith('user_')){
      try{
        const id = key.slice(5);
        const data = JSON.parse(localStorage.getItem(key));
        if(id==='default_user' && data.name==='Гост') continue;
        arr.push({ id, name: data.name||'Неизвестен', points: Number(data.points||0) });
      }catch(e){ }
    }
  }
  return arr;
}
function renderRanking(){
  if(!el.rankingList) return;
  const list = getRegisteredUsers().sort((a,b)=>b.points - a.points);
  if(list.length===0){ el.rankingList.innerHTML = '<p class="muted">Все още няма регистрирани участници.</p>'; return; }
  const rows = list.map((u,i)=>`<tr class="${u.id===currentUserId?'ranking-user-row':''}"><td>${i+1}</td><td>${u.name}</td><td>—</td><td>—</td><td>${fmt(u.points)}</td></tr>`).join('');
  el.rankingList.innerHTML = `<table class="bets-table"><thead><tr><th>Място</th><th>Име</th><th>W</th><th>L</th><th>Точки</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* ================== find match helpers for bracket arrays ================== */
function getAllMatches(){
  let arr = tournament.matches.slice();
  ['roundOf16','quarter','semi','final'].forEach(k=>{ if(tournament.bracket[k]) arr = arr.concat(tournament.bracket[k]); });
  return arr;
}

/* ================== auth handlers ================== */
async function handleRegister(e){
  if(e && e.preventDefault) e.preventDefault();
  const username = (el.newUserName && el.newUserName.value || '').trim();
  const password = (el.newPassword && el.newPassword.value || '').trim();
  if(!username || username.length<3) return showAccountMessage('Потребителско име (мин.3)', true);
  if(!password || password.length<4) return showAccountMessage('Парола (мин.4)', true);
  const id = username.toLowerCase().replace(/\s+/g,'_');
  if(loadUser(id)) return showAccountMessage('Потребител вече съществува', true);
  const ph = await hashStringSHA256(password);
  const userObj = { name: username, points:1000, passwordHash:ph, activeBets:[], lastSpinTime:null, details:{ firstName:el.userFirstName.value||'', lastName:el.userLastName.value||'', email:el.userEmail.value||'' } };
  saveUser(id,userObj); showAccountMessage('Успешна регистрация! Влезте.', false);
  if(el.loginUserName) el.loginUserName.value = username;
  if(el.loginPassword) el.loginPassword.value = '';
}
async function handleLogin(e){
  if(e && e.preventDefault) e.preventDefault();
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
  showAccountMessage(`Здравей, ${currentUserName}!`, false);
  saveCurrentUser(); renderAll();
}
function handleLogout(e){
  if(e && e.preventDefault) e.preventDefault();
  saveCurrentUser();
  currentUserId = 'default_user'; currentUserName = 'Гост'; localStorage.removeItem('currentUserId'); localStorage.removeItem('currentUserName');
  loadCurrentUser(); renderAll(); showAccountMessage('Излезохте успешно', false);
}
function showAccountMessage(msg, err=false){
  if(!el.accountMessage) return; el.accountMessage.textContent = msg; el.accountMessage.className = err ? 'log error' : 'log success';
  setTimeout(()=>{ if(el.accountMessage){ el.accountMessage.textContent=''; el.accountMessage.className='log'; } },4000);
}

/* ================== utility: find match by selection object ================== */
function findMatchBySel(sel){
  return getAllMatches().find(m=>m.id===sel.matchId) || getAllMatches().find(m=>m.home===sel.home && m.away===sel.away);
}

/* ================== periodic update loop ================== */
function startUpdateLoop(){
  if(updateTimer) clearInterval(updateTimer);
  updateTimer = setInterval(()=>{
    updateMatchesAndSimulate();
    // after update, for any matches finished, resolve bets
    getAllMatches().forEach(m=>{ if(m.status==='Завършил' && !m._resolved){ onMatchFinished(m); m._resolved = true; } });
    renderAll();
  }, UPDATE_INTERVAL_MS);
}

/* ================== end-season auto restart ================== */
function checkAutoRestart(){
  if(tournament && tournament.phase==='finished' && tournament.autoRestartAt){
    if(Date.now() >= tournament.autoRestartAt){
      // reset tournament
      initTournamentIfMissing(); // this will skip if existing; so force recreate
      // create brand new tournament
      localStorage.removeItem('tournamentData');
      initTournamentIfMissing();
      renderAll();
    }
  }
}

/* ================== init ================== */
document.addEventListener('DOMContentLoaded', async ()=>{
  ensureGuest();
  initTournamentIfMissing();
  loadCurrentUser();

  // wire up forms/buttons
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
    btn.onclick = (e)=>{
      document.querySelectorAll('.menu-button').forEach(b=>b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      const target = e.currentTarget.dataset.target;
      document.querySelectorAll('.content-section').forEach(sec=>{ if(sec.id===target) sec.classList.add('active'); else sec.classList.remove('active'); });
    };
  });

  // tabs
  document.querySelectorAll('.tab-button').forEach(tab=>{
    tab.onclick = (e)=>{ document.querySelectorAll('.tab-button').forEach(t=>t.classList.remove('active')); e.currentTarget.classList.add('active'); const id=e.currentTarget.dataset.tab; document.querySelectorAll('.tab-content').forEach(c=>{ c.classList.remove('active'); if(c.id===id) c.classList.add('active'); }); };
  });

  // betslip amount update
  if(el.betAmountInput) el.betAmountInput.oninput = ()=>{ const amount = safeNumber(el.betAmountInput.value); const tot = betslipSelections.reduce((acc,s)=>acc*(s.odd||1),1); el.potentialWin.textContent = fmt(amount*tot); };

  // initial render
  renderAll();

  // start update loop
  startUpdateLoop();

  // clock
  setInterval(()=>{ if(el.realTimeClock) el.realTimeClock.textContent = new Date().toLocaleTimeString('bg-BG'); },1000);

  // resolve finished matches when loop runs
});

/* expose small helpers for debugging */
window.ImpulseBet = { tournament, renderAll, initTournamentIfMissing, loadTournament, saveCurrentUser, calculateCashOutForBet };

