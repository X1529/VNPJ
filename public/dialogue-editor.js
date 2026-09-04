// ─── Node Graph Editor (Chapter Overview) ─────────────────────────────
// หน้าแรกเมื่อแก้ Chapter: แสดง Node เป็นกราฟเต็มจอ
// - เพิ่ม/ลบ Node, ลากโหนด, zoom/pan, ลาก Port เชื่อมกิ่ง (choice.next = node id)
// - Double-click / ปุ่ม "เขียนบทสนทนา" เปิดหน้า Dialogue Editor (แยกหน้า)
//   เพื่อแก้บรรทัดใน Node (ดู node-dialogue-editor.js)
//
// Data model (file.dialogues = array ของ nodes):
//   node = { dialogue_id, sort_order, title, pos_x, pos_y,
//            lines:[{speaker,name,identity,text,bg,bgm,sfx,characters}],
//            choices:[{text, next}] }   // next = dialogue_id ของ Node ปลายทาง

let currentChapterId = null;
let chapterTitle = '';
let draggedAsset = null;             // asset ที่กำลังลากจาก Library (ใช้ในหน้า Editor แยก)
let chapterNodesCache = {};          // { [chapterId]: Node[] }
let panX = 40, panY = 40, zoom = 1;
let nextNodeId = 1;
let saveTimer = null, saving = false, pendingSave = false;
const AUTOSAVE_DELAY = 800;

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ─────────────────────────── Core helpers ─────────────────────────── */

function getChapterNodes(chapterId) {
  return chapterNodesCache[chapterId] || [];
}

// migrate ข้อมูลเก่า + รับรอง field + auto-layout ถ้ายังไม่มีพิกัด
function ensureGraphData(nodes) {
  let maxId = 0;
  nodes.forEach((n, i) => {
    if (n.dialogue_id === undefined || n.dialogue_id === null) n.dialogue_id = i;
    maxId = Math.max(maxId, Number(n.dialogue_id) || 0);
    if (!Array.isArray(n.lines)) {
      // ข้อมูลเก่าแบบ flat -> ห่อเป็น lines[]
      if (n.text || n.name || n.bg || (n.characters && n.characters.length)) {
        n.lines = [{
          speaker: n.speaker || 'center', name: n.name || '', identity: n.identity || '',
          text: n.text || '', bg: n.bg ?? null, bgm: n.bgm ?? null, sfx: n.sfx ?? null,
          characters: Array.isArray(n.characters) ? n.characters : []
        }];
      } else {
        n.lines = [];
      }
    }
    if (!Array.isArray(n.choices)) n.choices = [];
    if (n.sort_order === undefined) n.sort_order = i;
  });
  nextNodeId = maxId + 1;

  const COLS = 4, GAPX = 320, GAPY = 250, OX = 40, OY = 40;
  nodes.forEach((n, i) => {
    if (typeof n.pos_x !== 'number' || typeof n.pos_y !== 'number') {
      const c = i % COLS, r = Math.floor(i / COLS);
      n.pos_x = OX + c * GAPX;
      n.pos_y = OY + r * GAPY;
    }
  });
  return nodes;
}

function applyTransform() {
  const world = document.getElementById('de-graph-world');
  if (world) {
    world.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    world.style.setProperty('--inv-zoom', 1 / zoom);
  }
}

function screenToWorld(e) {
  const canvas = document.getElementById('de-graph-canvas');
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left - panX) / zoom,
    y: (e.clientY - rect.top - panY) / zoom
  };
}

function setSaveStatus(msg, ok) {
  const el = document.getElementById('de-save-status');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'de-save-status' + (ok === true ? ' ok' : ok === false ? ' err' : '');
}

/* ─────────────────────────── Section control ──────────────────────── */

async function openDialogueEditor(chapterId, title) {
  currentChapterId = chapterId;
  chapterTitle = title;
  document.getElementById('editor-empty-state').classList.add('hidden');
  document.getElementById('editor-body').classList.remove('hidden');
  document.getElementById('editor-chapter-title').textContent = title || '';
  if (typeof loadAssets === 'function') { try { await loadAssets(); } catch (_) {} }
  await loadDialogueLines(chapterId);
  if (typeof showSection === 'function') showSection('editor');
}

function backToChaptersFromEditor() {
  if (typeof renderChapters === 'function') renderChapters();
  if (typeof showSection === 'function') showSection('dashboard');
}

