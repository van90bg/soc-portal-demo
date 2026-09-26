/* view-scan.js — Màn quét 2 cột: trái = nhập mã + counter + pha, phải = bảng nhân viên.
   Quét dùng optimistic UI: đổi dòng ngay trong bộ nhớ rồi gọi API, rollback nếu API fail. */
(function () {
  'use strict';

  var SN = {
    taskId: null, task: null, log: [], counters: null,
    list: null, loading: false, seq: 0, ts: 0, inflight: 0,
    q: '', statuses: [], sort: { key: 'scannedAt', dir: 'desc' }, page: 1, pageSize: 50,
    last: null, gen: null,
    opts: null, staffList: null
  };
  var TTL_MS = 10000;
  var BARCODE_RE = /^OPS\d+$/;
  var STATUS_VALS = ['-', 'Đã điểm danh', 'Vắng', 'Dư'];
  var STATUS_TXT = { '-': 'Chưa điểm danh', 'Đã điểm danh': 'Đã điểm danh', 'Vắng': 'Vắng', 'Dư': 'Dư' };
  var PHASE_LABEL = { open: 'Mở danh sách', attend: 'Đang điểm danh', done: 'Đã đóng' };
  var debounceQ = null;


  /* KHỚP server countersOf (api.js) — client cần số tức thì khi optimistic quét. */
  function scCounters(rows) {
    var c = { scanned: 0, presentAt: 0, absent: 0, extra: 0, total: (rows || []).length };
    (rows || []).forEach(function (r) {
      if (r.status === 'Dư') c.extra++;
      else if (r.status === 'Đã điểm danh') { c.scanned++; c.presentAt++; }
      else if (r.status === 'Vắng') c.absent++;
    });
    return c;
  }

  function scPerm() {
    var p = (SN.task && SN.task.permission) || {};
    var canMutate = p.canMutate !== undefined ? !!p.canMutate : !!(p.isOwner || p.isAdmin);
    var canScanOpen = p.canScanOpen !== undefined ? !!p.canScanOpen : canMutate;
    return {
      isAdmin: !!p.isAdmin, isOwner: !!p.isOwner, canMutate: canMutate, canScanOpen: canScanOpen,
      ownerLocked: !!(SN.task && SN.task.status === 'open' && !canScanOpen),
      done: !!(SN.task && SN.task.status === 'done')
    };
  }

  /* ---------- dữ liệu ---------- */
  function scPickTask(rows) {
    var want = SOC.currentScanTask();
    if (want) return want;
    var live = (rows || []).filter(function (t) { return t.status === 'open' || t.status === 'attend'; });
    return live.length ? live[0].taskId : null;
  }

  function scStart(taskId) {
    SN.taskId = taskId;
    SN.page = 1; SN.q = ''; SN.statuses = []; SN.last = null;
    SN.sort = { key: taskId && SN.task && SN.task.status === 'open' ? 'listedAt' : 'scannedAt', dir: 'desc' };
  }

  function scLoadDetail(silent) {
    if (!SN.taskId) return;
    var seq = ++SN.seq;
    var id = SN.taskId;
    SOC.api.getTaskDetailApi(id).then(function (r) {
      SN.loading = false;
      if (seq !== SN.seq) return;
      if (!r || !r.ok) {
        if (!silent) { SOC.toast((r && r.message) || 'Không tải được task', 'err'); SOC.selectPage('attendance'); }
        else scPaint();
        return;
      }
      SN.task = r.task; SN.log = (r.log || []).slice(); SN.counters = r.counters || scCounters(SN.log);
      SN.gen = SOC.dataGen(); SN.ts = Date.now();
      if (SOC.state.page === 'scan') scPatch();
      var wantRoster = SOC.consumeScanRoster();
      if (wantRoster && SOC.state.page === 'scan' && scCanLoad()) rsOpen(null);
    }, function (e) {
      SN.loading = false;
      if (seq !== SN.seq) return;
      if (!silent) SOC.toast('Lỗi tải chi tiết task: ' + e.message, 'err');
    });
  }

  function scEnter(force) {
    var want = SOC.currentScanTask() || SN.taskId;
    if (want && SN.task && SN.task.taskId === want && !force) {
      scPatch();
      if (Date.now() - SN.ts > TTL_MS) scLoadDetail(true);
      return;
    }
    if (want && want !== SN.taskId) scStart(want);
    if (!SN.taskId) {
      SN.list = SN.list && SOC.dataGen() === SN.gen ? SN.list : null;
      var resolve = function (rows) {
        SN.list = rows;
        SN.loading = false;
        var id = scPickTask(rows);
        if (!id) { scPaint(); return; }
        scStart(id);
        scLoadDetail(false);
      };
      if (SN.list) { resolve(SN.list); return; }
      scPaint();
      SOC.api.getTaskListApi().then(function (rows) {
        resolve(Array.prototype.slice.call((rows && rows.ok === false) ? [] : rows || []));
      }, function (e) {
        SN.loading = false;
        SOC.toast('Lỗi tải danh sách task: ' + e.message, 'err');
      });
      return;
    }
    /* want != null → người dùng chủ động mở/refresh task: báo lỗi rõ, không im lặng */
    scLoadDetail(!want);
  }

  /* ---------- khung ---------- */
  function scHead() {
    var th = function (label, key, cls) {
      var on = SN.sort.key === key;
      return '<th scope="col"' + (key ? ' class="sortable' + (cls ? ' ' + cls : '') + '" data-sort="' + key +
        '" tabindex="0" aria-sort="' + (on ? (SN.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '"'
        : (cls ? ' class="' + cls + '"' : '')) + '>' + SOC.esc(label) + '</th>';
    };
    return '<tr>' + th('STT', '', 'num') + th('Mã OPS', 'staffId') + th('Tên', 'staffName') + th('Ca', 'slotCode') +
      th('Station', 'station') + th('Team', 'team') + th('Bàn làm việc', 'workstation') +
      th('Giờ có mặt', 'listedAt', 'num') + th('Giờ điểm danh', 'scannedAt', 'num') +
      th('Trạng thái', 'status') + th('Thao tác', '', 'c') + '</tr>';
  }

  function scShell() {
    var t = SN.task;
    var perm = scPerm();
    var canScan = !!t && !perm.done && !perm.ownerLocked;
    return '<div class="scan-layout sc-layout">' +
      '<div class="scan-col-left sc-col">' +
      '<div class="card card--fit sc-task">' +
      '<div class="card__head"><h2 class="section-heading">' + SOC.esc(t ? t.taskId : '—') + '</h2>' +
      '<span class="badge ' + SOC.esc(t ? t.status : 'open') + '">' + SOC.esc(PHASE_LABEL[t ? t.status : 'open']) + '</span></div>' +
      '<div class="card-body sc-task__body">' +
      '<dl class="defs">' +
      '<dt>Station</dt><dd>' + SOC.esc(t ? t.station || '—' : '—') + '</dd>' +
      '<dt>Ca</dt><dd>' + (t ? SOC.slotCell(t.slotCode) : '—') + '</dd>' +
      '<dt>Team</dt><dd>' + SOC.esc(t ? t.team || '—' : '—') + '</dd>' +
      '<dt>Contract</dt><dd>' + SOC.esc(t ? t.contractType || '—' : '—') + '</dd>' +
      '<dt>Ngày</dt><dd>' + SOC.esc(t ? SOC.fmtDate(t.date) : '—') + '</dd>' +
      '<dt>Người tạo</dt><dd>' + SOC.esc(t ? String(t.createdBy || '').split('@')[0] || '—' : '—') + '</dd>' +
      '</dl>' +
      '<div class="stepper" aria-label="Tiến trình ca">' + scStepper(t ? t.status : 'open') + '</div>' +
      '</div></div>' +
      '<div class="counters" id="scCounters"></div>' +
      '<div class="scan-row">' +
      '<div class="scan-input-wrap"><input type="text" id="scanInput" pattern="[Oo][Pp][Ss][0-9]+"' +
      ' placeholder="Quét mã nhân viên…" aria-label="Quét mã nhân viên" aria-describedby="scanHint"' +
      ' autocomplete="off" autocapitalize="characters" spellcheck="false"' + (canScan ? '' : ' disabled') + '></div>' +
      '<button type="button" class="btn" data-act="submit"' + (canScan ? '' : ' disabled') + '>' +
      '<span class="btn-label">Quét</span><span class="btn-ico">' + SOC.ico('scan', 16) + '</span></button>' +
      '</div>' +
      '<div class="scan-hint" id="scanHint">' + (perm.ownerLocked
        ? 'Chỉ người tạo task mới quét được ở giai đoạn mở danh sách — chờ Bàn giao.'
        : 'Quét mã OPS + số (ví dụ OPS1001). Enter để ghi nhận.') + '</div>' +
      (perm.ownerLocked ? '<div class="sc-warn" role="alert">' + SOC.ico('alert', 16) +
        ' Bạn không phải chủ task này — giai đoạn mở danh sách bị khóa.</div>' : '') +
      '<div class="scan-last" id="scLast"></div>' +
      '<div class="phase-banner" id="scPhase" role="status" aria-live="polite"></div>' +
      '<div class="card card--fit hidden" id="scException"></div>' +
      '</div>' +
      '<div class="scan-col-right"><div class="card">' +
      '<div class="att-toolbar">' +
      '<h2 class="section-heading">Danh sách NV <span class="filter-count" id="scCount" role="status">—</span></h2>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="copy" title="Sao chép bảng" aria-label="Sao chép bảng Danh sách NV">' +
      '<span class="btn-ico">' + SOC.ico('copy', 16) + '</span></button>' +
      '<div class="list-search" role="search"><input type="search" id="scanSearch" placeholder="Tìm mã NV, tên…"' +
      ' aria-label="Tìm nhân viên trong danh sách" autocomplete="off" spellcheck="false"></div>' +
      '</div>' +
      '<div class="sc-filters" id="scFilters" role="group" aria-label="Lọc theo trạng thái"></div>' +
      '<div class="table-wrap"><table id="scTable" class="table--cards"><caption class="sr-only">Danh sách nhân viên của task đang quét</caption>' +
      '<thead id="scHead">' + scHead() + '</thead><tbody id="scBody"></tbody></table>' +
      '<div class="empty hidden" id="scEmpty"></div></div>' +
      '<div class="pag-wrap hidden" id="scPag"></div>' +
      '</div></div>' +
      '</div>';
  }

  function scStepper(status) {
    var steps = [['open', 'Mở danh sách'], ['attend', 'Điểm danh'], ['done', 'Đóng ca']];
    var idx = status === 'done' ? 3 : status === 'attend' ? 2 : 1;
    var out = [];
    steps.forEach(function (s, i) {
      var cls = i + 1 < idx ? ' is-done' : i + 1 === idx ? ' is-on' : '';
      if (i) out.push('<span class="stepper__sep" aria-hidden="true"></span>');
      out.push('<span class="stepper__step' + cls + '"><span class="stepper__dot">' + (i + 1) + '</span>' + SOC.esc(s[1]) + '</span>');
    });
    return out.join('');
  }

  function scEmptyState() {
    return '<div class="card"><div class="empty">' +
      '<div><b>Chưa có task nào để quét.</b><br>Hãy tạo task ở trang Điểm danh rồi nạp danh sách nhân viên.</div>' +
      '<button type="button" class="btn btn-outline" data-act="goto-att"><span class="btn-label">Tới Điểm danh</span>' +
      '<span class="btn-ico">' + SOC.ico('attendance', 16) + '</span></button>' +
      '</div></div>';
  }

  function scSkeleton() {
    var rows = [];
    for (var i = 0; i < 5; i++) {
      var c = [];
      for (var k = 0; k < 11; k++) c.push('<div class="skeleton-cell"></div>');
      rows.push('<div class="skeleton-row">' + c.join('') + '</div>');
    }
    return '<div class="scan-layout sc-layout"><div class="scan-col-left sc-col">' +
      '<div class="skeleton-wrap" aria-busy="true">' + rows.slice(0, 2).join('') + '</div></div>' +
      '<div class="scan-col-right"><div class="card"><div class="skeleton-wrap" aria-busy="true"' +
      ' aria-label="Đang tải danh sách nhân viên">' + rows.join('') + '</div></div></div></div>';
  }

  function scPaint() {
    var sec = document.getElementById('viewScan');
    if (!sec) return;
    sec.innerHTML = SN.task ? scShell() : (SN.loading ? scSkeleton() : scEmptyState());
    scBind();
    if (SN.task) scPatch();
  }

  /* ---------- cập nhật vùng động ---------- */
  function scPatch() {
    var sec = document.getElementById('viewScan');
    if (!sec || !SN.task) { if (!SN.task && !SN.loading) scPaint(); return; }
    if (!sec.querySelector('#scCounters')) { scPaint(); return; }
    var perm = scPerm();
    var c = SN.counters || scCounters(SN.log);
    var isOpen = SN.task.status === 'open';
    var done = perm.done;
    var met = done ? c.scanned : (isOpen ? c.presentAt : c.scanned);
    var waiting = Math.max(0, c.total - (isOpen ? c.presentAt : c.scanned) - c.extra);
    document.getElementById('scCounters').innerHTML =
      '<div class="counter scanned"><div class="num">' + met + '</div><div class="lbl">Đã điểm danh</div></div>' +
      '<div class="counter ' + (done ? 'absent' : 'extra') + '"><div class="num">' + (done ? c.absent : waiting) +
      '</div><div class="lbl">' + (done ? 'Vắng' : 'Chưa điểm danh') + '</div></div>' +
      '<div class="counter extra"><div class="num">' + c.extra + '</div><div class="lbl">Dư</div></div>';

    scPatchPhase(perm, c);
    scPatchLast();
    scPatchTable();
    scPatchFilters();
    scPatchException();
    if (RS.el && !scCanLoad()) rsClose();
    scPaintActions(perm);
  }

  function scPatchPhase(perm, c) {
    var el = document.getElementById('scPhase');
    if (!el) return;
    var st = SN.task.status;
    var html;
    if (st === 'open') {
      html = (SN.log.length
        ? '<b>Giai đoạn mở danh sách:</b> mỗi lượt quét chỉ ghi nhận giờ có mặt (' + c.presentAt + '/' + c.total +
          '). Bấm <b>Bàn giao</b> để sang điểm danh, hoặc <b>Đóng task</b> để kết thúc.'
        : '<b>Danh sách còn trống:</b> bấm <b>Nạp danh sách</b> để nạp theo ca, hoặc quét trực tiếp để ghi nhận có mặt.');
    } else if (st === 'attend') {
      html = '<b>Đang điểm danh:</b> đã quét ' + c.scanned + (c.total ? '/' + c.total : '') +
        '. Bấm <b>Đóng task</b> khi xong — người chưa quét sẽ tính <b>Vắng</b>.';
    } else {
      html = '<b>Task đã đóng:</b> ' + c.scanned + ' điểm danh · ' + c.absent + ' Vắng' +
        (c.extra ? ' · ' + c.extra + ' Dư' : '') + '. Bấm <b>Mở lại</b> để điểm danh tiếp.';
    }
    el.className = 'phase-banner' + (st === 'attend' ? ' is-attend' : '');
    el.innerHTML = html;
  }

  function scPatchLast() {
    var el = document.getElementById('scLast');
    if (!el) return;
    var l = SN.last;
    if (!l) {
      el.className = 'scan-last sc-idle';
      el.innerHTML = '<span class="scan-last__avatar" aria-hidden="true">·</span>' +
        '<span class="sc-last__txt"><b>Chưa có lượt quét</b><small>Kết quả quét gần nhất hiện ở đây.</small></span>';
      return;
    }
    el.className = 'scan-last' + (l.kind === 'extra' ? ' is-extra' : l.kind === 'err' || l.kind === 'dup' ? ' is-dup' : '');
    el.innerHTML = '<span class="scan-last__avatar" aria-hidden="true">' + SOC.esc(SOC.initials(l.name || l.code)) + '</span>' +
      '<span class="sc-last__txt"><b>' + SOC.esc(l.name || 'Chưa rõ tên') + '</b>' +
      '<small>' + SOC.esc(l.code) + (l.time ? ' · ' + SOC.esc(l.time) : '') + ' · ' + SOC.esc(l.note) + '</small></span>' +
      '<span class="sc-last__badge">' + (l.badge || '') + '</span>';
  }

  function scSorted() {
    var q = SN.q.trim().toUpperCase();
    var rows = SN.log.filter(function (r) {
      if (SN.statuses.length && SN.statuses.indexOf(r.status) < 0) return false;
      if (q && (String(r.staffId || '').toUpperCase() + ' ' + String(r.staffName || '').toUpperCase()).indexOf(q) < 0) return false;
      return true;
    });
    var key = SN.sort.key, dir = SN.sort.dir === 'asc' ? 1 : -1;
    rows.sort(function (a, b) {
      var va, vb;
      if (key === 'scannedAt' || key === 'listedAt') { va = Number(a[key + 'Epoch']) || 0; vb = Number(b[key + 'Epoch']) || 0; return (va - vb) * dir; }
      if (key === 'status') {
        var o = { '-': 0, 'Đã điểm danh': 1, 'Vắng': 2, 'Dư': 3 };
        va = o[a.status] == null ? 9 : o[a.status]; vb = o[b.status] == null ? 9 : o[b.status];
        return (va - vb) * dir;
      }
      va = String(a[key] || ''); vb = String(b[key] || '');
      return va.localeCompare(vb, 'vi') * dir;
    });
    return rows;
  }

  function scRowOps(r, perm) {
    if (perm.done || !perm.canMutate) return '<span class="filter-count">—</span>';
    return '<button type="button" class="btn btn-ghost btn-sm" data-act="fix" data-staff="' + SOC.esc(r.staffId) +
      '" title="Sửa trạng thái ' + SOC.esc(r.staffId) + '" aria-label="Sửa trạng thái ' + SOC.esc(r.staffId) + '">' +
      '<span class="btn-ico">' + SOC.ico('edit', 16) + '</span></button>';
  }

  function scPatchTable() {
    var body = document.getElementById('scBody');
    if (!body) return;
    var perm = scPerm();
    var rows = scSorted();
    var pages = Math.max(1, Math.ceil(rows.length / SN.pageSize));
    if (SN.page > pages) SN.page = pages;
    var start = (SN.page - 1) * SN.pageSize;
    var shown = rows.slice(start, start + SN.pageSize);
    var isOpen = SN.task.status === 'open';

    body.innerHTML = shown.map(function (r, i) {
      return '<tr' + (r.status === 'Dư' ? ' class="extra-row"' : '') + '>' +
        '<td class="num" data-label="STT" data-hide="m">' + (start + i + 1) + '</td>' +
        '<td data-label="Mã OPS"><b>' + SOC.esc(r.staffId) + '</b></td>' +
        '<td data-label="Tên" data-nolabel>' + SOC.esc(r.staffName || '—') + '</td>' +
        '<td data-label="Ca">' + (r.slotCode && /^S\d+$/i.test(String(r.slotCode)) ? SOC.badgeShift(r.slotCode) : '<span class="pill">' + SOC.esc(r.slotCode || '—') + '</span>') + '</td>' +
        '<td data-label="Station" data-hide="m">' + SOC.esc(r.station || '—') + '</td>' +
        '<td data-label="Team">' + SOC.esc(r.team || '—') + '</td>' +
        '<td data-label="Bàn làm việc">' + SOC.esc(r.workstation || '—') + '</td>' +
        '<td class="num" data-label="Giờ có mặt">' + SOC.esc(r.listedAtText || '') + '</td>' +
        '<td class="num" data-label="Giờ điểm danh">' + SOC.esc(isOpen ? (r.listedAtText || '') : (r.scannedAtText || '')) + '</td>' +
        '<td data-label="Trạng thái" data-nolabel>' + SOC.badgeStatus(r.status) + '</td>' +
        '<td class="c" data-label="Thao tác" data-nolabel>' + scRowOps(r, perm) + '</td>' +
        '</tr>';
    }).join('');

    var empty = document.getElementById('scEmpty');
    var table = document.getElementById('scTable');
    var none = !shown.length;
    if (empty && table) {
      empty.classList.toggle('hidden', !none);
      table.classList.toggle('hidden', none);
      if (none) {
        empty.innerHTML = !SN.log.length
          ? (scCanLoad()
            ? '<div>Danh sách đang trống — bấm <b>Nạp danh sách</b> ở trên để nạp theo ca, hoặc quét trực tiếp.</div>'
            : '<div>Danh sách đang trống — task này chưa có ai vào.</div>')
          : '<div>Không có NV khớp bộ lọc đang áp.</div>';
      }
    }
    var cnt = document.getElementById('scCount');
    if (cnt) cnt.textContent = (SN.statuses.length || SN.q) ? 'Đang hiện ' + rows.length + '/' + SN.log.length : SN.log.length + ' NV';
    scPatchPager(rows.length, pages);
    var head = document.getElementById('scHead');
    if (head) head.innerHTML = scHead();
    scBindTable();
  }

  function scPatchPager(total, pages) {
    var pag = document.getElementById('scPag');
    if (!pag) return;
    if (total <= SN.pageSize) { pag.classList.add('hidden'); pag.innerHTML = ''; return; }
    pag.classList.remove('hidden');
    var btns = [];
    for (var p = 1; p <= pages; p++) {
      if (pages > 7 && p !== 1 && p !== pages && Math.abs(p - SN.page) > 1) {
        if (btns[btns.length - 1] !== '<span class="pag-info">…</span>') btns.push('<span class="pag-info">…</span>');
        continue;
      }
      btns.push('<button type="button" class="pag-btn' + (p === SN.page ? ' active' : '') + '" data-page="' + p +
        '"' + (p === SN.page ? ' aria-current="page"' : '') + ' aria-label="Trang ' + p + '">' + p + '</button>');
    }
    pag.innerHTML = '<button type="button" class="pag-btn" data-page="' + Math.max(1, SN.page - 1) + '" aria-label="Trang trước">' +
      SOC.ico('back', 16) + '</button>' + btns.join('') +
      '<button type="button" class="pag-btn sc-next" data-page="' + Math.min(pages, SN.page + 1) + '" aria-label="Trang sau">' +
      SOC.ico('back', 16) + '</button><span class="pag-info">Trang ' + SN.page + '/' + pages + ' · ' + total + ' NV</span>';
    Array.prototype.forEach.call(pag.querySelectorAll('[data-page]'), function (b) {
      b.addEventListener('click', function () { SN.page = Number(b.getAttribute('data-page')); scPatchTable(); });
    });
  }

  function scPatchFilters() {
    var host = document.getElementById('scFilters');
    if (!host) return;
    var present = Object.create(null);
    SN.log.forEach(function (r) { present[r.status] = (present[r.status] || 0) + 1; });
    host.innerHTML = '<div class="chips">' + STATUS_VALS.filter(function (v) { return present[v]; }).map(function (v) {
      var on = SN.statuses.indexOf(v) >= 0;
      return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-st="' + SOC.esc(v) +
        '" aria-pressed="' + (on ? 'true' : 'false') + '">' + SOC.esc(STATUS_TXT[v]) +
        ' <span class="filter-count">' + present[v] + '</span></button>';
    }).join('') + '</div>' + (SN.statuses.length ?
      '<button type="button" class="chip chip--clear" data-act="clear-status">Xóa lọc<span class="chip__x" aria-hidden="true">' +
      SOC.ico('close', 12) + '</span></button>' : '');
    Array.prototype.forEach.call(host.querySelectorAll('[data-st]'), function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-st'), i = SN.statuses.indexOf(v);
        if (i >= 0) SN.statuses.splice(i, 1); else SN.statuses.push(v);
        SN.page = 1; scPatchTable(); scPatchFilters();
      });
    });
    var cl = host.querySelector('[data-act="clear-status"]');
    if (cl) cl.addEventListener('click', function () { SN.statuses = []; SN.page = 1; scPatchTable(); scPatchFilters(); });
  }

  function scPatchException() {
    var host = document.getElementById('scException');
    if (!host) return;
    var extras = SN.log.filter(function (r) { return r.status === 'Dư'; });
    if (!extras.length) { host.classList.add('hidden'); host.innerHTML = ''; return; }
    host.classList.remove('hidden');
    host.innerHTML = '<div class="card__head"><h2 class="section-heading">' + SOC.ico('alert', 16) +
      ' Ngoại lệ · ngoài roster</h2></div>' +
      '<div class="sc-chips">' + extras.map(function (r) {
        return '<button type="button" class="chip" data-act="locate" data-staff="' + SOC.esc(r.staffId) + '">' +
          SOC.esc(r.staffId) + '<span class="filter-count">' + SOC.esc(r.staffName || 'chưa rõ tên') + '</span></button>';
      }).join('') + '</div>';
    Array.prototype.forEach.call(host.querySelectorAll('[data-act="locate"]'), function (b) {
      b.addEventListener('click', function () {
        SN.q = b.getAttribute('data-staff'); SN.statuses = []; SN.page = 1;
        var i = document.getElementById('scanSearch'); if (i) i.value = SN.q;
        scPatchTable(); scPatchFilters();
      });
    });
  }

  /* ---------- modal "Nạp danh sách" — pivot Ca × nhóm hợp đồng (component SOC.rosterPivot) ---------- */
  var RS = { el: null, rp: null, opener: null, trap: null };

  /* Server từ chối nạp khi task đã có dòng điểm danh (TaskService.gs:273) — nút, modal và mock cùng một cửa */
  function scCanLoad() {
    if (!SN.task || SN.task.status !== 'open' || SN.log.length) return false;
    var perm = scPerm();
    return perm.canMutate && !perm.ownerLocked;
  }

  function rsLoad(btn) {
    var rp = RS.rp;
    if (!rp.state.station) { SOC.toast('Chọn Station trước khi nạp', 'err'); return; }
    if (!Object.keys(rp.state.sel).length) return;
    var f = {
      station: rp.state.station,
      team: rp.state.team ? [rp.state.team] : [],
      department: rp.state.dept ? [rp.state.dept] : [],
      date: rp.state.date ? [rp.state.date] : [],
      slotCode: rp.flatCellField('slotCode'),
      contractType: rp.flatCellField('contractType'),
      cells: rp.cells()
    };
    var count = rp.selectedCount();
    SOC.setBtnBusy_(btn, true, 'Đang nạp');
    rp.setLocked(true);
    SOC.api.appendRosterApi({ taskId: SN.taskId, filter: f }).then(function (r) {
      SOC.setBtnBusy_(btn, false);
      if (RS.rp) RS.rp.setLocked(false);
      if (!r || !r.ok) { SOC.toast((r && r.message) || 'Nạp thất bại', 'err'); return; }
      SOC.toast(r.message || ('Đã nạp ' + count + ' nhân viên'));
      rsClose();
      SOC.bumpData();
      scLoadDetail(false);
    }, function (e) {
      SOC.setBtnBusy_(btn, false);
      if (RS.rp) RS.rp.setLocked(false);
      SOC.toast('Lỗi: ' + e.message, 'err');
    });
  }

  function rsClose() {
    if (!RS.el) return;
    if (RS.trap) { RS.trap(); RS.trap = null; }
    RS.el.remove();
    RS.el = null;
    RS.rp = null;
    document.removeEventListener('keydown', rsEsc);
    if (RS.opener && document.contains(RS.opener)) RS.opener.focus();
    RS.opener = null;
  }

  function rsEsc(e) { if (e.key === 'Escape') rsClose(); }

  function rsOpen(opener) {
    if (RS.el) return;
    if (!scCanLoad()) {
      SOC.toast('Chỉ nạp được khi task đang Mở và danh sách còn trống', 'err');
      return;
    }
    scEnsureOpts(function () {
      if (!scCanLoad() || RS.el) return;
      var stations = (SN.opts && SN.opts.stations) || [];
      var own = String(SN.task.station || '').trim();
      var ov = document.createElement('div');
      ov.className = 'about-overlay';
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-modal', 'true');
      ov.setAttribute('aria-labelledby', 'scRosterTitle');
      ov.innerHTML =
        '<div class="about-dialog rp__dialog">' +
          '<div class="modal-head"><h2 id="scRosterTitle">Nạp danh sách theo ca</h2>' +
          '<button type="button" class="btn-icon" data-act="rs.x" aria-label="Đóng">' + SOC.ico('close', 18) + '</button></div>' +
          '<p class="mode-desc">Chỉ nạp được khi task đang <b>Mở</b> và danh sách còn trống — bấm vào ô trong bảng để chọn ' +
          'từng ca, cả cột hợp đồng, hoặc cả dòng; chọn được nhiều ô.</p>' +
          '<div class="rp__bar">' +
            '<label class="fld"><span>Station</span><select data-rsf="station"></select></label>' +
            '<label class="fld"><span>Ngày</span><select data-rsf="date"></select></label>' +
            '<label class="fld"><span>Team</span><select data-rsf="team"></select></label>' +
            '<label class="fld"><span>Department</span><select data-rsf="dept"></select></label>' +
          '</div>' +
          '<div class="rp__wrap" data-slot="pivot" role="region" aria-label="Bảng phân bố nhân viên"></div>' +
          '<div class="modal-foot rp__foot">' +
            '<span class="rp__seltext" data-slot="seltext" role="status" aria-live="polite"></span>' +
            '<span class="rp__btns">' +
              '<button type="button" class="btn btn-ghost" data-act="rs.clear" disabled><span class="btn-label">Xóa chọn</span></button>' +
              '<button type="button" class="btn btn-ghost" data-act="rs.x"><span class="btn-label">Hủy</span></button>' +
              '<button type="button" class="btn" data-act="rs.load" disabled><span class="btn-label">Nạp</span>' +
              '<span class="btn-ico">' + SOC.ico('download', 16) + '</span></button>' +
            '</span>' +
          '</div>' +
        '</div>';
      RS.opener = opener || document.activeElement;
      document.body.appendChild(ov);
      RS.el = ov;
      RS.trap = SOC.trapFocus(ov);
      var rp = SOC.rosterPivot(ov, {
        staffList: SN.staffList,
        catalogs: {
          stations: stations,
          slots: (SN.opts && SN.opts.slots) || [],
          teams: (SN.opts && SN.opts.teams) || [],
          departments: (SN.opts && SN.opts.departments) || []
        },
        loadLabel: 'Nạp'
      });
      RS.rp = rp;
      if (stations.indexOf(own) >= 0) rp.pick('station', own);
      else rp.render();
      Array.prototype.forEach.call(ov.querySelectorAll('[data-rsf]'), function (s) {
        s.addEventListener('change', function () { rp.pick(s.getAttribute('data-rsf'), s.value); });
      });
      ov.addEventListener('click', function (e) {
        var t = e.target;
        if (!t.closest) return;
        var x = t.closest('[data-act="rs.x"]');
        if (t === ov || x) { rsClose(); return; }
        if (t.closest('[data-act="rs.clear"]')) { rp.clearSel(); return; }
        var go = t.closest('[data-act="rs.load"]');
        if (go) { rsLoad(go); return; }
        var cell = t.closest('[data-cell]');
        if (cell && !cell.disabled) rp.toggleCell(cell.getAttribute('data-cell'));
      });
      document.addEventListener('keydown', rsEsc);
      var first = ov.querySelector(rp.state.station ? '[data-rsf="date"]' : '[data-rsf="station"]');
      if (first) first.focus();
    });
  }

  /* Danh mục Station/Ca/Team/Department + dòng StaffData — một lần tải, dùng cho cả bảng pivot */
  function scEnsureOpts(cb) {
    if (SN.opts) { cb(); return; }
    SOC.api.getFilterOptionsApi().then(function (r) {
      if (!r || !r.ok) { SOC.toast((r && r.message) || 'Không đọc được danh mục lọc', 'err'); return; }
      SN.opts = {
        stations: (r.lists && r.lists.stations) || [],
        slots: SOC.sortSlots(SOC.uniq((r.staffList || []).map(function (s) { return s.slotCode; }))),
        teams: (r.lists && r.lists.teams) || [],
        departments: (r.lists && r.lists.departments) || []
      };
      SN.staffList = r.staffList || [];
      cb();
    }, function (e) { SOC.toast('Lỗi tải danh mục: ' + e.message, 'err'); });
  }

  /* ---------- nút đầu trang ---------- */
  function scPaintActions(perm) {
    var t = SN.task;
    var btn = function (cls, act, label, iconName) {
      return '<button type="button" class="btn ' + cls + '" data-act="' + act + '"><span class="btn-label">' +
        SOC.esc(label) + '</span><span class="btn-ico">' + SOC.ico(iconName, 16) + '</span></button>';
    };
    var html = btn('btn-ghost', 'list', 'Danh sách', 'back');
    if (!t) { SOC.pageActions(html); scBindActions(); return; }
    if (scCanLoad()) html += btn('btn-outline', 'load', 'Nạp danh sách', 'download');
    if (t.status === 'open' && !perm.ownerLocked) html += btn('btn', 'toattend', 'Bàn giao', 'play');
    if (t.status !== 'done' && perm.canMutate) html += btn('btn-danger', 'close', 'Đóng task', 'close');
    if (t.status === 'done' && perm.canMutate) html += btn('btn-amber', 'reopen', 'Mở lại', 'refresh');
    if (t.status === 'open' && !perm.ownerLocked && perm.canMutate && !SN.log.length) html += btn('btn-danger', 'cancel', 'Hủy', 'trash');
    SOC.pageActions(html);
    scBindActions();
  }

  function scBindActions() {
    var host = document.getElementById('pageActions');
    if (!host) return;
    Array.prototype.forEach.call(host.querySelectorAll('[data-act]'), function (b) {
      b.addEventListener('click', function () { scTopAction(b.getAttribute('data-act'), b); });
    });
  }

  function scTopAction(act, btn) {
    if (act === 'list') { SOC.selectPage('attendance'); return; }
    if (act === 'load') { rsOpen(btn); return; }
    var id = SN.taskId;
    if (!id) return;
    var perm = scPerm();
    var plan = {
      toattend: { api: SOC.api.transitionToAttendApi, title: 'Bàn giao sang điểm danh', ok: 'Bàn giao', msg: 'NV quét sau bước này sẽ ghi giờ điểm danh. Người chưa quét lần hai sẽ tính Vắng khi đóng task.' },
      close: { api: SOC.api.completeTaskApi, title: 'Đóng task', ok: 'Đóng task', msg: 'Chốt ' + id + '? Toàn bộ dòng chưa điểm danh sẽ chuyển thành Vắng.' },
      reopen: { api: SOC.api.reopenTaskApi, title: 'Mở lại task', ok: 'Mở lại', msg: 'Mở lại ' + id + '? Các dòng Vắng trở về Chưa điểm danh.' },
      cancel: { api: SOC.api.cancelTaskApi, title: 'Hủy task rỗng', ok: 'Hủy task', msg: 'Hủy ' + id + ' khỏi danh sách?' }
    }[act];
    if (!plan) return;
    if (act !== 'toattend' && !perm.canMutate) { SOC.toast('Bạn không có quyền thao tác task này', 'err'); return; }
    SOC.confirm({ title: plan.title, message: plan.msg, okLabel: plan.ok }).then(function (ok) {
      if (!ok) return;
      SOC.setBtnBusy_(btn, true, 'Đang lưu');
      plan.api(id).then(function (r) {
        SOC.setBtnBusy_(btn, false);
        if (!r || !r.ok) { SOC.toast((r && r.message) || 'Thao tác thất bại', 'err'); return; }
        SOC.toast(r.message || 'Đã cập nhật');
        SOC.bumpData();
        scLoadDetail(false);
      }, function (e) { SOC.setBtnBusy_(btn, false); SOC.toast('Lỗi: ' + e.message, 'err'); });
    });
  }

  /* ---------- quét ---------- */
  function scFindRow(code) {
    for (var i = 0; i < SN.log.length; i++) if (String(SN.log[i].staffId || '').toUpperCase() === code) return SN.log[i];
    return null;
  }

  function scSubmit() {
    var inp = document.getElementById('scanInput');
    if (!inp) return;
    var raw = String(inp.value || '').trim();
    inp.value = '';
    if (!SN.task) return;
    var perm = scPerm();
    if (perm.done || perm.ownerLocked || inp.disabled) {
      SN.last = { kind: 'err', code: raw || '—', name: '', note: perm.done ? 'Task đã đóng' : perm.ownerLocked ? 'Chỉ chủ task quét ở giai đoạn mở' : 'Đang khóa' };
      SOC.beep('err'); scPatchLast(); inp.focus(); return;
    }
    var code = raw.toUpperCase();
    if (!BARCODE_RE.test(code)) {
      SN.last = { kind: 'err', code: raw || '—', name: '', note: 'Sai định dạng — phải là OPS + chữ số' };
      SOC.beep('err'); scPatchLast(); scPatchTable(); inp.focus(); return;
    }
    var row = scFindRow(code);
    var snap = row ? {
      row: row, status: row.status, listedText: row.listedAtText, listedEpoch: row.listedAtEpoch,
      scanText: row.scannedAtText, scanEpoch: row.scannedAtEpoch, fresh: false
    } : { row: null, fresh: true };
    var nowMs = Date.now();
    var nowText = SOC.fmtClock(nowMs);
    var kind = 'ok', note = '';

    if (row) {
      if (row.status === 'Dư') {
        row.status = 'Đã điểm danh';
        if (!row.listedAtEpoch) { row.listedAtText = nowText; row.listedAtEpoch = nowMs; }
        kind = 'extra'; note = 'Dư được chuyển thành đã điểm danh';
      } else if (!Number(row.scannedAtEpoch)) {
        row.scannedAtText = nowText; row.scannedAtEpoch = nowMs;
        row.status = row.status === 'Vắng' || row.status === '-' ? 'Đã điểm danh' : row.status;
        if (!row.listedAtEpoch) { row.listedAtText = row.listedAtText || nowText; row.listedAtEpoch = row.listedAtEpoch || nowMs; }
        kind = 'ok'; note = SN.task.status === 'open' ? 'Ghi giờ có mặt' : 'Đã điểm danh';
      } else {
        SN.last = { kind: 'dup', code: code, name: row.staffName || '', time: row.scannedAtText, note: 'Đã điểm danh rồi trong task này', badge: SOC.badgeStatus('Đã điểm danh') };
        SOC.beep('err'); scPatchLast();
        inp.focus();
        return;
      }
    } else {
      var fresh = {
        taskId: SN.taskId, staffId: code, staffName: '', slotCode: SN.task.slotCode, station: SN.task.station,
        team: '—', workstation: '—', listedAtText: nowText, listedAtEpoch: nowMs,
        scannedAtText: '', scannedAtEpoch: 0, status: 'Dư', dateText: SN.task.date
      };
      SN.log.push(fresh);
      snap.row = fresh; snap.fresh = true;
      row = fresh;
      kind = 'extra'; note = 'Ngoài danh sách, ghi thành dòng Dư';
    }
    if (SN.statuses.length && SN.statuses.indexOf(row.status) < 0) SN.statuses = [];
    SN.counters = scCounters(SN.log);
    SN.last = { kind: kind, code: code, name: row.staffName || '', time: nowText, note: note, badge: SOC.badgeStatus(row.status) };
    SOC.beep(kind === 'extra' ? 'extra' : 'ok');
    scPatch();
    scCommit(code, snap);
    var inp2 = document.getElementById('scanInput');
    if (inp2) inp2.focus();
  }

  /* server là nguồn quyết định — lỗi thì trả dòng về trạng thái trước khi quét */
  function scCommit(code, snap) {
    SN.inflight++;
    SOC.api.scanStaffApi(SN.taskId, code).then(function (r) {
      SN.inflight--;
      if (!r || !r.ok) {
        scRollback(snap);
        SN.last = {
          kind: r && /Đã điểm danh rồi/.test(String(r.message || '')) ? 'dup' : 'err',
          code: code, name: (snap.row && snap.row.staffName) || '', note: (r && r.message) || 'Không ghi được lượt quét'
        };
        SOC.beep('err');
        if (r) SOC.toast(r.message, 'err');
        scPatch();
        return;
      }
      var row = snap.fresh ? scFindRow(code) : snap.row;
      if (row) {
        row.staffName = r.staffName || row.staffName;
        row.team = r.team || row.team;
        row.slotCode = r.slotCode || row.slotCode;
        row.workstation = r.workstation || row.workstation;
        if (r.scannedAtText) { row.scannedAtText = r.scannedAtText; row.scannedAtEpoch = r.scannedAtEpoch; }
        if (r.listedAtText) { row.listedAtText = r.listedAtText; row.listedAtEpoch = r.listedAtEpoch; }
        row.status = r.status || row.status;
      }
      SN.counters = r.counters || scCounters(SN.log);
      SOC.bumpData();
      scPatch();
    }, function (e) {
      SN.inflight--;
      scRollback(snap);
      SN.last = { kind: 'err', code: code, name: '', note: 'Lỗi kết nối — chưa ghi nhận' };
      SOC.beep('err');
      SOC.toast('Lỗi quét: ' + e.message, 'err');
      scPatch();
    });
  }

  function scRollback(snap) {
    if (snap.fresh) {
      SN.log = SN.log.filter(function (r) { return r !== snap.row; });
    } else if (snap.row) {
      snap.row.status = snap.status;
      snap.row.listedAtText = snap.listedText; snap.row.listedAtEpoch = snap.listedEpoch;
      snap.row.scannedAtText = snap.scanText; snap.row.scannedAtEpoch = snap.scanEpoch;
    }
    SN.counters = scCounters(SN.log);
  }

  /* ---------- sửa trạng thái 1 dòng ---------- */
  function scOpenFix(staffId) {
    var perm = scPerm();
    if (perm.done || !perm.canMutate) return;
    var row = scFindRow(staffId);
    if (!row) return;
    var ov = document.createElement('div');
    ov.className = 'about-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', 'scFixTitle');
    ov.innerHTML = '<div class="about-dialog">' +
      '<div class="modal-head"><h2 id="scFixTitle">Sửa trạng thái dòng</h2>' +
      '<button type="button" class="btn-icon" data-act="x" aria-label="Đóng">' + SOC.ico('close', 18) + '</button></div>' +
      '<p class="mode-desc">' + SOC.esc(row.staffId) + (row.staffName ? ' · ' + SOC.esc(row.staffName) : '') + '</p>' +
      '<label class="fld"><span>Trạng thái mới</span><select data-f="status">' +
      STATUS_VALS.map(function (v) {
        return '<option value="' + SOC.esc(v) + '"' + (v === row.status ? ' selected' : '') + '>' + SOC.esc(STATUS_TXT[v]) + '</option>';
      }).join('') + '</select></label>' +
      '<div class="modal-foot"><button type="button" class="btn btn-ghost" data-act="x">Hủy</button>' +
      '<button type="button" class="btn" data-act="save"><span class="btn-label">Lưu</span></button></div></div>';
    document.body.appendChild(ov);
    function close() { document.removeEventListener('keydown', onEsc); ov.remove(); }
    function onEsc(e) { if (e.key === 'Escape') close(); }
    Array.prototype.forEach.call(ov.querySelectorAll('[data-act="x"]'), function (b) { b.addEventListener('click', close); });
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.addEventListener('keydown', onEsc);
    var sel = ov.querySelector('[data-f="status"]');
    var save = ov.querySelector('[data-act="save"]');
    save.addEventListener('click', function () {
      var next = sel.value;
      if (next === row.status) { close(); return; }
      var old = row.status;
      row.status = next;
      SN.counters = scCounters(SN.log);
      scPatchTable(); scPatchFilters();
      SOC.setBtnBusy_(save, true, 'Đang lưu');
      SOC.api.updateLogRowStatusApi(SN.taskId, row.staffId, next).then(function (r) {
        SOC.setBtnBusy_(save, false);
        close();
        if (!r || !r.ok) {
          row.status = old;
          SN.counters = scCounters(SN.log);
          SOC.toast((r && r.message) || 'Không sửa được trạng thái', 'err');
        } else {
          SOC.toast(r.message || 'Đã cập nhật');
          SOC.bumpData();
        }
        scPatch();
      }, function (e) {
        SOC.setBtnBusy_(save, false);
        row.status = old;
        SN.counters = scCounters(SN.log);
        close();
        SOC.toast('Lỗi: ' + e.message, 'err');
        scPatch();
      });
    });
    sel.focus();
  }

  /* ---------- binding ---------- */
  function scBindTable() {
    var scope = document.getElementById('viewScan');
    if (!scope) return;
    Array.prototype.forEach.call(scope.querySelectorAll('#scHead .sortable'), function (th) {
      function flip() {
        var key = th.getAttribute('data-sort');
        if (!key) return;
        if (SN.sort.key === key) SN.sort.dir = SN.sort.dir === 'asc' ? 'desc' : 'asc';
        else SN.sort = { key: key, dir: 'asc' };
        scPatchTable();
      }
      th.addEventListener('click', flip);
      th.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
      });
    });
    Array.prototype.forEach.call(scope.querySelectorAll('#scBody [data-act="fix"]'), function (b) {
      b.addEventListener('click', function () { scOpenFix(b.getAttribute('data-staff')); });
    });
  }

  function scCopyTable() {
    var rows = scSorted();
    if (!rows.length) { SOC.toast('Không có dữ liệu để sao chép', 'err'); return; }
    var lines = [['STT', 'Mã OPS', 'Tên', 'Ca', 'Station', 'Team', 'Bàn làm việc', 'Giờ có mặt', 'Giờ điểm danh', 'Trạng thái'].join('\t')];
    rows.forEach(function (r, i) {
      lines.push([i + 1, r.staffId, r.staffName || '', r.slotCode || '', r.station || '', r.team || '',
        r.workstation || '', r.listedAtText || '', r.scannedAtText || '', STATUS_TXT[r.status] || r.status].join('\t'));
    });
    var txt = lines.join('\n');
    var done = function () { SOC.toast('Đã sao chép ' + rows.length + ' dòng'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, function () { SOC.toast('Trình duyệt chặn sao chép', 'err'); });
    else {
      try {
        var ta = document.createElement('textarea');
        ta.value = txt; ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done();
      } catch (e) { SOC.toast('Trình duyệt chặn sao chép', 'err'); }
    }
  }

  function scBind() {
    var scope = document.getElementById('viewScan');
    if (!scope) return;
    var submit = scope.querySelector('[data-act="submit"]');
    if (submit) submit.addEventListener('click', scSubmit);
    var inp = document.getElementById('scanInput');
    if (inp) inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); scSubmit(); } });
    var gotoAtt = scope.querySelector('[data-act="goto-att"]');
    if (gotoAtt) gotoAtt.addEventListener('click', function () { SOC.selectPage('attendance'); });
    var copy = scope.querySelector('[data-act="copy"]');
    if (copy) copy.addEventListener('click', scCopyTable);
    var search = document.getElementById('scanSearch');
    if (search) {
      search.value = SN.q;
      search.addEventListener('input', function () {
        clearTimeout(debounceQ);
        var v = search.value;
        debounceQ = setTimeout(function () { SN.q = v; SN.page = 1; scPatchTable(); scPatchFilters(); }, 200);
      });
    }
    if (inp && !inp.disabled && !window.matchMedia('(pointer: coarse)').matches) {
      try { inp.focus(); } catch (e) {}
    }
    scBindTable();
  }

  function scRender(ctx) {
    var sec = document.getElementById('viewScan');
    if (!sec) return;
    var force = ctx && ctx.force === true;
    if (force) { SN.task = null; SN.ts = 0; }
    if (!SN.task) {
      SN.loading = true;
      sec.innerHTML = scSkeleton();
    }
    scEnter(force);
  }

  SOC.registerView('scan', { section: 'viewScan', render: scRender });

  /*GHI CHÚ HỢP NHẤT [CHUNG]
    - [CHUNG] getFilterOptionsApi trả lists.slotcodes (viết thường) nhưng không có mảng slotCode
      dẫn xuất từ staffList, nên phải tự SOC.uniq() ở scEnsureOpts(). Đề nghị api.js trả sẵn lists.slots.
    - [CHUNG] scanStaffApi không trả staffName cho mã lạ (dòng Dư) → ô Tên hiển thị '—', cần server
      bổ truy vấn danh bạ khi port về prod.
    - [CHUNG] transitionToAttendApi / completeTaskApi không trả về danh sách dòng thay đổi (Vắng
      mới sinh ra) nên bắt buộc reload getTaskDetailApi sau mỗi lần đổi pha.
  */
})();
