#!/usr/bin/env node

import inquirer from 'inquirer';
import chalk from 'chalk';
import { generateSSHKeys, installPublicKeyToVPS } from '../src/utils/ssh.js';
import { checkGithubAuth, loginGithub, setGithubSecret, installGithubCli } from '../src/github/secrets.js';
import { setupWebserverOnVPS } from '../src/vps/setup.js';
import { generateWorkflowFile } from '../src/templates/workflows.js';

async function main() {
    console.log(chalk.green.bold('🚀 Chào mừng đến với Auto VPS Deploy CLI'));
    console.log(chalk.gray('Công cụ này sẽ tự động hóa việc cấu hình VPS, thiết lập SSL, và tạo Github Actions Workflow cho bạn.\n'));

    // 1. Kiểm tra Github CLI
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

    // 2. Thu thập thông tin từ người dùng
    const answers = await inquirer.prompt([
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
        },
        {
            type: 'input',
            name: 'domain',
            message: 'Nhập Tên Miền (Domain) của dự án:',
            validate: input => input ? true : 'Không được để trống'
        },
        {
            type: 'list',
            name: 'projectType',
            message: 'Chọn loại dự án của bạn:',
            choices: ['Node.js (PM2)', 'PHP (Laravel)', 'Static']
        },
        {
            type: 'input',
            name: 'port',
            message: 'Dự án Node.js đang chạy ở cổng nào (Port)?',
            default: '3000',
            when: (answers) => answers.projectType === 'Node.js (PM2)'
        },
        {
            type: 'list',
            name: 'role',
            message: 'Vai trò của phần dự án này là gì? (Dùng để đặt tên file workflow)',
            choices: ['Frontend', 'Backend', 'Fullstack (Gốc)']
        },
        {
            type: 'input',
            name: 'workingDir',
            message: 'Thư mục chứa mã nguồn nằm ở đâu trong Repository? (Ví dụ: ./frontend)',
            default: './'
        },
        {
            type: 'confirm',
            name: 'usePrisma',
            message: 'Bạn có sử dụng Prisma ORM để quản lý Database không?',
            default: false,
            when: (answers) => answers.projectType === 'Node.js (PM2)'
        }
    ]);

    const { vpsHost, vpsUser, vpsPassword, domain, projectType, port, role, workingDir, usePrisma } = answers;

    try {
        console.log(chalk.cyan('\n⚙️  Bắt đầu quá trình tự động hóa...'));

        // 3. Setup Web Server (Nginx & Certbot)
        console.log(chalk.blue('▶️  Bước 1: Cấu hình Nginx và SSL trên VPS...'));
        await setupWebserverOnVPS(vpsHost, vpsUser, vpsPassword, domain, projectType, port);
        console.log(chalk.green('✅ Xong Bước 1.'));

        // 4. Sinh SSH Key và thêm vào VPS
        console.log(chalk.blue('\n▶️  Bước 2: Thiết lập kết nối bảo mật (SSH Keys) cho Github Actions...'));
        const { publicKey, privateKey } = generateSSHKeys();
        await installPublicKeyToVPS(vpsHost, vpsUser, vpsPassword, publicKey);
        console.log(chalk.green('✅ Xong Bước 2.'));

        // 5. Lưu Github Secrets
        console.log(chalk.blue('\n▶️  Bước 3: Lưu các biến bảo mật lên Github Repository Secrets...'));
        await setGithubSecret('VPS_HOST', vpsHost);
        await setGithubSecret('VPS_USERNAME', vpsUser);
        await setGithubSecret('VPS_SSH_KEY', privateKey);
        console.log(chalk.green('✅ Xong Bước 3.'));

        // 6. Tạo Workflow file
        console.log(chalk.blue('\n▶️  Bước 4: Tạo Github Actions Workflow...'));
        generateWorkflowFile(projectType, domain, role, workingDir, usePrisma);
        console.log(chalk.green('✅ Xong Bước 4.'));

        console.log(chalk.green.bold('\n🎉 HOÀN TẤT! 🎉'));
        console.log(chalk.white(`Hệ thống đã sẵn sàng. Bạn chỉ cần commit các thay đổi (bao gồm thư mục .github) và push lên nhánh main/master.`));
        console.log(chalk.white(`Github Actions sẽ tự động deploy code của bạn lên VPS!`));

    } catch (error) {
        console.error(chalk.red.bold('\n❌ CÓ LỖI XẢY RA:'));
        console.error(chalk.red(error.message));
        process.exit(1);
    }
}

main();
