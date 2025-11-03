// --- Глобални Променливи ---
let userPoints = 1000;
let betslipSelections = [];
const MIN_BET = 10;
// Колелото се върти в Петък от 12:00 ч. (10:00 UTC)
const COOLDOWN_DURATION = 7 * 24 * 60 * 60 * 1000; // Вече няма значение, използваме проверка за Петък
const FRIDAY_SPIN_HOUR = 12; // 12:00 часа
let lastSpinTime = null;
let matchesData = [];
let activeBets = [];
let matchInterval;

// --- DOM Елементи ---
const elements = {
    userPointsDisplay: document.getElementById('userPoints'),
    menuButtons: document.querySelectorAll('.menu-button'),
    contentSections: document.querySelectorAll('.content-section'),
    matchesList: document.getElementById('matchesList'),
    betslipList: document.getElementById('betslipList'),
    totalOddDisplay: document.getElementById('totalOdd'),
    potentialWinDisplay: document.getElementById('potentialWin'),
    betAmountInput: document.getElementById('combinedBetAmount'),
    placeBetButton: document.getElementById('placeCombinedBetButton'),
    betslipMessage: document.getElementById('betslipMessage'),
    wheelModal: document.getElementById('wheelModal'),
    openWheelButton: document.getElementById('openWheelModalButton'),
    closeButtons: document.querySelectorAll('.close-button'),
    spinButton: document.getElementById('spinWheelButton'),
    modalWheelResult: document.getElementById('modalWheelResult'),
    modalWheelCooldown: document.getElementById('modalWheelCooldown'),
    unsettledBetsList: document.getElementById('unsettledBetsList'), 
    settledBetsList: document.getElementById('settledBetsList'),     
    spinner: document.getElementById('spinner'),
    realTimeClock: document.getElementById('realTimeClock'),
    betslipArea: document.getElementById('betslipArea') // Добавяме фиша
};

// --- Инициализация ---
document.addEventListener('DOMContentLoaded', () => {
    loadGameData();
    initMenuSwitching(); 
    initBetslipHandlers();
    initModalHandlers();
    initMyBetsTabs(); 
    loadMatches();
    updatePoints(0); 
    checkWheelCooldown();
    renderActiveBets(); 
    updateClock(); 
    setInterval(updateClock, 1000); 
    // Скриваме фиша при зареждане, ако няма селекции
    toggleBetslipVisibility(false); 
});

// --- Функции за Играта и Баланса ---
function loadGameData() {
    // ... (без промяна)
    lastSpinTime = localStorage.getItem('lastSpinTime') ? parseInt(localStorage.getItem('lastSpinTime')) : null;
    userPoints = localStorage.getItem('userPoints') ? parseInt(localStorage.getItem('userPoints')) : 1000;
    activeBets = localStorage.getItem('activeBets') ? JSON.parse(localStorage.getItem('activeBets')) : [];
}

function saveGameData() {
    // ... (без промяна)
    localStorage.setItem('userPoints', userPoints);
    localStorage.setItem('activeBets', JSON.stringify(activeBets));
    if (lastSpinTime) {
        localStorage.setItem('lastSpinTime', lastSpinTime);
    }
}

function updatePoints(amount) {
    // ... (без промяна)
    userPoints += amount;
    elements.userPointsDisplay.textContent = userPoints; 
    saveGameData();
}

function displayMessage(element, message, isError = false) {
    // ... (без промяна)
    element.textContent = message;
    element.style.color = isError ? '#e74c3c' : '#2ecc71';
    setTimeout(() => {
        element.textContent = '';
    }, 4000);
}

// --- Управление на Часовника ---
function updateClock() {
    // ... (без промяна)
    const now = new Date();
    const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    const formattedDate = now.toLocaleString('bg-BG', options).replace('.,', ',');
    elements.realTimeClock.textContent = formattedDate;
    
    // Проверка за колелото при всяко обновяване на часа
    if (elements.wheelModal.style.display === 'block') {
        checkWheelCooldown(false);
    }
}

// --- Управление на Менюто и Табовете ---

