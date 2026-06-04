/**
 * Các hàm sinh nội dung cấu hình thuần (không có side-effect / không cần SSH),
 * tách riêng để dễ kiểm thử bằng unit test.
 */

/**
 * Tạo cấu hình Nginx dựa trên loại dự án.
 * phpSocket: đường dẫn socket PHP-FPM thực tế trên VPS (đã được dò tự động).
 */
export function generateNginxConfig(domain, projectType, port, phpSocket) {
    if (projectType.includes('Node.js')) {
        return `
server {
    server_name ${domain};
    client_max_body_size 50M;
    location / {
        proxy_pass http://127.0.0.1:${port};
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
    client_max_body_size 50M;
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
    client_max_body_size 50M;
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
    client_max_body_size 50M;
    root /var/www/${domain};
    index index.html index.htm;

    location / {
        try_files $uri $uri/ =404;
    }
}
`;
    }
}
