import { NodeSSH } from 'node-ssh';
import { generateNginxConfig } from './templates.js';

/**
 * Cài đặt PHP-FPM (đúng phiên bản yêu cầu) và các extension thường dùng trên VPS.
 * Trả về đường dẫn socket PHP-FPM thực tế để Nginx trỏ tới.
 */
async function installPhpFpm(ssh, phpVersion) {
    const ver = phpVersion || '8.3';
    console.log(`   → Đang cài đặt PHP-FPM ${ver} và các extension cần thiết...`);

    // Thêm PPA ondrej/php để có thể chọn đúng phiên bản PHP (best-effort, không fail nếu là Debian).
    await ssh.execCommand('sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y software-properties-common ca-certificates lsb-release apt-transport-https');
    await ssh.execCommand('sudo add-apt-repository -y ppa:ondrej/php 2>/dev/null || true');
    await ssh.execCommand('sudo apt-get -o DPkg::Lock::Timeout=300 update');

    const exts = ['fpm', 'cli', 'mysql', 'pgsql', 'mbstring', 'xml', 'curl', 'zip', 'gd', 'bcmath', 'intl']
        .map(e => `php${ver}-${e}`)
        .join(' ');

    const installVersioned = await ssh.execCommand(
        `sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y ${exts}`
    );

    if (installVersioned.code !== 0) {
        // Không cài được đúng phiên bản -> dùng gói php-fpm mặc định của hệ điều hành.
        console.log('   ⚠️  Không cài được PHP phiên bản yêu cầu, chuyển sang gói PHP mặc định của hệ điều hành...');
        await ssh.execCommand(
            'sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y php-fpm php-cli php-mysql php-pgsql php-mbstring php-xml php-curl php-zip php-gd php-bcmath php-intl'
        );
    }

    // Đảm bảo php-fpm chạy và bật cùng hệ thống.
    await ssh.execCommand(`sudo systemctl enable --now php${ver}-fpm 2>/dev/null || sudo systemctl enable --now php*-fpm 2>/dev/null || true`);

    // Dò đường dẫn socket thực tế: ưu tiên đúng phiên bản, nếu không có thì lấy socket đầu tiên tìm được.
    const socketResult = await ssh.execCommand(
        `ls /run/php/php${ver}-fpm.sock 2>/dev/null || ls /var/run/php/php${ver}-fpm.sock 2>/dev/null || ls /run/php/php*-fpm.sock 2>/dev/null | head -n1 || ls /var/run/php/php*-fpm.sock 2>/dev/null | head -n1`
    );
    const socket = (socketResult.stdout || '').trim().split('\n')[0].trim();
    const finalSocket = socket || `/run/php/php${ver}-fpm.sock`;
    console.log(`   → PHP-FPM socket: ${finalSocket}`);
    return finalSocket;
}

/**
 * Kết nối VPS và cài đặt Nginx, SSL (và PHP-FPM nếu là dự án PHP).
 */