/* ─────────────────────────── Data load ────────────────────────────── */

async function loadDialogueLines(chapterId) {
  try {
    const res = await fetch(`${API_BASE}/api/chapters/${chapterId}/dialogues`);
    const lines = await res.json();
    chapterNodesCache[chapterId] = ensureGraphData(Array.isArray(lines) ? lines : []);
  } catch (err) {
    console.error(err);
    chapterNodesCache[chapterId] = [];
  }
  panX = 40; panY = 40; zoom = 1;
  applyTransform();
  RenderEngine.renderGraph();
}

/* ─────────────────────────── Render Engine ────────────────────────── */

const RenderEngine = {
  renderGraph() {
    const world = document.getElementById('de-graph-world');
    if (!world) return;
    world.querySelectorAll('.de-node').forEach(n => n.remove());
    getChapterNodes(currentChapterId).forEach(n => world.appendChild(this.createNodeCard(n)));
    this.drawConnections();
  },

  createNodeCard(nodeData) {
    const el = document.createElement('div');
    el.className = 'de-node';
    el.dataset.id = nodeData.dialogue_id;
    el.style.left = (nodeData.pos_x || 0) + 'px';
    el.style.top = (nodeData.pos_y || 0) + 'px';

    const first = (nodeData.lines && nodeData.lines[0]) || {};
    const previewText = ((first.text || '').split('\n')[0]) || '(ยังไม่มีบทสนทนา)';
    const title = nodeData.title || (first.name ? first.name : 'Node #' + nodeData.dialogue_id);
    const lineCount = nodeData.lines ? nodeData.lines.length : 0;
    const choices = nodeData.choices || [];

    const choicesHtml = choices.length
      ? choices.map((ch, idx) => {
          const connected = ch.next != null;
          const target = connected ? ('→ #' + ch.next) : '→ —';
          return `
            <div class="de-node-choice">
              <span class="de-node-choice-text" title="${escapeHtml(ch.text || '')}">${escapeHtml(ch.text || '(ไม่มีข้อความ)')}</span>
              <span class="de-node-choice-target">${target}</span>
              <span class="de-port-out ${connected ? 'connected' : ''}" data-node-id="${nodeData.dialogue_id}" data-choice-index="${idx}" title="ลากเพื่อเชื่อมไปยัง Node ปลายทาง"></span>
            </div>`;
        }).join('')
      : '<div class="de-node-no-choice">ไม่มี Choices</div>';

    el.innerHTML = `
      <span class="de-port-in" title="Input (จาก Node ก่อนหน้า)"></span>
      <div class="de-node-head">
        <span class="de-node-title">${escapeHtml(title)}</span>
        <button class="de-node-del" title="ลบ Node">×</button>
      </div>
      <div class="de-node-body">
        <div class="de-node-preview">${escapeHtml(previewText)}</div>
        <div class="de-node-meta">${lineCount} บรรทัด · ${choices.length} choices</div>
      </div>
      <div class="de-node-choices">${choicesHtml}</div>
      <div class="de-node-foot">
        <button class="de-node-edit" title="เขียนบทสนทนา"><i class="bi bi-pencil"></i> เขียนบทสนทนา</button>
      </div>`;

    el.addEventListener('mousedown', () => InteractionHandler.selectNode(nodeData.dialogue_id));
    const head = el.querySelector('.de-node-head');
    head.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      InteractionHandler.startNodeDrag(e, nodeData.dialogue_id);
    });
    el.querySelector('.de-node-del').addEventListener('click', (e) => {
      e.stopPropagation();
      InteractionHandler.deleteNode(nodeData.dialogue_id);
    });
    el.querySelector('.de-node-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      InteractionHandler.openNodeEditor(nodeData.dialogue_id);
    });
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      InteractionHandler.openNodeEditor(nodeData.dialogue_id);
    });
    el.querySelectorAll('.de-port-out').forEach(p => {
      p.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        InteractionHandler.startPortDrag(e, Number(p.dataset.nodeId), Number(p.dataset.choiceIndex));
      });
    });
    return el;
  },

  drawConnections() {
    const svg = document.getElementById('connections-layer');
    if (!svg) return;
    const nodes = getChapterNodes(currentChapterId);
    let html = '';
    nodes.forEach(n => {
      (n.choices || []).forEach((ch, idx) => {
        if (ch.next == null) return;
        const srcPort = document.querySelector(`.de-node[data-id="${n.dialogue_id}"] .de-port-out[data-choice-index="${idx}"]`);
        const tgtPort = document.querySelector(`.de-node[data-id="${ch.next}"] .de-port-in`);
        if (!srcPort || !tgtPort) return;
        const a = this.getPortCenter(srcPort);
        const b = this.getPortCenter(tgtPort);
        const d = this.bezier(a.x, a.y, b.x, b.y);
        html += `<g class="de-edge-group" data-source-id="${n.dialogue_id}" data-choice-index="${idx}" data-target="${ch.next}">
          <path class="de-edge-hit" d="${d}" />
          <path class="de-edge" data-target="${ch.next}" d="${d}" />
        </g>`;
      });
    });
    svg.innerHTML = html;
    svg.querySelectorAll('.de-edge').forEach(p => {
      p.addEventListener('mouseenter', () => p.classList.add('hover'));
      p.addEventListener('mouseleave', () => p.classList.remove('hover'));
    });
  },

  getPortCenter(el) {
    const world = document.getElementById('de-graph-world');
    const wRect = world.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return {
      x: (r.left + r.width / 2 - wRect.left) / zoom,
      y: (r.top + r.height / 2 - wRect.top) / zoom
    };
  },

  bezier(x1, y1, x2, y2) {
    const dx = Math.max(60, Math.abs(x2 - x1) * 0.5);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }
};

