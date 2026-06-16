import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { generateWorkflowFile } from '../src/templates/workflows.js';

const NODE = 'Node.js (PM2 - Next.js, Express, NestJS...)';
const LARAVEL = 'PHP (Laravel)';
const PUREPHP = 'PHP (Thuần)';
const SPA = 'React/Vite/Vue (SPA)';
const STATIC = 'Static (HTML thuần)';

/** Sinh workflow trong một thư mục tạm, trả về { file, content }. */
function gen(opts) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wftest-'));
    const cwd = process.cwd();
    const origLog = console.log;
    console.log = () => {};
    try {
        process.chdir(dir);
        generateWorkflowFile(opts);
    } finally {
        process.chdir(cwd);
        console.log = origLog;
    }
    const wfDir = path.join(dir, '.github', 'workflows');
    const files = fs.readdirSync(wfDir);
    const content = fs.readFileSync(path.join(wfDir, files[0]), 'utf8');
    fs.rmSync(dir, { recursive: true, force: true });
    return { file: files[0], content };
}

/** Kiểm tra YAML cơ bản: không tab, không 'undefined', có các khối chính. */
function assertWellFormed(content) {
    assert.ok(!content.includes('\t'), 'không được có ký tự tab');
    assert.ok(!content.includes('undefined'), 'không được lọt giá trị undefined');
    assert.ok(content.startsWith('name:'), 'phải bắt đầu bằng name:');
    assert.match(content, /^on:/m);
    assert.match(content, /^jobs:/m);
    assert.match(content, /steps:/);
}

test('Node single + npm + Prisma + .env', () => {
    const { file, content } = gen({
        projectType: NODE, domain: 'app.com', role: 'Fullstack (Gốc)', workingDir: './',
        usePrisma: true, port: 3000, envSecretName: 'ENV_FILE', isWorkspace: false,
        packageManager: 'npm', startScript: 'start', hasBuild: true
    });
    assert.equal(file, 'deploy.yml');
    assertWellFormed(content);
    assert.match(content, /run: npm ci/);
    assert.match(content, /run: npm run build/);
    assert.match(content, /npx prisma db push --accept-data-loss/);
    assert.match(content, /pm2 start npm --name "app-app\.com" -- run start/);
    assert.match(content, /Tạo file \.env từ Github Secret/);
    assert.match(content, /secrets\.ENV_FILE \}\}/);
    assert.match(content, /pm2 save/);
    assert.ok(!content.includes('Enable Corepack'), 'npm không cần corepack');
    assert.match(content, /PORT=3000/);
});

test('Node single + pnpm + start:prod (không Prisma, không build script)', () => {
    const { content } = gen({
        projectType: NODE, domain: 'p.com', role: 'Fullstack (Gốc)', workingDir: './',
        usePrisma: false, port: 3009, envSecretName: 'ENV_FILE', isWorkspace: false,
        packageManager: 'pnpm', startScript: 'start:prod', hasBuild: false
    });
    assertWellFormed(content);
    assert.match(content, /Enable Corepack \(pnpm\)/);
    assert.match(content, /run: pnpm install --frozen-lockfile/);
    assert.match(content, /pnpm install --prod --frozen-lockfile/);
    assert.match(content, /pm2 start pnpm --name "app-p\.com" -- run start:prod/);
    assert.match(content, /corepack enable 2>\/dev\/null \|\| sudo corepack enable/);
    assert.ok(!content.includes('Build Project'), 'không có build script -> không có bước build');
    assert.ok(!content.includes('npx prisma'), 'không bật Prisma');
});

test('Node monorepo workspace + npm + Prisma', () => {
    const { file, content } = gen({
        projectType: NODE, domain: 'api.com', role: 'api', workingDir: './apps/api',
        usePrisma: true, port: 3001, envSecretName: 'ENV_FILE_API', isWorkspace: true,
        packageManager: 'npm', startScript: 'start:prod', hasBuild: true
    });
    assert.equal(file, 'deploy-api.yml');
    assertWellFormed(content);
    assert.match(content, /Monorepo Workspace/);
    assert.ok(!content.includes('working-directory'), 'workspace cài ở gốc, không set working-directory');
    assert.match(content, /printf '%s\\n' "\$ENV_FILE_CONTENT" > apps\/api\/\.env/);
    assert.match(content, /run: npm ci \|\| npm install/);
    assert.match(content, /--exclude 'node_modules' \.\/ \$USER@\$HOST:\/var\/www\/api\.com/);
    assert.match(content, /--filter='P \.env'/); // bảo vệ .env khỏi --delete
    assert.match(content, /cd \/var\/www\/api\.com\n/);
    assert.match(content, /npm ci --production/);
    assert.match(content, /cd \/var\/www\/api\.com\/apps\/api/);
    assert.match(content, /pm2 start npm --name "app-api\.com" -- run start:prod/);
});

