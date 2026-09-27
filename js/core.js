/* core.js — nhân điều phối: IA, routing, theme, toast/confirm, helper format + badge.
   Không view module nào tự ẩn/hiện section hay sửa sidebar (hợp đồng §3c). */
var SOC = (function () {
  'use strict';

  var ROLE_RANK = { viewer: 1, operator: 2, manager: 3, admin: 4 };
  var SHIFT_CATEGORY = {
    S1: 'morning', S2: 'morning', S3: 'morning', S4: 'morning', S5: 'morning',
    S6: 'morning', S7: 'morning', S8: 'morning', S9: 'morning',
    S10: 'afternoon', S11: 'afternoon', S12: 'afternoon', S13: 'afternoon', S14: 'afternoon',
    S15: 'evening', S16: 'evening', S17: 'evening', S18: 'evening', S19: 'evening',
    OFF: 'off', PH: 'holiday', HL: 'holiday',
    AL: 'leave', SL: 'leave', MAL: 'leave', CL: 'leave', PL: 'leave', ML: 'leave',
    OIL: 'leave', NPL: 'leave'
  };
  var STATUS_CLASS = {
    '-': 'pending', 'PENDING': 'pending',
    'Đã điểm danh': 'present', 'PRESENT': 'present',
    'Vắng': 'absent', 'ABSENT': 'absent',
    'Dư': 'extra', 'EXTRA': 'extra'
  };

  /* IA mới 3 nhóm — group/label/eyebrow/mô tả MỘT nguồn duy nhất (plan §3.6) */
  var PAGE_META = {
    home:                { group: 'Vận hành',  label: 'Trang chủ',      section: 'viewHome',                eyebrow: 'OVERVIEW',          title: 'Trang chủ',           desc: 'Bức tranh ca hôm nay — ai có mặt, ai vắng, việc gì chờ xử lý' },
    attendance:          { group: 'Vận hành',  label: 'Điểm danh',      section: 'viewTasks',               eyebrow: 'OPS / ATTENDANCE',  title: 'Điểm danh',           desc: 'Đối chiếu danh sách theo Station / Ca / Team — tạo task, quét giờ có mặt, bàn giao' },
    scan:                { group: 'Vận hành',  label: 'Màn quét',       section: 'viewScan',                eyebrow: 'OPS / ATTENDANCE',  title: 'Màn quét',            desc: 'Quét mã từng nhân viên cho ca đang mở', noNav: true },
    stats:               { group: 'Vận hành',  label: 'Thống kê',       section: 'viewStats',               eyebrow: 'OPS / INSIGHTS',    title: 'Thống kê',            desc: 'Contract Type × Ca · Agency × Ca — lượt chấm công thực tế (lọc Station + Ngày)' },
    schedule:            { group: 'Workforce', label: 'Lịch tháng',      section: 'viewSchedule',            eyebrow: 'WORKFORCE / SCHEDULE', title: 'Lịch làm việc',     desc: 'Ma trận nhân viên × ngày, đọc từ hệ thống lịch của kho' },
    'schedule-personal': { group: 'Workforce', label: 'Lịch cá nhân',   section: 'viewSchedulePersonal',    eyebrow: 'WORKFORCE / PEOPLE', title: 'Lịch cá nhân',       desc: 'Lịch tháng của một người kèm bảng chấm công' },
    'schedule-daily':    { group: 'Workforce', label: 'Lịch ngày',      section: 'viewScheduleDaily',   eyebrow: 'WORKFORCE / DAILY',  title: 'Lịch ngày',        desc: 'Một ngày làm việc, hai góc nhìn: ai làm ca nào và ai đứng cửa nào — gán vị trí tại chỗ' },
    leave:               { group: 'Workforce', label: 'Đăng ký nghỉ',   section: 'viewLeave',               eyebrow: 'WORKFORCE / LEAVE', title: 'Đăng ký nghỉ',      desc: 'Đơn nghỉ của tôi và đơn chờ duyệt trong team' },
    information:         { group: 'Workforce', label: 'Nhân sự',        section: 'viewInformation',         eyebrow: 'WORKFORCE / PEOPLE', title: 'Nhân sự',            desc: 'Danh bạ team đọc từ sheet Information' },
    data:                { group: 'Hệ thống',  label: 'Dữ liệu',        section: 'viewStaff',            eyebrow: 'SYSTEM / DATA',     title: 'Dữ liệu',           desc: 'Nguồn StaffData thô theo tháng' },
    admin:               { group: 'Hệ thống',  label: 'Quản trị',       section: 'viewAdmin',               eyebrow: 'SYSTEM / AUDIT',    title: 'Quản trị',            desc: 'Nhật ký hoạt động và dọn dữ liệu cũ' },
    config:              { group: 'Hệ thống',  label: 'Cấu hình',       section: 'viewConfig',              eyebrow: 'SYSTEM / SETTINGS', title: 'Cấu hình',            desc: 'Danh mục vận hành và phân quyền truy cập' },
    about:               { group: 'Hệ thống',  label: 'Giới thiệu',     section: 'viewAbout',               eyebrow: 'SYSTEM / HELP',     title: 'Giới thiệu SPX SOC Portal', desc: 'Hướng dẫn điểm danh · ký hiệu ca · ghi chú sử dụng' }
  };

  var SIDE_ROLES = { stats: 'manager', data: 'manager', admin: 'admin', config: 'editor', information: 'admin', leave: 'operator' };

  var SCAN_TASK = null;
  var SCAN_ROSTER = false;
  /* vào màn quét của 1 task: view-scan đăng ký handler, core giữ con trỏ task đang mở;
     opts.roster = mở luôn modal Nạp danh sách khi bảng sẵn sàng (lối tắt từ Trang chủ) */
  function openScan(taskId, opts) {
    SCAN_TASK = taskId || null;
    SCAN_ROSTER = !!(opts && opts.roster);
    selectPage('scan');
  }
  function consumeScanRoster() {
    var v = SCAN_ROSTER; SCAN_ROSTER = false; return v;
  }

  var views = {};
  var state = { page: 'home', role: 'operator', email: '', opsId: '', name: '', isEditor: false, canViewSchedule: false, loading: false, sound: true, station: '', scope: 'trong-tram', deny: [], pages: null, personaKey: 'admin' };

  /* ---------- helper escape/format ---------- */
  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function fmtDate(d) {
    var x = d instanceof Date ? d : new Date(d);
    return pad2(x.getDate()) + '/' + pad2(x.getMonth() + 1) + '/' + x.getFullYear();
  }
  function fmtClock(ms) {
    if (!ms) return '';
    var x = new Date(ms);
    return pad2(x.getHours()) + ':' + pad2(x.getMinutes()) + ':' + pad2(x.getSeconds());
  }
  function fmtTimeText(txt) { return String(txt || ''); }
  function isoDay(d) {
    var x = d instanceof Date ? d : new Date(d);
    return x.getFullYear() + '-' + pad2(x.getMonth() + 1) + '-' + pad2(x.getDate());
  }
  function isoMonth(d) { var x = d instanceof Date ? d : new Date(d); return x.getFullYear() + '-' + pad2(x.getMonth() + 1); }
  function monthLabel(ym) {
    var p = String(ym || '').split('-');
    return 'Tháng ' + Number(p[1]) + '/' + p[0];
  }
  function daysInMonth(ym) { var p = ym.split('-'); return new Date(Number(p[0]), Number(p[1]), 0).getDate(); }
  /* Cộng/tháng cho chuỗi 'YYYY-MM' — nguồn duy nhất cho mọi bước tháng */
  function shiftMonth(ym, delta) {
    var p = String(ym || '').split('-');
    return isoMonth(new Date(Number(p[0]), Number(p[1]) - 1 + delta, 1));
  }
  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/);
    return ((parts[parts.length - 1] || '')[0] || (parts[0] || '?')[0] || '?').toUpperCase();
  }

  /* ---------- badge SSOT ---------- */
  function badgeShift(code) {
    var c = String(code || '').trim().toUpperCase();
    if (!c) return '<span class="badge-shift badge-shift--off" aria-label="Chưa có ca">·</span>';
    var cat = SHIFT_CATEGORY[c] || 'leave';
    return '<span class="badge-shift badge-shift--' + cat + '" title="' + esc(c) + '">' + esc(c) + '</span>';
  }
  function shiftCategory(code) { return SHIFT_CATEGORY[String(code || '').trim().toUpperCase()] || 'leave'; }

  /* ---------- helper dùng chung mọi view (SSOT — hợp đồng §3c) ---------- */
  /* Một ô bảng có thể mang nhiều giá trị nối bằng dấu phẩy ('S1, S3' · 'A, B'). */
  function splitList(v) {
    return String(v === null || v === undefined ? '' : v)
      .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }
  /* Ô ca: chỉ mã S<n> mới là ca; giá trị khác ('Tự do', '—') render .pill để không nhầm màu nghỉ. */
  function slotCell(code) {
    var parts = splitList(code);
    if (!parts.length) return '<span class="pill">Chưa rõ</span>';
    return parts.map(function (p) {
      return /^S\d+$/i.test(p) ? badgeShift(p) : '<span class="pill">' + esc(p) + '</span>';
    }).join(' ');
  }
  function uniq(arr) {
    var seen = Object.create(null), out = [];
    (arr || []).forEach(function (v) {
      var k = String(v === null || v === undefined ? '' : v).trim();
      if (!k || seen[k]) return;
      seen[k] = 1; out.push(k);
    });
    return out;
  }
  /* Xếp danh sách mã ca: S<n> theo SỐ (S2 trước S10), phần tử lạ xếp sau theo chữ. */
  function sortSlots(arr) {
    return (arr || []).slice().sort(function (a, b) {
      var na = /^S(\d+)$/i.exec(a), nb = /^S(\d+)$/i.exec(b);
      if (na && nb) return Number(na[1]) - Number(nb[1]);
      if (na) return -1;
      if (nb) return 1;
      return String(a).localeCompare(String(b), 'vi');
    });
  }
  /* Lọc dòng StaffData theo nhóm — KHỚP server CsvUtil.filterStaffByGroup: station khớp tuyệt đối,
     mỗi mảng là OR trong chính nó và các điều kiện nối nhau bằng AND. */
  function filterStaff(list, f) {
    var o = f || {};
    var arr = function (v) { return [].concat(v || []); };
    var has = function (vals, v) { return !vals.length || vals.indexOf(String(v || '').trim()) >= 0; };
    var st = String(o.station || '').trim();
    return (list || []).filter(function (s) {
      if (st && String(s.station || '').trim() !== st) return false;
      return has(arr(o.slotCode), s.slotCode) && has(arr(o.team), s.team) &&
        has(arr(o.contractType), s.contractType) && has(arr(o.department), s.department) &&
        has(arr(o.date), s.date);
    });
  }

  /* Giữ dòng ĐẦU theo staffId — KHỚP server dedupeStaffByGroup: StaffData lặp 1 NV nhiều ngày, mỗi người chỉ nạp 1 dòng */
  function dedupeStaff(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (s) {
      var k = String(s.staffId || '');
      if (k && !seen[k]) { seen[k] = 1; out.push(s); }
    });
    return out;
  }

  /* Thế hệ dữ liệu — view mutate xong gọi bumpData(); view khác so dataGen() với thế hệ lúc fetch
     để biết cache của mình đã cũ (thay cho dataset.opsGen trước đây). */
  var GEN = 0;
  function dataGen() { return String(GEN); }
  function bumpData() { GEN += 1; return String(GEN); }
  function badgeStatus(status) {
    var s = String(status || '-');
    var cls = STATUS_CLASS[s] || 'pending';
    return '<span class="badge ' + cls + '">' + esc(s === '-' ? 'Chưa điểm danh' : s) + '</span>';
  }
  function icon(path, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 16) + '" height="' + (size || 16) +
      '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }
  var ICONS = {
    home: '<rect x="3" y="3" width="7.5" height="8.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="5" rx="1.5"/><rect x="13.5" y="10.5" width="7.5" height="10.5" rx="1.5"/><rect x="3" y="14" width="7.5" height="7" rx="1.5"/>',
    stats: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-8"/><path d="M22 20H2"/>',
    schedule: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
    position: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M9 9v11"/>',
    leave: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M12 13v6"/><path d="M9 16h6"/>',
    attendance: '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/>',
    information: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.9-3.2 3.4-5 6.5-5s5.6 1.8 6.5 5"/>',
    personal: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.9-3.6 3.7-5.5 7-5.5s6.1 1.9 7 5.5"/>',
    data: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    admin: '<path d="M12 3l7 3v5c0 4.6-3 8.2-7 10-4-1.8-7-5.4-7-10V6z"/>',
    config: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.3 8L4.2 8a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.3V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5v.5"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v3"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    back: '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
    download: '<path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    play: '<path d="M5 3l14 9-14 9V3z"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 13.5h3"/><path d="M8 17h7"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    alert: '<path d="M12 3l9 16H3z"/><path d="M12 10v4"/><path d="M12 17v.5"/>',
    inbox: '<path d="M3 12l3-8h12l3 8v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 12h5l1 2h6l1-2h5"/>'
  };
  function ico(name, size) { return icon(ICONS[name] || ICONS.about, size); }

  /* ---------- điều hướng tháng (stepper + menu 12 tháng) — 1 chỗ cho Lịch · Vị trí · Xin nghỉ · Dữ liệu ---------- */
  var mnavSeq = 0;
  var mnavOpen = null;   /* { box, btn } của popup đang mở — mỗi lần chỉ 1 popup */
  var mnavPick = null;   /* callback của nav vừa render — monthNav() gán lại mỗi lần vẽ */

  /* Mũi tên stepper — chiều sau dùng icon 'back' lật 180° (.mnav__flip) để không thêm icon thứ hai */
  function navArrow(act, label, flip, attr) {
    return '<button type="button" class="btn-icon" ' + (attr || 'data-mnav-act') + '="' + esc(act) +
      '" aria-label="' + esc(label) + '" title="' + esc(label) + '"><span' +
      (flip ? ' class="mnav__flip"' : '') + '>' + ico('back', 18) + '</span></button>';
  }

  function monthGrid(year, selected) {
    var items = [];
    for (var i = 1; i <= 12; i++) {
      var ym = year + '-' + pad2(i);
      items.push('<button type="button" class="mnav__item' + (ym === selected ? ' on' : '') +
        '" data-mnav-act="pick" data-ym="' + ym + '"' + (ym === selected ? ' aria-current="date"' : '') + '>T' + i + '</button>');
    }
    return '<div class="mnav__year">' +
      '<button type="button" class="btn-icon" data-mnav-act="year" data-delta="-1" aria-label="Năm trước" title="Năm trước"><span>' + ico('back', 16) + '</span></button>' +
      '<b class="mnav__year-label">' + year + '</b>' +
      '<button type="button" class="btn-icon" data-mnav-act="year" data-delta="1" aria-label="Năm sau" title="Năm sau"><span class="mnav__flip">' + ico('back', 16) + '</span></button>' +
      '</div><div class="mnav__grid">' + items.join('') + '</div>';
  }

  /* prev · next · pick đều quy về cùng onPick(ym) — view chỉ việc gán tháng rồi vẽ lại */
  function monthNav(ym, o) {
    var opts = o || {};
    var safe = /^\d{4}-\d{2}$/.test(String(ym || '')) ? String(ym) : isoMonth(new Date());
    mnavPick = typeof opts.onPick === 'function' ? opts.onPick : null;
    var id = 'mnav' + (++mnavSeq);
    return '<div class="stepper mnav' + (opts.cls ? ' ' + opts.cls : '') + '" data-mnav="' + esc(safe) + '">' +
      navArrow('prev', 'Tháng trước', false) +
      '<span class="mnav__box">' +
        '<button type="button" class="mnav__label" data-mnav-act="open" aria-expanded="false" aria-controls="' + id + '-pop">' +
          esc(monthLabel(safe)) + '<span class="mnav__caret">' + ico('chevron', 14) + '</span></button>' +
        '<span class="mnav__popup" id="' + id + '-pop" role="group" aria-label="Chọn tháng" data-year="' + safe.slice(0, 4) + '" hidden></span>' +
      '</span>' + navArrow('next', 'Tháng sau', true) + '</div>';
  }

  function closeMonthNav(refocus) {
    if (!mnavOpen) return;
    var box = mnavOpen.box, btn = mnavOpen.btn;
    mnavOpen = null;
    box.classList.remove('is-open');
    var pop = box.querySelector('.mnav__popup');
    if (pop) { pop.hidden = true; pop.innerHTML = ''; }
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      if (refocus && document.contains(btn)) btn.focus();
    }
  }

  function openMonthNav(box, pop, btn, ym) {
    pop.innerHTML = monthGrid(Number(ym.slice(0, 4)), ym);
    pop.hidden = false;
    box.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
    mnavOpen = { box: box, btn: btn };
    var first = pop.querySelector('.mnav__item.on') || pop.querySelector('.mnav__item');
    if (first) first.focus();
  }

  function onMonthNavClick(e) {
    var t = e.target;
    if (!t.closest) return;
    var box = t.closest('[data-mnav]');
    if (!box) { closeMonthNav(false); return; }
    var btn = t.closest('[data-mnav-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-mnav-act');
    var cur = box.getAttribute('data-mnav') || isoMonth(new Date());
    var pop = box.querySelector('.mnav__popup');
    var label = box.querySelector('.mnav__label');
    if (act === 'prev' || act === 'next') {
      closeMonthNav(false);
      if (mnavPick) mnavPick(shiftMonth(cur, act === 'next' ? 1 : -1));
    } else if (act === 'pick') {
      closeMonthNav(false);
      if (mnavPick) mnavPick(btn.getAttribute('data-ym'));
    } else if (act === 'year' && pop) {
      /* data-delta giữ tên nút qua mỗi lần vẽ lại ô lịch năm — focus ở lại đúng mũi tên vừa bấm */
      var d = Number(btn.getAttribute('data-delta'));
      var y = Number(pop.getAttribute('data-year')) + d;
      pop.setAttribute('data-year', y);
      pop.innerHTML = monthGrid(y, cur);
      var again = pop.querySelector('[data-delta="' + d + '"]');
      if (again) again.focus();
    } else if (act === 'open' && pop && label) {
      if (pop.hidden) openMonthNav(box, pop, label, cur); else closeMonthNav(true);
    }
  }

  function onMonthNavKeydown(e) {
    if (!mnavOpen) return;
    var pop = mnavOpen.box.querySelector('.mnav__popup');
    if (!pop || !pop.contains(e.target)) return;
    if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].indexOf(e.key) < 0) return;
    var list = Array.prototype.slice.call(pop.querySelectorAll('.mnav__item'));
    var at = list.indexOf(document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    var step = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
    list[(at + step + list.length) % list.length].focus();
  }

  /* ---------- quyền ---------- */
  function atLeast(min) {
    if (min === 'editor') return !!state.isEditor;
    return (ROLE_RANK[state.role] || 0) >= (ROLE_RANK[min] || 99);
  }
  function visiblePages() {
    if (state.pages && state.pages.length) {
      return Object.keys(PAGE_META).filter(function (p) { return state.pages.indexOf(p) >= 0; });
    }
    return Object.keys(PAGE_META).filter(function (p) {
      var gate = SIDE_ROLES[p];
      if (gate === undefined) return true;
      if (p === 'config') return !!state.isEditor;
      if ((p === 'schedule' || p === 'schedule-personal' || p === 'schedule-daily' ||
           p === 'information' || p === 'leave') && !state.canViewSchedule) return false;
      return atLeast(gate);
    });
  }

  /* ---------- sidebar + routing ---------- */
  var SIDE_ICON = { 'schedule-personal': 'personal', 'schedule-daily': 'calendar' };
  function renderSidebar() {
    var nav = document.getElementById('sideNav');
    if (!nav) return;
    var groups = {}, order = [];
    /* noNav (scan): chỉ vào được từ danh sách task/home — khớp prod, route vẫn mở qua openScan() */
    visiblePages().filter(function (p) { return !PAGE_META[p].noNav; }).forEach(function (p) {
      var m = PAGE_META[p];
      if (!groups[m.group]) { groups[m.group] = []; order.push(m.group); }
      groups[m.group].push({ key: p, m: m });
    });
    var html = order.map(function (g) {
      return '<div class="side-group">' + esc(g) + '</div>' + groups[g].map(function (it) {
        return '<button type="button" class="side-item' + (it.key === state.page ? ' active' : '') +
          '" data-page="' + esc(it.key) + '" aria-current="' + (it.key === state.page ? 'page' : 'false') +
          '" title="' + esc(it.m.label) + '">' +
          ico(SIDE_ICON[it.key] || it.key, 18) +
          '<span class="side-lbl">' + esc(it.m.label) + '</span>' +
          '<span class="side-count" data-count="' + esc(it.key) + '" hidden></span></button>';
      }).join('');
    }).join('');
    nav.innerHTML = html;
    nav.querySelectorAll('.side-item').forEach(function (b) {
      b.addEventListener('click', function () { selectPage(b.getAttribute('data-page')); });
    });
    Object.keys(SIDE_COUNTS).forEach(applyCount);
  }

  function setPageChrome(page) {
    var m = PAGE_META[page] || PAGE_META.home;
    var host = document.getElementById('viewChrome');
    if (host) {
      host.innerHTML =
        '<div class="view-topbar-eyebrow" id="pageEyebrow">' + esc(m.eyebrow) + '</div>' +
        '<h1 class="task-title" id="pageTitle">' + esc(m.title) + '</h1>' +
        '<div class="task-meta" id="pageDesc">' + esc(m.desc) + '</div>';
    }
    var crumb = document.getElementById('breadcrumb');
    if (crumb) {
      crumb.innerHTML = '<span>' + esc(m.group) + '</span><span aria-hidden="true">/</span><span aria-current="page">' +
        esc(m.label) + '</span>';
    }
    var act = document.getElementById('pageActions');
    if (act) act.innerHTML = '';
    document.title = m.title + ' · SPX SOC Portal';
  }

  /* Nút điều khiển của mọi view đổ vào slot chung — 1 nguồn bố cục đầu trang (hợp đồng §3c) */
  function pageActions(html) {
    var act = document.getElementById('pageActions');
    if (act) act.innerHTML = html;
    return act;
  }

  function showSection(id) {
    document.querySelectorAll('section[id^="view"]').forEach(function (s) {
      s.classList.toggle('hidden', s.id !== id);
    });
    var wrap = document.getElementById('main-content');
    if (wrap) wrap.scrollTop = 0;
  }

  function selectPage(page) {
    if (!PAGE_META[page]) page = 'home';
    if (visiblePages().indexOf(page) < 0) page = 'home';
    state.page = page;
    showSection(PAGE_META[page].section);
    setPageChrome(page);
    renderSidebar();
    document.body.classList.remove('drawer-open');
    var v = views[page];
    if (v && v.render) {
      try { v.render({ force: false }); } catch (e) { toast('Lỗi hiển thị: ' + e.message, 'err'); }
    }
    if (location.hash.slice(1) !== page) history.replaceState(null, '', '#' + page);
    tickClock();
  }

  /* Preview phân quyền — bản mock mới có; server thật bỏ vì api.personas không tồn tại */
  function renderRolePreview() {
    var host = document.getElementById('sideRoles');
    if (!host) return;
    var list = api.personas;
    if (!list) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;
    var GRPS = [['station', 'Station'], ['khac', 'Khác station'], ['quantri', 'Quản trị']];
    host.innerHTML = '<span class="side-roles__label">Xem với quyền</span>' + GRPS.map(function (gr) {
      var items = list.filter(function (p) { return (p.group || 'station') === gr[0]; });
      if (!items.length) return '';
      return '<span class="side-roles__group">' + esc(gr[1]) + '</span>' + items.map(function (p) {
        var on = p.key === state.personaKey;
        return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-persona="' + esc(p.key) +
          '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(p.label) + '</button>';
      }).join('');
    }).join('');
    host.querySelectorAll('[data-persona]').forEach(function (b) {
      b.addEventListener('click', function () { setPersona(b.getAttribute('data-persona')); });
    });
  }

  function setPersona(key) {
    api.setPersona(key).then(function (r) {
      if (!r || !r.ok) return;
      state.role = r.role; state.isEditor = !!r.isEditor;
      state.email = r.email || state.email; state.opsId = r.opsId || ''; state.name = r.name || '';
      state.station = r.station || ''; state.scope = r.scope || 'trong-tram';
      state.pages = r.pages || null; state.deny = r.deny || []; state.personaKey = r.key || '';
      var rl = document.getElementById('sideRole');
      if (rl) rl.textContent = (r.isEditor ? 'editor · ' : '') + r.role;
      ['userEmailM2', 'userEmail'].forEach(function (id) {
        var el = document.getElementById(id); if (el) el.textContent = state.email;
      });
      var av = document.getElementById('sideAvatar'); if (av) av.textContent = initials(state.email || 'KH');
      renderRolePreview(); renderSidebar();
      selectPage(visiblePages().indexOf(state.page) < 0 ? 'home' : state.page);
      toast('Đang xem với quyền ' + r.role);
    });
  }

  function registerView(page, def) { views[page] = def; }
  function refreshView(page) {
    var v = views[page || state.page];
    if (v && v.render) v.render({ force: true });
  }
  /* Bo dem sidebar: giu gia tri qua các lan ve lại nav — renderSidebar trước đây reset
     hidden=true khiên đếm "lúc hiện lúc không" (chỉ home goi setCount). */
  var SIDE_COUNTS = {};
  function applyCount(page) {
    var el = document.querySelector('[data-count="' + page + '"]');
    if (!el) return;
    var has = Object.prototype.hasOwnProperty.call(SIDE_COUNTS, page);
    el.hidden = !has;
    if (has) el.textContent = SIDE_COUNTS[page];
  }
  function setCount(page, n) {
    if (n === null || n === undefined || n === '') delete SIDE_COUNTS[page];
    else SIDE_COUNTS[page] = n;
    applyCount(page);
  }

  /* ---------- theme ---------- */
  function setTheme(dark) {
    document.body.classList.toggle('dark', !!dark);
    try { localStorage.setItem('soc3-theme', dark ? 'dark' : 'light'); } catch (e) {}
    $$('[data-action="theme"]').forEach(function (b) {
      b.setAttribute('aria-pressed', dark ? 'true' : 'false');
      b.setAttribute('title', dark ? 'Tắt giao diện tối' : 'Bật giao diện tối');
    });
  }
  function toggleTheme() { setTheme(!document.body.classList.contains('dark')); }

  /* Chuông xác nhận — 1 nguồn cho mọi view (scan/để bàn), nhớ lựa chọn qua localStorage */
  function setSound(on) {
    state.sound = !!on;
    try { localStorage.setItem('soc3-sound', on ? 'on' : 'off'); } catch (e) {}
    $$('[data-action="sound"]').forEach(function (b) {
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('title', on ? 'Tắt âm thanh' : 'Mở âm thanh');
      b.classList.toggle('is-off', !on);
    });
  }
  function toggleSound() { setSound(!state.sound); }
  function beep(kind) {
    if (!state.sound) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx(), o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine';
      o.frequency.value = kind === 'err' ? 320 : kind === 'extra' ? 660 : 880;
      g.gain.value = .05;
      o.start(); o.stop(ctx.currentTime + (kind === 'err' ? .22 : .1));
      o.onended = function () { ctx.close(); };
    } catch (e) {}
  }

  /* ---------- toast / confirm / busy ---------- */
  var toastTimer = null;
  function toast(msg, kind) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 3200);
  }
  /* Bẫy focus cho modal — Tab/Shift+Tab quay vòng trong container; release() khi đóng (ui-polish: focus trap) */
  function trapFocus(container) {
    function onKey(e) {
      if (e.key !== 'Tab') return;
      var nodes = container.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
      var list = Array.prototype.filter.call(nodes, function (el) { return el.offsetParent !== null; });
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey, true);
    return function release() { document.removeEventListener('keydown', onKey, true); };
  }

  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      var root = document.getElementById('confirmModal');
      document.getElementById('confirmModalTitle').textContent = opts.title || 'Xác nhận';
      document.getElementById('confirmModalMsg').textContent = opts.message || '';
      var ok = document.getElementById('confirmOkBtn');
      ok.textContent = opts.okLabel || 'Đồng ý';
      root.classList.remove('hidden');
      root.setAttribute('aria-hidden', 'false');
      var release = trapFocus(root);
      function onEsc(e) { if (e.key === 'Escape') { e.stopPropagation(); done(false); } }
      document.addEventListener('keydown', onEsc, true);
      function done(v) {
        document.removeEventListener('keydown', onEsc, true);
        release();
        root.classList.add('hidden'); root.setAttribute('aria-hidden', 'true');
        ok.removeEventListener('click', onOk); root.removeEventListener('click', onBg);
        resolve(v);
      }
      function onOk() { done(true); }
      function onBg(e) { if (e.target === root) done(false); }
      ok.addEventListener('click', onOk); root.addEventListener('click', onBg);
      document.getElementById('confirmCancelBtn').onclick = function () { done(false); };
      ok.focus();
    });
  }
  function setBtnBusy_(btn, busy, text) {
    if (!btn) return;
    if (busy) {
      btn.dataset.prevHtml = btn.innerHTML;
      btn.classList.add('is-busy'); btn.setAttribute('disabled', 'disabled');
      btn.innerHTML = '<span class="btn-label">' + esc(text || 'Đang xử lý') + '</span>';
    } else {
      btn.classList.remove('is-busy'); btn.removeAttribute('disabled');
      if (btn.dataset.prevHtml) btn.innerHTML = btn.dataset.prevHtml;
    }
  }

  /* ---------- dữ liệu nền ---------- */
  var meta = { role: 'operator', email: '', isEditor: false, canViewSchedule: true, appTitle: 'SOC Portal' };
  function getMeta() { return meta; }

  function boot(onReady) {
    var saved = 'light';
    try { saved = localStorage.getItem('soc3-theme') || 'light'; } catch (e) {}
    setTheme(saved === 'dark');
    var snd = 'on';
    try { snd = localStorage.getItem('soc3-sound') || 'on'; } catch (e) {}
    setSound(snd !== 'off');

    api.getMetaApi().then(function (r) {
      if (r && r.ok) {
        meta = r; state.role = r.role || 'operator'; state.email = r.userEmail || '';
        state.opsId = r.opsId || ''; state.name = r.name || '';
        state.station = r.station || ''; state.scope = r.scope || 'trong-tram';
        state.pages = r.pages || null; state.deny = r.deny || []; state.personaKey = r.key || 'admin';
        state.isEditor = !!r.isEditor; state.canViewSchedule = r.canViewSchedule !== false;
      }
      var mail = meta.userEmail || 'Khách (chưa đăng nhập)';
      ['userEmailM2', 'userEmail'].forEach(function (id) {
        var el = document.getElementById(id); if (el) el.textContent = mail;
      });
      var av = document.getElementById('sideAvatar'); if (av) av.textContent = initials(meta.email || 'KH');
      var rl = document.getElementById('sideRole'); if (rl) rl.textContent = meta.isEditor ? 'editor · ' + meta.role : meta.role;
      var bt = document.getElementById('brandTitle'); if (bt) bt.textContent = meta.appTitle || 'SOC Portal';
      document.getElementById('loadingOverlay').classList.add('hidden');
      renderSidebar();
      renderRolePreview();
      selectPage((location.hash || '').slice(1) || 'home');
      if (onReady) onReady();
    }).catch(function (e) {
      document.getElementById('loadingOverlay').classList.add('hidden');
      toast('Không tải được cấu hình: ' + e.message, 'err');
    });
  }

  /* Đồng hồ trang chủ + giờ sidebar — 1 nguồn, gọi lại ngay khi render để không nhấp nháy '--:--:--' */
  function tickClock() {
    var x = new Date();
    var clk = document.getElementById('homeClock');
    if (clk) clk.textContent = pad2(x.getHours()) + ':' + pad2(x.getMinutes()) + ':' + pad2(x.getSeconds());
    var dt = document.getElementById('homeDate');
    if (dt) dt.textContent = 'Hôm nay ' + fmtDate(x) + ' · thứ ' + ['CN', '2', '3', '4', '5', '6', '7'][x.getDay()];
    var sc = document.getElementById('clockText');
    if (sc) sc.textContent = 'Đồng bộ ' + fmtClock(x);
  }

  /* ---------- wire chrome tĩnh ---------- */
  /* Nút chrome sống ở 2 nơi (sidebar desktop + header mobile) — wire theo data-action, không theo id,
     để id duy nhất còn dùng cho label/aria. */
  function toggleCompact() {
    var min = document.body.classList.toggle('side-min');
    try { localStorage.setItem('soc3-side', min ? 'min' : 'max'); } catch (e) {}
    $$('[data-action="compact"]').forEach(function (b) { b.setAttribute('aria-pressed', min ? 'true' : 'false'); });
  }

  function wireChrome() {
    $$('[data-action="theme"]').forEach(function (b) { b.addEventListener('click', toggleTheme); });
    $$('[data-action="sound"]').forEach(function (b) { b.addEventListener('click', toggleSound); });
    $$('[data-action="refresh"]').forEach(function (b) {
      b.addEventListener('click', function () { refreshView(); toast('Đã tải lại dữ liệu'); });
    });
    $$('[data-action="compact"]').forEach(function (b) { b.addEventListener('click', toggleCompact); });
    $$('[data-action="drawer"]').forEach(function (b) {
      b.addEventListener('click', function () {
        var open = document.body.classList.toggle('drawer-open');
        $$('[data-action="drawer"]').forEach(function (x) { x.setAttribute('aria-expanded', open ? 'true' : 'false'); });
      });
    });
    try { if (localStorage.getItem('soc3-side') === 'min') document.body.classList.add('side-min'); } catch (e) {}
    var scrim = document.getElementById('drawerScrim');
    if (scrim) scrim.addEventListener('click', function () { document.body.classList.remove('drawer-open'); });
    window.addEventListener('hashchange', function () { selectPage((location.hash || '').slice(1)); });
    document.addEventListener('click', onMonthNavClick);
    document.addEventListener('keydown', onMonthNavKeydown);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (mnavOpen) { closeMonthNav(true); return; }
      document.body.classList.remove('drawer-open');
    });
    setInterval(tickClock, 1000);
    tickClock();
  }

  /* ---------- rosterPivot — component chung: pivot Ca × nhóm hợp đồng ----------
     Modal "Nạp danh sách" (view-scan) và "Tạo task" (view-tasks) cùng dùng. Host DOM phải có:
     [data-rsf=station|date|team|dept] · [data-slot="pivot"] · [data-slot="seltext"] ·
     [data-act="rs.clear"] · [data-act="rs.load"]. opts: { staffList,
     catalogs:{stations,slots,teams,departments}, loadLabel: string, allowEmpty: bool }.
     Bucket hợp đồng không có contractType nào trong dữ liệu đang lọc = 0 người — mảng rỗng lọt
     vào filterStaff là thành "không lọc" và đếm/nạp cả ca (bug P1 2026-09-26, đừng regress). */
  function rosterPivot(host, opts) {
    var BUCKETS = ['FTE', 'BPO', 'OS'];
    var o = opts || {};
    var st = { station: '', date: '', team: '', dept: '', sel: {} };

    function rows() {
      return filterStaff(o.staffList || [], {
        station: st.station,
        date: st.date ? [st.date] : [],
        team: st.team ? [st.team] : [],
        department: st.dept ? [st.dept] : []
      });
    }
    function bucketOf(v) {
      var s = String(v || '').trim().toUpperCase();
      if (s === 'OS') return 'OS';
      if (s.indexOf('BPO') >= 0) return 'BPO';
      if (s.indexOf('FTE') >= 0) return 'FTE';
      return '';
    }
    /* Bucket → contractType THẬT trong dữ liệu: server so khớp exact nên không được gửi tên nhóm */
    function expand(bkt, list) {
      if (!bkt) return [];
      var out = [];
      (list || []).forEach(function (s) {
        var raw = String(s.contractType || '').trim();
        if (raw && bucketOf(raw) === bkt && out.indexOf(raw) < 0) out.push(raw);
      });
      return out;
    }
    function cellFilter(list, slot, bkt) {
      var types = bkt ? expand(bkt, list) : [];
      if (bkt && !types.length) return null;
      return { slotCode: slot ? [slot] : [], contractType: types };
    }
    /* Đếm 1 ô = lọc rồi diệt trùng — số trên ô phải bằng đúng số dòng server sẽ nạp */
    function cellCount(list, slot, bkt) {
      var f = cellFilter(list, slot, bkt);
      return f ? dedupeStaff(filterStaff(list, f)).length : 0;
    }
    function selectedStaff() {
      var seen = {}, out = [];
      var list = rows();
      Object.keys(st.sel).forEach(function (k) {
        var it = st.sel[k];
        var f = cellFilter(list, it.slot, it.bucket);
        if (!f) return;
        filterStaff(list, f).forEach(function (s) { if (!seen[s.staffId]) { seen[s.staffId] = 1; out.push(s); } });
      });
      return out;
    }
    /* Giá trị lọc lấy từ dòng thật rồi xếp theo danh mục Cấu hình — không hiện lựa chọn 0 NV */
    function facet(list, field, order) {
      var vals = uniq((list || []).map(function (s) { return s[field]; }));
      var cat = order || [];
      return vals.sort(function (a, b) {
        var ia = cat.indexOf(a), ib = cat.indexOf(b);
        return (ia < 0 ? 1e4 : ia) - (ib < 0 ? 1e4 : ib) || (a < b ? -1 : a > b ? 1 : 0);
      });
    }
    function options(vals, cur, emptyLabel) {
      return '<option value="">' + esc(emptyLabel) + '</option>' +
        vals.map(function (v) {
          return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>';
        }).join('');
    }
    function emptyHtml(title, desc) {
      return '<div class="rp__empty"><span class="rp__empty-ico" aria-hidden="true">' + ico('inbox', 22) + '</span>' +
        '<div class="rp__empty-title">' + esc(title) + '</div><p class="mode-desc">' + esc(desc) + '</p></div>';
    }
    function cellHtml(list, slot, bkt, isTotal) {
      var n = cellCount(list, slot, bkt);
      var td = isTotal ? ' class="total"' : '';
      if (!n) return '<td' + td + '><span class="rp__zero">—</span></td>';
      var key = (slot || '') + '|' + (bkt || '');
      var on = !!st.sel[key];
      var lbl = (slot ? 'Ca ' + slot : 'Mọi ca') + ' · ' + (bkt || 'Mọi hợp đồng') + ' · ' + n + ' NV';
      var title = '';
      if (isTotal) {
        var other = n - BUCKETS.reduce(function (a, b) { return a + cellCount(list, slot, b); }, 0);
        if (other > 0) title = ' title="Gồm ' + other + ' NV hợp đồng ngoài 3 nhóm — chọn cùng ô này"';
      }
      return '<td' + td + '><button type="button" class="rp__cell' + (on ? ' is-on' : '') + '" data-cell="' +
        esc(key) + '" aria-pressed="' + (on ? 'true' : 'false') + '" aria-label="' + esc(lbl) + '"' +
        title + '>' + n + '</button></td>';
    }
    function paintPivot(list) {
      var wrap = host.querySelector('[data-slot="pivot"]');
      if (!wrap) return;
      if (!st.station) { wrap.innerHTML = emptyHtml('Chưa chọn Station', 'Chọn Station để xem phân bố nhân viên theo ca.'); return; }
      if (!list.length) { wrap.innerHTML = emptyHtml('Không có dữ liệu', 'Không tìm thấy nhân viên khớp bộ lọc đã chọn.'); return; }
      var cat = o.catalogs || {};
      var slots = facet(list, 'slotCode', cat.slots || []);
      var html = '<table class="rp__t"><caption class="sr-only">' +
        'Số nhân viên mỗi ca theo nhóm hợp đồng — bấm vào ô để chọn</caption><thead><tr><th scope="col">Ca</th>' +
        BUCKETS.map(function (b) { return '<th scope="col">' + b + '</th>'; }).join('') +
        '<th scope="col" class="total">Tổng</th></tr></thead><tbody>';
      slots.forEach(function (s) {
        html += '<tr><th scope="row">' + slotCell(s) + '</th>';
        BUCKETS.forEach(function (b) { html += cellHtml(list, s, b, false); });
        html += cellHtml(list, s, null, true) + '</tr>';
      });
      html += '</tbody><tfoot><tr><th scope="row">Tổng</th>';
      BUCKETS.forEach(function (b) { html += cellHtml(list, null, b, true); });
      html += cellHtml(list, null, null, true) + '</tr></tfoot></table>';
      wrap.innerHTML = html;
    }
    function paintFoot() {
      var txt = host.querySelector('[data-slot="seltext"]');
      var load = host.querySelector('[data-act="rs.load"]');
      var clear = host.querySelector('[data-act="rs.clear"]');
      var label = load && load.querySelector('.btn-label');
      var keys = Object.keys(st.sel);
      var n = selectedStaff().length;
      var base = o.loadLabel || 'Nạp';
      if (!st.station) {
        if (txt) txt.innerHTML = '<span class="rp__hint">Chọn Station để xem phân bố nhân viên.</span>';
        if (load) load.disabled = true;
        if (clear) clear.disabled = true;
        if (label) label.textContent = base;
        return;
      }
      if (!keys.length || !n) {
        if (txt) txt.innerHTML = '<span class="rp__hint">' +
          (o.allowEmpty ? 'Chưa chọn ô nào — sẽ tạo task không kèm danh sách.' : 'Chưa chọn — bấm vào ô trong bảng để chọn.') + '</span>';
        if (load) { load.disabled = !o.allowEmpty; if (label) label.textContent = base; }
        if (clear) clear.disabled = true;
        return;
      }
      if (load) { load.disabled = false; if (label) label.textContent = base + ' (' + n + ')'; }
      if (clear) clear.disabled = false;
      if (!txt) return;
      if (keys.length === 1) {
        var it = st.sel[keys[0]];
        txt.innerHTML = '<span class="rp__pill"><span class="rp__hint">Đã chọn:</span> <b>' +
          esc(it.slot ? 'Ca ' + it.slot : 'Mọi ca') + '</b> · <b>' + esc(it.bucket || 'Mọi hợp đồng') +
          '</b><span class="rp__qty">' + n + ' NV</span></span>';
      } else {
        txt.innerHTML = '<span class="rp__pill"><span class="rp__hint">Đã chọn:</span> <b>' + keys.length +
          ' ô</b><span class="rp__qty">' + n + ' NV</span></span>';
      }
    }
    function paintFilters() {
      var q = function (f) { return host.querySelector('[data-rsf="' + f + '"]'); };
      var cat = o.catalogs || {};
      var stSel = q('station');
      if (stSel) stSel.innerHTML = options(cat.stations || [], st.station, 'Chọn Station…');
      var inStation = st.station ? filterStaff(o.staffList || [], { station: st.station }) : (o.staffList || []);
      var dates = facet(inStation, 'date', []);
      if (st.date && dates.indexOf(st.date) < 0) st.date = '';
      var dSel = q('date');
      if (dSel) dSel.innerHTML = options(dates, st.date, 'Mọi ngày');
      var scoped = st.date ? filterStaff(inStation, { date: [st.date] }) : inStation;
      var teams = facet(scoped, 'team', cat.teams || []);
      if (st.team && teams.indexOf(st.team) < 0) st.team = '';
      var tSel = q('team');
      if (tSel) tSel.innerHTML = options(teams, st.team, 'Tất cả');
      var depts = facet(scoped, 'department', cat.departments || []);
      if (st.dept && depts.indexOf(st.dept) < 0) st.dept = '';
      var pSel = q('dept');
      if (pSel) pSel.innerHTML = options(depts, st.dept, 'Tất cả');
    }
    function render() {
      paintFilters();
      paintPivot(rows());
      paintFoot();
    }
    function pick(field, value) {
      if (field === 'station') {
        st.station = value;
        st.team = '';
        st.dept = '';
        var dates = facet(value ? filterStaff(o.staffList || [], { station: value }) : o.staffList, 'date', []);
        st.date = dates.length ? dates[dates.length - 1] : '';
      } else {
        st[field] = value;
      }
      /* Đổi lọc là bỏ ngay ô đã trống — giữ lựa chọn ở ô 0 NV sẽ nạp số khác với số từng hiện trên ô */
      var list = rows();
      Object.keys(st.sel).forEach(function (k) {
        var it = st.sel[k];
        if (!cellCount(list, it.slot, it.bucket)) delete st.sel[k];
      });
      render();
    }
    function toggleCell(key) {
      if (st.sel[key]) delete st.sel[key];
      else {
        var p = key.split('|');
        st.sel[key] = { slot: p[0] || null, bucket: p[1] || null };
      }
      render();
    }
    function clearSel() { st.sel = {}; render(); }
    function setLocked(on) {
      Array.prototype.forEach.call(host.querySelectorAll('[data-rsf], [data-cell], [data-act="rs.clear"]'), function (el) {
        el.disabled = on;
      });
    }
    /* cells[] là lựa chọn thật; slotCode/contractType flatten chỉ để server ghi metadata task */
    function cells() {
      var list = rows();
      return Object.keys(st.sel).map(function (k) {
        var it = st.sel[k];
        return { slotCode: it.slot ? [it.slot] : [], contractType: it.bucket ? expand(it.bucket, list) : [] };
      });
    }
    function flatCellField(field) {
      var out = [];
      cells().forEach(function (c) {
        c[field].forEach(function (v) { if (out.indexOf(v) < 0) out.push(v); });
      });
      return out;
    }
    return {
      state: st, render: render, pick: pick, toggleCell: toggleCell, clearSel: clearSel,
      setLocked: setLocked, cells: cells, flatCellField: flatCellField,
      selectedStaff: selectedStaff, selectedCount: function () { return selectedStaff().length; }
    };
  }

  /* api gán ở api.js — khai báo sớm để boot() tham chiếu được */
  var api = {};

  return {
    PAGE_META: PAGE_META, ICONS: ICONS, state: state, api: api,
    registerView: registerView, selectPage: selectPage, refreshView: refreshView, setCount: setCount,
    showSection: showSection, renderSidebar: renderSidebar, visiblePages: visiblePages,
    atLeast: atLeast, getMeta: getMeta, boot: boot, wireChrome: wireChrome,
    openScan: openScan, currentScanTask: function () { return SCAN_TASK; }, consumeScanRoster: consumeScanRoster,
    setTheme: setTheme, toggleTheme: toggleTheme, setSound: setSound, toggleSound: toggleSound, beep: beep,
    toast: toast, confirm: confirmDialog, setBtnBusy_: setBtnBusy_, pageActions: pageActions, trapFocus: trapFocus,
    esc: esc, ico: ico, icon: icon, badgeShift: badgeShift, badgeStatus: badgeStatus, shiftCategory: shiftCategory,
    splitList: splitList, slotCell: slotCell, uniq: uniq, sortSlots: sortSlots, dataGen: dataGen, bumpData: bumpData,
    filterStaff: filterStaff, dedupeStaff: dedupeStaff, rosterPivot: rosterPivot,
    fmtDate: fmtDate, fmtClock: fmtClock, fmtTimeText: fmtTimeText,
    isoDay: isoDay, isoMonth: isoMonth, monthLabel: monthLabel, daysInMonth: daysInMonth, initials: initials, pad2: pad2,
    shiftMonth: shiftMonth, navArrow: navArrow, monthNav: monthNav
  };
})();
