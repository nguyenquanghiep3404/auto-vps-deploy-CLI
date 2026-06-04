#!/usr/bin/env node

import inquirer from 'inquirer';
import chalk from 'chalk';
import { generateSSHKeys, installPublicKeyToVPS, scanUsedPorts, findAvailablePorts } from '../src/utils/ssh.js';
import { checkGithubAuth, loginGithub, setGithubSecret, installGithubCli } from '../src/github/secrets.js';
import { setupWebserverOnVPS, setupDatabaseOnVPS } from '../src/vps/setup.js';
import { generateWorkflowFile } from '../src/templates/workflows.js';
import {
    readEnvFile,
    sanitizeSecretName,
    slugify,
    generatePassword,
    generateLaravelAppKey,
    buildPrismaDatabaseUrl,
    buildLaravelDbEnv,
    envHasKey,
    mergeEnvContent
} from '../src/utils/env.js';
import { execaCommand } from 'execa';

/**
 * Hỏi thêm các cấu hình nâng cao cho một "phần" của dự án:
 * - Phiên bản PHP (với dự án PHP)
 * - npm workspaces (với Monorepo Node/SPA)
 * - Database (với Node/Laravel/PHP thuần)
 * - File .env local cần nạp (với mọi loại trừ Static)
 */
async function collectExtras({ projectType, defaultEnvPath, isMonorepo, partName }) {
    const extras = {
        phpVersion: null,
        database: null,
        envFilePath: null,
        envFileContent: null,
        isWorkspace: false
    };

    const isNode = projectType.includes('Node.js');
    const isLaravel = projectType === 'PHP (Laravel)';
    const isPurePhp = projectType === 'PHP (Thuần)';
    const isPhp = projectType.includes('PHP');
    const isSpa = projectType === 'React/Vite/Vue (SPA)';
    const isStatic = projectType === 'Static (HTML thuần)';

    // ---- Phiên bản PHP ----
    if (isPhp) {
        const { phpVersion } = await inquirer.prompt([{
            type: 'input',
            name: 'phpVersion',
            message: 'Phiên bản PHP cần cài/dùng trên VPS (vd: 8.1, 8.2, 8.3):',
            default: '8.3',
            validate: input => /^\d+\.\d+$/.test(input.trim()) ? true : 'Định dạng phải dạng X.Y, ví dụ 8.3'
        }]);
        extras.phpVersion = phpVersion.trim();
    }

    // ---- npm workspaces (chỉ với Monorepo Node/SPA) ----
    if (isMonorepo && (isNode || isSpa)) {
        const { isWorkspace } = await inquirer.prompt([{
            type: 'confirm',
            name: 'isWorkspace',
            message: 'Dự án này dùng npm workspaces? (package-lock.json chỉ nằm ở thư mục gốc repo, package con không có lockfile riêng)',
            default: false
        }]);
        extras.isWorkspace = isWorkspace;
    }

    // ---- Database (Node / Laravel / PHP thuần) ----
    if (isNode || isLaravel || isPurePhp) {
        const { needsDb } = await inquirer.prompt([{
            type: 'confirm',
            name: 'needsDb',
            message: 'Phần này có cần Database không? (Tool sẽ tự cài DB server, tạo database + user và nạp biến kết nối vào .env)',
            default: false
        }]);
        if (needsDb) {
            const baseSlug = slugify(partName);
            const dbAnswers = await inquirer.prompt([
                {
                    type: 'rawlist',
                    name: 'engine',
                    message: 'Chọn loại Database:',
                    choices: ['MySQL', 'PostgreSQL', 'MongoDB']
                },
                {
                    type: 'input',
                    name: 'dbName',
                    message: 'Tên Database:',
                    default: `${baseSlug}_db`,
                    validate: input => /^[A-Za-z_][A-Za-z0-9_]*$/.test(input.trim()) ? true : 'Chỉ dùng chữ cái, số, gạch dưới; không bắt đầu bằng số.'
                },
                {
                    type: 'input',
                    name: 'dbUser',
                    message: 'Tên user của Database:',
                    default: `${baseSlug}_user`,
                    validate: input => /^[A-Za-z_][A-Za-z0-9_]*$/.test(input.trim()) ? true : 'Chỉ dùng chữ cái, số, gạch dưới; không bắt đầu bằng số.'
                }
            ]);
            const engineMap = { 'MySQL': 'mysql', 'PostgreSQL': 'postgresql', 'MongoDB': 'mongodb' };
            extras.database = {
                engine: engineMap[dbAnswers.engine],
                dbName: dbAnswers.dbName.trim(),
                dbUser: dbAnswers.dbUser.trim()
            };
        }
    }

    // ---- File .env local (mọi loại trừ Static) ----
    if (!isStatic) {
        const { envFilePath } = await inquirer.prompt([{
            type: 'input',
            name: 'envFilePath',
            message: isSpa
                ? 'Đường dẫn file .env chứa biến build-time (VITE_*/REACT_APP_*) để nạp lúc build (Enter để bỏ qua):'
                : 'Đường dẫn file .env local để nạp lên VPS (Enter để bỏ qua):',
            default: defaultEnvPath || ''
        }]);
        const trimmed = (envFilePath || '').trim();
        if (trimmed) {
            const content = readEnvFile(trimmed);
            if (content === null) {
                console.log(chalk.yellow(`   ⚠️  Không tìm/đọc được file .env tại "${trimmed}". Sẽ bỏ qua việc nạp .env (vẫn nạp biến DB nếu có).`));
            } else {
                extras.envFileContent = content;
                extras.envFilePath = trimmed;
                console.log(chalk.green(`   ✅ Đã đọc file .env (${content.split('\n').length} dòng).`));
            }
        }
    }

    return extras;
}

