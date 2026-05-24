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

    // Hàm mã hóa số nguyên lớn theo chuẩn MPINT của SSH (RFC 4251)
    const mpint = (buf) => {
        if (buf[0] & 0x80) {
            const b = Buffer.alloc(buf.length + 1);
            b[0] = 0x00;
            buf.copy(b, 1);
            buf = b;
        }
        const len = Buffer.alloc(4);
        len.writeUInt32BE(buf.length);
        return Buffer.concat([len, buf]);
    };

    const type = Buffer.from('ssh-rsa');
    const typeLen = Buffer.alloc(4);
    typeLen.writeUInt32BE(type.length);
    const pubKey = 'ssh-rsa ' + Buffer.concat([typeLen, type, mpint(e), mpint(n)]).toString('base64') + ' deploy-vps-key';

    return { publicKey: pubKey, privateKey };
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
