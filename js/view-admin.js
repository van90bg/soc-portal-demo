/* view-admin.js — page 'admin' · section 'viewAdmin' (prefix .ad-)
   Nhật ký hoạt động (AuditLog, phân trang 50 dòng/offset) + khối Dọn dữ liệu cũ (preview → confirm → exec).
   Chỉ admin: API tự gate, UI vẫn ẩn nút thao tác theo SOC.atLeast('admin'). */
(function () {
  'use strict';

  var PAGE = 'admin';
  var SECTION = 'viewAdmin';

  var PAGE_SIZE = 50;
  var CHUNK = 200;          // server cap limit 200/lần gọi — tải theo cửa sổ 200 để lọc client mượt

  var audit = [];           // các dòng đã tải (mới → cũ)
  var loadedTo = 0;         // số dòng thực sự còn ở phía server đã đọc
  var total = 0;
  var page = 1;
  var action = '';
  var query = '';
  var fetching = false;
  var labels = null;        // actionLabels từ payload — nguồn nhãn tiếng Việt duy nhất
  var preview = null;       // {taskCount, logCount, cutOffText, retentionDays}
  var wired = false;

  function esc(v) { return SOC.esc(v); }

  /* Nhật ký hiển thị theo múi Asia/Ho_Chi_Minh — máy mở app ở múi khác vẫn đúng ngày/giờ (khớp server) */
  var TZ = (function () {
    try {
      return {
        date: new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }),
        time: new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' })
      };
    } catch (e) { return null; }
  })();
  function stamp(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || '');
    if (TZ) return TZ.time.format(d).replace(', ', ' ');
    return SOC.pad2(d.getDate()) + '/' + SOC.pad2(d.getMonth() + 1) + ' ' + SOC.pad2(d.getHours()) + ':' + SOC.pad2(d.getMinutes());
  }
  function actionLabel(a) { return (labels && labels[a]) || a || '—'; }

  /* detail là JSON chuỗi — rút gọn thành "key: value · …", giữ bản đầy đủ trong title */
  function detailText(raw) {
    var s = String(raw || '').trim();
    if (!s) return '—';
    var out = null;
    try {
      var o = JSON.parse(s);
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        var keys = Object.keys(o);
        out = keys.slice(0, 4).map(function (k) {
          var v = o[k];
          return k + ': ' + (Array.isArray(v) ? v.join(', ') : (v && typeof v === 'object' ? JSON.stringify(v) : String(v)));
        }).join(' · ') + (keys.length > 4 ? ' …' : '');
      }
    } catch (e) { out = null; }
    out = out || s;
    return out.length > 90 ? out.slice(0, 90) + '…' : out;
  }

  /* ---------- tải nhật ký ---------- */
  function fetchChunk(offset) {
    fetching = true;
    return SOC.api.getAuditLogApi(CHUNK, offset).then(function (r) {
      fetching = false;
      if (!r || !r.ok) {
        SOC.toast((r && r.message) || 'Không tải được nhật ký hoạt động', 'err');
        if (!audit.length) blocked((r && r.message) || 'Không tải được nhật ký hoạt động');
        return false;
      }
      labels = r.actionLabels || labels;
      if (offset === 0) audit = [];
      audit = audit.concat(r.rows || []);
      loadedTo = audit.length;
      total = Number(r.total) || audit.length;
      return true;
    }).catch(function (e) {
      fetching = false;
      SOC.toast('Lỗi tải nhật ký: ' + e.message, 'err');
      if (!audit.length) blocked('Lỗi tải nhật ký: ' + e.message);
      return false;
    });
  }

  function blocked(msg) {
    var host = document.getElementById(SECTION);
    if (host) host.innerHTML = '<div class="card"><div class="empty">' + esc(msg) + '</div></div>';
    SOC.pageActions('');
  }

  function loadAll(showSkeleton) {
    var host = document.getElementById(SECTION);
    if (showSkeleton && host) host.innerHTML = skeleton(8);
    return fetchChunk(0).then(function (ok) {
      if (!ok) return;
      page = 1;
      SOC.setCount(PAGE, total || null);
      paint();
    });
  }

  /* Trang p cần (p*50) dòng gốc đã tải — tải tiếp từng cửa sổ 200 cho tới đủ hoặc hết */
  function ensurePage(p, then) {
    var need = p * PAGE_SIZE;
    if (loadedTo >= need || loadedTo >= total || fetching) { then(); return; }
    fetchChunk(loadedTo).then(function (ok) {
      if (!ok) { then(); return; }
      ensurePage(p, then);
    });
  }

  /* ---------- lọc ---------- */
  function filtered() {
    var q = query.trim().toLowerCase();
    return audit.filter(function (r) {
      if (action && r.action !== action) return false;
      if (!q) return true;
      return (String(r.email || '') + ' ' + String(r.targetId || '') + ' ' + String(r.detail || '') + ' ' + actionLabel(r.action)).toLowerCase().indexOf(q) >= 0;
    });
  }

  /* ---------- render ---------- */
  function paint() {
    var host = document.getElementById(SECTION);
    if (!host) return;
    if (!labels && !audit.length) { host.innerHTML = skeleton(6); return; }
    var isAdmin = SOC.atLeast('admin');
    host.innerHTML = auditCard(isAdmin) + (isAdmin ? purgeCard() : '');
    paintRows();
    pageActions();
    wireOnce(host);
  }

  function auditCard(isAdmin) {
    /* phi admin: API vẫn gate, nhưng không dựng bảng trống — hiện 1 khối thông báo */
    if (!isAdmin) {
      return '<div class="card card--fit ad-card">' +
        '<div class="card__head"><h2 class="section-heading">Nhật ký hoạt động</h2></div>' +
        '<div class="card-body ad-denied"><div class="empty">Cần quyền admin để xem nhật ký hoạt động</div></div></div>';
    }
    var opts = '<option value="">Mọi thao tác</option>' + Object.keys(labels || {}).map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === action ? ' selected' : '') + '>' + esc(labels[k]) + '</option>';
    }).join('');
    return '<div class="card ad-card">' +
      '<div class="card__head">' +
      '<h2 class="section-heading">Nhật ký hoạt động</h2>' +
      '<select class="ad-actionsel" data-ad-action aria-label="Lọc theo loại thao tác">' + opts + '</select>' +
      '<div class="list-search" role="search">' +
      '<input type="search" data-ad-q placeholder="Tìm email, đối tượng, chi tiết…" aria-label="Tìm trong nhật ký" autocomplete="off" spellcheck="false" value="' + esc(query) + '">' +
      '<button type="button" class="btn-icon" data-ad-clear aria-label="Xóa tìm" title="Xóa tìm kiếm">' + SOC.ico('close', 16) + '</button>' +
      '</div></div>' +
      '<div class="table-wrap" tabindex="0" role="region" aria-label="Bảng nhật ký hoạt động"><table class="ad-table table--cards"><caption class="sr-only">Nhật ký hoạt động: thời gian, người, hành động, đối tượng, chi tiết</caption>' +
      '<thead><tr><th scope="col">Thời gian</th><th scope="col">Người</th><th scope="col">Hành động</th>' +
      '<th scope="col">Đối tượng</th><th scope="col">Chi tiết</th></tr></thead>' +
      '<tbody id="adBody"></tbody></table></div>' +
      '<div class="pag-wrap" id="adPag"></div>' +
      '</div>';
  }

  function purgeCard() {
    var hasPreview = !!preview;
    return '<div class="card card--fit ad-purge">' +
      '<div class="card__head"><h2 class="section-heading">Dọn dữ liệu cũ</h2>' +
      '<span class="pill">chỉ admin</span></div>' +
      '<div class="card-body ad-purgebody">' +
      '<p class="mode-desc">Task đã đóng quá hạn lưu trữ bị xóa VĨNH VIỄN cùng toàn bộ dòng điểm danh của nó. ' +
      'Task còn Mở / Điểm danh không bao giờ bị xóa. Phải Quét thử để thấy số liệu trước khi bấm Thực hiện.</p>' +
      (hasPreview
        ? '<div class="ad-preview" role="status">' + SOC.ico('alert', 16) +
          '<span>Sẽ xóa <b>' + preview.taskCount + ' task</b> · <b>' + preview.logCount + ' dòng điểm danh</b>' +
          ' (đóng trước ' + esc(preview.cutOffText) + ', giữ ' + preview.retentionDays + ' ngày)</span></div>'
        : '<div class="ad-preview ad-preview--idle" role="status"><span>Chưa quét — bấm Quét thử để xem phạm vi xóa.</span></div>') +
      '<div class="frow ad-purgerow">' +
      '<button type="button" class="btn btn-outline btn-sm" data-ad-pv><span class="btn-label">Quét thử</span>' + SOC.ico('search', 16) + '</button>' +
      '<button type="button" class="btn btn-danger btn-sm" data-ad-exec' + (hasPreview && preview.taskCount > 0 ? '' : ' disabled') + '>' +
      '<span class="btn-label">Thực hiện</span>' + SOC.ico('trash', 16) + '</button>' +
      '</div></div></div>';
  }

  function skeleton(n) {
    var out = '<div class="skeleton-wrap">';
    for (var i = 0; i < n; i++) {
      out += '<div class="skeleton-row"><div class="skeleton-cell"></div><div class="skeleton-cell"></div>' +
        '<div class="skeleton-cell"></div><div class="skeleton-cell"></div><div class="skeleton-cell"></div></div>';
    }
    return out + '</div>';
  }

  /* chỉ thay phần động (rows + pagination) để lọc/gõ không rebuild cả card */
  function paintRows() {
    var body = document.getElementById('adBody');
    if (!body) return;
    var list = filtered();
    var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (page > pages) page = pages;
    if (page < 1) page = 1;
    var slice = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    body.innerHTML = slice.length ? slice.map(function (r) {
      return '<tr><td class="ad-time nowrap" data-label="Thời gian" data-nolabel>' + esc(stamp(r.timestamp)) + '</td>' +
        '<td data-label="Người">' + esc(r.email || '—') + '</td>' +
        '<td data-label="Hành động" data-nolabel><span class="pill ad-act">' + esc(actionLabel(r.action)) + '</span></td>' +
        '<td data-label="Đối tượng">' + esc(r.targetId || '—') + '</td>' +
        '<td class="ad-detail" data-label="Chi tiết" title="' + esc(String(r.detail || '')) + '">' + esc(detailText(r.detail)) + '</td></tr>';
    }).join('') : '<tr><td colspan="5"><div class="empty">' +
      (list.length ? 'Không có dòng khớp bộ lọc' : 'Chưa có hoạt động nào được ghi nhận') + '</div></td></tr>';

    var pag = document.getElementById('adPag');
    if (!pag) return;
    var info = list.length + ' dòng khớp';
    if (list.length === audit.length && total > audit.length) info += ' · ' + total + ' dòng trong hệ thống';
    var nums = '';
    for (var i = 1; i <= pages; i++) {
      if (pages > 7 && i > 3 && i < pages - 1 && Math.abs(i - page) > 1) {
        if (nums.slice(-3) !== '…') nums += '<span class="pag-info">…</span>';
        continue;
      }
      nums += '<button type="button" class="pag-btn' + (i === page ? ' active' : '') + '" data-ad-page="' + i + '"' +
        (i === page ? ' aria-current="page"' : '') + '>' + i + '</button>';
    }
    pag.innerHTML =
      '<button type="button" class="pag-btn" data-ad-page="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>Trước</button>' +
      nums +
      '<button type="button" class="pag-btn" data-ad-page="' + (page + 1) + '"' + (page >= pages ? ' disabled' : '') + '>Sau</button>' +
      '<span class="pag-info">Trang ' + page + '/' + pages + ' · ' + info + '</span>';
  }

  function pageActions() {
    var host = SOC.pageActions(
      '<button type="button" class="btn btn-outline" data-ad-copy><span class="btn-label">Sao chép</span>' + SOC.ico('copy', 16) + '</button>'
    );
    var b = host && host.querySelector ? host.querySelector('[data-ad-copy]') : null;
    if (b) b.addEventListener('click', function () { copyRows(b); });
  }

  function copyRows(btn) {
    SOC.setBtnBusy_(btn, true, 'Đang lấy');
    var list = filtered();
    if (!list.length) { SOC.setBtnBusy_(btn, false); SOC.toast('Nhật ký trống — không có gì để sao chép', 'err'); return; }
    var lines = ['Thời gian\tNgười\tHành động\tĐối tượng\tChi tiết'];
    list.forEach(function (r) {
      lines.push([stamp(r.timestamp), r.email || '', actionLabel(r.action), r.targetId || '', detailText(r.detail)].join('\t'));
    });
    var text = lines.join('\n');
    SOC.setBtnBusy_(btn, false);
    copyText(text, 'Đã sao chép ' + list.length + ' dòng nhật ký');
  }

  function copyText(text, okMsg) {
    var ta = document.createElement('textarea');
    ta.className = 'ad-clipboard';
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

  /* ---------- dọn dữ liệu cũ ---------- */
  function runPreview(btn) {
    SOC.setBtnBusy_(btn, true, 'Đang quét');
    preview = null;
    SOC.api.purgeOldTasksApi({ mode: 'preview' }).then(function (r) {
      SOC.setBtnBusy_(btn, false);
      if (!r || !r.ok || !r.preview) { SOC.toast((r && r.message) || 'Không quét được dữ liệu cũ', 'err'); paint(); return; }
      preview = r.preview;
      paint();
    }).catch(function (e) {
      SOC.setBtnBusy_(btn, false);
      SOC.toast('Lỗi quét thử: ' + e.message, 'err');
      paint();
    });
  }

  function runExec(btn) {
    if (!preview || !preview.taskCount) { SOC.toast('Hãy bấm Quét thử trước khi xóa', 'err'); return; }
    var p = preview;
    SOC.confirm({
      title: 'Dọn dữ liệu cũ',
      message: 'Xóa vĩnh viễn ' + p.taskCount + ' task + ' + p.logCount + ' dòng điểm danh (đã đóng trước ' + p.cutOffText + ')? Không thể khôi phục.',
      okLabel: 'Xóa vĩnh viễn'
    }).then(function (ok) {
      if (!ok) return;
      SOC.setBtnBusy_(btn, true, 'Đang xóa');
      SOC.api.purgeOldTasksApi({ mode: 'exec' }).then(function (r) {
        SOC.setBtnBusy_(btn, false);
        if (!r || !r.ok) { SOC.toast((r && r.message) || 'Không xóa được', 'err'); return; }
        preview = null;
        SOC.toast('Đã xóa ' + r.taskCount + ' task · ' + r.logCount + ' dòng điểm danh', 'ok');
        loadAll(false);
      }).catch(function (e) {
        SOC.setBtnBusy_(btn, false);
        SOC.toast('Lỗi xóa dữ liệu: ' + e.message, 'err');
      });
    });
  }

  /* ---------- wire ---------- */
  function wireOnce(host) {
    if (wired) return;
    host.addEventListener('change', function (e) {
      if (e.target && e.target.hasAttribute('data-ad-action')) {
        action = e.target.value;
        page = 1;
        paintRows();
      }
    });
    host.addEventListener('input', function (e) {
      if (e.target && e.target.hasAttribute('data-ad-q')) {
        var v = e.target.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          query = v;
          page = 1;
          paintRows();
          var box = document.querySelector('#' + SECTION + ' [data-ad-q]');
          if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
        }, 250);
      }
    });
    host.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-ad-page],[data-ad-clear],[data-ad-pv],[data-ad-exec]') : null;
      if (!t) return;
      if (t.hasAttribute('data-ad-clear')) { query = ''; paint(); return; }
      if (t.hasAttribute('data-ad-pv')) { runPreview(t); return; }
      if (t.hasAttribute('data-ad-exec')) { runExec(t); return; }
      var p = parseInt(t.getAttribute('data-ad-page'), 10);
      if (!p || t.disabled) return;
      ensurePage(p, function () { page = p; paintRows(); });
    });
    wired = true;
  }
  var searchTimer = null;

  SOC.registerView(PAGE, {
    section: SECTION,
    render: function (ctx) {
      var force = !!(ctx && ctx.force);
      if (audit.length && !force) { paint(); paintRows(); return; }
      if (force) { audit = []; loadedTo = 0; total = 0; preview = null; }
      loadAll(true);
    }
  });
})();
