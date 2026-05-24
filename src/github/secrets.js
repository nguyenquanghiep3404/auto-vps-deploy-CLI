import { execa } from 'execa';

/**
 * Kiểm tra xem người dùng đã login github cli chưa
 */
export async function checkGithubAuth() {
    try {
        await execa('gh', ['auth', 'status']);
        return true;
    } catch (error) {
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
