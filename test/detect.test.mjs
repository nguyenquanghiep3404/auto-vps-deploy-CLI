import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    TYPE,
    detectProjectType,
    detectBuildDir,
    detectStartScript,
    detectPrisma,
    detectPhpVersion,
    detectStructure,
    detectProject
} from '../src/utils/detect.js';

let root;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'detecttest-'));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function mkdir(dir) {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function write(dir, name, content = '') {
    fs.writeFileSync(path.join(dir, name), content);
}

function writePkg(dir, obj) {
    write(dir, 'package.json', JSON.stringify(obj));
}

// ---------------- detectProjectType ----------------

test('detectProjectType: Laravel (artisan + composer.json)', () => {
    write(root, 'artisan');
    write(root, 'composer.json', JSON.stringify({ require: { 'laravel/framework': '^11.0' } }));
    assert.equal(detectProjectType(root), TYPE.LARAVEL);
});

test('detectProjectType: Laravel qua composer khi thiếu artisan', () => {
    write(root, 'composer.json', JSON.stringify({ require: { 'laravel/framework': '^10.0' } }));
    assert.equal(detectProjectType(root), TYPE.LARAVEL);
});

test('detectProjectType: PHP thuần (composer không có laravel)', () => {
    write(root, 'composer.json', JSON.stringify({ require: { 'guzzlehttp/guzzle': '^7' } }));
    assert.equal(detectProjectType(root), TYPE.PHP);
});

test('detectProjectType: PHP thuần qua file .php khi không có composer', () => {
    write(root, 'index.php', '<?php echo 1;');
    assert.equal(detectProjectType(root), TYPE.PHP);
});

test('detectProjectType: Node server (express)', () => {
    writePkg(root, { dependencies: { express: '^4' } });
    assert.equal(detectProjectType(root), TYPE.NODE);
});

test('detectProjectType: Next.js -> Node (SSR chạy PM2)', () => {
    writePkg(root, { dependencies: { next: '^14', react: '^18' } });
    assert.equal(detectProjectType(root), TYPE.NODE);
});

test('detectProjectType: NestJS -> Node', () => {
    writePkg(root, { dependencies: { '@nestjs/core': '^10' } });
    assert.equal(detectProjectType(root), TYPE.NODE);
});

test('detectProjectType: SPA Vite/Vue', () => {
    writePkg(root, { devDependencies: { vite: '^5', vue: '^3' }, scripts: { build: 'vite build' } });
    assert.equal(detectProjectType(root), TYPE.SPA);
});

test('detectProjectType: SPA CRA (react-scripts)', () => {
    writePkg(root, { dependencies: { react: '^18', 'react-scripts': '5.0.1' } });
    assert.equal(detectProjectType(root), TYPE.SPA);
});

test('detectProjectType: package.json chỉ có build, không start -> SPA', () => {
    writePkg(root, { scripts: { build: 'some-bundler' } });
    assert.equal(detectProjectType(root), TYPE.SPA);
});

test('detectProjectType: package.json không rõ -> mặc định Node', () => {
    writePkg(root, { scripts: { start: 'node server.js' } });
    assert.equal(detectProjectType(root), TYPE.NODE);
});

test('detectProjectType: Static (chỉ index.html)', () => {
    write(root, 'index.html', '<html></html>');
    assert.equal(detectProjectType(root), TYPE.STATIC);
});

test('detectProjectType: null khi không có dấu hiệu nào', () => {
    assert.equal(detectProjectType(root), null);
});

test('detectProjectType: PHP ưu tiên hơn package.json (Laravel + node tooling)', () => {
    write(root, 'artisan');
    write(root, 'composer.json', JSON.stringify({ require: { 'laravel/framework': '^11' } }));
    writePkg(root, { devDependencies: { vite: '^5' } }); // Laravel hay kèm vite cho asset
    assert.equal(detectProjectType(root), TYPE.LARAVEL);
});

// ---------------- chi tiết phụ ----------------

test('detectBuildDir: đọc outDir từ vite.config', () => {
    write(root, 'vite.config.ts', 'export default { build: { outDir: "out" } }');
    assert.equal(detectBuildDir(root), 'out');
});

test('detectBuildDir: react-scripts -> build', () => {
    writePkg(root, { dependencies: { 'react-scripts': '5' } });
    assert.equal(detectBuildDir(root), 'build');
});

test('detectBuildDir: mặc định dist', () => {
    writePkg(root, { devDependencies: { vite: '^5' } });
    assert.equal(detectBuildDir(root), 'dist');
});

test('detectStartScript: start:prod khi có (NestJS)', () => {
    writePkg(root, { scripts: { 'start:prod': 'node dist/main', start: 'nest start' } });
    assert.equal(detectStartScript(root), 'start:prod');
});

test('detectStartScript: mặc định start', () => {
    writePkg(root, { scripts: { start: 'node x' } });
    assert.equal(detectStartScript(root), 'start');
});

test('detectPrisma: true khi có prisma/schema.prisma', () => {
    mkdir(path.join(root, 'prisma'));
    write(path.join(root, 'prisma'), 'schema.prisma', 'generator client {}');
    assert.equal(detectPrisma(root), true);
});

test('detectPrisma: true qua dependency @prisma/client', () => {
    writePkg(root, { dependencies: { '@prisma/client': '^5' } });
    assert.equal(detectPrisma(root), true);
});

test('detectPrisma: false khi không có', () => {
    writePkg(root, { dependencies: { express: '^4' } });
    assert.equal(detectPrisma(root), false);
});

test('detectPhpVersion: trích X.Y từ composer require.php', () => {
    write(root, 'composer.json', JSON.stringify({ require: { php: '>=8.2' } }));
    assert.equal(detectPhpVersion(root), '8.2');
});

test('detectPhpVersion: null khi không khai báo', () => {
    write(root, 'composer.json', JSON.stringify({ require: {} }));
    assert.equal(detectPhpVersion(root), null);
});

// ---------------- detectStructure ----------------

test('detectStructure: single khi chỉ có dự án ở gốc', () => {
    writePkg(root, { dependencies: { express: '^4' } });
    const s = detectStructure(root);
    assert.equal(s.isMonorepo, false);
    assert.deepEqual(s.parts, [{ name: 'app', workingDir: './' }]);
});

test('detectStructure: monorepo frontend + backend', () => {
    writePkg(mkdir(path.join(root, 'frontend')), { devDependencies: { vite: '^5' } });
    writePkg(mkdir(path.join(root, 'backend')), { dependencies: { express: '^4' } });
    const s = detectStructure(root);
    assert.equal(s.isMonorepo, true);
    const names = s.parts.map(p => p.name).sort();
    assert.deepEqual(names, ['backend', 'frontend']);
    const fe = s.parts.find(p => p.name === 'frontend');
    assert.equal(fe.workingDir, './frontend');
});

test('detectStructure: monorepo qua apps/*', () => {
    writePkg(mkdir(path.join(root, 'apps', 'web')), { devDependencies: { vite: '^5' } });
    writePkg(mkdir(path.join(root, 'apps', 'api')), { dependencies: { express: '^4' } });
    const s = detectStructure(root);
    assert.equal(s.isMonorepo, true);
    const dirs = s.parts.map(p => p.workingDir).sort();
    assert.deepEqual(dirs, ['./apps/api', './apps/web']);
});

test('detectStructure: 1 thư mục con không đủ -> single', () => {
    writePkg(root, { dependencies: { express: '^4' } });
    writePkg(mkdir(path.join(root, 'client')), { devDependencies: { vite: '^5' } });
    const s = detectStructure(root);
    assert.equal(s.isMonorepo, false);
});

// ---------------- detectProject (tổng hợp) ----------------

test('detectProject: monorepo điền đủ chi tiết từng phần', () => {
    const fe = mkdir(path.join(root, 'frontend'));
    writePkg(fe, { devDependencies: { vite: '^5', vue: '^3' }, scripts: { build: 'vite build' } });
    write(fe, 'vite.config.ts', 'export default { build: { outDir: "dist" } }');

    const be = mkdir(path.join(root, 'backend'));
    writePkg(be, { dependencies: { '@nestjs/core': '^10', '@prisma/client': '^5' }, scripts: { 'start:prod': 'node dist/main' } });

    const res = detectProject(root);
    assert.equal(res.isMonorepo, true);

    const front = res.parts.find(p => p.name === 'frontend');
    assert.equal(front.projectType, TYPE.SPA);
    assert.equal(front.buildDir, 'dist');

    const back = res.parts.find(p => p.name === 'backend');
    assert.equal(back.projectType, TYPE.NODE);
    assert.equal(back.startScript, 'start:prod');
    assert.equal(back.usePrisma, true);
});

test('detectProject: single Laravel kèm php version', () => {
    write(root, 'artisan');
    write(root, 'composer.json', JSON.stringify({ require: { 'laravel/framework': '^11', php: '^8.3' } }));
    const res = detectProject(root);
    assert.equal(res.isMonorepo, false);
    assert.equal(res.parts.length, 1);
    assert.equal(res.parts[0].projectType, TYPE.LARAVEL);
    assert.equal(res.parts[0].phpVersion, '8.3');
    assert.equal(res.parts[0].workingDir, './');
});
