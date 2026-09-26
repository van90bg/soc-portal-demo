/* view-schedule-daily.js — "Điều phối ngày": một ngày làm việc, hai góc nhìn —
   tab Ca làm việc (ai làm ca nào) và tab Vị trí (ai đứng cửa nào, vai trò gì).
   [CHUNG] bản đồ tháng đọc qua SOC.schedStore (view-schedule.js là nơi duy nhất gọi
   getScheduleMonthWithPositionApi); phân công tháng bằng getWorkPositionMonthApi;
   làm mới một ngày sau khi lưu bằng getWorkPositionByDateApi; ghi bằng
   saveWorkPositionBatchApi (vai trò rỗng = xóa phân công, server ghi đè cả ngày).
   Ngày đang chọn là MỘT biến dùng chung cho cả hai tab — đổi tab không mất ngữ cảnh,
   không gọi lại API. Quyền: manager+ mới sửa vị trí; ngày đã qua chỉ đọc. */
(function () {
  'use strict';

  var PAGE = 'schedule-daily';
  var SECTION = 'viewScheduleDaily';

  var CAT_RANK = { morning: 0, afternoon: 1, evening: 2, off: 3, holiday: 4, leave: 5 };
  var CAT_TITLE = {
    morning: 'Ca sáng', afternoon: 'Ca chiều', evening: 'Ca tối',
    off: 'Nghỉ tuần', holiday: 'Nghỉ lễ', leave: 'Nghỉ phép · khác'
  };
  /* __PIC__<nhóm>__<stt> -> cửa PIC chuẩn (khớp cách ghi khóa phía server) */
  var PIC_DOOR = { A: 'PIC A', B: 'PIC B', C: 'PIC C', GTC: 'PIC GTC' };
  var TABS = [['shifts', 'Ca làm việc'], ['positions', 'Vị trí']];
  var SHIFT_SCOPES = [['all', 'Tất cả'], ['work', 'Đi làm'], ['rest', 'Nghỉ & phép']];
  var POS_SCOPES = [['all', 'Tất cả'], ['assigned', 'Đã gán'], ['unassigned', 'Chưa gán']];
  var ROLES = ['Scan', 'Matrix', 'GTC+TBS', 'PIC'];
  var ROLE_TEXT = { 'Scan': 'Scan', 'Matrix': 'Matrix', 'GTC+TBS': 'GTC/TBS', 'PIC': 'PIC' };
  var ROLE_RANK = { 'Scan': 0, 'Matrix': 1, 'GTC+TBS': 2, 'PIC': 3, '': 9 };
  var DOORS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C5a', 'C6', 'C7', 'C8', 'C9', 'C10', 'C47', 'C48', 'C49', 'C50'];
  var PIC_DOORS = ['PIC A', 'PIC B', 'PIC C', 'PIC GTC'];
  var PIC_GROUPS = ['A', 'B', 'C', 'GTC'];
  var PIC_GROUP_OF = { 'PIC A': 'A', 'PIC B': 'B', 'PIC C': 'C', 'PIC GTC': 'GTC' };

  /* Tông màu đầu card theo nhóm ca — giữ ở dạng map để tên class đủ, không nối chuỗi rời */
  var CARD_TONE = {
    morning: 'sd-card--morning', afternoon: 'sd-card--afternoon', evening: 'sd-card--evening',
    off: 'sd-card--off', holiday: 'sd-card--holiday', leave: 'sd-card--leave', blank: 'sd-card--blank'
  };

  var SD = {
    tab: 'shifts', date: '', month: '',
    loaded: false, loading: false, gen: null,
    posMonth: null,              // phân công cả tháng (getWorkPositionMonthApi)
    posCache: {},                // dateString -> bản đọc lại riêng của ngày đó
    editing: false, changes: {},  // thay đổi vị trí chưa lưu: empId -> {role, door, orderInDoor}
    shiftScope: 'all', posScope: 'all', q: ''
  };
  var store = null, wired = false, actionsWired = false, qTimer = null;

  /* ---------- helper ---------- */
  function el() { return document.getElementById(SECTION); }
  function today() { return store.todayIso(); }
  function daysOf() { return (store.data && store.data.daysInMonth) || []; }
  function monthVal() { return (store && store.month) || SD.month || ''; }
  function employees() { return (store.data && store.data.employees) || []; }
  function dsToDate(ds) { return new Date(Number(ds.slice(0, 4)), Number(ds.slice(5, 7)) - 1, Number(ds.slice(8, 10))); }
  function dLabel(ds) { return ds ? ds.slice(8, 10) + '/' + ds.slice(5, 7) + '/' + ds.slice(0, 4) : ''; }
  function inMonth(ds) {
    var hit = false;
    daysOf().forEach(function (x) { if (x.dateString === ds) hit = true; });
    return hit;
  }
  function numOf(code) { var n = parseInt(String(code).replace(/\D/g, ''), 10); return isNaN(n) ? 99 : n; }
  function isWork(code) { return store.isWork(code); }
  function shiftOf(empId) { return String(store.shiftOf(empId, SD.date) || ''); }
  function hitQ(name, id) {
    var q = SD.q.trim().toLowerCase();
    if (!q) return true;
    return String(name || '').toLowerCase().indexOf(q) >= 0 || String(id || '').toLowerCase().indexOf(q) >= 0;
  }

  /* ---------- dữ liệu vị trí ---------- */
  /* Bản đọc lại theo ngày (sau khi lưu) thắng bản tháng; thiếu cả hai thì lấy từ payload lịch. */
  function posRaw(ds) {
    if (SD.posCache[ds]) return SD.posCache[ds];
    if (SD.posMonth && SD.posMonth[ds]) return SD.posMonth[ds];
    return ((store.data && store.data.positions) || {})[ds] || null;
  }

  /* Vị trí của ngày theo dạng đọc hiểu: empId -> 'Scan · C4 #2'. */
  function posIndex(ds) {
    var src = posRaw(ds) || {}, idx = {};
    Object.keys(src).forEach(function (k) {
      var p = src[k] || {};
      var g = /^__PIC__([A-Za-z]+)__(\d+)$/.exec(k);
      var id = String(p.empId || k);
      var txt = [p.role || '', p.door || (g && PIC_DOOR[g[1].toUpperCase()]) || ''].filter(Boolean).join(' · ');
      if (!txt) return;
      var cell = idx[id] || (idx[id] = []);
      var v = txt + (p.orderInDoor ? ' #' + p.orderInDoor : '');
      if (cell.indexOf(v) < 0) cell.push(v);
    });
    return idx;
  }

  /* Bản ghi gốc của ngày: empId -> {role, door, orderInDoor} — KHÔNG suy diễn,
     vì đây là mốc so sánh để biết dòng nào thực sự đổi trước khi lưu. */
  function posByEmp(ds) {
    var src = posRaw(ds) || {}, out = {};
    Object.keys(src).forEach(function (k) {
      var rec = src[k] || {};
      var virtual = k.indexOf('__PIC__') === 0;
      var empId = String(virtual ? (rec.empId || '') : k).trim();
      if (!empId || out[empId]) return;
      out[empId] = {
        role: String(rec.role || '').trim(),
        door: String(rec.door || '').trim(),
        orderInDoor: Number(rec.orderInDoor) || 1
      };
    });
    return out;
  }

  /* ---------- tab Ca làm việc: dữ liệu ---------- */
  function sdGroups() {
    var idx = posIndex(SD.date), map = {};
    employees().forEach(function (e) {
      var code = shiftOf(e.id);
      var work = isWork(code);
      if (SD.shiftScope === 'work' && !work) return;
      if (SD.shiftScope === 'rest' && (work || !code)) return;
      if (!hitQ(e.name, e.id)) return;
      (map[code] || (map[code] = [])).push({ emp: e, pos: idx[String(e.id)] || null });
    });
    return Object.keys(map).map(function (code) {
      return {
        code: code,
        cat: code ? SOC.shiftCategory(code) : 'blank',
        rows: map[code].sort(function (a, b) { return String(a.emp.name).localeCompare(String(b.emp.name), 'vi'); })
      };
    }).sort(function (a, b) {
      if (a.code === '' || b.code === '') return a.code === '' ? 1 : (b.code === '' ? -1 : 0);
      var ra = CAT_RANK[a.cat], rb = CAT_RANK[b.cat];
      if (ra !== rb) return ra - rb;
      return numOf(a.code) - numOf(b.code) || (a.code < b.code ? -1 : 1);
    });
  }

  function sdTally() {
    var t = { work: 0, leave: 0, rest: 0, blank: 0, total: 0 };
    employees().forEach(function (e) {
      t.total++;
      var code = shiftOf(e.id);
      if (!code) t.blank++;
      else if (isWork(code)) t.work++;
      else if (SOC.shiftCategory(code) === 'leave') t.leave++;
      else t.rest++;
    });
    return t;
  }

  function sdDayCounts() {
    var out = {}, emps = employees();
    daysOf().forEach(function (x) {
      var n = 0;
      emps.forEach(function (e) { if (isWork(store.shiftOf(e.id, x.dateString))) n++; });
      out[x.dateString] = n;
    });
    return out;
  }

  function sdDayLabel() {
    if (!SD.date) return '—';
    var row = null;
    daysOf().forEach(function (d) { if (d.dateString === SD.date) row = d; });
    return SOC.fmtDate(dsToDate(SD.date)) + (row ? ' · ' + row.dayOfWeek : '') + (today() === SD.date ? ' · hôm nay' : '');
  }

  /* Cửa PIC nằm trong KHÓA của dòng ảo, không nằm trong bản ghi → chỉ dùng để hiển thị. */
  function picDoorOf(ds, empId) {
    var src = posRaw(ds) || {}, hit = '';
    Object.keys(src).forEach(function (k) {
      if (hit || k.indexOf('__PIC__') !== 0) return;
      if (String((src[k] || {}).empId || '') !== String(empId)) return;
      var g = /^__PIC__([A-Za-z]+)__(\d+)$/.exec(k);
      if (g) hit = PIC_DOOR[g[1].toUpperCase()] || '';
    });
    return hit;
  }

  /* ---------- khung màn hình: shell + dải ngày + tab ---------- */
  function sdStatCard(label, value, note, kind) {
    return '<div class="stat-card' + (kind ? ' stat-card--' + kind : '') + '">' +
      '<span class="stat-card__label">' + SOC.esc(label) + '</span>' +
      '<span class="stat-card__value">' + SOC.esc(value) + '</span>' +
      '<span class="stat-card__note">' + SOC.esc(note) + '</span></div>';
  }

  function sdStatsHtml() {
    var t = sdTally();
    return '<div class="stat-strip" id="sdStats">' +
      sdStatCard('Đi làm', t.work, 'trong ' + t.total + ' người của tháng', t.work ? 'ok' : '') +
      sdStatCard('Nghỉ phép', t.leave, 'phép · ốm · không lương', t.leave ? 'warn' : '') +
      sdStatCard('Nghỉ · OFF · lễ', t.rest, 'không phân công ca') +
      sdStatCard('Chưa phân công', t.blank, 'ô lịch trống hoặc thiếu mã', t.blank ? 'err' : '') +
      '</div>';
  }

  function sdStripHtml() {
    var t = today(), counts = sdDayCounts();
    return daysOf().map(function (x) {
      var on = x.dateString === SD.date;
      var cls = 'day-pill' + (on ? ' on' : '') + (x.dateString === t ? ' today' : '') + (x.isWeekend ? ' weekend' : '');
      return '<button type="button" class="' + cls + '" data-sd-day="' + SOC.esc(x.dateString) + '"' +
        (on ? ' aria-current="date"' : '') + ' aria-label="Ngày ' + SOC.esc(x.date) + ' ' + SOC.esc(x.dayOfWeek) +
        ', ' + (counts[x.dateString] || 0) + ' người đi làm">' +
        '<span class="sd-pill__w">' + SOC.esc(x.dayOfWeek) + '</span>' +
        '<span class="sd-pill__d">' + SOC.esc(x.date) + '</span>' +
        '<small>' + (counts[x.dateString] || 0) + '</small></button>';
    }).join('');
  }

  function sdScopeHtml() {
    var pos = SD.tab === 'positions';
    var list = pos ? POS_SCOPES : SHIFT_SCOPES;
    var cur = pos ? SD.posScope : SD.shiftScope;
    var attr = pos ? 'data-sd-posscope' : 'data-sd-scope';
    return '<div class="seg" role="group" aria-label="Lọc theo phạm vi">' + list.map(function (s) {
      return '<button type="button" class="seg__btn' + (cur === s[0] ? ' on' : '') + '" ' + attr + '="' + s[0] +
        '" aria-pressed="' + (cur === s[0] ? 'true' : 'false') + '">' + SOC.esc(s[1]) + '</button>';
    }).join('') + '</div>';
  }

  function sdTabsHtml() {
    return '<div class="seg" role="group" aria-label="Chế độ xem">' + TABS.map(function (t) {
      return '<button type="button" class="seg__btn' + (SD.tab === t[0] ? ' on' : '') + '" data-sd-tab="' + t[0] +
        '" aria-pressed="' + (SD.tab === t[0] ? 'true' : 'false') + '">' + SOC.esc(t[1]) + '</button>';
    }).join('') + '</div>';
  }

  function sdCountText() {
    if (SD.tab === 'positions') {
      var byEmp = posByEmp(SD.date), work = 0;
      employees().forEach(function (e) { if (byEmp[String(e.id)] || isWork(shiftOf(e.id))) work++; });
      return Object.keys(byEmp).length + '/' + work + ' người đã gán';
    }
    return sdTally().work + ' người đi làm';
  }

  function sdBarHtml() {
    var ym = SOC.monthLabel(monthVal());
    return '<div class="card card--fit sd-bar">' +
      '<div class="card__head">' +
        '<h2 class="section-heading">' + SOC.ico('calendar', 16) + '<span>' + SOC.esc(ym) + '</span></h2>' +
        '<span class="pill" id="sdCount" role="status">' + SOC.esc(sdCountText()) + '</span>' +
        '<div class="stepper sd-daynav">' + SOC.navArrow('prevday', 'Ngày trước', false, 'data-sd-act') +
        '<span class="sd-daynav__label" id="sdDayLabel">' + SOC.esc(sdDayLabel()) + '</span>' +
        SOC.navArrow('nextday', 'Ngày sau', true, 'data-sd-act') + '</div>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-sd-act="today" title="Về ngày hôm nay">' +
        '<span class="btn-label">Hôm nay</span></button>' +
      '</div>' +
      '<div class="sd-strip" id="sdStrip" role="group" aria-label="Chọn ngày trong ' + SOC.esc(ym) + '">' +
      sdStripHtml() + '</div>' +
      '<div class="card__foot sd-tabs">' + sdTabsHtml() + sdScopeHtml() +
        '<div class="list-search" role="search">' +
        '<input type="search" id="sdQ" data-sd-q placeholder="Tìm tên hoặc mã OPS…" autocomplete="off" spellcheck="false"' +
        ' aria-label="Tìm nhân sự trong ngày" value="' + SOC.esc(SD.q) + '">' +
        '<button type="button" class="btn-icon" data-sd-act="clearq" aria-label="Xóa từ khóa" title="Xóa từ khóa">' +
        SOC.ico('close', 16) + '</button></div>' +
      '</div></div>';
  }

  /* ---------- tab Ca làm việc: markup ---------- */
  function sdEmpRow(r) {
    var e = r.emp, st = store.meta(e.id) || {}, pos = r.pos ? r.pos.join(' / ') : '';
    return '<tr>' +
      '<td><button type="button" class="sd-emp" data-sd-open="' + SOC.esc(e.id) + '" title="Xem lịch cá nhân">' +
      SOC.esc(e.name) + '</button></td>' +
      '<td class="num">' + SOC.esc(e.id) + '</td>' +
      '<td>' + SOC.esc(st.station || e.title || '—') + '</td>' +
      '<td>' + SOC.esc(st.team || '—') + '</td>' +
      '<td title="' + SOC.esc(pos || 'Chưa có vị trí phân công') + '">' + SOC.esc(pos || '—') + '</td></tr>';
  }

  function sdShiftCard(g) {
    var title = g.code ? (CAT_TITLE[g.cat] || 'Ca') : 'Chưa phân công';
    return '<div class="card card--fit sd-card ' + (CARD_TONE[g.cat] || '') + '">' +
      '<div class="card__head sd-card__head">' + SOC.badgeShift(g.code) +
      '<b class="sd-card__title">' + SOC.esc(title) + '</b>' +
      '<span class="pill">' + g.rows.length + ' người</span></div>' +
      '<div class="table-wrap sd-card__body" tabindex="0" role="region" aria-label="Bảng điều phối ngày"><table class="sd-t">' +
      '<caption class="sr-only">Người làm ' + (g.code ? 'ca ' + SOC.esc(g.code) : 'chưa phân công ca') +
      ' ngày ' + SOC.esc(dLabel(SD.date)) + '</caption>' +
      '<thead><tr><th scope="col">Họ tên</th><th scope="col" class="num">Mã OPS</th>' +
      '<th scope="col">Station</th><th scope="col">Team</th><th scope="col">Vị trí</th></tr></thead>' +
      '<tbody>' + g.rows.map(sdEmpRow).join('') + '</tbody></table></div></div>';
  }

  function sdGroupsHtml() {
    var list = sdGroups();
    if (!list.length) {
      return '<div class="card"><div class="empty"><b>Không có ai trong ngày này</b>' +
        (SD.q ? ' khớp “' + SOC.esc(SD.q) + '” — thử từ khóa khác.' :
          (SD.shiftScope !== 'all' ? ' — thử đổi phạm vi lọc.' : ' — ngày chưa có lịch.')) + '</div></div>';
    }
    return list.map(sdShiftCard).join('');
  }

  /* ---------- tab Vị trí: dữ liệu ---------- */
  /* Danh sách nhân sự đã "chạm" tới vị trí: người được gán, hoặc người có ca làm trong ngày. */
  function sdPosPeople(byEmp) {
    return employees().map(function (e) {
      var id = String(e.id || '').trim();
      return {
        empId: id, name: e.name || id,
        shift: shiftOf(id).toUpperCase(),
        assigned: !!byEmp[id]
      };
    });
  }

  function sdPosVisible(people, byEmp) {
    return people.filter(function (p) {
      if (!p.assigned && !isWork(p.shift)) return false;
      if (SD.posScope === 'assigned' && !p.assigned) return false;
      if (SD.posScope === 'unassigned' && p.assigned) return false;
      return hitQ(p.name, p.empId);
    });
  }

  /* Giá trị hiệu lực = thay đổi chưa lưu (nếu có) → bản ghi server */
  function sdEff(empId, byEmp) {
    if (Object.prototype.hasOwnProperty.call(SD.changes, empId)) return SD.changes[empId];
    var o = byEmp[empId];
    return o ? { role: o.role, door: o.door, orderInDoor: o.orderInDoor } : null;
  }

  function sdSame(a, b) {
    var ra = (a && a.role) || '', rb = (b && b.role) || '';
    if (ra !== rb) return false;
    if (!ra) return true;
    return String(a.door || '') === String(b.door || '') &&
      (Number(a.orderInDoor) || 1) === (Number(b.orderInDoor) || 1);
  }

  function sdSetChange(empId, next, byEmp) {
    var rec = { role: next.role || '', door: next.door || '', orderInDoor: Number(next.orderInDoor) || 1 };
    if (sdSame(rec, byEmp[empId] || { role: '' })) delete SD.changes[empId];
    else SD.changes[empId] = rec;
  }

  /* Diff trên TOÀN BỘ nhân sự (không theo phạm vi đang xem) — đổi bộ lọc không làm mất thay đổi đang dở */
  function sdDirty(people, byEmp) {
    var out = [];
    people.forEach(function (p) {
      if (!p.assigned && !isWork(p.shift)) return;
      var eff = sdEff(p.empId, byEmp);
      if (sdSame(eff, byEmp[p.empId] || { role: '' })) return;
      out.push({
        empId: p.empId, empName: p.name,
        role: (eff && eff.role) || '',
        door: (eff && eff.role) ? (eff.door || '') : '',
        orderInDoor: (eff && eff.role) ? (Number(eff.orderInDoor) || 1) : 1
      });
    });
    return out;
  }

  function sdCountByRole(people, byEmp) {
    var c = { 'Scan': 0, 'Matrix': 0, 'GTC+TBS': 0, 'PIC': 0 }, total = 0;
    people.forEach(function (p) {
      var eff = sdEff(p.empId, byEmp);
      if (!eff || !eff.role) return;
      if (c[eff.role] === undefined) c[eff.role] = 0;
      c[eff.role]++; total++;
    });
    return { c: c, total: total };
  }

  /* Cảnh báo khớp giới hạn suất của sheet WorkPosition (posDoorLimits) + luật 1 PIC mỗi nhóm */
  function sdDoorLimits(door) {
    if (door === 'C47' || door === 'C48' || door === 'C49' || door === 'C50') return { scan: 2, matrix: 0 };
    if (door === 'C1' || door === 'C10' || door === 'C5a') return { scan: 2, matrix: 1 };
    return { scan: 1, matrix: 1 };
  }

  function sdWarnings(people, byEmp) {
    var warn = [], picGroup = {}, doorScan = {}, doorMatrix = {}, doors = {}, unassigned = 0;
    people.forEach(function (p) {
      if (!p.assigned && !isWork(p.shift)) return;
      var eff = sdEff(p.empId, byEmp);
      if (!eff || !eff.role) { unassigned++; return; }
      if (eff.role === 'PIC') {
        var g = PIC_GROUP_OF[eff.door];
        if (g) picGroup[g] = (picGroup[g] || 0) + 1;
        return;
      }
      if (eff.role === 'GTC+TBS') return;
      var d = eff.door || '—';
      doors[d] = 1;
      if (eff.role === 'Scan') doorScan[d] = (doorScan[d] || 0) + 1;
      if (eff.role === 'Matrix') doorMatrix[d] = (doorMatrix[d] || 0) + 1;
    });
    var emptyPic = PIC_GROUPS.filter(function (g) { return !picGroup[g]; });
    if (emptyPic.length) warn.push({ kind: 'warn', text: 'Chưa có PIC cho nhóm: ' + emptyPic.join(' · ') });
    Object.keys(doors).forEach(function (d) {
      var lim = sdDoorLimits(d);
      if ((doorScan[d] || 0) > lim.scan) warn.push({ kind: 'err', text: 'Cửa ' + d + ' vượt suất Scan (' + doorScan[d] + '/' + lim.scan + ')' });
      if ((doorMatrix[d] || 0) > lim.matrix) warn.push({ kind: 'err', text: 'Cửa ' + d + ' vượt suất Matrix (' + doorMatrix[d] + '/' + lim.matrix + ')' });
    });
    Object.keys(picGroup).forEach(function (g) {
      if (picGroup[g] > 1) warn.push({ kind: 'err', text: 'PIC nhóm ' + g + ' có ' + picGroup[g] + ' người (tối đa 1)' });
    });
    if (unassigned) warn.push({ kind: 'info', text: unassigned + ' người đi làm chưa gán vị trí' });
    return warn;
  }

  function sdShiftsHtml() {
    return sdStatsHtml() + '<div class="sd-groups" id="sdGroups">' + sdGroupsHtml() + '</div>';
  }

  /* ---------- tab Vị trí: markup ---------- */
  function sdRoleSelect(p, eff) {
    var cur = (eff && eff.role) || '';
    var opts = ['<option value="">— chưa gán —</option>'].concat(ROLES.map(function (r) {
      return '<option value="' + SOC.esc(r) + '"' + (r === cur ? ' selected' : '') + '>' + SOC.esc(ROLE_TEXT[r]) + '</option>';
    }));
    return '<select data-sd-field="role" data-sd-emp="' + SOC.esc(p.empId) + '" aria-label="Vai trò của ' + SOC.esc(p.name) + '">' +
      opts.join('') + '</select>';
  }

  function sdDoorSelect(p, eff) {
    var role = (eff && eff.role) || '';
    var cur = (eff && eff.door) || '';
    if (!role) return '<span class="c-empty">—</span>';
    if (role === 'GTC+TBS') return '<span class="c-empty">không cần cửa</span>';
    var list = role === 'PIC' ? PIC_DOORS : DOORS;
    var opts = ['<option value="">— chọn —</option>'].concat(list.map(function (d) {
      return '<option value="' + SOC.esc(d) + '"' + (d === cur ? ' selected' : '') + '>' + SOC.esc(d) + '</option>';
    }));
    return '<select data-sd-field="door" data-sd-emp="' + SOC.esc(p.empId) + '" aria-label="Cửa của ' + SOC.esc(p.name) + '">' +
      opts.join('') + '</select>';
  }

  function sdOrderInput(p, eff) {
    var role = (eff && eff.role) || '';
    if (!role) return '<span class="c-empty">—</span>';
    if (role === 'PIC' || role === 'GTC+TBS') return '<span class="c-empty">—</span>';
    return '<input type="number" class="sd-pos-order" min="1" max="9" value="' + (Number(eff.orderInDoor) || 1) +
      '" data-sd-field="order" data-sd-emp="' + SOC.esc(p.empId) + '" aria-label="Thứ tự trong cửa của ' + SOC.esc(p.name) + '">';
  }

  function sdPosCells(p, eff, editable) {
    var shift = p.shift ? SOC.badgeShift(p.shift) : '<span class="c-empty">chưa có ca</span>';
    var doorShown = eff && eff.role ? (eff.door || picDoorOf(SD.date, p.empId) || '—') : '—';
    var roleHtml = editable ? sdRoleSelect(p, eff) : ((eff && eff.role) ?
      '<span class="pill sd-pos-role">' + SOC.esc(ROLE_TEXT[eff.role] || eff.role) + '</span>' :
      '<span class="c-empty">— chưa gán —</span>');
    var doorHtml = editable ? sdDoorSelect(p, eff) : (eff && eff.role ? SOC.esc(doorShown) : '<span class="c-empty">—</span>');
    var orderHtml = editable ? sdOrderInput(p, eff) : ((eff && eff.role) ?
      '<span class="num">' + (Number(eff.orderInDoor) || 1) + '</span>' : '<span class="c-empty">—</span>');
    return '<td><span class="sd-pos-person"><span class="avatar" aria-hidden="true">' + SOC.esc(SOC.initials(p.name)) + '</span>' +
      '<span class="sd-pos-person__name">' + SOC.esc(p.name) + '</span></span></td>' +
      '<td class="num">' + SOC.esc(p.empId) + '</td>' +
      '<td class="c">' + shift + '</td>' +
      '<td>' + roleHtml + '</td>' +
      '<td>' + doorHtml + '</td>' +
      '<td class="num">' + orderHtml + '</td>';
  }

  function sdPosRowHtml(p, byEmp, editable) {
    var eff = sdEff(p.empId, byEmp);
    var dirty = !sdSame(eff, byEmp[p.empId] || { role: '' });
    var cls = 'sd-pos-row' + (p.assigned || (eff && eff.role) ? '' : ' sd-pos-row--new') + (dirty ? ' is-active' : '');
    return '<tr class="' + cls + '" data-sd-emp="' + SOC.esc(p.empId) + '">' + sdPosCells(p, eff, editable) + '</tr>';
  }

  function sdPosTableCard(people, visible, byEmp, editable) {
    var rows = visible.map(function (p) { return sdPosRowHtml(p, byEmp, editable); }).join('');
    var total = people.filter(function (p) { return p.assigned || isWork(p.shift); }).length;
    return '<div class="card">' +
      '<div class="card__head">' +
        '<h2 class="section-heading">' + SOC.ico('position', 16) + '<span>Phân công ngày ' + SOC.esc(dLabel(SD.date)) + '</span></h2>' +
        '<span class="pill" role="status">' + visible.length + '/' + total + ' người</span>' +
      '</div>' +
      '<div class="table-wrap" tabindex="0" role="region" aria-label="Bảng phân công vị trí"><table class="sd-pos-table">' +
        '<caption class="sr-only">Vị trí làm việc ngày ' + SOC.esc(dLabel(SD.date)) + ' — vai trò, cửa và thứ tự trong cửa của từng nhân viên</caption>' +
        '<thead><tr><th scope="col">Họ tên</th><th scope="col">Mã OPS</th><th scope="col" class="c">Ca</th>' +
        '<th scope="col">Vai trò</th><th scope="col">Cửa</th><th scope="col" class="num">Thứ tự trong cửa</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="6"><div class="empty">Không có ai trong phạm vi này</div></td></tr>') + '</tbody>' +
      '</table></div>' +
      (editable ? '<div class="card__foot">Đang bật chế độ sửa — đổi Vai trò/Cửa/Thứ tự rồi bấm Lưu. Chọn “— chưa gán —” để xóa vị trí.</div>' : '') +
    '</div>';
  }

  function sdPosSide(people, byEmp) {
    var st = sdCountByRole(people, byEmp);
    var roleRows = ROLES.map(function (r) {
      return '<div class="sd-pos-stat"><span class="sd-pos-stat__k">' + SOC.esc(ROLE_TEXT[r]) + '</span>' +
        '<span class="meter" aria-hidden="true"><span class="meter__fill" style="width:' +
        (st.total ? Math.round((st.c[r] || 0) / st.total * 100) : 0) + '%"></span></span>' +
        '<span class="sd-pos-stat__n num">' + (st.c[r] || 0) + '</span></div>';
    }).join('');
    var warns = sdWarnings(people, byEmp);
    var warnHtml = warns.length ? warns.map(function (w) {
      return '<li class="sd-pos-warn sd-pos-warn--' + w.kind + '">' + SOC.ico('alert', 14) + '<span>' + SOC.esc(w.text) + '</span></li>';
    }).join('') : '<li class="sd-pos-warn sd-pos-warn--ok">' + SOC.ico('check', 14) + '<span>Không có cảnh báo nào</span></li>';
    return '<div class="split__side">' +
      '<div class="card card--fit">' +
        '<div class="card__head"><h2 class="section-heading">' + SOC.ico('stats', 16) + '<span>Phân bổ vai trò</span></h2></div>' +
        '<div class="pane sd-pos-stats">' + roleRows + '</div>' +
      '</div>' +
      '<div class="card card--fit">' +
        '<div class="card__head"><h2 class="section-heading">' + SOC.ico('inbox', 16) + '<span>Cảnh báo</span></h2></div>' +
        '<ul class="pane sd-pos-warns">' + warnHtml + '</ul>' +
      '</div>' +
    '</div>';
  }

  function sdPosHtml() {
    var byEmp = posByEmp(SD.date);
    var people = sdPosPeople(byEmp);
    var visible = sdPosVisible(people, byEmp).sort(function (a, b) {
      var ea = sdEff(a.empId, byEmp), eb = sdEff(b.empId, byEmp);
      var ra = (ea && ea.role) ? 0 : 1, rb = (eb && eb.role) ? 0 : 1;
      if (ra !== rb) return ra - rb;
      if (ra === 0) {
        var d = (ROLE_RANK[ea.role] || 9) - (ROLE_RANK[eb.role] || 9);
        if (d) return d;
        d = String(ea.door || '').localeCompare(String(eb.door || ''));
        if (d) return d;
        d = (Number(ea.orderInDoor) || 1) - (Number(eb.orderInDoor) || 1);
        if (d) return d;
      }
      return String(a.name).localeCompare(String(b.name), 'vi');
    });
    var editable = SD.editing && SOC.atLeast('manager') && SD.date >= today();
    return '<div class="split">' +
      sdPosTableCard(people, visible, byEmp, editable) +
      sdPosSide(people, byEmp) + '</div>';
  }

  function sdBodyHtml() {
    return '<div class="sd-body" id="sdBody">' +
      (SD.tab === 'positions' ? sdPosHtml() : sdShiftsHtml()) + '</div>';
  }

  /* ---------- hành động đầu trang ---------- */
  function sdActions() {
    var acts = SOC.monthNav(SD.month, { onPick: sdGotoMonth });
    if (SD.tab === 'positions') {
      if (SOC.atLeast('manager')) {
        acts += '<button type="button" class="btn btn-outline" data-sd-act="edit" aria-pressed="' + (SD.editing ? 'true' : 'false') + '"' +
          ' title="Bật/tắt chế độ sửa vị trí"><span class="btn-label">Sửa</span>' + SOC.ico('edit', 16) + '</button>';
      }
      acts += '<button type="button" class="btn btn-outline" data-sd-act="reload" title="Tải lại lịch và vị trí">' +
        '<span class="btn-label">Cập nhật</span>' + SOC.ico('refresh', 16) + '</button>';
      var byEmp = posByEmp(SD.date);
      var dirty = sdDirty(sdPosPeople(byEmp), byEmp);
      if (dirty.length) {
        acts += '<span class="info-dirty-note" role="status">' + dirty.length + ' thay đổi chưa lưu</span>' +
          '<button type="button" class="btn btn-ghost" data-sd-act="drop"><span class="btn-label">Bỏ thay đổi</span>' +
          SOC.ico('close', 16) + '</button>' +
          '<button type="button" class="btn" data-sd-act="save"><span class="btn-label">Lưu</span>' + SOC.ico('check', 16) + '</button>';
      }
    } else {
      acts += '<button type="button" class="btn btn-outline" data-sd-act="matrix" title="Mở ma trận lịch tháng">' +
        '<span class="btn-label">Xem lịch tháng</span>' + SOC.ico('schedule', 16) + '</button>' +
        '<button type="button" class="btn btn-outline" data-sd-act="reload" title="Tải lại lịch và vị trí">' +
        '<span class="btn-label">Cập nhật</span>' + SOC.ico('refresh', 16) + '</button>';
    }
    SOC.pageActions(acts);
  }

  /* ---------- vẽ ---------- */
  function sdSkeleton() {
    var sec = el();
    if (!sec) return;
    var pills = '', rows = '', cells, i, k;
    for (i = 0; i < 16; i++) pills += '<div class="skeleton-cell"></div>';
    for (i = 0; i < 4; i++) {
      cells = '';
      for (k = 0; k < 5; k++) cells += '<div class="skeleton-cell"></div>';
      rows += '<div class="skeleton-row">' + cells + '</div>';
    }
    sec.innerHTML = '<div class="card card--fit sd-bar"><div class="sd-strip">' + pills + '</div></div>' +
      '<div class="card"><div class="skeleton-wrap" aria-busy="true" aria-label="Đang tải lịch ngày">' + rows + '</div></div>';
    SOC.pageActions('');
  }

  function sdPaint() {
    var sec = el();
    if (!sec || !SD.loaded) return;
    sdActions();
    sec.innerHTML = sdBarHtml() + sdBodyHtml();
    SOC.setCount(PAGE, sdTally().work);
  }

  /* Thân tab: dựng lại tại chỗ — giữ focus ô tìm kiếm và vị trí cuộn của dải ngày */
  function sdFillBody() {
    var host = document.getElementById('sdBody');
    if (!host) { sdPaint(); return; }
    host.innerHTML = SD.tab === 'positions' ? sdPosHtml() : sdShiftsHtml();
    var c = document.getElementById('sdCount');
    if (c) c.textContent = sdCountText();
  }

  function sdFillDay() {
    var strip = document.getElementById('sdStrip');
    if (strip) {
      var left = strip.scrollLeft;
      strip.innerHTML = sdStripHtml();
      strip.scrollLeft = left;
    }
    var lbl = document.getElementById('sdDayLabel');
    if (lbl) lbl.textContent = sdDayLabel();
    var stats = document.getElementById('sdStats');
    if (stats) stats.outerHTML = sdStatsHtml();
    sdFillBody();
    SOC.setCount(PAGE, sdTally().work);
  }

  /* Chỉ vẽ lại đúng dòng vừa sửa — dựng cả bảng sẽ làm mất focus của select đang chọn */
  function sdPatchRow(empId, byEmp) {
    var sec = el();
    var tr = sec && sec.querySelector('tr.sd-pos-row[data-sd-emp="' + empId + '"]');
    if (!tr) return;
    var people = sdPosPeople(byEmp), p = null;
    for (var i = 0; i < people.length; i++) if (people[i].empId === empId) { p = people[i]; break; }
    if (!p) return;
    var editable = SD.editing && SOC.atLeast('manager') && SD.date >= today();
    tr.innerHTML = sdPosCells(p, sdEff(empId, byEmp), editable);
    tr.classList.toggle('is-active', !sdSame(sdEff(empId, byEmp), byEmp[empId] || { role: '' }));
  }

  function sdPatchSide(byEmp) {
    var sec = el();
    var side = sec && sec.querySelector('.split__side');
    var people = sdPosPeople(byEmp);
    if (side) side.outerHTML = sdPosSide(people, byEmp);
    sdActions();
  }

  /* ---------- điều hướng ngày / tháng ---------- */
  function sdPrepare() {
    if (!SD.month) SD.month = store.month || store.currentMonth();
    if (!inMonth(SD.date)) {
      var t = today();
      SD.date = inMonth(t) ? t : String((daysOf()[0] || {}).dateString || '');
    }
  }

  /* Đổi tháng: dựng lại từ đầu, bỏ mọi thứ đang dở của tháng cũ */
  function sdLoadMonth(m, ds) {
    SD.month = m;
    SD.date = ds || (m + '-01');
    SD.changes = {};
    SD.editing = false;
    SD.posCache = {};
    SD.posMonth = null;
    SD.loaded = false;
    sdSkeleton();
    sdFetch(true);
  }

  function sdGotoMonth(m) {
    if (!/^\d{4}-\d{2}$/.test(String(m || '')) || m === SD.month) return;
    sdLoadMonth(m);
  }

  function sdStepDay(delta) {
    var list = daysOf(), at = -1;
    list.forEach(function (x, i) { if (x.dateString === SD.date) at = i; });
    var next = list[at + delta];
    if (!next) { SOC.toast(delta > 0 ? 'Đã là ngày cuối của tháng' : 'Đã là ngày đầu của tháng', 'err'); return; }
    sdSetDate(next.dateString);
  }

  function sdGoToday() {
    var t = today();
    if (t.slice(0, 7) !== SD.month) { sdLoadMonth(t.slice(0, 7), t); return; }
    sdSetDate(t);
  }

  /* Ngày là ngữ cảnh chung của hai tab — thay đổi chưa lưu phải hỏi trước khi rời */
  function sdSetDate(ds) {
    if (!ds || ds === SD.date) return;
    if (Object.keys(SD.changes).length) {
      SOC.confirm({
        title: 'Bỏ thay đổi vị trí chưa lưu?',
        message: 'Chuyển sang ngày ' + dLabel(ds) + ' sẽ bỏ ' + Object.keys(SD.changes).length +
          ' thay đổi chưa lưu. Tiếp tục?',
        okLabel: 'Bỏ và chuyển ngày'
      }).then(function (ok) {
        if (!ok) return;
        SD.changes = {};
        SD.date = ds;
        sdActions();
        sdFillDay();
      });
      return;
    }
    SD.date = ds;
    sdActions();
    sdFillDay();
  }

  function sdSetTab(tab) {
    if (tab !== 'shifts' && tab !== 'positions') return;
    if (tab === SD.tab) return;
    SD.tab = tab;
    sdPaint();
  }

  /* ---------- lưu vị trí ---------- */
  function sdSave(btn) {
    var byEmp = posByEmp(SD.date);
    var changes = sdDirty(sdPosPeople(byEmp), byEmp);
    if (!changes.length) { SOC.toast('Không có thay đổi để lưu'); return; }
    SOC.confirm({
      title: 'Lưu vị trí ngày ' + dLabel(SD.date),
      message: 'Server ghi đè toàn bộ phân công của ngày ' + dLabel(SD.date) + ' bằng ' + changes.length +
        ' thay đổi đang chờ (dòng chọn “— chưa gán —” sẽ bị xóa). Tiếp tục?',
      okLabel: 'Lưu ' + changes.length + ' thay đổi'
    }).then(function (ok) {
      if (!ok) return;
      SOC.setBtnBusy_(btn, true, 'Đang lưu');
      SOC.api.saveWorkPositionBatchApi(SD.date, changes).then(function (res) {
        SOC.setBtnBusy_(btn, false);
        if (!res || !res.ok) { SOC.toast((res && res.message) || 'Không lưu được vị trí', 'err'); return; }
        SD.changes = {};
        sdReloadDay(res.message || 'Đã lưu vị trí');
      }, function (err) {
        SOC.setBtnBusy_(btn, false);
        SOC.toast('Không lưu được: ' + ((err && err.message) || 'lỗi kết nối'), 'err');
      });
    });
  }

  function sdReloadDay(msg) {
    SOC.api.getWorkPositionByDateApi(SD.date).then(function (res) {
      if (res && res.ok) SD.posCache[SD.date] = res.positions || {};
      else if (res && !res.ok) SOC.toast(res.message, 'err');
      SOC.bumpData();
      sdActions();
      sdFillBody();
      if (msg) SOC.toast(msg, 'ok');
    }, function () {
      SOC.bumpData();
      sdActions();
      sdFillBody();
      SOC.toast('Đã lưu nhưng chưa đọc lại được ngày này', 'err');
    });
  }

  /* ---------- nạp dữ liệu ---------- */
  function sdFetch(force) {
    if (SD.loading) return;
    SD.loading = true;
    var month = SD.month;
    Promise.all([store.get(month, force), SOC.api.getWorkPositionMonthApi(month)]).then(function (rs) {
      SD.loading = false;
      var wp = rs[1];
      if (!wp || !wp.ok) {
        SOC.toast((wp && wp.message) || 'Không tải được phân công vị trí', 'err');
        if (SD.posMonth === null) SD.posMonth = {};
      } else {
        SD.posMonth = wp.positions || {};
      }
      if (month !== SD.month) return;             /* đổi tháng giữa chừng — bỏ kết quả cũ */
      SD.loaded = true;
      SD.gen = SOC.dataGen();
      sdPrepare();
      sdPaint();
      store.ensureRoster().then(function () {
        if (SOC.state.page === PAGE) sdFillBody();   /* cột Station/Team về sau roster */
      });
    }, function (err) {
      SD.loading = false;
      var msg = (err && err.message) || 'lỗi kết nối';
      var sec = el();
      if (sec) {
        sec.innerHTML = '<div class="card"><div class="empty"><b>Không tải được lịch ngày</b>' +
          SOC.esc(msg) + '</div></div>';
      }
      SOC.toast('Không tải được lịch ngày: ' + msg, 'err');
    });
  }

  /* ---------- sự kiện (delegation — section tĩnh, chỉ innerHTML đổi) ---------- */
  function sdWire() {
    var sec = el();
    if (!sec || wired) return;
    wired = true;

    sec.addEventListener('click', function (e) {
      var t = e.target;
      if (!t.closest) return;
      var tab = t.closest('[data-sd-tab]');
      if (tab) { sdSetTab(tab.getAttribute('data-sd-tab')); return; }
      var day = t.closest('[data-sd-day]');
      if (day) { sdSetDate(day.getAttribute('data-sd-day')); return; }
      var open = t.closest('[data-sd-open]');
      if (open) {
        store.selId = open.getAttribute('data-sd-open');
        SOC.selectPage('schedule-personal');
        return;
      }
      var scope = t.closest('[data-sd-scope]');
      if (scope) { SD.shiftScope = scope.getAttribute('data-sd-scope'); sdPaint(); return; }
      var pscope = t.closest('[data-sd-posscope]');
      if (pscope) { SD.posScope = pscope.getAttribute('data-sd-posscope'); sdPaint(); return; }
      var act = t.closest('[data-sd-act]');
      if (!act) return;
      var a = act.getAttribute('data-sd-act');
      if (a === 'prevday') sdStepDay(-1);
      else if (a === 'nextday') sdStepDay(1);
      else if (a === 'today') sdGoToday();
      else if (a === 'clearq') {
        SD.q = '';
        var q = document.getElementById('sdQ');
        if (q) { q.value = ''; q.focus(); }
        sdFillBody();
      }
    });

    sec.addEventListener('input', function (e) {
      var node = e.target;
      if (!node.hasAttribute || !node.hasAttribute('data-sd-q')) return;
      SD.q = node.value;
      if (qTimer) clearTimeout(qTimer);
      qTimer = setTimeout(function () { qTimer = null; sdFillBody(); }, 180);
    });

    sec.addEventListener('change', function (e) {
      var node = e.target;
      var empId = node.getAttribute && node.getAttribute('data-sd-emp');
      var field = node.getAttribute && node.getAttribute('data-sd-field');
      if (!empId || !field) return;
      var byEmp = posByEmp(SD.date);
      var eff = sdEff(empId, byEmp) || { role: '', door: '', orderInDoor: 1 };
      var next = { role: eff.role, door: eff.door, orderInDoor: Number(eff.orderInDoor) || 1 };
      if (field === 'role') {
        next.role = node.value;
        if (!next.role || next.role === 'PIC' || next.role === 'GTC+TBS') next.door = '';
      } else if (field === 'door') next.door = node.value;
      else next.orderInDoor = Number(node.value) || 1;
      sdSetChange(empId, next, byEmp);
      sdPatchRow(empId, byEmp);
      sdPatchSide(byEmp);
    });
  }

  /* Nút ở slot đầu trang (Sửa · Lưu · Bỏ thay đổi · Cập nhật · Xem lịch tháng) */
  function sdWireActions() {
    var acts = document.getElementById('pageActions');
    if (!acts || actionsWired) return;
    actionsWired = true;
    acts.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-sd-act]');
      if (!b) return;
      var act = b.getAttribute('data-sd-act');
      if (act === 'edit') { SD.editing = !SD.editing; sdPaint(); }
      else if (act === 'drop') { SD.changes = {}; sdPaint(); }
      else if (act === 'save') sdSave(b);
      else if (act === 'reload') { SD.posCache = {}; SD.posMonth = null; sdFetch(true); }
      else if (act === 'matrix') SOC.selectPage('schedule');
    });
  }

  /* ---------- entry ---------- */
  function sdRender(ctx) {
    store = SOC.schedStore;
    sdWire();
    sdWireActions();
    if (!store.month) store.month = store.currentMonth();
    if (!SD.month) SD.month = store.month;
    if (!SD.date) SD.date = store.todayIso();

    var force = !!(ctx && ctx.force === true);
    if (!SD.loaded) { sdSkeleton(); sdFetch(true); return; }
    sdPrepare();
    sdPaint();
    if (force || SD.gen !== SOC.dataGen()) sdFetch(true);
    store.ensureRoster().then(function () { if (SOC.state.page === PAGE) sdFillBody(); });
  }

  SOC.registerView(PAGE, { section: SECTION, render: sdRender });
})();








