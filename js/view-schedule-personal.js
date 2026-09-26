/* view-schedule-personal.js — "Lịch cá nhân": lịch tháng của MỘT người + bảng chấm công tháng.
   [CHUNG] Lịch tháng lấy qua SOC.schedStore (view-schedule.js sở hữu request dùng chung 3 view lịch). */
(function () {
  'use strict';

  var PAGE = 'schedule-personal';
  var SECTION = 'viewSchedulePersonal';
  var SEARCH_MS = 250;
  var DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  var LEGEND = [
    { code: 'S1', label: 'Sáng' }, { code: 'S10', label: 'Chiều' }, { code: 'S15', label: 'Tối' },
    { code: 'OFF', label: 'Nghỉ' }, { code: 'PH', label: 'Lễ' }, { code: 'AL', label: 'Phép' }
  ];

  var store = null;            // SOC.schedStore — gán ở render đầu
  var data = null;             // payload lịch của tháng đang xem
  var emp = '';                // mã OPS đang xem
  var seenCursor = null;       // SOC.schedStore.selId đã tiếp nhận
  var day = '';                // ngày đang mở ở panel phải
  var q = '';                  // từ khóa combobox chọn người
  var timer = null;
  var rep = { month: '', jobMonth: '', rows: null, job: null, note: '', denied: false };

  function el() { return document.getElementById(SECTION); }
  function ym() { return store.currentMonth(); }
  function daysOf() { return (data && data.daysInMonth) || []; }

  function dayMap() {
    var m = {};
    daysOf().forEach(function (x) { m[x.dateString] = x; });
    return m;
  }

  function dowOf(ds) {
    var x = dayMap()[ds];
    if (x && x.dayOfWeek) return x.dayOfWeek;
    var p = String(ds).split('-');
    if (p.length !== 3) return '';
    return DOW[new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay()];
  }

  function pretty(ds) { return ds ? ds.slice(8) + '/' + ds.slice(5, 7) : '—'; }

  function candidates() {
    if (data && data.employees && data.employees.length) {
      return data.employees.map(function (e) { return { opsId: e.id, name: e.name, title: e.title || '' }; });
    }
    return ((data && data.staffListSlim) || []).map(function (s) { return { opsId: s.opsId, name: s.name, title: '' }; });
  }

  function resolveEmp() {
    var list = candidates();
    var self = (data && data.staffInfoSelf) || null;
    if (emp && list.some(function (c) { return String(c.opsId) === String(emp); })) return emp;
    if (store.selId && list.some(function (c) { return String(c.opsId) === String(store.selId); })) return store.selId;
    if (self && self.opsId) return String(self.opsId);
    return list.length ? String(list[0].opsId) : '';
  }

  function empInfo(id) {
    var out = { name: String(id || ''), title: '' };
    candidates().forEach(function (c) { if (String(c.opsId) === String(id)) out = { name: c.name, title: c.title }; });
    var m = store.meta(id);
    out.station = (m && m.station) || '';
    out.team = (m && m.team) || '';
    out.slot = (m && m.slotCode) || '';
    return out;
  }

  /* dòng chấm công của người đang xem — fallback so phần số của mã nhân danh khi
     nguồn không trả employeeId (khớp hướng lọc filterAttendanceRows phía server). */
  function normId(v) { return String(v || '').trim().toUpperCase(); }
  function digitsOf(v) { return String(v || '').replace(/[^0-9]/g, ''); }

  function myRows() {
    var rows = (rep.rows || []).slice().sort(function (a, b) { return String(a.reportDate) < String(b.reportDate) ? -1 : 1; });
    var want = normId(emp);
    if (!want) return rows;
    var exact = rows.filter(function (r) { return normId(r.employeeId) === want || normId(r.bizStaffId) === want; });
    if (exact.length) return exact;
    var dg = digitsOf(want);
    if (!dg) return exact;
    var byDigits = rows.filter(function (r) { return digitsOf(r.bizStaffId) === dg; });
    var owners = {};
    byDigits.forEach(function (r) { owners[normId(r.bizStaffId)] = 1; });
    return Object.keys(owners).length === 1 ? byDigits : exact;   // mơ hồ thì không đoán bừa
  }

  function tally() {
    var work = 0, rest = 0, leave = 0, hours = 0, absent = 0;
    daysOf().forEach(function (x) {
      var code = store.shiftOf(emp, x.dateString);
      if (!code) return;
      var cat = SOC.shiftCategory(code);
      if (cat === 'morning' || cat === 'afternoon' || cat === 'evening') work++;
      else if (cat === 'leave') leave++;
      else rest++;
    });
    myRows().forEach(function (r) {
      hours += parseFloat(r.workHour) || 0;
      if (r.result === 'Vắng') absent++;
    });
    return { work: work, rest: rest, leave: leave, hours: hours, absent: absent };
  }

  /* ================= markup ================= */
  function headHtml() {
    return SOC.monthNav(ym(), { onPick: gotoMonth }) +
      '<button type="button" class="btn btn-outline" data-sp-act="matrix" title="Về ma trận lịch tháng">' +
      '<span class="btn-label">Lịch tháng</span><span class="btn-ico">' + SOC.ico('schedule', 16) + '</span></button>' +
      '<button type="button" class="btn btn-outline" data-sp-act="csv" title="Xuất bảng chấm công ra CSV">' +
      '<span class="btn-label">CSV</span><span class="btn-ico">' + SOC.ico('download', 16) + '</span></button>' +
      '<button type="button" class="btn btn-outline" data-sp-act="reload" title="Tải lại lịch và chấm công">' +
      '<span class="btn-label">Cập nhật</span><span class="btn-ico">' + SOC.ico('refresh', 16) + '</span></button>';
  }

  function statCard(label, value, note, kind) {
    return '<div class="stat-card' + (kind ? ' stat-card--' + kind : '') + '">' +
      '<span class="stat-card__label">' + SOC.esc(label) + '</span>' +
      '<span class="stat-card__value">' + SOC.esc(value) + '</span>' +
      '<span class="stat-card__note">' + SOC.esc(note) + '</span></div>';
  }

  function statsHtml(t) {
    return '<div class="stat-strip" id="spStats">' +
      statCard('Ngày làm', t.work, SOC.monthLabel(ym()), t.work ? 'ok' : '') +
      statCard('Nghỉ · OFF · lễ', t.rest, 'không chấm công') +
      statCard('Ngày phép', t.leave, 'phép · ốm · không lương', t.leave ? 'warn' : '') +
      statCard('Tổng giờ công', t.hours.toFixed(1), 'tổng giờ theo chấm công tháng', '') +
      (t.absent ? statCard('Ngày vắng', t.absent, 'không có giờ chấm công', 'err') : '') +
      '</div>';
  }

  function comboHtml() {
    return '<div class="sp-combo">' +
      '<div class="list-search"><input type="search" id="spQ" data-sp-q placeholder="Tìm người theo tên hoặc mã OPS…" ' +
      'autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="spCombo" ' +
      'aria-label="Chọn nhân viên xem lịch" value="' + SOC.esc(q) + '">' +
      '<button type="button" class="btn-icon" data-sp-act="self" title="Chọn nhanh hồ sơ của bạn" ' +
      'aria-label="Chọn nhanh hồ sơ của bạn">' + SOC.ico('personal', 16) + '</button></div>' +
      '<div class="sp-combo__list" id="spCombo" hidden></div></div>';
  }

  function personHtml() {
    var info = empInfo(emp);
    var metaBits = [emp, info.title, info.station, info.team].filter(Boolean).join(' · ');
    return '<div class="card card--fit">' +
      '<div class="card__head"><span class="avatar" aria-hidden="true">' + SOC.esc(SOC.initials(info.name)) + '</span>' +
      '<span class="sp-person"><b>' + SOC.esc(info.name) + '</b><span class="sp-person__meta">' + SOC.esc(metaBits) + '</span></span>' +
      '<span class="pill">' + SOC.esc(SOC.monthLabel(ym())) + '</span></div>' +
      '<div class="sp-picker">' + comboHtml() + '</div>' +
      '<div class="card__foot">' + (info.slot ? 'Ca quen ' + SOC.esc(info.slot) + ' · ' : '') +
      'Bấm một ngày để neo bảng chấm công.</div></div>';
  }

  function calHtml() {
    var list = daysOf();
    var blanks = 0;
    if (list[0]) {
      var p = String(list[0].dateString).split('-');
      blanks = (new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay() + 6) % 7;   // ô đầu tuần là thứ Hai
    }
    var pad = '';
    for (var i = 0; i < blanks; i++) pad += '<span class="sp-cal__blank" aria-hidden="true"></span>';
    var cells = list.map(function (x) {
      var code = store.shiftOf(emp, x.dateString);
      var on = x.dateString === day;
      var cls = 'mini-day' + (on ? ' on' : '') + (x.dateString === store.todayIso() ? ' today' : '') + (x.isWeekend ? ' weekend' : '');
      return '<button type="button" class="' + cls + '" data-sp-day="' + SOC.esc(x.dateString) + '"' +
        (on ? ' aria-current="date"' : '') + ' aria-label="Ngày ' + SOC.esc(x.date) + ' ' + SOC.esc(x.dayOfWeek) +
        (code ? ' ca ' + SOC.esc(code) : ' chưa xếp') + '">' +
        '<span class="sp-cal__n">' + SOC.esc(x.date) + '</span>' + (code ? SOC.badgeShift(code) : '<small>—</small>') + '</button>';
    }).join('');
    return '<div class="card sp-calcard">' +
      '<div class="card__head"><h2 class="section-heading">Lịch tháng</h2></div>' +
      '<div class="card-body">' +
      '<div class="sp-cal__dow" aria-hidden="true"><span>T2</span><span>T3</span><span>T4</span><span>T5</span><span>T6</span><span>T7</span><span>CN</span></div>' +
      '<div class="sp-cal" role="group" aria-label="Chọn ngày trong tháng">' + pad + cells + '</div>' +
      '<div class="legend">' + LEGEND.map(function (x) {
        return '<span class="legend__i">' + (x.code ? SOC.badgeShift(x.code) : '<span class="badge-shift badge-shift--off" aria-hidden="true">·</span>') + SOC.esc(x.label) + '</span>';
      }).join('') + '</div></div></div>';
  }

  function attRowsHtml() {
    var rows = myRows();
    if (!rows.length) {
      var why = rep.rows === null ? 'Đang tải chấm công…'
        : rep.denied ? 'Cần quyền operator để xem bảng chấm công.'
        : rep.note ? rep.note
        : 'Chưa có chấm công tháng này cho người đang chọn.';
      return '<tr><td colspan="8"><div class="empty">' + SOC.esc(why) + '</div></td></tr>';
    }
    return rows.map(function (r) {
      var code = store.shiftOf(emp, r.reportDate);
      return '<tr data-sp-row="' + SOC.esc(r.reportDate) + '"' + (r.reportDate === day ? ' class="is-active"' : '') + '>' +
        '<td title="' + SOC.esc(r.reportDate) + '">' + SOC.esc(pretty(r.reportDate)) + '</td>' +
        '<td class="c">' + SOC.esc(dowOf(r.reportDate)) + '</td>' +
        '<td class="c">' + (code ? SOC.badgeShift(code) : '') + '</td>' +
        '<td>' + SOC.badgeStatus(r.result) + '</td>' +
        '<td class="num">' + SOC.esc(SOC.fmtTimeText(r.inTime) || '—') + '</td>' +
        '<td class="num">' + SOC.esc(SOC.fmtTimeText(r.outTime) || '—') + '</td>' +
        '<td class="num">' + SOC.esc(r.workHour || '—') + '</td>' +
        '<td title="' + SOC.esc(r.pmo || '') + '">' + SOC.esc(r.pmo || '—') + '</td></tr>';
    }).join('');
  }

  function attFootHtml() {
    var t = tally();
    return '<tr><td colspan="3">Tổng</td><td>' + t.work + ' ngày công</td>' +
      '<td class="num">' + t.absent + '</td><td class="num"></td>' +
      '<td class="num">' + t.hours.toFixed(1) + '</td><td>giờ</td></tr>';
  }

  function attHtml() {
    return '<div class="card">' +
      '<div class="task-list-toolbar">' +
      '<h2 class="section-heading">Chấm công tháng <span class="pill" id="spRowCount">' + myRows().length + ' dòng</span></h2>' +
      '</div>' +
      '<div class="table-wrap" tabindex="0" role="region" aria-label="Bảng chấm công tháng"><table><caption class="sr-only">Bảng chấm công của ' + SOC.esc(empInfo(emp).name) +
      ' trong ' + SOC.esc(SOC.monthLabel(ym())) + '</caption>' +
      '<thead><tr><th scope="col">Ngày</th><th scope="col" class="c">Thứ</th><th scope="col" class="c">Ca</th>' +
      '<th scope="col">Kết quả</th><th scope="col" class="num">Giờ vào</th><th scope="col" class="num">Giờ ra</th>' +
      '<th scope="col" class="num">Giờ công</th><th scope="col">PMO</th></tr></thead>' +
      '<tfoot id="spFoot">' + attFootHtml() + '</tfoot>' +
      '<tbody id="spBody">' + attRowsHtml() + '</tbody></table></div>' +
      '<div class="card__foot">Nguồn chấm công: sheet StaffAttendance theo tháng · ký hiệu ca đọc từ ma trận lịch.</div>' +
      '</div>';
  }

  function skeleton() {
    var rows = '';
    for (var i = 0; i < 7; i++) {
      rows += '<div class="skeleton-row"><div class="skeleton-cell"></div><div class="skeleton-cell"></div>' +
        '<div class="skeleton-cell"></div><div class="skeleton-cell"></div></div>';
    }
    return '<div class="card"><div class="skeleton-wrap">' + rows + '</div></div>';
  }

  /* ================= paint ================= */
  function paint() {
    var sec = el();
    if (!sec || !data) return;
    emp = resolveEmp();
    if (!inMonth(day)) day = defaultDay();
    var t = tally();
    SOC.pageActions(headHtml());
    sec.innerHTML = statsHtml(t) + '<div class="split split--rev"><div class="split__side">' +
      personHtml() + calHtml() + '</div>' + attHtml() + '</div>';
    SOC.setCount(PAGE, t.work);
  }

  function inMonth(v) {
    var ok = false;
    daysOf().forEach(function (x) { if (x.dateString === v) ok = true; });
    return ok;
  }

  function defaultDay() {
    var t = store.todayIso(), hit = '';
    daysOf().forEach(function (x) { if (x.dateString === t) hit = t; });
    if (hit) return hit;
    var rows = myRows();
    return rows.length ? String(rows[rows.length - 1].reportDate) : String((daysOf()[0] || {}).dateString || '');
  }

  /* vẽ lại riêng khối chấm công + tóm tắt — tránh phá ô tìm đang có focus */
  function fillRows() {
    var sec = el();
    if (!sec || !data) return;
    var body = document.getElementById('spBody');
    if (!body) { paint(); return; }
    var t = tally();
    body.innerHTML = attRowsHtml();
    var foot = document.getElementById('spFoot');
    if (foot) foot.innerHTML = attFootHtml();
    var cnt = document.getElementById('spRowCount');
    if (cnt) cnt.textContent = myRows().length + ' dòng';
    var stats = document.getElementById('spStats');
    if (stats) stats.outerHTML = statsHtml(t);
    SOC.setCount(PAGE, t.work);
  }

  function failToSec(err) {
    var sec = el();
    if (sec) sec.innerHTML = '<div class="card"><div class="empty"><b>Không tải được lịch cá nhân</b>' +
      SOC.esc((err && err.message) || 'lỗi kết nối') + '</div></div>';
    SOC.toast((err && err.message) || 'Không tải được lịch cá nhân', 'err');
  }

  /* ================= bảng chấm công ================= */
  function loadReports(force) {
    var m = ym();
    if (!SOC.atLeast('operator')) {
      rep.month = m; rep.rows = []; rep.job = null; rep.denied = true; rep.note = '';
      return Promise.resolve([]);
    }
    if (!force && rep.rows && rep.month === m) return Promise.resolve(rep.rows);
    if (rep.job && rep.jobMonth === m) return rep.job;
    rep.month = m; rep.jobMonth = m; rep.rows = null; rep.denied = false; rep.note = '';

    function settle(r, e) {
      rep.job = null;
      if (rep.month !== m) return [];                                   // tháng đã đổi giữa chừng — bỏ kết quả cũ
      if (e || !r || !r.ok) {
        rep.rows = [];
        rep.note = (e && e.message) || (r && r.message) || 'Không tải được chấm công lịch';
        SOC.toast(rep.note, 'err');
      } else {
        rep.rows = r.rows || [];
        rep.note = r.message || '';
      }
      if (SOC.state.page === PAGE) fillRows();
      return rep.rows;
    }
    rep.job = SOC.api.getScheduleReportsApi(m).then(function (r) { return settle(r); }, function (e) { return settle(null, e); });
    return rep.job;
  }

  /* ================= combobox chọn người ================= */
  function comboList(open) {
    var box = document.getElementById('spCombo');
    var input = document.getElementById('spQ');
    if (!box) return;
    if (!open) {
      box.hidden = true;
      if (input) input.setAttribute('aria-expanded', 'false');
      return;
    }
    var kw = q.trim().toLowerCase();
    var list = candidates().filter(function (c) {
      return !kw || (String(c.opsId) + ' ' + String(c.name)).toLowerCase().indexOf(kw) >= 0;
    }).slice(0, 40);
    box.innerHTML = list.length ? list.map(function (c) {
      return '<button type="button" class="sp-combo__i' + (String(c.opsId) === String(emp) ? ' on' : '') +
        '" data-sp-emp="' + SOC.esc(c.opsId) + '">' + SOC.esc(c.name) + '<span class="muted">' + SOC.esc(c.opsId) + '</span></button>';
    }).join('') : '<div class="sp-combo__none">Không có người khớp từ khóa</div>';
    box.hidden = false;
    if (input) input.setAttribute('aria-expanded', 'true');
  }

  function pickEmp(id) {
    if (!id) return;
    comboList(false);
    if (String(id) === String(emp)) return;
    emp = String(id);
    store.selId = emp;
    seenCursor = emp;
    day = '';
    paint();
    loadReports(false);
  }

  /* ================= sự kiện ================= */
  function exportCsv() {
    var rows = myRows();
    if (!rows.length) { SOC.toast('Không có dữ liệu để xuất', 'err'); return; }
    var head = ['Ngày', 'Mã Ops', 'Mã NV', 'Tên NV', 'Kết quả', 'Giờ công', 'Giờ vào', 'Giờ ra', 'PMO formula'];
    var lines = [head.join(',')].concat(rows.map(function (r) {
      return [r.reportDate, r.bizStaffId, r.employeeId, r.staffName, r.result, r.workHour, r.inTime, r.outTime, r.pmo]
        .map(function (v) { return '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"'; }).join(',');
    }));
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'chamcong_lich_' + ym() + '_' + emp + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    SOC.toast('Đã xuất ' + rows.length + ' dòng chấm công');
  }

  function selectDay(ds) {
    day = ds;
    var sec = el();
    if (sec) {
      sec.querySelectorAll('[data-sp-day]').forEach(function (b) {
        var on = b.getAttribute('data-sp-day') === ds;
        b.classList.toggle('on', on);
        if (on) b.setAttribute('aria-current', 'date'); else b.removeAttribute('aria-current');
      });
      sec.querySelectorAll('tr[data-sp-row]').forEach(function (tr) {
        tr.classList.toggle('is-active', tr.getAttribute('data-sp-row') === ds);
      });
    }
    fillRows();
  }

  function gotoMonth(m) {
    store.month = m;
    day = '';
    rep.rows = null;
    rep.month = '';
    render({ force: true });
  }

  function onDocClick(e) {
    var t = e.target;
    if (!t.closest) return;
    var opt = t.closest('[data-sp-emp]');
    if (opt) { pickEmp(opt.getAttribute('data-sp-emp')); return; }
    if (!t.closest('.sp-combo')) comboList(false);

    var cell = t.closest('[data-sp-day]');
    if (cell) { selectDay(cell.getAttribute('data-sp-day')); return; }

    var act = t.closest('[data-sp-act]');
    if (!act) return;
    var a = act.getAttribute('data-sp-act');
    if (a === 'reload') { rep.rows = null; rep.month = ''; render({ force: true }); return; }
    if (a === 'matrix') { SOC.selectPage('schedule'); return; }
    if (a === 'csv') { exportCsv(); return; }
    if (a === 'self') {
      var self = (data && data.staffInfoSelf) || null;
      if (!self || !self.opsId) { SOC.toast('Không xác định được hồ sơ của bạn', 'err'); return; }
      pickEmp(self.opsId);
      SOC.toast('Đã chuyển sang lịch của ' + self.name);
      return;
    }
  }

  function onDocKey(e) {
    var input = document.getElementById('spQ');
    if (!input || e.target !== input) return;
    if (e.key === 'Escape') { q = ''; input.value = ''; comboList(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); comboList(true); return; }
    if (e.key === 'Enter') {
      var box = document.getElementById('spCombo');
      var first = box && !box.hidden ? box.querySelector('[data-sp-emp]') : null;
      if (first) { e.preventDefault(); pickEmp(first.getAttribute('data-sp-emp')); }
    }
  }

  function onDocInput(e) {
    var t = e.target;
    if (t.getAttribute('data-sp-q') !== null) {
      q = t.value;
      clearTimeout(timer);
      timer = setTimeout(function () { comboList(true); }, SEARCH_MS);
      return;
    }
  }

  document.addEventListener('click', onDocClick);
  document.addEventListener('input', onDocInput);
  document.addEventListener('keydown', onDocKey);

  /* ================= entry ================= */
  function render(ctx) {
    var sec = el();
    if (!sec) return;
    store = SOC.schedStore;
    var force = !!(ctx && ctx.force);
    if (!store.month) store.month = store.currentMonth();
    if (store.selId && store.selId !== seenCursor) { emp = store.selId; seenCursor = store.selId; }
    if (rep.month && rep.month !== store.month) { rep.rows = null; rep.month = ''; }

    var m = store.month;
    var cached = store.peek(m);
    if (cached && !force) {
      data = cached;
      paint();
      loadReports(false);
      store.reload(m).then(function (d) {
        if (SOC.state.page !== PAGE) return;
        data = d;
        paint();
        loadReports(false);
      }, function () {});
      return;
    }
    SOC.pageActions(headHtml());
    sec.innerHTML = skeleton();
    store.get(m, force).then(function (d) {
      data = d;
      emp = resolveEmp();
      seenCursor = store.selId;
      paint();
      loadReports(force);
      store.ensureRoster().then(function () { if (SOC.state.page === PAGE && data) fillRows(); });
    }, failToSec);
  }

  SOC.registerView(PAGE, { section: SECTION, render: render });
})();
