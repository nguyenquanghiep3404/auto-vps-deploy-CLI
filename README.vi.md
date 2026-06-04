# Auto VPS Deploy CLI 🚀

🌐 *Ngôn ngữ: **Tiếng Việt** | [English](README.md)*

Công cụ tự động hóa toàn diện quá trình cấu hình VPS, thiết lập SSL, và tạo Github Actions Workflow. Đặc biệt hỗ trợ tối đa cho các cấu trúc dự án phức tạp như **Monorepo**, **Database Migration** tự động, các web SPA (React, Vite, Vue) và tự động hóa cả Git!

## Mới — Tự Nhận Diện Dự Án 🔍
Tool tự quét repo **trước khi hỏi** để đoán sẵn cấu trúc và loại từng phần, bạn chỉ việc Enter để xác nhận (hoặc sửa nếu sai):

- **Cấu trúc Single / Monorepo**: Dựa vào `package.json` `workspaces`, `pnpm-workspace.yaml`, `turbo.json`, hoặc các thư mục con quen thuộc (`frontend`, `backend`, `apps/*`, `packages/*`...). Nếu là Monorepo, tool **liệt kê sẵn từng phần** kèm tên + thư mục.
- **Loại dự án (backend/frontend)**: Phân biệt **Node.js (PM2)** vs **React/Vite/Vue (SPA)** theo dependencies trong `package.json` (có `express`/`next`/`nest` → server PM2; có `vite`/`react`/`vue` mà không có server → SPA tĩnh); nhận diện **Laravel** (`artisan` + `laravel/framework`), **PHP thuần** (`composer.json`/file `.php`), và **Static** (chỉ `index.html`).
- **Chi tiết phụ**: Đoán luôn `buildDir` (đọc `outDir` trong `vite.config`), `start:prod` cho NestJS, có dùng **Prisma** không, và **phiên bản PHP** (từ `composer.json` `require.php`).

> Mọi kết quả chỉ là **gợi ý điền sẵn** — bạn luôn có toàn quyền sửa ở từng bước. Đoán sai cũng không sao.

## Mới Trong Version 6 — Database & Biến Môi Trường 🆕
Phiên bản này vá những "lỗ hổng" trước đây làm hỏng các app có database (ví dụ app quán cafe có đặt món + đăng nhập + DB):

- **Tự động nạp `.env`**: Tool đọc file `.env` local của bạn, lưu vào Github Secret và tạo lại nó trong lúc chạy workflow — cả lúc *build* (để biến Vite `VITE_*` / CRA `REACT_APP_*` hoạt động) lẫn trên *VPS* (để có `DATABASE_URL`, secret, khoá API). Không còn lỗi 500 vì thiếu `.env`.
- **Tự động cài Database server**: Tool có thể cài **MySQL / PostgreSQL / MongoDB**, tạo database + user, sinh mật khẩu mạnh và tự chèn chuỗi kết nối vào secret `.env`. Nhờ đó `prisma db push` và `artisan migrate` đã có database thật để làm việc.
- **Biến build-time của Vite / SPA**: Với dự án SPA, file `.env` được ghi **trước** `npm run build`, nên bản build trỏ đúng endpoint API.
- **Hỗ trợ mọi package manager — npm / pnpm / yarn (tự nhận diện)**: Tool tự đoán theo lockfile (`package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`) và cho bạn xác nhận hoặc đổi. Sau đó sinh đúng lệnh install/build/runtime và bật **Corepack** cho pnpm/yarn. Monorepo dùng **Turbo** cũng chạy được (build ở thư mục gốc repo).
- **Hỗ trợ workspaces (Monorepo)**: Nếu package con không có lockfile riêng (lockfile chỉ ở thư mục gốc), hãy chọn chế độ *workspaces* — khi đó install + build chạy ở gốc và chỉ deploy đúng package cần thiết.
- **Tùy chọn start script**: Với app Node, bạn chọn được script chạy production (mặc định `start`, ví dụ `start:prod` cho NestJS) — không còn mặc định cứng `npm start`.
- **Tự cài Node.js + PM2 + Corepack trên VPS**: Với dự án Node, tool giờ **tự nhận diện và cài** Node.js (≥20 LTS), PM2 và (cho pnpm/yarn) Corepack trên VPS. **Idempotent** — đã có thì bỏ qua, không phải chọn tay.
- **Sửa các lỗi Laravel**: Tự sinh `APP_KEY` hợp lệ (hết lỗi 500 khi khởi động), chạy thêm `php artisan key:generate` để chắc chắn, **cài PHP-FPM đúng phiên bản bạn chọn**, và **tự dò socket** cho `fastcgi_pass` của Nginx (đã bỏ việc hard-code `php8.1-fpm.sock`).

> 🔐 Mật khẩu database được sinh ra sẽ hiển thị **một lần duy nhất** ở cuối quá trình và được lưu trong Github Secret `.env` — hãy chép lại nơi an toàn.

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
npm install -g git+https://github.com/nguyenquanghiep3404/auto-vps-deploy-CLI.git
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

## Hướng Dẫn Database & Biến Môi Trường (app có DB, ví dụ app quán cafe)
Khi bạn chọn `Node.js`, `PHP (Laravel)` hoặc `PHP (Thuần)`, tool sẽ hỏi thêm vài câu:

