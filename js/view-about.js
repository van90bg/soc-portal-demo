/* view-about.js — Giới thiệu: quy trình điểm danh, ký hiệu ca, phân quyền, cơ chế hẹn giờ/tự đóng, phím tắt.
   Trang tài liệu — không gọi API; chỉ đọc quyền hiện hành từ SOC.state do getMetaApi điền lúc boot. */
(function () {
  'use strict';

  var ROLE_NAMES = ['viewer', 'operator', 'manager', 'admin'];
  var ROLE_TXT = {
    viewer: {
      see: 'Trang chủ · Lịch tháng / Lịch ngày / Lịch cá nhân · Vị trí · Nhân sự · Giới thiệu',
      do: 'Xem dữ liệu của team mình. Không tạo task, không quét, không sửa bất cứ gì.',
      note: 'Nhân sự chỉ hiện người còn hợp lệ; mục Lịch cần tên bạn có trong danh bạ.'
    },
    operator: {
      see: 'Toàn bộ nhóm viewer + Điểm danh · Màn quét · Đăng ký nghỉ',
      do: 'Tạo task, nạp danh sách, quét mã, bàn giao, đóng/mở lại task, gửi và hủy đơn nghỉ của mình.',
      note: 'Không sửa được ca trong lịch tháng và không xem được Thống kê/Dữ liệu.'
    },
    manager: {
      see: 'Toàn bộ nhóm operator + Thống kê · Dữ liệu',
      do: 'Sửa phân công vị trí theo cửa, tra lịch sử quét của từng mã OPS, đọc báo cáo hợp đồng × ca.',
      note: 'Vẫn không duyệt đơn nghỉ và không sửa được danh bạ.'
    },
    admin: {
      see: 'Toàn bộ app + Quản trị · Cấu hình',
      do: 'Duyệt/từ chối đơn, ghi ca nghỉ vào lịch, thêm/sửa/vô hiệu hóa nhân sự, chỉnh cấu hình, đọc nhật ký.',
      note: 'Kèm cờ editor nên lưu được danh mục Station/Team/Ca và bảng phân quyền.'
    }
  };
  var SCAN_STATUS = [
    ['Đã điểm danh', 'Đã quét đủ lượt cần của ca.'],
    ['-', 'Có trong danh sách nhưng chưa quét — hiện chữ “Chưa điểm danh”.'],
    ['Vắng', 'Đã đóng task mà người này chưa có giờ quét. Mở lại task để quét bù.'],
    ['Dư', 'Mã quét không có trong danh sách của ca — vẫn ghi để xử lý ngoại lệ.']
  ];
  var SHIFTS = [
    ['S1', 'Shift 1', '4:00–13:00'], ['S2', 'Shift 2', '5:00–14:00'], ['S3', 'Shift 3', '6:00–15:00'],
    ['S4', 'Shift 4', '7:00–16:00'], ['S5', 'Shift 5', '8:00–17:00'], ['S6', 'Shift 6', '9:00–18:00'],
    ['S7', 'Shift 7', '10:00–19:00'], ['S8', 'Shift 8', '11:00–20:00'], ['S9', 'Shift 9', '12:00–21:00'],
    ['S10', 'Shift 10', '13:00–22:00'], ['S11', 'Shift 11', '14:00–23:00'], ['S12', 'Shift 12', '15:00–0:00'],
    ['S13', 'Shift 13', '16:00–1:00'], ['S14', 'Shift 14', '17:00–1:00'], ['S15', 'Shift 15', '18:00–2:00'],
    ['S16', 'Shift 16', '19:00–3:00'], ['S17', 'Shift 17', '20:00–4:00'], ['S18', 'Shift 18', '21:00–5:00'],
    ['S19', 'Shift 19', '22:00–6:00']
  ];
  var REST_CODES = [
    ['OFF', 'Weekly Day Off', 'Nghỉ tuần'], ['PH', 'Public Holiday', 'Nghỉ lễ, Tết'],
    ['HL', 'Hospitalisation Leave', 'Ốm nằm viện'], ['AL', 'Annual Leave', 'Nghỉ phép năm'],
    ['SL', 'Sick Leave', 'Nghỉ ốm'], ['MAL', 'Marriage Leave', 'Nghỉ cưới'],
    ['CL', 'Compassionate Leave', 'Nghỉ tang chế'], ['PL', 'Paternity Leave', 'Thai sản nam'],
    ['ML', 'Maternity Leave', 'Thai sản nữ'], ['OIL', 'Off In Lieu', 'Nghỉ bù'],
    ['NPL', 'No Pay Leave', 'Nghỉ không lương']
  ];
  var TIMING = [
    ['Hàng đợi thao tác', 'Mỗi lệnh ghi (đóng task, bàn giao, sửa trạng thái, lưu hàng loạt…) xếp hàng FIFO: mỗi lần chỉ gửi một yêu cầu, tối đa 20 lệnh chờ. Nhấp đúp không tạo hai lần ghi.'],
    ['Watchdog 20 giây', 'Một lệnh treo quá 20 giây (máy chủ lạnh, mạng đứt) bị coi là fail: nút nhả trạng thái bận và hiện thông báo để bấm lại.'],
    ['Chờ đồng bộ quét 15 giây', 'Bàn giao và Đóng task chỉ được gửi khi hàng đợi quét đã trống. Sau 15 giây vẫn còn quét chờ, hệ thống hoàn tác nút và báo “bấm lại”.'],
    ['Mất mạng', 'Mã quét chưa gửi được giữ lại trong máy và tự gửi khi có mạng. Chấm xanh/đỏ ở thẻ “Kết nối hệ thống” và bộ đếm “việc nền” cho biết còn lệnh nào đang chờ.'],
    ['Tab quét riêng', 'Mở màn quét ở cửa sổ riêng cho thiết bị cầm tay; cửa sổ đó tự đóng khi task chuyển sang Đã đóng, hoặc khi ta mở một task khác — tránh quét nhầm ca.'],
    ['Thẻ người vừa quét', 'Không tự ẩn theo hẹn giờ. Thẻ giữ nguyên đến lần quét kế tiếp hoặc đến khi đổi task.'],
    ['Không có hẹn giờ phía máy chủ', 'Không có lịch chạy tự động nào đóng ca hay trừ phép. Chỉ khi admin duyệt đơn nghỉ thì ngày đó mới bị ghi loại nghỉ lên lịch.']
  ];
  var KEYS = [
    ['Enter', 'Trong ô quét: gửi ngay mã đang có. Mã task và mã NV tra bằng ô tìm ngay trong từng màn.'],
    ['Esc', 'Đóng hộp thoại và xác nhận, xóa từ khóa đang gõ, đóng menu drawer trên điện thoại.']
  ];

  function abSec() { return document.getElementById('viewAbout'); }

  function abCard(icon, title, body, extra) {
    return '<div class="card card--fit">' +
      '<div class="card__head"><h2 class="section-heading">' + SOC.ico(icon, 16) + '<span>' + title + '</span>' +
      (extra || '') + '</div>' +
      '<div class="pane">' + body + '</div>' +
    '</div>';
  }

  function abDefs(pairs) {
    return '<dl class="defs">' + pairs.map(function (p) {
      return '<dt>' + p[0] + '</dt><dd>' + p[1] + '</dd>';
    }).join('') + '</dl>';
  }

  function abStepper() {
    var steps = [['1', 'Mở ca', 'is-on'], ['2', 'Bàn giao → Điểm danh', ''], ['3', 'Đóng task', '']];
    return '<div class="stepper">' + steps.map(function (s, i) {
      return (i ? '<span class="stepper__sep" aria-hidden="true"></span>' : '') +
        '<div class="stepper__step ' + s[2] + '"><span class="stepper__dot">' + s[0] + '</span><span>' + s[1] + '</span></div>';
    }).join('') + '</div>';
  }

  function abIntroBody() {
    return '<p class="ab-p">SPX SOC Portal ghi nhận điểm danh theo ca và cho xem lịch làm việc của team kho — dữ liệu nằm trên bảng tính, mở bằng trình duyệt trên máy tính, tablet hay điện thoại đều dùng được.</p>' +
      abDefs([
        ['Điểm danh', 'Quét mã từng người ở đầu ca và lần nữa khi bàn giao, để lại dấu vết giờ vào/ra cho từng ca.'],
        ['Lịch', 'Đọc lịch tháng của kho: ai làm ca nào ngày nào, nghỉ loại gì, phân công theo cửa ra sao.'],
        ['Đăng ký nghỉ', 'Nhân viên gửi đơn, Supervisor/Lead duyệt — ngày được duyệt ghi thẳng loại nghỉ lên lịch.'],
        ['Nhật ký', 'Mọi lần tạo, đóng, sửa, duyệt đều được ghi lại để truy vết.']
      ]);
  }

  function abFlowBody() {
    return abStepper() +
      '<ol class="ab-list">' +
        '<li><b>Giai đoạn 1 — Mở ca.</b> Tạo task cho Station / Ca / Team rồi <b>Nạp danh sách</b>. Quét mã lúc này ghi <i>giờ có mặt</i> cho từng người; có thể bỏ qua bước nạp nếu ca quét tự do.</li>' +
        '<li><b>Giai đoạn 2 — Điểm danh.</b> Bấm <b>Bàn giao</b> để chuyển ca. Từ đây mỗi lần quét ghi <i>giờ quét</i> (lượt hai) — bắt buộc qua bước này mới quét được, tránh bảng chỉ có một lượt.</li>' +
        '<li><b>Giai đoạn 3 — Đóng task.</b> Bấm <b>Đóng</b> để chốt: ai chưa đủ quét bị tính <b>Vắng</b>. Quét sót thì <b>Mở lại</b> (Vắng trở về Chưa điểm danh), ca trống tạo nhầm thì <b>Hủy</b>.</li>' +
      '</ol>' +
      '<p class="ab-p muted">Mỗi giai đoạn chỉ có một người thao tác tại một thời điểm: lệnh ghi xếp hàng và tự báo bận trên nút, nên bấm hai lần không tạo hai lần ghi.</p>';
  }

  function abLegendBody() {
    var summary = '<div class="legend ab-legend">' +
      '<span class="legend__i">' + SOC.badgeShift('S1') + 'Sáng · S1–S9</span>' +
      '<span class="legend__i">' + SOC.badgeShift('S10') + 'Chiều · S10–S14</span>' +
      '<span class="legend__i">' + SOC.badgeShift('S15') + 'Tối · S15–S19</span>' +
      '<span class="legend__i">' + SOC.badgeShift('OFF') + 'Nghỉ tuần</span>' +
      '<span class="legend__i">' + SOC.badgeShift('PH') + 'Nghỉ lễ</span>' +
      '<span class="legend__i">' + SOC.badgeShift('AL') + 'Các loại nghỉ phép</span></div>';
    var rows = SHIFTS.map(function (s) {
      return '<tr><td>' + SOC.badgeShift(s[0]) + '</td><td>' + SOC.esc(s[1]) + '</td><td class="num">' + SOC.esc(s[2]) + '</td></tr>';
    }).join('') + REST_CODES.map(function (s) {
      return '<tr><td>' + SOC.badgeShift(s[0]) + '</td><td>' + SOC.esc(s[1]) + '</td><td>' + SOC.esc(s[2]) + '</td></tr>';
    }).join('');
    return summary +
      '<div class="table-wrap ab-legendwrap" tabindex="0" role="region" aria-label="Bảng ký hiệu ca"><table class="ab-legendtable">' +
      '<caption class="sr-only">Ký hiệu ca làm việc và mã nghỉ — mã, tên tiếng Anh, giờ làm hoặc nghĩa</caption>' +
      '<thead><tr><th scope="col">Ký hiệu</th><th scope="col">Tên tiếng Anh</th><th scope="col">Giờ làm / nghĩa</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<p class="ab-p muted">Badge luôn có chữ, không chỉ dựa màu — cùng một ký hiệu xuất hiện ở mọi màn lịch, xin nghỉ và vị trí.</p>';
  }

  function abStatusBody() {
    return '<div class="table-wrap ab-statuswrap"><table class="ab-statustable">' +
      '<caption class="sr-only">Trạng thái dòng quét sau mỗi lần chốt ca</caption>' +
      '<thead><tr><th scope="col">Trạng thái</th><th scope="col">Ý nghĩa</th></tr></thead><tbody>' +
      SCAN_STATUS.map(function (s) {
        return '<tr><td>' + SOC.badgeStatus(s[0]) + '</td><td>' + SOC.esc(s[1]) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function abRoleBody() {
    return '<div class="table-wrap ab-rolewrap"><table class="ab-roletable">' +
      '<caption class="sr-only">Bảng phân quyền: mỗi vai trò thấy gì và làm gì được</caption>' +
      '<thead><tr><th scope="col">Vai trò</th><th scope="col">Thấy được</th><th scope="col">Làm được</th><th scope="col">Lưu ý</th></tr></thead><tbody>' +
      ROLE_NAMES.map(function (k) {
        var r = ROLE_TXT[k];
        return '<tr' + (k === String(SOC.state.role || '') ? ' class="is-active"' : '') + '>' +
          '<td><span class="pill ab-role">' + SOC.esc(k) + '</span></td>' +
          '<td>' + SOC.esc(r.see) + '</td><td>' + SOC.esc(r.do) + '</td><td>' + SOC.esc(r.note) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="ab-p muted">Quyền do email đăng nhập quyết định theo bảng phân quyền trong Cấu hình. Mục nào không đủ quyền thì ẩn khỏi menu — không có nút giả mờ.</p>';
  }

  function abTimingBody() {
    return abDefs(TIMING.map(function (t) { return [t[0], SOC.esc(t[1])]; }));
  }

  function abKeysBody() {
    return '<dl class="defs ab-keys">' + KEYS.map(function (k) {
      return '<dt><span class="kbd">' + SOC.esc(k[0]) + '</span></dt><dd>' + SOC.esc(k[1]) + '</dd>';
    }).join('') + '</dl>' +
      '<p class="ab-p muted">Trên điện thoại: menu nằm ở nút ba gạch đầu trang; nút loa bật/tắt tiếng bíp xác nhận quét, nút mặt trăng đổi sang giao diện tối cho ca đêm, nút mũi tên vòng tròn tải dữ liệu mới nhất.</p>';
  }

  function abBuildNote() {
    return abDefs([
      ['Bản dựng', 'Giao diện dựng sạch từ bộ mã mới (clean-room), chạy hoàn toàn bằng dữ liệu giả trong máy — chưa nối backend, chưa ghi được xuống bảng tính.'],
      ['Khi port', 'Giữ nguyên 14 tên màn và tên hàm API đang mô phỏng để chuyển sang môi trường thật mà không phải sửa từng màn.'],
      ['Số liệu', 'Tên nhân viên, ca, đơn nghỉ trong bản này chỉ để xem bố cục; cấm bê số liệu giả vào bản thật.']
    ]);
  }

  function abHtml() {
    return '<div class="ab-doc" tabindex="0" role="region" aria-label="Tài liệu giới thiệu">' +
      abCard('about', 'Portal này dùng để làm gì?', abIntroBody()) +
      abCard('attendance', 'Điểm danh 3 giai đoạn', abFlowBody()) +
      abCard('schedule', 'Ký hiệu ca và mã nghỉ', abLegendBody()) +
      abCard('scan', 'Trạng thái dòng quét', abStatusBody()) +
      abCard('admin', 'Phân quyền', abRoleBody()) +
      abCard('config', 'Hẹn giờ & tự đóng', abTimingBody()) +
      abCard('play', 'Phím tắt & điều hướng', abKeysBody()) +
      '<div class="card card--fit ab-note">' +
        '<div class="card__head"><h2 class="section-heading">' + SOC.ico('alert', 16) + '<span>Bản dựng sạch — chưa nối backend</span></h2></div>' +
        '<div class="pane">' + abBuildNote() + '</div>' +
      '</div>' +
    '</div>';
  }

  function abRender() {
    var s = abSec();
    if (s) s.innerHTML = abHtml();
    SOC.pageActions('');
  }

  SOC.registerView('about', { section: 'viewAbout', render: abRender });
})();
