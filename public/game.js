document.addEventListener('DOMContentLoaded', () => {
    // Encapsulate game state and DOM elements
    const game = {
      state: {
        dialogue: [],
        dialogueById: {},
        currentIndex: 0,
      },
      elements: {
        idText: document.querySelector(".id-text"),
        nameText: document.querySelector(".name-text"),
        dialogueText: document.querySelector("#dialogue-box .dialogue-text"),
        choicesBox: document.querySelector("#choices"),
        background: document.getElementById("background"),
        dialogueBox: document.getElementById("dialogue-box"),
        bgmSlider: document.getElementById("bgmSlider"),
        sfxSlider: document.getElementById("sfxSlider"),
      },
    };

    // ===== BGM PLAYER =====
    let currentBGM = new Audio();
    currentBGM.loop = true;
    currentBGM.volume = 0.3;
    let currentBGMName = null;

    let audioCtx;
    let isAudioUnlocked = false;

    function playBGM(bgmName) {
        if (currentBGMName === bgmName) return;

        const bgmPath = typeof bgmAssetUrl === 'function' ? bgmAssetUrl(bgmName) : null;
        if (!bgmPath) {
            console.warn(`BGM "${bgmName}" not found or bgmAssetUrl function is not defined.`);
            return;
        }

        currentBGM.pause();
        currentBGM.src = bgmPath;
        currentBGM.currentTime = 0;
        currentBGM.volume = game.elements.bgmSlider ? parseFloat(game.elements.bgmSlider.value) : 0.3;
        currentBGMName = bgmName;

        const playPromise = currentBGM.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                isAudioUnlocked = true;
            }).catch(() => {
                console.warn("BGM auto-play blocked. Waiting for user interaction...");
                if (!isAudioUnlocked) {
                    const unlock = () => {
                        if (audioCtx && audioCtx.state === 'suspended') {
                            audioCtx.resume();
                        }
                        currentBGM.play();
                        isAudioUnlocked = true;
                        window.removeEventListener('click', unlock);
                        window.removeEventListener('touchstart', unlock);
                    };
                    window.addEventListener('click', unlock);
                    window.addEventListener('touchstart', unlock);
                }
            });
        }
    }

    let currentSFX = new Audio();
    function playSFX(sfxName) {
        const sfxPath = typeof sfxAssetUrl === 'function' ? sfxAssetUrl(sfxName) : null;
        if (!sfxPath) {
            console.warn(`SFX "${sfxName}" not found or sfxAssetUrl function is not defined.`);
            return;
        }
        let tempSFX = new Audio(sfxPath);
        tempSFX.volume = game.elements.sfxSlider ? parseFloat(game.elements.sfxSlider.value) : 0.5;
        tempSFX.play();
    }

    // Initialize AudioContext
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Event Listeners Setup
    if (game.elements.bgmSlider) {
        game.elements.bgmSlider.addEventListener('input', (e) => {
            currentBGM.volume = parseFloat(e.target.value);
        });
    }
     if (game.elements.sfxSlider) {
        game.elements.sfxSlider.addEventListener('input', (e) => {
            // This will only affect *new* sound effects
        });
    }


    const logOpenBtn = document.getElementById('log-open-btn');
    if (logOpenBtn) {
        logOpenBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof openLog === 'function') openLog();
        });
    }

    const closeLogBtn = document.getElementById('close-log');
    if (closeLogBtn) {
        closeLogBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof closeLogOverlay === 'function') closeLogOverlay();
        });
    }

    const settingsToggle = document.getElementById('settings-toggle');
    const settingsPanel = document.getElementById('settings-panel');
    if (settingsToggle && settingsPanel) {
        settingsToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            settingsPanel.classList.toggle('hidden');
        });
    }

    const controlButtons = ['log-open-btn', 'settings-toggle', 'close-log', 'settings-panel'];
    controlButtons.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('mousedown', e => e.stopPropagation());
            btn.addEventListener('click', e => e.stopPropagation());
        }
    });

    const logOverlay = document.getElementById('log-overlay');
    const historyLog = document.getElementById('history-log');
    if (logOverlay) {
        logOverlay.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof closeLogOverlay === 'function') closeLogOverlay();
        });
    }
    if (historyLog) {
        historyLog.addEventListener('click', e => e.stopPropagation());
        historyLog.addEventListener('mousedown', e => e.stopPropagation());
    }

    document.addEventListener("click", () => {
        if (audioCtx && audioCtx.state === "suspended") {
            audioCtx.resume();
            console.log("Audio unlocked");
        }
    }, { once: true });

    function updateText(currentLine) {
      if (game.elements.nameText) game.elements.nameText.textContent = currentLine.name || "";
      if (game.elements.idText) game.elements.idText.textContent = currentLine.identity || "";
      if (game.elements.dialogueText) game.elements.dialogueText.textContent = currentLine.text;
    }

    // แฟลชกรอบจอขาว (Flash / Camera Flash) ตามที่กำหนดในบรรทัด
    const flashOverlay = document.getElementById('flash-overlay');
    if (flashOverlay) {
      flashOverlay.addEventListener('animationend', () => flashOverlay.classList.remove('flash'));
    }
    function triggerFlash(currentLine) {
      if (!currentLine || !currentLine.flash || !flashOverlay) return;
      const dur = Number(currentLine.flashDuration) || 400;
      flashOverlay.style.setProperty('--flash-dur', dur + 'ms');
      flashOverlay.classList.remove('flash');
      void flashOverlay.offsetWidth; // forced reflow เพื่อเริ่มแอนิเมชันใหม่
      flashOverlay.classList.add('flash');
    }

    // Screen Shake (CSS Keyframes version)
    const SHAKE_CLASSES = ['shake-horizontal', 'shake-vertical', 'shake-heavy'];
    function triggerShake(currentLine) {
      if (!currentLine || !currentLine.shake) return;
      const gameScreen = document.getElementById('game-screen');
      if (!gameScreen) return;
      const type = currentLine.shakeType || 'shake-horizontal';
      const dur = Number(currentLine.shakeDuration) || 300;
      gameScreen.style.setProperty('--shake-dur', dur + 'ms');
      // ลบคลาสเก่าออกก่อน เพื่อให้ animation ใหม่ทำงานได้
      SHAKE_CLASSES.forEach(c => gameScreen.classList.remove(c));
      void gameScreen.offsetWidth; // forced reflow
      gameScreen.classList.add(type);
      gameScreen.addEventListener('animationend', () => {
        gameScreen.classList.remove(type);
      }, { once: true });
    }

    function handleChoiceClick(choice) {
      if (choice.next != null) {
        // Node Graph เก็บ choice.next เป็น dialogue_id แทนหมายเลขบรรทัด
        // จึงแปลงเป็นตำแหน่งในอาร์เรย์ผ่าน dialogueById (รองรับข้อมูลเก่าเป็น index ตรงได้ด้วย)
        const idx = game.state.dialogueById[choice.next];
        game.state.currentIndex = (idx !== undefined) ? idx : choice.next;
        showCurrentDialogue();
      } else if (choice.action === "goto") {
        window.location.href = choice.target;
      }
    }

    function renderChoices(currentLine) {
      if (!game.elements.choicesBox) return;
      game.elements.choicesBox.innerHTML = "";
      if (currentLine.choices && currentLine.choices.length > 0) {
        currentLine.choices.forEach(choice => {
          // ซ่อนตัวเลือกที่นำไปสู่ตอนอื่น (choice.nextChapter) ที่ยังไม่ส่งออก (Draft)
          if (choice.nextChapter != null && !game.state.exportMap[choice.nextChapter]) return;
          const btn = document.createElement("button");
          btn.textContent = choice.text;
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            handleChoiceClick(choice);
          });
          game.elements.choicesBox.appendChild(btn);
        });
      }
    }

    function updateVisuals(currentLine) {
      const gameScreen = document.getElementById("game-screen");
      if (!gameScreen) return;

      if (currentLine.type === "special") {
          gameScreen.classList.add("mode-special");
      } else {
          gameScreen.classList.remove("mode-special");
      }

      if (currentLine.type !== "special" && currentLine.characters) {
        if (typeof showCharacters === 'function') showCharacters(currentLine.characters);
        if (typeof highlightSprite === 'function') highlightSprite(currentLine.speaker);
      } else {
        if (typeof clearSprites === 'function') clearSprites();
      }

      if (currentLine.bg && game.elements.background) {
        const bgPath = typeof backgroundAssetUrl === 'function' ? backgroundAssetUrl(currentLine.bg) : null;
        if (bgPath === "none") {
          game.elements.background.style.backgroundImage = "none";
          game.elements.background.style.backgroundColor = "black";
        } else if (bgPath) {
          game.elements.background.style.backgroundImage = `url('${bgPath}')`;
          game.elements.background.style.backgroundColor = "transparent";
        }
      }
    }

    function playAudio(currentLine) {
      if (currentLine.bgm) playBGM(currentLine.bgm);
      if (currentLine.sfx) playSFX(currentLine.sfx);
    }

      let endModalShown = false;

      // Return-to-Source: ออกจาก Player กลับไปหน้าต้นทาง (Detail/Studio) เสมอ
      function exitToSource() {
        if (typeof navigateBackToSource === 'function') {
          const sid = game.state.storyId;
          const fallback = sid ? `/story-detail.html?id=${encodeURIComponent(sid)}` : '/home.html';
          // ถ้าไม่มี return context เลย (เปิดเกมตรง) อย่างน้อยกลับหน้า Detail ของเรื่องนี้
          const target = (typeof getReturnContext === 'function')
            ? getReturnContext(fallback) : fallback;
          try { sessionStorage.removeItem('vn_return_url'); } catch (_) {}
          window.location.href = target;
          return;
        }
        window.location.href = '/home.html';
      }

      function showEndChapterModal(nextChapter) {
        if (endModalShown) return;
        endModalShown = true;

        const modal = document.getElementById('end-chapter-modal');
        if (!modal) {
          alert('--- จบตอน ---');
          return;
        }
        const titleEl = document.getElementById('ec-title');
        const msgEl = document.getElementById('ec-message');
        const actionsEl = document.getElementById('ec-actions');
        const storyId = game.state.storyId;

        if (titleEl) titleEl.textContent = 'จบตอน';
        if (msgEl) msgEl.textContent = nextChapter
          ? 'คุณจะเล่นตอนต่อไปหรือไม่?'
          : 'กดที่ใดก็ได้บนหน้าจอเพื่อกลับหน้าแรก';

        if (actionsEl) actionsEl.innerHTML = '';
        modal.onclick = null;

        // ตอนถัดไปต้อง is_exported = true จึงจะเปิดให้เล่น
        // ถ้ายังเป็น Draft (is_exported = false) ให้ปิดเส้นทาง เล่นตอนต่อไป (Disable Path)
        const nextExported = nextChapter && game.state.exportMap[nextChapter];
        if (nextExported) {
          const yesBtn = document.createElement('button');
          yesBtn.className = 'btn-primary';
          yesBtn.textContent = 'เล่นตอนต่อไป';
          yesBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.location.href = `game.html?story=${storyId}&chapter=${nextChapter}`;
          });
          const noBtn = document.createElement('button');
          noBtn.className = 'btn-secondary';
          noBtn.textContent = 'กลับหน้าแรก';
          noBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            exitToSource();
          });
          if (actionsEl) actionsEl.append(yesBtn, noBtn);
        } else {
          modal.onclick = () => { exitToSource(); };
          const exitBtn = document.createElement('button');
          exitBtn.className = 'btn-secondary';
          exitBtn.textContent = 'ออก';
          exitBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            exitToSource();
          });
          if (actionsEl) actionsEl.append(exitBtn);
        }

        modal.classList.remove('hidden');
      }

      function showCurrentDialogue() {
        const currentLine = game.state.dialogue[game.state.currentIndex];
        if (!currentLine) {
          const lastLine = game.state.dialogue[game.state.currentIndex - 1];
          const nextChapter = lastLine ? (lastLine.nextChapter != null ? lastLine.nextChapter : null) : null;
          showEndChapterModal(nextChapter);
          return;
        }

      updateText(currentLine);
      renderChoices(currentLine);
      updateVisuals(currentLine);
      playAudio(currentLine);
      triggerFlash(currentLine);
      triggerShake(currentLine);
      if (typeof addToLog === 'function') addToLog(currentLine);
    }

    function nextDialogue() {
      const currentLine = game.state.dialogue[game.state.currentIndex];
      if (!currentLine) {
        game.state.currentIndex++;
        showCurrentDialogue();
        return;
      }
      // มี choices -> บังคับเลือก ห้ามคลิกผ่าน
      if (currentLine.choices && currentLine.choices.length > 0) {
        return;
      }

      // ยังอยู่กลาง Node เดิม -> เดินทีละบรรทัดได้ตามปกติ
      if (!currentLine._isLastLine) {
        game.state.currentIndex++;
        showCurrentDialogue();
        return;
      }

      // มาถึงบรรทัดสุดท้ายของ Node แล้ว: ห้าม currentIndex++ มั่ว (จะไหลเข้า branch ข้างเคียง)
      // 1) ถ้ามีเป้าหมายถัดไป (node.next / currentLine.next / _next) ให้กระโดดตามกราฟ
      const explicitNext = (currentLine._next ?? currentLine.next ?? null);
      if (explicitNext != null) {
        const idx = game.state.dialogueById[explicitNext];
        if (idx !== undefined) {
          game.state.currentIndex = idx;
          showCurrentDialogue();
          return;
        }
        // fallback: ข้อมูลเก่าที่เก็บ next เป็น index ตรง
        if (typeof explicitNext === 'number' && game.state.dialogue[explicitNext]) {
          game.state.currentIndex = explicitNext;
          showCurrentDialogue();
          return;
        }
      }

      // 2) ไม่มี Node ถัดไป (End of Tree/Branch) -> จบ Chapter ทันที ห้าม ++ ต่อ
      //    หา main-line ถัดไป (บรรทัดแรกที่ไม่ใช่ branch target) เพื่อ rejoin เส้นหลัก;
      //    ถ้าไม่เจอ = สุดสายจริง -> เปิด modal จบตอน
      const branchTargets = game.state.branchTargets || new Set();
      for (let i = game.state.currentIndex + 1; i < game.state.dialogue.length; i++) {
        const cand = game.state.dialogue[i];
        // ข้าม sibling branch (โหนดที่เป็นปลายทางของ choice) กันเลือก A แล้วไหลเข้า B
        if (cand && branchTargets.has(Number(cand._nodeId))) continue;
        // เจอเส้นหลักถัดไป -> rejoin ตรงบรรทัดแรกของ Node นั้น
        game.state.currentIndex = i;
        // ถอยให้แน่ใจว่าลงบรรทัดแรกของ Node (กันโดดกลาง Node กรณี flat ปนกัน)
        while (game.state.currentIndex > 0) {
          const prev = game.state.dialogue[game.state.currentIndex - 1];
          if (prev && prev._nodeId === cand._nodeId && !prev._isLastLine) break;
          if (prev && prev._nodeId === cand._nodeId) { game.state.currentIndex--; continue; }
          break;
        }
        showCurrentDialogue();
        return;
      }

      // สุดสายจริง: ประมวลผลจบ Chapter แทน (ใช้ nextChapter ของบรรทัดปัจจุบัน)
      showEndChapterModal(currentLine.nextChapter != null ? currentLine.nextChapter : null);
    }

    async function initGame() {
        if (!game.elements.dialogueBox || !game.elements.dialogueText) {
            console.error("Essential game elements are missing from the DOM. Aborting.");
            return;
        }

        // กฎ: ต้องล็อกอินก่อนเล่นเกม
        if (typeof Auth !== 'undefined' && Auth.getMe) {
            const me = await Auth.getMe();
            if (!me) {
                Auth.showLogin();
                window.addEventListener('auth:changed', () => window.location.reload());
                return;
            }
        }

        game.elements.dialogueBox.onclick = nextDialogue;

        try {
            // assets จะมาพร้อม response ของ fetchEpisode (assets_preload) แล้ว
            // loadAllAssets() เป็นเพียง fallback สำหรับไฟล์ chapter เก่าที่ยังไม่มี preload
            if (typeof loadAllAssets === 'function') {
                loadAllAssets().catch(() => {});
            }

            // Get story and chapter from the URL query parameters
            const urlParams = new URLSearchParams(window.location.search);
            const storyId = urlParams.get('story');
            const chapterNumber = urlParams.get('chapter');
            const previewNode = urlParams.get('previewNode');
            const previewLine = urlParams.get('previewLine');

            if (!storyId || !chapterNumber) {
                throw new Error("Story ID or Chapter Number not found in URL. Please start from the dashboard (e.g., game.html?story=1&chapter=1).");
            }

            game.state.storyId = storyId;
            endModalShown = false;

            const episode = await fetchEpisode(storyId, chapterNumber);
            const nodes = episode.dialogue;
            // แผนที่ chapter_number -> is_exported ใช้ซ่อน/ปิดเส้นทางไปตอนที่ยังไม่ส่งออก
            game.state.exportMap = episode.chaptersExport || {};

            // flatten: แต่ละ Node -> บรรทัดเรียงต่อเนื่อง, choices ปักที่บรรทัดสุดท้ายของ Node
            // (Node Graph เก็บ choice.next เป็น dialogue_id ของ Node ปลายทาง)
            // ระบุบรรทัดสุดท้ายของ Node (_isLastLine) + เป้าหมายถัดไป (_next) เพื่อให้
            // nextDialogue เดินตามกราฟแทนการ currentIndex++ ทะลุเข้า branch ข้างเคียง (เช่น เลือก A แล้วไหลเข้า B)
            const branchTargets = new Set();
            (nodes || []).forEach((node) => {
              (node.choices || []).forEach((c) => {
                if (c.next != null) branchTargets.add(Number(c.next));
              });
            });
            game.state.branchTargets = branchTargets;
            const flat = [];
            const nodeStart = {};
            (nodes || []).forEach((node) => {
              nodeStart[node.dialogue_id] = flat.length;
              const srcLines = (Array.isArray(node.lines) && node.lines.length)
                ? node.lines
                : [node]; // ข้อมูลเก่าแบบ flat (ไม่มี lines[])
              // รองรับ linear link ในอนาคต (ถ้า editor มี node.next) — ตอนนี้ยังไม่มี field นี้เลย fallback เป็น null
              const nodeNext = (node.next ?? node.nextId ?? node.next_node ?? node.nextNode ?? null);
              srcLines.forEach((l, li) => flat.push(Object.assign({}, l, {
                choices: [],
                nextChapter: (node.nextChapter != null ? node.nextChapter : null),
                _nodeId: node.dialogue_id,
                _isLastLine: li === srcLines.length - 1,
                // มีผลเฉพาะบรรทัดสุดท้ายของ Node; บรรทัดกลาง Node ต้องเป็น null เสมอ
                _next: li === srcLines.length - 1 ? nodeNext : null,
                _isBranchTarget: branchTargets.has(Number(node.dialogue_id))
              })));
              if (Array.isArray(node.choices) && node.choices.length && flat.length) {
                flat[flat.length - 1].choices = node.choices;
              }
            });
            game.state.dialogue = flat;

            // แผนที่ dialogue_id (ของ Node) -> ตำแหน่งบรรทัดแรกในอาร์เรย์
            game.state.dialogueById = {};
            (nodes || []).forEach((node) => { game.state.dialogueById[node.dialogue_id] = nodeStart[node.dialogue_id]; });

            let startIndex = 0;
            if (previewNode != null && previewLine != null) {
                const startLineIndex = game.state.dialogueById[previewNode];
                if (startLineIndex !== undefined) {
                    startIndex = startLineIndex + parseInt(previewLine, 10);
                }
                
                const backBtn = document.getElementById('back-to-editor-btn');
                if (backBtn) {
                  backBtn.classList.remove('hidden');
                  backBtn.onclick = (e) => {
                    e.stopPropagation();
                    // preview จาก Studio: กลับ Studio (มี return context); fallback = history.back
                    if (typeof getReturnContext === 'function') {
                      let target = null;
                      try { target = sessionStorage.getItem('vn_return_url'); } catch (_) {}
                      if (target) { exitToSource(); return; }
                    }
                    window.history.back();
                  };
                }
                const homeBtn = document.getElementById('home-btn');
                if (homeBtn) homeBtn.classList.add('hidden');
            }

            // ปุ่มออกจากเกม (มุมบนขวา): เข้าจากทางไหน ออกไปทางนั้น (ไม่ใช่ hardcode home เสมอ)
            const homeExitBtn = document.getElementById('home-btn');
            if (homeExitBtn && previewNode == null) {
              homeExitBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                exitToSource();
              });
            }

            game.state.currentIndex = startIndex;
            showCurrentDialogue();
        } catch (err) {
            console.error("Error initializing game:", err);
            if (game.elements.dialogueText) {
                game.elements.dialogueText.textContent = `โหลดข้อมูลบทสนทนาไม่ได้: ${err.message}`;
            }
        }
    }

    // Start the game
    initGame();
});
