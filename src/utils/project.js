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

/**
 * Quét nhanh các file entry phổ biến trong thư mục dự án để tìm cổng hardcode.
 * Trả về mảng { file, port } để cảnh báo. Không đệ quy sâu, bỏ qua node_modules.
 */
export function scanHardcodedPorts(dirAbs) {
    const candidates = [
        'index.js', 'server.js', 'app.js', 'main.js', 'src/index.js', 'src/server.js',
        'src/app.js', 'src/main.js', 'index.ts', 'server.ts', 'app.ts', 'main.ts',
        'src/index.ts', 'src/server.ts', 'src/app.ts', 'src/main.ts'
    ];
    const hits = [];
    for (const rel of candidates) {
        try {
            const full = path.join(dirAbs, rel);
            const content = fs.readFileSync(full, 'utf8');
            for (const port of findHardcodedPorts(content)) {
                hits.push({ file: rel, port });
            }
        } catch (e) { /* file không tồn tại -> bỏ qua */ }
    }
    return hits;
}
