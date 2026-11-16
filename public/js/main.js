(() => {
  'use strict';
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* Menu mobile */
  const toggle = $('.nav-toggle');
  if (toggle) toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', open);
    $('#nav').classList.toggle('open', open);
  });

  /* Compte à rebours avant le coup d'envoi (heure de Paris) */
  const parisOffset = date => {
    // décalage Europe/Paris (en minutes) pour la date donnée
    const s = date.toLocaleString('en-US', { timeZone: 'Europe/Paris', timeZoneName: 'shortOffset' });
    const m = s.match(/GMT([+-]\d+)(?::(\d+))?/);
    return m ? (Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2] || 0)) : 60;
  };
  $$('.countdown[data-kickoff]').forEach(el => {
    const naive = new Date(el.dataset.kickoff + 'Z');
    const target = new Date(naive.getTime() - parisOffset(naive) * 60000);
    const render = () => {
      const diff = target - new Date();
      if (Number.isNaN(diff)) { el.innerHTML = ''; return; }
      if (diff <= 0) { el.innerHTML = diff > -2 * 3600e3 ? '<div><b>⚽</b><span>En cours</span></div>' : ''; return; }
      const d = Math.floor(diff / 864e5), h = Math.floor(diff / 36e5) % 24, m = Math.floor(diff / 6e4) % 60, s = Math.floor(diff / 1e3) % 60;
      el.innerHTML = [[d, 'jours'], [h, 'h'], [m, 'min'], [s, 's']]
        .map(([v, l]) => `<div><b>${String(v).padStart(2, '0')}</b><span>${l}</span></div>`).join('');
    };
    render();
    setInterval(render, 1000);
  });

  /* Onglets du calendrier (tous / à venir / résultats) */
  const tabs = $('[data-tabs]');
  const panel = $('[data-tab-panel]');
  if (tabs && panel) {
    const rows = $$('[data-kind]', panel);
    tabs.addEventListener('click', e => {
      const b = e.target.closest('button[data-tab]');
      if (!b) return;
      const tab = b.dataset.tab;
      $$('button', tabs).forEach(x => x.setAttribute('aria-selected', x === b));
      rows.forEach(r => { r.hidden = tab !== 'all' && r.dataset.kind !== tab; });
      // résultats : du plus récent au plus ancien
      (tab === 'done' ? [...rows].reverse() : rows).forEach(r => panel.appendChild(r));
    });
  }

  /* Filtre de l'effectif par poste */
  const filter = $('[data-filter]');
  if (filter) filter.addEventListener('click', e => {
    const b = e.target.closest('button[data-pos]');
    if (!b) return;
    $$('button', filter).forEach(x => x.setAttribute('aria-selected', x === b));
    $$('[data-group]').forEach(g => { g.hidden = b.dataset.pos !== 'all' && g.dataset.group !== b.dataset.pos; });
  });

  /* Fiche joueur en fenêtre */
  const dataEl = $('#players-data');
  const modal = $('#player-modal');
  if (dataEl && modal && typeof modal.showModal === 'function') {
    const players = new Map(JSON.parse(dataEl.textContent).map(p => [String(p.id), p]));
    const content = $('.pm-content', modal);
    const open = p => {
      const facts = [
        ['Âge', p.age ? p.age + ' ans' : ''],
        ['Taille', p.height ? (p.height / 100).toFixed(2).replace('.', ',') + ' m' : ''],
        ['Pied', p.foot], ['Au club depuis', p.joined], ['Ancien club', p.previous_club]
      ].filter(f => f[1]);
      const s = p.stats;
      content.innerHTML = `
        <div class="player-detail">
          <div class="pd-photo"><img src="${esc(p.photo)}" alt="">${p.number ? `<span class="pc-num pc-num--lg">${esc(p.number)}</span>` : ''}</div>
          <div class="pd-body">
            <span class="eyebrow eyebrow--dark">${esc(p.role || p.position)}${p.is_captain ? ' · Capitaine' : ''}</span>
            <h1 id="pm-name">${esc(p.first_name)} <span>${esc(p.last_name)}</span></h1>
            ${p.nickname ? `<p class="muted">« ${esc(p.nickname)} »</p>` : ''}
            ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
            ${p.staff ? '' : `<div class="stats"><div><b>${s.matches}</b><span>Matchs</span></div><div><b>${s.goals}</b><span>Buts</span></div><div><b>${s.assists}</b><span>Passes D.</span></div><div><b>${s.yellow}</b><span>🟨</span></div><div><b>${s.red}</b><span>🟥</span></div></div>`}
            ${p.bio_html ? `<div class="prose">${p.bio_html}</div>` : ''}
          </div>
        </div>`;
      if (!modal.open) modal.showModal();
    };
    document.addEventListener('click', e => {
      const a = e.target.closest('a[data-player]');
      if (!a || e.metaKey || e.ctrlKey) return;
      const p = players.get(a.dataset.player);
      if (!p) return;
      e.preventDefault();
      open(p);
      history.replaceState(null, '', '#joueur-' + p.id);
    });
    modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-close]')) modal.close(); });
    modal.addEventListener('close', () => history.replaceState(null, '', location.pathname));
    const m = location.hash.match(/^#joueur-(\d+)/);
    if (m && players.get(m[1])) open(players.get(m[1]));
  }

  /* Lightbox de la photothèque */
  const gallery = $('[data-gallery]');
  const lb = $('.lightbox');
  if (gallery && lb) {
    const items = $$('.gallery-item', gallery);
    const img = $('img', lb), cap = $('figcaption', lb), dl = $('.lb-dl', lb);
    let i = 0;
    const show = n => {
      i = (n + items.length) % items.length;
      const it = items[i];
      img.src = it.href;
      cap.textContent = it.dataset.caption || `${i + 1} / ${items.length}`;
      dl.href = it.href;
      lb.hidden = false;
      document.body.style.overflow = 'hidden';
    };
    const close = () => { lb.hidden = true; img.removeAttribute('src'); document.body.style.overflow = ''; };
    gallery.addEventListener('click', e => {
      const a = e.target.closest('.gallery-item');
      if (!a) return;
      e.preventDefault();
      show(items.indexOf(a));
    });
    $('.lb-prev', lb).onclick = () => show(i - 1);
    $('.lb-next', lb).onclick = () => show(i + 1);
    $('.lb-close', lb).onclick = close;
    lb.addEventListener('click', e => { if (e.target === lb || e.target.tagName === 'FIGURE') close(); });
    document.addEventListener('keydown', e => {
      if (lb.hidden) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') show(i - 1);
      if (e.key === 'ArrowRight') show(i + 1);
    });
    let x0 = null;
    lb.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener('touchend', e => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1));
      x0 = null;
    });
  }
})();
