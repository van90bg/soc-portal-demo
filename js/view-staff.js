/* view-staff.js — page 'data' · section 'viewStaff' (prefix .dt-)
   Dữ liệu chấm công thô theo tháng (StaffData 20 cột) + khối lịch sử quét của 1 nhân viên.
   Nguồn: getStaffStatsApi + warmStaffCacheApi (tra OPS id) + searchLogsByStaffApi. */
(function () {
  'use strict';

  var PAGE = 'data';
  var SECTION = 'viewStaff';

  /* 20 cột — thứ tự và nhãn khớp STAFF_TABLE_HEAD (app-core.html) / header sheet StaffData */
  var COLS = [
    /* hide = cột phụ, ẩn khi bảng xếp thành thẻ ≤991px (8 cột như prod #staffTable) */
    { h: 'No.', f: 'no', hide: true },
    { h: 'Date', f: 'date' },
    { h: 'Staff ID', f: 'staffId', key: true },
    { h: 'Staff Name', f: 'staffName', key: true },
    { h: 'Staff Email', f: 'staffEmail', hide: true },
    { h: 'Agency', f: 'agency' },
    { h: 'Contract Type', f: 'contractType' },
    { h: 'Event ID', f: 'eventId', hide: true },
    { h: 'Matching Type', f: 'matchingType', hide: true },
    { h: 'Gender', f: 'gender', hide: true },
    { h: 'Department', f: 'department' },
    { h: 'Clock In Time', f: 'cardIn' },
    { h: 'Clock Out Time', f: 'cardOut' },
    { h: 'Actual Hours', f: 'actualHours', num: true },
    { h: 'Clock In Remark', f: 'cardInRemark', hide: true },
    { h: 'Clock Out Remark', f: 'cardOutRemark', hide: true },
    { h: 'Slot Code', f: 'slotCode', shift: true },
    { h: 'Workstation', f: 'workstation', hide: true },
    { h: 'Team', f: 'team' },
    { h: 'Station', f: 'station' }
  ];

  var rows = null;          // bản ghi StaffData đã tải
  var opsIndex = null;      // { 'OPS1001': {staffName, station…} } — để nối tên → OPS id
  var loading = false;
  var monthSel = null;      // null = lấy tháng mới nhất trong dữ liệu (mock không có tháng hiện tại vẫn hiện được)
  var query = '';
  var sort = { col: -1, asc: true };
  var selected = null;      // dòng đang chọn (xem lịch sử)
  var history = null;       // {key, rows, message}
  var wired = false;

  function esc(v) { return SOC.esc(v); }
  function txt(r, f) { return String((r && r[f]) || '').trim(); }
  /* key ổn định của một dòng StaffData — Staff ID + ngày + ca, đủ để nhận lại dòng sau khi nạp lại */
  function rowKey(r) { return [txt(r, 'staffId'), txt(r, 'date'), txt(r, 'slotCode')].join('|'); }

  /* showSkeleton=false = làm mới nền khi đã có bảng trên màn hình (không chớp khung) */
  function load(btn, showSkeleton) {
    if (loading) return;
    loading = true;
    if (btn) SOC.setBtnBusy_(btn, true, 'Đang nạp');
    var host = document.getElementById(SECTION);
    if (showSkeleton && host) host.innerHTML = skeleton(8);
    Promise.all([SOC.api.getStaffStatsApi(), SOC.api.warmStaffCacheApi()]).then(function (res) {
      loading = false;
      var stats = res[0];
      if (!stats || !stats.ok) {
        SOC.toast((stats && stats.message) || 'Không tải được dữ liệu chấm công', 'err');
        if (!rows && host) host.innerHTML = '<div class="card"><div class="empty">' + esc((stats && stats.message) || 'Không tải được dữ liệu chấm công') + '</div></div>';
        return;
      }
      rows = (stats.staff || []).slice();
      opsIndex = (res[1] && res[1].ok && res[1].index) || {};
      if (monthSel === null) monthSel = dominantMonth();
      SOC.setCount(PAGE, rows.length);
      paint();
      SOC.setBtnBusy_(btn, false);
    }).catch(function (e) {
      loading = false;
      SOC.setBtnBusy_(btn, false);
      SOC.toast('Lỗi tải StaffData: ' + e.message, 'err');
      if (!rows && host) host.innerHTML = '<div class="card"><div class="empty">Lỗi tải StaffData: ' + esc(e.message) + '</div></div>';
    });
  }

  function dominantMonth() {
    var count = {}, best = SOC.isoMonth(new Date()), n = 0;
    rows.forEach(function (r) {
      var m = txt(r, 'date').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(m)) return;
      count[m] = (count[m] || 0) + 1;
      if (count[m] > n) { n = count[m]; best = m; }
    });
    return best;
  }

  function skeleton(n) {
    var out = '<div class="skeleton-wrap">';
    for (var i = 0; i < n; i++) {
      out += '<div class="skeleton-row">';
      for (var c = 0; c < 6; c++) out += '<div class="skeleton-cell"></div>';
      out += '</div>';
    }
    return out + '</div>';
  }

  /* ---------- lọc + sắp xếp ---------- */
  function visibleRows() {
    var q = query.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (monthSel && txt(r, 'date').slice(0, 7) !== monthSel) return false;
      if (!q) return true;
      var hay = ['staffId', 'staffName', 'staffEmail', 'agency', 'department', 'slotCode', 'team', 'station']
        .map(function (f) { return txt(r, f); }).join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    if (sort.col >= 0 && sort.col < COLS.length) {
      var f = COLS[sort.col].f, dir = sort.asc ? 1 : -1;
      out.sort(function (a, b) {
        var va = txt(a, f), vb = txt(b, f);
        var na = parseFloat(va), nb = parseFloat(vb);
        if (!isNaN(na) && !isNaN(nb) && String(na) === va && String(nb) === vb) return (na - nb) * dir;
        return va < vb ? -dir : va > vb ? dir : 0;
      });
    }
    return out;
  }
  /* "Hợp lệ" theo nghiệp vụ đối khớp: có Staff ID + tên + Matching Type Exact */
  function isValid(r) {
    return !!(txt(r, 'staffId') && (txt(r, 'staffName') || txt(r, 'name'))) &&
      (!txt(r, 'matchingType') || txt(r, 'matchingType').toLowerCase() === 'exact');
  }
  /* OPS id của một dòng StaffData — payload không mang opsId nên tra index qua tên */
  function opsIdOf(r) {
    var name = txt(r, 'staffName') || txt(r, 'name');
    var hit = Object.keys(opsIndex || {}).filter(function (k) { return txt(opsIndex[k], 'staffName') === name; })[0];
    return hit || '';
  }

  /* ---------- render ---------- */
  function paint() {
    var host = document.getElementById(SECTION);
    if (!host || !rows) return;
    /* làm mới nền thay mảng rows bằng bản ghi mới → theo key để giữ đúng dòng đang chọn */
    if (selected) {
      var k = rowKey(selected), again = null;
      rows.forEach(function (r) { if (!again && rowKey(r) === k) again = r; });
      if (!again) { selected = null; history = null; } else selected = again;
    }
    var list = visibleRows();
    var validCount = list.filter(isValid).length;
    host.innerHTML =
      '<div class="split dt-split">' +
      '<div class="card dt-card">' +
      '<div class="card__head">' +
      '<h2 class="section-heading">StaffData <span class="pill">' + list.length + ' dòng</span></h2>' +
      (monthSel ? '<span class="pill">' + esc(SOC.monthLabel(monthSel)) + '</span>' : '') +
      '<div class="list-search" role="search">' +
      '<input type="search" id="staffSearch" placeholder="Tìm mã NV, tên, agency, station…" autocomplete="off" spellcheck="false" aria-label="Tìm nhân viên" value="' + esc(query) + '">' +
      '<button type="button" class="btn-icon" data-dt-clear aria-label="Xóa tìm" title="Xóa tìm kiếm">' + SOC.ico('close', 16) + '</button>' +
      '</div></div>' +
      '<div class="table-wrap dt-scroll" tabindex="0" role="region" aria-label="Bảng StaffData">' + table(list) + '</div>' +
      '<div class="card__foot"><span>' + list.length + ' dòng hiển thị · ' + validCount + ' NV hợp lệ · ' + (list.length - validCount) + ' dòng cần soát</span>' +
      '<span class="dt-foot-hint">Bấm một dòng để xem lịch sử quét</span></div>' +
      '</div>' +
      '<div class="split__side">' + sideCard(list) + '</div>' +
      '</div>';
    pageActions();
    wireOnce(host);
  }

  function table(list) {
    if (!list.length) {
      return '<div class="empty">Không có dòng nào' +
        (query || monthSel ? ' — thử xóa bộ lọc hoặc đổi tháng' : '') + '</div>';
    }
    var head = '<tr>' + COLS.map(function (c, i) {
      var on = sort.col === i;
      return '<th scope="col" class="dt-th sortable' + (c.num ? ' num' : '') + '" data-col="' + i +
        '" aria-sort="' + (on ? (sort.asc ? 'ascending' : 'descending') : 'none') + '" title="Bấm để sắp xếp">' + esc(c.h) + '</th>';
    }).join('') + '</tr>';

    var body = list.map(function (r, i) {
      var cells = COLS.map(function (c) {
        var v = txt(r, c.f);
        var at = ' data-label="' + esc(c.h) + '"' + (c.hide ? ' data-hide="m"' : '') + (c.key ? ' data-nolabel' : '');
        if (c.shift) return '<td class="c"' + at + '>' + (v ? SOC.badgeShift(v) : '<span class="dt-zero">·</span>') + '</td>';
        if (!v) return '<td class="dt-dim"' + at + '></td>';
        if (c.num) return '<td class="num"' + at + '>' + esc(v) + '</td>';
        if (c.f === 'staffId') return '<td' + at + '><b class="dt-key">' + esc(v) + '</b></td>';
        if (c.f === 'staffName') return '<td class="dt-name"' + at + '>' + esc(v) + '</td>';
        return '<td' + at + '>' + esc(v) + '</td>';
      }).join('');
      return '<tr data-row="' + i + '"' + (selected && selected === r ? ' class="is-active"' : '') + '>' + cells + '</tr>';
    }).join('');

    var foot = '<tr><td colspan="' + COLS.length + '">Tổng ' + list.length + ' dòng · ' +
      list.filter(isValid).length + ' NV hợp lệ (Matching Type Exact)</td></tr>';
    return '<table class="dt-table table--cards"><caption class="sr-only">Dữ liệu thô StaffData, 20 cột</caption>' +
      '<thead>' + head + '</thead><tbody>' + body + '</tbody><tfoot>' + foot + '</tfoot></table>';
  }

  function sideCard(list) {
    var head = '<div class="card dt-side"><div class="card__head"><h2 class="section-heading">Lịch sử quét</h2>' +
      (history && history.key ? '<button type="button" class="btn btn-ghost btn-sm" data-dt-close aria-label="Đóng lịch sử">' + SOC.ico('close', 14) + 'Đóng</button>' : '') +
      '</div>';
    if (!selected) return head + '<div class="empty">Chọn một dòng trong bảng để xem các lượt quét của nhân viên này</div></div>';
    var ops = opsIdOf(selected);
    var meta = '<dl class="defs dt-meta">' +
      '<dt>Nhân viên</dt><dd>' + esc(txt(selected, 'staffName') || txt(selected, 'name')) + '</dd>' +
      '<dt>OPS id</dt><dd>' + esc(ops || 'không tra được') + '</dd>' +
      '<dt>Staff ID</dt><dd>' + esc(txt(selected, 'staffId')) + '</dd>' +
      '<dt>Station / Team</dt><dd>' + esc(txt(selected, 'station') + ' · ' + txt(selected, 'team')) + '</dd>' +
      '<dt>Ca</dt><dd>' + SOC.badgeShift(txt(selected, 'slotCode')) + '</dd>' +
      '</dl>';
    var body;
    if (!ops) body = '<div class="empty">Dòng này không có OPS id — không tra được lịch sử quét</div>';
    else if (!history || history.key !== ops) body = '<div class="skeleton-wrap"><div class="skeleton-row"><div class="skeleton-cell"></div><div class="skeleton-cell"></div></div><div class="skeleton-row"><div class="skeleton-cell"></div><div class="skeleton-cell"></div></div></div>';
    else if (history.message) body = '<div class="empty">' + esc(history.message) + '</div>';
    else if (!history.rows.length) body = '<div class="empty">Chưa có lượt quét nào cho ' + esc(ops) + '</div>';
    else {
      var trs = history.rows.map(function (h) {
        return '<tr><td class="dt-his-day">' + esc(String(h.taskId || '').slice(1, 9)) + '</td>' +
          '<td>' + esc(h.station || '—') + '</td>' +
          '<td class="c">' + SOC.badgeShift(h.slotCode) + '</td>' +
          '<td>' + SOC.badgeStatus(h.status) + '</td>' +
          '<td class="dt-his-time">' + esc(h.scannedAtText || h.listedAtText || '—') + '</td></tr>';
      }).join('');
      body = '<div class="table-wrap dt-his-scroll"><table class="dt-his">' +
        '<thead><tr><th scope="col">Ngày</th><th scope="col">Station</th><th scope="col" class="c">Ca</th>' +
        '<th scope="col">Trạng thái</th><th scope="col">Ghi nhận</th></tr></thead><tbody>' + trs + '</tbody></table></div>';
    }
    return head + '<div class="card-body dt-side-body">' + meta + body + '</div></div>';
  }

  function pageActions() {
    var host = SOC.pageActions(
      SOC.monthNav(monthSel || dominantMonth(), { onPick: function (m) { monthSel = m; selected = null; history = null; paint(); } }) +
      '<button type="button" class="btn btn-outline" data-dt-reload><span class="btn-label">Cập nhật</span>' + SOC.ico('refresh', 16) + '</button>' +
      '<button type="button" class="btn btn-outline" data-dt-copy><span class="btn-label">Sao chép</span>' + SOC.ico('copy', 16) + '</button>'
    );
    if (!host) return;
    var rl = host.querySelector('[data-dt-reload]');
    if (rl) rl.addEventListener('click', function () { rows = null; load(rl, true); });
    var cp = host.querySelector('[data-dt-copy]');
    if (cp) cp.addEventListener('click', function () { copyTable(cp); });
  }

  function copyTable(btn) {
    SOC.setBtnBusy_(btn, true, 'Đang lấy');
    var list = visibleRows();
    if (!list.length) { SOC.setBtnBusy_(btn, false); SOC.toast('Bảng trống — không có gì để sao chép', 'err'); return; }
    var lines = [COLS.map(function (c) { return c.h; }).join('\t')];
    list.forEach(function (r) { lines.push(COLS.map(function (c) { return txt(r, c.f); }).join('\t')); });
    copyText(lines.join('\n'), 'Đã sao chép ' + list.length + ' dòng StaffData');
    SOC.setBtnBusy_(btn, false);
  }

  function copyText(text, okMsg) {
    var ta = document.createElement('textarea');
    ta.className = 'dt-clipboard';
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

  function openHistory(row) {
    selected = row;
    var ops = opsIdOf(row);
    history = ops ? { key: ops, rows: [], message: '' } : null;
    paint();
    if (!ops) return;
    SOC.api.searchLogsByStaffApi(ops).then(function (r) {
      if (!r || !r.ok) { history = { key: ops, rows: [], message: r && r.message ? r.message : 'Không tải được lịch sử' }; SOC.toast((r && r.message) || 'Không tải được lịch sử quét', 'err'); paint(); return; }
      history = { key: ops, rows: r.rows || [], message: '' };
      paint();
    }).catch(function (e) {
      history = { key: ops, rows: [], message: 'Lỗi: ' + e.message };
      SOC.toast('Lỗi tải lịch sử quét: ' + e.message, 'err');
      paint();
    });
  }

  function wireOnce(host) {
    if (wired) return;
    /* delegation trên section — ô tìm bị thay mỗi lần paint nên không gắn listener trực tiếp được */
    host.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'staffSearch') onSearch(e);
    });
    host.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && e.target && e.target.id === 'staffSearch') { query = ''; paint(); }
    });
    host.addEventListener('click', function (e) {
      var th = e.target && e.target.closest ? e.target.closest('.dt-th[data-col]') : null;
      if (th) {
        var col = parseInt(th.getAttribute('data-col'), 10);
        if (sort.col === col) sort.asc = !sort.asc; else { sort.col = col; sort.asc = true; }
        paint(); return;
      }
      if (e.target && e.target.closest && e.target.closest('[data-dt-close]')) { selected = null; history = null; paint(); return; }
      if (e.target && e.target.closest && e.target.closest('[data-dt-clear]')) {
        query = ''; var s = document.getElementById('staffSearch'); if (s) s.value = ''; paint(); return;
      }
      var tr = e.target && e.target.closest ? e.target.closest('tbody tr[data-row]') : null;
      if (tr) {
        var list = visibleRows(), r = list[parseInt(tr.getAttribute('data-row'), 10)];
        if (r) openHistory(r);
      }
    });
    wired = true;
  }

  var searchTimer = null;
  function onSearch(e) {
    clearTimeout(searchTimer);
    var v = e.target.value;
    searchTimer = setTimeout(function () {
      query = v;
      paint();
      var s = document.getElementById('staffSearch');
      if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    }, 250);
  }

  SOC.registerView(PAGE, {
    section: SECTION,
    render: function (ctx) {
      var force = !!(ctx && ctx.force);
      if (!rows || force) { rows = null; load(null, true); return; }
      paint();
      load(null, false);
    }
  });
})();

// [CHUNG] getStaffStatsApi trả dòng StaffData thuần (không có opsId, không có cờ valid) nên view phải:
// [CHUNG]  (1) tra warmStaffCacheApi theo TÊN để tìm OPS id phục vụ searchLogsByStaffApi,
// [CHUNG]  (2) tự suy "hợp lệ" = có Staff ID + tên + Matching Type Exact.
// [CHUNG] Xin thêm opsId và valid vào mỗi dòng staff để bỏ cả hai bước suy đoán trên.