export async function setupWebserverOnVPS({ host, username, password, domain, projectType, port, phpVersion }) {
    const ssh = new NodeSSH();
    try {
        await ssh.connect({ host, username, password });

        console.log('Đang kiểm tra và cài đặt Nginx, Certbot trên VPS (Ubuntu/Debian)...');
        // Chỉ cài những gói còn THIẾU. Trên VPS đang chạy nhiều site, việc `apt-get install`
        // vô điều kiện có thể nâng cấp nginx đang phục vụ hoặc ghi đè bản certbot hiện có
        // (vd certbot cài qua snap/pip) bằng bản apt cũ hơn -> hỏng auto-renew. Cài có điều kiện để tránh.
        await ssh.execCommand(
            'pkgs=""; ' +
            'command -v nginx >/dev/null 2>&1 || pkgs="$pkgs nginx"; ' +
            'command -v certbot >/dev/null 2>&1 || pkgs="$pkgs certbot python3-certbot-nginx"; ' +
            'if [ -n "$pkgs" ]; then sudo apt-get -o DPkg::Lock::Timeout=300 update && sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y $pkgs; ' +
            'else echo "Nginx & Certbot đã có sẵn, bỏ qua cài đặt."; fi'
        );

        // Với dự án PHP: cài PHP-FPM đúng phiên bản và lấy socket thực tế.
        let phpSocket = null;
        if (projectType.includes('PHP')) {
            phpSocket = await installPhpFpm(ssh, phpVersion);
        }

        console.log('Tạo cấu hình Nginx...');
        const nginxConfig = generateNginxConfig(domain, projectType, port, phpSocket);

        const configPath = `/etc/nginx/sites-available/${domain}`;
        // Nếu đã tồn tại cấu hình cho domain này (vd nhập trùng tên một site đang chạy),
        // sao lưu lại trước khi ghi đè để không mất cấu hình cũ.
        const existed = await ssh.execCommand(`[ -f ${configPath} ] && echo yes || echo no`);
        if ((existed.stdout || '').trim() === 'yes') {
            const backupPath = `${configPath}.bak.$(date +%Y%m%d-%H%M%S)`;
            await ssh.execCommand(`sudo cp -a ${configPath} ${backupPath}`);
            console.log(`   ⚠️  Đã tồn tại cấu hình cho ${domain}. Đã sao lưu bản cũ trước khi ghi đè.`);
        }
        await ssh.execCommand(`echo '${nginxConfig}' | sudo tee ${configPath}`);

        // Enable site
        await ssh.execCommand(`sudo ln -sfn ${configPath} /etc/nginx/sites-enabled/`);

        // Tạo thư mục web root cho mọi dự án để rsync không bị lỗi quyền
        const rootPath = projectType === 'PHP (Laravel)' ? `/var/www/${domain}/public` : `/var/www/${domain}`;
        // Dùng $(whoami) thay cho $USER vì shell non-interactive qua SSH có thể không set sẵn biến $USER.
        await ssh.execCommand(`sudo mkdir -p ${rootPath} && sudo chown -R $(whoami):$(whoami) /var/www/${domain}`);

        console.log('Kiểm tra cấu hình & nạp lại Nginx...');
        // QUAN TRỌNG: bắt buộc `nginx -t` PASS trước khi nạp lại, và dùng `reload` (graceful)
        // thay vì `restart`. Nếu cấu hình mới lỗi mà `restart`, toàn bộ các site khác trên VPS sẽ sập.
        const nginxTest = await ssh.execCommand('sudo nginx -t 2>&1');
        const testOutput = (nginxTest.stdout || '') + (nginxTest.stderr || '');
        if (!/test is successful|syntax is ok/.test(testOutput)) {
            throw new Error('Cấu hình Nginx không hợp lệ, hủy reload để bảo vệ các site đang chạy:\n' + testOutput);
        }
        await ssh.execCommand('sudo systemctl reload nginx');

        console.log("Đang xin cấp chứng chỉ SSL (Let's Encrypt)...");
        const certbotCmd = `sudo certbot --nginx -d ${domain} --non-interactive --agree-tos -m admin@${domain} --redirect`;
        // Certbot chỉ cho chạy 1 tiến trình tại một thời điểm (vd auto-renew đang chạy).
        // Thử lại vài lần khi gặp lock thay vì bỏ qua SSL ngay.
        let sslResult;
        const maxAttempts = 5;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            sslResult = await ssh.execCommand(certbotCmd);
            const out = (sslResult.stdout || '') + (sslResult.stderr || '');
            if (sslResult.code === 0) break;
            if (/Another instance of Certbot is already running/i.test(out) && attempt < maxAttempts) {
                console.log(`   ⏳ Certbot đang bận, thử lại sau 10s... (${attempt}/${maxAttempts - 1})`);
                await new Promise(resolve => setTimeout(resolve, 10000));
                continue;
            }
            break;
        }

        if (sslResult.code !== 0) {
            console.log('Cảnh báo: Không thể tự động cấp SSL. Có thể Domain chưa trỏ IP về VPS, hoặc Certbot đang bận.', sslResult.stderr);
        } else {
            console.log('Đã cài đặt SSL thành công!');
        }

        return true;
    } catch (error) {
        throw new Error('Lỗi trong quá trình cài đặt Web Server trên VPS: ' + error.message);
    } finally {
        ssh.dispose();
    }
}

/**
 * Đảm bảo VPS có Node.js (>=20), PM2 và (tuỳ chọn) Corepack cho app Node.
 * Idempotent: đã có thì bỏ qua, chỉ cài phần còn thiếu.
 * options: { needCorepack: boolean } — bật Corepack khi dùng pnpm/yarn.
 */