async function main() {
    console.log(chalk.green.bold('🚀 Chào mừng đến với Auto VPS Deploy CLI'));
    console.log(chalk.gray('Công cụ này sẽ tự động hóa việc cấu hình VPS, thiết lập SSL, và tạo Github Actions Workflow cho bạn.\n'));

    // ========================================
    // 1. Kiểm tra Github CLI
    // ========================================
    let isGhLoggedIn = false;
    try {
        isGhLoggedIn = await checkGithubAuth();
    } catch (error) {
        if (error.message === 'NOT_INSTALLED') {
            console.log(chalk.red('\n❌ Lỗi: Máy tính của bạn chưa cài đặt Github CLI (gh).'));

            const { autoInstall } = await inquirer.prompt([{
                type: 'confirm',
                name: 'autoInstall',
                message: 'Bạn có muốn công cụ tự động cài đặt Github CLI bằng winget ngay bây giờ không?',
                default: true
            }]);

            if (autoInstall) {
                const success = await installGithubCli();
                if (success) {
                    console.log(chalk.green('\n✅ Cài đặt thành công!'));
                    console.log(chalk.yellow('⚠️  Tuy nhiên, để máy tính nhận diện được lệnh "gh", bạn BẮT BUỘC phải khởi động lại Terminal.'));
                    console.log(chalk.cyan('Vui lòng tắt cửa sổ PowerShell này đi, mở lại và chạy lại lệnh deploy-vps.'));
                    process.exit(0);
                } else {
                    console.log(chalk.red('\n❌ Cài đặt tự động thất bại.'));
                    console.log(chalk.yellow('Vui lòng cài đặt thủ công tại: https://cli.github.com/ hoặc chạy lệnh: winget install --id GitHub.cli'));
                    process.exit(1);
                }
            } else {
                console.log(chalk.yellow('\nVui lòng cài đặt thủ công tại: https://cli.github.com/ hoặc chạy lệnh: winget install --id GitHub.cli'));
                process.exit(1);
            }
        }
    }

    if (!isGhLoggedIn) {
        console.log(chalk.yellow('⚠️  Bạn chưa đăng nhập Github CLI.'));
        const { proceed } = await inquirer.prompt([{
            type: 'confirm',
            name: 'proceed',
            message: 'Bạn có muốn mở trình duyệt để đăng nhập Github ngay bây giờ không?',
            default: true
        }]);
        if (proceed) {
            await loginGithub();
        } else {
            console.log(chalk.red('❌ Cần đăng nhập Github CLI để tiếp tục. Hãy chạy `gh auth login` sau đó thử lại.'));
            process.exit(1);
        }
    } else {
        console.log(chalk.green('✅ Github CLI đã được xác thực.'));
    }

    // ========================================
    // 1.5 Kiểm tra Git Repository
    // ========================================
    try {
        const { stdout } = await execaCommand('git remote -v');
        if (!stdout.includes('origin')) throw new Error('No origin');
    } catch (error) {
        console.log(chalk.yellow('\n⚠️  Có vẻ dự án của bạn chưa được kết nối với kho Github (chưa có git remote origin).'));
        const { gitRepoUrl } = await inquirer.prompt([{
            type: 'input',
            name: 'gitRepoUrl',
            message: 'Vui lòng nhập link Github Repository của bạn (Ví dụ: https://github.com/abc/xyz.git):',
            validate: input => input ? true : 'Không được để trống'
        }]);

        console.log(chalk.blue('Đang khởi tạo Git và kết nối tới Repository...'));
        try {
            await execaCommand('git init');
            // Xóa origin cũ nếu có lỗi
            try { await execaCommand('git remote remove origin'); } catch(e) {}
            await execaCommand(`git remote add origin ${gitRepoUrl}`);
            console.log(chalk.green('✅ Kết nối Git thành công!'));
        } catch (e) {
            console.log(chalk.red('❌ Lỗi khi khởi tạo Git. Vui lòng kiểm tra lại.'));
            console.error(e.message);
        }
    }

    // ========================================
    // 2. Thu thập thông tin VPS (chung cho mọi cấu trúc)
    // ========================================
    const vpsInfo = await inquirer.prompt([
        {
            type: 'input',
            name: 'vpsHost',
            message: 'Nhập địa chỉ IP của VPS:',
            validate: input => input ? true : 'Không được để trống'
        },
        {
            type: 'input',
            name: 'vpsUser',
            message: 'Nhập Username của VPS:',
            default: 'root'
        },
        {
            type: 'password',
            name: 'vpsPassword',
            message: 'Nhập Mật khẩu của VPS (Chỉ dùng 1 lần để setup ban đầu, không lưu lại):',
            mask: '*'
        }
    ]);

    const { vpsHost, vpsUser, vpsPassword } = vpsInfo;

    // ========================================
    // 3. Hỏi cấu trúc dự án: Single hay Monorepo
    // ========================================
    const { projectStructure } = await inquirer.prompt([{
        type: 'rawlist',
        name: 'projectStructure',
        message: 'Cấu trúc dự án của bạn là gì?',
        choices: [
            'Single (Dự án đơn - 1 loại dự án duy nhất)',
            'Monorepo (Nhiều phần trong 1 repo - VD: frontend + backend)'
        ]
    }]);

    const isMonorepo = projectStructure.includes('Monorepo');

    // ========================================
    // 3.5 Quét port đang dùng trên VPS (cho dự án Node.js)
    // ========================================
    console.log(chalk.gray('🔍 Đang quét các cổng (port) đã sử dụng trên VPS...'));
    const usedPortsOnVPS = await scanUsedPorts(vpsHost, vpsUser, vpsPassword);
    // Mảng theo dõi tất cả port đã gán trong phiên này
    const allUsedPorts = [...usedPortsOnVPS];
    if (usedPortsOnVPS.length > 0) {
        console.log(chalk.gray(`   Các cổng đã bị chiếm trên VPS: ${usedPortsOnVPS.join(', ')}`));
    } else {
        console.log(chalk.gray('   Không có cổng nào trong dãy 3000-3999 đang bị chiếm.'));
    }

    // ========================================
    // 4. Thu thập cấu hình cho từng phần
    // ========================================
    const parts = []; // Mảng chứa cấu hình của từng phần

    if (!isMonorepo) {
        // ---- LUỒNG SINGLE: Giữ nguyên logic cũ ----
        const singleAnswers = await inquirer.prompt([
            {
                type: 'input',
                name: 'domain',
                message: 'Nhập Tên Miền (Domain) của dự án:',
                validate: input => input ? true : 'Không được để trống'
            },
            {
                type: 'rawlist',
                name: 'projectType',
                message: 'Chọn loại dự án của bạn:',
                choices: [
                    'Node.js (PM2 - Next.js, Express, NestJS...)',
                    'PHP (Laravel)',
                    'PHP (Thuần)',
                    'React/Vite/Vue (SPA)',
                    'Static (HTML thuần)'
                ]
            },
            {
                type: 'input',
                name: 'buildDir',
                message: 'Thư mục output sau khi build của dự án tên là gì? (Ví dụ: dist, build)',
                default: 'dist',
                when: (a) => a.projectType === 'React/Vite/Vue (SPA)'
            },
            {
                type: 'confirm',
                name: 'usePrisma',
                message: 'Bạn có sử dụng Prisma ORM để quản lý Database không?',
                default: false,
                when: (a) => a.projectType.includes('Node.js')
            }
        ]);

        // Tự động gán port cho dự án Node.js
        let autoPort = undefined;
        if (singleAnswers.projectType.includes('Node.js')) {
            const [port] = findAvailablePorts(allUsedPorts, 1);
            autoPort = port;
            allUsedPorts.push(port);
            console.log(chalk.green(`✅ Đã tự động gán cổng: ${port}`));
        }

        // Các cấu hình nâng cao: .env, database, php version
        const extras = await collectExtras({
            projectType: singleAnswers.projectType,
            defaultEnvPath: '.env',
            isMonorepo: false,
            partName: 'app'
        });

        parts.push({
            name: 'Fullstack (Gốc)',
            domain: singleAnswers.domain,
            projectType: singleAnswers.projectType,
            port: autoPort,
            workingDir: './',
            buildDir: singleAnswers.buildDir,
            usePrisma: singleAnswers.usePrisma,
            phpVersion: extras.phpVersion,
            database: extras.database,
            envFileContent: extras.envFileContent,
            isWorkspace: extras.isWorkspace
        });

    } else {
        // ---- LUỒNG MONOREPO: Hỏi từng phần ----
        const { partCount } = await inquirer.prompt([{
            type: 'input',
            name: 'partCount',
            message: 'Dự án Monorepo của bạn có bao nhiêu phần? (Ví dụ: 2 cho frontend + backend)',
            default: '2',
            validate: input => {
                const num = parseInt(input);
                if (isNaN(num) || num < 2 || num > 10) return 'Vui lòng nhập số từ 2 đến 10';
                return true;
            }
        }]);

        const count = parseInt(partCount);

        for (let i = 1; i <= count; i++) {
            console.log(chalk.cyan.bold(`\n📦 ──── Cấu hình cho PHẦN ${i}/${count} ────`));

            const partAnswers = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'partName',
                    message: `Tên của phần ${i} là gì? (Dùng để đặt tên file workflow, VD: frontend, backend, admin)`,
                    default: i === 1 ? 'frontend' : (i === 2 ? 'backend' : `part-${i}`),
                    validate: input => input ? true : 'Không được để trống'
                },
                {
                    type: 'input',
                    name: 'domain',
                    message: `Tên miền (Domain) cho phần này:`,
                    validate: input => input ? true : 'Không được để trống'
                },
                {
                    type: 'rawlist',
                    name: 'projectType',
                    message: `Loại dự án cho phần này:`,
                    choices: [
                        'Node.js (PM2 - Next.js, Express, NestJS...)',
                        'PHP (Laravel)',
                        'PHP (Thuần)',
                        'React/Vite/Vue (SPA)',
                        'Static (HTML thuần)'
                    ]
                },
                {
                    type: 'input',
                    name: 'buildDir',
                    message: 'Thư mục output sau khi build tên là gì? (Ví dụ: dist, build)',
                    default: 'dist',
                    when: (a) => a.projectType === 'React/Vite/Vue (SPA)'
                },
                {
                    type: 'confirm',
                    name: 'usePrisma',
                    message: 'Phần này có sử dụng Prisma ORM không?',
                    default: false,
                    when: (a) => a.projectType.includes('Node.js')
                },
                {
                    type: 'input',
                    name: 'workingDir',
                    message: `Thư mục mã nguồn của phần này nằm ở đâu trong Repository?`,
                    default: i === 1 ? './frontend' : (i === 2 ? './backend' : `./part-${i}`),
                    validate: input => input ? true : 'Không được để trống'
                }
            ]);

            // Tự động gán port cho dự án Node.js
            let autoPort = undefined;
            if (partAnswers.projectType.includes('Node.js')) {
                const [port] = findAvailablePorts(allUsedPorts, 1);
                autoPort = port;
                allUsedPorts.push(port);
                console.log(chalk.green(`   ✅ Đã tự động gán cổng cho ${partAnswers.partName}: ${port}`));
            }

            // Đường dẫn .env mặc định dựa theo thư mục mã nguồn của phần
            const cleanDir = partAnswers.workingDir.replace(/^\.\//, '').replace(/\/+$/, '');
            const defaultEnvPath = cleanDir ? `${cleanDir}/.env` : '.env';

            const extras = await collectExtras({
                projectType: partAnswers.projectType,
                defaultEnvPath,
                isMonorepo: true,
                partName: partAnswers.partName
            });

            parts.push({
                name: partAnswers.partName,
                domain: partAnswers.domain,
                projectType: partAnswers.projectType,
                port: autoPort,
                workingDir: partAnswers.workingDir,
                buildDir: partAnswers.buildDir,
                usePrisma: partAnswers.usePrisma,
                phpVersion: extras.phpVersion,
                database: extras.database,
                envFileContent: extras.envFileContent,
                isWorkspace: extras.isWorkspace
            });
        }

        // Hiển thị bảng tóm tắt
        console.log(chalk.cyan.bold('\n📋 Tóm tắt cấu hình Monorepo:'));
        console.log(chalk.gray('─'.repeat(60)));
        parts.forEach((p, idx) => {
            const portInfo = p.port ? ` | Cổng: ${p.port}` : '';
            const dbInfo = p.database ? ` | DB: ${p.database.engine}` : '';
            const wsInfo = p.isWorkspace ? ' | workspaces' : '';
            console.log(chalk.white(`  ${idx + 1}. ${chalk.bold(p.name)}: ${p.domain} | ${p.projectType}${portInfo}${dbInfo}${wsInfo} | Thư mục: ${p.workingDir}`));
        });
        console.log(chalk.gray('─'.repeat(60)));
    }

    // ========================================
    // 5. BẮT ĐẦU QUÁ TRÌNH TỰ ĐỘNG HÓA
    // ========================================
    try {
        console.log(chalk.cyan('\n⚙️  Bắt đầu quá trình tự động hóa...'));

        // ---- Bước 1: Cấu hình Nginx + SSL (+ PHP-FPM) cho TẤT CẢ các phần ----
        console.log(chalk.blue('▶️  Bước 1: Cấu hình Nginx và SSL trên VPS...'));
        for (const part of parts) {
            console.log(chalk.gray(`   → Đang cấu hình cho ${part.name} (${part.domain})...`));
            await setupWebserverOnVPS({
                host: vpsHost,
                username: vpsUser,
                password: vpsPassword,
                domain: part.domain,
                projectType: part.projectType,
                port: part.port,
                phpVersion: part.phpVersion
            });
        }
        console.log(chalk.green('✅ Xong Bước 1.'));

        // ---- Bước 1.5: Cài đặt Database server + tạo database/user cho các phần cần DB ----
        const partsWithDb = parts.filter(p => p.database);
        if (partsWithDb.length > 0) {
            console.log(chalk.blue('\n▶️  Bước 1.5: Cài đặt Database server và khởi tạo database...'));
            for (const part of partsWithDb) {
                const { engine, dbName, dbUser } = part.database;
                const dbPassword = generatePassword();
                console.log(chalk.gray(`   → ${part.name}: cài ${engine}, tạo database "${dbName}" + user "${dbUser}"...`));
                await setupDatabaseOnVPS(vpsHost, vpsUser, vpsPassword, { engine, dbName, dbUser, dbPassword });
                part.dbPassword = dbPassword;
            }
            console.log(chalk.green('✅ Xong Bước 1.5.'));
        }

        // ---- Bước 2: Sinh SSH Key (1 lần duy nhất) ----
        console.log(chalk.blue('\n▶️  Bước 2: Thiết lập kết nối bảo mật (SSH Keys) cho Github Actions...'));
        const { publicKey, privateKey } = generateSSHKeys();
        await installPublicKeyToVPS(vpsHost, vpsUser, vpsPassword, publicKey);
        console.log(chalk.green('✅ Xong Bước 2.'));

        // ---- Bước 3: Lưu Github Secrets ----
        console.log(chalk.blue('\n▶️  Bước 3: Lưu các biến bảo mật lên Github Repository Secrets...'));
        await setGithubSecret('VPS_HOST', vpsHost);
        await setGithubSecret('VPS_USERNAME', vpsUser);
        await setGithubSecret('VPS_SSH_KEY', privateKey);

        // Tạo secret .env cho từng phần (gộp .env người dùng + biến DB sinh tự động + APP_KEY của Laravel)
        for (const part of parts) {
            const generatedLines = [];

            if (part.database && part.dbPassword) {
                const { engine, dbName, dbUser } = part.database;
                if (part.projectType.includes('Node.js')) {
                    generatedLines.push(`DATABASE_URL="${buildPrismaDatabaseUrl(engine, dbUser, part.dbPassword, dbName)}"`);
                } else {
                    // Laravel / PHP thuần dùng các biến DB_*
                    generatedLines.push(buildLaravelDbEnv(engine, dbUser, part.dbPassword, dbName));
                }
            }

            // Laravel: đảm bảo có APP_KEY (tương đương php artisan key:generate).
            // Chỉ tự sinh khi đã có .env người dùng hoặc có DB (tức là sẽ tạo secret .env).
            // Nếu không, để workflow tự `cp .env.example` + `key:generate` trên VPS.
            if (part.projectType === 'PHP (Laravel)'
                && (part.envFileContent || part.database)
                && !envHasKey(part.envFileContent, 'APP_KEY')) {
                generatedLines.push(`APP_KEY=${generateLaravelAppKey()}`);
            }

            const envContent = mergeEnvContent(part.envFileContent, generatedLines);
            if (envContent.trim()) {
                const secretName = isMonorepo ? `ENV_FILE_${sanitizeSecretName(part.name)}` : 'ENV_FILE';
                await setGithubSecret(secretName, envContent);
                part.envSecretName = secretName;
                console.log(chalk.gray(`   → Đã lưu secret ${secretName} cho ${part.name}.`));
            }
        }
        console.log(chalk.green('✅ Xong Bước 3.'));

        // ---- Bước 4: Tạo Workflow file cho từng phần ----
        console.log(chalk.blue('\n▶️  Bước 4: Tạo Github Actions Workflow...'));
        for (const part of parts) {
            generateWorkflowFile({
                projectType: part.projectType,
                domain: part.domain,
                role: part.name,
                workingDir: part.workingDir,
                buildDir: part.buildDir,
                usePrisma: part.usePrisma,
                port: part.port,
                envSecretName: part.envSecretName,
                isWorkspace: part.isWorkspace,
                phpVersion: part.phpVersion
            });
        }
        console.log(chalk.green('✅ Xong Bước 4.'));

        // ---- Bước 5: Auto push code ----
        console.log(chalk.blue('\n▶️  Bước 5: Tự động đẩy code lên Github...'));
        try {
            await execaCommand('git add .');
            await execaCommand('git commit -m "Auto config VPS Deploy Actions"');
            await execaCommand('git branch -M main');
            await execaCommand('git push -u origin main');
            console.log(chalk.green('✅ Đã tự động đẩy code lên Github thành công! Hãy mở tab Actions để xem tiến trình deploy nhé!'));
        } catch (e) {
            console.log(chalk.yellow('⚠️  Không thể tự động đẩy code lên Github. Có thể do code chưa có thay đổi nào mới hoặc lỗi mạng.'));
            console.log(chalk.yellow('Vui lòng tự gõ lệnh git push bằng tay sau khi quá trình này kết thúc.'));
        }

        console.log(chalk.green.bold('\n🎉 HOÀN TẤT TOÀN BỘ QUÁ TRÌNH! 🎉'));
        if (isMonorepo) {
            console.log(chalk.cyan(`📁 Đã tạo ${parts.length} file workflow riêng biệt cho từng phần của Monorepo.`));
        }

        // ---- In thông tin Database (nếu có) để bạn lưu lại ----
        if (partsWithDb.length > 0) {
            console.log(chalk.yellow.bold('\n🔐 THÔNG TIN DATABASE (hãy lưu lại ở nơi an toàn!):'));
            console.log(chalk.gray('Chuỗi kết nối đã được lưu vào Github Secret và sẽ tự nạp vào .env khi deploy.'));
            for (const part of partsWithDb) {
                const { engine, dbName, dbUser } = part.database;
                console.log(chalk.white(`  • ${chalk.bold(part.name)} [${engine}] → DB: ${dbName} | User: ${dbUser} | Password: ${chalk.cyan(part.dbPassword)}`));
            }
            console.log(chalk.gray('Mật khẩu này CHỈ hiển thị một lần duy nhất tại đây.'));
        }

    } catch (error) {
        console.error(chalk.red.bold('\n❌ CÓ LỖI XẢY RA:'));
        console.error(chalk.red(error.message));
        process.exit(1);
    }
}

main();
