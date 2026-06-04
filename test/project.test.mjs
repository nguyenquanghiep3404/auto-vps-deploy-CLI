import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { detectPackageManager, detectWorkspace, hasBuildScript, findHardcodedPorts, scanHardcodedPorts, findLocalhostUrls, scanLocalhostUrls } from '../src/utils/project.js';

let root;
let sub;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'projtest-'));
    sub = path.join(root, 'apps', 'web');
    fs.mkdirSync(sub, { recursive: true });
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function touch(dir, name, content = '') {
    fs.writeFileSync(path.join(dir, name), content);
}

test('detectPackageManager: lockfile trong thư mục con được ưu tiên', () => {
    touch(sub, 'pnpm-lock.yaml');
    touch(root, 'package-lock.json');
    const det = detectPackageManager(sub, root);
    assert.equal(det.pm, 'pnpm');
    assert.equal(det.atRoot, false);
});

test('detectPackageManager: từng loại lockfile', () => {
    touch(sub, 'package-lock.json');
    assert.equal(detectPackageManager(sub, root).pm, 'npm');

    fs.rmSync(path.join(sub, 'package-lock.json'));
    touch(sub, 'yarn.lock');
    assert.equal(detectPackageManager(sub, root).pm, 'yarn');
});

test('detectPackageManager: rơi xuống thư mục gốc khi con không có lockfile', () => {
    touch(root, 'pnpm-lock.yaml');
    const det = detectPackageManager(sub, root);
    assert.equal(det.pm, 'pnpm');
    assert.equal(det.atRoot, true);
});

test('detectPackageManager: mặc định npm khi không có gì', () => {
    const det = detectPackageManager(sub, root);
    assert.equal(det.pm, 'npm');
});

test('detectWorkspace: true khi lockfile chỉ ở gốc', () => {
    touch(root, 'pnpm-lock.yaml');
    assert.equal(detectWorkspace(sub, root), true);
});

test('detectWorkspace: false khi con có lockfile riêng', () => {
    touch(sub, 'package-lock.json');
    touch(root, 'package-lock.json');
    assert.equal(detectWorkspace(sub, root), false);
});

test('detectWorkspace: nhận diện pnpm-workspace.yaml / turbo.json / package.json workspaces', () => {
    touch(root, 'pnpm-workspace.yaml');
    assert.equal(detectWorkspace(sub, root), true);

    fs.rmSync(path.join(root, 'pnpm-workspace.yaml'));
    touch(root, 'turbo.json', '{}');
    assert.equal(detectWorkspace(sub, root), true);

    fs.rmSync(path.join(root, 'turbo.json'));
    touch(root, 'package.json', JSON.stringify({ workspaces: ['apps/*'] }));
    assert.equal(detectWorkspace(sub, root), true);
});

test('detectWorkspace: false khi workingDir trùng gốc, hoặc gốc trống', () => {
    assert.equal(detectWorkspace(root, root), false);
    assert.equal(detectWorkspace(sub, root), false);
});

test('hasBuildScript: true chỉ khi có scripts.build', () => {
    touch(sub, 'package.json', JSON.stringify({ scripts: { build: 'vite build' } }));
    assert.equal(hasBuildScript(sub), true);

    fs.writeFileSync(path.join(sub, 'package.json'), JSON.stringify({ scripts: { start: 'node x' } }));
    assert.equal(hasBuildScript(sub), false);

    fs.writeFileSync(path.join(sub, 'package.json'), '{ invalid json');
    assert.equal(hasBuildScript(sub), false);

    assert.equal(hasBuildScript(path.join(root, 'nope')), false);
});

test('findHardcodedPorts: bắt .listen(số), bỏ qua process.env.PORT', () => {
    assert.deepEqual(findHardcodedPorts('app.listen(3000)'), [3000]);
    assert.deepEqual(findHardcodedPorts('server.listen( 8080 )'), [8080]);
    assert.deepEqual(findHardcodedPorts('app.listen(process.env.PORT || 3000)'), []); // không phải literal đầu tiên
    assert.deepEqual(findHardcodedPorts('app.listen(PORT)'), []); // biến, không cảnh báo
    assert.deepEqual(findHardcodedPorts('a.listen(3000)\nb.listen(4000)'), [3000, 4000]);
    assert.deepEqual(findHardcodedPorts(''), []);
    assert.deepEqual(findHardcodedPorts(null), []);
});

test('scanHardcodedPorts: quét file entry phổ biến trong thư mục', () => {
    touch(root, 'server.js', 'const x=1;\napp.listen(3000);\n');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    touch(path.join(root, 'src'), 'main.ts', 'await app.listen(process.env.PORT ?? 3000)'); // an toàn -> không báo
    const hits = scanHardcodedPorts(root);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].file, 'server.js');
    assert.equal(hits[0].port, 3000);
    // thư mục không có entry -> rỗng
    assert.deepEqual(scanHardcodedPorts(path.join(root, 'apps', 'web')), []);
});

test('findLocalhostUrls: bắt URL localhost/127.0.0.1, bỏ qua URL thật', () => {
    assert.deepEqual(findLocalhostUrls('const API="http://localhost:5000/api"'), ['http://localhost:5000']);
    assert.deepEqual(findLocalhostUrls('fetch("https://127.0.0.1:8080/x")'), ['https://127.0.0.1:8080']);
    assert.deepEqual(findLocalhostUrls('axios.get("https://api.example.com")'), []);
    assert.deepEqual(findLocalhostUrls('a http://localhost b http://127.0.0.1:3000'), ['http://localhost', 'http://127.0.0.1:3000']);
    assert.deepEqual(findLocalhostUrls(''), []);
    assert.deepEqual(findLocalhostUrls(null), []);
});

test('scanLocalhostUrls: quét file entry tìm URL localhost', () => {
    touch(root, 'app.js', 'const base = "http://localhost:5000";\n');
    const hits = scanLocalhostUrls(root);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].file, 'app.js');
    assert.equal(hits[0].url, 'http://localhost:5000');
});