export async function ensureNodeRuntimeOnVPS(host, username, password, options = {}) {
    const { needCorepack = false } = options;
    // Phiên bản Node (major) cần đảm bảo trên VPS. Lấy từ tự nhận diện (engines.node/.nvmrc),
    // nhưng có SÀN tối thiểu 20 (LTS) để các app hiện đại chạy được; mặc định 22 nếu không rõ.
    const wanted = parseInt(options.nodeVersion, 10);
    const nodeMajor = Number.isInteger(wanted) ? Math.max(wanted, 20) : 22;
    const ssh = new NodeSSH();
    try {
        await ssh.connect({ host, username, password });
        console.log(`   → Kiểm tra & cài đặt Node.js (>=${nodeMajor}), PM2${needCorepack ? ', Corepack' : ''} (bỏ qua nếu đã có)...`);

        const corepackBlock = needCorepack
            ? 'sudo corepack enable >/dev/null 2>&1 || corepack enable >/dev/null 2>&1 || true\n'
            : '';

        // Lưu ý: chỉ dùng $VAR và $(...) trong bash; tránh ${...} để khỏi đụng template literal của JS.
        const script = `
set -e
command -v curl >/dev/null 2>&1 || (sudo apt-get -o DPkg::Lock::Timeout=300 update && sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y curl)
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  CURMAJ=$(node -v | sed 's/[^0-9.]*//g' | cut -d. -f1)
  if [ -n "$CURMAJ" ] && [ "$CURMAJ" -ge ${nodeMajor} ]; then NEED_NODE=0; fi
fi
if [ "$NEED_NODE" -eq 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_${nodeMajor}.x | sudo -E bash -
  sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y nodejs
fi
command -v pm2 >/dev/null 2>&1 || sudo npm install -g pm2
${corepackBlock}sudo env PATH=$PATH pm2 startup >/dev/null 2>&1 || true
`;
        const res = await ssh.execCommand(script);
        if (res.code !== 0) {
            console.log('   ⚠️  Có thể chưa cài đủ Node/PM2. Chi tiết:', res.stderr);
        }

        // Xác minh bằng shell KHÔNG tương tác (đúng kiểu mà bước deploy sẽ chạy).
        const verify = await ssh.execCommand(`node -v; npm -v; pm2 -v${needCorepack ? '; corepack --version' : ''}`);
        if (verify.code === 0) {
            console.log('   ✅ Node/PM2 sẵn sàng: ' + (verify.stdout || '').trim().replace(/\n/g, ' | '));
        } else {
            console.log('   ⚠️  Không xác minh được Node/PM2 qua SSH (có thể do PATH). Chi tiết:', verify.stderr);
        }
        return true;
    } catch (error) {
        // Không chặn toàn bộ quy trình — chỉ cảnh báo để người dùng tự xử lý.
        console.log('   ⚠️  Lỗi khi cài đặt Node/PM2 trên VPS: ' + error.message);
        return false;
    } finally {
        ssh.dispose();
    }
}

/**
 * Cài đặt database server (MySQL/PostgreSQL/MongoDB) trên VPS và tạo sẵn database + user.
 * dbConfig: { engine: 'mysql'|'postgresql'|'mongodb', dbName, dbUser, dbPassword }
 */
