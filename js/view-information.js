/* view-information.js — Nhân sự (sheet Information): danh bạ team + thêm/sửa/vô hiệu hóa.
   Đọc: getInformationApi (14 cột) + getFilterOptionsApi (meta Station/Team/Contract — gate operator, nuôi cột chi tiết + thẻ).
   Ghi: appendInformationApi / updateInformationApi({…, row, oldEmail}) / deleteInformationApi({row, email}).
   "Xóa" phía server chỉ chuyển status = "Đã nghỉ" (giữ dòng + lịch sử ca) → confirm phải nói rõ hệ quả. */
(function () {
  'use strict';

  var COLS = [
    { k: 'no', h: 'STT', c: 'num', s: true },
    { k: 'name', h: 'Họ tên', s: true },
    { k: 'staffId', h: 'Mã NV', s: true },
    { k: 'opsId', h: 'Mã OPS', s: true },
    { k: 'email', h: 'Email', s: true },
    { k: 'rank', h: 'Cấp bậc', s: true },
    { k: 'joinedDate', h: 'Ngày vào', s: true },
    { k: 'birthday', h: 'Ngày sinh', s: true },
    { k: 'phone', h: 'SĐT' },
    { k: 'address', h: 'Địa chỉ' },
    { k: 'gender', h: 'Giới tính', c: 'c' },
    { k: 'equipment', h: 'Thiết bị' },
    { k: 'status', h: 'Trạng thái' },
    { k: 'valid', h: 'Nhãn' }
  ];
  var GENDERS = ['Nam', 'Nữ', 'Khác'];
  var STATUSES = ['Đang làm', 'Đã nghỉ'];
  var BDAYS_WINDOW = 30;
  var BDAYS_SHOW = 8;

  var IF = {
    rows: [], meta: {}, loaded: false, loading: false, metaLoaded: false,
    q: '', status: '', sort: { k: 'name', dir: 'asc' },
    sel: null, mode: 'view', form: null, err: '', shell: false
  };
  var wired = false, actionsWired = false;

  /* ---------- helper ---------- */
  function infSec() { return document.getElementById('viewInformation'); }
  function infHost(id) { var s = infSec(); return s && s.querySelector('#' + id); }
  function offRow(r) { return String(r.status || '') === 'Đã nghỉ'; }
  function metaOf(r) { return IF.meta[String(r.opsId || '')] || {}; }
  function byRow(row) {
    for (var i = 0; i < IF.rows.length; i++) if (IF.rows[i].row === row) return IF.rows[i];
    return null;
  }

  /* Sinh nhật kế tiếp tính theo dd/MM để không lệch vì múi giờ — cùng công thức với prod */
  function bdayOf(birthday) {
    var m = String(birthday || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    var t = new Date(); t.setHours(0, 0, 0, 0);
    var born = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var nx = new Date(t.getFullYear(), Number(m[2]) - 1, Number(m[3]));
    if (nx < t) nx = new Date(t.getFullYear() + 1, Number(m[2]) - 1, Number(m[3]));
    return { next: SOC.isoDay(nx), until: Math.round((nx - t) / 86400000), age: Math.floor((t - born) / 31557600000) };
  }

  function matches(r) {
    var q = IF.q.trim().toLowerCase();
    if (q) {
      var hay = [r.name, r.opsId, r.staffId, r.email].join(' ').toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    if (IF.status === 'on' && offRow(r)) return false;
    if (IF.status === 'off' && !offRow(r)) return false;
    if (IF.status === 'fix' && r.valid) return false;
    return true;
  }

  function sorted(rows) {
    var k = IF.sort.k, dir = IF.sort.dir === 'desc' ? -1 : 1;
    return rows.slice().sort(function (a, b) {
      if (k === 'no') return (Number(a.no) - Number(b.no)) * dir;
      if (k === 'valid') return ((a.valid ? 1 : 0) - (b.valid ? 1 : 0)) * dir ||
        String(a.name || '').localeCompare(String(b.name || ''), 'vi');
      return String(a[k] || '').localeCompare(String(b[k] || ''), 'vi') * dir;
    });
  }

  function visible() { return sorted(IF.rows.filter(matches)); }

  /* ---------- khung ---------- */
  function infSkeleton() {
    var rows = '', i;
    for (i = 0; i < 10; i++) {
      rows += '<div class="skeleton-row"><div class="skeleton-cell"></div><div class="skeleton-cell"></div>' +
        '<div class="skeleton-cell"></div><div class="skeleton-cell"></div><div class="skeleton-cell"></div></div>';
    }
    if (infSec()) infSec().innerHTML = '<div class="card"><div class="skeleton-wrap" aria-busy="true" aria-label="Đang tải danh bạ">' + rows + '</div></div>';
    IF.shell = false;
    SOC.pageActions('');
  }

  function shellHtml() {
    return '<div class="split">' +
      '<div class="card">' +
        '<div class="card__head">' +
          '<h2 class="section-heading">' + SOC.ico('information', 16) + '<span>Danh bạ team</span></h2>' +
          '<span class="pill" id="infCount" role="status">—</span>' +
          '<div class="list-search" role="search" aria-label="Tìm nhân sự">' +
            '<input type="search" id="infSearch" placeholder="Tên, Mã OPS, Mã NV, email…" autocomplete="off" spellcheck="false" aria-label="Tìm theo tên, Mã OPS hoặc email">' +
            '<button type="button" class="btn-icon" data-act="inf.clear" aria-label="Xóa từ khóa">' + SOC.ico('close', 18) + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="stats-filters" id="infFilterHost"></div>' +
        '<div class="inf-list" id="infListHost"></div>' +
      '</div>' +
      '<div class="split__side" id="infSideHost"></div>' +
    '</div>';
  }

  function paintFilters() {
    var h = infHost('infFilterHost');
    if (!h) return;
    var statusChips = [['', 'Tất cả'], ['on', 'Đang làm'], ['off', 'Đã nghỉ'], ['fix', 'Cần sửa']].map(function (s) {
      return '<button type="button" class="chip' + (IF.status === s[0] ? ' on' : '') + '" data-filter="status" data-value="' +
        SOC.esc(s[0]) + '" aria-pressed="' + (IF.status === s[0] ? 'true' : 'false') + '">' + s[1] + '</button>';
    }).join('');
    var total = visible().length;
    h.innerHTML =
      '<div class="frow"><span class="flabel">Trạng thái</span><div class="chips">' + statusChips + '</div></div>' +
      '<div class="frow"><span class="filter-count" role="status">' + total + '/' + IF.rows.length + ' nhân sự</span>' +
      (total !== IF.rows.length ? ' <button type="button" class="btn-clear-filter" data-act="inf.reset" aria-label="Xóa bộ lọc">×</button>' : '') +
      '</div>';
  }

  /* ---------- bảng (desktop) + thẻ (mobile) ---------- */
  function openBtn(r, extra) {
    return '<button type="button" class="inf-open' + (IF.sel === r.row ? ' on' : '') + (extra || '') +
      '" data-row="' + SOC.esc(r.row) + '" aria-pressed="' + (IF.sel === r.row ? 'true' : 'false') + '">' +
      '<span class="avatar" aria-hidden="true">' + SOC.esc(SOC.initials(r.name || r.opsId)) + '</span>' +
      '<span class="inf-open__n">' + SOC.esc(r.name || '—') + '</span></button>';
  }

  function linkTel(v) {
    return '<a class="inf-link" href="tel:' + SOC.esc(String(v).replace(/[^+0-9]/g, '')) + '">' + SOC.esc(v) + '</a>';
  }

  function infCellHtml(r, col) {
    var b, sn;
    switch (col.k) {
      case 'no': return '<td class="num">' + SOC.esc(r.no || '') + '</td>';
      case 'name': return '<td>' + openBtn(r) + '</td>';
      case 'staffId': return '<td class="num">' + SOC.esc(r.staffId || '—') + '</td>';
      case 'opsId': return '<td class="num">' + SOC.esc(r.opsId || '—') + '</td>';
      case 'email': return '<td><a class="inf-link" href="mailto:' + SOC.esc(r.email || '') + '">' + SOC.esc(r.email || '—') + '</a></td>';
      case 'rank': return '<td>' + (r.rank ? '<span class="pill">' + SOC.esc(r.rank) + '</span>' : '<span class="c-empty">—</span>') + '</td>';
      case 'joinedDate': return '<td class="num">' + SOC.esc(r.joinedDate || '—') + '</td>';
      case 'birthday':
        b = bdayOf(r.birthday);
        sn = b && b.until <= BDAYS_WINDOW ? '<span class="pill inf-sn">' + (b.until === 0 ? 'hôm nay' : '+' + b.until) + '</span>' : '';
        return '<td class="num">' + SOC.esc(r.birthday || '—') + sn + '</td>';
      case 'phone': return '<td class="num">' + (r.phone ? linkTel(r.phone) : '—') + '</td>';
      case 'address': return '<td title="' + SOC.esc(r.address || '') + '">' + SOC.esc(r.address || '—') + '</td>';
      case 'gender': return '<td class="c">' + SOC.esc(r.gender || '—') + '</td>';
      case 'equipment': return '<td title="' + SOC.esc(r.equipment || '') + '">' + SOC.esc(r.equipment || '—') + '</td>';
      case 'status': return '<td><span class="badge ' + (offRow(r) ? 'inf-off' : 'inf-on') + '">' + SOC.esc(r.status || (offRow(r) ? 'Đã nghỉ' : 'Đang làm')) + '</span></td>';
      case 'valid': return '<td>' + (r.valid ? '<span class="pill">Hợp lệ</span>' : '<span class="pill inf-invalid">Cần sửa</span>') + '</td>';
      default: return '<td></td>';
    }
  }

  function headCell(c) {
    var cls = [];
    if (c.c) cls.push(c.c);
    if (c.s) cls.push('sortable');
    var on = IF.sort.k === c.k;
    return '<th scope="col"' + (cls.length ? ' class="' + cls.join(' ') + '"' : '') +
      (c.s ? ' data-sort="' + c.k + '" tabindex="0" aria-sort="' + (on ? (IF.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '"' : '') +
      '>' + SOC.esc(c.h) + '</th>';
  }

  function infTableHtml(rows) {
    return '<div class="table-wrap inf-tablewrap"><table class="inf-table">' +
      '<caption class="sr-only">Danh bạ nhân sự đọc từ sheet Information — bấm tên một người để xem chi tiết</caption>' +
      '<thead><tr>' + COLS.map(headCell).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr data-row="' + SOC.esc(r.row) + '"' + (IF.sel === r.row ? ' class="is-active"' : '') + '>' +
          COLS.map(function (c) { return infCellHtml(r, c); }).join('') + '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  function tilesHtml(rows) {
    return '<div class="inf-scroll"><div class="grid-cards inf-cards">' + rows.map(function (r) {
      var m = metaOf(r), b = bdayOf(r.birthday);
      return '<div class="card card--fit inf-tile' + (IF.sel === r.row ? ' is-active' : '') + '" data-row="' + SOC.esc(r.row) + '">' +
        '<div class="card__head">' + openBtn(r) +
          '<span class="badge ' + (offRow(r) ? 'inf-off' : 'inf-on') + '">' + SOC.esc(r.status || 'Đang làm') + '</span></div>' +
        '<dl class="defs pane">' +
          '<dt>Mã OPS</dt><dd class="num">' + SOC.esc(r.opsId || '—') + '</dd>' +
          '<dt>Cấp bậc</dt><dd>' + SOC.esc(r.rank || '—') + '</dd>' +
          '<dt>Email</dt><dd>' + SOC.esc(r.email || '—') + '</dd>' +
          '<dt>SĐT</dt><dd class="num">' + SOC.esc(r.phone || '—') + '</dd>' +
          '<dt>Station / Team</dt><dd>' + SOC.esc([m.station, m.team].filter(Boolean).join(' · ') || '—') + '</dd>' +
          '<dt>Sinh nhật</dt><dd>' + (b ? SOC.esc(r.birthday) + (b.until <= BDAYS_WINDOW ? ' · còn ' + b.until + ' ngày' : '') : '—') + '</dd>' +
        '</dl></div>';
    }).join('') + '</div></div>';
  }

  function paintList() {
    var h = infHost('infListHost');
    if (!h) return;
    var rows = visible();
    var cnt = infHost('infCount');
    if (cnt) cnt.textContent = rows.length + '/' + IF.rows.length + ' nhân sự';
    if (!IF.rows.length) { h.innerHTML = '<div class="empty">Chưa đọc được dữ liệu nhân sự</div>'; return; }
    if (!rows.length) { h.innerHTML = '<div class="empty">Không có nhân sự nào khớp bộ lọc</div>'; return; }
    h.innerHTML = infTableHtml(rows) + tilesHtml(rows);
  }

  /* ---------- cột phải: chi tiết / biểu mẫu / sinh nhật ---------- */
  function defRow(dt, dd) { return '<dt>' + dt + '</dt><dd>' + dd + '</dd>'; }

  function detailHtml(r) {
    var m = metaOf(r), b = bdayOf(r.birthday);
    return '<div class="card">' +
      '<div class="card__head">' +
        '<h2 class="section-heading">' + SOC.ico('personal', 16) + '<span>Chi tiết nhân sự</span></h2>' +
      '</div>' +
      '<div class="pane inf-detail"><dl class="defs">' +
        defRow('Họ tên', '<b>' + SOC.esc(r.name || '—') + '</b>') +
        defRow('Mã NV', SOC.esc(r.staffId || '—')) +
        defRow('Mã OPS', SOC.esc(r.opsId || '—')) +
        defRow('Email', r.email ? '<a class="inf-link" href="mailto:' + SOC.esc(r.email) + '">' + SOC.esc(r.email) + '</a>' : '—') +
        defRow('SĐT', r.phone ? linkTel(r.phone) : '—') +
        defRow('Cấp bậc', SOC.esc(r.rank || '—')) +
        defRow('Ngày vào', SOC.esc(r.joinedDate || '—')) +
        defRow('Ngày sinh', SOC.esc(r.birthday || '—') + (b ? ' — ' + b.age + ' tuổi' : '')) +
        defRow('Sinh nhật tới', b ? SOC.esc(b.next) + ' · còn ' + b.until + ' ngày' : '—') +
        defRow('Ngày làm quanh năm', SOC.esc(r.workingDay || '—')) +
        defRow('Giới tính', SOC.esc(r.gender || '—')) +
        defRow('Địa chỉ', SOC.esc(r.address || '—')) +
        defRow('Thiết bị', SOC.esc(r.equipment || '—')) +
        defRow('Trạng thái', '<span class="badge ' + (offRow(r) ? 'inf-off' : 'inf-on') + '">' + SOC.esc(r.status || 'Đang làm') + '</span>') +
        defRow('Nhãn', r.valid ? 'Hợp lệ (đủ email + Mã OPS)' : '<span class="info-err">Cần sửa — thiếu email hoặc Mã OPS</span>') +
        defRow('Station / Team / Ca', SOC.esc([m.station, m.team, m.slotCode].filter(Boolean).join(' · ') || 'chưa có trong nguồn chấm công')) +
        defRow('Contract / Agency', SOC.esc([m.contractType, m.agency].filter(Boolean).join(' · ') || '—')) +
      '</dl></div>' +
      (SOC.atLeast('admin')
        ? '<div class="card__foot inf-actions">' +
            '<button type="button" class="btn btn-outline btn-sm" data-act="inf.edit"><span class="btn-label">Sửa</span>' + SOC.ico('edit', 16) + '</button>' +
            '<button type="button" class="btn btn-danger btn-sm" data-act="inf.del"><span class="btn-label">Vô hiệu hóa</span>' + SOC.ico('trash', 16) + '</button>' +
          '</div>'
        : '<div class="card__foot">Chỉ admin mới sửa được danh bạ.</div>') +
    '</div>';
  }

  function bdayHtml() {
    var list = [];
    IF.rows.forEach(function (r) {
      var b = bdayOf(r.birthday);
      if (b && b.until >= 0 && b.until <= BDAYS_WINDOW) list.push({ r: r, b: b });
    });
    if (!list.length) return '';
    list.sort(function (a, c) { return a.b.until - c.b.until; });
    return '<div class="card card--fit">' +
      '<div class="card__head"><h2 class="section-heading">' + SOC.ico('calendar', 16) + '<span>Sắp đến sinh nhật</span></h2>' +
      '<span class="filter-count" role="status">' + list.length + ' người trong ' + BDAYS_WINDOW + ' ngày tới</span></div>' +
      '<div class="pane inf-bdays">' + list.slice(0, BDAYS_SHOW).map(function (x) {
        return '<button type="button" class="inf-bday" data-row="' + SOC.esc(x.r.row) + '">' +
          '<span class="avatar" aria-hidden="true">' + SOC.esc(SOC.initials(x.r.name || x.r.opsId)) + '</span>' +
          '<span class="inf-bday__n">' + SOC.esc(x.r.name || x.r.opsId) + '</span>' +
          '<span class="pill inf-sn">' + (x.b.until === 0 ? 'hôm nay' : '+' + x.b.until) + '</span></button>';
      }).join('') + '</div>' +
      (list.length > BDAYS_SHOW ? '<div class="card__foot">Còn ' + (list.length - BDAYS_SHOW) + ' người nữa trong ' + BDAYS_WINDOW + ' ngày tới.</div>' : '') +
    '</div>';
  }

  function fldText(key, label, val, type, req) {
    return '<label class="fld"><span>' + label + (req ? ' *' : '') + '</span>' +
      '<input type="' + (type || 'text') + '" data-f="' + key + '" value="' + SOC.esc(val || '') + '"' +
      (req ? ' required' : '') + ' autocomplete="off"></label>';
  }

  function fldSel(key, label, opts, val) {
    return '<label class="fld"><span>' + label + '</span><select data-f="' + key + '">' +
      opts.map(function (o) {
        return '<option value="' + SOC.esc(o) + '"' + (o === val ? ' selected' : '') + '>' + SOC.esc(o || '—') + '</option>';
      }).join('') + '</select></label>';
  }

  function formHtml() {
    var f = IF.form || {}, adding = IF.mode === 'add';
    return '<div class="card">' +
      '<div class="card__head"><h2 class="section-heading">' + SOC.ico(adding ? 'plus' : 'edit', 16) +
        '<span>' + (adding ? 'Thêm nhân sự' : 'Sửa hồ sơ ' + (f.name || '')) + '</span></h2></div>' +
      '<div class="pane inf-form">' +
        '<p class="mode-desc">Trường có dấu * bắt buộc. Station / Team / Ca thuộc nguồn chấm công nên không sửa ở đây.</p>' +
        '<div class="form-grid">' +
          fldText('name', 'Họ tên *', f.name, 'text', true) +
          fldText('opsId', 'Mã OPS *', f.opsId, 'text', true) +
          fldText('staffId', 'Mã NV', f.staffId) +
          fldText('email', 'Email *', f.email, 'text', true) +
          fldText('rank', 'Cấp bậc', f.rank) +
          fldText('joinedDate', 'Ngày vào', f.joinedDate, 'date') +
          fldText('birthday', 'Ngày sinh', f.birthday, 'date') +
          fldText('phone', 'SĐT', f.phone) +
          fldText('workingDay', 'Ngày làm quanh năm', f.workingDay) +
          fldSel('gender', 'Giới tính', GENDERS, f.gender) +
          fldSel('status', 'Trạng thái', STATUSES, f.status) +
        '</div>' +
        '<label class="fld"><span>Địa chỉ</span><textarea data-f="address" rows="2">' + SOC.esc(f.address || '') + '</textarea></label>' +
        '<label class="fld"><span>Thiết bị cấp</span><textarea data-f="equipment" rows="2">' + SOC.esc(f.equipment || '') + '</textarea></label>' +
        (IF.err ? '<div class="info-err" role="alert">' + SOC.esc(IF.err) + '</div>' : '') +
      '</div>' +
      '<div class="card__foot inf-actions">' +
        '<button type="button" class="btn btn-sm" data-act="inf.save"><span class="btn-label">' +
        (adding ? 'Thêm mới' : 'Lưu thay đổi') + '</span>' + SOC.ico('check', 16) + '</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="inf.cancel"><span class="btn-label">Bỏ</span>' + SOC.ico('close', 16) + '</button>' +
      '</div>' +
    '</div>';
  }

  function paintSide() {
    var h = infHost('infSideHost');
    if (!h) return;
    if (IF.mode === 'add' || IF.mode === 'edit') { h.innerHTML = formHtml(); infWireSide(); return; }
    var r = byRow(IF.sel);
    h.innerHTML = (r ? detailHtml(r) : '') + bdayHtml() +
      (r ? '' : '<div class="card"><div class="empty">Chọn một người để xem chi tiết</div></div>');
    infWireSide();
  }

  function paintActions() {
    var acts = '';
    if (SOC.atLeast('admin')) {
      acts += '<button type="button" class="btn" data-act="inf.add"><span class="btn-label">Thêm nhân sự</span>' + SOC.ico('plus', 16) + '</button>';
    }
    acts += '<button type="button" class="btn btn-outline" data-act="inf.reload"><span class="btn-label">Cập nhật</span>' + SOC.ico('refresh', 16) + '</button>';
    SOC.pageActions(acts);
  }

  function paintAll() {
    var s = infSec();
    if (!s) return;
    /* Giữ nguyên khung khi vẽ lại: vẽ lại ô tìm kiếm sẽ làm mất focus đang gõ */
    if (!IF.shell || !infHost('infListHost')) {
      s.innerHTML = shellHtml();
      IF.shell = true;
      var inp = document.getElementById('infSearch');
      if (inp) {
        inp.value = IF.q;
        inp.addEventListener('input', function () { IF.q = inp.value; paintFilters(); paintList(); });
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') { inp.value = ''; IF.q = ''; paintFilters(); paintList(); }
        });
      }
    }
    paintFilters();
    paintList();
    paintSide();
    paintActions();
  }

  /* ---------- biểu mẫu ---------- */
  function openAdd() {
    IF.mode = 'add'; IF.err = '';
    IF.form = { mode: 'add', name: '', opsId: '', staffId: '', email: '', rank: '',
      joinedDate: SOC.isoDay(new Date()), birthday: '', phone: '', address: '', gender: 'Nam',
      equipment: '', status: 'Đang làm', workingDay: '' };
    paintSide();
  }

  function openEdit(r) {
    IF.mode = 'edit'; IF.err = '';
    IF.form = {
      mode: 'edit', row: r.row, oldEmail: r.email || '', name: r.name || '', opsId: r.opsId || '',
      staffId: r.staffId || '', email: r.email || '', rank: r.rank || '', joinedDate: r.joinedDate || '',
      birthday: r.birthday || '', phone: r.phone || '', address: r.address || '', gender: r.gender || 'Nam',
      equipment: r.equipment || '', status: r.status || 'Đang làm', workingDay: r.workingDay || ''
    };
    paintSide();
  }

  function readForm() {
    var pane = infHost('infSideHost');
    if (!pane || !IF.form) return null;
    var out = {};
    Object.keys(IF.form).forEach(function (k) { out[k] = IF.form[k]; });
    Array.prototype.forEach.call(pane.querySelectorAll('[data-f]'), function (el) {
      out[el.getAttribute('data-f')] = String(el.value || '').trim();
    });
    return out;
  }

  function validate(f) {
    if (!f.name) return 'Phải có họ tên.';
    if (!/^OPS\d{3,}$/i.test(f.opsId)) return 'Mã OPS phải theo dạng OPS + số (vd OPS1025).';
    if (!f.email) return 'Phải có email — điểm danh và xin nghỉ đều tra theo email.';
    if (!/^\S+@\S+\.\S+$/.test(f.email)) return 'Email chưa đúng định dạng.';
    return '';
  }

  function saveForm(btn) {
    var f = readForm();
    if (!f) return;
    var err = validate(f);
    if (err) { IF.err = err; paintSide(); SOC.toast(err, 'err'); return; }
    IF.err = '';
    var adding = IF.mode === 'add';
    var body = {
      name: f.name, opsId: f.opsId.toUpperCase(), staffId: f.staffId, email: f.email, rank: f.rank,
      joinedDate: f.joinedDate, birthday: f.birthday, phone: f.phone, address: f.address,
      gender: f.gender, equipment: f.equipment, status: f.status, workingDay: f.workingDay
    };
    if (!adding) { body.row = IF.form.row; body.oldEmail = IF.form.oldEmail; }
    var call = adding ? SOC.api.appendInformationApi(body) : SOC.api.updateInformationApi(body);
    SOC.setBtnBusy_(btn, true, 'Đang lưu');
    call.then(function (r) {
      SOC.setBtnBusy_(btn, false);
      if (!r || !r.ok) { IF.err = (r && r.message) || 'Không lưu được'; paintSide(); SOC.toast(IF.err, 'err'); return; }
      IF.mode = 'view'; IF.sel = r.row || IF.sel; IF.q = '';
      SOC.toast(adding ? 'Đã thêm ' + body.name : 'Đã lưu thay đổi cho ' + body.name, 'ok');
      infFetch(true);
    }, function (e) {
      SOC.setBtnBusy_(btn, false);
      IF.err = 'Không lưu được: ' + ((e && e.message) || 'lỗi kết nối');
      paintSide();
      SOC.toast(IF.err, 'err');
    });
  }

  function disableRow(r, btn) {
    SOC.confirm({
      title: 'Vô hiệu hóa nhân sự',
      message: 'Chuyển ' + (r.name || r.opsId) + ' sang “Đã nghỉ”? Server chỉ đổi trạng thái: dòng và lịch sử ca/chấm công vẫn giữ, ' +
        'nhưng người này mất quyền xem các mục Lịch. Kích hoạt lại được bằng cách sửa Trạng thái.',
      okLabel: 'Chuyển sang Đã nghỉ'
    }).then(function (ok) {
      if (!ok) return;
      SOC.setBtnBusy_(btn, true, 'Đang xử lý');
      SOC.api.deleteInformationApi({ row: r.row, email: r.email || '' }).then(function (res) {
        SOC.setBtnBusy_(btn, false);
        if (!res || !res.ok) { SOC.toast((res && res.message) || 'Không vô hiệu hóa được', 'err'); return; }
        SOC.toast('Đã chuyển ' + (r.name || r.opsId) + ' sang Đã nghỉ', 'ok');
        infFetch(true);
      }, function (e) {
        SOC.setBtnBusy_(btn, false);
        SOC.toast('Không vô hiệu hóa được: ' + ((e && e.message) || 'lỗi kết nối'), 'err');
      });
    });
  }

  /* ---------- tương tác ---------- */
  function selectRow(rowNum) {
    IF.sel = rowNum;
    if (IF.mode !== 'view') { IF.mode = 'view'; IF.err = ''; }
    paintList();
    paintSide();
  }

  function infSort(key) {
    if (!key) return;
    if (IF.sort.k === key) IF.sort.dir = IF.sort.dir === 'asc' ? 'desc' : 'asc';
    else IF.sort = { k: key, dir: 'asc' };
    paintList();
  }

  /* Nút trong cột phải thay đổi theo từng lần vẽ → gắn trực tiếp sau khi vẽ, không dùng delegation */
  function infWireSide() {
    var h = infHost('infSideHost');
    if (!h) return;
    Array.prototype.forEach.call(h.querySelectorAll('[data-act]'), function (b) {
      b.onclick = function () {
        var act = b.getAttribute('data-act'), r = byRow(IF.sel);
        if (act === 'inf.edit' && r) openEdit(r);
        else if (act === 'inf.del' && r) disableRow(r, b);
        else if (act === 'inf.save') saveForm(b);
        else if (act === 'inf.cancel') { IF.mode = 'view'; IF.err = ''; paintSide(); }
      };
    });
  }

  function infWire() {
    var s = infSec();
    if (!s || wired) return;
    wired = true;
    s.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      var th = e.target.closest('th[data-sort]');
      if (th) { infSort(th.getAttribute('data-sort')); return; }
      if (e.target.closest('[data-act="inf.clear"]')) {
        var i = document.getElementById('infSearch');
        if (i) { i.value = ''; i.focus(); }
        IF.q = ''; paintFilters(); paintList(); return;
      }
      if (e.target.closest('[data-act="inf.reset"]')) {
        IF.status = '';
        paintFilters(); paintList(); return;
      }
      var chip = e.target.closest('[data-filter]');
      if (chip) {
        var v = chip.getAttribute('data-value');
        IF.status = IF.status === v ? '' : v;
        paintFilters(); paintList();
        return;
      }
      if (e.target.closest('a')) return;
      var rowEl = e.target.closest('[data-row]');
      if (rowEl) selectRow(Number(rowEl.getAttribute('data-row')));
    });
    s.addEventListener('keydown', function (e) {
      if (!e.target.closest || (e.key !== 'Enter' && e.key !== ' ')) return;
      var th = e.target.closest('th[data-sort]');
      if (th) { e.preventDefault(); infSort(th.getAttribute('data-sort')); }
    });
    s.addEventListener('change', function (e) {
      var key = e.target.getAttribute && e.target.getAttribute('data-f');
      if (key && IF.form) IF.form[key] = e.target.value;
    });
    var acts = document.getElementById('pageActions');
    if (!acts || actionsWired) return;
    actionsWired = true;
    acts.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-act]');
      if (!b) return;
      if (b.getAttribute('data-act') === 'inf.add') openAdd();
      else if (b.getAttribute('data-act') === 'inf.reload') { infFetch(true); SOC.toast('Đang tải lại danh bạ'); }
    });
  }

  /* ---------- dữ liệu ---------- */
  /* Station/Team/Contract nằm ở nguồn chấm công (gate operator) — nuôi cột chi tiết + thẻ, không dùng để lọc */
  function loadMeta() {
    if (IF.metaLoaded) return;
    SOC.api.getFilterOptionsApi().then(function (r) {
      if (!r || !r.ok || !r.staffList) return;
      IF.meta = {};
      r.staffList.forEach(function (s) {
        IF.meta[String(s.staffId || '')] = {
          station: s.station || '', team: s.team || '', contractType: s.contractType || '',
          slotCode: s.slotCode || '', agency: s.agency || ''
        };
      });
      IF.metaLoaded = true;
      if (IF.loaded) { paintFilters(); paintList(); paintSide(); }
    }, function () {});
  }

  function infFetch(force) {
    if (IF.loading || (!force && IF.loaded)) return;
    IF.loading = true;
    SOC.api.getInformationApi().then(function (r) {
      IF.loading = false;
      if (!r || !r.ok) { SOC.toast((r && r.message) || 'Không đọc được danh bạ nhân sự', 'err'); return; }
      IF.rows = r.rows || [];
      IF.loaded = true;
      if (IF.sel !== null && !byRow(IF.sel)) IF.sel = null;
      paintAll();
      loadMeta();
    }, function (e) {
      IF.loading = false;
      SOC.toast('Không đọc được danh bạ: ' + ((e && e.message) || 'lỗi kết nối'), 'err');
    });
  }

  function infRender(ctx) {
    infWire();
    var force = !!(ctx && ctx.force === true);
    if (!IF.loaded) { infSkeleton(); infFetch(true); return; }
    paintAll();
    infFetch(force);
  }

  SOC.registerView('information', { section: 'viewInformation', render: infRender });
})();