function initMenuSwitching() {
    // ... (без промяна, освен че вече не премахва класа active от колелото)
    elements.menuButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetId = button.getAttribute('data-target');

            elements.contentSections.forEach(section => section.classList.remove('active'));
            elements.menuButtons.forEach(btn => btn.classList.remove('active'));

            const targetSection = document.getElementById(targetId);
            if (targetSection) {
                 targetSection.classList.add('active');
            }
            button.classList.add('active');

            if (targetId === 'wheel-area') {
                elements.wheelModal.style.display = 'block';
                document.getElementById('betting-area').classList.add('active');
                button.classList.remove('active');
            }
            
            if (targetId === 'betting-area') {
                if (!matchInterval) startMatchSimulation();
                // При влизане в "Залози" - проверява дали да покаже фиша
                toggleBetslipVisibility(betslipSelections.length > 0);
            } else {
                clearInterval(matchInterval);
                matchInterval = null;
                // При излизане от "Залози" - скрива фиша
                toggleBetslipVisibility(false); 
            }
        });
    });
    
    if (document.getElementById('betting-area').classList.contains('active')) {
        startMatchSimulation();
    }
}

function initMyBetsTabs() {
    // ... (без промяна)
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;

            document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

            button.classList.add('active');
            document.getElementById(`${targetTab}BetsList`).classList.add('active');
        });
    });
    document.getElementById('unsettledBetsList').classList.add('active');
}

// --- НОВА ФУНКЦИЯ: Показване/Скриване на Фиша ---
function toggleBetslipVisibility(show) {
    if (show) {
        elements.betslipArea.classList.add('visible');
    } else {
        elements.betslipArea.classList.remove('visible');
    }
}


// --- Управление на Модалния Прозорец (Колело) ---
function initModalHandlers() {
    elements.openWheelButton.addEventListener('click', (e) => {
        e.preventDefault(); 
        elements.wheelModal.style.display = 'block';
        checkWheelCooldown(); 
    });

    elements.closeButtons.forEach(button => {
        button.addEventListener('click', () => {
            elements.wheelModal.style.display = 'none';
        });
    });

    window.addEventListener('click', (event) => {
        if (event.target === elements.wheelModal) {
            elements.wheelModal.style.display = 'none';
        }
    });

    elements.spinButton.addEventListener('click', spinWheel);
}

// --- Логика на Колелото ---

