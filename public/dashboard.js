
    const API_BASE = '';

    // [DEBUG] แสดง origin ที่หน้าเว็บรันอยู่ จริง ๆ — นำค่านี้ไปใส่ใน Google Console
    // (Authorized JavaScript origins) ให้ตรงเป๊ะถึงจะผ่านการตรวจสอบของ GSI
    console.log('[GSI origin]', window.location.origin);

    function escapeHtml(str) {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // ปลอดภัยสำหรับนำค่าไปใส่ใน string literal ของ JS (เช่น onclick="fn('...')")
    // หลีกเลี่ยงการหลุดออกจากเครื่องหมายคำพูดเดี่ยว ภายใน attribute ที่ครอบด้วย "
    function jsStr(str) {
      return String(str == null ? '' : str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/&/g, '&amp;')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
    }

    // ============================================
    // ALERT / CONFIRM DIALOG (แทน alert/confirm ดั้งเดิม)
    // เปิดกล่องป๊อปอัพเพื่อแจ้งเตือน หรือขออนุมัติก่อนทำรายการ
    // ============================================
    const MODAL_ICONS = {
      info:    'bi-info-circle',
      success: 'bi-check-circle',
      error:   'bi-x-circle',
      warning: 'bi-exclamation-triangle'
    };

    function openModal(cfg) {
      const overlay = document.getElementById('app-modal-overlay');
      if (!overlay) { (cfg.onCancel || cfg.onConfirm) && (cfg.onCancel || cfg.onConfirm)(); return; }

      const iconEl = overlay.querySelector('#app-modal-icon');
      const titleEl = overlay.querySelector('#app-modal-title');
      const msgEl = overlay.querySelector('#app-modal-message');
      const actionsEl = overlay.querySelector('#app-modal-actions');

      const type = cfg.type || 'info';
      iconEl.className = 'modal-icon ' + type;
      iconEl.innerHTML = `<i class="bi ${MODAL_ICONS[type] || 'bi-info-circle'}"></i>`;
      titleEl.textContent = cfg.title || '';
      msgEl.textContent = cfg.message || '';

      actionsEl.innerHTML = '';
      if (cfg.showCancel) {
        const cancel = document.createElement('button');
        cancel.className = 'btn-secondary';
        cancel.textContent = cfg.cancelText || 'ยกเลิก';
        cancel.addEventListener('click', () => { closeModal(); cfg.onCancel && cfg.onCancel(); });
        actionsEl.appendChild(cancel);
      }
      const ok = document.createElement('button');
      ok.className = 'btn-primary';
      ok.textContent = cfg.confirmText || 'ตกลง';
      ok.addEventListener('click', () => { closeModal(); cfg.onConfirm && cfg.onConfirm(); });
      actionsEl.appendChild(ok);

      overlay.classList.remove('hidden');
      ok.focus();

      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeModal();
          cfg.showCancel ? (cfg.onCancel && cfg.onCancel()) : (cfg.onConfirm && cfg.onConfirm());
        } else if (e.key === 'Enter') {
          e.preventDefault();
          ok.click();
        }
      };
      overlay._onKey = onKey;
      document.addEventListener('keydown', onKey);
    }

    function closeModal() {
      const overlay = document.getElementById('app-modal-overlay');
      if (!overlay) return;
      overlay.classList.add('hidden');
      if (overlay._onKey) { document.removeEventListener('keydown', overlay._onKey); overlay._onKey = null; }
    }

    // แจ้งเตือนแบบกดตกลงเพื่อปิด
    function showAlert(message, opts = {}) {
      return new Promise((resolve) => {
        openModal({
          message,
          title: opts.title || 'แจ้งเตือน',
          type: opts.type || 'info',
          confirmText: opts.confirmText || 'ตกลง',
          showCancel: false,
          onConfirm: () => resolve(),
          onCancel: () => resolve()
        });
      });
    }

    // ขออนุมัติผู้ใช้ คืนค่า Promise<boolean> (true = ยืนยัน)
    function showConfirm(message, opts = {}) {
      return new Promise((resolve) => {
        openModal({
          message,
          title: opts.title || 'ยืนยันการทำรายการ',
          type: opts.type || 'warning',
          confirmText: opts.confirmText || 'ยืนยัน',
          cancelText: opts.cancelText || 'ยกเลิก',
          showCancel: true,
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false)
        });
      });
    }

    // เปิด/ปิด Modal ทั่วไป (สำหรับฟอร์มต่างๆ)
    function openModalById(id) {
      const el = document.getElementById(id);
      if (el) el.classList.remove('hidden');
    }
    function closeModalById(id) {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    }

    // เปิดฟอร์มใน Modal
    function openStoryModal() {
      document.getElementById('new-story-title').value = '';
      const coverInput = document.getElementById('new-story-cover');
      if (coverInput) coverInput.value = '';
      const prev = document.getElementById('story-cover-preview');
      if (prev) prev.innerHTML = '';
      openModalById('story-modal');
    }

    // อัปโหลดรูปปก Story จากเครื่อง ไปยัง server คืน URL
    async function uploadStoryCover(file) {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_BASE}/api/stories/cover`, { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'อัปโหลดรูปปกไม่สำเร็จ');
      }
      const data = await res.json();
      return data.file_url;
    }

    // แสดงตัวอย่างรูปปกที่เลือกจากเครื่อง
    const storyCoverInput = document.getElementById('new-story-cover');
    if (storyCoverInput) {
      storyCoverInput.addEventListener('change', () => {
        const prev = document.getElementById('story-cover-preview');
        if (!prev) return;
        const f = storyCoverInput.files[0];
        if (!f) { prev.innerHTML = ''; return; }
        const reader = new FileReader();
        reader.onload = (e) => { prev.innerHTML = `<img src="${e.target.result}" alt="preview">`; };
        reader.readAsDataURL(f);
      });
    }
    function openChapterModal() {
      const num = document.getElementById('new-chapter-num');
      if (!num.value) num.value = 1;
      openModalById('chapter-modal');
    }
    function openAssetModal(mode) {
      if (mode !== 'edit') resetForm();
      openModalById('asset-modal');
    }

    // ============================================
    // NAVIGATION & SECTION SWITCHING
    // ============================================
    const hamburger = document.getElementById('hamburgerBtn');
    let allAssets = [];
    const sidebar = document.getElementById('sidebar');
    const navBtns = document.querySelectorAll('.nav-btn');
    const sections = document.querySelectorAll('.section');

    function showSection(sectionId) {
      sections.forEach(s => s.classList.remove('active'));
      document.getElementById(sectionId)?.classList.add('active');
      
      navBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.section === sectionId);
      });

      // Close sidebar on mobile
      if (window.innerWidth < 900) {
        sidebar.classList.add('hidden');
        hamburger.classList.remove('active');
      }

      // Trigger load for specific sections
      if (sectionId === 'asset-manager') {
        setTimeout(() => loadAssets().catch(() => {}), 100);
      }
    }

    hamburger.addEventListener('click', () => {
      sidebar.classList.toggle('hidden');
      hamburger.classList.toggle('active');
    });

    navBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        showSection(btn.dataset.section);
      });
    });

    // ============================================
    // DASHBOARD: Story & Chapter Management
    // ============================================
    let selectedStoryId = null;
    let loadedStories = [];

    async function renderStories() {
      const container = document.getElementById('story-list');
      container.innerHTML = 'Loading stories...';
      try {
        const res = await fetch(`${API_BASE}/api/stories`);
        if (!res.ok) throw new Error('Failed to fetch stories');
        loadedStories = await res.json();
        
        if (!loadedStories.length) {
          container.innerHTML = '<p>ยังไม่มีเรื่องราว (Story) เลยนะ, ลองสร้างเรื่องแรกของคุณดูสิ!</p>';
          return;
        }

        container.innerHTML = '';
        loadedStories.forEach(story => {
          const card = document.createElement('div');
          card.className = 'story-card';
          card.innerHTML = `
            ${story.cover_url ? `<img src="${escapeHtml(story.cover_url)}" alt="cover" class="story-card-cover">` : `<img src="https://placehold.co/300x160/3b82f6/1e293b?text=No+Cover" alt="No Cover" class="story-card-cover">`}
            <div class="story-card-body">
              <div class="story-card-title">${escapeHtml(story.title)}</div>
              <div class="story-card-actions">
                <button class="btn-secondary" onclick="editStory(${story.story_id})" style="flex: 0.5;" title="แก้ไข Story"><i class="bi bi-pencil"></i></button>
                <button class="btn-primary" onclick="openChapterManager(${story.story_id}, '${jsStr(story.title)}')">จัดการตอน</button>
                <button class="btn-danger" onclick="deleteStory(${story.story_id})">ลบ</button>
              </div>
            </div>
          `;
          container.appendChild(card);
        });
      } catch(e) {
        container.innerHTML = `<p style="color:var(--danger)">Error loading stories: ${e.message}</p>`;
      }
    }

    function openStoryModal() {
      document.getElementById('story-modal-title').innerHTML = '<i class="bi bi-book"></i> สร้าง Story ใหม่';
      document.getElementById('edit-story-id').value = '';
      document.getElementById('new-story-title').value = '';
      const pub = document.getElementById('new-story-published');
      if (pub) pub.checked = false;
      const coverInput = document.getElementById('new-story-cover');
      if (coverInput) coverInput.value = '';
      const prev = document.getElementById('story-cover-preview');
      if (prev) prev.innerHTML = '';
      openModalById('story-modal');
    }

    function editStory(id) {
      const story = loadedStories.find(s => s.story_id === id);
      if (!story) return;
      document.getElementById('story-modal-title').innerHTML = '<i class="bi bi-pencil"></i> แก้ไข Story';
      document.getElementById('edit-story-id').value = story.story_id;
      document.getElementById('new-story-title').value = story.title;
      const pub = document.getElementById('new-story-published');
      if (pub) pub.checked = !!story.is_published;
      const coverInput = document.getElementById('new-story-cover');
      if (coverInput) coverInput.value = '';
      const prev = document.getElementById('story-cover-preview');
      if (prev) {
        prev.innerHTML = story.cover_url ? `<img src="${escapeHtml(story.cover_url)}" alt="preview">` : '';
      }
      openModalById('story-modal');
    }

    async function saveStory() {
      const editId = document.getElementById('edit-story-id').value;
      const title = document.getElementById('new-story-title').value;
      const isPublished = document.getElementById('new-story-published').checked;
      const coverInput = document.getElementById('new-story-cover');
      if (!title) { await showAlert('กรุณากรอกชื่อ Story'); return; }

      try {
        let cover_url = null;
        if (coverInput && coverInput.files && coverInput.files[0]) {
          cover_url = await uploadStoryCover(coverInput.files[0]);
        } else if (editId) {
          const story = loadedStories.find(s => s.story_id === Number(editId));
          if (story) cover_url = story.cover_url;
        }

        const url = editId ? `${API_BASE}/api/stories/${editId}` : `${API_BASE}/api/stories`;
        const method = editId ? 'PUT' : 'POST';

        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, cover_url, description: '', is_published: isPublished ? 1 : 0 })
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to save story');
        }
        await renderStories();
        closeModalById('story-modal');
      } catch (e) {
        showAlert(`Error: ${e.message}`, { type: 'error' });
      }
    }

    async function deleteStory(storyId) {
      if (!await showConfirm('ยืนยันการลบ Story นี้ใช่หรือไม่? การกระทำนี้จะลบ Chapter และ Dialogue ทั้งหมดที่อยู่ภายใต้ Story นี้ด้วย!', { type: 'warning' })) return;
      try {
        const res = await fetch(`${API_BASE}/api/stories/${storyId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete story');
        await renderStories();
      } catch (e) {
        showAlert(`Error: ${e.message}`, { type: 'error' });
      }
    }

    function openChapterManager(storyId, storyTitle) {
      selectedStoryId = storyId;
      document.getElementById('active-story-title').innerText = storyTitle;
      document.getElementById('section-stories').classList.add('hidden');
      document.getElementById('section-chapters').classList.remove('hidden');
      renderChapters();
    }

    function backToStories() {
      selectedStoryId = null;
      document.getElementById('section-chapters').classList.add('hidden');
      document.getElementById('section-stories').classList.remove('hidden');
    }

    let loadedChapters = [];

    async function renderChapters() {
      const tbody = document.getElementById('chapter-list');
      tbody.innerHTML = '<tr><td colspan="3">Loading chapters...</td></tr>';
      if (!selectedStoryId) return;

      try {
        const res = await fetch(`${API_BASE}/api/stories/${selectedStoryId}/chapters`);
        if (!res.ok) throw new Error('Failed to fetch chapters');
        const data = await res.json();
        loadedChapters = data.chapters || [];

        if (!loadedChapters.length) {
          tbody.innerHTML = '<tr><td colspan="3">ยังไม่มีตอนใน Story นี้</td></tr>';
          return;
        }
        
        tbody.innerHTML = '';
        loadedChapters.forEach(ch => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${ch.chapter_number}</td>
            <td>${escapeHtml(ch.title)}</td>
            <td>
              <button class="btn-secondary" onclick="editChapter(${ch.chapter_id})" title="แก้ไขตอน"><i class="bi bi-pencil-square"></i> ข้อมูล</button>
              <button class="btn-primary" onclick="editVN(${ch.chapter_id}, '${jsStr(ch.title)}')"><i class="bi bi-pencil"></i> บทสนทนา</button>
              <button class="btn-success" onclick="playVN(${selectedStoryId}, ${ch.chapter_number})"><i class="bi bi-play-fill"></i> เล่น</button>
              <button class="btn-danger" onclick="deleteChapter(${ch.chapter_id})">ลบ</button>
            </td>
          `;
          tbody.appendChild(tr);
        });
         document.getElementById('new-chapter-num').value = loadedChapters.length > 0 ? Math.max(...loadedChapters.map(c => c.chapter_number)) + 1 : 1;
      } catch (e) {
        tbody.innerHTML = `<tr><td colspan="3" style="color:var(--danger)">Error: ${e.message}</td></tr>`;
      }
    }

    function openChapterModal() {
      document.getElementById('chapter-modal-title').innerHTML = '<i class="bi bi-plus-lg"></i> สร้างตอนใหม่';
      document.getElementById('edit-chapter-id').value = '';
      document.getElementById('new-chapter-num').value = '';
      const exp = document.getElementById('new-chapter-exported');
      if (exp) exp.checked = false;
      if (loadedChapters.length > 0) {
        document.getElementById('new-chapter-num').value = Math.max(...loadedChapters.map(c => c.chapter_number)) + 1;
      } else {
        document.getElementById('new-chapter-num').value = 1;
      }
      openModalById('chapter-modal');
    }

    function editChapter(id) {
      const ch = loadedChapters.find(c => c.chapter_id === id);
      if (!ch) return;
      document.getElementById('chapter-modal-title').innerHTML = '<i class="bi bi-pencil"></i> แก้ไขตอน';
      document.getElementById('edit-chapter-id').value = ch.chapter_id;
      document.getElementById('new-chapter-num').value = ch.chapter_number;
      document.getElementById('new-chapter-title').value = ch.title;
      const exp = document.getElementById('new-chapter-exported');
      if (exp) exp.checked = !!ch.is_exported;
      openModalById('chapter-modal');
    }

    async function saveChapter() {
      const editId = document.getElementById('edit-chapter-id').value;
      const chapter_number = document.getElementById('new-chapter-num').value;
      const title = document.getElementById('new-chapter-title').value;
      const isExported = document.getElementById('new-chapter-exported').checked;
      if (!title || !chapter_number) { await showAlert('กรุณากรอกเลขที่และชื่อตอน'); return; }

      try {
        const url = editId ? `${API_BASE}/api/chapters/${editId}` : `${API_BASE}/api/stories/${selectedStoryId}/chapters`;
        const method = editId ? 'PUT' : 'POST';

        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chapter_number, title, description: '', is_exported: isExported ? 1 : 0 })
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to save chapter');
        }
        await renderChapters();
        closeModalById('chapter-modal');
      } catch (e) {
        showAlert(`Error: ${e.message}`, { type: 'error' });
      }
    }

    async function deleteChapter(chapterId) {
      if (!await showConfirm('ยืนยันการลบตอนนี้ใช่หรือไม่?', { type: 'warning' })) return;
      try {
        const res = await fetch(`${API_BASE}/api/chapters/${chapterId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete chapter');
        await renderChapters();
      } catch (e) {
        showAlert(`Error: ${e.message}`, { type: 'error' });
      }
    }

    function editVN(chapterId, chapterTitle) {
      if (!chapterId) { showAlert('ไม่พบ Chapter ID'); return; }
      openDialogueEditor(chapterId, chapterTitle);
    }

    function playVN(storyId, chapterNumber) {
      // เปิดเกมในแท็บเดิม (ไม่เด้งแท็บใหม่)
      // Return-to-Source: จำ Studio ไว้ก่อน เพื่อให้ออกจาก Player กลับมาที่เดิม
      if (typeof setReturnContext === 'function') setReturnContext(window.location.href);
      window.location.href = `/game.html?story=${storyId}&chapter=${chapterNumber}`;
    }

    // ============================================
    // ASSET MANAGER: Upload & Manage Assets
    // ============================================

    function formatBytes(bytes) {
      if (!bytes) return '0 KB';
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
      return (bytes / (1024 ** i)).toFixed(1) + ' ' + sizes[i];
    }

    function buildAssetPreview(asset) {
      const url = asset.file_url || '';
      if (asset.asset_type === 'bgm' || asset.asset_type === 'sfx') {
        return `<div class="preview-box"><audio controls src="${url}" style="width: 100%;"></audio></div>`;
      }
      return `<div class="preview-box"><img src="${url}" alt="${asset.asset_name}" style="width:100%;height:100%;object-fit:cover"></div>`;
    }

    function assetCardHtml(asset) {
      const type = asset.asset_type;
      const preview = buildAssetPreview(asset);
      return `
        <div class="asset-card">
          <div>${preview}</div>
          <div>
            <h3 style="margin: 6px 0; font-size: 14px;">${asset.asset_name}</h3>
            <div style="color: var(--muted); font-size: 0.85rem;">Type: ${type} | ${formatBytes(asset.size_bytes || 0)}</div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn-primary" style="flex: 1; padding: 4px;" data-action="edit" data-id="${asset.asset_id}">Edit</button>
            <button class="btn-danger" style="flex: 1; padding: 4px;" data-action="delete" data-id="${asset.asset_id}">Delete</button>
          </div>
        </div>
      `;
    }

    function renderAssets() {
      const grouped = {
        character: allAssets.filter(a => a.asset_type === 'character'),
        background: allAssets.filter(a => a.asset_type === 'background'),
        bgm: allAssets.filter(a => a.asset_type === 'bgm'),
        sfx: allAssets.filter(a => a.asset_type === 'sfx')
      };

      Object.keys(grouped).forEach(type => {
        const container = document.getElementById(`tab-${type}`);
        if (!grouped[type].length) {
          container.innerHTML = `<div style="padding:12px;color:var(--muted)">ยังไม่มี ${type} assets</div>`;
          return;
        }
        container.innerHTML = grouped[type].map(assetCardHtml).join('');
      });

      attachCardActions();
    }

    function attachCardActions() {
      document.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.id);
          if (!await showConfirm('ต้องการลบ asset นี้หรือไม่?', { type: 'warning' })) return;
          await deleteAsset(id);
        });
      });

      document.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', () => {
          fillEditForm(Number(btn.dataset.id));
          openAssetModal('edit');
        });
      });
    }

    async function loadAssets() {
      try {
        const res = await fetch(`${API_BASE}/api/assets?mine=1`);
        if (!res.ok) throw new Error('Failed to load assets');
        allAssets = await res.json();
        renderAssets();
      } catch (e) {
        console.warn('Asset load error:', e);
        document.getElementById('tab-character').innerHTML = `<div style="padding:12px;color:var(--muted)">ไม่สามารถโหลด asset จากเซิร์ฟเวอร์ได้</div>`;
      }
    }

    function fillEditForm(assetId) {
      const asset = allAssets.find(a => a.asset_id === assetId);
      if (!asset) return;
      document.getElementById('form-title').innerText = 'Edit Asset';
      document.getElementById('asset-id').value = asset.asset_id; // <-- Set hidden ID
      document.getElementById('asset-category').value = asset.asset_type;
      document.getElementById('asset-name').value = asset.asset_name || '';

      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function resetForm() {
      document.getElementById('form-title').innerText = 'Upload New Asset';
      document.getElementById('asset-form').reset();
      document.getElementById('asset-id').value = ''; // <-- Clear hidden ID
      document.getElementById('asset-category').value = 'character';
      lastAutoFilledName = ''; // เคลียร์ชื่อที่ระบบเติมให้ครั้งก่อน
    }

    async function deleteAsset(id) {
      try {
        const res = await fetch(`${API_BASE}/api/assets/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete asset');
        await loadAssets();
      } catch (e) {
        showAlert('ลบ asset ไม่สำเร็จ', { type: 'error' });
      }
    }

    // Tab Switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.asset-grid').forEach(g => g.classList.add('hidden'));
        document.getElementById(`tab-${btn.dataset.type}`)?.classList.remove('hidden');
      });
    });

    // ------------------------------------------------------------
    // AUTO-FILL ASSET NAME FROM IMPORTED FILE
    // เมื่อผู้ใช้เลือกไฟล์ (Import Asset) ให้ดึงชื่อไฟล์ต้นฉบับมาใส่ในช่องชื่อ
    // แล้วคลุมดำ (Select) ข้อความทั้งหมด เพื่อให้พิมพ์ทับได้ทันที หรือใช้ชื่อเดิมได้เลย
    // ------------------------------------------------------------
    const assetFileInput = document.getElementById('asset-file');
    const assetNameInput = document.getElementById('asset-name');
    const assetCategorySelect = document.getElementById('asset-category');
    let lastAutoFilledName = '';

    // ตารางแมปนามสกุลไฟล์ -> หมวดหมู่ asset (ปรับได้ตามต้องการ)
    // หมายเหตุ: นามสกุลบอกได้แค่ image vs audio จึงตั้งค่าเริ่มต้นดังนี้
    //   - ภาพ (image)  -> character (ผู้ใช้สามารถเปลี่ยนเป็น background ได้เอง)
    //   - เสียง (audio) -> bgm       (ผู้ใช้สามารถเปลี่ยนเป็น sfx ได้เอง)
    const EXT_TO_CATEGORY = {
      // image
      png: 'character', jpg: 'character', jpeg: 'character', gif: 'character',
      webp: 'character', bmp: 'character', svg: 'character',
      // audio
      mp3: 'bgm', wav: 'bgm', ogg: 'bgm', m4a: 'bgm', flac: 'bgm', aac: 'bgm', oga: 'bgm'
    };

    if (assetFileInput && assetNameInput) {
      assetFileInput.addEventListener('change', () => {
        // ทำเฉพาะตอนสร้าง asset ใหม่ (ไม่ใช่ตอนแก้ไข) เพื่อไม่เขียนทับชื่อเดิม
        if (document.getElementById('asset-id').value) return;

        const file = assetFileInput.files[0];
        if (!file) return;

        // ตัดนามสกุลไฟล์ออก เหลือเฉพาะชื่อ เช่น "aria.png" -> "aria"
        const baseName = file.name.replace(/\.[^.]+$/, '');

        // เติมชื่อใหม่เฉพาะเมื่อช่องว่าง หรือช่องนั้นยังคงเป็นชื่อที่ระบบเติมให้ครั้งก่อน
        // (ไม่เขียนทับชื่อที่ผู้ใช้พิมพ์เองไว้)
        const current = assetNameInput.value.trim();
        if (current === '' || current === lastAutoFilledName) {
          assetNameInput.value = baseName;
          lastAutoFilledName = baseName;
        }

        // จัดหมวดหมู่ (Asset Type) อัตโนมัติตามนามสกุลไฟล์
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const detected = EXT_TO_CATEGORY[ext];
        if (detected && assetCategorySelect) {
          assetCategorySelect.value = detected;
        }

        // คลุมดำ (Select) ข้อความทั้งหมด เพื่อให้พิมพ์ทับได้ทันที หรือกดใช้งานชื่อเดิมได้เลย
        assetNameInput.focus();
        assetNameInput.select();
      });
    }

    // Asset Form Handler
    document.getElementById('asset-form').addEventListener('submit', async (e) => {
      e.preventDefault();

      const assetId = document.getElementById('asset-id').value;
      const assetType = document.getElementById('asset-category').value;
      const assetName = document.getElementById('asset-name').value.trim();
      const fileInput = document.getElementById('asset-file');
      const file = fileInput.files[0];

      if (!assetName) {
        await showAlert('กรุณากรอกชื่อ asset (Asset Name)');
        return;
      }

      // For new assets, a file is required. For edits, it's optional.
      if (!assetId && !file) {
        await showAlert('กรุณาเลือกไฟล์');
        return;
      }

      const formData = new FormData();
      formData.append('asset_type', assetType);

      formData.append('asset_name', assetName);

      if (file) {
        formData.append('file', file);
      }

      const isEdit = !!assetId;
      const url = isEdit ? `${API_BASE}/api/assets/${assetId}` : `${API_BASE}/api/assets`;
      const method = isEdit ? 'PUT' : 'POST';

      try {
        const res = await fetch(url, { method, body: formData });
        const result = await res.json();

        if (!res.ok) {
          throw new Error(result.error || 'เกิดข้อผิดพลาดในการบันทึก');
        }
        
        showAlert(`${isEdit ? 'อัปเดต' : 'บันทึก'} asset สำเร็จ!`, { type: 'success' });
        resetForm();
        await loadAssets();
        closeModalById('asset-modal');

      } catch (err) {
        console.error('Save asset error:', err);
        showAlert(`เกิดข้อผิดพลาด: ${err.message}`, { type: 'error' });
      }
    });

    document.getElementById('cancel-edit').addEventListener('click', () => { resetForm(); closeModalById('asset-modal'); });

    // กลับหน้าแรก (Home): Dashboard ไม่มีปุ่ม logout — logout มีแค่ในเมนูตั้งค่า Home
    // การกลับไป Home ไม่ทำลาย session (ผู้ใช้ยังคงล็อกอินอยู่)
    const backHomeBtn = document.getElementById('backHomeBtn');
    if (backHomeBtn) {
        backHomeBtn.addEventListener('click', () => {
          if (typeof navigateBackToSource === 'function') navigateBackToSource('/home.html');
          else window.location.href = '/home.html';
        });
    }

    // ─── Auth Gate: ถ้าไม่ล็อกอิน → แสดง Modal ล็อกอิน Google (โมดูลร่วม) ───
    function showLoginModal() {
        Auth.showLogin();
    }

    async function initApp() {
        try {
            const meRes = await fetch(`${API_BASE}/api/me`);
            if (!meRes.ok) {
                showLoginModal();
                return;
            }
            // ผ่านสิทธิ์ → เริ่มโหลด Dashboard ตามปกติ
            await renderStories();
            const restoreStr = sessionStorage.getItem('de_restore');
            if (restoreStr) {
                sessionStorage.removeItem('de_restore');
                try {
                    const state = JSON.parse(restoreStr);
                    if (state.storyId && state.chapterId) {
                        const story = loadedStories.find(s => s.story_id === state.storyId);
                        if (story) {
                            openChapterManager(story.story_id, story.title);
                            const res = await fetch(`${API_BASE}/api/stories/${state.storyId}/chapters`);
                            const data = await res.json();
                            const ch = (data.chapters || []).find(c => c.chapter_id === state.chapterId);
                            const chTitle = ch ? ch.title : 'Chapter';
                            await openDialogueEditor(state.chapterId, chTitle);
                            if (state.nodeId && typeof openNodeContentEditor === 'function') {
                                openNodeContentEditor(state.nodeId);
                            }
                        }
                    }
                } catch(e) { console.error('Error restoring state', e); }
            }

            if (!selectedStoryId) {
                const urlStory = new URLSearchParams(window.location.search).get('story');
                if (urlStory) {
                    const story = loadedStories.find(s => String(s.story_id) === String(urlStory));
                    if (story) openChapterManager(story.story_id, story.title);
                }
            }
        } catch (e) {
            // network error → สมมติยังไม่ล็อกอิน
            showLoginModal();
        }
    }

    initApp();