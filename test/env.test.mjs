import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    readEnvFile,
    sanitizeSecretName,
    slugify,
    generatePassword,
    generateLaravelAppKey,
    buildPrismaDatabaseUrl,
    buildLaravelDbEnv,
    buildManagedDbEnvLines,
    parseDatabaseUrl,
    envHasKey,
    mergeEnvContent,
    stripAppPort
} from '../src/utils/env.js';

const NODE = 'Node.js (PM2 - Next.js, Express, NestJS...)';
const LARAVEL = 'PHP (Laravel)';

test('sanitizeSecretName: hợp lệ hoá tên secret', () => {
    assert.equal(sanitizeSecretName('part-1'), 'PART_1');
    assert.equal(sanitizeSecretName('front end'), 'FRONT_END');
    assert.equal(sanitizeSecretName('123abc'), 'X_123ABC');
    assert.equal(sanitizeSecretName('a__b'), 'A_B');
    assert.equal(sanitizeSecretName('  _weird_  '), 'WEIRD');
    assert.match(sanitizeSecretName(''), /^[A-Z_]/);
});

test('slugify: tên DB/user sạch', () => {
    assert.equal(slugify('My Cafe App!'), 'my_cafe_app');
    assert.equal(slugify(''), 'app');
    assert.equal(slugify('123'), 'a123');
    assert.equal(slugify('A--B'), 'a_b');
    assert.match(slugify('frontend'), /^[a-z_][a-z0-9_]*$/);
});

test('generatePassword: độ dài & ký tự an toàn', () => {
    const p = generatePassword();
    assert.equal(p.length, 24);
    assert.match(p, /^[A-Za-z0-9]+$/);
    assert.equal(generatePassword(32).length, 32);
    // hai lần sinh phải khác nhau (xác suất trùng ~0)
    assert.notEqual(generatePassword(), generatePassword());
});

test('generateLaravelAppKey: định dạng base64 32 byte', () => {
    const k = generateLaravelAppKey();
    assert.ok(k.startsWith('base64:'));
    const raw = Buffer.from(k.slice('base64:'.length), 'base64');
    assert.equal(raw.length, 32);
});

test('buildPrismaDatabaseUrl: đúng theo từng engine', () => {
    assert.equal(buildPrismaDatabaseUrl('mysql', 'u', 'p', 'd'), 'mysql://u:p@localhost:3306/d');
    assert.equal(buildPrismaDatabaseUrl('postgresql', 'u', 'p', 'd'), 'postgresql://u:p@localhost:5432/d?schema=public');
    assert.equal(buildPrismaDatabaseUrl('mongodb', 'u', 'p', 'd'), 'mongodb://localhost:27017/d');
    assert.equal(buildPrismaDatabaseUrl('unknown', 'u', 'p', 'd'), '');
});

test('buildLaravelDbEnv: đủ biến DB_* theo engine', () => {
    const mysql = buildLaravelDbEnv('mysql', 'u', 'p', 'd');
    assert.match(mysql, /DB_CONNECTION=mysql/);
    assert.match(mysql, /DB_PORT=3306/);
    assert.match(mysql, /DB_DATABASE=d/);
    assert.match(mysql, /DB_USERNAME=u/);
    assert.match(mysql, /DB_PASSWORD=p/);

    assert.match(buildLaravelDbEnv('postgresql', 'u', 'p', 'd'), /DB_CONNECTION=pgsql/);
    assert.match(buildLaravelDbEnv('postgresql', 'u', 'p', 'd'), /DB_PORT=5432/);
    assert.match(buildLaravelDbEnv('mongodb', 'u', 'p', 'd'), /DB_PORT=27017/);
});

test('envHasKey: chỉ true khi có giá trị khác rỗng cùng dòng', () => {
    assert.equal(envHasKey('APP_KEY=base64:xx\nFOO=bar', 'APP_KEY'), true);
    assert.equal(envHasKey('  APP_KEY = base64:xx', 'APP_KEY'), true);
    assert.equal(envHasKey('APP_KEY=\nFOO=bar', 'APP_KEY'), false);
    assert.equal(envHasKey('FOO=1\nAPP_KEY=', 'APP_KEY'), false);
    assert.equal(envHasKey('APP_KEY=   \nX=1', 'APP_KEY'), false);
    assert.equal(envHasKey('FOO=bar', 'APP_KEY'), false);
    assert.equal(envHasKey('', 'APP_KEY'), false);
    assert.equal(envHasKey(null, 'APP_KEY'), false);
});

