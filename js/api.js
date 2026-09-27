/* api.js — shim 34 `*Api` của server, giữ NGUYÊN tên chữ và hình dáng payload (map RPC).
   Khi port: thay body từng hàm bằng rpc(name, ...) gọi google.script.run — view không đổi. */
(function () {
  'use strict';
  var RANK = { viewer: 1, operator: 2, manager: 3, admin: 4 };
  /* Persona preview — plan 2026-09-27 rank×station: station khác defaultStation bị cap Operator,
     chỉ Điểm danh (quẹt task mọi station); PIC = manager trừ duyệt đơn (deny leaveDecide) */
  var PERSONAS = [
    { key: 'staff', group: 'station', label: 'Staff', role: 'operator', email: 'viewer.staff@spx-demo.vn', opsId: 'OPS4677', name: 'Nguyễn Mai Anh', station: 'HN2 SOC', isEditor: false },
    { key: 'pic', group: 'station', label: 'PIC', role: 'manager', email: 'pic.hn2@spx-demo.vn', opsId: 'OPS7304', name: 'Vũ Kiên Cường', station: 'HN2 SOC', isEditor: false, deny: ['leaveDecide'] },
    { key: 'lead', group: 'station', label: 'Lead', role: 'manager', email: 'manager.admin@spx-demo.vn', opsId: 'OPS6219', name: 'Lê Thành Nam', station: 'HN2 SOC', isEditor: false },
    { key: 'sup', group: 'station', label: 'Supervisor', role: 'admin', email: 'supervisor.hn2@spx-demo.vn', opsId: 'OPS7301', name: 'Hồ Đức Minh', station: 'HN2 SOC', isEditor: true },
    { key: 'khac-staff', group: 'khac', label: 'Staff', role: 'operator', email: 'nv.hnsoc@spx-demo.vn', opsId: 'OPS7305', name: 'Ngô Đình Bảo', station: 'HN SOC', isEditor: false },
    { key: 'khac-pic', group: 'khac', label: 'PIC', role: 'manager', email: 'pic.hnsoc@spx-demo.vn', opsId: 'OPS7306', name: 'Đặng Thị Mai Liên', station: 'HN SOC', isEditor: false, deny: ['leaveDecide'] },
    { key: 'khac-lead', group: 'khac', label: 'Lead', role: 'manager', email: 'lead.hnsoc@spx-demo.vn', opsId: 'OPS7307', name: 'Lý Minh Tuấn', station: 'HN SOC', isEditor: false },
    { key: 'khac-sup', group: 'khac', label: 'Supervisor', role: 'admin', email: 'sup.hnsoc@spx-demo.vn', opsId: 'OPS7303', name: 'Trịnh Thu Hà', station: 'HN SOC', isEditor: false },
    { key: 'admin', group: 'quantri', label: 'Quản trị hệ thống', role: 'admin', email: 'admin.sys@spx-demo.vn', opsId: 'OPS6219', name: 'Lê Thành Nam', station: '', isEditor: true }
  ];
  var SESSION = { key: 'admin', email: 'admin.sys@spx-demo.vn', role: 'admin', isEditor: true, opsId: 'OPS6219', name: 'Lê Thành Nam',
    station: '', scope: 'trong-tram', deny: [], pages: null };

  function resolvePersona(p) {
    SESSION.key = p.key;
    SESSION.role = p.role; SESSION.isEditor = !!p.isEditor;
    SESSION.email = p.email; SESSION.opsId = p.opsId; SESSION.name = p.name;
    SESSION.station = p.station || ''; SESSION.deny = p.deny || [];
    SESSION.scope = 'trong-tram'; SESSION.pages = null;
    var portal = String(S.settings.defaultStation || '');
    if (p.station && portal && p.station !== portal && p.key !== 'admin') {
      if ((RANK[SESSION.role] || 0) > RANK.operator) SESSION.role = 'operator';
      SESSION.isEditor = false;
      SESSION.scope = 'ngoai-tram';
      SESSION.pages = ['home', 'attendance', 'scan', 'about'];
    }
  }
  function sessionPayload() {
    return { key: SESSION.key, role: SESSION.role, isEditor: SESSION.isEditor, email: SESSION.email, opsId: SESSION.opsId,
      name: SESSION.name, station: SESSION.station, scope: SESSION.scope, pages: SESSION.pages, deny: SESSION.deny };
  }
  function offStation() {
    return SESSION.scope === 'ngoai-tram' ? fail('Bạn ở station khác — portal này chỉ mở Điểm danh') : null;
  }

  var S = {
    staff: MOCK.staff.slice(),
    tasks: MOCK.tasks.slice(),
    logs: JSON.parse(JSON.stringify(MOCK.logs)),
    leave: MOCK.leave.slice(),
    audit: MOCK.audit.slice(),
    settings: JSON.parse(JSON.stringify(MOCK.settings)),
    schedule: JSON.parse(JSON.stringify(MOCK.schedule)),
    positions: JSON.parse(JSON.stringify(MOCK.positions)),
    reports: MOCK.reports.slice()
  };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ts(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  function now() { return new Date(); }
  function fail(message, extra) {
    var o = { ok: false, message: message };
    if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }
  function delay(v, ms) {
    return new Promise(function (res) { setTimeout(function () { res(v); }, ms === undefined ? 90 + Math.random() * 180 : ms); });
  }
  function log(action, targetId, detail) {
    S.audit.unshift({
      timestamp: now().toISOString(), email: SESSION.email, action: action,
      targetId: targetId || '', detail: JSON.stringify(detail || {})
    });
  }
  function countersOf(taskId) {
    var rows = S.logs[taskId] || [];
    var c = { scanned: 0, presentAt: 0, absent: 0, extra: 0, total: rows.length };
    rows.forEach(function (r) {
      if (r.status === 'Dư') c.extra++;
      else if (r.status === 'Đã điểm danh') { c.scanned++; c.presentAt++; }
      else if (r.status === 'Vắng') c.absent++;
    });
    return c;
  }
  function gate(min) {
    if (min === 'editor') return SESSION.isEditor;
    return (RANK[SESSION.role] || 0) >= (RANK[min] || 99);
  }
  function findTask(id) { for (var i = 0; i < S.tasks.length; i++) if (S.tasks[i].taskId === id) return S.tasks[i]; return null; }
  function syncTaskTotals(t) {
    var c = countersOf(t.taskId);
    t.total = c.total; t.scanned = c.scanned; t.extra = c.extra;
  }
  function monthDays(month) {
    var p = String(month).split('-');
    var y = Number(p[0]), m = Number(p[1]);
    var out = [], d = new Date(y, m - 1, 1), last = new Date(y, m, 0).getDate();
    for (var i = 1; i <= last; i++) {
      var x = new Date(y, m - 1, i);
      out.push({
        date: i, dayOfWeek: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][x.getDay()],
        dateString: y + '-' + pad2(m) + '-' + pad2(i), isWeekend: x.getDay() === 0 ? 1 : 0
      });
    }
    void d;
    return out;
  }
  /* Lịch (tháng/cá nhân/ngày) chỉ dành cho Nhân sự đang làm việc có dòng trong ma trận —
     thời vụ không cố định nằm ngoài roster, không xếp lịch, không hiển thị ở 3 view này. */
  function rosterEmployees() {
    var out = [];
    Object.keys(S.schedule).forEach(function (id) {
      if (id === '__seeded__') return;
      var s = S.staff.filter(function (x) { return x.opsId === id && x.valid; })[0];
      if (s) out.push({ id: s.opsId, name: s.name, title: s.rank });
    });
    return out;
  }
  function rosterSlim() {
    return rosterEmployees().map(function (e) { return { opsId: e.id, name: e.name }; });
  }

  function ensureScheduleMonth(month) {
    if (S.schedule.__seeded__ === month) return;
    S.schedule.__seeded__ = month;
  }

  var api = {
    session: SESSION,
    personas: PERSONAS,
    /* đổi vai trò xem thử — bản mock giữ tham chiếu SESSION tại chỗ nên SOC.api.session vẫn đúng */
    setPersona: function (key) {
      var p = PERSONAS.filter(function (x) { return x.key === key; })[0] || PERSONAS[PERSONAS.length - 1];
      resolvePersona(p);
      return delay(Object.assign({ ok: true }, sessionPayload()));
    },

    /* ---- Code.gs ---- */
    getMetaApi: function () {
      return delay(Object.assign({ ok: true, appTitle: 'SOC Portal', userEmail: SESSION.email, canViewSchedule: true }, sessionPayload()));
    },
    /* hồ sơ của chính người đang đăng nhập — viewer chỉ đọc dữ liệu mình */
    staffInfoSelfApi: function () {
      if (!gate('viewer')) return delay(fail('Không đủ quyền', { staff: null }));
      var off = offStation(); if (off) return delay(off);
      var s = S.staff.filter(function (x) { return x.opsId === SESSION.opsId; })[0]
        || S.staff.filter(function (x) { return x.email === SESSION.email; })[0];
      if (!s) return delay(fail('Không tìm thấy hồ sơ của bạn', { staff: null }));
      var today = MOCK.DAY;
      var code = (S.schedule[s.opsId] || {})[today] || '';
      var pos = (S.positions[today] || {})[s.opsId] || null;
      var att = null;
      S.tasks.forEach(function (t) {
        if (att || String(t.date || '').slice(0, 10) !== today) return;
        var row = (S.logs[t.taskId] || []).filter(function (r) { return r.staffId === s.opsId; })[0];
        if (row) att = { status: row.status, time: row.scannedAtText, taskId: t.taskId };
      });
      var mine = S.leave.filter(function (l) { return l.opsId === s.opsId || l.email === s.email; });
      var slotRow = (MOCK.slots || []).filter(function (x) { return x.code === code; })[0];
      var dur = {};
      (MOCK.slots || []).forEach(function (x) {
        var f = x.from.split(':'), t0 = x.to.split(':');
        var mins = ((+t0[0]) * 60 + +t0[1]) - ((+f[0]) * 60 + +f[1]);
        dur[x.code] = (mins <= 0 ? mins + 1440 : mins) / 60;
      });
      var sch = S.schedule[s.opsId] || {};
      var workDays = 0, workHours = 0;
      Object.keys(sch).forEach(function (d) {
        if (d.slice(0, 7) !== MOCK.MONTH) return;
        var c = String(sch[d] || '');
        if (/^S\d+$/.test(c)) { workDays++; workHours += (dur[c] || 8); }
      });
      return delay({ ok: true, staff: s, shiftToday: code, shiftTime: slotRow ? slotRow.from + '–' + slotRow.to : '',
        positionToday: pos, attToday: att,
        leaveMine: mine,
        monthSummary: { workDays: workDays, workHours: Math.round(workHours * 10) / 10,
          leaveApproved: mine.filter(function (l) { return l.status === 'approved'; }).length,
          leavePending: mine.filter(function (l) { return l.status === 'pending'; }).length } });
    },
    getFilterOptionsApi: function () {
      if (!gate('operator')) return delay(fail('Không đủ quyền', { stationGroups: [], defaults: null, lists: null }));
      return delay({
        ok: true, stationGroups: MOCK.stationGroups,
        defaults: {
          station: S.settings.defaultStation, slotCode: S.settings.defaultSlotCode,
          team: S.settings.defaultTeam, department: S.settings.defaultDepartment
        },
        lists: {
          stations: S.settings.stations, teams: S.settings.teams, slotcodes: S.settings.slotcodes,
          departments: S.settings.departments, agencies: S.settings.agencies, contractTypes: S.settings.contractTypes
        },
        /* roster nạp = người đang làm — KHỚP appendRosterApi (loc !valid); cell count client phải cùng tập */
        staffList: S.staff.filter(function (s) { return s.valid; }).map(function (s) {
          return {
            staffId: s.opsId, station: s.station, slotCode: s.slotCode, team: s.team,
            contractType: s.contractType, department: s.department, date: s.workingDay, agency: s.agency
          };
        })
      });
    },
    getStaffStatsApi: function () {
      if (!gate('manager')) return delay(fail('Không đủ quyền'));
      var off = offStation(); if (off) return delay(off);
      return delay({ ok: true, staff: MOCK.staffData });
    },
    getSettingsApi: function () {
      if (!gate('editor')) return delay(fail('Chỉ editor xem được cấu hình', { settings: null }));
      return delay({ ok: true, settings: JSON.parse(JSON.stringify(S.settings)) });
    },
    saveSettingsApi: function (patch) {
      if (!gate('editor')) return delay(fail('Chỉ editor lưu được cấu hình', { saved: [], ignored: [] }));
      var saved = [], ignored = [];
      Object.keys(patch || {}).forEach(function (k) {
        if (['defaultStation', 'defaultSlotCode', 'defaultTeam', 'defaultDepartment', 'roleMap', 'stations', 'teams', 'slotcodes', 'departments', 'agencies', 'contractTypes'].indexOf(k) < 0) { ignored.push(k); return; }
        S.settings[k] = patch[k]; saved.push(k);
      });
      log('settings', 'settings', { saved: saved });
      return delay({ ok: true, saved: saved, ignored: ignored, message: 'Đã lưu ' + saved.length + ' mục' });
    },
    getAuditLogApi: function (limit, offset) {
      if (!gate('admin')) return delay(fail('Chỉ admin xem được nhật ký', { rows: [] }));
      var n = Math.max(1, Math.min(200, limit || 50)), o = offset || 0;
      return delay({ ok: true, rows: S.audit.slice(o, o + n), message: '', total: S.audit.length, actionLabels: MOCK.actions });
    },

    /* ---- task + scan ---- */
    createTaskApi: function (input) {
      if (!gate('operator')) return delay(fail('Không đủ quyền', { taskId: null, count: 0 }));
      var f = input || {};
      var d = f.date || MOCK.DAY;
      var base = 'R' + d.replace(/-/g, '') + '-' + pad2(now().getHours()) + pad2(now().getMinutes());
      var id = base, k = 2;
      while (findTask(id)) id = base + '-' + k++;
      var t = {
        taskId: id, station: f.station || '', slotCode: [].concat(f.slotCode || []).join(', ') || 'Tự do',
        team: [].concat(f.team || []).join(', ') || '—',
        contractType: [].concat(f.contractType || []).join(', ') || '—',
        status: 'open', date: d, createdBy: SESSION.email,
        createdAtText: ts(now()), completedAtText: '', phase: 'open', total: 0, scanned: 0, extra: 0
      };
      S.tasks.unshift(t);
      var codes = (f.codes || []);
      S.logs[id] = codes.map(function (c, i) {
        var s = S.staff.filter(function (x) { return x.opsId === c; })[0];
        return {
          taskId: id, staffId: c, staffName: s ? s.name : '', slotCode: s ? s.slotCode : '', station: t.station,
          team: s ? s.team : '', workstation: s ? 'WS-' + (i + 1) : '', listedAtText: '05:0' + (i % 9) + ':00',
          listedAtEpoch: now().getTime(), scannedAtText: '', scannedAtEpoch: 0, status: '-', dateText: d, _rowIndex: i + 2
        };
      });
      syncTaskTotals(t);
      /* KHỚP server TaskService.gs:154 — autoAttend && có roster thì mở thẳng phase Điểm danh */
      if (f.autoAttend && codes.length) { t.status = 'attend'; t.phase = 'attend'; }
      log('createTask', id, { count: codes.length, skippedCodes: 0, autoAttend: !!f.autoAttend });
      return delay({
        ok: true, taskId: id, count: codes.length, skippedCodes: 0, status: t.status,
        permission: {
          isAdmin: SESSION.role === 'admin', isOwner: true,
          canScanOpen: true, canMutate: true
        },
        message: 'Đã tạo task ' + id
      });
    },
    /* KHỚP server TaskService.gs appendRoster_ — cells[] là nguồn chọn, chỉ nạp task Mở còn trống log */
    appendRosterApi: function (input) {
      if (!gate('operator')) return delay(fail('Không đủ quyền'));
      var f = ((input || {}).filter) || {};
      var station = String(f.station || '').trim();
      if (!station) return delay(fail('Thiếu Station — không thể nạp danh sách'));
      var arr = function (v) { return [].concat(v || []); };
      var has = function (vals, v) { return !vals.length || vals.indexOf(String(v || '').trim()) >= 0; };
      var rows = S.staff.filter(function (s) { return s.valid; }).map(function (s) {
        return {
          staffId: s.opsId, staffName: s.name, slotCode: s.slotCode, station: s.station, team: s.team,
          contractType: s.contractType, department: s.department, date: s.workingDay
        };
      });
      var picked = [];
      if (arr(f.cells).length) {
        var base = rows.filter(function (s) {
          return s.station === station && has(arr(f.team), s.team) &&
            has(arr(f.department), s.department) && has(arr(f.date), s.date);
        });
        var seen = {};
        arr(f.cells).forEach(function (cell) {
          var cs = arr(cell.slotCode), cc = arr(cell.contractType);
          base.forEach(function (s) {
            if (!has(cs, s.slotCode) || !has(cc, s.contractType) || seen[s.staffId]) return;
            seen[s.staffId] = 1; picked.push(s);
          });
        });
      } else {
        picked = rows.filter(function (s) {
          return s.station === station && has(arr(f.slotCode), s.slotCode) && has(arr(f.team), s.team) &&
            has(arr(f.contractType), s.contractType) && has(arr(f.department), s.department) &&
            has(arr(f.date), s.date);
        });
      }
      if (!picked.length) return delay(fail('Không có nhân viên nào khớp bộ lọc'));
      var t = findTask((input || {}).taskId);
      if (!t) return delay(fail('Không tìm thấy task'));
      if (t.status !== 'open') return delay(fail('Chỉ nạp được khi task ở phase Mở'));
      var logs = S.logs[t.taskId] || [];
      if (logs.length) return delay(fail('Task đã có dữ liệu quét — không nạp được'));
      var stamp = now().getTime();
      S.logs[t.taskId] = logs.concat(picked.map(function (s, i) {
        return {
          taskId: t.taskId, staffId: s.staffId, staffName: s.staffName, slotCode: s.slotCode, station: s.station,
          team: s.team, workstation: 'WS-' + (logs.length + i + 1), listedAtText: '', listedAtEpoch: 0,
          scannedAtText: '', scannedAtEpoch: 0, status: '-', dateText: t.date, _rowIndex: logs.length + i + 2
        };
      }));
      t.station = station;
      t.slotCode = arr(f.slotCode).join(', ');
      t.team = arr(f.team).join(', ');
      syncTaskTotals(t);
      log('loadRoster', t.taskId, { count: picked.length, cells: arr(f.cells).length });
      return delay({ ok: true, taskId: t.taskId, count: picked.length, message: 'Nạp ' + picked.length + ' NV thành công' });
    },
    getTaskListApi: function () {
      var cutoff = new Date(2026, 8, 25 - 30).getTime();
      var rows = S.tasks.filter(function (t) { return t.status !== 'done' || new Date(t.createdAtText.replace(' ', 'T')).getTime() >= cutoff; })
        .map(function (t) {
          var c = countersOf(t.taskId);
          return {
            taskId: t.taskId, station: t.station, slotCode: t.slotCode, team: t.team,
            contractType: t.contractType, status: t.status, date: t.date, phase: t.phase,
            createdBy: t.createdBy, createdAtText: t.createdAtText, completedAtText: t.completedAtText,
            total: c.total, scanned: c.scanned, extra: c.extra
          };
        });
      return delay(rows.length ? rows : []);
    },
    getTaskDetailApi: function (taskId) {
      var t = findTask(taskId);
      if (!t) return delay(fail('Không tìm thấy task', { task: null, log: [] }));
      var c = countersOf(taskId);
      return delay({
        ok: true,
        task: {
          taskId: t.taskId, station: t.station, slotCode: t.slotCode, team: t.team, contractType: t.contractType,
          status: t.status, date: t.date, createdBy: t.createdBy, createdAtText: t.createdAtText, completedAtText: t.completedAtText,
          permission: {
            isAdmin: SESSION.role === 'admin', isOwner: t.createdBy === SESSION.email,
            canScanOpen: SESSION.role === 'admin' || t.createdBy === SESSION.email,
            canMutate: SESSION.role === 'admin' || t.createdBy === SESSION.email
          }
        },
        log: (S.logs[taskId] || []).slice(),
        counters: c
      });
    },
    scanStaffApi: function (taskId, rawCode) {
      var code = String(rawCode || '').trim().toUpperCase();
      if (!/^OPS\d+$/.test(code)) return delay(fail('Mã không hợp lệ', { status: null, counters: { scanned: 0, absent: 0, extra: 0, total: 0 } }));
      var t = findTask(taskId);
      if (!t) return delay(fail('Không tìm thấy task', { status: null, counters: { scanned: 0, absent: 0, extra: 0, total: 0 } }));
      if (t.status === 'done') return delay(fail('Task đã đóng', { status: null, counters: countersOf(taskId) }));
      var rows = S.logs[taskId] || [];
      var row = rows.filter(function (r) { return r.staffId === code; })[0];
      var s = S.staff.filter(function (x) { return x.opsId === code; })[0];
      if (!row) {
        row = {
          taskId: taskId, staffId: code, staffName: s ? s.name : null, slotCode: t.slotCode, station: t.station,
          team: s ? s.team : '—', workstation: '—', listedAtText: '', listedAtEpoch: 0,
          scannedAtText: '', scannedAtEpoch: 0, status: 'Dư', dateText: t.date, _rowIndex: rows.length + 2
        };
        rows.push(row);
        log('loadRoster', taskId, { count: 1 });
      }
      var phase, field;
      if (row.status === 'Dư') { row.status = 'Đã điểm danh'; phase = 'present'; field = 'listedAt'; }
      else if (!row.scannedAtEpoch) { row.scannedAtText = ts(now()).slice(11); row.scannedAtEpoch = now().getTime(); phase = 'attend'; field = 'scannedAt'; }
      else if (!row.listedAtEpoch) { row.listedAtText = ts(now()).slice(11); row.listedAtEpoch = now().getTime(); phase = 'present'; field = 'listedAt'; }
      else return delay(fail('Đã điểm danh rồi', { status: null, counters: countersOf(taskId) }));
      if (row.status === '-' || row.status === 'Vắng') row.status = 'Đã điểm danh';
      if (phase === 'present') { row.listedAtText = row.listedAtText || ts(now()).slice(11); row.listedAtEpoch = row.listedAtEpoch || now().getTime(); }
      var c = countersOf(taskId);
      syncTaskTotals(t);
      return delay({
        ok: true, message: row.status, status: row.status, phase: phase, field: field,
        scannedAtText: row.scannedAtText, scannedAtEpoch: row.scannedAtEpoch,
        listedAtText: row.listedAtText, listedAtEpoch: row.listedAtEpoch,
        staffName: row.staffName, staffUnknown: !s, slotCode: row.slotCode, station: row.station,
        team: row.team, workstation: row.workstation, dateText: row.dateText, counters: c
      });
    },
    completeTaskApi: function (taskId) {
      var t = findTask(taskId);
      if (!t) return delay(fail('Không tìm thấy task'));
      if (!gate('operator')) return delay(fail('Không đủ quyền'));
      (S.logs[taskId] || []).forEach(function (r) { if (r.status === '-') r.status = 'Vắng'; });
      t.status = 'done'; t.phase = 'done'; t.completedAtText = ts(now());
      syncTaskTotals(t);
      log('completeTask', taskId, { absentCount: (S.logs[taskId] || []).filter(function (r) { return r.status === 'Vắng'; }).length, counters: countersOf(taskId) });
      return delay({ ok: true, message: 'Đã đóng task ' + taskId });
    },
    cancelTaskApi: function (taskId) {
      var t = findTask(taskId);
      if (!t) return delay(fail('Không tìm thấy task'));
      if (t.status !== 'open' || (S.logs[taskId] || []).length) return delay(fail('Chỉ hủy được task Mở còn trống'));
      S.tasks = S.tasks.filter(function (x) { return x.taskId !== taskId; });
      delete S.logs[taskId];
      log('cancelTask', taskId, {});
      return delay({ ok: true, message: 'Đã hủy task' });
    },
    purgeOldTasksApi: function (payload) {
      if (!gate('admin')) return delay(fail('Chỉ admin dọn được dữ liệu'));
      var mode = (payload || {}).mode;
      if (mode !== 'preview' && mode !== 'exec') return delay(fail('mode không hợp lệ'));
      var old = S.tasks.filter(function (t) { return t.status === 'done' && t.date < '2026-08-26'; });
      var logCount = old.reduce(function (n, t) { return n + (S.logs[t.taskId] || []).length; }, 0);
      if (mode === 'preview') {
        return delay({ ok: true, preview: { taskCount: old.length, logCount: logCount, cutOffText: '26/08/2026', retentionDays: 30 } });
      }
      old.forEach(function (t) { delete S.logs[t.taskId]; });
      S.tasks = S.tasks.filter(function (t) { return old.indexOf(t) < 0; });
      log('purgeOldTasks', 'tasks', { taskCount: old.length, logCount: logCount, cutOff: '2026-08-26' });
      return delay({ ok: true, taskCount: old.length, logCount: logCount });
    },
    transitionToAttendApi: function (taskId) {
      var t = findTask(taskId);
      if (!t) return delay(fail('Không tìm thấy task'));
      if (t.status !== 'open') return delay(fail('Task không ở giai đoạn Mở'));
      t.status = 'attend'; t.phase = 'attend';
      log('transitionToAttend', taskId, {});
      return delay({ ok: true, message: 'Đã bàn giao — quét lượt hai để ghi giờ điểm danh' });
    },
    reopenTaskApi: function (taskId) {
      var t = findTask(taskId);
      if (!t) return delay(fail('Không tìm thấy task'));
      if (t.status !== 'done') return delay(fail('Chỉ mở lại task đã đóng'));
      var reset = 0;
      (S.logs[taskId] || []).forEach(function (r) { if (r.status === 'Vắng') { r.status = '-'; reset++; } });
      t.status = 'attend'; t.phase = 'attend'; t.completedAtText = '';
      syncTaskTotals(t);
      log('reopenTask', taskId, { resetCount: reset });
      return delay({ ok: true, message: 'Đã mở lại task' });
    },
    updateLogRowStatusApi: function (taskId, staffId, newStatus) {
      var t = findTask(taskId);
      if (!t) return delay(fail('Không tìm thấy task', { counters: null }));
      if (t.status === 'done') return delay(fail('Task đã đóng — mở lại để sửa', { counters: null }));
      var row = (S.logs[taskId] || []).filter(function (r) { return r.staffId === staffId; })[0];
      if (!row) return delay(fail('Không có dòng này', { counters: null }));
      var old = row.status;
      row.status = newStatus;
      if (newStatus === 'Đã điểm danh' && !row.scannedAtEpoch) { row.scannedAtText = ts(now()).slice(11); row.scannedAtEpoch = now().getTime(); }
      if (newStatus === 'Vắng' || newStatus === '-') { row.scannedAtText = ''; row.scannedAtEpoch = 0; }
      log('fixLogRowStatus', taskId, { staffId: staffId, oldStatus: old, newStatus: newStatus, fillScanTime: newStatus === 'Đã điểm danh', clearScanTime: newStatus !== 'Đã điểm danh', clearListedAt: false });
      return delay({
        ok: true, message: 'Đã cập nhật', counters: countersOf(taskId),
        row: { staffId: staffId, status: newStatus, scannedAtText: row.scannedAtText, scannedAtEpoch: row.scannedAtEpoch, listedAtText: row.listedAtText, listedAtEpoch: row.listedAtEpoch }
      });
    },
    searchLogsByStaffApi: function (rawStaffId) {
      if (!gate('manager')) return delay(fail('Không đủ quyền', { rows: [] }));
      var code = String(rawStaffId || '').trim().toUpperCase();
      var rows = [];
      S.tasks.forEach(function (t) {
        (S.logs[t.taskId] || []).forEach(function (r) {
          if (r.staffId === code) {
            rows.push({
              taskId: t.taskId, staffId: r.staffId, staffName: r.staffName, status: r.status,
              station: t.station, team: t.team, slotCode: t.slotCode, taskStatus: t.status,
              createdAtText: t.createdAtText, createdBy: t.createdBy,
              listedAtText: r.listedAtText, scannedAtText: r.scannedAtText
            });
          }
        });
      });
      return delay({ ok: true, rows: rows });
    },
    warmStaffCacheApi: function () {
      var index = {};
      S.staff.forEach(function (s) {
        index[s.opsId] = { staffId: s.opsId, staffName: s.name, slotCode: s.slotCode, station: s.station, team: s.team, workstation: '', agency: s.agency, date: s.workingDay };
      });
      return delay({ ok: true, index: index });
    },

    /* ---- lịch ---- */
    getScheduleMonthApi: function (month, year) {
      var off = offStation(); if (off) return delay(off);
      var m = normalizeMonth(month, year);
      ensureScheduleMonth(m);
      if (!gate('viewer')) return delay(fail('Không đủ quyền'));
      return delay({
        ok: true, month: m, employees: rosterEmployees(), schedule: S.schedule, daysInMonth: monthDays(m),
        staffListSlim: rosterSlim(), staffInfoSelf: { opsId: 'OPS1001', name: S.staff[0].name }, message: ''
      });
    },
    getScheduleMonthWithPositionApi: function (month, year) {
      var off = offStation(); if (off) return delay(off);
      var m = normalizeMonth(month, year);
      return delay({
        ok: true, month: m, employees: rosterEmployees(), schedule: S.schedule, daysInMonth: monthDays(m),
        staffListSlim: rosterSlim(), staffInfoSelf: { opsId: 'OPS1001', name: S.staff[0].name },
        positions: S.positions, message: ''
      });
    },
    getScheduleReportsApi: function (month) {
      if (!gate('operator')) return delay(fail('Không đủ quyền', { rows: [] }));
      var off = offStation(); if (off) return delay(off);
      var rows = S.reports.filter(function (r) { return !month || r.reportDate.slice(0, 7) === month; });
      return delay({ ok: true, rows: rows, month: month, email: SESSION.email, staffName: S.staff[0].name, isAdmin: SESSION.role === 'admin', message: '' });
    },
    updateScheduleApi: function (updates) {
      if (!gate('admin')) return delay(fail('Chỉ admin sửa được ca', { updatedMonths: [] }));
      var months = {};
      (updates || []).forEach(function (u) {
        if (!S.schedule[u.empId]) S.schedule[u.empId] = {};
        S.schedule[u.empId][u.dateString] = u.newShift;
        months[u.dateString.slice(0, 7).replace('-', '')] = 1;
      });
      return delay({ ok: true, updatedMonths: Object.keys(months).sort(), message: 'Đã lưu ' + (updates || []).length + ' ô' });
    },
    getInformationApi: function () {
      if (!gate('admin')) return delay(fail('Chỉ Supervisor/Admin xem được Nhân sự', { rows: [] }));
      var off = offStation(); if (off) return delay(off);
      var rows = S.staff.map(function (s) {
        return {
          row: s.row, no: s.no, staffId: s.staffId, opsId: s.opsId, name: s.name, email: s.email,
          rank: s.rank, joinedDate: s.joinedDate, workingDay: s.workingDay, birthday: s.birthday,
          phone: s.phone, address: s.address, gender: s.gender, equipment: s.equipment,
          status: s.status, valid: s.valid
        };
      });
      if (SESSION.role !== 'admin') rows = rows.filter(function (r) { return r.valid && r.status !== 'Đã nghỉ'; });
      return delay({ ok: true, rows: rows, message: '' });
    },
    appendInformationApi: function (input) {
      if (!gate('admin')) return delay(fail('Chỉ admin thêm được', { row: 0 }));
      var row = 6 + S.staff.length;
      S.staff.push(Object.assign({
        no: String(S.staff.length + 1), staffId: 'R' + (20260000 + 1200 + S.staff.length * 7),
        valid: true, agency: '', contractType: '', department: '', slotCode: '', team: '', station: '', row: row
      }, input || {}));
      log('infoAppend', (input || {}).opsId, { row: row, opsId: (input || {}).opsId, name: (input || {}).name });
      return delay({ ok: true, row: row, message: '' });
    },
    updateInformationApi: function (input) {
      if (!gate('admin')) return delay(fail('Chỉ admin sửa được', { row: 0 }));
      var s = S.staff.filter(function (x) { return x.row === input.row || x.email === (input.oldEmail || input.email); })[0];
      if (!s) return delay(fail('Không tìm thấy dòng', { row: 0 }));
      Object.assign(s, input);
      s.valid = !!(s.email && s.opsId);
      log('infoUpdate', s.opsId, { row: s.row, fields: Object.keys(input).join(',') });
      return delay({ ok: true, row: s.row, message: '' });
    },
    deleteInformationApi: function (input) {
      if (!gate('admin')) return delay(fail('Chỉ admin xóa được', { row: 0 }));
      var s = S.staff.filter(function (x) { return x.row === input.row || x.email === input.email; })[0];
      if (!s) return delay(fail('Không tìm thấy dòng', { row: 0 }));
      s.status = 'Đã nghỉ'; s.valid = false;
      log('infoDisable', s.opsId, { row: s.row });
      return delay({ ok: true, row: s.row, message: '' });
    },

    /* ---- vị trí ---- */
    getWorkPositionMonthApi: function (month, year) {
      var off = offStation(); if (off) return delay(off);
      var m = normalizeMonth(month, year);
      return delay({ ok: true, month: m, positions: S.positions, message: '' });
    },
    getWorkPositionByDateApi: function (dateString) {
      var off = offStation(); if (off) return delay(off);
      return delay({ ok: true, dateString: dateString, positions: S.positions[dateString] || {}, message: '' });
    },
    saveWorkPositionBatchApi: function (dateStr, changes) {
      if (!gate('manager')) return delay(fail('Không đủ quyền', { saved: null }));
      var map = S.positions[dateStr] || (S.positions[dateStr] = {});
      var cleared = 0, saved = 0;
      (changes || []).forEach(function (c) {
        if (!c.role) { if (map[c.empId]) { delete map[c.empId]; cleared++; } return; }
        map[c.empId] = { empName: c.empName, role: c.role, door: c.door, orderInDoor: c.orderInDoor || 1 };
        saved++;
      });
      return delay({ ok: true, saved: { date: dateStr, cleared: cleared, saved: saved }, message: 'Đã lưu ' + saved + ' vị trí' });
    },

    /* ---- xin nghỉ ---- */
    requestLeaveApi: function (input) {
      if (!gate('operator')) return delay(fail('Không đủ quyền', { id: '' }));
      var off = offStation(); if (off) return delay(off);
      var pending = S.leave.filter(function (r) { return r.status === 'pending'; }).length;
      if (pending >= 5) return delay(fail('Đã có 5 đơn chờ duyệt', { id: '' }));
      var s = S.staff.filter(function (x) { return x.email === SESSION.email; })[0] || S.staff[0];
      var id = 'LV-' + MOCK.DAY.replace(/-/g, '') + '-' + (1000 + S.leave.length * 7);
      S.leave.push({
        id: id, email: s.email, opsId: s.opsId, name: s.name,
        dateString: input.dateString, type: String(input.type).toUpperCase(), reason: input.reason || '',
        status: 'pending', createdAt: now().toISOString(), decidedBy: '', decidedAt: '', note: ''
      });
      log('leaveRequest', s.opsId, { opsId: s.opsId, dateString: input.dateString, type: input.type });
      return delay({ ok: true, id: id, message: 'Đã gửi đơn nghỉ ' + input.dateString });
    },
    getLeaveRequestsApi: function (opts) {
      if (!gate('operator')) return delay(fail('Không đủ quyền', { rows: [], pendingCount: 0 }));
      var off = offStation(); if (off) return delay(off);
      var o = opts || {};
      var rows = S.leave.filter(function (r) {
        if (o.month && r.dateString.slice(0, 7) !== o.month) return false;
        if (o.mine) return true;
        if (SESSION.role === 'admin') return true;
        return r.status === 'pending' || r.email === SESSION.email;
      });
      return delay({ ok: true, rows: rows, pendingCount: rows.filter(function (r) { return r.status === 'pending'; }).length, message: '' });
    },
    decideLeaveApi: function (input) {
      if (!gate('manager')) return delay(fail('Cần Supervisor/Lead để duyệt đơn', { status: 'pending' }));
      if (SESSION.deny.indexOf('leaveDecide') >= 0) return delay(fail('PIC không duyệt đơn — cần Supervisor/Lead', { status: 'pending' }));
      var off = offStation(); if (off) return delay(off);
      var r = S.leave.filter(function (x) { return x.id === input.id; })[0];
      if (!r) return delay(fail('Không tìm thấy đơn', { status: '' }));
      r.status = input.approve === true ? 'approved' : 'denied';
      r.note = input.note || ''; r.decidedBy = SESSION.email; r.decidedAt = now().toISOString();
      if (r.status === 'approved' && S.schedule[r.opsId]) S.schedule[r.opsId][r.dateString] = r.type;
      log(input.approve === true ? 'leaveApprove' : 'leaveDeny', r.opsId, { opsId: r.opsId, dateString: r.dateString, type: r.type });
      return delay({ ok: true, status: r.status, message: input.approve === true ? 'Đã duyệt' : 'Đã từ chối' });
    },
    cancelLeaveApi: function (input) {
      if (!gate('operator')) return delay(fail('Không đủ quyền'));
      var off = offStation(); if (off) return delay(off);
      var r = S.leave.filter(function (x) { return x.id === input.id; })[0];
      if (!r || r.status !== 'pending') return delay(fail('Chỉ hủy được đơn đang chờ'));
      r.status = 'cancelled'; r.note = input.note || '';
      log('leaveCancel', r.opsId, { opsId: r.opsId, dateString: r.dateString });
      return delay({ ok: true, message: 'Đã hủy đơn' });
    }
  };

  function normalizeMonth(month, year) {
    if (typeof month === 'string' && /^\d{4}-\d{2}$/.test(month)) return month;
    return (year || 2026) + '-' + pad2(Number(month) || 9);
  }

  Object.keys(api).forEach(function (k) { SOC.api[k] = api[k]; });
  SOC.apiActions = function (fn) { log(fn, '', {}); };
})();
