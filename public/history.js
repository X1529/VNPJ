if (typeof window.dialogueHistory === 'undefined') {
    window.dialogueHistory = [];
}

/**
 * ฟังก์ชันบันทึกบทสนทนาลงใน Log
 * @param {Object} current - ข้อมูล dialogue บรรทัดปัจจุบัน
 */
function addToLog(current) {
    // 1. บันทึกลง Memory
    window.dialogueHistory.push({
        name: current.name || "",
        text: current.text,
        type: current.type || "normal"
    });

    // 2. แสดงผลลงใน HTML (UI)
    const logContent = document.getElementById('log-content');
    if (!logContent) return;

    const entry = document.createElement('div');

    if (current.type === 'special') {
        entry.className = 'log-item log-special-entry';
        entry.innerHTML = `<div class="log-text"></div>`;
        entry.querySelector('.log-text').textContent = `--- ${current.text} ---`;
    } else {
        entry.className = 'log-item';
        if (current.name) {
            const nameEl = document.createElement('div');
            nameEl.className = 'log-name';
            nameEl.textContent = current.name;
            entry.appendChild(nameEl);
        }
        const textEl = document.createElement('div');
        textEl.className = 'log-text';
        textEl.textContent = current.text;
        entry.appendChild(textEl);
    }

    logContent.appendChild(entry);
    logContent.scrollTop = logContent.scrollHeight;
}

// เปิดหน้าต่าง Log (เลื่อนไปล่างสุดอัตโนมัติ)
function openLog() {
    const panel = document.getElementById('history-log');
    const overlay = document.getElementById('log-overlay');
    if (panel) panel.classList.remove('hidden');
    if (overlay) overlay.classList.remove('hidden');

    const content = document.getElementById('log-content');
    if (content) content.scrollTop = content.scrollHeight;
}

// ปิดหน้าต่าง Log
function closeLogOverlay() {
    const panel = document.getElementById('history-log');
    const overlay = document.getElementById('log-overlay');
    if (panel) panel.classList.add('hidden');
    if (overlay) overlay.classList.add('hidden');
}

window.openLog = openLog;
window.closeLogOverlay = closeLogOverlay;
