import { NodeSSH } from 'node-ssh';

/**
 * Tạo cấu hình Nginx dựa trên loại dự án
 */
function generateNginxConfig(domain, projectType, port) {
    if (projectType === 'Node.js (PM2)') {
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
    } else if (projectType === 'PHP (Laravel)') {
        return `
server {
    server_name ${domain};
    root /var/www/${domain}/public;
    index index.php index.html index.htm;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php8.1-fpm.sock; # Có thể cần điều chỉnh phiên bản PHP
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
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
 * Kết nối VPS và cài đặt Nginx, SSL
 */
export async function setupWebserverOnVPS(host, username, password, domain, projectType, port) {
    const ssh = new NodeSSH();
    try {
        await ssh.connect({
            host: host,
            username: username,
            password: password,
        });

        console.log('Đang kiểm tra và cài đặt Nginx, Certbot trên VPS (Ubuntu/Debian)...');
        // Update và cài đặt nginx, certbot
        await ssh.execCommand('sudo apt-get update && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nginx certbot python3-certbot-nginx');

        console.log('Tạo cấu hình Nginx...');
        const nginxConfig = generateNginxConfig(domain, projectType, port);
        
        // Lưu cấu hình vào một file tạm và di chuyển vào sites-available
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
        // Xin chứng chỉ SSL (non-interactive)
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
