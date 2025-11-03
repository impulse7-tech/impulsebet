/* script.js — пълен и работещ
   Основни функции:
   - Регистрация + Login (пароли хеширани със SHA-256)
   - Betslip: добавяне/премахване/поставяне на комбиниран залог
   - Симулирани мачове
   - Колело (24h cooldown)
   - Класация
*/

/* -------------------- Помощни функции -------------------- */
const MIN_BET = 10;
const COOL_DOWN_MS = 24 * 60 * 60 * 1000; // 24 часа
let currentUserId = localStorage.getItem('currentUserId') || 'default_user';
let currentUserName = localStorage.getItem('currentUserName') || 'Гост';
let userPoints = 1000;
let lastSpinTime = null;
let matchesData = [];
let betslipSelections = [];
let activeBets = [];
let matchInterval = null;

/* DOM */
const el = {
    // top / global
    userPointsDisplay: document.getElementById('userPoints'),
    userPointsDisplay_2: document.getElementById('userPointsDisplay_2'),
    currentUserName: document.getElementById('currentUserName'),
    currentUserNameDisplay: document.getElementById('currentUserNameDisplay'),
    currentUserNameDisplayLogged: document.getElementById('currentUserNameDisplayLogged'),
    realTimeClock: document.getElementById('realTimeClock'),

    // account
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

    // betting
    matchesList: document.getElementById('matchesList'),
    betslipList: document.getElementById('betslipList'),
    betslipCount: document.getElementById('betslipCount'),
    totalOdd: document.getElementById('totalOdd'),
    potentialWin: document.getElementById('potentialWin'),
    betAmountInput: document.getElementById('combinedBetAmount'),
    placeBetButton: document.getElementById('placeCombinedBetButton'),
    betslipMessage: document.getElementById('betslipMessage'),

    // bets table
    unsettledBetsList: document.getElementById('unsettledBetsList'),
    settledBetsList: document.getElementById('settledBetsList'),

    // ranking
    rankingList: document.getElementById('rankingList'),

    // wheel
    wheelModal: document.getElementById('wheelModal'),
    openWheelModalButton: document.getElementById('openWheelModalButton'),
    openWheelMini: document.getElementById('openWheelMini'),
    spinWheelButton: document.getElementById('spinWheelButton'),
    spinner: document.getElementById('spinner'),
    modalWheelResult: document.getElementById('modalWheelResult'),
    modalWheelCooldown: document.getElementById('modalWheelCooldown'),
    pageWheelResult: document.getElementById('pageWheelResult'),
    modalClose: document.querySelectorAll('.close-button'),
    spinWheelPageButton: document.getElementById('spinWheelPageButton')
};

