import { NodeSSH } from 'node-ssh';
import { generateKeyPairSync } from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Tạo cặp khóa SSH RSA
 */
export function generateSSHKeys() {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 4096,
        publicKeyEncoding: {
            type: 'spki',
            format: 'openssh'
        },
        privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem'
        }
    });

    return { publicKey, privateKey };
}

/**
 * Kết nối VPS và thêm public key vào authorized_keys
 */
export async function installPublicKeyToVPS(host, username, password, publicKey) {
    const ssh = new NodeSSH();
    try {
        await ssh.connect({
            host: host,
            username: username,
            password: password,
        });

        // Đảm bảo thư mục .ssh tồn tại
        await ssh.execCommand('mkdir -p ~/.ssh && chmod 700 ~/.ssh');
        
        // Thêm public key vào authorized_keys
        const result = await ssh.execCommand(`echo "${publicKey}" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`);
        
        if (result.stderr) {
            console.error('Lỗi khi thêm SSH Key:', result.stderr);
        }

        return true;
    } catch (error) {
        throw new Error('Không thể kết nối SSH vào VPS hoặc cài đặt key thất bại: ' + error.message);
    } finally {
        ssh.dispose();
    }
}
