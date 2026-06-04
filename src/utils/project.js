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
