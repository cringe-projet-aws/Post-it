(() => {
  const boardEl = document.getElementById('board');
  if (!boardEl) return;

  const topBarEl = document.querySelector('.top-bar');
  const boardSwitcherForm = document.querySelector('.board-switcher');
  const boardSearchInput = document.getElementById('board-search');

  const modal = document.getElementById('postit-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalText = document.getElementById('postit-text');
  const modalCancel = document.getElementById('modal-cancel');
  const modalSave = document.getElementById('modal-save');

  let currentAction = null; // 'create' | 'edit'
  let currentPostitId = null;
  let createCoords = { x: 100, y: 100 };
  let lastTap = { t: 0, x: 0, y: 0 };
  let clampTimer = null;
  let lastBoardSize = { w: 0, h: 0 };

  function isLoggedIn() {
    return !!window.CURRENT_USER;
  }

  function normalizeBoardName(raw) {
    const s = String(raw || '').trim();
    // Keep simple URL-safe board IDs: letters, digits, underscore, dash
    const cleaned = s.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '');
    return cleaned;
  }

  if (boardSwitcherForm && boardSearchInput) {
    // Prefill with current board for convenience
    if (window.CURRENT_BOARD && window.CURRENT_BOARD !== 'default') {
      boardSearchInput.placeholder = `Aller au tableau… (ex: ${window.CURRENT_BOARD})`;
    }

    boardSwitcherForm.addEventListener('submit', e => {
      e.preventDefault();
      const name = normalizeBoardName(boardSearchInput.value);
      if (!name || name === 'default') {
        window.location.assign('/');
        return;
      }
      window.location.assign(`/${encodeURIComponent(name)}`);
    });
  }

  function syncTopBarHeightVar() {
    const h = topBarEl ? topBarEl.getBoundingClientRect().height : 56;
    document.documentElement.style.setProperty('--topbar-h', `${Math.round(h)}px`);
  }

  syncTopBarHeightVar();
  window.addEventListener('resize', syncTopBarHeightVar);

  function clampPostitIntoBoard(postitEl, { allowRestoreOriginal }) {
    const boardRect = boardEl.getBoundingClientRect();
    const elRect = postitEl.getBoundingClientRect();

    const w = elRect.width || 210;
    const h = elRect.height || 140;

    let left = parseInt(postitEl.style.left || '0', 10);
    let top = parseInt(postitEl.style.top || '0', 10);

    const maxLeft = Math.max(0, Math.floor(boardRect.width - w));
    const maxTop = Math.max(0, Math.floor(boardRect.height - h));

    if (allowRestoreOriginal && postitEl.dataset.origX != null && postitEl.dataset.origY != null) {
      const origX = parseInt(postitEl.dataset.origX, 10);
      const origY = parseInt(postitEl.dataset.origY, 10);
      const fits =
        Number.isFinite(origX) &&
        Number.isFinite(origY) &&
        origX >= 0 &&
        origY >= 0 &&
        origX <= maxLeft &&
        origY <= maxTop;
      if (fits) {
        postitEl.style.left = `${origX}px`;
        postitEl.style.top = `${origY}px`;
        delete postitEl.dataset.origX;
        delete postitEl.dataset.origY;
        return { changed: true, x: origX, y: origY, restored: true };
      }
    }

    const clampedLeft = Math.min(Math.max(0, left), maxLeft);
    const clampedTop = Math.min(Math.max(0, top), maxTop);

    const changed = clampedLeft !== left || clampedTop !== top;
    if (changed) {
      // Save original position once, so we can restore it when screen grows again
      if (postitEl.dataset.origX == null) postitEl.dataset.origX = String(left);
      if (postitEl.dataset.origY == null) postitEl.dataset.origY = String(top);
      postitEl.style.left = `${clampedLeft}px`;
      postitEl.style.top = `${clampedTop}px`;
    }
    return { changed, x: clampedLeft, y: clampedTop, restored: false };
  }

  function clampAllPostits({ allowRestoreOriginal }) {
    const postits = Array.from(boardEl.querySelectorAll('.postit'));
    for (const el of postits) {
      clampPostitIntoBoard(el, { allowRestoreOriginal });
    }
  }

  function scheduleClampAll() {
    if (clampTimer) clearTimeout(clampTimer);
    clampTimer = setTimeout(() => {
      clampTimer = null;
      const rect = boardEl.getBoundingClientRect();
      const grew =
        (lastBoardSize.w && rect.width > lastBoardSize.w) || (lastBoardSize.h && rect.height > lastBoardSize.h);
      lastBoardSize = { w: rect.width, h: rect.height };
      clampAllPostits({ allowRestoreOriginal: grew });
    }, 180);
  }

  window.addEventListener('resize', scheduleClampAll);
  window.addEventListener('orientationchange', scheduleClampAll);

  function openModal(action, options = {}) {
    currentAction = action;
    currentPostitId = options.id || null;
    if (action === 'create') {
      modalTitle.textContent = 'Nouveau post-it';
      modalText.value = '';
    } else if (action === 'edit') {
      modalTitle.textContent = 'Modifier le post-it';
      modalText.value = options.text || '';
    }
    modal.classList.remove('hidden');
    modalText.focus();
  }

  function closeModal() {
    modal.classList.add('hidden');
    currentAction = null;
    currentPostitId = null;
  }

  modalCancel?.addEventListener('click', () => {
    closeModal();
  });

  modalSave?.addEventListener('click', async () => {
    const text = modalText.value.trim();
    if (!text) {
      alert('Le texte ne peut pas être vide.');
      return;
    }
    if (currentAction === 'create') {
      await createPostit({ text, ...createCoords });
    } else if (currentAction === 'edit' && currentPostitId != null) {
      await editPostit(currentPostitId, text);
    }
    closeModal();
  });

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeModal();
    }
  });

  if (!modal.classList.contains('hidden')) {
    modal.addEventListener('click', e => {
      if (e.target === modal) closeModal();
    });
  }

  boardEl.addEventListener('dblclick', e => {
    if (!isLoggedIn()) {
      alert('Vous devez être connecté pour créer un post-it.');
      return;
    }
    const rect = boardEl.getBoundingClientRect();
    const rawX = e.clientX - rect.left - 100;
    const rawY = e.clientY - rect.top - 50;
    const maxX = Math.max(0, Math.floor(rect.width - 210));
    const maxY = Math.max(0, Math.floor(rect.height - 140));
    createCoords = {
      x: Math.min(Math.max(0, rawX), maxX),
      y: Math.min(Math.max(0, rawY), maxY)
    };
    openModal('create');
  });

  // Mobile: double-tap to create (dblclick doesn't reliably fire on touch)
  boardEl.addEventListener(
    'touchend',
    e => {
      if (e.changedTouches?.length !== 1) return;
      if (!isLoggedIn()) return;
      // If user is dragging a post-it, don't treat it as board tap
      if (e.target && e.target.closest && e.target.closest('.postit')) return;

      const now = Date.now();
      const touch = e.changedTouches[0];
      const rect = boardEl.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      const dt = now - lastTap.t;
      const dx = Math.abs(x - lastTap.x);
      const dy = Math.abs(y - lastTap.y);

      lastTap = { t: now, x, y };

      if (dt > 0 && dt < 320 && dx < 22 && dy < 22) {
        const maxX = Math.max(0, Math.floor(rect.width - 210));
        const maxY = Math.max(0, Math.floor(rect.height - 140));
        createCoords = {
          x: Math.min(Math.max(0, x - 100), maxX),
          y: Math.min(Math.max(0, y - 50), maxY)
        };
        openModal('create');
        e.preventDefault();
      }
    },
    { passive: false }
  );

  async function createPostit({ text, x, y }) {
    try {
      const res = await fetch('/ajouter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          x: Math.round(x),
          y: Math.round(y),
          board: boardEl.dataset.board || 'default'
        })
      });
      const data = await res.json();
      if (!data.ok) {
        alert('Erreur lors de la création: ' + (data.error || 'INCONNUE'));
        return;
      }
      addPostitElement(data.postit);
    } catch (err) {
      console.error(err);
      alert('Erreur réseau lors de la création.');
    }
  }

  async function editPostit(id, text) {
    try {
      const res = await fetch('/modifier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, text })
      });
      const data = await res.json();
      if (!data.ok) {
        alert('Erreur lors de la modification: ' + (data.error || 'INCONNUE'));
        return;
      }
      const el = boardEl.querySelector(`.postit[data-id="${id}"] .postit-body`);
      if (el) el.textContent = text;
    } catch (err) {
      console.error(err);
      alert('Erreur réseau lors de la modification.');
    }
  }

  async function deletePostit(id) {
    if (!confirm('Supprimer ce post-it ?')) return;
    try {
      const res = await fetch('/effacer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (!data.ok) {
        alert('Erreur lors de la suppression: ' + (data.error || 'INCONNUE'));
        return;
      }
      const el = boardEl.querySelector(`.postit[data-id="${id}"]`);
      if (el) el.remove();
    } catch (err) {
      console.error(err);
      alert('Erreur réseau lors de la suppression.');
    }
  }

  function addPostitElement(p) {
    const div = document.createElement('div');
    div.className = 'postit';
    div.dataset.id = p.id;
    div.dataset.authorId = p.author_id;
    div.style.left = `${p.x}px`;
    div.style.top = `${p.y}px`;
    div.style.zIndex = p.z_index || 1;

    const header = document.createElement('div');
    header.className = 'postit-header';

    const authorSpan = document.createElement('span');
    authorSpan.className = 'postit-author';
    authorSpan.textContent = p.author_name;

    const dateSpan = document.createElement('span');
    dateSpan.className = 'postit-date';
    dateSpan.textContent = new Date(p.created_at).toLocaleString('fr-FR');

    header.appendChild(authorSpan);
    header.appendChild(dateSpan);

    if (window.CURRENT_USER && (window.CURRENT_USER.id === p.author_id || window.CURRENT_USER.can_admin)) {
      const editBtn = document.createElement('button');
      editBtn.className = 'icon-button edit-postit';
      editBtn.title = 'Modifier';
      editBtn.textContent = '✏️';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'icon-button delete-postit';
      deleteBtn.title = 'Supprimer';
      deleteBtn.textContent = '✖';

      header.appendChild(editBtn);
      header.appendChild(deleteBtn);
    }

    const body = document.createElement('div');
    body.className = 'postit-body';
    body.textContent = p.text;

    div.appendChild(header);
    div.appendChild(body);

    boardEl.appendChild(div);
    makeDraggable(div);
  }

  boardEl.addEventListener('click', e => {
    const deleteBtn = e.target.closest('.delete-postit');
    if (deleteBtn) {
      const postit = deleteBtn.closest('.postit');
      if (!postit) return;
      const id = postit.dataset.id;
      deletePostit(id);
      return;
    }
    const editBtn = e.target.closest('.edit-postit');
    if (editBtn) {
      const postit = editBtn.closest('.postit');
      if (!postit) return;
      const id = postit.dataset.id;
      const body = postit.querySelector('.postit-body');
      const text = body ? body.textContent : '';
      openModal('edit', { id, text });
      return;
    }
  });

  function makeDraggable(el) {
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;
    let dragging = false;

    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      // Don't start drag when interacting with controls (edit/delete)
      if (e.target && e.target.closest && e.target.closest('.icon-button')) return;
      const id = el.dataset.id;
      if (!id) return;
      if (!window.CURRENT_USER) return;

      const authorId = Number(el.dataset.authorId);
      const canAdmin = !!window.CURRENT_USER.can_admin;
      const isOwner = window.CURRENT_USER.id === authorId;
      if (!isOwner && !canAdmin) return;

      dragging = true;
      el.setPointerCapture(e.pointerId);

      startX = e.clientX;
      startY = e.clientY;
      originLeft = parseInt(el.style.left || '0', 10);
      originTop = parseInt(el.style.top || '0', 10);

      e.preventDefault();
    }

    function onPointerMove(e) {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newLeft = originLeft + dx;
      let newTop = originTop + dy;

      const rect = boardEl.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();

      if (newLeft < 0) newLeft = 0;
      if (newTop < 0) newTop = 0;
      if (newLeft + elRect.width - rect.left > rect.width) {
        newLeft = rect.width - elRect.width;
      }
      if (newTop + elRect.height - rect.top > rect.height) {
        newTop = rect.height - elRect.height;
      }

      el.style.left = `${newLeft}px`;
      el.style.top = `${newTop}px`;
    }

    async function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      try {
        const id = el.dataset.id;
        const x = parseInt(el.style.left || '0', 10);
        const y = parseInt(el.style.top || '0', 10);
        const res = await fetch('/deplacer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, x, y })
        });
        const data = await res.json();
        if (!data.ok) {
          console.warn('Erreur lors du déplacement', data);
        }
      } catch (err) {
        console.error('Erreur réseau lors du déplacement.', err);
      }
    }

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
  }

  document.querySelectorAll('.postit').forEach(makeDraggable);
  // Initial clamp (useful when opening on a smaller screen)
  scheduleClampAll();
})();