function checkWheelCooldown(showMessage = true) {
    const now = new Date();
    const day = now.getDay(); // 0 = Неделя, 5 = Петък, 6 = Събота
    const hours = now.getHours();

    // 1. Проверка дали вече е завъртяно този Петък
    if (lastSpinTime) {
        const lastSpinDate = new Date(lastSpinTime);
        const lastSpinDay = lastSpinDate.getDay();
        const nextFriday = new Date(now);
        nextFriday.setDate(now.getDate() + (5 - day + 7) % 7);
        nextFriday.setHours(FRIDAY_SPIN_HOUR, 0, 0, 0);

        // Ако последното завъртане е било в Петък след 12ч. и е от същия или по-късен Петък
        if (lastSpinDay === 5 && lastSpinDate.getTime() >= nextFriday.getTime() - (7 * 24 * 60 * 60 * 1000) ) {
             // Търсим следващия Петък, за да покажем обратно броене
             const nextSpin = new Date(nextFriday.getTime() + 7 * 24 * 60 * 60 * 1000);
             
             elements.spinButton.disabled = true;
             elements.openWheelButton.disabled = true;

             const timeRemaining = nextSpin.getTime() - now.getTime();
             const days = Math.floor(timeRemaining / (1000 * 60 * 60 * 24));
             const hrs = Math.floor((timeRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
             const mins = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
             const secs = Math.floor((timeRemaining % (1000 * 60)) / 1000);

             const timeString = `Следващо завъртане: ${days}д ${hrs}ч ${mins}м ${secs}с (Следващ Петък)`;
             if (showMessage) elements.modalWheelCooldown.textContent = timeString;
             return;
        }
    }
    
    // 2. Проверка дали е Петък и дали е 12:00 или по-късно
    if (day === 5 && hours >= FRIDAY_SPIN_HOUR) {
        elements.spinButton.disabled = false;
        elements.openWheelButton.disabled = false;
        if (showMessage) elements.modalWheelCooldown.textContent = '🎉 Готово за завъртане този Петък!';
    } else {
        elements.spinButton.disabled = true;
        elements.openWheelButton.disabled = true;
        
        // Изчисляване на времето до следващия Петък в 12:00 ч.
        const nextFriday = new Date(now);
        nextFriday.setDate(now.getDate() + (5 - day + 7) % 7);
        nextFriday.setHours(FRIDAY_SPIN_HOUR, 0, 0, 0);
        
        const timeRemaining = nextFriday.getTime() - now.getTime();
        const days = Math.floor(timeRemaining / (1000 * 60 * 60 * 24));
        const hrs = Math.floor((timeRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const mins = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
        const secs = Math.floor((timeRemaining % (1000 * 60)) / 1000);
        
        const timeString = `Достъпно: Всеки Петък от 12:00 ч. (Остава: ${days}д ${hrs}ч ${mins}м ${secs}с)`;
        if (showMessage) elements.modalWheelCooldown.textContent = timeString;
    }
}

function spinWheel() {
    if (elements.spinButton.disabled) return;

    elements.spinButton.disabled = true;
    lastSpinTime = Date.now();
    saveGameData();

    // НОВИ печалби: 50, 100, 200, 500, 1000
    const rewards = [50, 100, 200, 500, 1000, 50, 100, 200, 500, 1000]; // 10 сегмента
    const totalSegments = rewards.length;
    const winningIndex = Math.floor(Math.random() * totalSegments);
    const winningReward = rewards[winningIndex];

    const degreesPerSegment = 360 / totalSegments;
    const offset = degreesPerSegment / 2;
    // Завъртане на 5 пълни оборота + до печелившия сегмент
    const rotationAngle = (360 * 5) + (360 - (winningIndex * degreesPerSegment) - offset);

    elements.spinner.style.transition = 'transform 4s cubic-bezier(0.2, 0.8, 0.2, 1)';
    elements.spinner.style.transform = `rotate(${rotationAngle}deg)`;

    setTimeout(() => {
        elements.spinner.style.transition = 'none';
        
        updatePoints(winningReward);
        elements.modalWheelResult.textContent = `🎉 Честито! Спечелихте ${winningReward} Точки!`;

        checkWheelCooldown();
    }, 4500); 
}

// --- Логика за Футболните Мачове, Фиша и Уреждането ---

function createMockMatches() {
    // ... (без промяна, мачовете от 04.11.2025 са запазени)
    const date = "2025-11-04"; 
    const time2200 = "T22:00:00+02:00"; 
    const time1945 = "T19:45:00+02:00"; 
    
    return [
        { 
            id: 101, home: "Реал Мадрид", away: "ПСЖ", 
            dateTime: new Date(date + time2200), 
            status: 'Not Started', 
            odds: { '1': 2.20, 'X': 3.40, '2': 3.10 }, 
            result: 'N/A' 
        },
        { 
            id: 102, home: "Ливърпул", away: "Байерн Мюнхен", 
            dateTime: new Date(date + time2200), 
            status: 'Not Started', 
            odds: { '1': 1.90, 'X': 3.60, '2': 4.00 }, 
            result: 'N/A' 
        },
        { 
            id: 103, home: "Интер", away: "Манчестър Сити", 
            dateTime: new Date(date + time2200), 
            status: 'Not Started', 
            odds: { '1': 3.50, 'X': 3.70, '2': 1.85 }, 
            result: 'N/A' 
        },
        { 
            id: 104, home: "Галатасарай", away: "Арсенал", 
            dateTime: new Date(date + time1945), 
            status: 'Not Started', 
            odds: { '1': 4.50, 'X': 3.80, '2': 1.65 }, 
            result: 'N/A'
        },
    ];
}

function loadMatches() {
    // ... (без промяна)
    matchesData = createMockMatches();
    renderMatches();
}

function renderMatches() {
    // ... (без промяна)
    elements.matchesList.innerHTML = '';
    
    matchesData.forEach(match => {
        const matchTime = new Date(match.dateTime).toLocaleTimeString('bg-BG', {hour: '2-digit', minute:'2-digit'});
        const matchDate = new Date(match.dateTime).toLocaleDateString('bg-BG', {month: 'long', day: 'numeric'});

        const matchDiv = document.createElement('div');
        matchDiv.className = 'match-card';
        
        let statusText;
        if (match.status === 'Active') {
            statusText = 'На живо';
        } else if (match.status === 'Finished') {
            statusText = 'Край на мача';
        } else {
            statusText = 'Предстоящ';
        }
        
        matchDiv.innerHTML = `
            <h3>${match.home} vs ${match.away}</h3>
            <p class="match-time-date">Дата: <strong>${matchDate}, ${matchTime} ч.</strong></p>
            <p class="match-status">Статус: <strong>${statusText}</strong></p>
            <div class="odds-container" data-match-id="${match.id}">
                ${renderOddButton(match, '1', 'Домакин', match.odds['1'])}
                ${renderOddButton(match, 'X', 'Равен', match.odds['X'])}
                ${renderOddButton(match, '2', 'Гост', match.odds['2'])}
            </div>
        `;
        elements.matchesList.appendChild(matchDiv);
    });

    document.querySelectorAll('.odd-button:not(.disabled)').forEach(button => {
        button.addEventListener('click', handleSelection);
    });
}

function renderOddButton(match, selection, label, odd) {
    // ... (без промяна)
    const disabledClass = match.status !== 'Not Started' ? 'disabled' : ''; 
    const selectedClass = betslipSelections.some(s => s.matchId === match.id && s.selection === selection) ? 'selected' : '';
    
    return `<button 
                class="odd-button ${disabledClass} ${selectedClass}" 
                data-match-id="${match.id}" 
                data-selection="${selection}" 
                data-label="${label}"
                data-odd="${odd}"
                ${disabledClass ? 'disabled' : ''}
            >
                ${label} (${odd.toFixed(2)})
            </button>`;
}

function startMatchSimulation() {
    // ... (без промяна)
    matchInterval = setInterval(() => {
        checkAndSettleBets();
        if (document.getElementById('betting-area').classList.contains('active')) {
            renderMatches();
        }
    }, 5000);
}

function handleSelection(event) {
    // ... (запазена логика за добавяне на селекция)
    const button = event.currentTarget;
    const matchId = parseInt(button.dataset.matchId);
    const selection = button.dataset.selection;
    const label = button.dataset.label;
    const odd = parseFloat(button.dataset.odd);
    const match = matchesData.find(m => m.id === matchId);
    
    const matchTime = new Date(match.dateTime).toLocaleTimeString('bg-BG', {hour: '2-digit', minute:'2-digit'});
    const matchDate = new Date(match.dateTime).toLocaleDateString('bg-BG', {year: 'numeric', month: 'short', day: 'numeric'});

    betslipSelections = betslipSelections.filter(s => s.matchId !== matchId);

    betslipSelections.push({
        matchId: matchId,
        home: match.home,
        away: match.away,
        dateTime: `${matchDate} ${matchTime}`, 
        selection: selection,
        label: label,
        odd: odd
    });

    renderBetslip();
    renderMatches();
    // **НОВО:** Показва фиша веднага, щом се добави селекция
    toggleBetslipVisibility(true); 
}

function removeSelection(matchId) {
    // ... (запазена логика за премахване на селекция)
    betslipSelections = betslipSelections.filter(s => s.matchId !== matchId);
    renderBetslip();
    renderMatches();
    // **НОВО:** Скрива фиша, ако няма останали селекции
    toggleBetslipVisibility(betslipSelections.length > 0); 
}

function renderBetslip() {
    // ... (запазена логика за рендиране, освен че вече извикваме toggleBetslipVisibility накрая)
    if (betslipSelections.length === 0) {
        elements.betslipList.innerHTML = '<p>Няма избрани селекции.</p>';
        elements.totalOddDisplay.textContent = '1.00';
        elements.potentialWinDisplay.textContent = '0';
        elements.placeBetButton.disabled = true;
        toggleBetslipVisibility(false); // Скрива фиша
        return;
    }

    let totalOdd = 1.00;
    elements.betslipList.innerHTML = '';

    betslipSelections.forEach(selection => {
        totalOdd *= selection.odd;
        
        const listItem = document.createElement('div');
        listItem.className = 'betslip-item';
        listItem.innerHTML = `
            <p><strong>${selection.home} - ${selection.away}</strong></p>
            <p>Час/Дата: ${selection.dateTime}</p>
            <p>Избор: ${selection.label} (${selection.selection}) @ <strong>${selection.odd.toFixed(2)}</strong></p>
            <button class="remove-bet-btn" data-match-id="${selection.matchId}">Премахни</button>
        `;
        elements.betslipList.appendChild(listItem);
    });

    elements.totalOddDisplay.textContent = totalOdd.toFixed(2);
    elements.placeBetButton.disabled = false;
    
    updatePotentialWin();

    document.querySelectorAll('.remove-bet-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            removeSelection(parseInt(e.currentTarget.dataset.matchId));
        });
    });
    
    toggleBetslipVisibility(true); // Показва фиша
}

function initBetslipHandlers() {
    // ... (без промяна)
    elements.betAmountInput.addEventListener('input', updatePotentialWin);
    elements.placeBetButton.addEventListener('click', placeCombinedBet);
}

function updatePotentialWin() {
    // ... (без промяна)
    const betAmount = parseInt(elements.betAmountInput.value) || 0;
    const totalOdd = parseFloat(elements.totalOddDisplay.textContent);
    
    const potentialWin = (betAmount * totalOdd).toFixed(2);
    elements.potentialWinDisplay.textContent = potentialWin;

    const isValid = betAmount >= MIN_BET && betslipSelections.length > 0 && betAmount <= userPoints;
    elements.placeBetButton.disabled = !isValid;
    
    if (betAmount > userPoints) {
        elements.betslipMessage.textContent = 'Недостатъчен баланс.';
    } else {
        elements.betslipMessage.textContent = '';
    }
}

function placeCombinedBet() {
    // ... (запазена логика за приемане на залог)
    const betAmount = parseInt(elements.betAmountInput.value);

    if (betslipSelections.length === 0) {
        displayMessage(elements.betslipMessage, 'Моля, изберете селекция.', true);
        return;
    }
    if (betAmount < MIN_BET) {
        displayMessage(elements.betslipMessage, `Минималният залог е ${MIN_BET} Точки.`, true);
        return;
    }
    if (betAmount > userPoints) {
        displayMessage(elements.betslipMessage, 'Недостатъчен баланс.', true);
        return;
    }

    updatePoints(-betAmount);

    const newBet = {
        id: Date.now(),
        selections: betslipSelections,
        amount: betAmount,
        odd: parseFloat(elements.totalOddDisplay.textContent),
        potentialWin: parseFloat(elements.potentialWinDisplay.textContent),
        status: 'Очакване',
        timePlaced: new Date().toLocaleString('bg-BG')
    };
    
    activeBets.push(newBet);
    saveGameData();

    displayMessage(elements.betslipMessage, `Залог за ${betAmount} Точки приет!`, false);
    
    betslipSelections = [];
    elements.betAmountInput.value = '';
    renderBetslip();
    renderMatches();
    renderActiveBets();
    
    // **НОВО:** Скрива фиша след успешен залог
    toggleBetslipVisibility(false); 
}

function cashOutBet(betId) {
    // ... (без промяна)
    const betIndex = activeBets.findIndex(b => b.id === betId);
    if (betIndex === -1) return;

    const bet = activeBets[betIndex];
    const cashOutAmount = Math.floor(bet.amount * 0.7);

    updatePoints(cashOutAmount);
    
    bet.status = `Уреден (Cash Out - ${cashOutAmount} Точки)`; 
    saveGameData();

    displayMessage(document.getElementById('betslipMessage'), `Залог #${bet.id} е затворен. Получихте ${cashOutAmount} Точки.`, false);

    renderActiveBets();
}


function checkAndSettleBets() {
    // ... (без промяна)
    const now = Date.now();
    let betsUpdated = false;

    matchesData = matchesData.map(match => {
        if (match.status === 'Not Started' && new Date(match.dateTime).getTime() < now) {
            match.status = 'Finished';
            match.result = Math.random() < 0.33 ? '1' : (Math.random() < 0.5 ? 'X' : '2');
        }
        return match;
    });

    const matchesFinished = matchesData.filter(m => m.status === 'Finished');

    activeBets = activeBets.map(bet => {
        if (bet.status === 'Очакване') {
            
            const allSelectionsFinished = bet.selections.every(s => 
                matchesFinished.some(m => m.id === s.matchId)
            );

            if (allSelectionsFinished) {
                let isWinner = true;
                
                for (const selection of bet.selections) {
                    const finishedMatch = matchesFinished.find(m => m.id === selection.matchId);
                    if (finishedMatch && finishedMatch.result !== selection.selection) {
                        isWinner = false;
                        break;
                    }
                }

                if (isWinner) {
                     bet.status = 'Печеливш';
                     updatePoints(bet.potentialWin);
                     betsUpdated = true;
                    
                } else {
                    bet.status = 'Губещ';
                    betsUpdated = true;
                }
            }
        }
        return bet;
    });
    
    if (betsUpdated) {
        saveGameData();
        renderActiveBets();
    }
}

// --- НОВИ ФУНКЦИИ ЗА ТАБЛИЦАТА С АКТИВНИ ЗАЛОЗИ ---
// ... (без промяна)

function renderActiveBets() {
    const createTable = (bets, isUnsettled) => {
        if (bets.length === 0) {
            return isUnsettled 
                ? '<p>Няма активни (неуредени) залози.</p>' 
                : '<p>Няма уредени залози.</p>';
        }

        let tableHTML = `
            <table class="bets-table">
                <thead>
                    <tr>
                        <th>Залог # / Направен</th>
                        <th>Селекции</th>
                        <th>Общ Коеф.</th>
                        <th>Залог</th>
                        <th>Пот. Печалба</th>
                        <th>Статус</th>
                        ${isUnsettled ? '<th>Действие</th>' : ''}
                    </tr>
                </thead>
                <tbody>
        `;

        bets.sort((a, b) => b.id - a.id).forEach(bet => {
            tableHTML += createBetRow(bet, isUnsettled);
        });

        tableHTML += '</tbody></table>';
        return tableHTML;
    };
    
    const unsettled = activeBets.filter(bet => bet.status === 'Очакване');
    const settled = activeBets.filter(bet => bet.status !== 'Очакване');
    
    elements.unsettledBetsList.innerHTML = createTable(unsettled, true);
    elements.settledBetsList.innerHTML = createTable(settled, false);
    
    document.querySelectorAll('.cash-out-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const betId = parseInt(e.currentTarget.dataset.betId);
            cashOutBet(betId);
        });
    });
}

