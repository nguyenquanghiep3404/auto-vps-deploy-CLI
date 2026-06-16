import fs from 'fs';
import crypto from 'crypto';

/**
 * Đọc nội dung file .env từ đường dẫn local.
 * Trả về chuỗi nội dung (giữ nguyên xuống dòng), hoặc null nếu không đọc được.
 */
export function readEnvFile(filePath) {
    try {
        if (!filePath) return null;
        if (!fs.existsSync(filePath)) return null;
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) return null;
        return fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        return null;
    }
}

/**
 * Chuẩn hóa tên thành tên Github Secret hợp lệ.
 * Github Secret chỉ chấp nhận chữ HOA, số và gạch dưới, không bắt đầu bằng số.
 */
export function sanitizeSecretName(name) {
    let s = String(name).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    s = s.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (s === '' || /^[0-9]/.test(s)) s = 'X_' + s;
    return s;
}

/**
 * Tạo "slug" sạch dùng làm tên DB / DB user mặc định.
 * Chỉ gồm chữ thường, số, gạch dưới và luôn bắt đầu bằng chữ cái.
 */
export function slugify(name) {
    let s = String(name).toLowerCase().replace(/[^a-z0-9_]/g, '_');
    s = s.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (s === '') s = 'app';
    if (/^[0-9]/.test(s)) s = 'a' + s;
    return s;
}

/**
 * Sinh mật khẩu ngẫu nhiên mạnh.
 * Chỉ dùng chữ + số để tránh lỗi escape trong shell, URL kết nối và file .env.
 */
export function generatePassword(length = 24) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) {
        out += chars[bytes[i] % chars.length];
    }
    return out;
}

/**
 * Sinh APP_KEY cho Laravel (tương đương `php artisan key:generate`).
 * Định dạng: base64:<32 byte ngẫu nhiên đã mã hóa base64>.
 */
export function generateLaravelAppKey() {
    return 'base64:' + crypto.randomBytes(32).toString('base64');
}

/**
 * Tạo chuỗi kết nối DATABASE_URL cho Prisma (Node.js) theo loại DB.
 */
export function buildPrismaDatabaseUrl(engine, user, pass, dbName, host = 'localhost') {
    if (engine === 'mysql') {
        return `mysql://${user}:${pass}@${host}:3306/${dbName}`;
    } else if (engine === 'postgresql') {
        return `postgresql://${user}:${pass}@${host}:5432/${dbName}?schema=public`;
    } else if (engine === 'mongodb') {
        // MongoDB local mặc định không bật auth -> không cần user/pass.
        return `mongodb://${host}:27017/${dbName}`;
    }
    return '';
}

/**
 * Tạo các dòng biến môi trường DB cho Laravel.
 */
export function buildLaravelDbEnv(engine, user, pass, dbName, host = '127.0.0.1') {
    const conn = engine === 'postgresql' ? 'pgsql' : (engine === 'mongodb' ? 'mongodb' : 'mysql');
    const port = engine === 'postgresql' ? 5432 : (engine === 'mongodb' ? 27017 : 3306);
    const lines = [
        `DB_CONNECTION=${conn}`,
        `DB_HOST=${host}`,
        `DB_PORT=${port}`,
        `DB_DATABASE=${dbName}`,
        `DB_USERNAME=${user}`,
        `DB_PASSWORD=${pass}`
    ];
    return lines.join('\n');
}

/**
 * Kiểm tra xem nội dung .env đã có một biến (có giá trị khác rỗng) hay chưa.
 */
export function envHasKey(content, key) {
    if (!content) return false;
    // Chỉ dùng khoảng trắng ngang [ \t] để không "ăn" sang dòng kế tiếp,
    // đảm bảo biến phải có giá trị khác rỗng ngay trên cùng một dòng.
    const re = new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*\\S`, 'm');
    return re.test(content);
}

/**
 * Gộp nội dung .env do người dùng cung cấp với các dòng do tool sinh thêm.
 * Các dòng sinh thêm được đặt trong một khối có chú thích để dễ nhận biết.
 */
export function mergeEnvContent(userContent, generatedLines) {
    const generated = (generatedLines || []).filter(Boolean);
    let base = userContent ? userContent.replace(/\s*$/, '') : '';
    if (generated.length === 0) {
        return base ? base + '\n' : '';
    }
    const block = ['# ----- Được thêm tự động bởi deploy-vps -----', ...generated].join('\n');
    if (!base) return block + '\n';
    return base + '\n\n' + block + '\n';
}

/**
 * Loại bỏ mọi dòng PORT=... (cổng app) khỏi nội dung .env của người dùng,
 * để cổng cứng trong .env không đè lên cổng do tool gán.
 * KHÔNG đụng tới DB_PORT / các biến *_PORT khác (chỉ khớp đúng key "PORT").
 */
export function stripAppPort(content) {
    if (!content) return content;
    return content
        .split('\n')
        .filter(line => !/^[ \t]*PORT[ \t]*=/.test(line))
        .join('\n');
}

/**
 * Phân tích một connection string dạng URL (vd Supabase: postgresql://user:pass@host:5432/db).
 * Trả về { scheme, user, pass, host, port, dbName } hoặc null nếu không phân tích được.
 * Dùng cho DB do nhà cung cấp quản lý (managed) khi cần tách ra biến DB_* (Laravel/PHP).
 */
export function parseDatabaseUrl(url) {
    try {
        const u = new URL(String(url).trim());
        return {
            scheme: u.protocol.replace(/:$/, ''),
            user: decodeURIComponent(u.username || ''),
            pass: decodeURIComponent(u.password || ''),
            host: u.hostname || '',
            port: u.port || '',
            dbName: (u.pathname || '').replace(/^\//, '')
        };
    } catch (e) {
        return null;
    }
}

/**
 * Sinh các dòng .env cho DB do nhà cung cấp quản lý (vd Supabase) từ connection string.
 * - Node.js (Prisma/ORM): chỉ cần DATABASE_URL — ORM tự phân tích, giữ NGUYÊN chuỗi
 *   người dùng dán (kể cả mật khẩu có ký tự đặc biệt chưa encode).
 * - Laravel/PHP: tách connection string thành DB_* (best-effort) và GIỮ thêm DATABASE_URL.
 */
export function buildManagedDbEnvLines(projectType, url) {
    const clean = (url || '').trim();
    if (!clean) return '';

    if (projectType && projectType.includes('Node.js')) {
        return `DATABASE_URL="${clean}"`;
    }

    const p = parseDatabaseUrl(clean);
    const lines = [];
    if (p && p.host) {
        const isPg = /postgres/i.test(p.scheme);
        const conn = isPg ? 'pgsql' : (/mysql|maria/i.test(p.scheme) ? 'mysql' : (p.scheme || 'pgsql'));
        const port = p.port || (isPg ? '5432' : '3306');
        lines.push(`DB_CONNECTION=${conn}`);
        lines.push(`DB_HOST=${p.host}`);
        lines.push(`DB_PORT=${port}`);
        lines.push(`DB_DATABASE=${p.dbName}`);
        lines.push(`DB_USERNAME=${p.user}`);
        lines.push(`DB_PASSWORD=${p.pass}`);
    }
    lines.push(`DATABASE_URL="${clean}"`);
    return lines.join('\n');
}
