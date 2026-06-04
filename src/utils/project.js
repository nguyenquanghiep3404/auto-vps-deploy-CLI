import fs from 'fs';
import path from 'path';

const LOCKFILES = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm']
];

function safeExists(p) {
    try { return fs.existsSync(p); } catch (e) { return false; }
}

/**
 * Phát hiện package manager dựa theo lockfile.
 * Kiểm tra thư mục con (workingDir) trước, sau đó tới thư mục gốc repo.
 * Trả về { pm: 'npm'|'pnpm'|'yarn', atRoot: boolean }.
 */
export function detectPackageManager(workingDirAbs, repoRootAbs) {
    const locations = [];
    if (workingDirAbs) locations.push({ dir: workingDirAbs, root: false });
    if (repoRootAbs && repoRootAbs !== workingDirAbs) locations.push({ dir: repoRootAbs, root: true });

    for (const loc of locations) {
        for (const [lock, pm] of LOCKFILES) {
            if (safeExists(path.join(loc.dir, lock))) {
                return { pm, atRoot: loc.root };
            }
        }
    }
    return { pm: 'npm', atRoot: false };
}

function rootPkgHasWorkspaces(rootAbs) {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(rootAbs, 'package.json'), 'utf8'));
        return !!pkg.workspaces;
    } catch (e) {
        return false;
    }
}

/**
 * Đoán dự án (phần con) có dùng workspaces hay không:
 * - Thư mục con KHÔNG có lockfile riêng, NHƯNG
 * - Thư mục gốc CÓ lockfile, hoặc có cấu hình workspace (pnpm-workspace.yaml / package.json "workspaces" / turbo.json).
 */
export function detectWorkspace(workingDirAbs, repoRootAbs) {
    if (!repoRootAbs || workingDirAbs === repoRootAbs) return false;

    const subdirHasLock = LOCKFILES.some(([f]) => safeExists(path.join(workingDirAbs, f)));
    if (subdirHasLock) return false;

    const rootHasLock = LOCKFILES.some(([f]) => safeExists(path.join(repoRootAbs, f)));
    const rootWorkspaceCfg = safeExists(path.join(repoRootAbs, 'pnpm-workspace.yaml'))
        || safeExists(path.join(repoRootAbs, 'turbo.json'))
        || rootPkgHasWorkspaces(repoRootAbs);

    return rootHasLock || rootWorkspaceCfg;
}

/**
 * Kiểm tra package.json trong thư mục có script "build" hay không.
 * Trả về true chỉ khi chắc chắn có script build (tương đương "npm run build --if-present").
 */
export function hasBuildScript(dirAbs) {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dirAbs, 'package.json'), 'utf8'));
        return !!(pkg.scripts && pkg.scripts.build);
    } catch (e) {
        return false;
    }
}

/**
 * Tìm dấu hiệu HARDCODE cổng trong source: `.listen(3000)` với số literal.
 * Trả về mảng số cổng tìm thấy. Bỏ qua `.listen(process.env.PORT ...)` (không có số literal).
 * Đây là heuristic để CẢNH BÁO, không phải phân tích cú pháp đầy đủ.
 */
export function findHardcodedPorts(content) {
    if (!content) return [];
    const ports = [];
    // .listen( theo sau bởi 1 số 2-5 chữ số (vd 3000). Cho phép có khoảng trắng.
    const re = /\.listen\s*\(\s*(\d{2,5})\b/g;
    let m;
    while ((m = re.exec(content)) !== null) {
        ports.push(parseInt(m[1], 10));
    }
    return ports;
}

// Các file entry phổ biến để quét nhanh (không đệ quy sâu, bỏ qua node_modules).
const ENTRY_CANDIDATES = [
    'index.js', 'server.js', 'app.js', 'main.js', 'src/index.js', 'src/server.js',
    'src/app.js', 'src/main.js', 'index.ts', 'server.ts', 'app.ts', 'main.ts',
    'src/index.ts', 'src/server.ts', 'src/app.ts', 'src/main.ts'
];

function scanEntryFiles(dirAbs, fn) {
    const hits = [];
    for (const rel of ENTRY_CANDIDATES) {
        try {
            const content = fs.readFileSync(path.join(dirAbs, rel), 'utf8');
            for (const item of fn(content)) hits.push({ file: rel, ...item });
        } catch (e) { /* file không tồn tại -> bỏ qua */ }
    }
    return hits;
}

/**
 * Quét nhanh các file entry để tìm cổng hardcode. Trả về [{ file, port }].
 */
export function scanHardcodedPorts(dirAbs) {
    return scanEntryFiles(dirAbs, (c) => findHardcodedPorts(c).map(port => ({ port })));
}

/**
 * Tìm URL trỏ localhost/127.0.0.1 trong source (vd API base bị hardcode).
 * Trả về mảng URL. Heuristic để CẢNH BÁO (giống lỗi hardcode cổng nhưng cho URL).
 */
export function findLocalhostUrls(content) {
    if (!content) return [];
    const re = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/gi;
    return content.match(re) || [];
}

/**
 * Quét file entry tìm URL localhost hardcode. Trả về [{ file, url }].
 */
export function scanLocalhostUrls(dirAbs) {
    return scanEntryFiles(dirAbs, (c) => findLocalhostUrls(c).map(url => ({ url })));
}
