(() => {
  'use strict';
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const csrf = () => ($('input[name="_csrf"]') || {}).value;

  /* Confirmation avant suppression */
  document.addEventListener('submit', e => {
    const f = e.target.closest('form[data-confirm]') || (e.submitter && e.submitter.form && e.submitter.form.matches('[data-confirm]') ? e.submitter.form : null);
    if (f && !confirm(f.dataset.confirm)) e.preventDefault();
  });

  /* Aperçu des images avant envoi */
  $$('[data-preview-input]').forEach(input => input.addEventListener('change', () => {
    const img = $(`[data-preview="${input.dataset.previewInput}"]`);
    if (img && input.files[0]) img.src = URL.createObjectURL(input.files[0]);
  }));

  /* Éditeur de composition */
  const pitch = $('[data-pitch]');
  if (pitch) {
    const formations = JSON.parse($('#formations-data').textContent);
    const sel = $('[data-formation]');
    const picks = () => $$('select[data-pick]', pitch);
    const subs = () => $$('[data-subs] input[type=checkbox]');
    const count = $('[data-count]');

    const layout = () => {
      const f = formations[sel.value];
      $$('.slot', pitch).forEach((slot, i) => {
        const pos = f[i];
        if (!pos) return;
        slot.style.left = pos.x + '%';
        slot.style.top = pos.y + '%';
        $('.slot-label', slot).textContent = pos.label;
      });
    };
    // empêche de choisir deux fois le même joueur
    const sync = () => {
      const chosen = new Set(picks().map(s => s.value).filter(Boolean));
      picks().forEach(s => $$('option', s).forEach(o => { o.disabled = !!o.value && o.value !== s.value && chosen.has(o.value); }));
      subs().forEach(cb => {
        const onPitch = chosen.has(cb.value);
        cb.disabled = onPitch;
        if (onPitch) cb.checked = false;
        cb.closest('label').classList.toggle('is-off', onPitch);
      });
      picks().forEach(s => s.closest('.slot').classList.toggle('is-set', !!s.value));
      const nSubs = subs().filter(c => c.checked).length;
      if (count) count.textContent = `${chosen.size}/11 titulaires · ${nSubs} remplaçant${nSubs > 1 ? 's' : ''}`;
    };
    sel.addEventListener('change', layout);
    pitch.addEventListener('change', sync);
    $('[data-subs]').addEventListener('change', sync);
    sync();
  }

  /* Classement : ajout / suppression de lignes */
  const table = $('[data-rows]');
  if (table) {
    const renumberRadios = () => $$('tbody tr', table).forEach((tr, i) => { $('input[type=radio]', tr).value = i; });
    $('[data-add-row]').addEventListener('click', () => {
      const rows = $$('tbody tr', table);
      const tr = rows[rows.length - 1].cloneNode(true);
      $$('input', tr).forEach(i => { if (i.type === 'radio') i.checked = false; else i.value = ''; });
      $('input[name=rank]', tr).value = rows.length + 1;
      $('tbody', table).appendChild(tr);
      renumberRadios();
    });
    table.addEventListener('click', e => {
      if (!e.target.closest('[data-del-row]')) return;
      if ($$('tbody tr', table).length > 1) e.target.closest('tr').remove();
      renumberRadios();
    });
  }

  /* Album : titre et date repris du match choisi */
  const am = $('[data-album-match]');
  if (am) am.addEventListener('change', () => {
    const o = am.selectedOptions[0];
    const t = $('[data-album-title]'), d = $('[data-album-date]');
    if (o && o.value) {
      if (!t.value) t.value = o.dataset.title;
      if (!d.value) d.value = o.dataset.date;
    }
  });

  /* Envoi de photos par glisser-déposer, par lots, avec progression */
  const dz = $('[data-dropzone]');
  if (dz) {
    const input = $('input[type=file]', dz);
    const bar = $('.progress', dz);
    const send = async files => {
      files = [...files].filter(f => f.type.startsWith('image/'));
      if (!files.length) return;
      bar.hidden = false;
      let done = 0, ok = 0, ko = 0;
      const total = files.length;
      const update = () => { $('div', bar).style.width = (done / total * 100) + '%'; $('span', bar).textContent = `${done} / ${total} photo(s) envoyée(s)…`; };
      update();
      // lots de 5 photos pour éviter les requêtes trop lourdes
      for (let i = 0; i < files.length; i += 5) {
        const fd = new FormData();
        fd.append('_csrf', csrf());
        files.slice(i, i + 5).forEach(f => fd.append('photos', f));
        try {
          const r = await fetch(dz.action, { method: 'POST', body: fd, headers: { Accept: 'application/json', 'X-CSRF-Token': csrf() } });
          const j = await r.json();
          ok += j.ok || 0; ko += j.ko || 0;
        } catch { ko += Math.min(5, files.length - i); }
        done = Math.min(total, i + 5);
        update();
      }
      $('span', bar).textContent = `${ok} photo(s) ajoutée(s)${ko ? `, ${ko} en échec` : ''}. Rechargement…`;
      setTimeout(() => location.reload(), 800);
    };
    input.addEventListener('change', () => send(input.files));
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('is-over'); }));
    dz.addEventListener('drop', e => send(e.dataTransfer.files));
  }

  /* Réglages : recherche des équipes du club sur l'API FFF */
  const find = $('[data-find-teams]');
  if (find) find.addEventListener('click', async () => {
    const out = $('[data-teams-result]');
    const clubId = $('[data-club-id]').value.trim();
    if (!clubId) { out.innerHTML = '<p class="flash flash--error">Renseigne d\'abord le n° de club FFF.</p>'; return; }
    out.innerHTML = '<p class="muted">Recherche en cours…</p>';
    try {
      const r = await fetch('/admin/fff/equipes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() }, body: JSON.stringify({ club_id: clubId, _csrf: csrf() }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Erreur');
      if (!j.teams.length) { out.innerHTML = '<p class="muted">Aucune équipe trouvée.</p>'; return; }
      out.innerHTML = '<p class="small muted">Clique sur l\'engagement de l\'équipe Seniors en D5 pour remplir les champs, puis enregistre.</p><div class="teams-list">' +
        j.teams.map(t => `<button type="button" class="team-choice" data-cp="${esc(t.cp_no)}" data-phase="${esc(t.phase)}" data-poule="${esc(t.poule)}" ${t.cp_no ? '' : 'disabled'}>
          <strong>${esc(t.team)}</strong> <span>${esc(t.category)}</span><br><small>${esc(t.competition)} ${t.poule_name ? '· ' + esc(t.poule_name) : ''}</small></button>`).join('') + '</div>';
    } catch (e) {
      out.innerHTML = `<p class="flash flash--error">${esc(e.message)}</p>`;
    }
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('.team-choice');
    if (!b) return;
    $('input[data-cp]').value = b.dataset.cp;
    $('input[data-phase]').value = b.dataset.phase || 1;
    $('input[data-poule]').value = b.dataset.poule;
    $$('.team-choice').forEach(x => x.classList.toggle('is-picked', x === b));
  });

  /* Réglages : extraction des identifiants depuis une adresse FFF
     - epreuves.fff.fr : …/competition/engagement/444088-seniors-d5/phase/1/11/…
     - site du district : …/competitions?id=444088&poule=11&phase=1…
     - page du club     : …/club/500123-… ou …?cl_no=500123 */
  const fffUrl = $('[data-fff-url]');
  if (fffUrl) fffUrl.addEventListener('input', () => {
    const v = fffUrl.value.trim();
    let cp, phase, poule;
    const a = v.match(/engagement\/(\d+)[^/]*\/phase\/(\d+)\/(\d+)/);
    if (a) [, cp, phase, poule] = a;
    else {
      try {
        const q = new URL(v).searchParams;
        cp = q.get('id') || q.get('cp_no');
        poule = q.get('poule') || q.get('gp_no');
        phase = q.get('phase') || '1';
      } catch { /* pas une adresse complète */ }
    }
    const club = v.match(/\/club\/(\d+)/) || v.match(/[?&]cl_no=(\d+)/);
    if (club) $('input[data-club-id]').value = club[1];
    if (cp && /^\d+$/.test(cp)) $('input[data-cp]').value = cp;
    if (phase && /^\d+$/.test(phase)) $('input[data-phase]').value = phase;
    if (poule && /^\d+$/.test(poule)) $('input[data-poule]').value = poule;
    fffUrl.classList.toggle('is-ok', !!(club || (cp && poule)));
  });

  /* Faits de match : n'affiche que les champs utiles selon le type et l'équipe */
  const faits = $('[data-faits]');
  if (faits) {
    const LABELS = { sub: 'Joueur sortant', own_goal: 'Joueur qui marque contre son camp', missed_penalty: 'Tireur', note: 'Joueur concerné (facultatif)' };
    const update = () => {
      const type = (faits.querySelector('input[name=type]:checked') || {}).value || 'goal';
      const side = (faits.querySelector('input[name=side]:checked') || {}).value || 'us';
      const usPlayer = (side === 'us') !== (type === 'own_goal');
      const show = {
        'us-player': usPlayer,
        'them-player': !usPlayer,
        'assist-us': type === 'goal' && side === 'us',
        'assist-them': type === 'goal' && side === 'them',
        'sub-us': type === 'sub' && side === 'us',
        'sub-them': type === 'sub' && side === 'them'
      };
      $$('[data-show]', faits).forEach(el => {
        const on = !!show[el.dataset.show];
        el.hidden = !on;
        // un champ masqué n'est pas envoyé (évite d'enregistrer une valeur oubliée)
        $$('input, select', el).forEach(i => { i.disabled = !on; });
      });
      $$('[data-label-player]', faits).forEach(l => {
        l.textContent = LABELS[type] || (usPlayer ? (type === 'goal' || type === 'penalty' ? 'Buteur' : 'Joueur') : 'Joueur adverse');
      });
    };
    faits.addEventListener('change', update);
    update();
  }
})();
