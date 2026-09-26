/* view-leave.js — Xin nghỉ: đơn nghỉ trong tháng, dải ngày tô theo trạng thái, duyệt theo quyền.
   Đọc: getLeaveRequestsApi({month}) → rows + pendingCount (gắn con badge sidebar).
   Ghi: requestLeaveApi({dateString,type,reason}) · cancelLeaveApi({id}) · decideLeaveApi({id,approve,note}).
   Mock bỏ qua tham số mine nên mục “Của tôi” phải lọc tại client theo email phiên. */
(function () {
  'use strict';

  /* Nhãn loại nghỉ lấy theo legend trang Giới thiệu — ngữ nghĩa chính thức của hệ thống lịch */
  var TYPES = {
    AL: 'Nghỉ phép năm', SL: 'Nghỉ ốm', MAL: 'Nghỉ cưới', CL: 'Nghỉ tang chế', PL: 'Thai sản nam',
    ML: 'Thai sản nữ', HL: 'Ốm nằm viện', OIL: 'Nghỉ bù', NPL: 'Nghỉ không lương',
    PH: 'Nghỉ lễ, Tết', OFF: 'Nghỉ tuần'
  };
  var TYPE_CODES = ['AL', 'SL', 'MAL', 'CL', 'PL', 'ML', 'HL', 'OIL', 'NPL', 'PH', 'OFF'];
  var ST = {
    pending: { label: 'Chờ duyệt', cls: 'lv-pending' },
    approved: { label: 'Đã duyệt', cls: 'lv-approved' },
    denied: { label: 'Từ chối', cls: 'lv-denied' },
    cancelled: { label: 'Đã hủy', cls: 'done' }
  };
  var PRIORITY = { pending: 3, denied: 2, approved: 1, cancelled: 0 };
  var STATS = [['pending', 'Chờ duyệt'], ['approved', 'Đã duyệt'], ['denied', 'Từ chối'],
    ['cancelled', 'Đã hủy'], ['mine', 'Của tôi']];

  var LV = {
    month: '', rows: [], pending: 0, loaded: false, loading: false,
    date: '', status: '', shell: false, modal: null
  };
  var wired = false, actionsWired = false;

  /* ---------- helper ---------- */
  function lvSec() { return document.getElementById('viewLeave'); }
  function lvHost(id) { var s = lvSec(); return s && s.querySelector('#' + id); }
  function lvToday() { return SOC.isoDay(new Date()); }
  function lvDowOf(ds) {
    var dt = new Date(Number(ds.slice(0, 4)), Number(ds.slice(5, 7)) - 1, Number(ds.slice(8, 10)));
    return ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][dt.getDay()];
  }
  function lvDlabel(ds) { return ds ? ds.slice(8, 10) + '/' + ds.slice(5, 7) : ''; }
  function lvIsMine(r) { return String(r.email || '').toLowerCase() === String(SOC.state.email || '').toLowerCase(); }
  function lvStatusOf(r) { return ST[r.status] || { label: String(r.status || '—'), cls: 'lv-pending' }; }
  function lvTypeLabel(code) { return TYPES[String(code || '').toUpperCase()] || String(code || '—'); }
  function lvRowById(id) {
    for (var i = 0; i < LV.rows.length; i++) if (String(LV.rows[i].id) === id) return LV.rows[i];
    return null;
  }

  function lvVisible() {
    return LV.rows.filter(function (r) {
      if (LV.date && String(r.dateString) !== LV.date) return false;
      if (LV.status === 'mine') return lvIsMine(r);
      if (LV.status && r.status !== LV.status) return false;
      return true;
    }).sort(function (a, b) {
      return String(b.dateString).localeCompare(String(a.dateString)) ||
        String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
  }

  function lvCounts() {
    var c = { pending: 0, approved: 0, denied: 0, cancelled: 0, mine: 0 };
    LV.rows.forEach(function (r) {
      if (c[r.status] !== undefined) c[r.status]++;
      if (lvIsMine(r) && r.status === 'pending') c.mine++;
    });
    return c;
  }

  /* Một ngày có thể có nhiều đơn — tô theo trạng thái đáng chú ý nhất để không lẫn màu */
  function lvDayStatus(ds) {
    var best = '';
    LV.rows.forEach(function (r) {
      if (String(r.dateString) !== ds) return;
      var p = PRIORITY[r.status];
      if (p === undefined) return;
      if (best === '' || p > PRIORITY[best]) best = r.status;
    });
    return best === 'cancelled' ? '' : best;
  }

  function lvDayCount(ds) {
    var n = 0;
    LV.rows.forEach(function (r) { if (String(r.dateString) === ds) n++; });
    return n;
  }

  /* ---------- khung ---------- */
  function lvSkeleton() {
    var rows = '', i;
    for (i = 0; i < 8; i++) {
      rows += '<div class="skeleton-row"><div class="skeleton-cell"></div><div class="skeleton-cell"></div>' +
        '<div class="skeleton-cell"></div><div class="skeleton-cell"></div></div>';
    }
    if (lvSec()) lvSec().innerHTML = '<div class="card"><div class="skeleton-wrap" aria-busy="true" aria-label="Đang tải đơn nghỉ">' + rows + '</div></div>';
    LV.shell = false;
    SOC.pageActions('');
  }

  function lvShellHtml() {
    return '<div class="card card--fit">' +
        '<div class="card__head">' +
          '<h2 class="section-heading">' + SOC.ico('calendar', 16) + '<span>' + SOC.esc(SOC.monthLabel(LV.month)) + '</span></h2>' +
        '</div>' +
        '<div id="lvStripHost"></div>' +
      '</div>' +
      '<div class="stat-strip" id="lvStatHost" role="group" aria-label="Bộ lọc theo trạng thái đơn"></div>' +
      '<div class="card">' +
        '<div class="card__head">' +
          '<h2 class="section-heading">' + SOC.ico('leave', 16) + '<span>Đơn nghỉ</span></h2>' +
          '<span class="pill" id="lvCount" role="status">—</span>' +
          '<span class="filter-count" id="lvFilterHint"></span>' +
        '</div>' +
        '<div class="table-wrap" id="lvTableHost"></div>' +
      '</div>';
  }

  function lvLegendHtml() {
    return '<div class="legend lv-legend"><span class="legend__i">Nhấp một ngày để lọc</span>' +
      ['pending', 'approved', 'denied'].map(function (k) {
        return '<span class="legend__i"><span class="lv-dot lv-' + k + '" aria-hidden="true"></span>' + ST[k].label + '</span>';
      }).join('') + '</div>';
  }

  function lvStripHtml() {
    var n = SOC.daysInMonth(LV.month), today = lvToday(), pills = '', i;
    for (i = 1; i <= n; i++) {
      var ds = LV.month + '-' + SOC.pad2(i);
      var st = lvDayStatus(ds);
      var cnt = lvDayCount(ds);
      var cls = 'leave-day' + (st ? ' lv-' + st : '') + (LV.date === ds ? ' on' : '') + (ds === today ? ' today' : '');
      pills += '<button type="button" class="' + cls + '" data-date="' + SOC.esc(ds) + '" aria-pressed="' +
        (LV.date === ds ? 'true' : 'false') + '" title="' + SOC.esc(lvDowOf(ds) + ' ' + ds + (cnt ? ' · ' + cnt + ' đơn' : ' · không có đơn')) + '">' +
        i + '<small>' + (cnt ? String(cnt) : SOC.esc(lvDowOf(ds))) + '</small></button>';
    }
    return '<div class="lv-strip-wrap"><div class="leave-strip">' + pills + '</div>' + lvLegendHtml() + '</div>';
  }

  function lvStatsHtml() {
    var c = lvCounts();
    return STATS.map(function (s) {
      return '<button type="button" class="stat-card lv-stat' + (LV.status === s[0] ? ' on' : '') +
        '" data-stat="' + s[0] + '" aria-pressed="' + (LV.status === s[0] ? 'true' : 'false') + '">' +
        '<span class="stat-card__label">' + s[1] + '</span>' +
        '<span class="stat-card__value">' + c[s[0]] + '</span>' +
        '<span class="stat-card__note">' + (s[0] === 'mine' ? 'đơn của bạn đang chờ' : 'nhấp để lọc') + '</span></button>';
    }).join('');
  }

  function lvActionsCell(r) {
    var out = [];
    if (r.status === 'pending' && SOC.atLeast('admin')) {
      out.push('<button type="button" class="btn btn-sm" data-act="lv.ok" data-id="' + SOC.esc(r.id) +
        '" aria-label="Duyệt đơn ' + SOC.esc(r.id) + '"><span class="btn-label">Duyệt</span>' + SOC.ico('check', 16) + '</button>');
      out.push('<button type="button" class="btn btn-ghost btn-sm" data-act="lv.no" data-id="' + SOC.esc(r.id) +
        '" aria-label="Từ chối đơn ' + SOC.esc(r.id) + '"><span class="btn-label">Từ chối</span>' + SOC.ico('close', 16) + '</button>');
    }
    if (r.status === 'pending' && lvIsMine(r)) {
      out.push('<button type="button" class="btn btn-ghost btn-sm" data-act="lv.cancel" data-id="' + SOC.esc(r.id) +
        '" aria-label="Hủy đơn ' + SOC.esc(r.id) + '"><span class="btn-label">Hủy</span>' + SOC.ico('trash', 16) + '</button>');
    }
    return out.length ? '<div class="lv-actions">' + out.join('') + '</div>' : '<span class="c-empty">—</span>';
  }

  function lvTableHtml() {
    var rows = lvVisible();
    var body = rows.map(function (r) {
      var st = lvStatusOf(r);
      return '<tr data-id="' + SOC.esc(r.id) + '"' + (lvIsMine(r) ? ' class="lv-row--mine"' : '') + '>' +
        '<td class="num"><b>' + SOC.esc(lvDlabel(r.dateString)) + '</b><span class="lv-dow">' + SOC.esc(lvDowOf(String(r.dateString))) + '</span></td>' +
        '<td><span class="lv-kind">' + SOC.badgeShift(r.type) + '<span class="lv-type">' + SOC.esc(lvTypeLabel(r.type)) + '</span></span></td>' +
        '<td><span class="lv-who"><span class="avatar" aria-hidden="true">' + SOC.esc(SOC.initials(r.name || r.opsId)) +
          '</span><span class="lv-who__n">' + SOC.esc(r.name || r.opsId) + '</span>' +
          '<span class="lv-ops num">' + SOC.esc(r.opsId || '—') + '</span>' +
          (lvIsMine(r) ? '<span class="pill">của tôi</span>' : '') + '</span></td>' +
        '<td title="' + SOC.esc(r.reason || '') + '">' + SOC.esc(r.reason || '—') + '</td>' +
        '<td><span class="badge ' + st.cls + '">' + SOC.esc(st.label) + '</span></td>' +
        '<td>' + (r.decidedBy ? SOC.esc(r.decidedBy) + '<span class="lv-dow num">' + SOC.esc(String(r.decidedAt || '').slice(0, 10)) + '</span>' : '<span class="c-empty">chưa ai xử lý</span>') + '</td>' +
        '<td title="' + SOC.esc(r.note || '') + '">' + SOC.esc(r.note || '—') + '</td>' +
        '<td>' + lvActionsCell(r) + '</td></tr>';
    }).join('');
    return '<table class="lv-table"><caption class="sr-only">Đơn nghỉ ' + SOC.esc(SOC.monthLabel(LV.month)) +
      ' — ngày nghỉ, loại, người nghỉ, trạng thái, người duyệt và thao tác</caption>' +
      '<thead><tr><th scope="col" class="num">Ngày nghỉ</th><th scope="col">Loại</th><th scope="col">Người nghỉ</th>' +
      '<th scope="col">Lý do</th><th scope="col">Trạng thái</th><th scope="col">Người duyệt</th>' +
      '<th scope="col">Ghi chú</th><th scope="col">Thao tác</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="8"><div class="empty">Không có đơn nghỉ nào trong bộ lọc này</div></td></tr>') +
      '</tbody></table>';
  }

  function lvPaintStrip() {
    var h = lvHost('lvStripHost');
    if (h) h.innerHTML = lvStripHtml();
  }

  function lvPaintStats() {
    var h = lvHost('lvStatHost');
    if (h) h.innerHTML = lvStatsHtml();
  }

  function lvPaintTable() {
    var h = lvHost('lvTableHost');
    if (!h) return;
    var rows = lvVisible();
    h.innerHTML = lvTableHtml();
    var cnt = lvHost('lvCount');
    if (cnt) cnt.textContent = rows.length + '/' + LV.rows.length + ' đơn';
    var hint = lvHost('lvFilterHint');
    var bits = [];
    if (LV.date) bits.push('ngày ' + lvDlabel(LV.date));
    if (LV.status) bits.push(LV.status === 'mine' ? 'của tôi' : ST[LV.status].label.toLowerCase());
    if (hint) hint.innerHTML = bits.length
      ? 'Đang lọc theo ' + SOC.esc(bits.join(' · ')) +
        ' <button type="button" class="btn-clear-filter" data-act="lv.reset" aria-label="Xóa bộ lọc">×</button>'
      : '';
  }

  /* Đổi tháng xoá lọc ngày + trạng thái vì dải ngày và bảng đều chỉ đúng cho một tháng */
  function gotoMonth(m) {
    LV.month = m;
    LV.date = '';
    LV.status = '';
    lvPaint();
    lvFetch(true);
  }

  function lvPaintActions() {
    var acts = SOC.monthNav(LV.month, { onPick: gotoMonth }) +
      '<button type="button" class="btn btn-outline" data-act="lv.today"><span class="btn-label">Tháng này</span>' + SOC.ico('calendar', 16) + '</button>';
    if (SOC.atLeast('operator')) {
      acts += '<button type="button" class="btn" data-act="lv.new"><span class="btn-label">Đơn nghỉ</span>' + SOC.ico('plus', 16) + '</button>';
    }
    acts += '<button type="button" class="btn btn-outline" data-act="lv.reload"><span class="btn-label">Cập nhật</span>' + SOC.ico('refresh', 16) + '</button>';
    SOC.pageActions(acts);
  }

  function lvPaint() {
    var s = lvSec();
    if (!s) return;
    /* Chỉ vẽ lại từng vùng: ô chọn tháng nằm ở slot hành động, vẽ lại cả khung sẽ mất focus */
    if (!LV.shell || !lvHost('lvTableHost')) { s.innerHTML = lvShellHtml(); LV.shell = true; }
    lvPaintStrip();
    lvPaintStats();
    lvPaintTable();
    lvPaintActions();
  }

  /* ---------- modal ---------- */
  function lvModalDestroy() {
    if (LV.modal && LV.modal.el) LV.modal.el.remove();
    LV.modal = null;
    document.removeEventListener('keydown', lvModalEsc);
  }
  function lvModalEsc(e) { if (e.key === 'Escape') lvModalDestroy(); }

  function lvOpenCreate() {
    if (LV.modal) return;
    var ov = document.createElement('div');
    ov.className = 'about-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', 'lvCreateTitle');
    ov.innerHTML = '<div class="about-dialog">' +
      '<div class="modal-head"><h2 id="lvCreateTitle">Gửi đơn nghỉ</h2>' +
      '<button type="button" class="btn-icon" data-act="lv.x" aria-label="Đóng">' + SOC.ico('close', 18) + '</button></div>' +
      '<p class="mode-desc">Đơn gửi cho admin duyệt. Ngày được duyệt sẽ bị ghi loại nghỉ lên lịch của bạn, nên chỉ gửi đơn cho ngày chưa làm xong.</p>' +
      '<div class="form-grid">' +
        '<label class="fld"><span>Ngày nghỉ *</span><input type="date" data-f="date" value="' + SOC.esc(LV.date || lvToday()) + '" min="' + SOC.esc(lvToday()) + '"></label>' +
        '<label class="fld"><span>Loại nghỉ *</span><select data-f="type">' + TYPE_CODES.map(function (c) {
          return '<option value="' + SOC.esc(c) + '">' + SOC.esc(TYPES[c] + ' (' + c + ')') + '</option>';
        }).join('') + '</select></label>' +
      '</div>' +
      '<label class="fld"><span>Lý do</span><textarea data-f="reason" rows="3" placeholder="VD: việc gia đình, đi khám bệnh…"></textarea></label>' +
      '<div class="info-err" data-slot="err" role="alert"></div>' +
      '<div class="modal-foot"><button type="button" class="btn btn-ghost" data-act="lv.x"><span class="btn-label">Bỏ</span></button>' +
      '<button type="button" class="btn" data-act="lv.send"><span class="btn-label">Gửi đơn</span>' + SOC.ico('play', 16) + '</button></div>' +
    '</div>';
    document.body.appendChild(ov);
    LV.modal = { el: ov };
    ov.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      if (e.target === ov || e.target.closest('[data-act="lv.x"]')) { lvModalDestroy(); return; }
      var send = e.target.closest('[data-act="lv.send"]');
      if (send) lvSubmitCreate(send);
    });
    document.addEventListener('keydown', lvModalEsc);
    var d = ov.querySelector('[data-f="date"]');
    if (d) d.focus();
  }

  function lvSubmitCreate(btn) {
    var ov = LV.modal && LV.modal.el;
    if (!ov) return;
    var date = ov.querySelector('[data-f="date"]').value;
    var type = ov.querySelector('[data-f="type"]').value;
    var reason = ov.querySelector('[data-f="reason"]').value.trim();
    var err = ov.querySelector('[data-slot="err"]');
    if (!date) { err.textContent = 'Phải chọn ngày nghỉ.'; return; }
    if (!type) { err.textContent = 'Phải chọn loại nghỉ.'; return; }
    if (date < lvToday()) { err.textContent = 'Không gửi đơn cho ngày đã qua — nhờ admin chỉnh trực tiếp trên lịch.'; return; }
    err.textContent = '';
    SOC.setBtnBusy_(btn, true, 'Đang gửi');
    SOC.api.requestLeaveApi({ dateString: date, type: type, reason: reason }).then(function (r) {
      SOC.setBtnBusy_(btn, false);
      if (!r || !r.ok) { err.textContent = (r && r.message) || 'Không gửi được đơn'; return; }
      lvModalDestroy();
      SOC.toast(r.message || 'Đã gửi đơn nghỉ', 'ok');
      LV.date = date;
      lvFetch(true);
    }, function (e) {
      SOC.setBtnBusy_(btn, false);
      err.textContent = 'Không gửi được đơn: ' + ((e && e.message) || 'lỗi kết nối');
    });
  }

  /* Từ chối bắt buộc có ghi chú — hộp thoại này thu note, chưa phải bước xác nhận cuối */
  function lvOpenNote(row, done) {
    if (LV.modal) return;
    var ov = document.createElement('div');
    ov.className = 'about-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', 'lvNoteTitle');
    ov.innerHTML = '<div class="about-dialog">' +
      '<div class="modal-head"><h2 id="lvNoteTitle">Từ chối đơn ' + SOC.esc(row.id) + '</h2>' +
      '<button type="button" class="btn-icon" data-act="lv.x" aria-label="Đóng">' + SOC.ico('close', 18) + '</button></div>' +
      '<p class="mode-desc">' + SOC.esc((row.name || row.opsId) + ' · nghỉ ' + lvDlabel(row.dateString) + ' · ' + lvTypeLabel(row.type)) +
      ' — ghi chú hiển thị ở cột Ghi chú của đơn.</p>' +
      '<label class="fld"><span>Lý do từ chối *</span><textarea data-f="note" rows="3" placeholder="VD: trùng ngày cao điểm của cửa"></textarea></label>' +
      '<div class="info-err" data-slot="err" role="alert"></div>' +
      '<div class="modal-foot"><button type="button" class="btn btn-ghost" data-act="lv.x"><span class="btn-label">Bỏ</span></button>' +
      '<button type="button" class="btn btn-danger" data-act="lv.go"><span class="btn-label">Tiếp tục</span>' + SOC.ico('check', 16) + '</button></div>' +
    '</div>';
    document.body.appendChild(ov);
    LV.modal = { el: ov };
    ov.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      if (e.target === ov || e.target.closest('[data-act="lv.x"]')) { lvModalDestroy(); done(''); return; }
      var go = e.target.closest('[data-act="lv.go"]');
      if (!go) return;
      var note = ov.querySelector('[data-f="note"]').value.trim();
      if (!note) { ov.querySelector('[data-slot="err"]').textContent = 'Phải ghi lý do từ chối.'; return; }
      lvModalDestroy();
      done(note);
    });
    document.addEventListener('keydown', lvModalEsc);
    var t = ov.querySelector('[data-f="note"]');
    if (t) t.focus();
  }

  /* ---------- thao tác ghi ---------- */
  function lvDecide(id, approve, btn, note) {
    SOC.setBtnBusy_(btn, true, 'Đang xử lý');
    SOC.api.decideLeaveApi({ id: id, approve: approve, note: note || '' }).then(function (r) {
      SOC.setBtnBusy_(btn, false);
      if (!r || !r.ok) { SOC.toast((r && r.message) || 'Không xử lý được đơn', 'err'); return; }
      SOC.toast(r.message || (approve ? 'Đã duyệt' : 'Đã từ chối'), 'ok');
      lvFetch(true);
    }, function (e) {
      SOC.setBtnBusy_(btn, false);
      SOC.toast('Không xử lý được đơn: ' + ((e && e.message) || 'lỗi kết nối'), 'err');
    });
  }

  function lvApprove(row, btn) {
    SOC.confirm({
      title: 'Duyệt đơn nghỉ',
      message: 'Duyệt đơn ' + row.id + ' của ' + (row.name || row.opsId) + '? Ngày ' + lvDlabel(row.dateString) +
        ' trong lịch sẽ bị ghi loại nghỉ ' + row.type + '.',
      okLabel: 'Duyệt đơn'
    }).then(function (ok) { if (ok) lvDecide(row.id, true, btn, row.note || ''); });
  }

  function lvDeny(row, btn) {
    lvOpenNote(row, function (note) {
      if (!note) return;
      SOC.confirm({
        title: 'Từ chối đơn nghỉ',
        message: 'Từ chối đơn ' + row.id + ' của ' + (row.name || row.opsId) + '? Lý do gửi người nghỉ: “' + note + '”.',
        okLabel: 'Từ chối đơn'
      }).then(function (ok) { if (ok) lvDecide(row.id, false, btn, note); });
    });
  }

  function lvCancel(id, btn) {
    SOC.setBtnBusy_(btn, true, 'Đang hủy');
    SOC.api.cancelLeaveApi({ id: id }).then(function (r) {
      SOC.setBtnBusy_(btn, false);
      if (!r || !r.ok) { SOC.toast((r && r.message) || 'Không hủy được đơn', 'err'); return; }
      SOC.toast(r.message || 'Đã hủy đơn', 'ok');
      lvFetch(true);
    }, function (e) {
      SOC.setBtnBusy_(btn, false);
      SOC.toast('Không hủy được đơn: ' + ((e && e.message) || 'lỗi kết nối'), 'err');
    });
  }

  /* ---------- tương tác ---------- */
  function lvWire() {
    var s = lvSec();
    if (!s || wired) return;
    wired = true;
    s.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      if (e.target.closest('[data-act="lv.reset"]')) { LV.date = ''; LV.status = ''; lvPaintStrip(); lvPaintStats(); lvPaintTable(); return; }
      var day = e.target.closest('[data-date]');
      if (day) {
        var ds = day.getAttribute('data-date');
        LV.date = LV.date === ds ? '' : ds;
        lvPaintStrip(); lvPaintStats(); lvPaintTable();
        return;
      }
      var stat = e.target.closest('[data-stat]');
      if (stat) {
        var k = stat.getAttribute('data-stat');
        LV.status = LV.status === k ? '' : k;
        lvPaintStats(); lvPaintTable();
        return;
      }
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'lv.ok' || act === 'lv.no') {
        var row = lvRowById(b.getAttribute('data-id'));
        if (!row) { SOC.toast('Đơn không còn trong danh sách — bấm Cập nhật', 'err'); return; }
        if (act === 'lv.ok') lvApprove(row, b); else lvDeny(row, b);
      } else if (act === 'lv.cancel') {
        lvCancel(b.getAttribute('data-id'), b);
      }
    });
    var acts = document.getElementById('pageActions');
    if (!acts || actionsWired) return;
    actionsWired = true;
    acts.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'lv.new') lvOpenCreate();
      else if (act === 'lv.reload') { lvFetch(true); SOC.toast('Đang tải lại đơn nghỉ'); }
      else if (act === 'lv.today') {
        LV.month = SOC.isoMonth(new Date());
        LV.date = lvToday();
        LV.status = '';
        lvPaint();
        lvFetch(true);
      }
    });
  }

  /* ---------- dữ liệu ---------- */
  function lvFetch(force) {
    if (LV.loading || (!force && LV.loaded)) return;
    LV.loading = true;
    var month = LV.month;
    SOC.api.getLeaveRequestsApi({ month: month }).then(function (r) {
      LV.loading = false;
      if (!r || !r.ok) { SOC.toast((r && r.message) || 'Không đọc được đơn nghỉ', 'err'); return; }
      if (month !== LV.month) return;
      LV.rows = r.rows || [];
      LV.pending = r.pendingCount || 0;
      LV.loaded = true;
      SOC.setCount('leave', LV.pending);
      lvPaint();
    }, function (e) {
      LV.loading = false;
      SOC.toast('Không đọc được đơn nghỉ: ' + ((e && e.message) || 'lỗi kết nối'), 'err');
    });
  }

  function lvRender(ctx) {
    lvWire();
    if (!LV.month) LV.month = SOC.isoMonth(new Date());
    var force = !!(ctx && ctx.force === true);
    if (!LV.loaded) { lvSkeleton(); lvFetch(true); return; }
    lvPaint();
    lvFetch(force);
  }

  SOC.registerView('leave', { section: 'viewLeave', render: lvRender });
})();
