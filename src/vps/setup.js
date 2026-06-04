import { NodeSSH } from 'node-ssh';

/**
 * Tạo cấu hình Nginx dựa trên loại dự án.
 * phpSocket: đường dẫn socket PHP-FPM thực tế trên VPS (đã được dò tự động).
 */
function generateNginxConfig(domain, projectType, port, phpSocket) {
    if (projectType.includes('Node.js')) {
        return `
server {
    server_name ${domain};
    location / {
        proxy_pass http://localhost:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
`;
    } else if (projectType.includes('PHP')) {
        const rootDir = projectType === 'PHP (Laravel)' ? `/var/www/${domain}/public` : `/var/www/${domain}`;
        const socket = phpSocket || '/run/php/php8.3-fpm.sock';
        return `
server {
    server_name ${domain};
    root ${rootDir};
    index index.php index.html index.htm;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:${socket};
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
    }
}
`;
    } else if (projectType === 'React/Vite/Vue (SPA)') {
        return `
server {
    server_name ${domain};
    root /var/www/${domain};
    index index.html index.htm;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
`;
    } else { // Static
        return `
server {
    server_name ${domain};
    root /var/www/${domain};
    index index.html index.htm;

    location / {
        try_files $uri $uri/ =404;
    }
}
`;
    }
}

/**
 * Cài đặt PHP-FPM (đúng phiên bản yêu cầu) và các extension thường dùng trên VPS.
 * Trả về đường dẫn socket PHP-FPM thực tế để Nginx trỏ tới.
 */
async function installPhpFpm(ssh, phpVersion) {
    const ver = phpVersion || '8.3';
    console.log(`   → Đang cài đặt PHP-FPM ${ver} và các extension cần thiết...`);

    // Thêm PPA ondrej/php để có thể chọn đúng phiên bản PHP (best-effort, không fail nếu là Debian).
    await ssh.execCommand('sudo DEBIAN_FRONTEND=noninteractive apt-get install -y software-properties-common ca-certificates lsb-release apt-transport-https');
    await ssh.execCommand('sudo add-apt-repository -y ppa:ondrej/php 2>/dev/null || true');
    await ssh.execCommand('sudo apt-get update');

    const exts = ['fpm', 'cli', 'mysql', 'pgsql', 'mbstring', 'xml', 'curl', 'zip', 'gd', 'bcmath', 'intl']
        .map(e => `php${ver}-${e}`)
        .join(' ');

    const installVersioned = await ssh.execCommand(
        `sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ${exts}`
    );

    if (installVersioned.code !== 0) {
        // Không cài được đúng phiên bản -> dùng gói php-fpm mặc định của hệ điều hành.
        console.log('   ⚠️  Không cài được PHP phiên bản yêu cầu, chuyển sang gói PHP mặc định của hệ điều hành...');
        await ssh.execCommand(
            'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y php-fpm php-cli php-mysql php-pgsql php-mbstring php-xml php-curl php-zip php-gd php-bcmath php-intl'
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
        await ssh.execCommand('sudo apt-get update && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nginx certbot python3-certbot-nginx');

        // Với dự án PHP: cài PHP-FPM đúng phiên bản và lấy socket thực tế.
        let phpSocket = null;
        if (projectType.includes('PHP')) {
            phpSocket = await installPhpFpm(ssh, phpVersion);
        }

        console.log('Tạo cấu hình Nginx...');
        const nginxConfig = generateNginxConfig(domain, projectType, port, phpSocket);

        const configPath = `/etc/nginx/sites-available/${domain}`;
        await ssh.execCommand(`echo '${nginxConfig}' | sudo tee ${configPath}`);

        // Enable site
        await ssh.execCommand(`sudo ln -sfn ${configPath} /etc/nginx/sites-enabled/`);

        // Tạo thư mục web root cho mọi dự án để rsync không bị lỗi quyền
        const rootPath = projectType === 'PHP (Laravel)' ? `/var/www/${domain}/public` : `/var/www/${domain}`;
        await ssh.execCommand(`sudo mkdir -p ${rootPath} && sudo chown -R $USER:$USER /var/www/${domain}`);

        console.log('Khởi động lại Nginx...');
        await ssh.execCommand('sudo systemctl restart nginx');

        console.log("Đang xin cấp chứng chỉ SSL (Let's Encrypt)...");
        const certbotCmd = `sudo certbot --nginx -d ${domain} --non-interactive --agree-tos -m admin@${domain} --redirect`;
        const sslResult = await ssh.execCommand(certbotCmd);

        if (sslResult.code !== 0) {
            console.log('Cảnh báo: Không thể tự động cấp SSL. Có thể Domain chưa trỏ IP về VPS.', sslResult.stderr);
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
 * Cài đặt database server (MySQL/PostgreSQL/MongoDB) trên VPS và tạo sẵn database + user.
 * dbConfig: { engine: 'mysql'|'postgresql'|'mongodb', dbName, dbUser, dbPassword }
 */
export async function setupDatabaseOnVPS(host, username, password, dbConfig) {
    const { engine, dbName, dbUser, dbPassword } = dbConfig;
    const ssh = new NodeSSH();
    try {
        await ssh.connect({ host, username, password });
        await ssh.execCommand('sudo apt-get update');

        if (engine === 'mysql') {
            console.log('   → Đang cài đặt MySQL Server...');
            await ssh.execCommand('sudo DEBIAN_FRONTEND=noninteractive apt-get install -y mysql-server');
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
            await ssh.execCommand('sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-contrib');
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
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y gnupg curl
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor --yes
. /etc/os-release
CODENAME="\${UBUNTU_CODENAME:-\${VERSION_CODENAME}}"
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu \${CODENAME}/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y mongodb-org
sudo systemctl enable --now mongod
`;
            const res = await ssh.execCommand(installScript);
            if (res.code !== 0) {
                console.log('   ⚠️  Không thể tự động cài MongoDB. Vui lòng cài thủ công. Chi tiết:', res.stderr);
            } else {
                console.log(`   ✅ MongoDB đã được cài và khởi động (database "${dbName}" sẽ được tạo khi có ghi dữ liệu đầu tiên).`);
                console.log('   ⚠️  Lưu ý: Prisma với MongoDB yêu cầu Replica Set. Nếu dùng Prisma, hãy cấu hình replica set thủ công.');
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