/* ---------- ВСПОМОГАТЕЛНИ: SHA-256 Хеш (върнат като hex) ---------- */
async function hashStringSHA256(str) {
    const enc = new TextEncoder();
    const data = enc.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

/* ---------- LocalStorage helpers ---------- */
function saveUserDataToStorage(id, data) {
    localStorage.setItem(`user_${id}`, JSON.stringify(data));
}

function loadUserDataFromStorage(id) {
    const raw = localStorage.getItem(`user_${id}`);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (e) {
        console.warn('Corrupt user data', id);
        return null;
    }
}

/* ---------- Инициализация / зареждане на играч ---------- */
function ensureGuestExists() {
    if (!localStorage.getItem('user_default_user')) {
        saveUserDataToStorage('default_user', {
            name: 'Гост',
            points: 1000,
            passwordHash: null,
            activeBets: [],
            lastSpinTime: null,
            details: {}
        });
    }
}

function loadGameData() {
    ensureGuestExists();
    currentUserId = localStorage.getItem('currentUserId') || 'default_user';
    const userData = loadUserDataFromStorage(currentUserId);
    if (!userData) {
        // fallback to guest
        currentUserId = 'default_user';
    }
    const data = loadUserDataFromStorage(currentUserId) || loadUserDataFromStorage('default_user');
    currentUserName = data.name || 'Гост';
    userPoints = Number(data.points || 1000);
    activeBets = data.activeBets || [];
    lastSpinTime = data.lastSpinTime || null;
}

/* ---------- Update UI ---------- */
function formatNumber(n) { return Number(n).toFixed(2); }

function updateDisplay() {
    if (el.userPointsDisplay) el.userPointsDisplay.textContent = formatNumber(userPoints);
    if (el.userPointsDisplay_2) el.userPointsDisplay_2.textContent = formatNumber(userPoints);
    if (el.currentUserName) el.currentUserName.textContent = currentUserName;
    if (el.currentUserNameDisplay) el.currentUserNameDisplay.textContent = currentUserName;
    if (el.currentUserNameDisplayLogged) el.currentUserNameDisplayLogged.textContent = currentUserName;

    const isGuest = currentUserId === 'default_user';
    if (el.loggedInStatus && el.registrationFormArea) {
        el.loggedInStatus.style.display = isGuest ? 'none' : 'block';
        el.registrationFormArea.style.display = isGuest ? 'block' : 'none';
    }

    renderBetslip();
    renderActiveBets();
    renderRanking();

    // 🔹 ДОБАВИ това отдолу:
    if (el.currentUserName) {
        if (currentUserId === 'default_user') {
            el.currentUserName.classList.remove('logged-user');
        } else {
            el.currentUserName.classList.add('logged-user');
        }
    }
}


/* ---------- AUTH: регистрация и вход ---------- */
async function handleRegister(e) {
    if (e && e.preventDefault) e.preventDefault();
    const username = (el.newUserName && el.newUserName.value || '').trim();
    const password = (el.newPassword && el.newPassword.value || '').trim();
    if (!username || username.length < 3) return showAccountMessage('Въведете потребителско име (мин. 3)', true);
    if (!password || password.length < 4) return showAccountMessage('Паролата трябва да е минимум 4 символа', true);

    const id = username.toLowerCase().replace(/\s+/g, '_');
    if (loadUserDataFromStorage(id)) return showAccountMessage('Потребител с това име вече съществува. Моля, влезте или изберете друго име.', true);

    const passHash = await hashStringSHA256(password);
    const userObj = {
        name: username,
        points: 1000,
        passwordHash: passHash,
        activeBets: [],
        lastSpinTime: null,
        details: {
            firstName: el.userFirstName ? el.userFirstName.value.trim() : '',
            lastName: el.userLastName ? el.userLastName.value.trim() : '',
            email: el.userEmail ? el.userEmail.value.trim() : ''
        }
    };
    saveUserDataToStorage(id, userObj);
    showAccountMessage('Успешна регистрация! Можете да влезете с избраното име.', false);
    // prefill login
    if (el.loginUserName) el.loginUserName.value = username;
    if (el.loginPassword) el.loginPassword.value = '';
}

async function handleLogin(e) {
    if (e && e.preventDefault) e.preventDefault();
    const username = (el.loginUserName && el.loginUserName.value || '').trim();
    const password = (el.loginPassword && el.loginPassword.value || '').trim();
    if (!username || !password) return showAccountMessage('Попълнете потребителско име и парола', true);

    const id = username.toLowerCase().replace(/\s+/g, '_');
    const stored = loadUserDataFromStorage(id);
    if (!stored) return showAccountMessage('Такъв акаунт не съществува. Можете да се регистрирате.', true);

    const passHash = await hashStringSHA256(password);
    if (stored.passwordHash !== passHash) return showAccountMessage('Грешна парола.', true);

    // успешен login
    currentUserId = id;
    currentUserName = stored.name || username;
    userPoints = Number(stored.points || 1000);
    activeBets = stored.activeBets || [];
    lastSpinTime = stored.lastSpinTime || null;

    localStorage.setItem('currentUserId', currentUserId);
    localStorage.setItem('currentUserName', currentUserName);

    showAccountMessage(`Здравей, ${currentUserName}!`, false);
    updateDisplay();
}

function handleLogout(e) {
    if (e && e.preventDefault) e.preventDefault();
    // записваме текущия потребител
    saveCurrentUser();
    currentUserId = 'default_user';
    currentUserName = 'Гост';
    userPoints = loadUserDataFromStorage('default_user').points || 1000;
    localStorage.removeItem('currentUserId');
    localStorage.removeItem('currentUserName');
    loadGameData();
    updateDisplay();
    showAccountMessage('Успешен изход.', false);
}

/* ---------- Съобщения за акаунт ---------- */
function showAccountMessage(msg, isError = false) {
    if (!el.accountMessage) return;
    el.accountMessage.textContent = msg;
    el.accountMessage.className = isError ? 'log error' : 'log success';
    setTimeout(() => {
        if (el.accountMessage) { el.accountMessage.textContent = ''; el.accountMessage.className = 'log'; }
    }, 4000);
}

/* ---------- Запис на текущ потребител ---------- */
function saveCurrentUser() {
    if (!currentUserId || currentUserId === 'default_user') {
        // Save guest state
        saveUserDataToStorage('default_user', {
            name: 'Гост',
            points: Number(userPoints || 1000),
            passwordHash: null,
            activeBets: activeBets || [],
            lastSpinTime: lastSpinTime || null,
            details: {}
        });
        return;
    }
    const stored = loadUserDataFromStorage(currentUserId) || {};
    stored.name = currentUserName;
    stored.points = Number(userPoints || stored.points || 1000);
    stored.activeBets = activeBets || stored.activeBets || [];
    stored.lastSpinTime = lastSpinTime || stored.lastSpinTime || null;
    saveUserDataToStorage(currentUserId, stored);
}

/* ---------- Betslip ---------- */
function addSelectionToBetslip(matchId, home, away, type, odd) {
    if (betslipSelections.some(s => s.matchId === matchId && s.type === type)) {
        showBetslipMessage('Вече имате тази селекция в фиша.', true);
        return;
    }
    betslipSelections.push({ matchId, home, away, type, odd: Number(odd) });
    renderBetslip();
    toggleBetslipVisibility(true);
}

function removeSelectionFromBetslip(idx) {
    if (idx < 0 || idx >= betslipSelections.length) return;
    betslipSelections.splice(idx, 1);
    renderBetslip();
    if (betslipSelections.length === 0) toggleBetslipVisibility(false);
}

function calculateTotalOdd() {
    return betslipSelections.reduce((acc, s) => acc * (Number(s.odd) || 1), 1);
}

function renderBetslip() {
    if (!el.betslipList) return;
    el.betslipList.innerHTML = '';
    if (betslipSelections.length === 0) {
        const li = document.createElement('li');
        li.className = 'empty-message';
        li.textContent = 'Няма избрани срещи.';
        el.betslipList.appendChild(li);
        el.totalOdd.textContent = '1.00';
        el.potentialWin.textContent = '0.00';
        el.placeBetButton.disabled = true;
        el.betslipCount.textContent = `(0)`;
        return;
    }

    betslipSelections.forEach((s, i) => {
        const li = document.createElement('li');
        li.className = 'betslip-selection';
        li.innerHTML = `
            <div style="flex:1;text-align:left">
                <div><strong>${s.home} vs ${s.away}</strong></div>
                <div style="font-size:0.9em;color:#556">${s.type} (@ ${Number(s.odd).toFixed(2)})</div>
            </div>
            <div>
                <button class="remove-selection" data-idx="${i}">×</button>
            </div>
        `;
        el.betslipList.appendChild(li);
    });

    el.betslipList.querySelectorAll('.remove-selection').forEach(btn => {
        btn.onclick = (e) => removeSelectionFromBetslip(Number(e.currentTarget.dataset.idx));
    });

    const totalOdd = calculateTotalOdd();
    el.totalOdd.textContent = Number(totalOdd).toFixed(2);
    const amount = Number(el.betAmountInput ? el.betAmountInput.value : MIN_BET) || MIN_BET;
    el.potentialWin.textContent = Number(totalOdd * amount).toFixed(2);
    el.placeBetButton.disabled = false;
    el.betslipCount.textContent = `(${betslipSelections.length})`;
}

function toggleBetslipVisibility(show) {
    if (!document.getElementById('betslipArea')) return;
    document.getElementById('betslipArea').style.display = show ? 'block' : 'block'; // always visible in layout
}

function showBetslipMessage(msg, isError=false) {
    if (!el.betslipMessage) return;
    el.betslipMessage.textContent = msg;
    el.betslipMessage.className = isError ? 'log error' : 'log success';
    setTimeout(()=> { if (el.betslipMessage) { el.betslipMessage.textContent=''; el.betslipMessage.className='log'; } }, 4000);
}

function placeCombinedBet() {
    if (betslipSelections.length === 0) { showBetslipMessage('Изберете поне една среща.', true); return; }
    const amount = Number(el.betAmountInput.value || 0);
    if (isNaN(amount) || amount < MIN_BET) { showBetslipMessage(`Минимален залог ${MIN_BET}`, true); return; }
    if (amount > userPoints) { showBetslipMessage('Нямате достатъчно точки.', true); return; }

    const totalOdd = calculateTotalOdd();
    const potentialWin = amount * totalOdd;
    userPoints -= amount;
    const bet = {
        id: Date.now(),
        timePlaced: new Date().toLocaleString('bg-BG'),
        amount,
        totalOdd,
        potentialWin,
        selections: JSON.parse(JSON.stringify(betslipSelections)),
        status: 'Очакване'
    };
    activeBets.push(bet);
    betslipSelections = [];
    renderBetslip();
    saveCurrentUser();
    updateDisplay();
    showBetslipMessage(`Залог #${bet.id} направен. Потенциал: ${potentialWin.toFixed(2)}`, false);
}

/* ---------- Активни залози (рендер и cash-out) ---------- */
function createBetRow(bet) {
    const showCashOut = bet.status === 'Очакване';
    const sels = bet.selections.map(s => `${s.home} vs ${s.away} (${s.type} @ ${s.odd.toFixed(2)})`).join('<br>');
    const cashBtn = `<button class="action-button cash-out-btn" data-id="${bet.id}">Cash Out (${(bet.amount*0.7).toFixed(2)})</button>`;
    return `
        <tr>
            <td>${bet.id}<br><small>${(bet.timePlaced||'')}</small></td>
            <td style="text-align:left">${sels}</td>
            <td>${bet.totalOdd.toFixed(2)}</td>
            <td>${bet.amount.toFixed(2)}</td>
            <td>${bet.potentialWin.toFixed(2)}</td>
            <td>${showCashOut ? cashBtn : (bet.status||'')}</td>
        </tr>
    `;
}

function renderActiveBets() {
    if (!el.unsettledBetsList || !el.settledBetsList) return;
    const unsettled = activeBets.filter(b => b.status === 'Очакване');
    const settled = activeBets.filter(b => b.status !== 'Очакване');

    el.unsettledBetsList.innerHTML = unsettled.length
        ? unsettled.map(b => createBetRow(b)).join('')
        : '<tr><td colspan="6">Няма активни залози.</td></tr>';

    el.settledBetsList.innerHTML = settled.length
        ? settled.map(b => createBetRow(b)).join('')
        : '<tr><td colspan="6">Няма уредени залози.</td></tr>';

    // cash out handlers
    document.querySelectorAll('.cash-out-btn').forEach(btn=>{
        btn.onclick = (e) => {
            const id = Number(e.currentTarget.dataset.id);
            const bet = activeBets.find(x => x.id === id);
            if (!bet) return;
            const cash = +(bet.amount * 0.7).toFixed(2);
            userPoints += cash;
            bet.status = `Cash Out ${cash.toFixed(2)}`;
            saveCurrentUser();
            updateDisplay();
            showBetslipMessage(`Получи Cash Out ${cash.toFixed(2)} точки`, false);
        };
    });
}

/* ---------- Рендиране класация ---------- */
function getRegisteredUsers() {
    const arr = [];
    for (let i=0;i<localStorage.length;i++){
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith('user_')) {
            try {
                const id = key.slice(5);
                const data = JSON.parse(localStorage.getItem(key));
                if (id === 'default_user' && data.name === 'Гост') continue;
                arr.push({id, name: data.name||'Неизвестен', points: Number(data.points||0), activeBets: data.activeBets||[]});
            } catch(e){ continue; }
        }
    }
    return arr;
}

