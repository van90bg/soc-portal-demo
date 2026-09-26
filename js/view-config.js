/* view-config.js — page 'config' · section 'viewConfig' (prefix .cf-)
   Danh mục vận hành (6 list) + giá trị mặc định + bảng phân quyền roleMap. Editor-only.
   Mọi thao tác sửa chỉ đổi state cục bộ; bấm Lưu gửi ĐÚNG 1 patch gồm các key hợp lệ. */
(function () {
  'use strict';

  var PAGE = 'config';
  var SECTION = 'viewConfig';

  var LISTS = [
    { key: 'stations', label: 'Danh sách Station', def: 'defaultStation' },
    { key: 'teams', label: 'Danh sách Team', def: 'defaultTeam' },
    { key: 'slotcodes', label: 'Danh sách Slot Code (Ca)', def: 'defaultSlotCode' },
    { key: 'departments', label: 'Danh sách Department', def: 'defaultDepartment' },
    { key: 'agencies', label: 'Danh sách Agency', def: '' },
    { key: 'contractTypes', label: 'Danh sách Contract Type', def: '' }
  ];
  var DEFAULTS = [
    { key: 'defaultStation', label: 'Station mặc định', list: 'stations' },
    { key: 'defaultSlotCode', label: 'Ca mặc định', list: 'slotcodes' },
    { key: 'defaultTeam', label: 'Team mặc định', list: 'teams' },
    { key: 'defaultDepartment', label: 'Department mặc định', list: 'departments' }
  ];
  var ROLES = [
    { v: 'viewer', l: 'Viewer — chỉ xem' },
    { v: 'operator', l: 'Operator — vận hành điểm danh' },
    { v: 'manager', l: 'Manager — quản lý vận hành' },
    { v: 'admin', l: 'Admin — toàn quyền' }
  ];
  /* 11 key mà saveSettingsApi chấp nhận — key ngoài danh sách này server trả về ignored */
  var VALID_KEYS = LISTS.map(function (l) { return l.key; })
    .concat(DEFAULTS.map(function (d) { return d.key; })).concat(['roleMap']);

  var snapshot = null;   // settings gốc lúc tải — nền để diff khi Lưu
  var form = null;       // bản đang sửa: list = mảng giá trị, roleList = [{email, role}]
  var draft = { email: '', role: 'viewer' };
  var dirty = false;
  var editMode = false;
  var loading = false;
  var wired = false;

  function esc(v) { return SOC.esc(v); }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function toList(v) { return Array.isArray(v) ? v.slice() : (v ? String(v).split(/\r?\n/) : []); }
  function parseLines(text) {
    var seen = {}, out = [];
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var v = raw.trim();
      if (!v || seen[v]) return;
      seen[v] = 1; out.push(v);
    });
    return out;
  }

  /* ---------- tải ---------- */
  function load(force, btn) {
    if (loading) return;
    loading = true;
    if (btn) SOC.setBtnBusy_(btn, true, 'Đang tải');
    var host = document.getElementById(SECTION);
    if (host) host.innerHTML = '<div class="skeleton-wrap">' +
      '<div class="skeleton-row"><div class="skeleton-cell"></div><div class="skeleton-cell"></div><div class="skeleton-cell"></div></div>' +
      '<div class="skeleton-row"><div class="skeleton-cell"></div><div class="skeleton-cell"></div><div class="skeleton-cell"></div></div>' +
      '<div class="skeleton-row"><div class="skeleton-cell"></div><div class="skeleton-cell"></div><div class="skeleton-cell"></div></div></div>';
    SOC.api.getSettingsApi().then(function (r) {
      loading = false;
      SOC.setBtnBusy_(btn, false);
      if (!r || !r.ok) {
        snapshot = form = null;
        if (host) host.innerHTML = '<div class="card"><div class="empty">' +
          esc((r && r.message) || 'Chỉ editor xem được cấu hình') + '</div></div>';
        SOC.pageActions('');
        return;
      }
      adopt(r.settings || {});
      paint();
    }).catch(function (e) {
      loading = false;
      SOC.setBtnBusy_(btn, false);
      SOC.toast('Lỗi tải cấu hình: ' + e.message, 'err');
      if (host) host.innerHTML = '<div class="card"><div class="empty">Lỗi tải cấu hình: ' + esc(e.message) + '</div></div>';
    });
  }

  function adopt(s) {
    var map = (s && s.roleMap && typeof s.roleMap === 'object') ? s.roleMap : {};
    snapshot = copy(s || {});
    form = { roleList: Object.keys(map).sort().map(function (em) { return { email: em, role: map[em] }; }) };
    LISTS.forEach(function (l) { form[l.key] = toList(s[l.key]); });
    DEFAULTS.forEach(function (d) { form[d.key] = s[d.key] || ''; });
    draft = { email: '', role: 'viewer' };
    dirty = false;
  }

  /* ---------- state hiện tại của form (gồm cả dòng role đang soạn) ---------- */
  function current() {
    var out = {};
    LISTS.forEach(function (l) { out[l.key] = parseLines(form[l.key].join('\n')); });
    DEFAULTS.forEach(function (d) { out[d.key] = form[d.key]; });
    var map = {};
    form.roleList.forEach(function (row) {
      var k = String(row.email || '').trim();
      if (k) map[k] = row.role;
    });
    var dk = String(draft.email || '').trim();
    if (dk) map[dk] = draft.role;
    out.roleMap = map;
    return out;
  }
  function sameMap(a, b) {
    var ka = Object.keys(a || {}), kb = Object.keys(b || {});
    if (ka.length !== kb.length) return false;
    return ka.sort().every(function (k) { return (b || {})[k] === a[k]; });
  }
  function sameList(a, b) {
    var x = a || [], y = b || [];
    return x.length === y.length && x.every(function (v, i) { return v === y[i]; });
  }
  function diff() {
    var cur = current(), patch = {};
    LISTS.forEach(function (l) { if (!sameList(cur[l.key], snapshot[l.key])) patch[l.key] = cur[l.key]; });
    DEFAULTS.forEach(function (d) { if (String(cur[d.key] || '') !== String(snapshot[d.key] || '')) patch[d.key] = cur[d.key]; });
    if (!sameMap(cur.roleMap, snapshot.roleMap)) patch.roleMap = cur.roleMap;
    Object.keys(patch).forEach(function (k) { if (VALID_KEYS.indexOf(k) < 0) delete patch[k]; });
    return patch;
  }
  function syncDirty() {
    dirty = Object.keys(diff()).length > 0;
    var note = document.getElementById('cfDirtyNote');
    if (note) { note.hidden = !dirty; note.textContent = dirty ? 'Có thay đổi chưa lưu' : ''; }
    syncActions();
  }

  /* ---------- render ---------- */
  function paint() {
    var host = document.getElementById(SECTION);
    if (!host || !form) return;
    host.innerHTML =
      '<div class="card cf-card">' +
      '<div class="card__head"><h2 class="section-heading">Danh mục vận hành</h2>' +
      '<span class="pill">' + LISTS.length + ' nhóm</span>' +
      '<span class="info-dirty-note" id="cfDirtyNote" hidden></span></div>' +
      '<div class="cf-body" tabindex="0" role="region" aria-label="Nội dung cấu hình">' + groupsBlock() + defaultsBlock() + rolesBlock() + '</div>' +
      '<div class="card__foot"><span id="cfSummary"></span>' +
      '<span class="cf-foot-hint">Chỉ lưu các danh mục vừa thay đổi — riêng bảng phân quyền được ghi lại toàn bộ</span></div>' +
      '</div>';
    syncActions();
    syncDirty();
    refreshSummary();
    wireOnce(host);
  }

  function groupsBlock() {
    return '<div class="cf-groups">' + LISTS.map(function (l) {
      var items = form[l.key];
      var defVal = l.def ? form[l.def] : '';
      var isDef = defVal && items.indexOf(defVal) >= 0;
      return '<label class="fld cf-group"><span>' + esc(l.label) +
        ' <b class="pill" data-count="' + esc(l.key) + '">' + items.length + '</b>' +
        (isDef ? '<b class="pill cf-default">' + esc(defVal) + '</b>' : '') + '</span>' +
        '<textarea rows="5" data-list="' + esc(l.key) + '" spellcheck="false" placeholder="Mỗi dòng một giá trị"' +
        (editMode ? '' : ' disabled') + '>' + esc(items.join('\n')) + '</textarea></label>';
    }).join('') + '</div>';
  }

  function defaultsBlock() {
    return '<h3 class="cf-sub">Giá trị mặc định</h3><div class="form-grid">' + DEFAULTS.map(function (d) {
      var opts = form[d.list] || [];
      var html = '<label class="fld"><span>' + esc(d.label) + '</span><select data-def="' + esc(d.key) + '"' + (editMode ? '' : ' disabled') + '>' +
        '<option value="">— Không chọn —</option>';
      if (form[d.key] && opts.indexOf(form[d.key]) < 0) {
        html += '<option value="' + esc(form[d.key]) + '" selected>' + esc(form[d.key]) + ' (ngoài danh sách)</option>';
      }
      opts.forEach(function (v) {
        html += '<option value="' + esc(v) + '"' + (v === form[d.key] ? ' selected' : '') + '>' + esc(v) + '</option>';
      });
      return html + '</select></label>';
    }).join('') + '</div>';
  }

  function rolesBlock() {
    var rows = form.roleList.map(function (row, i) { return roleRow(row.email, row.role, i, false); }).join('');
    if (editMode) rows += roleRow(draft.email, draft.role, -1, true);
    if (!rows) rows = '<tr><td colspan="3"><div class="cf-none">Chưa có phân quyền — người dùng mặc định role thấp nhất</div></td></tr>';
    return '<h3 class="cf-sub">Phân quyền (roleMap)</h3>' +
      '<div class="cf-rolerow"><span class="cf-sub cf-sub-inline">Bốn mức quyền tăng dần: viewer &lt; operator &lt; manager &lt; admin — khớp hệ thống chấm công</span></div>' +
      '<div class="table-wrap cf-rolewrap"><table class="cf-roles"><caption class="sr-only">Bảng phân quyền theo email</caption>' +
      '<thead><tr><th scope="col">Email</th><th scope="col">Vai trò</th>' +
      '<th scope="col" class="c">' + (editMode ? 'Thao tác' : '') + '</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      (editMode ? '<p class="info-err" id="cfRoleErr" hidden></p>' : '');
  }

  function roleRow(email, role, idx, isDraft) {
    var sel = '<select data-role="' + idx + '" aria-label="Vai trò của ' + esc(email || 'dòng mới') + '"' +
      (editMode ? '' : ' disabled') + '>' + ROLES.map(function (r) {
      return '<option value="' + esc(r.v) + '"' + (r.v === role ? ' selected' : '') + '>' + esc(r.l) + '</option>';
    }).join('') + '</select>';
    var cell = editMode
      ? '<input type="email" class="cf-email" data-email="' + idx + '" value="' + esc(email) + '" placeholder="ten@domain.vn" spellcheck="false" aria-label="Email người dùng">'
      : '<span class="cf-email-ro">' + esc(email || '—') + '</span>';
    return '<tr' + (isDraft ? ' class="cf-row-new"' : '') + '>' +
      '<td>' + cell + '</td><td class="cf-rolecell">' + sel + '</td>' +
      '<td class="c">' + (!isDraft && editMode
        ? '<button type="button" class="btn btn-ghost btn-sm" data-del="' + idx + '" aria-label="Xóa phân quyền cho ' + esc(email) + '" title="Xóa">' + SOC.ico('trash', 14) + '</button>' : '') +
      '</td></tr>';
  }

  function refreshSummary() {
    var el = document.getElementById('cfSummary');
    if (!el || !form) return;
    var items = 0;
    LISTS.forEach(function (l) { items += (form[l.key] || []).length; });
    el.textContent = LISTS.length + ' nhóm danh mục · ' + items + ' mục · ' +
      Object.keys(current().roleMap).length + ' email được phân quyền';
  }
  function refreshCount(key) {
    var box = document.getElementById(SECTION);
    var el = box && box.querySelector('[data-count="' + key + '"]');
    if (!el) return;
    var ta = box.querySelector('textarea[data-list="' + key + '"]');
    el.textContent = parseLines(ta ? ta.value : '').length;
  }

  /* ---------- nút trang (slot #pageActions) ---------- */
  function syncActions() {
    var html = '<button type="button" class="btn btn-outline" data-cf-edit aria-pressed="' + (editMode ? 'true' : 'false') + '">' +
      '<span class="btn-label">Sửa</span>' + SOC.ico('edit', 16) + '</button>';
    if (dirty) html += '<button type="button" class="btn btn-ghost" data-cf-discard><span class="btn-label">Bỏ chỉnh sửa</span>' + SOC.ico('close', 16) + '</button>';
    html += '<button type="button" class="btn btn-outline" data-cf-refresh><span class="btn-label">Cập nhật</span>' + SOC.ico('refresh', 16) + '</button>';
    if (dirty) html += '<button type="button" class="btn" data-cf-save><span class="btn-label">Lưu</span>' + SOC.ico('check', 16) + '</button>';
    var host = SOC.pageActions(html);
    if (!host) return;
    var on = function (sel, fn) { var el = host.querySelector(sel); if (el) el.addEventListener('click', fn); };
    on('[data-cf-edit]', toggleEdit);
    on('[data-cf-refresh]', function (e) {
      if (dirty) {
        SOC.confirm({ title: 'Chưa lưu cấu hình', message: 'Cập nhật sẽ bỏ toàn bộ thay đổi cấu hình chưa lưu. Tiếp tục?', okLabel: 'Cập nhật' })
          .then(function (ok) { if (ok) { adopt(snapshot); editMode = false; paint(); } });
        return;
      }
      load(true, e.currentTarget);
    });
    on('[data-cf-discard]', function () {
      adopt(snapshot);
      paint();
      SOC.toast('Đã bỏ mọi thay đổi chưa lưu');
    });
    on('[data-cf-save]', function (e) { save(e.currentTarget); });
  }

  function toggleEdit() {
    editMode = !editMode;
    if (!editMode) draft = { email: '', role: 'viewer' };
    paint();
  }

  function save(btn) {
    if (!validDraft()) return;
    var patch = diff();
    if (!Object.keys(patch).length) { SOC.toast('Không có thay đổi để lưu'); return; }
    SOC.setBtnBusy_(btn, true, 'Đang lưu');
    SOC.api.saveSettingsApi(patch).then(function (r) {
      SOC.setBtnBusy_(btn, false);
      if (!r || !r.ok) { SOC.toast((r && r.message) || 'Không lưu được cấu hình', 'err'); return; }
      var merged = copy(snapshot);
      Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; });
      adopt(merged);
      editMode = false;
      paint();
      var msg = r.message || ('Đã lưu ' + (r.saved || []).length + ' mục cấu hình');
      if (r.ignored && r.ignored.length) msg += ' · server bỏ qua: ' + r.ignored.join(', ');
      SOC.toast(msg, (r.ignored && r.ignored.length) ? 'err' : 'ok');
    }).catch(function (e) {
      SOC.setBtnBusy_(btn, false);
      SOC.toast('Lỗi lưu cấu hình: ' + e.message, 'err');
    });
  }

  function validDraft() {
    var err = document.getElementById('cfRoleErr');
    var dk = String(draft.email || '').trim();
    var bad = '';
    if (dk && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dk)) bad = 'Email đang soạn không hợp lệ.';
    else if (dk && form.roleList.some(function (r) { return r.email === dk; })) bad = 'Email này đã có trong danh sách phân quyền.';
    if (err) { err.hidden = !bad; err.textContent = bad; }
    if (bad) SOC.toast(bad, 'err');
    return !bad;
  }

  /* ---------- wire 1 lần trên section (nội dung thay bằng innerHTML, listener sống trên root) ---------- */
  function wireOnce(host) {
    if (wired) return;
    host.addEventListener('input', function (e) {
      var t = e.target;
      if (t.tagName === 'TEXTAREA' && t.dataset.list) {
        form[t.dataset.list] = parseLines(t.value);
        refreshCount(t.dataset.list);
        refreshSummary();
        syncDirty();
      } else if (t.classList && t.classList.contains('cf-email')) {
        var row = mailAt(t.getAttribute('data-email'));
        if (row) row.email = t.value;
        syncDirty();
      }
    });
    host.addEventListener('change', function (e) {
      var t = e.target;
      if (t.tagName !== 'SELECT') return;
      if (t.dataset.def) { form[t.dataset.def] = t.value; paint(); return; }
      if (t.dataset.role) {
        var row = mailAt(t.getAttribute('data-role'));
        if (row) row.role = t.value;
        syncDirty();
      }
    });
    host.addEventListener('click', function (e) {
      var del = e.target && e.target.closest ? e.target.closest('[data-del]') : null;
      if (!del) return;
      var i = parseInt(del.getAttribute('data-del'), 10);
      if (form.roleList[i]) { form.roleList.splice(i, 1); paint(); }
    });
    /* trang chạy trên WebApp: không có router riêng để chặn đổi view nên dùng beforeunload */
    window.addEventListener('beforeunload', function (e) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });
    wired = true;
  }
  /* idx -1 = dòng đang soạn; khác = index trong roleList (đúng thứ tự render) */
  function mailAt(idx) {
    var i = parseInt(idx, 10);
    if (i === -1) return draft;
    return form.roleList[i] || null;
  }

  SOC.registerView(PAGE, {
    section: SECTION,
    render: function (ctx) {
      var force = !!(ctx && ctx.force);
      if (form && !force) { paint(); return; }
      if (force && dirty) {
        SOC.confirm({ title: 'Chưa lưu cấu hình', message: 'Cập nhật sẽ bỏ toàn bộ thay đổi cấu hình chưa lưu. Tiếp tục?', okLabel: 'Cập nhật' })
          .then(function (ok) { if (ok) load(true, null); });
        return;
      }
      load(force, null);
    }
  });
})();