test('Node monorepo workspace + pnpm (corepack ở cả runner & VPS)', () => {
    const { content } = gen({
        projectType: NODE, domain: 'dp.com', role: 'web', workingDir: './apps/web',
        usePrisma: true, port: 3002, envSecretName: 'ENV_FILE_WEB', isWorkspace: true,
        packageManager: 'pnpm', startScript: 'start', hasBuild: true
    });
    assertWellFormed(content);
    assert.match(content, /Enable Corepack \(pnpm\)/);
    assert.match(content, /run: pnpm install --frozen-lockfile/);
    assert.match(content, /run: pnpm run build/);
    assert.match(content, /corepack enable 2>\/dev\/null \|\| sudo corepack enable/);
    assert.match(content, /pnpm install --prod --frozen-lockfile/);
    assert.match(content, /pm2 start pnpm/);
});

test('Node: không có envSecretName -> không có bước tạo .env', () => {
    const { content } = gen({
        projectType: NODE, domain: 'plain.com', role: 'Fullstack (Gốc)', workingDir: './',
        usePrisma: false, port: 3005, envSecretName: undefined, isWorkspace: false,
        packageManager: 'npm', startScript: 'start', hasBuild: true
    });
    assertWellFormed(content);
    assert.ok(!content.includes('Tạo file .env'), 'không secret -> không tạo .env');
});

test('Laravel single, PHP 8.2, key:generate + migrate, không hard-code 8.1', () => {
    const { file, content } = gen({
        projectType: LARAVEL, domain: 'shop.com', role: 'Fullstack (Gốc)', workingDir: './',
        envSecretName: 'ENV_FILE', phpVersion: '8.2'
    });
    assert.equal(file, 'deploy.yml');
    assertWellFormed(content);
    assert.match(content, /php-version: '8\.2'/);
    assert.match(content, /php artisan key:generate --force/);
    assert.match(content, /php artisan migrate --force/);
    assert.match(content, /pdo_mysql/);
    assert.match(content, /pdo_pgsql/);
    assert.ok(!content.includes("php-version: '8.1'"));
});

test('Laravel monorepo -> tên file & working-directory đúng', () => {
    const { file, content } = gen({
        projectType: LARAVEL, domain: 'api.shop.com', role: 'backend', workingDir: './api',
        envSecretName: 'ENV_FILE_BACKEND', phpVersion: '8.3'
    });
    assert.equal(file, 'deploy-backend.yml');
    assert.match(content, /working-directory: \.\/api/);
});

test('PHP thuần: có bước tạo .env khi có secret', () => {
    const { content } = gen({
        projectType: PUREPHP, domain: 'legacy.com', role: 'Fullstack (Gốc)', workingDir: './',
        envSecretName: 'ENV_FILE', phpVersion: '8.1'
    });
    assertWellFormed(content);
    assert.match(content, /Tạo file \.env từ Github Secret/);
    assert.match(content, /rsync -avz --delete/);
});

test('SPA single + npm: build rồi rsync thư mục dist, .env trước build', () => {
    const { content } = gen({
        projectType: SPA, domain: 'spa.com', role: 'Fullstack (Gốc)', workingDir: './',
        buildDir: 'dist', envSecretName: 'ENV_FILE', isWorkspace: false, packageManager: 'npm'
    });
    assertWellFormed(content);
    assert.match(content, /run: npm run build/);
    assert.match(content, /dist\/ \$USER@\$HOST:\/var\/www\/spa\.com/);
    // .env phải đứng TRƯỚC bước build (để Vite/CRA đọc biến lúc build)
    assert.ok(content.indexOf('Tạo file .env') < content.indexOf('Build Project'));
});

test('SPA monorepo workspace + yarn', () => {
    const { file, content } = gen({
        projectType: SPA, domain: 'fe.com', role: 'frontend', workingDir: './apps/web',
        buildDir: 'dist', envSecretName: 'ENV_FILE_FE', isWorkspace: true, packageManager: 'yarn'
    });
    assert.equal(file, 'deploy-frontend.yml');
    assertWellFormed(content);
    assert.match(content, /Monorepo Workspace/);
    assert.match(content, /Enable Corepack \(yarn\)/);
    assert.match(content, /run: yarn install --frozen-lockfile/);
    assert.match(content, /run: yarn build/);
    assert.match(content, /printf '%s\\n' "\$ENV_FILE_CONTENT" > apps\/web\/\.env/);
    assert.match(content, /apps\/web\/dist\/ \$USER@\$HOST:\/var\/www\/fe\.com/);
});

