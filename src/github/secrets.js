import { execa } from 'execa';

/**
 * Kiểm tra xem người dùng đã login github cli chưa
 */
export async function checkGithubAuth() {
    try {
        await execa('gh', ['auth', 'status']);
        return true;
    } catch (error) {
        // Nếu mã lỗi là ENOENT hoặc chứa thông báo không tìm thấy lệnh gh
        if (error.code === 'ENOENT' || error.message.includes('not recognized')) {
            throw new Error('NOT_INSTALLED');
        }
        return false;
    }
}

/**
 * Yêu cầu người dùng login github
 */
export async function loginGithub() {
    console.log('Đang mở trình duyệt để đăng nhập Github...');
    await execa('gh', ['auth', 'login'], { stdio: 'inherit' });
}

/**
 * Tự động cài đặt Github CLI
 */
export async function installGithubCli() {
    console.log('Bắt đầu cài đặt Github CLI...');
    try {
        if (process.platform === 'win32') {
            await execa('winget', ['install', '--id', 'GitHub.cli', '--source', 'winget'], { stdio: 'inherit' });
        } else if (process.platform === 'darwin') {
            await execa('brew', ['install', 'gh'], { stdio: 'inherit' });
        } else {
            throw new Error('Hệ điều hành không được hỗ trợ cài tự động.');
        }
        return true;
    } catch (error) {
        console.error('Lỗi khi cài đặt tự động:', error.message);
        return false;
    }
}

/**
 * Thiết lập Github Secret cho repository hiện tại
 */
export async function setGithubSecret(secretName, secretValue) {
    try {
        // Sử dụng pipe để truyền value vào lệnh gh nhằm bảo mật, không lộ trên command line history
        const subprocess = execa('gh', ['secret', 'set', secretName]);
        subprocess.stdin.write(secretValue);
        subprocess.stdin.end();
        await subprocess;
        return true;
    } catch (error) {
        console.error(`Lỗi khi set secret ${secretName}:`, error.message);
        throw error;
    }
}
