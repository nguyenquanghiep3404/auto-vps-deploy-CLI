import fs from 'fs';
import path from 'path';

// Nhãn loại dự án — PHẢI khớp đúng với các lựa chọn trong bin/index.js
export const TYPE = {
    NODE: 'Node.js (PM2 - Next.js, Express, NestJS...)',
    LARAVEL: 'PHP (Laravel)',
    PHP: 'PHP (Thuần)',
    SPA: 'React/Vite/Vue (SPA)',
    STATIC: 'Static (HTML thuần)'
};

// Dependency cho thấy app là 1 server Node chạy lâu dài (deploy bằng PM2).
// Next.js/Nuxt là SSR -> vẫn chạy như server -> xếp vào Node.js.
const SERVER_DEPS = [
    'express', 'next', 'nuxt', '@nestjs/core', 'fastify', 'koa',
    '@hapi/hapi', 'hapi', '@adonisjs/core', 'hono', 'restify', '@feathersjs/feathers'
];

// Dependency cho thấy đây là app client build ra file tĩnh (SPA).
const SPA_DEPS = [
    'vite', 'react-scripts', 'react', 'vue', '@angular/core',
    'svelte', '@vue/cli-service', 'parcel', 'preact'
];

// Driver/dependency Node -> loại Database (chỉ map tới các engine tool hỗ trợ).
// Thứ tự QUAN TRỌNG: cái cụ thể/khả năng cao đặt trước (match đầu tiên thắng).
const DB_DRIVER_DEPS = [
    ['pg', 'postgresql'], ['pg-promise', 'postgresql'], ['postgres', 'postgresql'],
    ['@vercel/postgres', 'postgresql'], ['@neondatabase/serverless', 'postgresql'],
    ['mysql2', 'mysql'], ['mysql', 'mysql'],
    ['mongodb', 'mongodb'], ['mongoose', 'mongodb']
];

// provider trong prisma/schema.prisma -> engine tool hỗ trợ (bỏ qua sqlite/sqlserver: không cần DB server).
const PRISMA_PROVIDER_MAP = {
    postgresql: 'postgresql', postgres: 'postgresql', cockroachdb: 'postgresql',
    mysql: 'mysql', mongodb: 'mongodb'
};

function safeExists(p) {
    try { return fs.existsSync(p); } catch (e) { return false; }
}

/** Đọc & parse package.json, gộp dependencies + devDependencies. Trả về null nếu không có/lỗi. */
export function readPkg(dirAbs) {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dirAbs, 'package.json'), 'utf8'));
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        return { ...pkg, _deps: deps };
    } catch (e) {
        return null;
    }
}

function hasAnyDep(deps, list) {
    return list.some(name => Object.prototype.hasOwnProperty.call(deps, name));
}

/** Có file .php nào ở ngay trong thư mục không (quét nông, không đệ quy). */
function hasPhpFiles(dirAbs) {
    if (safeExists(path.join(dirAbs, 'index.php'))) return true;
    try {
        return fs.readdirSync(dirAbs).some(f => f.endsWith('.php'));
    } catch (e) {
        return false;
    }
}

/**
 * Nhận diện loại dự án của MỘT thư mục dựa theo dấu vân tay file + nội dung package.json.
 * Trả về một trong các nhãn TYPE.*, hoặc null nếu không đoán được.
 */