test('Static: không có bước Node/npm', () => {
    const { file, content } = gen({
        projectType: STATIC, domain: 's.com', role: 'Fullstack (Gốc)', workingDir: './'
    });
    assert.equal(file, 'deploy.yml');
    assertWellFormed(content);
    assert.ok(!content.includes('Setup Node.js'));
    assert.ok(!content.includes('npm'));
    assert.match(content, /rsync -avz --delete/);
});

test('Tên file: role "API" -> deploy-api.yml (chữ thường)', () => {
    const { file } = gen({
        projectType: STATIC, domain: 'x.com', role: 'API', workingDir: './'
    });
    assert.equal(file, 'deploy-api.yml');
});

test('rsync luôn loại trừ .github (không đẩy workflow CI vào webroot)', () => {
    // Static: rsync từ gốc repo -> bắt buộc loại trừ cả .git và .github
    const stat = gen({ projectType: STATIC, domain: 'st.com', role: 'Fullstack (Gốc)', workingDir: './' });
    assert.match(stat.content, /rsync -avz --delete --exclude '\.git' --exclude '\.github'/);

    // PHP thuần: cũng rsync từ gốc repo
    const php = gen({
        projectType: PUREPHP, domain: 'ph.com', role: 'Fullstack (Gốc)', workingDir: './',
        envSecretName: 'ENV_FILE', phpVersion: '8.1'
    });
    assert.match(php.content, /--exclude '\.github'/);

    // Node single: rsync từ gốc repo
    const node = gen({
        projectType: NODE, domain: 'nd.com', role: 'Fullstack (Gốc)', workingDir: './',
        usePrisma: false, port: 3007, isWorkspace: false, packageManager: 'npm',
        startScript: 'start', hasBuild: false
    });
    assert.match(node.content, /--exclude '\.github'/);

    // Không được lọt ".github'--exclude" hay ".github'$" (lỗi thiếu space khi nối exclude)
    for (const c of [stat.content, php.content, node.content]) {
        assert.ok(!/--exclude '\.github'\S/.test(c), 'phải có dấu cách sau --exclude \'.github\'');
    }
});

test('Monorepo NON-workspace: nguồn rsync KHÔNG bị lồng thư mục con (regression)', () => {
    // Bug: working-directory đã cd vào thư mục con, nếu nguồn rsync còn ghép lại workingDir
    // -> ./frontend/frontend (không tồn tại) -> rsync lỗi. Nguồn phải là './' (hoặc 'dist/' cho SPA).
    const node = gen({
        projectType: NODE, domain: 'fe.com', role: 'frontend', workingDir: './frontend',
        usePrisma: false, port: 3000, isWorkspace: false, packageManager: 'npm', startScript: 'start', hasBuild: true
    });
    assert.match(node.content, /working-directory: \.\/frontend/);
    assert.match(node.content, /--exclude 'node_modules' \.\/ \$USER@\$HOST:\/var\/www\/fe\.com/);
    assert.ok(!/\.\/frontend\/frontend/.test(node.content), 'không được lồng ./frontend/frontend');
    assert.ok(!/frontend\/ \$USER@/.test(node.content), 'nguồn rsync không được chứa lại tên thư mục con');

    const spa = gen({
        projectType: SPA, domain: 'fe.com', role: 'frontend', workingDir: './frontend',
        buildDir: 'dist', isWorkspace: false, packageManager: 'npm'
    });
    assert.match(spa.content, /working-directory: \.\/frontend/);
    assert.match(spa.content, /dist\/ \$USER@\$HOST:\/var\/www\/fe\.com/);
    assert.ok(!/frontend\/dist/.test(spa.content), 'SPA: không được lồng ./frontend/dist');

    const lar = gen({
        projectType: LARAVEL, domain: 'api.com', role: 'backend', workingDir: './api',
        envSecretName: 'ENV_FILE_BACKEND', phpVersion: '8.3'
    });
    assert.match(lar.content, /working-directory: \.\/api/);
    assert.match(lar.content, /\.\/ \$USER@\$HOST:\/var\/www\/api\.com/);
    assert.ok(!/\.\/api\/api/.test(lar.content), 'Laravel: không được lồng ./api/api');

    const stat = gen({ projectType: STATIC, domain: 's.com', role: 'site', workingDir: './site' });
    assert.match(stat.content, /working-directory: \.\/site/);
    assert.match(stat.content, /\.\/ \$USER@\$HOST:\/var\/www\/s\.com/);
    assert.ok(!/\.\/site\/site/.test(stat.content), 'Static: không được lồng ./site/site');
});

