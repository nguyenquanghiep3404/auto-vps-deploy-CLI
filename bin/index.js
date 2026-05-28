#!/usr/bin/env node

import inquirer from 'inquirer';
import chalk from 'chalk';
import { generateSSHKeys, installPublicKeyToVPS } from '../src/utils/ssh.js';
import { checkGithubAuth, loginGithub, setGithubSecret, installGithubCli } from '../src/github/secrets.js';
import { setupWebserverOnVPS } from '../src/vps/setup.js';
import { generateWorkflowFile } from '../src/templates/workflows.js';
import { execaCommand } from 'execa';

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
                name: 'port',
                message: 'Dự án Node.js đang chạy ở cổng nào (Port)?',
                default: '3000',
                when: (a) => a.projectType.includes('Node.js')
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

        parts.push({
            name: 'Fullstack (Gốc)',
            domain: singleAnswers.domain,
            projectType: singleAnswers.projectType,
            port: singleAnswers.port,
            workingDir: './',
            buildDir: singleAnswers.buildDir,
            usePrisma: singleAnswers.usePrisma
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
                    name: 'port',
                    message: `Phần này chạy ở cổng nào (Port)?`,
                    default: i === 1 ? '3000' : `${3000 + i - 1}`,
                    when: (a) => a.projectType.includes('Node.js')
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

            parts.push({
                name: partAnswers.partName,
                domain: partAnswers.domain,
                projectType: partAnswers.projectType,
                port: partAnswers.port,
                workingDir: partAnswers.workingDir,
                buildDir: partAnswers.buildDir,
                usePrisma: partAnswers.usePrisma
            });
        }

        // Hiển thị bảng tóm tắt
        console.log(chalk.cyan.bold('\n📋 Tóm tắt cấu hình Monorepo:'));
        console.log(chalk.gray('─'.repeat(60)));
        parts.forEach((p, idx) => {
            console.log(chalk.white(`  ${idx + 1}. ${chalk.bold(p.name)}: ${p.domain} | ${p.projectType} | Thư mục: ${p.workingDir}`));
        });
        console.log(chalk.gray('─'.repeat(60)));
    }

    // ========================================
    // 5. BẮT ĐẦU QUÁ TRÌNH TỰ ĐỘNG HÓA
    // ========================================
    try {
        console.log(chalk.cyan('\n⚙️  Bắt đầu quá trình tự động hóa...'));

        // ---- Bước 1: Cấu hình Nginx + SSL cho TẤT CẢ các phần ----
        console.log(chalk.blue('▶️  Bước 1: Cấu hình Nginx và SSL trên VPS...'));
        for (const part of parts) {
            console.log(chalk.gray(`   → Đang cấu hình cho ${part.name} (${part.domain})...`));
            await setupWebserverOnVPS(vpsHost, vpsUser, vpsPassword, part.domain, part.projectType, part.port);
        }
        console.log(chalk.green('✅ Xong Bước 1.'));

        // ---- Bước 2: Sinh SSH Key (1 lần duy nhất) ----
        console.log(chalk.blue('\n▶️  Bước 2: Thiết lập kết nối bảo mật (SSH Keys) cho Github Actions...'));
        const { publicKey, privateKey } = generateSSHKeys();
        await installPublicKeyToVPS(vpsHost, vpsUser, vpsPassword, publicKey);
        console.log(chalk.green('✅ Xong Bước 2.'));

        // ---- Bước 3: Lưu Github Secrets (1 lần duy nhất) ----
        console.log(chalk.blue('\n▶️  Bước 3: Lưu các biến bảo mật lên Github Repository Secrets...'));
        await setGithubSecret('VPS_HOST', vpsHost);
        await setGithubSecret('VPS_USERNAME', vpsUser);
        await setGithubSecret('VPS_SSH_KEY', privateKey);
        console.log(chalk.green('✅ Xong Bước 3.'));

        // ---- Bước 4: Tạo Workflow file cho từng phần ----
        console.log(chalk.blue('\n▶️  Bước 4: Tạo Github Actions Workflow...'));
        for (const part of parts) {
            const role = isMonorepo ? part.name : part.name; // Single: 'Fullstack (Gốc)', Monorepo: tên phần
            generateWorkflowFile(part.projectType, part.domain, role, part.workingDir, part.buildDir, part.usePrisma);
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

    } catch (error) {
        console.error(chalk.red.bold('\n❌ CÓ LỖI XẢY RA:'));
        console.error(chalk.red(error.message));
        process.exit(1);
    }
}

main();