/* ─────────────────────────── Interaction ──────────────────────────── */

const InteractionHandler = {
  _nodeDrag: null, _pan: null, _portDrag: null, _selected: null, _lastMouse: null,

  init() {
    const canvas = document.getElementById('de-graph-canvas');
    if (!canvas || canvas.dataset.bound) return;
    canvas.dataset.bound = '1';

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // ขวาคลิก = ไม่ pan (ไว้สำหรับเมนูเส้น)
      if (e.target.closest('.de-node')) return; // ไม่ pan เมื่อกดบนโหนด
      this._pan = { x: e.clientX, y: e.clientY, px: panX, py: panY };
      canvas.classList.add('grabbing');
    });

    canvas.addEventListener('mousemove', (e) => {
      if (this._pan) {
        panX = this._pan.px + (e.clientX - this._pan.x);
        panY = this._pan.py + (e.clientY - this._pan.y);
        applyTransform();
      }
      if (this._nodeDrag) {
        const dx = (e.clientX - this._nodeDrag.sx) / zoom;
        const dy = (e.clientY - this._nodeDrag.sy) / zoom;
        const node = getChapterNodes(currentChapterId).find(n => n.dialogue_id === this._nodeDrag.nodeId);
        if (node) {
          node.pos_x = this._nodeDrag.ox + dx;
          node.pos_y = this._nodeDrag.oy + dy;
          const el = document.querySelector(`.de-node[data-id="${node.dialogue_id}"]`);
          if (el) { el.style.left = node.pos_x + 'px'; el.style.top = node.pos_y + 'px'; }
          RenderEngine.drawConnections();
        }
      }
      if (this._portDrag) {
        this._lastMouse = { x: e.clientX, y: e.clientY };
        const m = screenToWorld(e);
        const src = document.querySelector(`.de-node[data-id="${this._portDrag.nodeId}"] .de-port-out[data-choice-index="${this._portDrag.choiceIndex}"]`);
        if (!src) return;
        const a = RenderEngine.getPortCenter(src);
        const svg = document.getElementById('connections-layer');
        let temp = svg.querySelector('.de-edge-temp');
        if (!temp) {
          temp = document.createElementNS(SVG_NS, 'path');
          temp.setAttribute('class', 'de-edge-temp');
          svg.appendChild(temp);
        }
        temp.setAttribute('d', RenderEngine.bezier(a.x, a.y, m.x, m.y));
      }
    });

    window.addEventListener('mouseup', (e) => this._endInteraction(e));

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const wx = (mx - panX) / zoom, wy = (my - panY) / zoom;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      zoom = Math.min(2, Math.max(0.3, zoom * factor));
      panX = mx - wx * zoom;
      panY = my - wy * zoom;
      applyTransform();
    }, { passive: false });
  },

  _endInteraction(e) {
    if (this._portDrag) this._endPortDrag(e);
    this._pan = null;
    this._nodeDrag = null;
    const c = document.getElementById('de-graph-canvas');
    if (c) c.classList.remove('grabbing');
  },

  _endPortDrag(e) {
    const p = this._portDrag;
    this._portDrag = null;
    const svg = document.getElementById('connections-layer');
    const temp = svg.querySelector('.de-edge-temp');
    if (temp) temp.remove();
    const tgt = document.elementFromPoint(e.clientX, e.clientY);
    const nodeEl = tgt ? tgt.closest('.de-node') : null;
    const node = getChapterNodes(currentChapterId).find(n => n.dialogue_id === p.nodeId);
    if (!node) return;
    const choice = node.choices[p.choiceIndex];
    if (!choice) return;
    if (nodeEl) {
      const tgtId = Number(nodeEl.dataset.id);
      choice.next = (tgtId === p.nodeId) ? choice.next : tgtId;
    } else {
      choice.next = null; // ปล่อยที่ว่าง = ยกเลิกการเชื่อม
    }
    RenderEngine.drawConnections();
    const portEl = document.querySelector(`.de-node[data-id="${p.nodeId}"] .de-port-out[data-choice-index="${p.choiceIndex}"]`);
    if (portEl) portEl.classList.toggle('connected', choice.next != null);
    DataBridge.scheduleSave();
  },

  startNodeDrag(e, nodeId) {
    e.stopPropagation();
    const node = getChapterNodes(currentChapterId).find(n => n.dialogue_id === nodeId);
    if (!node) return;
    this._nodeDrag = { nodeId, sx: e.clientX, sy: e.clientY, ox: node.pos_x || 0, oy: node.pos_y || 0 };
  },

  startPortDrag(e, nodeId, choiceIndex) {
    e.stopPropagation();
    this._portDrag = { nodeId, choiceIndex };
    this._lastMouse = { x: e.clientX, y: e.clientY };
  },

  selectNode(nodeId) {
    this._selected = nodeId;
    document.querySelectorAll('.de-node').forEach(n => n.classList.toggle('selected', Number(n.dataset.id) === nodeId));
  },

  focusNode(nodeId) {
    this.selectNode(nodeId);
    const node = getChapterNodes(currentChapterId).find(n => n.dialogue_id === nodeId);
    if (!node) return;
    panX = 400 - (node.pos_x || 0) * zoom;
    panY = 300 - (node.pos_y || 0) * zoom;
    applyTransform();
  },

  addNode() {
    const nodes = getChapterNodes(currentChapterId);
    const id = nextNodeId++;
    const COLS = 4, GAPX = 320, GAPY = 250;
    const i = nodes.length;
    const node = {
      dialogue_id: id, sort_order: i, title: '',
      pos_x: 40 + (i % COLS) * GAPX, pos_y: 40 + Math.floor(i / COLS) * GAPY,
      lines: [{ speaker: 'center', name: '', identity: '', text: '', bg: null, bgm: null, sfx: null, characters: [] }],
      choices: []
    };
    nodes.push(node);
    chapterNodesCache[currentChapterId] = nodes;
    RenderEngine.renderGraph();
    this.selectNode(id);
    DataBridge.scheduleSave();
  },

  async deleteNode(nodeId) {
    const nodes = getChapterNodes(currentChapterId);
    const node = nodes.find(n => n.dialogue_id === nodeId);
    if (!node) return;
    if (!await showConfirm(`ลบ Node #${nodeId} ? การเชื่อมต่อที่ชี้มาหา Node นี้จะถูกตัด`, { type: 'warning' })) return;
    const idx = nodes.findIndex(n => n.dialogue_id === nodeId);
    if (idx > -1) nodes.splice(idx, 1);
    nodes.forEach(n => (n.choices || []).forEach(ch => { if (ch.next == nodeId) ch.next = null; }));
    chapterNodesCache[currentChapterId] = nodes;
    RenderEngine.renderGraph();
    DataBridge.scheduleSave();
  },

  openNodeEditor(nodeId) {
    const node = getChapterNodes(currentChapterId).find(n => n.dialogue_id === nodeId);
    if (!node) return;
    if (typeof openNodeContentEditor === 'function') openNodeContentEditor(nodeId);
  }
};

