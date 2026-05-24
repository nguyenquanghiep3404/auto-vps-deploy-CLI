import { NodeSSH } from 'node-ssh';
import { generateKeyPairSync } from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Tạo cặp khóa SSH RSA
 */
export function generateSSHKeys() {
    const { publicKey: pubObj, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 4096,
        privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem'
        }
    });

    // Chuyển đổi sang JWK để lấy Modulus (n) và Exponent (e)
    const jwk = pubObj.export({ format: 'jwk' });
    const b64url2b64 = str => Buffer.from(str, 'base64url');
    const e = b64url2b64(jwk.e);
    const n = b64url2b64(jwk.n);

    // Xây dựng chuỗi Byte ssh-rsa chuẩn
    const len = buf => { 
        const b = Buffer.alloc(4); 
        b.writeUInt32BE(buf.length); 
        return b; 
    };
    const type = Buffer.from('ssh-rsa');
    const parts = [len(type), type, len(e), e, len(n), n];
    const publicKey = 'ssh-rsa ' + Buffer.concat(parts).toString('base64') + ' deploy-vps-key';

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