export function detectProjectType(dirAbs) {
    // --- PHP ---
    const hasComposer = safeExists(path.join(dirAbs, 'composer.json'));
    if (safeExists(path.join(dirAbs, 'artisan')) && hasComposer) return TYPE.LARAVEL;
    if (hasComposer || hasPhpFiles(dirAbs)) {
        // composer.json có laravel/framework nhưng thiếu artisan -> vẫn coi là Laravel
        try {
            const composer = JSON.parse(fs.readFileSync(path.join(dirAbs, 'composer.json'), 'utf8'));
            const req = { ...(composer.require || {}), ...(composer['require-dev'] || {}) };
            if (req['laravel/framework']) return TYPE.LARAVEL;
        } catch (e) { /* bỏ qua */ }
        return TYPE.PHP;
    }

    // --- Node / SPA (dựa vào package.json) ---
    const pkg = readPkg(dirAbs);
    if (pkg) {
        const deps = pkg._deps;
        if (hasAnyDep(deps, SERVER_DEPS)) return TYPE.NODE;
        if (hasAnyDep(deps, SPA_DEPS)) return TYPE.SPA;
        const scripts = pkg.scripts || {};
        // Có build nhưng không có start -> nhiều khả năng là app build tĩnh.
        if (scripts.build && !scripts.start) return TYPE.SPA;
        // Có package.json -> mặc định coi là service Node (người dùng có thể sửa).
        return TYPE.NODE;
    }

    // --- Static ---
    if (safeExists(path.join(dirAbs, 'index.html'))) return TYPE.STATIC;

    return null;
}

