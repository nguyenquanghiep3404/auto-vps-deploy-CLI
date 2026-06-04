import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateNginxConfig } from '../src/vps/templates.js';

const NODE = 'Node.js (PM2 - Next.js, Express, NestJS...)';
const LARAVEL = 'PHP (Laravel)';
const PUREPHP = 'PHP (Thuần)';
const SPA = 'React/Vite/Vue (SPA)';
const STATIC = 'Static (HTML thuần)';

test('Node: reverse proxy tới đúng cổng, không có PHP', () => {
    const c = generateNginxConfig('app.com', NODE, 3001, null);
    assert.match(c, /proxy_pass http:\/\/127\.0\.0\.1:3001;/);
    assert.match(c, /server_name app\.com;/);
    assert.ok(!c.includes('fastcgi_pass'));
});

test('Laravel: dùng đúng socket động + root trỏ /public', () => {
    const c = generateNginxConfig('shop.com', LARAVEL, undefined, '/run/php/php8.2-fpm.sock');
    assert.match(c, /fastcgi_pass unix:\/run\/php\/php8\.2-fpm\.sock;/);
    assert.match(c, /root \/var\/www\/shop\.com\/public;/);
    // Không còn hard-code php8.1
    assert.ok(!c.includes('php8.1-fpm.sock'));
});

test('PHP thuần: root trỏ thẳng /var/www/domain (không /public)', () => {
    const c = generateNginxConfig('legacy.com', PUREPHP, undefined, '/run/php/php8.3-fpm.sock');
    assert.match(c, /root \/var\/www\/legacy\.com;/);
    assert.ok(!c.includes('/public'));
});

test('PHP: socket mặc định khi không truyền phpSocket', () => {
    const c = generateNginxConfig('x.com', LARAVEL, undefined, null);
    assert.match(c, /fastcgi_pass unix:\/run\/php\/php8\.3-fpm\.sock;/);
});

test('SPA: try_files fallback về index.html (xử lý F5 routing)', () => {
    const c = generateNginxConfig('spa.com', SPA, undefined, null);
    assert.match(c, /try_files \$uri \$uri\/ \/index\.html;/);
    assert.match(c, /root \/var\/www\/spa\.com;/);
});

test('Static: try_files trả =404', () => {
    const c = generateNginxConfig('s.com', STATIC, undefined, null);
    assert.match(c, /try_files \$uri \$uri\/ =404;/);
});

test('client_max_body_size có trong mọi loại (tránh lỗi 413 khi upload)', () => {
    for (const t of [NODE, LARAVEL, PUREPHP, SPA, STATIC]) {
        const c = generateNginxConfig('d.com', t, 3001, '/run/php/php8.3-fpm.sock');
        assert.match(c, /client_max_body_size 50M;/, `thiếu client_max_body_size cho ${t}`);
    }
});

test('Node: proxy_pass dùng 127.0.0.1 (tránh lỗi IPv6 ::1 -> 502)', () => {
    const c = generateNginxConfig('app.com', NODE, 3005, null);
    assert.match(c, /proxy_pass http:\/\/127\.0\.0\.1:3005;/);
    assert.ok(!c.includes('localhost'), 'không còn dùng localhost');
});
