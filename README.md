# Auto VPS Deploy CLI 🚀

Công cụ tự động hóa toàn diện quá trình cấu hình VPS, thiết lập SSL, và tạo Github Actions Workflow. Đặc biệt hỗ trợ tối đa cho các cấu trúc dự án phức tạp như **Monorepo**, **Database Migration** tự động, các web SPA (React, Vite, Vue) và tự động hóa cả Git!

## Các Tính Năng Trong Version 5.1
- **Tự động gán Port thông minh**: Tool SSH vào VPS, quét toàn bộ cổng đang bị chiếm trong dãy 3000-3999, rồi tự gán cổng trống tiếp theo cho dự án. Người dùng không cần biết "Port là gì" cũng triển khai được!
- **Hỗ trợ Monorepo trong 1 lần chạy duy nhất**: Chỉ cần chọn `Monorepo`, nhập số phần (VD: 2 cho frontend + backend), tool sẽ tự hỏi cấu hình riêng cho từng phần và sinh ra các file workflow độc lập.
- **Tự động nhận diện Git Repository**: Khởi động tool ở thư mục mới toanh? Tool sẽ tự hỏi link Github của bạn rồi gõ `git init`, `git remote add origin` thay bạn!
- **Tự động Push Code 100%**: Khi cài đặt xong, công cụ tự động gõ `git add`, `commit` và `push` toàn bộ code lên nhánh `main` luôn.
- **Tự động cấu hình Web Server & SSL**: Tự động kết nối SSH, cài đặt Nginx, thiết lập cấu hình proxy/root, cấp chứng chỉ HTTPS (Let's Encrypt/Certbot) hoàn toàn miễn phí.
- **Hỗ trợ 5 hệ sinh thái dự án khác nhau**:
  1. `Node.js (PM2)`: Dành cho Next.js, Express, NestJS...
  2. `React/Vite/Vue (SPA)`: Tự động chạy NPM Build ra thư mục tĩnh, xử lý triệt để lỗi 404 khi load lại (F5) trang nhờ config `try_files` chuyên biệt.
  3. `PHP (Laravel)`: Tự chạy Composer Install và Artisan migrate trên VPS.
  4. `PHP (Thuần)`: Môi trường PHP cơ bản nhất mà không dư thừa cấu hình.
  5. `Static`: HTML, CSS thuần túy.
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

## Hướng Dẫn Sử Dụng
**Bước 1**: Di chuyển vào thư mục code của bạn (có thể đã là git repo hoặc chưa, không quan trọng).

**Bước 2**: Chạy công cụ:
```bash
deploy-vps
```

**Bước 3**: Trả lời các câu hỏi.
- *Nếu thư mục chưa nối với Github*, công cụ sẽ hỏi bạn link Repository.
- **Tài khoản VPS**: Nhập IP, Username, Mật khẩu (Mật khẩu KHÔNG lưu ở đâu cả, chỉ dùng để SSH vào cài đặt 1 lần).
- **Cấu trúc dự án**: Chọn `Single` nếu là dự án đơn, hoặc `Monorepo` nếu dự án có nhiều phần (frontend + backend + admin...).
- **Tên miền**: Nhập tên miền chính xác (Ví dụ: `phuquoc.test9.io.vn`).
  *⚠️ LƯU Ý: Tuyệt đối không nhập `http://`, `https://` hay dấu `/` ở cuối tên miền, nếu không công cụ cấp chứng chỉ SSL Certbot sẽ báo lỗi.*
- **Loại dự án**: Chọn 1 trong 5 loại dự án kể trên (Bằng cách gõ số 1, 2, 3, 4, 5 rồi Enter).
- **Cổng (Port)**: Bạn **không cần nhập gì cả**! Tool tự động SSH vào VPS quét cổng nào đã bị chiếm và gán cổng trống tiếp theo cho dự án của bạn.

**Bước 4**: Thưởng thức thành quả!
Sau khi nhập xong, bạn cứ đi pha một ly cà phê. Tool sẽ tự động kết nối vào VPS cài Nginx, tự nối SSH Keys cho Github Actions, tự tạo file `.github/workflows/deploy.yml`, sau đó... nó **tự động Commit và Push toàn bộ code lên Github** luôn cho bạn! 

Bạn chỉ việc mở tab Actions trên Github.com lên và nhìn mã nguồn tự động bay sang VPS một cách mượt mà!

## Dự Án Single (Dự Án Đơn)
Nếu dự án của bạn chỉ có một loại duy nhất (VD: chỉ có Frontend hoặc chỉ có Backend), hãy chọn `Single` ở bước chọn cấu trúc. Tool sẽ hỏi bạn:
- Tên miền
- Loại dự án (Node.js / PHP / SPA / Static)
- Thư mục output (nếu SPA)
- Prisma ORM (nếu Node.js)

Cổng (Port) được tool tự động gán, bạn không cần lo. Sau đó tool tự động sinh ra file `deploy.yml` duy nhất.

## Cách Triển Khai Dự Án SPA (React / Vite)
1. Chạy lệnh `deploy-vps`.
2. Chọn cấu trúc `Single`.
3. Chọn loại dự án `React/Vite/Vue (SPA)`.
4. Tool sẽ hỏi tên thư mục xuất code. Đa số với Vite là `dist`, với Create React App là `build`. Cứ điền cho chính xác.
5. Tool sẽ lo mọi thứ: Từ chạy `npm run build` trên máy chủ Github cho đến rsync sang VPS, đặc biệt file config trên VPS được tool cài đặt sẵn rule để xử lý lỗi F5 Client-side Routing. Quá tuyệt vời!

## Hướng Dẫn Setup Monorepo (Ví dụ: Next.js + Express.js)
Từ Version 5, bạn chỉ cần **chạy tool 1 lần duy nhất** cho toàn bộ dự án Monorepo!

Với cấu trúc Monorepo, bạn cần chuẩn bị 2 tên miền khác nhau để các phần không xung đột. Ví dụ: Frontend dùng `domain.com` và Backend dùng `api.domain.com`. Cổng (Port) được tool tự gán, bạn không cần lo!

**Các bước thực hiện:**
1. Chạy `deploy-vps`.
2. Nhập thông tin VPS (IP, Username, Password) — **chỉ nhập 1 lần duy nhất**.
3. Tool tự động quét cổng đang dùng trên VPS.
4. Chọn cấu trúc: `Monorepo`.
5. Nhập số phần: `2` (hoặc 3, 4... tùy dự án).
6. **Cấu hình PHẦN 1/2 (Frontend):**
   - Tên phần: `frontend`
   - Tên miền: `domain.com`
   - Loại dự án: `Node.js (PM2...)`
   - Thư mục: `./frontend`
   - ✅ Tool tự gán cổng: 3000
7. **Cấu hình PHẦN 2/2 (Backend):**
   - Tên phần: `backend`
   - Tên miền: `api.domain.com`
   - Loại dự án: `Node.js (PM2...)`
   - Thư mục: `./backend`
   - ✅ Tool tự gán cổng: 3001
8. Tool hiển thị bảng tóm tắt và bắt đầu tự động hóa toàn bộ:
   - Cấu hình Nginx + SSL cho **tất cả** domain cùng lúc.
   - Tạo SSH Key **1 lần duy nhất**.
   - Sinh ra **2 file workflow riêng biệt**: `deploy-frontend.yml` và `deploy-backend.yml`.
   - Tự động Push code lên Github.

Khi bạn push code lên Github, Github Actions sẽ kích hoạt cả 2 file yml này độc lập. Mã nguồn ở thư mục nào sẽ được build và cập nhật cho thư mục đó, hoàn toàn không bị ảnh hưởng lẫn nhau!

## Cách Hệ Thống Port Tự Động Hoạt Động

Nếu bạn đã triển khai nhiều dự án lên cùng 1 VPS, bạn không cần lo bị trùng cổng. Tool tự quản lý:

| Lần deploy | Dự án | Tool tự gán |
|---|---|---|
| Lần 1 | Portfolio (Next.js) | Cổng 3000 |
| Lần 2 | Blog (Express) | Cổng 3001 (vì 3000 đã chiếm) |
| Lần 3 | API khách hàng | Cổng 3002 (vì 3000, 3001 đã chiếm) |

Tool sẽ SSH vào VPS, chạy lệnh `ss -tlnp` để quét tất cả cổng đang hoạt động, sau đó tự tìm cổng trống tiếp theo trong dãy 3000-3999 để gán. PM2 sẽ khởi động ứng dụng với biến `PORT=XXXX` tương ứng, đảm bảo mọi thứ luôn khớp hoàn hảo.

## Vấn Đề Bảo Mật (Zero-Trust)
- **Mật khẩu VPS của bạn an toàn tuyệt đối**. Công cụ không lưu mật khẩu ra file hay gửi lên bất kỳ máy chủ nào.
- Ngay khi công cụ có được quyền truy cập bằng mật khẩu, nó lập tức đẻ ra một cặp khóa bảo mật **RSA (SSH Keys)**.
- Public Key được gửi vào VPS.
- Private Key được nhét vào tính năng lưu trữ khoá bí mật siêu cấp an toàn của Github (Repository Secrets).
- Cuối cùng quá trình kết nối giữa Github và VPS chỉ sử dụng chiếc "chìa khóa vô hình" này, không bao giờ cần mật khẩu nữa!

## Các Lỗi Thường Gặp (FAQ)

**1. Báo lỗi "Requested name... appears to be a URL" ở Bước 1**
- **Dấu hiệu:** Công cụ báo lỗi khi đang xin cấp chứng chỉ SSL (Let's Encrypt).
- **Nguyên nhân:** Khi công cụ hỏi "Nhập Tên Miền (Domain)", bạn đã nhập là `http://domain.com/`. Chứng chỉ SSL Certbot chỉ chấp nhận **tên miền trần** (FQDN - Fully Qualified Domain Name) như `domain.com`. Nó không chấp nhận giao thức `http://` hay dấu `/` ở cuối.
- **Cách khắc phục:** Chạy lại công cụ và chỉ gõ đúng chữ `domain.com` là xong.

**2. Báo lỗi "Permission denied" hoặc "cannot be loaded because running scripts is disabled" trên PowerShell**
- **Dấu hiệu:** Khi chạy lệnh `deploy-vps` hoặc `npm install -g ...`, PowerShell báo lỗi không cho phép chạy script.
- **Nguyên nhân:** Windows mặc định cấm chạy các script chưa được ký số (Execution Policy = Restricted). Đây là một chính sách bảo mật mặc định của Windows, không phải lỗi của công cụ.
- **Cách khắc phục:** Mở PowerShell lên và chạy lệnh sau **1 lần duy nhất** (không cần chạy với quyền Admin):
  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```
  Sau đó chạy lại `deploy-vps` là sẽ hoạt động bình thường. Lệnh này chỉ cần chạy 1 lần, các lần sau không cần chạy lại nữa.

**3. Báo lỗi "Permission denied (publickey,password)" ở Bước Deploy trên Github Actions**
- **Dấu hiệu:** Github Actions báo `rsync error: Permission denied` khi đang copy file sang VPS.
- **Nguyên nhân:** SSH Key trên VPS không khớp với SSH Key trên Github Secrets. Thường xảy ra khi bạn đã chạy tool nhiều lần hoặc thay đổi VPS.
- **Cách khắc phục:** Chạy lại `deploy-vps` để tool tự động tạo cặp SSH Key mới và đồng bộ lại cả VPS lẫn Github Secrets.

**4. Báo lỗi yêu cầu phiên bản Node.js cao hơn trên Github Actions**
- **Dấu hiệu:** Bước `npm run build` trên Github Actions bị lỗi với thông báo yêu cầu Node.js phiên bản cao hơn.
- **Nguyên nhân:** File workflow `.yml` đang dùng phiên bản Node.js cũ.
- **Cách khắc phục:** Mở file `.github/workflows/deploy.yml`, tìm dòng `node-version` và đổi thành `node-version: '26'`. Sau đó commit và push lại.