/* ─────────────────────────── Data Bridge ──────────────────────────── */

const DataBridge = {
  ensureGraphData,

  scheduleSave() {
    setSaveStatus('กำลังบันทึก...');
    if (saveTimer) clearTimeout(saveTimer);
    pendingSave = true;
    saveTimer = setTimeout(() => this.save(), AUTOSAVE_DELAY);
  },

  async save() {
    if (saving) { pendingSave = true; return; }
    saving = true;
    setSaveStatus('กำลังบันทึก...');
    try {
      const nodes = getChapterNodes(currentChapterId);
      const payload = {
        dialogues: nodes.map(n => ({
          dialogue_id: n.dialogue_id,
          sort_order: n.sort_order,
          title: n.title || '',
          pos_x: n.pos_x, pos_y: n.pos_y,
          lines: (n.lines || []).map(l => ({
            speaker: l.speaker, name: l.name, identity: l.identity, text: l.text,
            bg: l.bg, bgm: l.bgm, sfx: l.sfx, characters: l.characters,
            flash: l.flash, flashDuration: l.flashDuration,
            shake: l.shake, shakeType: l.shakeType, shakeDuration: l.shakeDuration
          })),
          nextChapter: (n.nextChapter != null) ? Number(n.nextChapter) : null,
          choices: (n.choices || []).map(c => ({ text: c.text, next: c.next == null ? null : Number(c.next) }))
        }))
      };
      const res = await fetch(`${API_BASE}/api/chapters/${currentChapterId}/dialogues/bulk`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('save failed');
      setSaveStatus('บันทึกเรียบร้อย', true);
    } catch (e) {
      console.error(e);
      setSaveStatus('บันทึกไม่สำเร็จ', false);
    } finally {
      saving = false;
      if (pendingSave) { pendingSave = false; this.scheduleSave(); }
    }
  }
};

/* ─────────────────────────── Bootstrap ────────────────────────────── */

document.getElementById('de-graph-add')?.addEventListener('click', () => InteractionHandler.addNode());
document.getElementById('de-graph-fit')?.addEventListener('click', () => { panX = 40; panY = 40; zoom = 1; applyTransform(); });

// เคลียร์ asset ที่กำลังลาก (ใช้ร่วมกับหน้า Editor แยก)
document.addEventListener('dragend', () => { draggedAsset = null; });

// คลิกขวาบนเส้น SVG → เปิดเมนู ✕ ตัดเส้นนั้นเฉพาะเส้น (source-choice → target)
let _edgeMenuData = null;

function showEdgeMenu(clientX, clientY, sourceId, choiceIdx) {
  const menu = document.getElementById('de-edge-menu');
  if (!menu) return;
  _edgeMenuData = { sourceId, choiceIdx };
  menu.style.left = clientX + 'px';
  menu.style.top = clientY + 'px';
  menu.classList.remove('hidden');
}

function hideEdgeMenu() {
  const menu = document.getElementById('de-edge-menu');
  if (menu) menu.classList.add('hidden');
  _edgeMenuData = null;
}

function deleteEdge(sourceId, choiceIdx) {
  const node = getChapterNodes(currentChapterId).find(n => n.dialogue_id === sourceId);
  if (node && node.choices[choiceIdx]) {
    node.choices[choiceIdx].next = null;
    RenderEngine.renderGraph();
    DataBridge.scheduleSave();
  }
  hideEdgeMenu();
}

document.getElementById('connections-layer')?.addEventListener('contextmenu', (e) => {
  const group = e.target.closest('.de-edge-group');
  if (!group) return; // คลิกขวานอกเส้น = พฤติกรรมปกติ
  e.preventDefault();
  showEdgeMenu(e.clientX, e.clientY, Number(group.dataset.sourceId), Number(group.dataset.choiceIndex));
});

document.getElementById('de-edge-menu-delete')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (_edgeMenuData) deleteEdge(_edgeMenuData.sourceId, _edgeMenuData.choiceIdx);
});

// ปิดเมนูเมื่อคลิก/เลื่อน/คลิกขวาที่อื่น
['click', 'mousedown', 'wheel', 'contextmenu'].forEach((evt) => {
  window.addEventListener(evt, (e) => {
    const menu = document.getElementById('de-edge-menu');
    if (!menu || menu.classList.contains('hidden')) return;
    if (menu.contains(e.target)) return;
    if (evt === 'contextmenu' && e.target.closest('.de-edge-group')) return; // ให้ layer จัดการเปิดใหม่
    hideEdgeMenu();
  });
});

InteractionHandler.init();