export async function setupDatabaseOnVPS(host, username, password, dbConfig) {
    const { engine, dbName, dbUser, dbPassword } = dbConfig;
    const ssh = new NodeSSH();
    try {
        await ssh.connect({ host, username, password });
        await ssh.execCommand('sudo apt-get -o DPkg::Lock::Timeout=300 update');

        if (engine === 'mysql') {
            console.log('   → Đang cài đặt MySQL Server...');
            await ssh.execCommand('sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y mysql-server');
            await ssh.execCommand('sudo systemctl enable --now mysql 2>/dev/null || sudo systemctl enable --now mysqld 2>/dev/null || true');

            // Tên DB/user đã được validate là [A-Za-z_][A-Za-z0-9_]* nên không cần backtick (tránh lỗi shell).
            // Tạo user cho cả 'localhost' (socket) và '127.0.0.1' (TCP) để client kết nối kiểu nào cũng được.
            const sql = [
                `CREATE DATABASE IF NOT EXISTS ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
                `CREATE USER IF NOT EXISTS '${dbUser}'@'localhost' IDENTIFIED BY '${dbPassword}';`,
                `CREATE USER IF NOT EXISTS '${dbUser}'@'127.0.0.1' IDENTIFIED BY '${dbPassword}';`,
                `ALTER USER '${dbUser}'@'localhost' IDENTIFIED BY '${dbPassword}';`,
                `ALTER USER '${dbUser}'@'127.0.0.1' IDENTIFIED BY '${dbPassword}';`,
                `GRANT ALL PRIVILEGES ON ${dbName}.* TO '${dbUser}'@'localhost';`,
                `GRANT ALL PRIVILEGES ON ${dbName}.* TO '${dbUser}'@'127.0.0.1';`,
                `FLUSH PRIVILEGES;`
            ].join(' ');
            const res = await ssh.execCommand(`sudo mysql -e "${sql}"`);
            if (res.code !== 0) {
                throw new Error('Không thể tạo database/user MySQL: ' + res.stderr);
            }
            console.log(`   ✅ MySQL sẵn sàng (database: ${dbName}, user: ${dbUser}).`);

        } else if (engine === 'postgresql') {
            console.log('   → Đang cài đặt PostgreSQL Server...');
            await ssh.execCommand('sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y postgresql postgresql-contrib');
            await ssh.execCommand('sudo systemctl enable --now postgresql');

            // Tạo role nếu chưa có, sau đó luôn set lại mật khẩu (idempotent). Không dùng khối DO $$ để tránh shell hiểu nhầm $$.
            await ssh.execCommand(
                `sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${dbUser}'" | grep -q 1 || sudo -u postgres psql -c "CREATE ROLE \\"${dbUser}\\" LOGIN PASSWORD '${dbPassword}';"`
            );
            await ssh.execCommand(
                `sudo -u postgres psql -c "ALTER ROLE \\"${dbUser}\\" WITH LOGIN PASSWORD '${dbPassword}';"`
            );
            // Tạo database nếu chưa có.
            const createDb = await ssh.execCommand(
                `sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${dbName}'" | grep -q 1 || sudo -u postgres psql -c "CREATE DATABASE \\"${dbName}\\" OWNER \\"${dbUser}\\";"`
            );
            if (createDb.code !== 0) {
                throw new Error('Không thể tạo database PostgreSQL: ' + createDb.stderr);
            }
            await ssh.execCommand(`sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE \\"${dbName}\\" TO \\"${dbUser}\\";"`);
            // PostgreSQL 15+ cần cấp quyền trên schema public.
            await ssh.execCommand(`sudo -u postgres psql -d "${dbName}" -c "GRANT ALL ON SCHEMA public TO \\"${dbUser}\\";"`);
            console.log(`   ✅ PostgreSQL sẵn sàng (database: ${dbName}, user: ${dbUser}).`);

        } else if (engine === 'mongodb') {
            console.log('   → Đang cài đặt MongoDB Server (best-effort)...');
            const installScript = `
set -e
sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y gnupg curl
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor --yes
. /etc/os-release
CODENAME="\${UBUNTU_CODENAME:-\${VERSION_CODENAME}}"
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu \${CODENAME}/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt-get -o DPkg::Lock::Timeout=300 update
sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y mongodb-org
sudo systemctl enable --now mongod
`;
            const res = await ssh.execCommand(installScript);
            if (res.code !== 0) {
                console.log('   ⚠️  Không thể tự động cài MongoDB. Vui lòng cài thủ công. Chi tiết:', res.stderr);
            } else {
                console.log(`   ✅ MongoDB đã được cài và khởi động (database "${dbName}" sẽ được tạo khi có ghi dữ liệu đầu tiên).`);
                console.log('   ⚠️  Lưu ý: Prisma với MongoDB yêu cầu Replica Set. Nếu dùng Prisma, hãy cấu hình replica set thủ công.');
                // D3 — Bảo mật: MongoDB local KHÔNG bật auth. Đảm bảo chỉ lắng nghe 127.0.0.1 (không lộ ra mạng).
                const bindRes = await ssh.execCommand("grep -E '^\\s*bindIp' /etc/mongod.conf 2>/dev/null || echo 'unknown'");
                const bindOk = /127\.0\.0\.1|localhost/.test(bindRes.stdout || '');
                console.log(`   ⚠️  Bảo mật MongoDB: chưa bật xác thực (auth).${bindOk ? ' mongod chỉ lắng nghe 127.0.0.1 (không ra mạng).' : ' Hãy kiểm tra bindIp trong /etc/mongod.conf chỉ là 127.0.0.1.'}`);
                console.log('   ⚠️  Với dữ liệu nhạy cảm: bật "security.authorization: enabled" + tạo user trong mongosh, rồi thêm user/pass vào chuỗi kết nối.');
            }
        } else {
            throw new Error('Loại database không được hỗ trợ: ' + engine);
        }

        return true;
    } catch (error) {
        throw new Error('Lỗi trong quá trình cài đặt Database trên VPS: ' + error.message);
    } finally {
        ssh.dispose();
    }
}