function renderRanking() {
    if (!el.rankingList) return;
    const list = getRegisteredUsers().sort((a,b)=>b.points-a.points);
    if (list.length === 0) { el.rankingList.innerHTML = `<p class="muted">Все още няма регистрирани потребители.</p>`; return; }
    const rows = list.map((u,idx)=>`<tr class="${u.id===currentUserId?'ranking-user-row':''}"><td>${idx+1}</td><td>${u.name}</td><td>—</td><td>—</td><td>${u.points.toFixed(2)}</td></tr>`).join('');
    el.rankingList.innerHTML = `<table class="bets-table"><thead><tr><th>Място</th><th>Име</th><th>W</th><th>L</th><th>Точки</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* ---------- Мачове / симулация ---------- */
function loadMatches() {
    matchesData = [
        {id:'m1',home:'Левски',away:'ЦСКА',homeOdds:2.1,drawOdds:3.4,awayOdds:3.0},
        {id:'m2',home:'Барселона',away:'Реал Мадрид',homeOdds:2.5,drawOdds:3.2,awayOdds:2.8},
        {id:'m3',home:'Манчестър Юн.',away:'Ливърпул',homeOdds:2.9,drawOdds:3.1,awayOdds:2.4},
        {id:'m4',home:'Байерн',away:'Борусия',homeOdds:1.9,drawOdds:3.6,awayOdds:4.1}
    ];
    renderMatches();
}

function renderMatches() {
    if (!el.matchesList) return;
    el.matchesList.innerHTML = '';
    if (!matchesData || matchesData.length===0) { el.matchesList.innerHTML = '<p class="muted">Няма срещи.</p>'; return; }

    matchesData.forEach(m=>{
        const card = document.createElement('div');
        card.className = 'match-card';
        card.innerHTML = `
            <div class="match-details"><strong>${m.home} vs ${m.away}</strong></div>
            <div class="match-odds">
                <button class="odd-button" data-id="${m.id}" data-type="1" data-odd="${m.homeOdds}">${m.homeOdds.toFixed(2)}</button>
                <button class="odd-button" data-id="${m.id}" data-type="X" data-odd="${m.drawOdds}">${m.drawOdds.toFixed(2)}</button>
                <button class="odd-button" data-id="${m.id}" data-type="2" data-odd="${m.awayOdds}">${m.awayOdds.toFixed(2)}</button>
            </div>
        `;
        el.matchesList.appendChild(card);
    });

    document.querySelectorAll('.odd-button').forEach(b=>{
        b.onclick = (e)=>{
            const btn = e.currentTarget;
            const id = btn.dataset.id;
            const type = btn.dataset.type;
            const odd = Number(btn.dataset.odd);
            const match = matchesData.find(x=>x.id===id);
            if (!match) return;
            addSelectionToBetslip(id, match.home, match.away, type, odd);
        };
    });
}

function startMatchSimulation(){
    stopMatchSimulation();
    matchInterval = setInterval(()=>{
        matchesData.forEach(m=>{
            m.homeOdds = Math.max(1.1, +(m.homeOdds*(0.96 + Math.random()*0.08)).toFixed(2));
            m.drawOdds = Math.max(1.1, +(m.drawOdds*(0.96 + Math.random()*0.08)).toFixed(2));
            m.awayOdds = Math.max(1.1, +(m.awayOdds*(0.96 + Math.random()*0.08)).toFixed(2));
        });
        renderMatches();
        // случайно уредване на един залог (демо)
        if (Math.random() < 0.12 && activeBets.length>0) simulateResolveRandomBet();
    }, 7000);
}

function stopMatchSimulation(){ if (matchInterval){ clearInterval(matchInterval); matchInterval=null; }}

/* ---------- Симулиране уреджане на залози (демо) ---------- */
function simulateResolveRandomBet(){
    // избираме случайно залог в 'Очакване'
    const pending = activeBets.filter(b=>b.status==='Очакване');
    if (pending.length===0) return;
    const bet = pending[Math.floor(Math.random()*pending.length)];
    // случайно: печели или губи
    const win = Math.random() < 0.45;
    if (win){
        bet.status = 'Печеливш';
        const prize = +(bet.potentialWin || (bet.amount * 2)).toFixed(2);
        userPoints += prize;
    } else {
        bet.status = 'Губещ';
    }
    saveCurrentUser();
    updateDisplay();
}

/* ---------- Колело / бонус ---------- */
function canSpinNow() {
    if (!lastSpinTime) return true;
    return (Date.now() - lastSpinTime) >= COOL_DOWN_MS;
}

function checkWheelCooldownUI() {
    if (!el.modalWheelCooldown && !el.pageWheelResult) return;
    if (!lastSpinTime) {
        if (el.modalWheelCooldown) el.modalWheelCooldown.textContent = '';
        if (el.pageWheelResult) el.pageWheelResult.textContent = '';
        if (el.spinWheelButton) el.spinWheelButton.disabled = false;
        if (el.spinWheelPageButton) el.spinWheelPageButton.disabled = false;
        return;
    }
    const remaining = Math.max(0, COOL_DOWN_MS - (Date.now() - lastSpinTime));
    const hrs = Math.floor(remaining / (1000*60*60));
    const mins = Math.floor((remaining % (1000*60*60)) / (1000*60));
    const text = remaining>0 ? `Cooldown: ${hrs} ч. ${mins} мин.` : '';
    if (el.modalWheelCooldown) el.modalWheelCooldown.textContent = text;
    if (el.pageWheelResult) el.pageWheelResult.textContent = text;
    if (el.spinWheelButton) el.spinWheelButton.disabled = remaining>0;
    if (el.spinWheelPageButton) el.spinWheelPageButton.disabled = remaining>0;
}

function spinWheel(rewards=[50,100,150,200,300,400,500,1000]) {
    if (!canSpinNow()) { if (el.modalWheelResult) el.modalWheelResult.textContent='Колелото е в cooldown.'; return; }
    const reward = rewards[Math.floor(Math.random()*rewards.length)];
    // анимация (опростена)
    if (el.spinner) {
        el.spinner.style.transition = 'transform 2s cubic-bezier(.2,.9,.2,1)';
        const deg = 360 * (6 + Math.random()*6) + Math.random()*360;
        el.spinner.style.transform = `rotate(${deg}deg)`;
        setTimeout(()=>{ el.spinner.style.transition=''; el.spinner.style.transform=''; },2200);
    }
    userPoints += reward;
    lastSpinTime = Date.now();
    saveCurrentUser();
    if (el.modalWheelResult) el.modalWheelResult.textContent = `Поздравления! Получихте ${reward} точки.`;
    if (el.pageWheelResult) el.pageWheelResult.textContent = `Спечелено: ${reward} точки.`;
    checkWheelCooldownUI();
    updateDisplay();
}

/* ---------- Часовник ---------- */
function updateClock() {
    if (!el.realTimeClock) return;
    el.realTimeClock.textContent = new Date().toLocaleTimeString('bg-BG');
}

/* ---------- Инициализация на събития и старт ---------- */
document.addEventListener('DOMContentLoaded', async ()=>{
    // ensure guest
    ensureGuestExists();
    loadGameData();
    updateDisplay();
    loadMatches();
    startMatchSimulation();

    // forms
    if (el.registerForm) el.registerForm.onsubmit = handleRegister;
    if (el.loginForm) el.loginForm.onsubmit = handleLogin;
    if (el.logoutButton) el.logoutButton.onclick = handleLogout;

    // place bet
    if (el.placeBetButton) el.placeBetButton.onclick = placeCombinedBet;

    // spin buttons
    if (el.openWheelModalButton) el.openWheelModalButton.onclick = ()=>{ if (el.wheelModal) el.wheelModal.style.display='block'; checkWheelCooldownUI(); };
    if (el.openWheelMini) el.openWheelMini.onclick = ()=>{ if (el.wheelModal) el.wheelModal.style.display='block'; checkWheelCooldownUI(); };
    if (el.spinWheelButton) el.spinWheelButton.onclick = ()=>spinWheel();
    if (el.spinWheelPageButton) el.spinWheelPageButton.onclick = ()=>spinWheel();

    // modal close
    el.modalClose.forEach(cb=>cb.onclick = ()=>{ if (el.wheelModal) el.wheelModal.style.display='none'; });

    // menu buttons to switch sections
    document.querySelectorAll('.menu-button').forEach(btn=>{
        btn.onclick = (e)=>{
            document.querySelectorAll('.menu-button').forEach(b=>b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            const target = e.currentTarget.dataset.target;
            document.querySelectorAll('.content-section').forEach(sec=>{
                if (sec.id === target) sec.classList.add('active'); else sec.classList.remove('active');
            });
            if (target === 'betting-area') startMatchSimulation(); else stopMatchSimulation();
        };
    });

    // tabs for my bets
    document.querySelectorAll('.tab-button').forEach(tab=>{
        tab.onclick = (e)=>{
            document.querySelectorAll('.tab-button').forEach(t=>t.classList.remove('active'));
            e.currentTarget.classList.add('active');
            const tabId = e.currentTarget.dataset.tab;
            document.querySelectorAll('.tab-content').forEach(c=>{ c.classList.remove('active'); if (c.id === tabId) c.classList.add('active'); });
        };
    });

    // amount input updates potential win
    if (el.betAmountInput) el.betAmountInput.oninput = ()=> {
        const amount = Number(el.betAmountInput.value || 0);
        const tot = calculateTotalOdd();
        el.potentialWin.textContent = (amount * tot).toFixed(2);
    };

    // periodic tasks
    updateClock();
    setInterval(updateClock,1000);
    checkWheelCooldownUI();
    setInterval(checkWheelCooldownUI,60000);

    // render once
    renderBetslip();
    renderActiveBets();
    renderRanking();
});

/* ---------- Expose small helpers to console for debugging ---------- */
window.ImpulseDemo = {
    addSelectionToBetslip,
    placeCombinedBet,
    spinWheel,
    saveCurrentUser,
    loadGameData,
    renderRanking
};
