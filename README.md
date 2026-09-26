# SPX SOC Portal — Clean-room UI Demo

Bản demo frontend (vanilla JS, không build) cho cổng vận hành Ops-SOC: điểm danh · lịch ca · xin nghỉ · điều phối ngày.

- **Toàn bộ dữ liệu là synthetic** (tên/opsId/email/SĐT giả định, seed tất định) — không chứa dữ liệu nhân sự thật; chỉ kế thừa **schema và phân bổ ca** từ hệ thống thật.
- Không backend: `js/api.js` là shim mock của 34 API server, `js/mock-data.js` là dataset.
- Bấm chip **Viewer / Operator / Manager / Admin** ở sidebar để xem phân quyền thích ứng.
- Chạy: mở trực tiếp `index.html`, hoặc GitHub Pages (đang bật cho nhánh `main`).

Prototype thiết kế — không phải sản phẩm đang vận hành.
