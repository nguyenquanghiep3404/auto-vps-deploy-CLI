# Auto VPS Deploy CLI 🚀

Công cụ tự động hóa toàn diện quá trình cấu hình VPS, thiết lập SSL, và tạo Github Actions Workflow. Châm ngôn của công cụ này là **"Gõ lệnh một lần, Deploy mãi mãi"**. Đặc biệt hỗ trợ tối đa cho các cấu trúc dự án phức tạp như **Monorepo**, **Database Migration** tự động, các web SPA (React, Vite, Vue) và tự động hóa cả Git!

## Các Tính Năng Đỉnh Cao (Version 4)
- **Tự động nhận diện Git Repository**: Khởi động tool ở thư mục mới toanh? Tool sẽ tự hỏi link Github của bạn rồi gõ `git init`, `git remote add origin` thay bạn!
- **Tự động Push Code 100%**: Khi cài đặt xong, công cụ tự động gõ `git add`, `commit` và `push` toàn bộ code lên nhánh `main` luôn, không cần bạn phải động tay gõ lệnh Push nữa.
- **Tự động cấu hình Web Server & SSL**: Tự động kết nối SSH, cài đặt Nginx, tạo thư mục dự án chuẩn quyền truy cập, thiết lập cấu hình proxy/root, cấp chứng chỉ HTTPS (Certbot) hoàn toàn miễn phí.
- **Hỗ trợ 5 hệ sinh thái dự án khác nhau**:
  1. `Node.js (PM2)`: Dành cho Next.js, Express, NestJS...
  2. `React/Vite/Vue (SPA)`: Tự động chạy NPM Build ra thư mục tĩnh, xử lý triệt để lỗi 404 khi load lại (F5) trang nhờ config `try_files` chuyên biệt.
  3. `PHP (Laravel)`: Tự chạy Composer Install và Artisan migrate trên VPS.
  4. `PHP (Thuần)`: Môi trường PHP cơ bản nhất mà không dư thừa cấu hình.
  5. `Static`: HTML, CSS thuần túy.
- **Hỗ trợ cấu trúc Monorepo siêu đỉnh**: Bạn có 2 thư mục `frontend` và `backend` trong cùng 1 Github Repo? Bạn chỉ cần chạy tool 2 lần và chỉ định đường dẫn, tool sẽ tạo ra 2 luồng Workflow chạy song song riêng biệt (ví dụ `deploy-frontend.yml` và `deploy-backend.yml`).
- **Prisma Database Migration**: Nếu chọn nền tảng Node.js, tool sẽ tự động chèn lệnh `npx prisma generate` và `npx prisma db push` vào kịch bản deploy.

## Yêu Cầu Hệ Thống
- **Node.js** (phiên bản 18 trở lên)
- **Github CLI (`gh`)**: Công cụ sẽ tự động kiểm tra, nếu máy chưa cài nó sẽ hỏi và sử dụng trình cài đặt `winget` của Windows để cài đặt hộ bạn.

## Cài Đặt (Global)
Tại bất kỳ máy tính nào, bạn chỉ cần mở Terminal (Command Prompt / PowerShell) lên và gõ:
```bash
npm install -g git+https://github.com/nguyenquanghiep3404/Deploy-vps-automation.git
```
Chỉ sau khoảng 30 giây, máy tính của bạn sẽ sở hữu một "chuyên gia DevOps" mang tên `deploy-vps`.

## Hướng Dẫn Sử Dụng "Cực Lười"
**Bước 1**: Di chuyển vào thư mục code của bạn (có thể đã là git repo hoặc chưa, không quan trọng).

**Bước 2**: Chạy công cụ:
```bash
deploy-vps
```