1. **Phiên bản PHP** (với dự án PHP): ví dụ `8.1`, `8.2`, `8.3`. Tool cài đúng PHP-FPM phiên bản đó trên VPS và trỏ Nginx vào socket đã dò được.
2. **"Phần này có cần Database không?"** — Nếu có, chọn loại (`MySQL` / `PostgreSQL` / `MongoDB`) và tên DB + user. Tool sẽ:
   - Cài database server trên VPS (chạy lại nhiều lần không sao).
   - Tạo database và một user riêng với mật khẩu mạnh sinh tự động.
   - Tạo chuỗi kết nối và thêm vào secret `.env`:
     - Node.js → `DATABASE_URL="..."` (sẵn sàng cho Prisma).
     - Laravel / PHP thuần → `DB_CONNECTION`, `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`.
3. **"Đường dẫn file .env"** — Trỏ tới file `.env` local của bạn (mặc định `.env`, hoặc `<thư-mục-phần>/.env` với monorepo). Nội dung được lưu thành Github Secret tên `ENV_FILE` (single) hoặc `ENV_FILE_<TÊNPHẦN>` (monorepo) và được workflow tạo lại tự động. Để trống nếu không có.

Cách `.env` được dùng theo từng loại dự án:
- **Node.js**: ghi vào thư mục app trước khi build *và* đẩy lên VPS, nên cả lúc build lẫn `prisma db push` / runtime đều có.
- **SPA (React/Vite/Vue)**: ghi **trước** `npm run build` để các biến `VITE_*` / `REACT_APP_*` được "nung" vào bản build.
- **Laravel / PHP thuần**: ghi trước khi rsync để file `.env` lên được VPS. Riêng Laravel, `APP_KEY` hợp lệ sẽ được tự chèn nếu file của bạn chưa có.

> ⚠️ **Lưu ý MongoDB**: MongoDB cài local mặc định không bật xác thực. Nếu dùng Prisma + MongoDB, bạn phải cấu hình thêm **Replica Set** (Prisma bắt buộc). MySQL và PostgreSQL thì chạy được ngay.

## Prisma cho Production — `migrate deploy` + `db seed` (chỉnh tay)
Mặc định, workflow Node do tool sinh ra dùng **`prisma db push --accept-data-loss`**. Lệnh này ép DB giống schema, **không có lịch sử migration** và **có thể xoá dữ liệu** khi thay đổi schema cần bỏ cột/bảng. Rất hợp để làm thử, nhưng **nguy hiểm với app thật đang có dữ liệu** (đơn hàng, khách hàng...), và **không chạy seed**.

Khi lên production, hãy **tự sửa tay** trong file `deploy*.yml` thành migration + seed:

```yaml
# Thay khối này:
            npx prisma generate
            npx prisma db push --accept-data-loss

# Bằng khối này:
            npx prisma generate
            npx prisma migrate deploy
            # Chỉ ở LẦN DEPLOY ĐẦU (tạo role/admin/dữ liệu nền):
            # npx prisma db seed
```

Vì sao:
- **`prisma migrate deploy`** áp các file migration đã commit (`prisma/migrations/`) theo đúng thứ tự, ghi lại trong bảng `_prisma_migrations` — an toàn, lặp lại được, kiểm soát được, **không mất dữ liệu bất ngờ**. (Đúng cho dự án đã đi theo migration, vd có script `db:migrate`.)
- **`prisma db seed`** nạp dữ liệu khởi tạo (admin mặc định, các role RBAC, dữ liệu nền). Chỉ chạy ở **lần deploy đầu tiên** (hoặc viết seed kiểu idempotent), nếu không dữ liệu sẽ bị nhân đôi.
- **Điều kiện:** phải commit thư mục `prisma/migrations/` (sinh ở máy dev bằng `prisma migrate dev`). `migrate deploy` cần các file này; `db push` thì không.

## Hỗ Trợ Package Manager & Workspaces (Monorepo)
Tool tự nhận diện package manager theo lockfile và cho bạn xác nhận/đổi:

| Lockfile | Package manager |
|---|---|
| `package-lock.json` | npm |
| `pnpm-lock.yaml` | pnpm (bật Corepack) |
| `yarn.lock` | yarn (bật Corepack) |

Nếu monorepo của bạn dùng **workspaces** (npm/pnpm/yarn) hoặc **Turbo** — tức là chỉ có một lockfile ở thư mục gốc và các package con không có lockfile riêng — hãy trả lời **Có** ở câu hỏi workspaces cho phần đó. File workflow sinh ra sẽ:
- Cài dependency ở **thư mục gốc** repo bằng đúng package manager (`npm ci` / `pnpm install --frozen-lockfile` / `yarn install --frozen-lockfile`), nên không còn lỗi cài trong thư mục con.
- Build ở **thư mục gốc** (`<pm> run build`), để Turbo / script build ở root biên dịch các package dùng chung đúng thứ tự.
- Với SPA: chỉ deploy thư mục build (`dist`/`build`) của package con.
- Với Node.js: deploy cả repo, chạy lệnh cài production ở gốc trên VPS (`npm ci --production` / `pnpm install --prod` / `yarn install --production`), rồi khởi động app từ thư mục con bằng start script bạn chọn.

**Ví dụ:**
- Monorepo **npm workspaces** (Next.js + NestJS + package dùng chung): 2 phần, đều là `Node.js`, đều *workspaces = Có*; phần NestJS chọn start script `start:prod` và dùng Prisma + PostgreSQL. → Chính là cấu trúc của **Tiny-cafe**.
- Monorepo **pnpm + Turbo**: làm y hệt — chỉ cần chọn `pnpm` khi được hỏi (tool tự đoán từ `pnpm-lock.yaml`). → Chính là cấu trúc của **dp-tamdan**.

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