/** Đoán thư mục output build cho SPA: ưu tiên outDir trong vite.config, react-scripts -> build, mặc định dist. */
export function detectBuildDir(dirAbs) {
    for (const f of ['vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.cjs']) {
        try {
            const content = fs.readFileSync(path.join(dirAbs, f), 'utf8');
            const m = content.match(/outDir\s*:\s*['"`]([^'"`]+)['"`]/);
            if (m) return m[1];
        } catch (e) { /* không có file -> bỏ qua */ }
    }
    const pkg = readPkg(dirAbs);
    if (pkg && pkg._deps['react-scripts']) return 'build';
    return 'dist';
}

/**
 * Đoán phiên bản Node (major) cần dùng: ưu tiên `.nvmrc`, rồi `engines.node` trong package.json.
 * Lấy số major đầu tiên tìm thấy (vd ">=20" -> "20", "18.17.0" -> "18"). Trả về chuỗi major
 * hoặc null nếu không khai báo (khi đó caller dùng mặc định). Bỏ qua giá trị vô lý (<12 hoặc >40).
 */
export function detectNodeVersion(dirAbs) {
    const pick = (raw) => {
        const m = String(raw).match(/(\d{2})/);
        if (!m) return null;
        const major = parseInt(m[1], 10);
        return (major >= 12 && major <= 40) ? String(major) : null;
    };
    try {
        const nvmrc = fs.readFileSync(path.join(dirAbs, '.nvmrc'), 'utf8').trim();
        const v = pick(nvmrc);
        if (v) return v;
    } catch (e) { /* không có .nvmrc */ }
    const pkg = readPkg(dirAbs);
    const eng = pkg && pkg.engines && pkg.engines.node;
    if (eng) {
        const v = pick(eng);
        if (v) return v;
    }
    return null;
}

/** Đoán start script production: NestJS thường có start:prod, nếu không thì start. */
export function detectStartScript(dirAbs) {
    const pkg = readPkg(dirAbs);
    const scripts = (pkg && pkg.scripts) || {};
    if (scripts['start:prod']) return 'start:prod';
    return 'start';
}

/** Có dùng Prisma không (tồn tại prisma/schema.prisma hoặc dependency prisma). */
export function detectPrisma(dirAbs) {
    if (safeExists(path.join(dirAbs, 'prisma', 'schema.prisma'))) return true;
    const pkg = readPkg(dirAbs);
    return !!(pkg && (pkg._deps['prisma'] || pkg._deps['@prisma/client']));
}

/** Đọc nội dung file đầu tiên TỒN TẠI trong danh sách (theo thứ tự ưu tiên). Trả về null nếu không có. */
function readFirstFile(dirAbs, files) {
    for (const f of files) {
        try { return fs.readFileSync(path.join(dirAbs, f), 'utf8'); } catch (e) { /* bỏ qua */ }
    }
    return null;
}

/**
 * Đoán engine DB từ một chuỗi connection string (vd nội dung .env có DATABASE_URL).
 * Trả về 'postgresql' | 'mysql' | 'mongodb' | null. Ưu tiên dòng DATABASE_URL nếu có.
 */
export function detectDatabaseUrlEngine(content) {
    if (!content) return null;
    const m = content.match(/^[ \t]*DATABASE_URL[ \t]*=[ \t]*["']?([^\s"']+)/im);
    const target = m ? m[1] : content;
    if (/\bpostgres(?:ql)?:\/\//i.test(target)) return 'postgresql';
    if (/\bmysql:\/\//i.test(target)) return 'mysql';
    if (/\bmongodb(?:\+srv)?:\/\//i.test(target)) return 'mongodb';
    return null;
}

/**
 * Nhận diện loại Database dự án đang dùng — chỉ là GỢI Ý để điền sẵn câu hỏi (người dùng vẫn sửa được).
 * Thứ tự ưu tiên (chính xác dần xuống): Prisma schema → driver trong dependencies →
 * biến trong .env/.env.example → (Laravel) DB_CONNECTION.
 * Trả về { engine, managed, source } hoặc null.
 *   - managed=true nghĩa là DB cloud (Supabase) — tool KHÔNG cài trên VPS.
 */
export function detectDatabase(dirAbs) {
    // 1) Prisma datasource provider — chuẩn xác nhất cho Node.
    const schema = readFirstFile(dirAbs, ['prisma/schema.prisma']);
    if (schema) {
        const m = schema.match(/datasource\s+\w+\s*\{[^}]*?provider\s*=\s*["']([a-z]+)["']/is)
            || schema.match(/provider\s*=\s*["']([a-z]+)["']/i);
        if (m) {
            const eng = PRISMA_PROVIDER_MAP[m[1].toLowerCase()];
            if (eng) return { engine: eng, managed: false, source: 'prisma/schema.prisma' };
        }
    }

    // 2) Driver / SDK trong dependencies.
    const pkg = readPkg(dirAbs);
    if (pkg) {
        const deps = pkg._deps;
        if (deps['@supabase/supabase-js']) {
            return { engine: 'supabase', managed: true, source: 'dependency @supabase/supabase-js' };
        }
        for (const [dep, eng] of DB_DRIVER_DEPS) {
            if (Object.prototype.hasOwnProperty.call(deps, dep)) {
                return { engine: eng, managed: false, source: `dependency ${dep}` };
            }
        }
    }

    // 3) .env / .env.example — Supabase rõ ràng, rồi tới DATABASE_URL, rồi DB_CONNECTION (Laravel).
    const env = readFirstFile(dirAbs, ['.env', '.env.example', '.env.local', '.env.sample']);
    if (env) {
        if (/SUPABASE_URL|supabase\.co|pooler\.supabase\.com/i.test(env)) {
            return { engine: 'supabase', managed: true, source: '.env (Supabase)' };
        }
        const urlEng = detectDatabaseUrlEngine(env);
        if (urlEng) return { engine: urlEng, managed: false, source: '.env DATABASE_URL' };
        const m = env.match(/^[ \t]*DB_CONNECTION[ \t]*=[ \t]*["']?([a-z]+)/im);
        if (m) {
            const map = { pgsql: 'postgresql', postgres: 'postgresql', mysql: 'mysql', mariadb: 'mysql', mongodb: 'mongodb' };
            const eng = map[m[1].toLowerCase()];
            if (eng) return { engine: eng, managed: false, source: '.env DB_CONNECTION' };
        }
    }

    return null;
}

/** Nhãn hiển thị thân thiện cho engine DB đã nhận diện. */
export function databaseLabel(db) {
    if (!db || !db.engine) return '';
    const map = { postgresql: 'PostgreSQL', mysql: 'MySQL', mongodb: 'MongoDB', supabase: 'Supabase' };
    return map[db.engine] || db.engine;
}

/** Đọc composer.json require.php -> đề xuất phiên bản X.Y (vd ">=8.1" -> "8.1"). Trả về null nếu không có. */
export function detectPhpVersion(dirAbs) {
    try {
        const composer = JSON.parse(fs.readFileSync(path.join(dirAbs, 'composer.json'), 'utf8'));
        const req = { ...(composer.require || {}), ...(composer['require-dev'] || {}) };
        const constraint = req.php;
        if (!constraint) return null;
        const m = String(constraint).match(/(\d+\.\d+)/);
        return m ? m[1] : null;
    } catch (e) {
        return null;
    }
}

// Thư mục con thường gặp trong monorepo (frontend + backend...).
const DIR_CANDIDATES = ['frontend', 'backend', 'client', 'server', 'web', 'api', 'admin', 'app', 'www', 'site', 'ui'];
// Thư mục "ô chứa" của monorepo theo quy ước.
const MONOREPO_CONTAINERS = ['apps', 'packages', 'services'];
// File cho thấy thư mục là một dự án triển khai được.
const PROJECT_MARKERS = ['package.json', 'composer.json', 'artisan', 'index.html'];

function isProjectDir(dirAbs) {
    return PROJECT_MARKERS.some(f => safeExists(path.join(dirAbs, f)));
}

function isDir(p) {
    try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

/**
 * Nhận diện cấu trúc repo: single hay monorepo, và liệt kê các phần (nếu monorepo).
 * Monorepo khi tìm được >= 2 thư mục con là dự án (theo tên quen thuộc hoặc trong apps/packages/services).
 * Trả về { isMonorepo, parts: [{ name, workingDir }] } (workingDir dạng './xxx', hoặc './' cho single).
 */
export function detectStructure(repoRootAbs) {
    const found = [];
    const seen = new Set();
    const add = (rel, abs) => {
        if (seen.has(rel)) return;
        if (isDir(abs) && isProjectDir(abs)) {
            seen.add(rel);
            found.push({ name: path.basename(rel), workingDir: './' + rel });
        }
    };

    for (const cand of DIR_CANDIDATES) {
        add(cand, path.join(repoRootAbs, cand));
    }
    for (const container of MONOREPO_CONTAINERS) {
        const base = path.join(repoRootAbs, container);
        if (!isDir(base)) continue;
        let children = [];
        try { children = fs.readdirSync(base); } catch (e) { children = []; }
        for (const child of children) {
            add(container + '/' + child, path.join(base, child));
        }
    }

    if (found.length >= 2) {
        return { isMonorepo: true, parts: found };
    }
    return { isMonorepo: false, parts: [{ name: 'app', workingDir: './' }] };
}

/** Bổ sung chi tiết (loại dự án + tham số phụ) cho một phần dựa trên thư mục của nó. */
function enrichPart(name, workingDir, dirAbs) {
    const projectType = detectProjectType(dirAbs);
    const part = { name, workingDir, projectType };
    if (projectType === TYPE.SPA) {
        part.buildDir = detectBuildDir(dirAbs);
    }
    if (projectType === TYPE.NODE) {
        part.startScript = detectStartScript(dirAbs);
        part.usePrisma = detectPrisma(dirAbs);
        part.database = detectDatabase(dirAbs);
    }
    if (projectType === TYPE.LARAVEL || projectType === TYPE.PHP) {
        part.phpVersion = detectPhpVersion(dirAbs);
        part.database = detectDatabase(dirAbs);
    }
    return part;
}

/**
 * Điểm vào tổng hợp: nhận diện toàn bộ repo.
 * Trả về { isMonorepo, parts: [{ name, workingDir, projectType, buildDir?, startScript?, usePrisma?, phpVersion? }] }.
 * Mọi giá trị chỉ là GỢI Ý để điền sẵn câu hỏi — người dùng vẫn có thể sửa.
 */
export function detectProject(repoRootAbs) {
    const struct = detectStructure(repoRootAbs);
    const parts = struct.parts.map(p => {
        const rel = p.workingDir.replace(/^\.\//, '').replace(/\/+$/, '');
        const dirAbs = rel ? path.join(repoRootAbs, rel) : repoRootAbs;
        return enrichPart(p.name, p.workingDir, dirAbs);
    });
    // Nhận diện riêng thư mục gốc như một dự án đơn — dùng làm gợi ý cho luồng Single
    // kể cả khi cấu trúc được đoán là Monorepo (người dùng có thể đổi ý).
    const root = enrichPart('app', './', repoRootAbs);
    return { isMonorepo: struct.isMonorepo, parts, root };
}