**Bước 3**: Trả lời các câu hỏi cực kỳ dễ hiểu.
- *Nếu thư mục chưa nối với Github*, công cụ sẽ hỏi bạn link Repository.
- **Tài khoản VPS**: Nhập IP, Username, Mật khẩu (Mật khẩu KHÔNG lưu ở đâu cả, chỉ dùng để SSH vào cài đặt 1 lần).
- **Tên miền**: Nhập tên miền (Ví dụ: phuquoc.test9.io.vn). Nginx và Let's Encrypt sẽ dựa vào đây để hoạt động.
- **Loại dự án**: Chọn 1 trong 5 loại dự án kể trên (Bằng cách gõ số 1, 2, 3, 4, 5 rồi Enter).
- **Vai trò & Thư mục**: Hỗ trợ tốt nhất cho Monorepo (chọn `./frontend` hoặc `./backend`). Nếu là dự án gộp thì cứ để mặc định `./`.

**Bước 4**: Thưởng thức thành quả!
Sau khi nhập xong, bạn cứ đi pha một ly cà phê. Tool sẽ tự động kết nối vào VPS cài Nginx, tự nối SSH Keys cho Github Actions, tự tạo file `.github/workflows/deploy.yml`, sau đó... nó **tự động Commit và Push toàn bộ code lên Github** luôn cho bạn! 

Bạn chỉ việc mở tab Actions trên Github.com lên và nhìn mã nguồn tự động bay sang VPS một cách mượt mà!

## Cách Triển Khai Dự Án SPA (React / Vite)
1. Chạy lệnh `deploy-vps`.
2. Chọn loại dự án `React/Vite/Vue (SPA)`.
3. Tool sẽ hỏi tên thư mục xuất code. Đa số với Vite là `dist`, với Create React App là `build`. Cứ điền cho chính xác.
4. Tool sẽ lo mọi thứ: Từ chạy `npm run build` trên máy chủ Github cho đến rsync sang VPS, đặc biệt file config trên VPS được tool cài đặt sẵn rule để xử lý lỗi F5 Client-side Routing. Quá tuyệt vời!

## Hướng Dẫn Setup Monorepo (Ví dụ: Next.js + Express.js)
Với cấu trúc Monorepo, bạn cần phân tách 2 port và 2 sub-domain để chúng không bị xung đột trên VPS. Ví dụ Backend chạy ở `api.domain.com` (Port 4000) và Frontend chạy ở `domain.com` (Port 3000). 

**Lần 1: Cấu hình cho Backend**
1. Chạy `deploy-vps`.
2. Tên miền: Nhập `api.domain.com`.
3. Loại dự án: Chọn `Node.js (PM2...)`.
4. Cổng: Nhập `4000`.
5. Vai trò: Chọn `Backend`.
6. Thư mục: Nhập `./backend`.
👉 Hệ thống sinh ra file `.github/workflows/deploy-backend.yml`.

**Lần 2: Cấu hình cho Frontend**
1. Chạy lại `deploy-vps`.
2. Tên miền: Nhập `domain.com`.
3. Loại dự án: Chọn `Node.js (PM2...)`.
4. Cổng: Nhập `3000`.
5. Vai trò: Chọn `Frontend`.
6. Thư mục: Nhập `./frontend`.
👉 Hệ thống sinh ra file `.github/workflows/deploy-frontend.yml`.

Khi bạn push code lên Github, Github Actions sẽ kích hoạt cả 2 file yml này độc lập. Mã nguồn ở thư mục nào sẽ được build và cập nhật cho thư mục đó, hoàn toàn không bị ảnh hưởng lẫn nhau!

## Vấn Đề Bảo Mật (Zero-Trust)
- **Mật khẩu VPS của bạn an toàn tuyệt đối**. Công cụ không lưu mật khẩu ra file hay gửi lên bất kỳ máy chủ nào.
- Ngay khi công cụ có được quyền truy cập bằng mật khẩu, nó lập tức đẻ ra một cặp khóa bảo mật **RSA (SSH Keys)**.
- Public Key được gửi vào VPS.
- Private Key được nhét vào tính năng lưu trữ khoá bí mật siêu cấp an toàn của Github (Repository Secrets).
- Cuối cùng quá trình kết nối giữa Github và VPS chỉ sử dụng chiếc "chìa khóa vô hình" này, không bao giờ cần mật khẩu nữa!