test('Node single: health-check cổng + pm2 --update-env (chống hardcode cổng)', () => {
    const { content } = gen({
        projectType: NODE, domain: 'hc.com', role: 'Fullstack (Gốc)', workingDir: './',
        usePrisma: false, port: 3007, envSecretName: undefined, isWorkspace: false,
        packageManager: 'npm', startScript: 'start', hasBuild: false
    });
    assertWellFormed(content);
    assert.match(content, /pm2 restart app-hc\.com --update-env/);
    assert.match(content, /sport = :3007/);            // health-check kiểm tra app nghe đúng cổng
    assert.match(content, /App khong nghe cong 3007/); // thông báo lỗi rõ ràng khi nghi hardcode
});

test('Node monorepo workspace: cũng có health-check cổng + --update-env', () => {
    const { content } = gen({
        projectType: NODE, domain: 'wk.com', role: 'api', workingDir: './apps/api',
        usePrisma: false, port: 3008, envSecretName: undefined, isWorkspace: true,
        packageManager: 'npm', startScript: 'start', hasBuild: true
    });
    assert.match(content, /sport = :3008/);
    assert.match(content, /--update-env/);
});

test('rsync bảo toàn dữ liệu runtime: protect .env + uploads (B1/B2)', () => {
    const cases = [
        { projectType: STATIC, domain: 's.com', role: 'Fullstack (Gốc)', workingDir: './' },
        { projectType: PUREPHP, domain: 'p.com', role: 'Fullstack (Gốc)', workingDir: './', envSecretName: 'ENV_FILE', phpVersion: '8.1' },
        { projectType: NODE, domain: 'n.com', role: 'Fullstack (Gốc)', workingDir: './', usePrisma: false, port: 3001, isWorkspace: false, packageManager: 'npm', startScript: 'start', hasBuild: false }
    ];
    for (const t of cases) {
        const { content } = gen(t);
        assert.match(content, /--filter='P \.env'/, `${t.projectType}: phải protect .env`);
        assert.match(content, /--filter='P uploads'/, `${t.projectType}: phải protect uploads`);
    }
});

test('Laravel: KHÔNG xóa storage + tạo sẵn cấu trúc (tránh mất upload + reset APP_KEY)', () => {
    const { content } = gen({
        projectType: LARAVEL, domain: 'shop.com', role: 'Fullstack (Gốc)', workingDir: './',
        envSecretName: 'ENV_FILE', phpVersion: '8.2'
    });
    assert.match(content, /--filter='P storage'/);               // không xóa storage -> upload sống sót
    assert.match(content, /mkdir -p storage\/framework\/cache/);  // tạo cấu trúc trên server
    assert.match(content, /--filter='P \.env'/);                  // .env không bị xóa/reset
});

test('Node version build = runtime (22) và npm ci có fallback', () => {
    const { content } = gen({
        projectType: NODE, domain: 'v.com', role: 'Fullstack (Gốc)', workingDir: './',
        usePrisma: false, port: 3002, isWorkspace: false, packageManager: 'npm', startScript: 'start', hasBuild: true
    });
    assert.match(content, /node-version: '22'/);
    assert.ok(!content.includes("node-version: '26'"), 'không còn Node 26');
    assert.match(content, /npm ci \|\| npm install/);
});

test('Actions dùng @v4 (checkout/setup-node), không còn @v3 deprecated', () => {
    const node = gen({ projectType: NODE, domain: 'n.com', role: 'Fullstack (Gốc)', workingDir: './', usePrisma: false, port: 3001, isWorkspace: false, packageManager: 'npm', startScript: 'start', hasBuild: true });
    const spa = gen({ projectType: SPA, domain: 's.com', role: 'Fullstack (Gốc)', workingDir: './', buildDir: 'dist', isWorkspace: false, packageManager: 'npm' });
    const stat = gen({ projectType: STATIC, domain: 'st.com', role: 'Fullstack (Gốc)', workingDir: './' });
    const lar = gen({ projectType: LARAVEL, domain: 'l.com', role: 'Fullstack (Gốc)', workingDir: './', envSecretName: 'ENV_FILE', phpVersion: '8.2' });
    for (const { content } of [node, spa, stat, lar]) {
        assert.ok(!content.includes('@v3'), 'không còn action @v3 (deprecated)');
    }
    assert.match(node.content, /actions\/checkout@v4/);
    assert.match(node.content, /actions\/setup-node@v4/);
    assert.match(spa.content, /actions\/setup-node@v4/);
    assert.match(stat.content, /actions\/checkout@v4/);
});