function createBetRow(bet, showCashOut) {
    const selectionsHtml = bet.selections.map(s => 
        `<span class="bet-selection-item">${s.home} - ${s.away} (${s.selection} @ ${s.odd.toFixed(2)})</span>`
    ).join('<br>');
    
    let statusText = bet.status;
    let actionHtml = '';
    
    if (showCashOut) {
        const cashOutValue = (bet.amount * 0.7).toFixed(2); 
        actionHtml = `
            <button class="action-button cash-out-btn" data-bet-id="${bet.id}">
                Cash Out (${cashOutValue} Точки)
            </button>
        `;
    } else {
        if (bet.status.includes('Печеливш')) {
            statusText = `🏆 Печеливш (+${bet.potentialWin.toFixed(2)})`;
        } else if (bet.status.includes('Губещ')) {
            statusText = '❌ Губещ';
        } else if (bet.status.includes('Cash Out')) {
            const cashOutValue = bet.status.match(/\d+/)[0];
            statusText = `💸 Cash Out (+${cashOutValue})`;
        }
        actionHtml = '-';
    }

    return `
        <tr class="bet-row bet-status-${bet.status.split(' ')[0].toLowerCase()}">
            <td data-label="Залог #">${bet.id} <br><small>${bet.timePlaced.split(',')[0]}</small></td>
            <td data-label="Селекции">${selectionsHtml}</td>
            <td data-label="Общ Коеф.">${bet.odd.toFixed(2)}</td>
            <td data-label="Залог">${bet.amount}</td>
            <td data-label="Пот. Печалба">${bet.potentialWin.toFixed(2)}</td>
            <td data-label="Статус" class="bet-status-cell">${statusText}</td>
            ${showCashOut ? `<td data-label="Действие">${actionHtml}</td>` : ''}
        </tr>
    `;
}