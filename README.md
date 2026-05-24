# Auto VPS Deploy CLI 🚀

Công cụ tự động hóa toàn diện quá trình cấu hình VPS, thiết lập SSL, và tạo Github Actions Workflow để tự động deploy các dự án Node.js, Laravel, và Static Website. Đặc biệt hỗ trợ tối đa cho các cấu trúc dự án **Monorepo** và tích hợp **Database Migration** tự động.

## Tính Năng Nổi Bật
- **Tự động cấu hình Web Server**: Tự động kết nối SSH, cài đặt Nginx, tạo thư mục dự án và cấu hình proxy/root tự động chuẩn xác nhất.
- **Tự động lấy chứng chỉ SSL**: Sử dụng Certbot (Let's Encrypt) để tự động cấp HTTPS cho domain của bạn.
- **Hỗ trợ cấu trúc Monorepo**: Dễ dàng phân chia việc deploy Frontend và Backend trong cùng một Github Repository bằng cách chỉ định thư mục nguồn gốc riêng biệt.
- **Hỗ trợ Prisma Database Migration**: Tự động nhận diện và chèn các lệnh `prisma generate` và `prisma db push` vào kịch bản deploy nếu dự án Node.js của bạn sử dụng Prisma ORM.
- **Thiết lập SSH Key bảo mật**: Tự sinh cặp khóa RSA dành riêng cho Github Actions, đưa Public Key lên VPS và giấu Private Key vào Github Secrets một cách bí mật.
- **Tương tác Github Secrets tự động**: Tự động cài đặt (hoặc hỏi cài đặt) công cụ Github CLI (`gh`), sau đó tự động lưu `VPS_HOST`, `VPS_USERNAME`, `VPS_SSH_KEY` lên Github Repository.
- **Tạo Github Workflow hoàn chỉnh**: Tự động sinh ra file workflow phù hợp (ví dụ: `.github/workflows/deploy-backend.yml`). Sau khi cài đặt, chỉ cần bạn gõ `git push`, VPS sẽ được tự động cập nhật!

## Yêu Cầu Hệ Thống
Trước khi sử dụng, máy tính của bạn cần có:
- **Node.js** (phiên bản 14 trở lên)
- **Github CLI (`gh`)**: Công cụ sẽ tự động hỏi và cài đặt giúp bạn nếu máy bạn chưa có.

## Cài Đặt (Local)
Mở Terminal tại thư mục của bộ công cụ `deploy-vps` và chạy lệnh sau để biến nó thành một lệnh dùng chung trên toàn hệ thống:
```bash
npm install
npm link
```

## Hướng Dẫn Sử Dụng
Sau khi liên kết lệnh thành công, bạn có thể deploy bất kỳ dự án nào bằng cách làm theo các bước sau:

**Bước 1**: Di chuyển vào thư mục dự án bạn muốn deploy (đã có kết nối Git và trỏ về một Github Repository).

**Bước 2**: Chạy công cụ:
```bash
deploy-vps
```

**Bước 3**: Trả lời các câu hỏi tương tác.
Hệ thống sẽ hỏi bạn các thông tin cấu hình như:
- **IP và Username, Mật khẩu của VPS** (Mật khẩu chỉ dùng 1 lần, không được lưu trữ ở đâu cả).
- **Tên miền (Domain)** đã được trỏ DNS về VPS.
- **Loại dự án**: Node.js, Laravel hay Static.
- **Vai trò của dự án**: Frontend, Backend hay Fullstack. Lựa chọn này giúp công cụ đặt tên file `.yml` không bị trùng lặp.
- **Thư mục chứa mã nguồn**: Vị trí code trong Repo (Mặc định là `./`. Nếu làm Monorepo có thể chọn `./frontend` hoặc `./backend`).
- **Prisma ORM**: Nếu là dự án Node.js, công cụ sẽ hỏi bạn có dùng Prisma không để tự động thêm script migrate DB.

**Bước 4**: Commit và Push!
Sau khi công cụ báo "HOÀN TẤT", bạn sẽ thấy thư mục `.github` xuất hiện. Hãy commit nó lên nhánh chính:
```bash
git add .
git commit -m "Thêm cấu hình auto deploy bằng Github Actions"
git push origin main
```
Lúc này, bạn hãy mở tab **Actions** trên Github để theo dõi tiến trình copy code lên VPS nhé!

## Cách Triển Khai Dự Án Monorepo (Có cả Frontend & Backend)
Nếu Repository của bạn có dạng:
```
/my-project
  /frontend (Next.js/React)
  /backend (Node.js/Express)
```
Bạn chỉ cần mở Terminal tại `/my-project` và chạy lệnh `deploy-vps` **2 lần**:
- Lần 1: Khai báo Vai trò là `Frontend`, Thư mục mã nguồn là `./frontend`.
- Lần 2: Khai báo Vai trò là `Backend`, Thư mục mã nguồn là `./backend`, có thể chọn Dùng Prisma nếu cần.

Công cụ sẽ tự động sinh ra 2 file `deploy-frontend.yml` và `deploy-backend.yml` chạy độc lập với nhau, bảo đảm an toàn và không xung đột!

## Về Vấn Đề Bảo Mật
- Không chia sẻ các file trong `.github/workflows/` nếu bên trong vô tình chứa thông tin nhạy cảm (dù mặc định tool dùng biến ẩn `${{ secrets.* }}` rất an toàn).
- SSH Private Key được đẩy thẳng lên Github Secrets và tuyệt đối **không lưu trữ** ở máy tính hay VPS của bạn. Đây là quy chuẩn an toàn cao nhất của DevOps hiện đại.
