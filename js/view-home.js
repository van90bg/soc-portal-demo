/* view-home.js — Trang chủ thích ứng theo role: Viewer = ca của tôi · Operator = bàn làm việc
   ca trực · Manager/Admin = hub chỉ huy (giữ nguyên hợp đồng .hm-runs + .stat-strip 6 card).
   Mọi con số tính từ API thật, không có số tượng trưng. */
(function () {
  'use strict';

  var HM = { tasks: null, leave: null, sched: null, self: null, gen: null, loading: false };
  var TTL_MS = 30000;
  var tsCache = 0;

  /* Danh sách đổi gen sau mỗi mutation ở view khác — cache coi như hết hạn. */
  function hmFresh() {
    return !!HM.tasks && SOC.dataGen() === HM.gen && (Date.now() - tsCache) < TTL_MS &&
      (SOC.state.role !== 'viewer' || !!HM.self);
  }

  function hmToday() { return SOC.isoDay(new Date()); }

  function hmIsWorking(task) { return task.status !== 'done'; }

  /* ---------- số liệu ---------- */
  function hmStats() {
    var refDay = hmToday();
    var tasks = HM.tasks || [];
    var out = {
      refDay: refDay, open: 0, scanned: 0, pending: 0, extra: 0,
      leavePending: 0, onShift: 0, onLeave: 0, running: []
    };
    tasks.forEach(function (t) {
      if (hmIsWorking(t)) { out.open++; out.running.push(t); }
      if (String(t.date || '').slice(0, 10) !== refDay) return;
      var total = Number(t.total) || 0, sc = Number(t.scanned) || 0, ex = Number(t.extra) || 0;
      out.scanned += sc;
      out.extra += ex;
      out.pending += Math.max(0, total - sc - ex);
    });
    if (HM.leave && HM.leave.ok) out.leavePending = Number(HM.leave.pendingCount) || 0;
    if (HM.sched && HM.sched.ok) {
      var sch = HM.sched.schedule || {};
      Object.keys(sch).forEach(function (id) {
        var code = String(sch[id][refDay] || '');
        if (!code) return;
        var cat = SOC.shiftCategory(code);
        if (cat === 'morning' || cat === 'afternoon' || cat === 'evening') out.onShift++;
        else if (cat === 'leave' || cat === 'holiday') out.onLeave++;
      });
    }
    out.running.sort(function (a, b) { return String(b.taskId).localeCompare(String(a.taskId)); });
    return out;
  }

  /* ---------- việc cần xử lý ---------- */
  function hmTriage(s) {
    var items = [];
    var soon = [];
    if (HM.leave && HM.leave.ok) {
      (HM.leave.rows || []).forEach(function (r) {
        if (r.status !== 'pending') return;
        var d = String(r.dateString || '');
        if (d && d <= hmAddDays(hmToday(), 1)) soon.push(r);
      });
      soon.sort(function (a, b) { return String(a.dateString).localeCompare(String(b.dateString)); });
    }
    if (soon.length) {
      items.push({
        rank: 0, icon: 'alert', id: 'leave',
        title: soon.length + ' đơn nghỉ chờ duyệt trong 24h' + (soon[0] ? ' — sớm nhất ngày ' + SOC.fmtDate(soon[0].dateString) : ''),
        note: 'Vào trang Xin nghỉ để duyệt hoặc từ chối trước ca tới.',
        act: 'goto'
      });
    }
    (HM.tasks || []).forEach(function (t) {
      if (t.status !== 'open') return;
      var total = Number(t.total) || 0;
      var overdue = String(t.date || '').slice(0, 10) < hmToday();
      items.push({
        rank: total ? 2 : 1,
        icon: total ? 'scan' : 'inbox',
        title: 'Task ' + t.taskId + ' đang Mở' + (overdue ? ' — quá giờ chưa bàn giao' : total ? ' nhưng chưa bàn giao' : ' và chưa có danh sách'),
        note: (total ? 'NV quét sau bước bàn giao mới ghi giờ điểm danh — ' : 'Nạp danh sách theo Station/Ca rồi mới quét — ')
          + SOC.esc(t.station || 'chưa rõ station') + ' · ' + SOC.slotCell(t.slotCode),
        act: 'scan', id: t.taskId
      });
    });
    (HM.tasks || []).forEach(function (t) {
      if (t.status !== 'attend') return;
      var total = Number(t.total) || 0, sc = Number(t.scanned) || 0;
      var overdue = String(t.date || '').slice(0, 10) < hmToday();
      items.push({
        rank: 3, icon: 'alert',
        title: 'Task ' + t.taskId + ' đang điểm danh, chưa đóng' + (overdue ? ' — quá giờ' : ''),
        note: 'Đã điểm danh ' + sc + '/' + total + ' · ' + SOC.esc(t.station || '') + ' · ' + SOC.slotCell(t.slotCode),
        act: 'scan', id: t.taskId
      });
    });
    if (HM.leave && HM.leave.ok && s.leavePending && !soon.length) {
      var first = (HM.leave.rows || []).filter(function (r) { return r.status === 'pending'; })
        .sort(function (a, b) { return String(a.dateString).localeCompare(String(b.dateString)); });
      var d = first[0];
      items.push({
        rank: 4, icon: 'leave',
        title: s.leavePending + ' đơn nghỉ chờ duyệt' + (d ? ' — sớm nhất ngày ' + SOC.fmtDate(d.dateString) : ''),
        note: 'Vào trang Xin nghỉ để duyệt hoặc từ chối.',
        act: 'goto', id: 'leave'
      });
    }
    items.sort(function (a, b) { return a.rank - b.rank || String(b.id).localeCompare(String(a.id)); });
    return items.slice(0, 6);
  }

  /* ---------- fetch ---------- */
  function hmOnError(r) {
    if (r && r.message) SOC.toast(r.message, 'err');
  }

  function hmLoad(silent) {
    if (HM.loading) return;
    HM.loading = true;
    var jobs = [SOC.api.getTaskListApi().then(function (rows) {
      if (rows && rows.ok === false) { if (!silent) hmOnError(rows); HM.tasks = HM.tasks || []; return; }
      HM.tasks = Array.prototype.slice.call(rows || []);
    })];
    if (SOC.atLeast('operator')) {
      jobs.push(SOC.api.getLeaveRequestsApi({ month: SOC.isoMonth(new Date()) }).then(function (r) {
        if (!r || !r.ok) { if (!silent && r) hmOnError(r); HM.leave = null; return; }
        HM.leave = r;
      }));
    } else { HM.leave = null; }
    if (SOC.state.canViewSchedule !== false) {
      jobs.push(SOC.api.getScheduleMonthApi(SOC.isoMonth(new Date())).then(function (r) {
        if (!r || !r.ok) { if (!silent && r) hmOnError(r); HM.sched = null; return; }
        HM.sched = r;
      }));
    } else { HM.sched = null; }
    if (SOC.state.role === 'viewer') {
      jobs.push(SOC.api.staffInfoSelfApi().then(function (r) {
        if (!r || !r.ok) { if (!silent && r) hmOnError(r); HM.self = null; return; }
        HM.self = r;
      }));
    } else { HM.self = null; }

    Promise.all(jobs).then(function () {
      HM.loading = false;
      HM.gen = SOC.dataGen();
      tsCache = Date.now();
      if (SOC.state.page === 'home') hmPaint();
    }, function (e) {
      HM.loading = false;
      if (!silent) SOC.toast('Không tải được số liệu trang chủ: ' + e.message, 'err');
      if (SOC.state.page === 'home') hmPaint();
    });
  }

  /* ---------- helper ngày ---------- */
  function hmAddDays(iso, n) {
    var p = iso.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n);
    return d.getFullYear() + '-' + SOC.pad2(d.getMonth() + 1) + '-' + SOC.pad2(d.getDate());
  }

  /* ---------- render ---------- */
  function hmSkRows(n, cells) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var c = [];
      for (var k = 0; k < cells; k++) c.push('<div class="skeleton-cell"></div>');
      out.push('<div class="skeleton-row">' + c.join('') + '</div>');
    }
    return out.join('');
  }

  function hmSkeleton() {
    return '<div class="h-band"><div class="h-band__lead">' +
      '<span class="view-topbar-eyebrow">Ca hôm nay</span>' +
      '<div class="h-band__clock" id="homeClock" role="timer" aria-live="off">--:--:--</div>' +
      '<div class="h-band__date" id="homeDate"></div></div></div>' +
      '<div class="skeleton-wrap" aria-busy="true" aria-label="Đang tải ca">' +
      hmSkRows(3, 6) + '</div>';
  }

  function hmStatCard(label, value, note, tone) {
    return '<div class="stat-card' + (tone ? ' stat-card--' + tone : '') + '">' +
      '<span class="stat-card__label">' + SOC.esc(label) + '</span>' +
      '<span class="stat-card__value">' + value + '</span>' +
      '<span class="stat-card__note">' + note + '</span></div>';
  }

  function hmBand(s) {
    var daily = SOC.atLeast('manager')
      ? '<button type="button" class="btn btn-outline btn-sm" data-act="daily"><span class="btn-label">Điều phối ngày</span>' +
        '<span class="btn-ico">' + SOC.ico('calendar', 16) + '</span></button>'
      : '';
    return '<div class="h-band">' +
      '<div class="h-band__lead">' +
      '<span class="view-topbar-eyebrow">Nhịp thời gian</span>' +
      '<div class="h-band__clock" id="homeClock" role="timer" aria-live="off">--:--:--</div>' +
      '<div class="h-band__date" id="homeDate"></div>' +
      '</div>' +
      '<div class="h-band__facts">' +
      '<span class="pill">' + SOC.esc(SOC.fmtDate(s.refDay)) + '</span>' +
      '<span class="pill">' + s.running.length + ' ca đang chạy</span>' + daily +
      '</div></div>';
  }

  function hmStrip(s) {
    var cards = [
      hmStatCard('Task đang mở', s.open,
        'Chưa bấm Đóng task trong danh sách 30 ngày gần nhất', s.open ? 'warn' : 'ok'),
      hmStatCard('Đã điểm danh hôm nay', s.scanned,
        'Tổng lượt có giờ điểm danh của mọi task ghi ngày ' + SOC.fmtDate(s.refDay), 'ok'),
      hmStatCard('Chưa điểm danh hôm nay', s.pending,
        'Tổng NV trong danh sách nhưng chưa có giờ điểm danh', s.pending ? 'warn' : null),
      hmStatCard('Dư hôm nay', s.extra,
        'NV quét ngoài danh sách được nạp — cần rà lại trước khi đóng ca', s.extra ? 'warn' : null),
      hmStatCard('Đơn nghỉ chờ duyệt', s.leavePending,
        SOC.atLeast('operator') ? 'Trạng thái pending trong tháng này' : 'Cần quyền operator để đọc đơn nghỉ',
        s.leavePending ? 'warn' : null),
      hmStatCard('Người có lịch hôm nay', s.onShift,
        s.onLeave ? 'Ngoài ra ' + s.onLeave + ' người nghỉ phép hoặc nghỉ lễ' : 'Toàn bộ trong diện đi làm', null)
    ];
    return '<div class="stat-strip">' + cards.join('') + '</div>';
  }

  function hmRate(s) {
    var total = 0, sc = 0;
    s.running.forEach(function (t) {
      total += Number(t.total) || 0; sc += Number(t.scanned) || 0;
    });
    if (!total) return '';
    var pct = Math.round(Math.min(total, sc) / total * 100);
    return '<div class="h-rate"><span class="h-rate__label">Tỷ lệ điểm danh toàn bộ ca đang chạy</span>' +
      '<span class="h-rate__bar" role="img" aria-label="Tỷ lệ điểm danh ' + pct + '%"><span class="h-rate__fill" style="width:' + pct + '%"></span></span>' +
      '<b class="h-rate__num num">' + pct + '% · ' + sc + '/' + total + '</b></div>';
  }

  function hmTriageCard(items) {
    var inner;
    if (!items.length) {
      inner = '<div class="empty">Không còn việc tồn đọng trong ca — mọi task đã bàn giao và đóng.</div>';
    } else {
      inner = '<div class="h-triage">' + items.map(function (it) {
        return '<div class="h-triage__item">' +
          '<span class="h-triage__ico" aria-hidden="true">' + SOC.ico(it.icon, 18) + '</span>' +
          '<span class="h-triage__txt"><b>' + SOC.esc(it.title) + '</b>' +
          '<small>' + it.note + '</small></span>' +
          '<span class="h-triage__act"><button type="button" class="btn btn-outline btn-sm" data-act="triage"' +
          ' data-id="' + SOC.esc(it.id) + '" data-kind="' + SOC.esc(it.act) + '">' +
          '<span class="btn-label">Mở</span></button></span>' +
          '</div>';
      }).join('') + '</div>';
    }
    return '<div class="card h-card-triage">' +
      '<div class="card__head"><h2 class="section-heading">' + SOC.ico('inbox', 16) + ' Việc cần xử lý</h2>' +
      '<span class="filter-count">' + items.length + ' mục</span></div>' +
      inner + '</div>';
  }

  function hmRunCard(list) {
    if (!list.length) {
      return '<div class="card"><div class="card__head"><h2 class="section-heading">' +
        SOC.ico('attendance', 16) + ' Ca đang chạy</h2></div>' +
        '<div class="empty">Chưa có task nào mở.<br>Tạo task ở trang <b>Điểm danh</b> rồi nạp danh sách.</div></div>';
    }
    var rows = list.map(function (t) {
      var total = Number(t.total) || 0, sc = Number(t.scanned) || 0, ex = Number(t.extra) || 0;
      var pct = total ? Math.round(Math.min(total, sc) / total * 100) : 0;
      return '<tr>' +
        '<td data-label="Mã task" data-nolabel><b>' + SOC.esc(t.taskId) + '</b></td>' +
        '<td data-label="Station">' + SOC.esc(t.station || '—') + '</td>' +
        '<td data-label="Ca">' + SOC.slotCell(t.slotCode) + '</td>' +
        '<td data-label="Team" data-hide="m">' + SOC.esc(t.team || '—') + '</td>' +
        '<td class="h-cell" data-label="Tiến độ"><span class="num">' + sc + '/' + total +
        (ex ? ' <span class="badge extra">Dư ' + ex + '</span>' : '') + '</span>' +
        '<span class="meter"><span class="meter__fill" style="width:' + pct + '%"></span></span></td>' +
        '<td data-label="Trạng thái" data-nolabel><span class="badge ' + SOC.esc(t.status) + '">' +
        SOC.esc(t.status === 'open' ? 'Mở' : t.status === 'attend' ? 'Điểm danh' : 'Xong') + '</span></td>' +
        '<td data-label="Người tạo" data-hide="m">' + SOC.esc(String(t.createdBy || '').split('@')[0] || '—') + '</td>' +
        '<td data-label="Thao tác" data-nolabel><button type="button" class="btn btn-sm" data-act="triage"' +
        ' data-kind="scan" data-id="' + SOC.esc(t.taskId) + '"><span class="btn-label">Vào quét</span></button></td>' +
        '</tr>';
    }).join('');
    return '<div class="card"><div class="card__head"><h2 class="section-heading">' +
      SOC.ico('attendance', 16) + ' Ca đang chạy</h2>' +
      '<span class="filter-count">' + list.length + ' task chưa đóng</span></div>' +
      '<div class="table-wrap"><table class="table--cards hm-runs"><caption class="sr-only">Các task chưa đóng, sắp theo mã task</caption>' +
      '<thead><tr><th scope="col">Mã task</th><th scope="col">Station</th><th scope="col">Ca</th>' +
      '<th scope="col">Team</th><th scope="col">Tiến độ</th><th scope="col">Trạng thái</th>' +
      '<th scope="col">Người tạo</th><th scope="col">Thao tác</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }

  /* ---------- Viewer: ca của tôi ---------- */
  function hmStaffHero() {
    var d = HM.self;
    if (!d) {
      return '<div class="card h-hero--staff"><div class="card__head"><h2 class="section-heading">' +
        SOC.ico('attendance', 16) + ' Ca của bạn hôm nay</h2></div>' +
        '<div class="empty">Không đọc được hồ sơ của bạn — thử bấm Cập nhật.</div></div>';
    }
    var s = d.staff || {};
    var code = String(d.shiftToday || '');
    var isShift = /^S\d+$/.test(code);
    var att = d.attToday;
    var head;
    if (!isShift) {
      head = '<div class="h-hero__off">' + SOC.slotCell(code || '—') +
        ' — hôm nay bạn không có ca trực' + (att ? ' (vẫn có dòng trong danh sách task)' : '') + '</div>';
    } else if (att && att.status === 'Đã điểm danh') {
      head = '<div class="h-hero__status">' + SOC.badgeStatus('Đã điểm danh') +
        '<span>Có mặt lúc <b class="num">' + SOC.esc(String(att.time || '').slice(0, 5)) + '</b></span></div>';
    } else {
      head = '<div class="h-hero__status">' + SOC.badgeStatus('-') + '<span>Quét mã ở màn Điểm danh để có mặt hôm nay.</span></div>';
    }
    var pos = d.positionToday;
    var posTxt = pos ? SOC.esc((pos.door || '—') + (pos.role ? ' · ' + pos.role : '')) : 'Chưa gán vị trí — xem Điều phối ngày';
    return '<div class="card h-hero--staff">' +
      '<div class="card__head"><h2 class="section-heading">' + SOC.ico('attendance', 16) +
      ' Ca của bạn hôm nay</h2>' + SOC.slotCell(code || '—') + '</div>' +
      '<div class="h-hero__meta">' +
      '<span class="h-hero__kv"><small>Khung giờ</small><b class="num">' + SOC.esc(d.shiftTime || '—') + '</b></span>' +
      '<span class="h-hero__kv"><small>Trạm</small><b>' + SOC.esc(s.station || '—') + '</b></span>' +
      '<span class="h-hero__kv"><small>Đội</small><b>' + SOC.esc(s.team || '—') + '</b></span>' +
      '<span class="h-hero__kv"><small>Vị trí</small><b>' + posTxt + '</b></span>' +
      '</div>' + head +
      '<div class="h-hero__actions">' +
      '<button type="button" class="btn btn-outline" data-act="goto-personal"><span class="btn-label">Xem lịch cá nhân</span>' +
      '<span class="btn-ico">' + SOC.ico('personal', 16) + '</span></button>' +
      '<button type="button" class="btn" data-act="create-leave"><span class="btn-label">Gửi đơn xin nghỉ</span>' +
      '<span class="btn-ico">' + SOC.ico('leave', 16) + '</span></button>' +
      '</div></div>';
  }

  function hmStaffStats() {
    var d = HM.self;
    if (!d) return '';
    var m = d.monthSummary || {};
    var mine = (d.leaveMine || []).length;
    return '<div class="stat-strip h-hero__stats">' +
      hmStatCard('Ngày công T' + hmToday().slice(5, 7), m.workDays || 0,
        'Số ngày có ca trong ma trận lịch tháng của bạn', 'ok') +
      hmStatCard('Giờ làm', Number(m.workHours || 0).toFixed(1),
        'Tổng theo khung giờ ca chuẩn (Valid)', null) +
      hmStatCard('Đơn nghỉ của tôi', mine,
        (m.leaveApproved || 0) + ' đã duyệt · ' + (m.leavePending || 0) + ' đang chờ', m.leavePending ? 'warn' : null) +
      '</div>';
  }

  /* ---------- Operator: bàn làm việc ca trực ---------- */
  function hmWorkbench(s) {
    var list = s.running.filter(function (t) { return t.status === 'open' || t.status === 'attend'; });
    if (!list.length) {
      return '<div class="h-workbench"><div class="card"><div class="card__head"><h2 class="section-heading">' +
        SOC.ico('scan', 16) + ' Bàn làm việc ca trực</h2></div>' +
        '<div class="empty">Không có task nào đang mở hôm nay.<br>Sang <b>Điểm danh</b> để tạo task cho ca tới.</div></div></div>';
    }
    return '<div class="h-workbench"><div class="card__head"><h2 class="section-heading">' +
      SOC.ico('scan', 16) + ' Bàn làm việc ca trực</h2><span class="filter-count">' + list.length + ' task</span></div>' +
      list.map(function (t) {
        var total = Number(t.total) || 0, sc = Number(t.scanned) || 0, ex = Number(t.extra) || 0;
        var pend = Math.max(0, total - sc - Math.max(0, ex));
        var den = Math.max(total, sc + pend + ex) || 1;
        var pct = total ? Math.round(Math.min(total, sc) / total * 100) : 0;
        var SEG = { scanned: 'h-meter__seg--scanned', pending: 'h-meter__seg--pending', extra: 'h-meter__seg--extra' };
        var seg = function (n, mod) {
          return n > 0 ? '<span class="h-meter__seg ' + SEG[mod] + '" style="width:' + (n / den * 100) + '%"></span>' : '';
        };
        return '<div class="card h-task-card">' +
          '<div class="h-task-card__head"><b>' + SOC.esc(t.taskId) + '</b>' +
          '<span class="badge ' + SOC.esc(t.status) + '">' + (t.status === 'open' ? 'Mở' : 'Điểm danh') + '</span></div>' +
          '<div class="h-task-card__meta">' + SOC.esc(t.station || 'chưa rõ station') + ' · ' + SOC.slotCell(t.slotCode) +
          ' · ' + SOC.esc(t.team || '—') + '</div>' +
          (total
            ? '<div class="h-task-card__meter"><span class="h-meter--stacked" role="img" aria-label="Đã điểm danh ' + sc + '/' + total + (ex ? ', dư ' + ex : '') + '">' +
              seg(sc, 'scanned') + seg(pend, 'pending') + seg(ex, 'extra') + '</span>' +
              '<span class="num">' + sc + '/' + total + ' · ' + pct + '%' + (ex ? ' · Dư ' + ex : '') + '</span></div>'
            : '<div class="h-task-card__meta">Chưa có danh sách — nạp theo Ca × hợp đồng rồi mới quét.</div>') +
          '<div class="h-task-card__act">' +
          '<button type="button" class="btn btn-sm" data-act="triage" data-kind="scan" data-id="' + SOC.esc(t.taskId) + '">' +
          '<span class="btn-label">Vào quét ngay</span><span class="btn-ico">' + SOC.ico('scan', 16) + '</span></button>' +
          (!total ? '<button type="button" class="btn btn-outline btn-sm" data-act="quick-roster" data-id="' + SOC.esc(t.taskId) + '">' +
            '<span class="btn-label">Nạp danh sách</span><span class="btn-ico">' + SOC.ico('download', 16) + '</span></button>' : '') +
          '</div></div>';
      }).join('') + '</div>';
  }

  function hmPaint() {
    var sec = document.getElementById('viewHome');
    if (!sec) return;
    var s = hmStats();
    var role = SOC.state.role;

    SOC.pageActions('<button type="button" class="btn btn-outline" data-act="att">' +
      '<span class="btn-label">Điểm danh</span><span class="btn-ico">' + SOC.ico('attendance', 16) + '</span></button>' +
      '<button type="button" class="btn btn-outline" data-act="reload">' +
      '<span class="btn-label">Cập nhật</span><span class="btn-ico">' + SOC.ico('refresh', 16) + '</span></button>');

    if (role === 'viewer') {
      sec.innerHTML = hmBand(s) + hmStaffHero() + hmStaffStats();
    } else if (role === 'operator') {
      sec.innerHTML = hmBand(s) + hmWorkbench(s) + hmTriageCard(hmTriage(s));
    } else {
      sec.innerHTML = hmBand(s) + hmRate(s) + hmStrip(s) +
        '<div class="split split--rev h-main">' + hmTriageCard(hmTriage(s)) + hmRunCard(s.running) + '</div>';
    }

    SOC.setCount('attendance', s.open);
    SOC.setCount('leave', s.leavePending || null);
    hmBind();
  }

  function hmBind() {
    var nodes = document.querySelectorAll('#viewHome [data-act], #pageActions [data-act]');
    Array.prototype.forEach.call(nodes, function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-act');
        if (act === 'reload') { hmLoad(true); return; }
        if (act === 'att') { SOC.selectPage('attendance'); return; }
        if (act === 'daily') { SOC.selectPage('schedule-daily'); return; }
        if (act === 'goto-personal') { SOC.selectPage('schedule-personal'); return; }
        if (act === 'create-leave') { SOC.selectPage('leave'); return; }
        if (act === 'quick-roster') { SOC.openScan(b.getAttribute('data-id'), { roster: true }); return; }
        if (act === 'triage') {
          if (b.getAttribute('data-kind') === 'scan') SOC.openScan(b.getAttribute('data-id'));
          else SOC.selectPage(b.getAttribute('data-id'));
        }
      });
    });
  }

  function hmRender(ctx) {
    var sec = document.getElementById('viewHome');
    if (!sec) return;
    var force = ctx && ctx.force === true;
    if (!HM.tasks || force) {
      sec.innerHTML = hmSkeleton();
      hmLoad(false);
      return;
    }
    hmPaint();
    if (!hmFresh()) hmLoad(true);   /* số liệu đổi ở view khác hoặc đã quá TTL → nạp nền */
  }

  SOC.registerView('home', { section: 'viewHome', render: hmRender });

  /*GHI CHÚ HỢP NHẤT [CHUNG]
    - [CHUNG] SOC.dataGen()/bumpData() đã thay dataset.opsGen, nhưng vẫn là "mọi số liệu đổi là
      nạp lại hết"; cần cơ chế hết hạn theo từng khoá (vd SOC.invalidate('taskList')).
    - [CHUNG] getTaskListApi trả mảng trần trong khi mọi API khác trả {ok:…} → đề nghị api.js
      chuẩn hoá một dạng; hiện các view phải phòng cả hai.
    - [CHUNG] getTaskListApi không có cột "Vắng" nên số "chưa điểm danh" tính = total - scanned - extra.
  */
})();