test('mergeEnvContent: gộp .env người dùng + dòng sinh thêm', () => {
    const merged = mergeEnvContent('FOO=1\nBAR=2', ['DATABASE_URL="x"', 'APP_KEY=base64:y']);
    assert.match(merged, /FOO=1/);
    assert.match(merged, /DATABASE_URL="x"/);
    assert.match(merged, /APP_KEY=base64:y/);
    assert.match(merged, /deploy-vps/); // có chú thích khối

    assert.equal(mergeEnvContent('FOO=1', []), 'FOO=1\n');
    assert.equal(mergeEnvContent('', []), '');
    assert.match(mergeEnvContent('', ['A=1']), /A=1/);
    // bỏ qua phần tử rỗng
    assert.ok(!mergeEnvContent('X=1', ['', null]).includes('deploy-vps'));
});

test('readEnvFile: đọc file tồn tại, trả null khi thiếu/không phải file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envtest-'));
    const f = path.join(dir, '.env');
    fs.writeFileSync(f, 'A=1\nB=2\n');
    assert.equal(readEnvFile(f), 'A=1\nB=2\n');
    assert.equal(readEnvFile(path.join(dir, 'nope.env')), null);
    assert.equal(readEnvFile(dir), null); // là thư mục
    assert.equal(readEnvFile(''), null);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('parseDatabaseUrl: tách connection string Supabase/Postgres', () => {
    const p = parseDatabaseUrl('postgresql://postgres.abcd:secretPass@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres');
    assert.equal(p.scheme, 'postgresql');
    assert.equal(p.user, 'postgres.abcd');
    assert.equal(p.pass, 'secretPass');
    assert.equal(p.host, 'aws-0-ap-southeast-1.pooler.supabase.com');
    assert.equal(p.port, '6543');
    assert.equal(p.dbName, 'postgres');
    // mật khẩu có ký tự đặc biệt đã URL-encode -> được decode lại đúng
    assert.equal(parseDatabaseUrl('postgres://u:p%40ss%2F1@h:5432/db').pass, 'p@ss/1');
    // chuỗi không hợp lệ -> null
    assert.equal(parseDatabaseUrl('không-phải-url'), null);
    assert.equal(parseDatabaseUrl(''), null);
});

test('buildManagedDbEnvLines: Node chỉ cần DATABASE_URL (giữ nguyên chuỗi)', () => {
    const url = 'postgresql://postgres:p@ss@db.xyz.supabase.co:5432/postgres';
    const out = buildManagedDbEnvLines(NODE, url);
    assert.equal(out, `DATABASE_URL="${url}"`);
    // không có chuỗi -> rỗng
    assert.equal(buildManagedDbEnvLines(NODE, '   '), '');
});

test('buildManagedDbEnvLines: Laravel tách DB_* + giữ thêm DATABASE_URL', () => {
    const url = 'postgresql://supauser:supapass@db.xyz.supabase.co:5432/postgres';
    const out = buildManagedDbEnvLines(LARAVEL, url);
    assert.match(out, /DB_CONNECTION=pgsql/);
    assert.match(out, /DB_HOST=db\.xyz\.supabase\.co/);
    assert.match(out, /DB_PORT=5432/);
    assert.match(out, /DB_DATABASE=postgres/);
    assert.match(out, /DB_USERNAME=supauser/);
    assert.match(out, /DB_PASSWORD=supapass/);
    assert.match(out, /DATABASE_URL="postgresql:\/\/supauser/);
});

test('stripAppPort: loại PORT của app nhưng GIỮ DB_PORT và biến khác', () => {
    const input = 'PORT=3000\nDB_PORT=5432\nNODE_ENV=production\n  PORT = 8080\nSUPPORT=yes\nEXPORT=1';
    const out = stripAppPort(input);
    // các dòng PORT=... (kể cả có khoảng trắng) bị loại
    assert.ok(!/^[ \t]*PORT[ \t]*=/m.test(out), 'không còn dòng PORT=');
    // không đụng tới DB_PORT / SUPPORT / EXPORT / biến khác
    assert.match(out, /DB_PORT=5432/);
    assert.match(out, /NODE_ENV=production/);
    assert.match(out, /SUPPORT=yes/);
    assert.match(out, /EXPORT=1/);
    // an toàn với null/rỗng
    assert.equal(stripAppPort(null), null);
    assert.equal(stripAppPort(''), '');
});
