/* view-schedule.js — "Lịch tháng": ma trận nhân viên × ngày.
   Đồng thời khai báo SOC.schedStore — nơi DUY NHẤT gọi getScheduleMonthWithPositionApi,
   để 3 view lịch (tháng / cá nhân / ngày) dùng chung một request theo tháng. */
(function () {
  'use strict';

  var PAGE = 'schedule';
  var SECTION = 'viewSchedule';
  var CHUNK = 200;        // khớp giới hạn batch ghi lịch phía server
  var SEARCH_MS = 250;

  var SHIFT_GROUPS = [
    { title: 'Ca sáng', codes: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'] },
    { title: 'Ca chiều', codes: ['S10', 'S11', 'S12', 'S13', 'S14'] },
    { title: 'Ca tối', codes: ['S15', 'S16', 'S17', 'S18', 'S19'] },
    { title: 'Nghỉ & phép', codes: ['OFF', 'PH', 'HL', 'AL', 'SL', 'MAL', 'CL', 'PL', 'ML', 'OIL', 'NPL'] }
  ];
  var LEGEND = [
    { code: 'S1', label: 'Ca sáng' }, { code: 'S10', label: 'Ca chiều' }, { code: 'S15', label: 'Ca tối' },
    { code: 'OFF', label: 'Nghỉ tuần' }, { code: 'PH', label: 'Nghỉ lễ' }, { code: 'AL', label: 'Nghỉ phép' },
    { code: '', label: 'Chưa xếp' }
  ];

  /* =====================================================================
     [CHUNG] SOC.schedStore — cache lịch 1 tháng + ô đang sửa chờ lưu +
     roster station/team (enrich từ getFilterOptionsApi). Ba view lịch đều
     đọc qua đây, KHÔNG tự gọi getScheduleMonthWithPositionApi.
     ===================================================================== */
  var store = {
    selId: null,          // con trỏ "người đang xem" — matrix ghi, Lịch cá nhân đọc
    month: '',            // tháng đang cache ('YYYY-MM')
    data: null,           // payload getScheduleMonthWithPositionApi
    pending: {},          // 'empId|YYYY-MM-DD' -> {empId,dateString,newShift}
    orig: {},             // giá trị trước khi sửa, để bỏ khỏi pending khi hoàn tác
    roster: {},           // opsId -> {station, team, slotCode, contractType}
    rosterJob: null,
    reqId: 0,
    job: null,
    SHIFT_GROUPS: SHIFT_GROUPS,

    todayIso: function () { return SOC.isoDay(new Date()); },
    canEdit: function () { return SOC.atLeast('admin'); },

    isWork: function (code) {
      var c = SOC.shiftCategory(code);
      return c === 'morning' || c === 'afternoon' || c === 'evening';
    },
    labelOf: function (code) {
      var c = String(code || '').toUpperCase();
      if (!c) return 'Xóa ca';
      for (var i = 0; i < SHIFT_GROUPS.length; i++) {
        if (SHIFT_GROUPS[i].codes.indexOf(c) >= 0) return SHIFT_GROUPS[i].title + ' (' + c + ')';
      }
      return c;
    },
    meta: function (empId) { return this.roster[empId] || null; },
    nameOf: function (empId) {
      var out = '';
      ((this.data && this.data.employees) || []).forEach(function (e) { if (String(e.id) === String(empId)) out = e.name; });
      return out || String(empId || '');
    },
    // giá trị ca HIỆN TẠI (đã tính ô đang sửa chưa lưu)
    shiftOf: function (empId, ds) {
      var d = this.data;
      var row = d && d.schedule && d.schedule[empId];
      return String((row && row[ds]) || '');
    },
    isDirty: function (empId, ds) { return !!this.pending[empId + '|' + ds]; },
    applyShift: function (empId, ds, code) {
      var d = this.data;
      if (!d) return;
      var key = empId + '|' + ds;
      if (!d.schedule[empId]) d.schedule[empId] = {};
      if (!(key in this.orig)) this.orig[key] = String(d.schedule[empId][ds] || '');
      d.schedule[empId][ds] = code;
      if (this.orig[key] === String(code || '')) delete this.pending[key];
      else this.pending[key] = { empId: empId, dateString: ds, newShift: code };
    },
    dirtyList: function () {
      var o = this.pending;
      return Object.keys(o).map(function (k) { return o[k]; })
        .sort(function (a, b) { return a.dateString === b.dateString ? String(a.empId).localeCompare(String(b.empId)) : (a.dateString < b.dateString ? -1 : 1); });
    },
    dirtyCount: function () { return Object.keys(this.pending).length; },
    clearDirty: function () { this.pending = {}; this.orig = {}; },

    peek: function (month) {
      return (this.data && (!month || this.month === month)) ? this.data : null;
    },
    get: function (month, force) {
      var m = month || this.currentMonth();
      if (!force && this.data && this.month === m) return Promise.resolve(this.data);
      return this.reload(m);
    },
    reload: function (month) {
      var m = month || this.currentMonth();
      if (this.job && this.job.month === m) return this.job.p;
      var self = this, id = ++this.reqId;
      var p = SOC.api.getScheduleMonthWithPositionApi(m).then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.message) || 'Không tải được lịch tháng');
        if (id === self.reqId) { self.data = r; self.month = r.month || m; }
        return r;
      });
      function settle() { if (self.job && self.job.month === m) self.job = null; }
      this.job = { month: m, p: p };
      p.then(settle, settle);
      return p;
    },
    currentMonth: function () { return this.month || SOC.isoMonth(new Date()); },
    ensureRoster: function () {
      if (this.rosterJob) return this.rosterJob;
      if (!SOC.atLeast('operator')) { this.rosterJob = Promise.resolve({}); return this.rosterJob; }
      var self = this;
      this.rosterJob = SOC.api.getFilterOptionsApi().then(function (r) {
        if (r && r.ok && r.staffList) {
          r.staffList.forEach(function (s) {
            self.roster[s.staffId] = {
              station: s.station || '', team: s.team || '', slotCode: s.slotCode || '', contractType: s.contractType || ''
            };
          });
        }
        return self.roster;
      })['catch'](function () { return self.roster; });   // roster chỉ để enrich cột, lỗi thì im lặng đọc tiếp
      return this.rosterJob;
    }
  };
  SOC.schedStore = store;

  /* ================= state riêng view lịch tháng ================= */
  var f = { q: '' };
  var editOn = false;
  var searchTimer = null;

  function el() { return document.getElementById(SECTION); }

  function monthDays(d) { return (d && d.daysInMonth) || []; }

  function focusDay(d) {
    var t = store.todayIso(), hit = '';
    monthDays(d).forEach(function (x) { if (x.dateString === t) hit = t; });
    return hit || (monthDays(d)[0] || {}).dateString || '';
  }

  function filtered(d) {
    var q = f.q.trim().toLowerCase();
    return ((d && d.employees) || []).filter(function (e) {
      if (!q) return true;
      return (String(e.id) + ' ' + String(e.name) + ' ' + String(e.title)).toLowerCase().indexOf(q) >= 0;
    });
  }

  /* ================= markup đầu trang (slot chung #pageActions) ================= */
  /* prev · next · menu 12 tháng cùng về một cửa — đổi tháng là mất cache tháng cũ + đóng ô chọn ca */
  function gotoMonth(ym) {
    store.month = ym;
    store.data = null;
    closePicker();
    render({ force: true });
  }

  function headHtml(d) {
    var m = store.month || d.month;
    var dirty = store.dirtyCount();
    var html = SOC.monthNav(m, { onPick: gotoMonth });
    html += '<button type="button" class="btn btn-outline" data-sch-act="edit" aria-pressed="' + (editOn ? 'true' : 'false') +
      '" title="Bật/tắt chế độ sửa ca (chỉ admin)"><span class="btn-label">Sửa ca</span><span class="btn-ico">' + SOC.ico('edit', 16) + '</span></button>';
    if (editOn && dirty) {
      html += '<button type="button" class="btn btn-amber" data-sch-act="save" title="Ghi ' + dirty + ' ô đã sửa vào sheet lịch">' +
        '<span class="btn-label">Lưu (' + dirty + ')</span><span class="btn-ico">' + SOC.ico('check', 16) + '</span></button>' +
        '<button type="button" class="btn btn-ghost" data-sch-act="discard"><span class="btn-label">Bỏ sửa</span></button>';
    }
    html += '<button type="button" class="btn btn-outline" data-sch-act="copy" title="Sao chép bảng đang lọc">' +
      '<span class="btn-label">Chép</span><span class="btn-ico">' + SOC.ico('copy', 16) + '</span></button>';
    html += '<button type="button" class="btn btn-outline" data-sch-act="reload" title="Tải lại lịch tháng">' +
      '<span class="btn-label">Cập nhật</span><span class="btn-ico">' + SOC.ico('refresh', 16) + '</span></button>';
    return html;
  }

  /* ================= dải thống kê đầu trang ================= */
  function statCard(label, value, note, kind) {
    return '<div class="stat-card' + (kind ? ' stat-card--' + kind : '') + '">' +
      '<span class="stat-card__label">' + SOC.esc(label) + '</span>' +
      '<span class="stat-card__value">' + SOC.esc(value) + '</span>' +
      '<span class="stat-card__note">' + SOC.esc(note) + '</span></div>';
  }

  function statsHtml(d, emps) {
    var ds = focusDay(d), work = 0, rest = 0, blank = 0;
    emps.forEach(function (e) {
      var code = store.shiftOf(e.id, ds);
      if (!code) blank++;
      else if (store.isWork(code)) work++;
      else rest++;
    });
    var dayNote = ds ? SOC.fmtDate(new Date(Number(ds.slice(0, 4)), Number(ds.slice(5, 7)) - 1, Number(ds.slice(8, 10)))) : '—';
    var slots = {};
    emps.forEach(function (e) {
      monthDays(d).forEach(function (x) {
        var c = store.shiftOf(e.id, x.dateString);
        if (c) slots[c] = 1;
      });
    });
    return '<div class="stat-strip" id="schStats">' +
      statCard('Nhân sự hiển thị', emps.length, 'lọc từ ' + ((d.employees || []).length) + ' người trong tháng') +
      statCard('Đi làm · ' + dayNote, work, rest + ' nghỉ · ' + blank + ' chưa xếp', work ? 'ok' : '') +
      statCard('Nghỉ & phép', rest, 'OFF · lễ · phép · không lương', rest ? 'warn' : '') +
      statCard('Ký hiệu đã dùng', Object.keys(slots).length, 'số mã ca xuất hiện trong tháng') +
      '</div>';
  }

  /* ================= legend ký hiệu ================= */
  function filtersHtml() {
    return '<div class="stats-filters">' +
      '<div class="frow"><span class="flabel">Ký hiệu</span><div class="legend">' +
      LEGEND.map(function (x) {
        return '<span class="legend__i">' + (x.code ? SOC.badgeShift(x.code) : '<span class="badge-shift badge-shift--off" aria-hidden="true">·</span>') +
          SOC.esc(x.label) + '</span>';
      }).join('') + '</div></div></div>';
  }

  /* ================= bảng ma trận ================= */
  function dayHead(d) {
    return monthDays(d).map(function (x) {
      var cls = 'sch-day c' + (x.isWeekend ? ' sch-day--wk' : '') + (x.dateString === store.todayIso() ? ' sch-day--today' : '');
      return '<th scope="col" class="' + cls + '" title="' + SOC.esc(x.dateString) + '">' +
        '<span class="sch-day__w">' + SOC.esc(x.dayOfWeek) + '</span>' +
        '<span class="sch-day__n">' + SOC.esc(x.date) + '</span></th>';
    }).join('');
  }

  function cellHtml(e, x) {
    var code = store.shiftOf(e.id, x.dateString);
    var dirty = store.isDirty(e.id, x.dateString);
    var cls = 'sch-cell c' + (x.isWeekend ? ' sch-cell--wk' : '') + (dirty ? ' sch-dirty' : '') +
      (editOn && store.canEdit() ? ' sch-cell--edit' : '');
    var attrs = editOn && store.canEdit()
      ? ' tabindex="0" role="button" data-sch-cell="' + SOC.esc(e.id) + '|' + SOC.esc(x.dateString) + '" aria-label="Chọn ca cho ' +
        SOC.esc(e.name) + ' ngày ' + SOC.esc(x.dateString) + '"'
      : '';
    return '<td class="' + cls + '"' + attrs + '>' + (code ? SOC.badgeShift(code) : '') + '</td>';
  }

  function rowHtml(e, i, d) {
    var st = store.meta(e.id);
    var stt = st ? (st.station + ' · ' + st.team) : (e.title || '');
    return '<tr>' +
      '<td class="sch-c1 num">' + (i + 1) + '</td>' +
      '<td class="sch-c2"><button type="button" class="sch-emp" data-sch-open="' + SOC.esc(e.id) + '" title="Xem lịch cá nhân">' + SOC.esc(e.name) + '</button></td>' +
      '<td class="sch-c3"><button type="button" class="sch-emp sch-emp--code" data-sch-open="' + SOC.esc(e.id) + '">' + SOC.esc(e.id) + '</button></td>' +
      '<td class="sch-c4" title="' + SOC.esc(stt) + '">' + SOC.esc(stt) + '</td>' +
      monthDays(d).map(function (x) { return cellHtml(e, x); }).join('') +
      '</tr>';
  }

  function footHtml(d, emps) {
    var byDay = {};
    emps.forEach(function (e) {
      monthDays(d).forEach(function (x) {
        if (store.isWork(store.shiftOf(e.id, x.dateString))) byDay[x.dateString] = (byDay[x.dateString] || 0) + 1;
      });
    });
    var total = 0;
    monthDays(d).forEach(function (x) { total += byDay[x.dateString] || 0; });
    return '<tr>' +
      '<td class="sch-c1"></td>' +
      '<td class="sch-c2">Đi làm theo ngày</td>' +
      '<td class="sch-c3 num">' + total + '</td>' +
      '<td class="sch-c4">ca · tháng</td>' +
      monthDays(d).map(function (x) {
        return '<td class="sch-cell c' + (x.isWeekend ? ' sch-cell--wk' : '') + '">' + (byDay[x.dateString] || 0) + '</td>';
      }).join('') + '</tr>';
  }

  function tableHtml(d, emps) {
    if (!emps.length) {
      return '<div class="empty"><b>Không có nhân viên phù hợp</b>' +
        (f.q ? ' — thử xóa từ khóa trong ô tìm kiếm.' : ' — tháng này chưa có dữ liệu lịch.') + '</div>';
    }
    return '<div class="table-wrap"><table class="sch-t" style="--sch-days:' + monthDays(d).length + '">' +
      '<caption class="sr-only">Ma trận lịch làm việc theo nhân viên và ngày trong ' + SOC.esc(SOC.monthLabel(store.month || d.month)) + '</caption>' +
      '<thead><tr>' +
      '<th scope="col" class="sch-c1 num">STT</th>' +
      '<th scope="col" class="sch-c2">Họ tên</th>' +
      '<th scope="col" class="sch-c3">Mã OPS</th>' +
      '<th scope="col" class="sch-c4">Station · Team</th>' +
      dayHead(d) + '</tr></thead>' +
      '<tfoot id="schFoot">' + footHtml(d, emps) + '</tfoot>' +
      '<tbody id="schBody">' + emps.map(function (e, i) { return rowHtml(e, i, d); }).join('') + '</tbody>' +
      '</table></div>';
  }

  function cardHtml(d, emps) {
    return '<div class="card">' +
      '<div class="task-list-toolbar">' +
        '<h2 class="section-heading">Lịch tháng</h2>' +
        '<div class="list-search"><input type="search" id="schQ" data-sch-q placeholder="Tìm tên hoặc mã OPS…" autocomplete="off" spellcheck="false" aria-label="Tìm nhân viên trong lịch" value="' + SOC.esc(f.q) + '">' +
        '<button type="button" class="btn-icon" data-sch-act="clearq" aria-label="Xóa từ khóa" title="Xóa từ khóa">' + SOC.ico('close', 16) + '</button></div>' +
      '</div>' +
      '<div id="schFilters">' + filtersHtml() + '</div>' +
      tableHtml(d, emps) +
      '<div class="card__foot">' + editHint() + '</div>' +
      '</div>';
  }

  function editHint() {
    if (!store.canEdit()) return 'Bản đọc — chỉ admin sửa được ca. Bấm tên nhân viên để mở lịch cá nhân.';
    if (!editOn) return 'Admin: bật "Sửa ca" để đổi mã ca từng ô; ngày đã qua chỉ xem.';
    var n = store.dirtyCount();
    return 'Đang sửa — ' + n + ' ô chờ lưu. Bấm "Lưu" để ghi vào sheet lịch.';
  }

  /* ================= paint ================= */
  function paintRows() {
    var d = store.data, sec = el();
    if (!d || !sec) return;
    var emps = filtered(d);
    var body = document.getElementById('schBody');
    if (!body) { sec.innerHTML = statsHtml(d, emps) + cardHtml(d, emps); }
    else {
      body.innerHTML = emps.map(function (e, i) { return rowHtml(e, i, d); }).join('');
      var foot = document.getElementById('schFoot');
      if (foot) foot.innerHTML = footHtml(d, emps);
      var stats = document.getElementById('schStats');
      if (stats) stats.outerHTML = statsHtml(d, emps);
      var hint = sec.querySelector('.card__foot');
      if (hint) hint.textContent = editHint();
    }
    SOC.setCount(PAGE, emps.length);
    SOC.pageActions(headHtml(d));
  }

  function paint(d) {
    var sec = el();
    if (!sec) return;
    var emps = filtered(d);
    SOC.pageActions(headHtml(d));
    sec.innerHTML = statsHtml(d, emps) + cardHtml(d, emps);
    SOC.setCount(PAGE, emps.length);
  }

  function skeleton() {
    var rows = '';
    for (var i = 0; i < 8; i++) {
      rows += '<div class="skeleton-row"><div class="skeleton-cell"></div><div class="skeleton-cell"></div>' +
        '<div class="skeleton-cell"></div><div class="skeleton-cell"></div><div class="skeleton-cell"></div></div>';
    }
    return '<div class="card"><div class="skeleton-wrap">' + rows + '</div></div>';
  }

  function failToSec(err) {
    var sec = el();
    if (sec) sec.innerHTML = '<div class="card"><div class="empty"><b>Không tải được lịch tháng</b>' +
      SOC.esc((err && err.message) || 'lỗi kết nối') + '</div></div>';
    SOC.toast((err && err.message) || 'Không tải được lịch tháng', 'err');
  }

  /* ================= ghi lịch ================= */
  function sendChunk(batch, idx, done) {
    if (idx >= batch.length) {
      store.clearDirty();
      return store.reload(store.month).then(function (d) {
        paint(d);
        SOC.toast('Đã lưu ' + done + ' ô lịch');
      }, function () {
        if (store.data) paint(store.data);
        SOC.toast('Đã ghi lịch nhưng tải lại thất bại', 'err');
      });
    }
    return SOC.api.updateScheduleApi(batch.slice(idx, idx + CHUNK)).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.message) || 'Lỗi lưu lịch');
      return sendChunk(batch, idx + CHUNK, done + CHUNK);
    });
  }

  function saveAll(btn) {
    var batch = store.dirtyList();
    if (!batch.length) { SOC.toast('Chưa có ô nào để lưu', 'err'); return; }
    SOC.confirm({
      title: 'Lưu lịch làm việc',
      message: 'Ghi ' + batch.length + ' ô đã sửa vào sheet lịch của kho? Thao tác này thay đổi ca của nhân viên.',
      okLabel: 'Lưu lịch'
    }).then(function (ok) {
      if (!ok) return;
      SOC.setBtnBusy_(btn, true, 'Đang lưu');
      sendChunk(batch, 0, 0)['catch'](function (e) {
        SOC.toast((e && e.message) || 'Lỗi lưu lịch', 'err');
      }).then(function () { SOC.setBtnBusy_(btn, false); });
    });
  }

  /* ================= picker chọn ca ================= */
  var pickerPrev = null;
  var pickerTrap = null;

  function closePicker() {
    var box = document.getElementById('schPicker');
    if (box && box.parentNode) box.parentNode.removeChild(box);
    document.removeEventListener('keydown', pickerKey, true);
    if (pickerTrap) { pickerTrap(); pickerTrap = null; }
    if (pickerPrev && pickerPrev.focus) { try { pickerPrev.focus({ preventScroll: true }); } catch (e) {} }
    pickerPrev = null;
  }

  function pickerKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); closePicker(); }
  }

  function openPicker(empId, ds) {
    if (ds < store.todayIso()) { SOC.toast('Ngày đã qua chỉ xem — không sửa lịch sử', 'err'); return; }
    closePicker();
    pickerPrev = document.activeElement;
    var cur = store.shiftOf(empId, ds);
    var grp = function (title, codes) {
      return '<div class="sch-pick__grp"><div class="sch-pick__title">' + SOC.esc(title) + '</div><div class="sch-pick__row">' +
        codes.map(function (c) {
          return '<button type="button" class="sch-pick__btn' + (c === cur ? ' on' : '') + '" data-sch-pick="' + SOC.esc(c) +
            '" title="' + SOC.esc(store.labelOf(c)) + '">' + (c ? SOC.esc(c) : 'Xóa') + '</button>';
        }).join('') + '</div></div>';
    };
    var box = document.createElement('div');
    box.id = 'schPicker';
    box.className = 'about-overlay';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('data-emp', empId);
    box.setAttribute('data-ds', ds);
    box.setAttribute('aria-label', 'Chọn ca cho ' + store.nameOf(empId) + ' ngày ' + ds);
    box.innerHTML = '<div class="about-dialog sch-pick">' +
      '<div class="modal-head"><div><h2>' + SOC.esc(store.nameOf(empId)) + '</h2>' +
      '<div class="mode-desc">' + SOC.esc(empId) + ' · ' + SOC.esc(SOC.fmtDate(new Date(Number(ds.slice(0, 4)), Number(ds.slice(5, 7)) - 1, Number(ds.slice(8, 10))))) +
      ' · ca hiện tại ' + (cur ? SOC.esc(cur) : 'trống') + '</div></div>' +
      '<button type="button" class="btn-icon" data-sch-act="pickclose" aria-label="Đóng">' + SOC.ico('close', 18) + '</button></div>' +
      SHIFT_GROUPS.map(function (g) { return grp(g.title, g.codes); }).join('') +
      grp('Khác', ['']) +
      '<div class="modal-foot"><span class="muted">Thay đổi chỉ ghi khi bấm Lưu trên thanh tiêu đề.</span>' +
      '<button type="button" class="btn btn-ghost" data-sch-act="pickclose"><span class="btn-label">Đóng</span></button></div>' +
      '</div>';
    document.body.appendChild(box);
    document.addEventListener('keydown', pickerKey, true);
    pickerTrap = SOC.trapFocus(box);
    var b0 = box.querySelector('.sch-pick__btn');
    if (b0) b0.focus();
  }

  /* ================= sao chép matrix ================= */
  function copyMatrix() {
    var d = store.data;
    if (!d) return;
    var emps = filtered(d);
    if (!emps.length) { SOC.toast('Bảng đang trống', 'err'); return; }
    var lines = [['STT', 'Họ tên', 'Mã OPS', 'Station', 'Team'].concat(monthDays(d).map(function (x) { return x.dateString; })).join('\t')];
    emps.forEach(function (e, i) {
      var st = store.meta(e.id) || {};
      lines.push([i + 1, e.name, e.id, st.station || '', st.team || '']
        .concat(monthDays(d).map(function (x) { return store.shiftOf(e.id, x.dateString); })).join('\t'));
    });
    var ta = document.createElement('textarea');
    ta.setAttribute('aria-hidden', 'true');
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    ta.value = lines.join('\n');
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    SOC.toast(ok ? 'Đã sao chép ' + emps.length + ' dòng Lịch tháng' : 'Trình duyệt chặn sao chép', ok ? 'ok' : 'err');
  }

  /* ================= sự kiện (delegation — section tĩnh, chỉ innerHTML đổi) ================= */
  function onDocClick(e) {
    var t = e.target;
    var pick = t.closest ? t.closest('[data-sch-pick]') : null;
    if (pick) {
      var box = document.getElementById('schPicker');
      if (box) store.applyShift(box.getAttribute('data-emp'), box.getAttribute('data-ds'), pick.getAttribute('data-sch-pick'));
      closePicker();
      paintRows();
      return;
    }
    if (t.id === 'schPicker') { closePicker(); return; }         // nền tối sau dialog = đóng
    if (t.closest && t.closest('#schPicker')) {
      if (t.closest('[data-sch-act="pickclose"]')) closePicker();
      return;
    }

    var cell = t.closest ? t.closest('[data-sch-cell]') : null;
    if (cell) {
      var cp = cell.getAttribute('data-sch-cell').split('|');
      openPicker(cp[0], cp[1]);
      return;
    }
    var open = t.closest ? t.closest('[data-sch-open]') : null;
    if (open) {
      store.selId = open.getAttribute('data-sch-open');
      SOC.selectPage('schedule-personal');
      return;
    }
    var act = t.closest ? t.closest('[data-sch-act]') : null;
    if (!act) return;
    var a = act.getAttribute('data-sch-act');
    if (a === 'pickclose') { closePicker(); return; }
    if (a === 'reload') { closePicker(); render({ force: true }); return; }
    if (a === 'copy') { copyMatrix(); return; }
    if (a === 'clearq') {
      var inp = document.getElementById('schQ');
      f.q = '';
      if (inp) { inp.value = ''; inp.focus(); }
      paintRows();
      return;
    }
    if (a === 'edit') {
      if (!store.canEdit()) { SOC.toast('Không đủ quyền — cần role admin để sửa ca', 'err'); return; }
      editOn = !editOn;
      act.setAttribute('aria-pressed', editOn ? 'true' : 'false');
      paint(store.data);
      return;
    }
    if (a === 'save') { saveAll(act); return; }
    if (a === 'discard') {
      store.dirtyList().forEach(function (u) { store.applyShift(u.empId, u.dateString, store.orig[u.empId + '|' + u.dateString]); });
      store.clearDirty();
      paint(store.data);
      SOC.toast('Đã bỏ mọi thay đổi chưa lưu');
    }
  }

  function onDocInput(e) {
    if (!e.target || e.target.getAttribute('data-sch-q') === null) return;
    f.q = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(paintRows, SEARCH_MS);
  }

  function onCellKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var cell = e.target.closest ? e.target.closest('[data-sch-cell]') : null;
    if (!cell) return;
    e.preventDefault();
    var p = cell.getAttribute('data-sch-cell').split('|');
    openPicker(p[0], p[1]);
  }

  document.addEventListener('click', onDocClick);
  document.addEventListener('input', onDocInput);
  document.addEventListener('keydown', onCellKey);

  /* ================= entry ================= */
  function render(ctx) {
    var sec = el();
    if (!sec) return;
    var force = !!(ctx && ctx.force);
    if (!store.canEdit()) editOn = false;
    if (!store.month) store.month = store.currentMonth();
    var m = store.month;

    if (force) {
      SOC.pageActions(headHtml({ month: m }));
      sec.innerHTML = skeleton();
      store.reload(m).then(function (d) { paint(d); }, failToSec);
      rosterThenPaint();
      return;
    }
    var cached = store.peek(m);
    if (cached) {
      paint(cached);
      store.reload(m).then(function (d) {
        if (SOC.state.page !== PAGE) return;
        var q = document.getElementById('schQ');
        if (q && document.activeElement === q) { paintRows(); return; }   // không cướp caret khi đang gõ
        paint(d);
      }, function () {});
      rosterThenPaint();
      return;
    }
    SOC.pageActions(headHtml({ month: m }));
    sec.innerHTML = skeleton();
    store.reload(m).then(function (d) { paint(d); }, failToSec);
    rosterThenPaint();
  }

  // roster (station/team) về sau -> vẽ lại 1 lần; bỏ qua khi tháng đang tải để không chớp dữ liệu cũ
  function rosterThenPaint() {
    store.ensureRoster().then(function () {
      if (store.data && !store.job && SOC.state.page === PAGE) paint(store.data);
    });
  }

  SOC.registerView(PAGE, { section: SECTION, render: render });
})();
