/* view-tasks.js — Danh sách task: lọc chip + phân trang + tạo task (preview số NV khớp) + thao tác dòng.
   Số liệu chỉ qua SOC.api; mọi chuỗi động đều escape trước khi vào innerHTML. */
(function () {
  'use strict';

  var TK = {
    opts: null, tasks: null, gen: null, loading: false, modal: null,
    filters: { station: [], slotCode: [], team: [], status: [] },
    q: '', sort: { key: 'createdAtText', dir: 'desc' }, page: 1, pageSize: 25, seq: 0
  };
  var STATUS_LABEL = { open: 'Mở', attend: 'Điểm danh', done: 'Xong' };
  var TTL_MS = 30000;
  var tsCache = 0;
  var PAGE_SIZE_OPTS = [25, 50, 100];

  function tkFresh() { return !!TK.tasks && SOC.dataGen() === TK.gen && (Date.now() - tsCache) < TTL_MS; }

  function tkWho(email) { return String(email || '').split('@')[0] || '—'; }

  /* ---------- lọc + sort ---------- */
  function tkFiltered() {
    var f = TK.filters;
    var q = TK.q.trim().toUpperCase();
    var rows = (TK.tasks || []).filter(function (t) {
      if (f.station.length && f.station.indexOf(String(t.station || '').trim()) < 0) return false;
      if (f.slotCode.length && !SOC.splitList(t.slotCode).some(function (s) { return f.slotCode.indexOf(s) >= 0; })) return false;
      if (f.team.length && !SOC.splitList(t.team).some(function (s) { return f.team.indexOf(s) >= 0; })) return false;
      if (f.status.length && f.status.indexOf(String(t.status)) < 0) return false;
      if (q && String(t.taskId || '').toUpperCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = TK.sort.key, dir = TK.sort.dir === 'asc' ? 1 : -1;
    rows.sort(function (a, b) {
      var va, vb;
      if (key === 'total' || key === 'scanned' || key === 'extra') { va = Number(a[key]) || 0; vb = Number(b[key]) || 0; }
      else if (key === 'status') {
        var order = { open: 0, attend: 1, done: 2 };
        va = order[a.status] == null ? 9 : order[a.status]; vb = order[b.status] == null ? 9 : order[b.status];
      } else { va = String(a[key] || ''); vb = String(b[key] || ''); }
      if (typeof va === 'number') return (va - vb) * dir || String(a.taskId).localeCompare(String(b.taskId));
      return va.localeCompare(vb, 'vi') * dir || String(a.taskId).localeCompare(String(b.taskId));
    });
    return rows;
  }

  function tkFilterCount() {
    return TK.filters.station.length + TK.filters.slotCode.length + TK.filters.team.length + TK.filters.status.length + (TK.q.trim() ? 1 : 0);
  }

  /* ---------- dữ liệu ---------- */
  function tkLoad(silent) {
    if (TK.loading) return;
    TK.loading = true;
    var seq = ++TK.seq;
    var jobs = [SOC.api.getTaskListApi().then(function (rows) {
      if (rows && rows.ok === false) { if (!silent) SOC.toast(rows.message, 'err'); return; }
      TK.tasks = Array.prototype.slice.call(rows || []);
    })];
    if (!TK.opts) {
      jobs.push(SOC.api.getFilterOptionsApi().then(function (r) {
        if (!r || !r.ok) { if (!silent && r) SOC.toast(r.message, 'err'); return; }
        TK.opts = r;
      }));
    }
    Promise.all(jobs).then(function () {
      TK.loading = false;
      TK.gen = SOC.dataGen();
      tsCache = Date.now();
      if (seq !== TK.seq) return;
      if (SOC.state.page === 'attendance') tkPaintRows();
    }, function (e) {
      TK.loading = false;
      if (!silent) SOC.toast('Không tải được danh sách task: ' + e.message, 'err');
      if (SOC.state.page === 'attendance') tkPaintRows();
    });
  }

  /* ---------- khung trang ---------- */
  function tkHead() {
    var th = function (label, key, cls) {
      var on = TK.sort.key === key;
      return '<th scope="col"' + (key ? ' class="sortable' + (cls ? ' ' + cls : '') + '" data-sort="' + key +
        '" aria-sort="' + (on ? (TK.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '"' : (cls ? ' class="' + cls + '"' : '')) +
        ' tabindex="' + (key ? '0' : '-1') + '">' + SOC.esc(label) + '</th>';
    };
    return '<tr>' + th('STT', '', 'num') + th('Mã task', 'taskId') + th('Ngày tạo', 'createdAtText') +
      th('Station', 'station') + th('Team', 'team') + th('Ca', '') +
      th('Tổng NV', 'total', 'num') + th('Đã điểm danh', 'scanned', 'num') + th('Dư', 'extra', 'num') +
      th('Trạng thái', 'status') + th('Người tạo', 'createdBy') + th('Thao tác', '', 'c') + '</tr>';
  }

  function tkChipGroup(label, field, values) {
    if (!values.length) return '';
    var sel = TK.filters[field];
    return '<div class="tk-chips"><span class="flabel">' + SOC.esc(label) + '</span><div class="chips">' +
      values.map(function (v) {
        return '<button type="button" class="chip' + (sel.indexOf(v) >= 0 ? ' on' : '') +
          '" data-chip="' + field + '" data-val="' + SOC.esc(v) + '" aria-pressed="' +
          (sel.indexOf(v) >= 0 ? 'true' : 'false') + '">' + SOC.esc(v === 'open' || v === 'attend' || v === 'done' ? STATUS_LABEL[v] : v) +
          '</button>';
      }).join('') + '</div></div>';
  }

  function tkChipModel() {
    var tasks = TK.tasks || [];
    var real = function (v) { return v !== '—'; };   /* '—' = placeholder dòng không rõ team/ca */
    var stations = SOC.uniq(tasks.map(function (t) { return t.station; })).sort();
    var slots = SOC.sortSlots(SOC.uniq(tasks.reduce(function (a, t) { return a.concat(SOC.splitList(t.slotCode)); }, [])).filter(real));
    var teams = SOC.uniq(tasks.reduce(function (a, t) { return a.concat(SOC.splitList(t.team)); }, [])).filter(real).sort();
    return [
      { label: 'Station', field: 'station', values: stations },
      { label: 'Ca', field: 'slotCode', values: slots },
      { label: 'Team', field: 'team', values: teams },
      { label: 'Trạng thái', field: 'status', values: ['open', 'attend', 'done'].filter(function (s) { return tasks.some(function (t) { return t.status === s; }); }) }
    ];
  }

  function tkShell() {
    return '<div class="card tk-card">' +
      '<div class="task-list-toolbar">' +
      '<h2 class="section-heading">' + SOC.ico('attendance', 16) + ' Danh sách task ' +
      '<span class="filter-count" id="tkCount" role="status">—</span></h2>' +
      '<div class="list-search" role="search">' +
      '<input type="search" id="taskSearch" placeholder="Tìm mã task (R2026…)" autocomplete="off" spellcheck="false" aria-label="Tìm mã task">' +
      '<button type="button" class="btn-icon" data-act="clear-search" title="Xóa tìm" aria-label="Xóa tìm kiếm">' +
      SOC.ico('close', 18) + '</button></div>' +
      '</div>' +
      '<div class="tk-filters" id="tkFilters" role="group" aria-label="Lọc danh sách task"></div>' +
      '<div class="table-wrap" id="tkWrap"><table id="tkTable" class="table--cards">' +
      '<caption class="sr-only">Danh sách task điểm danh</caption>' +
      '<thead id="tkHead">' + tkHead() + '</thead><tbody id="tkBody"></tbody></table>' +
      '<div class="empty hidden" id="tkEmpty"></div></div>' +
      '<div class="pag-wrap hidden" id="tkPag"></div>' +
      '<div class="card__foot" id="tkFoot"></div>' +
      '</div>';
  }

  /* ---------- dòng ---------- */
  function tkRowActions(t) {
    var isDone = t.status === 'done';
    var mine = String(t.createdBy || '').toLowerCase() === String(SOC.state.email || '').toLowerCase();
    var canMutate = SOC.atLeast('admin') || mine;
    var out = '<button type="button" class="btn btn-sm' + (isDone ? ' btn-outline' : '') +
      '" data-act="open" data-id="' + SOC.esc(t.taskId) + '"><span class="btn-label">' +
      (isDone ? 'Xem' : 'Quét') + '</span></button>';
    if (isDone && canMutate && SOC.atLeast('operator')) {
      out += ' <button type="button" class="btn btn-sm btn-amber" data-act="reopen" data-id="' + SOC.esc(t.taskId) +
        '"><span class="btn-label">Mở lại</span></button>';
    }
    if (t.status === 'open' && !(Number(t.total) || 0) && canMutate) {
      out += ' <button type="button" class="btn btn-sm btn-ghost" data-act="cancel" data-id="' + SOC.esc(t.taskId) +
        '"><span class="btn-label">Hủy</span></button>';
    }
    return out;
  }

  function tkPaintRows() {
    var body = document.getElementById('tkBody');
    if (!body) { tkRenderAll(); return; }
    var all = tkFiltered();
    var total = (TK.tasks || []).length;
    var pages = Math.max(1, Math.ceil(all.length / TK.pageSize));
    if (TK.page > pages) TK.page = pages;
    if (TK.page < 1) TK.page = 1;
    var start = (TK.page - 1) * TK.pageSize;
    var pageRows = all.slice(start, start + TK.pageSize);

    var count = document.getElementById('tkCount');
    if (count) count.textContent = tkFilterCount() ? 'Đang hiện ' + all.length + '/' + total : total + ' task';

    body.innerHTML = pageRows.map(function (t, i) {
      var cls = t.status === 'done' ? ' class="is-done"' : '';
      return '<tr' + cls + '>' +
        '<td class="num" data-label="STT" data-hide="m">' + (start + i + 1) + '</td>' +
        '<td data-label="Mã task" data-nolabel><b>' + SOC.esc(t.taskId) + '</b></td>' +
        '<td class="nowrap" data-label="Ngày tạo">' + SOC.esc(t.createdAtText || '') + '</td>' +
        '<td data-label="Station">' + SOC.esc(t.station || '—') + '</td>' +
        '<td data-label="Team">' + SOC.esc(t.team || '—') + '</td>' +
        '<td data-label="Ca">' + SOC.slotCell(t.slotCode) + '</td>' +
        '<td class="num" data-label="Tổng NV">' + (Number(t.total) || 0) + '</td>' +
        '<td class="num" data-label="Đã điểm danh">' + (Number(t.scanned) || 0) + '</td>' +
        '<td class="num" data-label="Dư" data-hide="m">' + (Number(t.extra) || 0) + '</td>' +
        '<td data-label="Trạng thái" data-nolabel><span class="badge ' + SOC.esc(t.status) + '">' + SOC.esc(STATUS_LABEL[t.status] || t.status) + '</span></td>' +
        '<td data-label="Người tạo" data-hide="m">' + SOC.esc(tkWho(t.createdBy)) + '</td>' +
        '<td class="tk-act" data-label="Thao tác" data-nolabel>' + tkRowActions(t) + '</td>' +
        '</tr>';
    }).join('');

    var empty = document.getElementById('tkEmpty');
    var table = document.getElementById('tkTable');
    if (empty && table) {
      var showEmpty = !pageRows.length;
      empty.classList.toggle('hidden', !showEmpty);
      table.classList.toggle('hidden', showEmpty);
      if (showEmpty) {
        empty.innerHTML = total === 0
          ? '<div>Chưa có task nào — bấm <b>+ Task mới</b>, rồi <b>Nạp danh sách</b> trong màn quét.</div>'
          : '<div>Không có task khớp bộ lọc — xóa chip hoặc đổi ô tìm.</div>';
      }
    }
    tkPaintPager(all.length, pages);
    tkPaintFilters();

    var foot = document.getElementById('tkFoot');
    if (foot) {
      var open = (TK.tasks || []).filter(function (t) { return t.status !== 'done'; }).length;
      foot.textContent = 'Chỉ hiển thị task trong 30 ngày gần nhất — task chưa kết thúc luôn hiển thị. ' +
        open + ' task chưa đóng.';
      SOC.setCount('attendance', open || null);
    }
    var head = document.getElementById('tkHead');
    if (head) head.innerHTML = tkHead();
    tkBindRows();
  }

  function tkPaintPager(total, pages) {
    var pag = document.getElementById('tkPag');
    if (!pag) return;
    if (total <= TK.pageSize) { pag.classList.add('hidden'); pag.innerHTML = ''; return; }
    pag.classList.remove('hidden');
    var btns = [];
    for (var p = 1; p <= pages; p++) {
      if (pages > 7 && p !== 1 && p !== pages && Math.abs(p - TK.page) > 1) {
        if (btns[btns.length - 1] !== '<span class="pag-info">…</span>') btns.push('<span class="pag-info">…</span>');
        continue;
      }
      btns.push('<button type="button" class="pag-btn' + (p === TK.page ? ' active' : '') +
        '" data-page="' + p + '" aria-label="Trang ' + p + '"' + (p === TK.page ? ' aria-current="page"' : '') + '>' + p + '</button>');
    }
    pag.innerHTML = '<button type="button" class="pag-btn" data-page="' + Math.max(1, TK.page - 1) + '" aria-label="Trang trước">' +
      SOC.ico('back', 16) + '</button>' + btns.join('') +
      '<button type="button" class="pag-btn tk-pag-next" data-page="' + Math.min(pages, TK.page + 1) + '" aria-label="Trang sau">' +
      SOC.ico('back', 16) + '</button>' +
      '<span class="pag-info">Trang ' + TK.page + '/' + pages + ' · ' + total + ' task</span>' +
      '<span class="pag-info">Số dòng</span>' +
      PAGE_SIZE_OPTS.map(function (n) {
        return '<button type="button" class="pag-btn' + (n === TK.pageSize ? ' active' : '') +
          '" data-size="' + n + '">' + n + '</button>';
      }).join('');
    Array.prototype.forEach.call(pag.querySelectorAll('[data-page]'), function (b) {
      b.addEventListener('click', function () { TK.page = Number(b.getAttribute('data-page')); tkPaintRows(); });
    });
    Array.prototype.forEach.call(pag.querySelectorAll('[data-size]'), function (b) {
      b.addEventListener('click', function () { TK.pageSize = Number(b.getAttribute('data-size')); TK.page = 1; tkPaintRows(); });
    });
  }

  function tkPaintFilters() {
    var host = document.getElementById('tkFilters');
    if (!host) return;
    var groups = tkChipModel();
    var any = tkFilterCount() > 0;
    host.innerHTML = groups.map(function (g) { return tkChipGroup(g.label, g.field, g.values); }).join('') +
      (any ? '<div class="tk-chips"><span class="flabel">&nbsp;</span><div class="chips">' +
        '<button type="button" class="chip chip--clear" data-act="clear-filters">Xóa lọc' +
        '<span class="chip__x" aria-hidden="true">' + SOC.ico('close', 12) + '</span></button></div></div>' : '');
    Array.prototype.forEach.call(host.querySelectorAll('[data-chip]'), function (b) {
      b.addEventListener('click', function () {
        var field = b.getAttribute('data-chip'), val = b.getAttribute('data-val');
        var arr = TK.filters[field];
        var i = arr.indexOf(val);
        if (i >= 0) arr.splice(i, 1); else arr.push(val);
        TK.page = 1;
        tkPaintRows();
      });
    });
    var clr = host.querySelector('[data-act="clear-filters"]');
    if (clr) clr.addEventListener('click', function () {
      Object.keys(TK.filters).forEach(function (k) { TK.filters[k] = []; });
      TK.q = '';
      var inp = document.getElementById('taskSearch'); if (inp) inp.value = '';
      TK.page = 1;
      tkPaintRows();
    });
  }

  function tkBindRows() {
    var scope = document.getElementById('viewTasks');
    if (!scope) return;
    Array.prototype.forEach.call(scope.querySelectorAll('.sortable'), function (th) {
      function flip() {
        var key = th.getAttribute('data-sort');
        if (!key) return;
        if (TK.sort.key === key) TK.sort.dir = TK.sort.dir === 'asc' ? 'desc' : 'asc';
        else TK.sort = { key: key, dir: 'asc' };
        tkPaintRows();
      }
      th.addEventListener('click', flip);
      th.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
      });
    });
    Array.prototype.forEach.call(scope.querySelectorAll('#tkBody [data-act]'), function (b) {
      b.addEventListener('click', function () { tkAction(b.getAttribute('data-act'), b.getAttribute('data-id'), b); });
    });
  }

  function tkRenderAll() {
    var sec = document.getElementById('viewTasks');
    if (!sec) return;
    sec.innerHTML = tkShell();
    var inp = document.getElementById('taskSearch');
    if (inp) {
      inp.value = TK.q;
      inp.addEventListener('input', function () { TK.q = inp.value; TK.page = 1; tkPaintRows(); });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { inp.value = ''; TK.q = ''; TK.page = 1; tkPaintRows(); }
      });
    }
    var cs = document.querySelector('#viewTasks [data-act="clear-search"]');
    if (cs) cs.addEventListener('click', function () {
      var i2 = document.getElementById('taskSearch');
      if (i2) { i2.value = ''; i2.focus(); }
      TK.q = ''; TK.page = 1; tkPaintRows();
    });
    tkPaintRows();
  }

  /* ---------- actions ---------- */
  function tkAction(act, id, btn) {
    if (act === 'open') { SOC.openScan(id); return; }
    if (act === 'reopen') {
      SOC.confirm({ title: 'Mở lại task', message: 'Mở lại ' + id + ' — các dòng Vắng sẽ trở về Chưa điểm danh để quét lại.', okLabel: 'Mở lại' })
        .then(function (ok) { if (!ok) return; tkMutate(SOC.api.reopenTaskApi, id, btn, 'Đã mở lại task'); });
      return;
    }
    if (act === 'cancel') {
      SOC.confirm({ title: 'Hủy task rỗng', message: 'Hủy ' + id + '? Task chưa có dòng nào sẽ mất khỏi danh sách.', okLabel: 'Hủy task' })
        .then(function (ok) { if (!ok) return; tkMutate(SOC.api.cancelTaskApi, id, btn, 'Đã hủy task'); });
    }
  }

  function tkMutate(fn, id, btn, okMsg) {
    SOC.setBtnBusy_(btn, true, 'Đang lưu');
    fn(id).then(function (r) {
      SOC.setBtnBusy_(btn, false);
      if (!r || !r.ok) { SOC.toast((r && r.message) || 'Thao tác thất bại', 'err'); return; }
      SOC.toast(r.message || okMsg);
      SOC.bumpData();
      tkLoad(true);
    }, function (e) {
      SOC.setBtnBusy_(btn, false);
      SOC.toast('Lỗi: ' + e.message, 'err');
    });
  }

  function tkCopyTable() {
    var rows = tkFiltered();
    if (!rows.length) { SOC.toast('Không có dữ liệu để sao chép', 'err'); return; }
    var head = ['STT', 'Mã task', 'Ngày tạo', 'Station', 'Team', 'Ca', 'Tổng NV', 'Đã điểm danh', 'Dư', 'Trạng thái', 'Người tạo'];
    var lines = [head.join('\t')];
    rows.forEach(function (t, i) {
      lines.push([i + 1, t.taskId, t.createdAtText || '', t.station || '', t.team || '', t.slotCode || '',
        t.total || 0, t.scanned || 0, t.extra || 0, STATUS_LABEL[t.status] || t.status, tkWho(t.createdBy)].join('\t'));
    });
    var txt = lines.join('\n');
    var done = function () { SOC.toast('Đã sao chép ' + rows.length + ' dòng'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, function () { SOC.toast('Trình duyệt chặn sao chép', 'err'); });
    else tkFallbackCopy(txt, done);
  }
  function tkFallbackCopy(txt, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = txt; ta.setAttribute('aria-hidden', 'true');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done();
    } catch (e) { SOC.toast('Trình duyệt chặn sao chép', 'err'); }
  }

  /* ---------- modal tạo task — pivot Ca × hợp đồng (component SOC.rosterPivot) ---------- */
  /* Danh mục cho pivot: stations = lists.stations ∪ stationGroups (mock có thể thiếu một trong hai nguồn);
     slots dẫn xuất từ staffList — cùng nguồn với modal Màn quét */
  function tkCatalogs() {
    var o = TK.opts || {};
    var lists = o.lists || {};
    return {
      stations: SOC.uniq((lists.stations || []).concat((o.stationGroups || []).map(function (g) { return g.station; })))
        .filter(function (v) { return v !== '—'; }).sort(),
      slots: SOC.sortSlots(SOC.uniq((o.staffList || []).map(function (s) { return s.slotCode; }))),
      teams: lists.teams || [],
      departments: lists.departments || []
    };
  }

  function tkOpenCreate() {
    if (TK.modal) return;
    if (!TK.opts) { tkLoad(true); SOC.toast('Đang tải danh mục — thử lại sau ít giây', 'err'); return; }
    var d = TK.opts.defaults || {};
    var catalogs = tkCatalogs();
    var form = { date: SOC.isoDay(new Date()), autoAttend: false };
    var ov = document.createElement('div');
    ov.className = 'about-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', 'tkCreateTitle');
    ov.innerHTML =
      '<div class="about-dialog rp__dialog">' +
        '<div class="modal-head"><h2 id="tkCreateTitle">Tạo task điểm danh</h2>' +
        '<button type="button" class="btn-icon" data-act="tk.x" aria-label="Đóng">' + SOC.ico('close', 18) + '</button></div>' +
        '<p class="mode-desc">Chọn ô Ca × hợp đồng trong bảng để tạo task kèm luôn danh sách — không chọn ô nào sẽ tạo ' +
        'task <b>Mở</b> rỗng, nạp sau bằng nút "Nạp danh sách".</p>' +
        '<div class="form-grid">' +
          '<label class="fld"><span>Ngày tạo task</span><input type="date" data-f="date" value="' + SOC.esc(form.date) + '"></label>' +
          '<label class="fld tk-check"><input type="checkbox" data-f="autoAttend"><span>Tự đánh dấu đã điểm danh cho toàn bộ danh sách vừa nạp</span></label>' +
        '</div>' +
        '<div class="rp__bar">' +
          '<label class="fld"><span>Station</span><select data-rsf="station"></select></label>' +
          '<label class="fld"><span>Ngày nạp</span><select data-rsf="date"></select></label>' +
          '<label class="fld"><span>Team</span><select data-rsf="team"></select></label>' +
          '<label class="fld"><span>Department</span><select data-rsf="dept"></select></label>' +
        '</div>' +
        '<div class="rp__wrap" data-slot="pivot" role="region" aria-label="Bảng phân bố nhân viên"></div>' +
        '<div class="modal-foot rp__foot">' +
          '<span class="rp__seltext" data-slot="seltext" role="status" aria-live="polite"></span>' +
          '<span class="rp__btns">' +
            '<button type="button" class="btn btn-ghost" data-act="rs.clear" disabled><span class="btn-label">Xóa chọn</span></button>' +
            '<button type="button" class="btn btn-ghost" data-act="tk.x"><span class="btn-label">Hủy</span></button>' +
            '<button type="button" class="btn" data-act="rs.load" disabled><span class="btn-label">Tạo task</span>' +
            '<span class="btn-ico">' + SOC.ico('plus', 16) + '</span></button>' +
          '</span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    var rp = SOC.rosterPivot(ov, {
      staffList: TK.opts.staffList || [],
      catalogs: catalogs,
      loadLabel: 'Tạo task',
      allowEmpty: true
    });
    TK.modal = { el: ov, form: form, rp: rp, opener: document.activeElement, trap: SOC.trapFocus(ov) };
    var defStation = catalogs.stations.indexOf(d.station) >= 0 ? d.station : (catalogs.stations[0] || '');
    if (defStation) rp.pick('station', defStation);
    else rp.render();
    var dateI = ov.querySelector('[data-f="date"]');
    dateI.addEventListener('change', function () { form.date = dateI.value || form.date; });
    var chk = ov.querySelector('[data-f="autoAttend"]');
    chk.addEventListener('change', function () { form.autoAttend = chk.checked; });
    Array.prototype.forEach.call(ov.querySelectorAll('[data-rsf]'), function (s) {
      s.addEventListener('change', function () { rp.pick(s.getAttribute('data-rsf'), s.value); });
    });
    ov.addEventListener('click', function (e) {
      var t = e.target;
      if (!t.closest) return;
      var x = t.closest('[data-act="tk.x"]');
      if (t === ov || x) { tkCloseCreate(); return; }
      if (t.closest('[data-act="rs.clear"]')) { rp.clearSel(); return; }
      var go = t.closest('[data-act="rs.load"]');
      if (go) { tkSubmitCreate(go); return; }
      var cell = t.closest('[data-cell]');
      if (cell && !cell.disabled) rp.toggleCell(cell.getAttribute('data-cell'));
    });
    document.addEventListener('keydown', tkModalEsc);
    var first = ov.querySelector(rp.state.station ? '[data-rsf="date"]' : '[data-rsf="station"]');
    if (first) first.focus();
  }

  function tkSubmitCreate(btn) {
    var m = TK.modal;
    if (!m) return;
    var form = m.form, rp = m.rp;
    if (!form.date) { SOC.toast('Chọn ngày tạo task', 'err'); return; }
    if (!rp.state.station) { SOC.toast('Chọn Station trước khi tạo task', 'err'); return; }
    var staff = rp.selectedStaff();
    SOC.setBtnBusy_(btn, true, 'Đang tạo');
    rp.setLocked(true);
    SOC.api.createTaskApi({
      date: form.date, station: rp.state.station,
      slotCode: rp.flatCellField('slotCode'),
      team: rp.state.team ? [rp.state.team] : [],
      contractType: rp.flatCellField('contractType'),
      codes: staff.map(function (s) { return s.staffId; }),
      autoAttend: !!form.autoAttend
    }).then(function (r) {
      SOC.setBtnBusy_(btn, false);
      if (TK.modal) TK.modal.rp.setLocked(false);
      if (!r || !r.ok) { SOC.toast((r && r.message) || 'Tạo task thất bại', 'err'); return; }
      tkCloseCreate();
      SOC.bumpData();
      SOC.toast(r.message || ('Đã tạo task ' + r.taskId));
      TK.tasks = null;
      SOC.openScan(r.taskId);
    }, function (e) {
      SOC.setBtnBusy_(btn, false);
      if (TK.modal) TK.modal.rp.setLocked(false);
      SOC.toast('Lỗi tạo task: ' + e.message, 'err');
    });
  }

  function tkModalEsc(e) { if (e.key === 'Escape') tkCloseCreate(); }
  function tkCloseCreate() {
    if (!TK.modal) return;
    document.removeEventListener('keydown', tkModalEsc);
    if (TK.modal.trap) TK.modal.trap();
    var opener = TK.modal.opener;
    TK.modal.el.remove();
    TK.modal = null;
    if (opener && document.contains(opener)) opener.focus();
  }

  /* ---------- entry ---------- */
  function tkPaintActions() {
    var host = SOC.pageActions(
      (SOC.atLeast('operator') ? '<button type="button" class="btn" data-act="create">' +
        '<span class="btn-label">Task mới</span><span class="btn-ico">' + SOC.ico('plus', 16) + '</span></button>' : '') +
      '<button type="button" class="btn btn-outline" data-act="copy"><span class="btn-label">Sao chép</span>' +
      '<span class="btn-ico">' + SOC.ico('copy', 16) + '</span></button>' +
      '<button type="button" class="btn btn-outline" data-act="reload"><span class="btn-label">Cập nhật</span>' +
      '<span class="btn-ico">' + SOC.ico('refresh', 16) + '</span></button>');
    if (!host) return;
    var c = host.querySelector('[data-act="create"]');
    if (c) c.addEventListener('click', tkOpenCreate);
    host.querySelector('[data-act="copy"]').addEventListener('click', tkCopyTable);
    var rl = host.querySelector('[data-act="reload"]');
    rl.addEventListener('click', function () {
      SOC.setBtnBusy_(rl, true, 'Đang tải');
      SOC.bumpData();
      TK.page = 1;
      SOC.api.getTaskListApi().then(function (rows) {
        SOC.setBtnBusy_(rl, false);
        if (rows && rows.ok === false) { SOC.toast(rows.message, 'err'); return; }
        TK.tasks = Array.prototype.slice.call(rows || []);
        TK.gen = SOC.dataGen(); tsCache = Date.now();
        tkPaintRows();
      }, function (e) { SOC.setBtnBusy_(rl, false); SOC.toast('Lỗi: ' + e.message, 'err'); });
    });
  }

  function tkSkeleton() {
    var rows = [];
    for (var i = 0; i < 6; i++) {
      var c = [];
      for (var k = 0; k < 12; k++) c.push('<div class="skeleton-cell"></div>');
      rows.push('<div class="skeleton-row">' + c.join('') + '</div>');
    }
    return '<div class="card tk-card"><div class="skeleton-wrap" aria-busy="true" aria-label="Đang tải danh sách task">' +
      rows.join('') + '</div></div>';
  }

  function tkRender(ctx) {
    var sec = document.getElementById('viewTasks');
    if (!sec) return;
    var force = ctx && ctx.force === true;
    tkPaintActions();
    if (!TK.tasks) {
      sec.innerHTML = tkSkeleton();
      tkLoad(false);
      return;
    }
    if (force || !tkFresh()) { tkPaintRows(); tkLoad(true); return; }
    tkPaintRows();
  }

  SOC.registerView('attendance', { section: 'viewTasks', render: tkRender });

  /*GHI CHÚ HỢP NHẤT [CHUNG]
    - [CHUNG] thiếu API đếm nhanh theo trạng thái cho sidebar: hiện phải suy ra "task chưa đóng"
      từ getTaskListApi (mảng trần). Nếu có getTaskCountersApi() thì bỏ vòng lọc lặp ở tkPaintRows.
    - [CHUNG] .pag-wrap chưa có khu chọn "số dòng mỗi trang" → đang tái dùng .pag-btn; nếu muốn
      đồng nhất thì thêm .pag-size vào components.css.
  */
})();
