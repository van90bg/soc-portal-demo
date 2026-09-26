/* view-stats.js — page 'stats' · section 'viewStats' (prefix .st-)
   Dải số liệu hôm nay + 2 bảng pivot chấm công (Contract Type × Ca, Agency × Ca) tách block department.
   Nguồn pivot: StaffData — lượt chấm công THỰC TẾ (người × ngày có cardIn), KHÔNG đếm từ Schedule
   (chốt 2026-09-26); dải stat-card vẫn theo lịch hôm nay. Mọi số liệu qua SOC.api (hợp đồng §3c). */
(function () {
  'use strict';

  var PAGE = 'stats';
  var SECTION = 'viewStats';

  var data = null;        // {staff, lists, employees, schedule, month, refDay}
  var loading = false;
  var tab = 'contract';   // 'contract' | 'agency' — ≤1024px hiện một bảng tại một thời điểm
  var wired = false;
  var filters = { station: '', date: '' };

  function txt(r, f) { return String((r && r[f]) || '').trim(); }
  /* StaffData dùng staffName, payload thống kê kiểu cũ dùng name — chuẩn hoá tại 1 chỗ */
  function personName(r) { return txt(r, 'staffName') || txt(r, 'name'); }
  function isWorkCode(code) {
    var c = SOC.shiftCategory(code);
    return c === 'morning' || c === 'afternoon' || c === 'evening';
  }
  function distinct(rows, field) {
    var seen = {}, out = [];
    rows.forEach(function (r) {
      var v = txt(r, field);
      if (v && !seen[v]) { seen[v] = 1; out.push(v); }
    });
    return out.sort();
  }
  /* Thứ tự Config trước, giá trị lệch (chưa khai ở Cấu hình) xếp sau — không mất dữ liệu */
  function ordered(vals, cfg) {
    var list = (cfg || []).filter(function (v) { return vals.indexOf(v) >= 0; });
    return list.concat(vals.filter(function (v) { return list.indexOf(v) < 0; }));
  }

  /* ---------- tải số liệu ---------- */
  /* showSkeleton=false dùng cho lần làm mới nền: giữ nguyên bảng đang xem, không chớp khung */
  function load(showSkeleton) {
    if (loading) return;
    loading = true;
    var host = document.getElementById(SECTION);
    if (showSkeleton && host) host.innerHTML = skeleton(6);
    var month = SOC.isoMonth(new Date());
    Promise.all([
      SOC.api.getStaffStatsApi(),
      SOC.api.getFilterOptionsApi(),
      SOC.api.getScheduleMonthApi(month)
    ]).then(function (res) {
      loading = false;
      var stats = res[0];
      if (!stats || !stats.ok) {
        SOC.toast((stats && stats.message) || 'Không tải được dữ liệu nhân sự', 'err');
        if (!data) blocked((stats && stats.message) || 'Không tải được dữ liệu nhân sự');
        return;
      }
      var opts = res[1], sched = res[2];
      data = {
        staff: (stats.staff || []).filter(function (r) { return r && (personName(r) || txt(r, 'staffId')); }),
        lists: (opts && opts.ok && opts.lists) || {},
        employees: (sched && sched.ok && sched.employees) || [],
        schedule: (sched && sched.ok && sched.schedule) || {},
        month: month
      };
      data.refDay = pickRefDay();
      SOC.setCount(PAGE, data.staff.length);
      paint();
    }).catch(function (e) {
      loading = false;
      SOC.toast('Lỗi tải thống kê: ' + e.message, 'err');
      if (!data) blocked('Lỗi tải thống kê: ' + e.message);
    });
  }

  /* Ngày tham chiếu dải số liệu: hôm nay nếu lịch có dữ liệu, nếu không lấy ngày cuối có lịch
     — tránh dải toàn số 0 khi tháng chưa có dữ liệu (mock chỉ phủ 1 tháng). */
  function pickRefDay() {
    var today = SOC.isoDay(new Date());
    var ids = Object.keys(data.schedule);
    if (!ids.length) return today;
    if (Object.keys(data.schedule).some(function (id) { return !!data.schedule[id][today]; })) return today;
    var best = '';
    ids.forEach(function (id) {
      Object.keys(data.schedule[id] || {}).forEach(function (d) { if (d > best) best = d; });
    });
    return best || today;
  }

  function blocked(msg) {
    var host = document.getElementById(SECTION);
    if (!host) return;
    host.innerHTML = '<div class="card"><div class="empty">' + esc(msg) + '</div></div>';
  }
  function esc(v) { return SOC.esc(v); }

  function skeleton(rows) {
    var out = '<div class="skeleton-wrap">';
    for (var i = 0; i < (rows || 5); i++) {
      out += '<div class="skeleton-row">' +
        '<div class="skeleton-cell"></div><div class="skeleton-cell"></div><div class="skeleton-cell"></div>' +
        '<div class="skeleton-cell"></div><div class="skeleton-cell"></div><div class="skeleton-cell"></div>' +
        '<div class="skeleton-cell"></div><div class="skeleton-cell"></div></div>';
    }
    return out + '</div>';
  }

  /* ---------- lọc + nguồn chấm công ---------- */
  function staffFiltered() {
    return data.staff.filter(function (r) {
      if (filters.station && txt(r, 'station') !== filters.station) return false;
      return true;
    });
  }
  /* attDays = danh sách ngày có cardIn trong tháng (mock). Payload chưa có attDays mà có cardIn
     → coi bản ghi là 1 ngày chấm công của chính nó (đúng khuôn StaffData prod mỗi dòng 1 ngày). */
  function attDaysOf(r) {
    if (Array.isArray(r.attDays)) return r.attDays;
    return txt(r, 'cardIn') ? [txt(r, 'date')] : [];
  }
  function attDates() {
    var seen = {}, out = [];
    staffFiltered().forEach(function (r) {
      attDaysOf(r).forEach(function (d) { if (d && !seen[d]) { seen[d] = 1; out.push(d); } });
    });
    return out.sort().reverse();
  }
  /* Mỗi lượt = người × ngày chấm công; thiếu slotCode thì không có hàng Ca để đếm */
  function attEntries() {
    var out = [];
    staffFiltered().forEach(function (r) {
      if (!txt(r, 'slotCode')) return;
      attDaysOf(r).forEach(function (d) {
        if (filters.date && d !== filters.date) return;
        out.push(r);
      });
    });
    return out;
  }
  function filterActive() { return !!(filters.station || filters.date); }

  /* ---------- dải số liệu hôm nay (theo lịch + cardIn — nguồn riêng với bảng pivot) ---------- */
  function strip() {
    var rows = staffFiltered();
    var empName = {}, byName = {};
    data.employees.forEach(function (e) { empName[e.id] = e.name; });
    data.staff.forEach(function (r) { byName[personName(r)] = r; });

    var working = 0, leave = 0, missing = 0, day = data.refDay;
    Object.keys(data.schedule).forEach(function (id) {
      var code = txt(data.schedule[id], day).toUpperCase();
      if (!code) return;
      var cat = SOC.shiftCategory(code);
      if (isWorkCode(code)) {
        working++;
        var rec = byName[empName[id] || id];
        if (!rec || !txt(rec, 'cardIn')) missing++;
      } else if (cat === 'leave' || cat === 'holiday') leave++;
    });

    function tile(label, value, note, tone) {
      return '<div class="stat-card' + (tone ? ' stat-card--' + tone : '') + '">' +
        '<span class="stat-card__label">' + esc(label) + '</span>' +
        '<span class="stat-card__value">' + esc(String(value)) + '</span>' +
        '<span class="stat-card__note">' + esc(note) + '</span></div>';
    }
    var dayLabel = /^\d{4}-\d{2}-\d{2}$/.test(day) ? SOC.fmtDate(new Date(day + 'T00:00:00')) : day;
    return '<div class="stat-strip st-strip">' +
      tile('Tổng nhân sự', rows.length, filterActive() ? 'theo bộ lọc · ' + data.staff.length + ' NV toàn kho' : 'bản ghi StaffData đang có', '') +
      tile('Đang làm việc', working, 'có ca trong ngày ' + dayLabel, 'ok') +
      tile('Nghỉ phép / lễ', leave, 'đơn nghỉ và ngày lễ theo lịch tháng', 'warn') +
      tile('Đi muộn / vắng', missing, 'có ca nhưng chưa ghi Clock In', missing ? 'err' : '') +
      '</div>';
  }

  /* ---------- khung lọc + chuyển bảng ---------- */
  function chip(dim, val, label, on) {
    return '<button type="button" class="chip st-chip' + (on ? ' on' : '') + '" data-dim="' + esc(dim) +
      '" data-val="' + esc(val) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(label) + '</button>';
  }
  function filterCard() {
    var stations = ordered(distinct(data.staff, 'station'), data.lists.stations || []);
    var dates = attDates();
    var shown = attEntries().length;
    var html = '<div class="card card--fit st-filtercard"><div class="stats-filters">';
    html += '<div class="frow"><span class="flabel" id="stLbl_station">Station</span>' +
      '<div class="chips" role="group" aria-labelledby="stLbl_station">' + chip('station', '', 'Tất cả', filters.station === '');
    stations.forEach(function (v) { html += chip('station', v, v, filters.station === v); });
    html += '</div></div>';
    html += '<div class="frow"><span class="flabel" id="stLbl_date">Ngày</span>' +
      '<div class="chips" role="group" aria-labelledby="stLbl_date">' + chip('date', '', 'Tất cả', filters.date === '');
    dates.forEach(function (v) { html += chip('date', v, v.slice(8) + '/' + v.slice(5, 7), filters.date === v); });
    html += '</div></div>';
    html += '<div class="frow st-filterfoot"><span class="flabel">Bảng</span>' +
      '<div class="seg" role="group" aria-label="Chọn nguồn cột thống kê">' +
      '<button type="button" class="seg__btn' + (tab === 'contract' ? ' on' : '') + '" data-tab="contract" aria-pressed="' +
      (tab === 'contract' ? 'true' : 'false') + '">Contract Type</button>' +
      '<button type="button" class="seg__btn' + (tab === 'agency' ? ' on' : '') + '" data-tab="agency" aria-pressed="' +
      (tab === 'agency' ? 'true' : 'false') + '">Agency</button>' +
      '</div><span class="filter-count">' + shown + ' lượt chấm công</span>' +
      (filterActive() ? '<button type="button" class="btn-clear-filter" data-reset="1" aria-label="Xóa mọi bộ lọc" title="Xóa mọi bộ lọc">' + SOC.ico('close', 14) + '</button>' : '') +
      '</div></div></div>';
    return html;
  }

  /* ---------- pivot chấm công: hàng = Ca, cột = hợp đồng/agency — mỗi team một bảng riêng ---------- */
  function pivotCard(entries, field, cfgKey, title, capNote) {
    var cols = ordered(distinct(entries, field), data.lists[cfgKey] || []);
    var slots = SOC.sortSlots(distinct(entries, 'slotCode'));
    var map = {};
    entries.forEach(function (r) {
      var key = txt(r, 'slotCode') + '|' + txt(r, field);
      map[key] = (map[key] || 0) + 1;
    });

    var head = '<thead><tr><th scope="col">Ca</th>' +
      cols.map(function (c) { return '<th scope="col" class="c">' + esc(c) + '</th>'; }).join('') +
      '<th scope="col" class="num">Tổng</th></tr></thead>';
    var body = '', grand = {}, grandTotal = 0;
    slots.forEach(function (s) {
      var rt = 0, cells = '';
      cols.forEach(function (c) {
        var n = map[s + '|' + c] || 0;
        rt += n; grand[c] = (grand[c] || 0) + n;
        cells += '<td class="c' + (n ? '' : ' st-zero') + '">' + (n || '-') + '</td>';
      });
      grandTotal += rt;
      body += '<tr><th scope="row">' + esc(s) + '</th>' + cells + '<td class="num st-rowtotal">' + rt + '</td></tr>';
    });
    if (!slots.length) body = '<tr><td colspan="' + (cols.length + 2) + '"><div class="empty"><b>Không có lượt chấm công nào theo bộ lọc</b>' +
      (filterActive() ? ' — <button type="button" class="btn btn-ghost btn-sm" data-reset="1"><span class="btn-label">Xóa bộ lọc</span></button>' : ' — tháng này chưa có chấm công.') + '</div></td></tr>';

    var foot = '<tr><th scope="row">Tổng</th>';
    cols.forEach(function (c) { foot += '<td class="c">' + (grand[c] || 0) + '</td>'; });
    foot += '<td class="num">' + grandTotal + '</td></tr>';

    return '<div class="card st-card">' +
      '<div class="card__head"><h2 class="section-heading">' + esc(title) + '</h2>' +
      '<span class="filter-count">' + entries.length + ' lượt chấm công</span></div>' +
      '<div class="table-wrap" tabindex="0" role="region" aria-label="Bảng pivot thống kê"><table class="st-pivot"><caption class="sr-only">' + esc(title) + ' — ' + esc(capNote) + '</caption>' +
      head + '<tbody>' + body + '</tbody><tfoot>' + foot + '</tfoot></table></div></div>';
  }
  /* Mỗi team có lượt chấm công trong bộ lọc một bảng (prod: Inbound / Outbound) — không hardcode tên */
  function teamCards(entries, field, cfgKey, colName) {
    return distinct(entries, 'team').map(function (t) {
      var sub = entries.filter(function (r) { return txt(r, 'team') === t; });
      return pivotCard(sub, field, cfgKey, t, 'số lượt chấm công theo ca và ' + colName);
    }).join('');
  }

  /* ---------- render ---------- */
  function paint() {
    var host = document.getElementById(SECTION);
    if (!host || !data) return;
    var entries = attEntries();
    host.innerHTML = strip() + filterCard() +
      '<div class="st-body"><div class="st-pivots">' +
      (tab === 'agency'
        ? teamCards(entries, 'agency', 'agencies', 'agency')
        : teamCards(entries, 'contractType', 'contractTypes', 'nhóm hợp đồng')) +
      '</div></div>';
    pageActions();
    wireOnce(host);
  }

  function pageActions() {
    var host = SOC.pageActions(
      '<button type="button" class="btn btn-outline" data-st-reload aria-label="Tải lại số liệu thống kê" title="Tải lại số liệu">' +
      '<span class="btn-label">Cập nhật</span>' + SOC.ico('refresh', 16) + '</button>' +
      '<button type="button" class="btn btn-outline" data-st-copy aria-label="Sao chép bảng thống kê" title="Sao chép bảng đang hiển thị">' +
      '<span class="btn-label">Sao chép</span>' + SOC.ico('copy', 16) + '</button>'
    );
    if (!host || !host.querySelector) return;
    var rb = host.querySelector('[data-st-reload]');
    if (rb) rb.addEventListener('click', function () {
      SOC.setBtnBusy_(rb, true, 'Đang tải');
      SOC.bumpData();
      load(true);
      setTimeout(function () { SOC.setBtnBusy_(rb, false); }, 600);
    });
    var b = host.querySelector('[data-st-copy]');
    if (b) b.addEventListener('click', function () { copyVisible(b); });
  }

  function wireOnce(host) {
    if (wired) return;
    host.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-dim],[data-tab],[data-reset]') : null;
      if (!t) return;
      if (t.hasAttribute('data-reset')) {
        filters.station = ''; filters.date = '';
      } else if (t.hasAttribute('data-tab')) {
        tab = t.getAttribute('data-tab');
      } else {
        var dim = t.getAttribute('data-dim'), val = t.getAttribute('data-val');
        filters[dim] = (filters[dim] === val) ? '' : val;
      }
      paint();
    });
    wired = true;
  }

  function copyVisible(btn) {
    SOC.setBtnBusy_(btn, true, 'Đang lấy');
    var tables = document.querySelectorAll('#' + SECTION + ' table.st-pivot');
    var secs = [];
    Array.prototype.forEach.call(tables, function (tb) {
      var card = tb.closest('.card');
      var title = card && card.querySelector('.section-heading') ? card.querySelector('.section-heading').textContent : 'Thống kê';
      var head = [];
      Array.prototype.forEach.call(tb.querySelectorAll('thead tr:last-child th'), function (th) { head.push(th.textContent.trim()); });
      var matrix = [];
      Array.prototype.forEach.call(tb.querySelectorAll('tbody tr'), function (tr) {
        var row = [tr.firstElementChild ? tr.firstElementChild.textContent.trim() : ''];
        Array.prototype.forEach.call(tr.querySelectorAll('td'), function (td) { row.push(td.textContent.trim()); });
        matrix.push(row);
      });
      secs.push(title + '\n' + [head].concat(matrix).map(function (r) { return r.join('\t'); }).join('\n'));
    });
    SOC.setBtnBusy_(btn, false);
    if (!secs.length) { SOC.toast('Không có bảng để sao chép', 'err'); return; }
    copyText(secs.join('\n\n'), 'Đã sao chép ' + secs.length + ' bảng thống kê');
  }

  function copyText(text, okMsg) {
    var ta = document.createElement('textarea');
    ta.className = 'st-clipboard';
    ta.setAttribute('readonly', 'readonly');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    function done() { document.body.removeChild(ta); SOC.toast(okMsg, 'ok'); }
    function legacy() {
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) SOC.toast(okMsg, 'ok'); else SOC.toast('Trình duyệt chặn sao chép', 'err');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, legacy);
    else legacy();
  }

  SOC.registerView(PAGE, {
    section: SECTION,
    render: function (ctx) {
      var force = !!(ctx && ctx.force);
      if (!data || force) { load(true); return; }
      paint();
      load(false);
    }
  });
})();

// [CHUNG] getStaffStatsApi trả bản ghi StaffData không có opsId, trong khi getScheduleMonthApi
// [CHUNG] key theo OPS id → dải stat-card "hôm nay" phải nối lịch ↔ StaffData qua TÊN (đón trùng tên).
// [CHUNG] Pivot không dùng lịch nữa — chỉ cần attDays (ngày có cardIn); khi port, StaffData prod mỗi
// [CHUNG] dòng đã là 1 ngày chấm công nên attDays suy ra được từ tập date của chính sheet đó.
// [CHUNG] views-data.css dùng --mx-name (token của lưới lịch) làm chiều rộng ô tối thiểu ở
// [CHUNG] .cf-groups / .st-strip — nếu đồng ý, thêm token riêng --grid-min-col vào tokens.css.
