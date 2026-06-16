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
        
        // Thêm public key vào authorized_keys — CHỈ khi chưa có (tránh file phình to khi chạy lại nhiều lần).
        const result = await ssh.execCommand(`touch ~/.ssh/authorized_keys; grep -qxF "${publicKey}" ~/.ssh/authorized_keys || echo "${publicKey}" >> ~/.ssh/authorized_keys; chmod 600 ~/.ssh/authorized_keys`);
        
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

/**
 * Quét các port đang được sử dụng trên VPS trong dãy 3000-3999
 * Trả về mảng các số port đã bị chiếm
 */
export async function scanUsedPorts(host, username, password) {
    const ssh = new NodeSSH();
    try {
        await ssh.connect({
            host: host,
            username: username,
            password: password,
        });

        // Chạy lệnh ss để liệt kê các port đang LISTEN
        const result = await ssh.execCommand("ss -tlnp | awk '{print $4}' | grep -oP '\\d+$' | sort -n | uniq");
        
        if (result.stdout) {
            const ports = result.stdout
                .split('\n')
                .map(p => parseInt(p.trim()))
                .filter(p => !isNaN(p) && p >= 3000 && p <= 3999);
            return ports;
        }
        return [];
    } catch (error) {
        // Nếu không thể quét, trả về mảng rỗng (sẽ bắt đầu từ 3000)
        return [];
    } finally {
        ssh.dispose();
    }
}

/**
 * Đọc các cấu hình Nginx có sẵn để lấy cổng ĐÃ gán cho từng domain ở lần deploy trước.
 * Tool đặt file config theo tên domain (/etc/nginx/sites-available/<domain>) và proxy tới
 * 127.0.0.1:<port>. Nhờ vậy lần chạy lại, ta TÁI SỬ DỤNG đúng cổng cũ thay vì gán cổng mới
 * (tránh cổng "trôi" và bỏ lại process PM2 cũ). Trả về map { domain: port }.
 */
export async function scanDomainPorts(host, username, password) {
    const ssh = new NodeSSH();
    try {
        await ssh.connect({ host, username, password });
        // Với mỗi file config: in "tên-file cổng" nếu tìm thấy proxy_pass tới 127.0.0.1:<port>.
        const cmd = "for f in /etc/nginx/sites-available/*; do [ -f \"$f\" ] || continue; "
            + "p=$(grep -oE 'proxy_pass http://127\\.0\\.0\\.1:[0-9]+' \"$f\" 2>/dev/null | grep -oE '[0-9]+$' | head -n1); "
            + "[ -n \"$p\" ] && echo \"$(basename \"$f\") $p\"; done";
        const result = await ssh.execCommand(cmd);
        const map = {};
        for (const line of (result.stdout || '').split('\n')) {
            const [domain, port] = line.trim().split(/\s+/);
            const p = parseInt(port, 10);
            if (domain && !isNaN(p)) map[domain] = p;
        }
        return map;
    } catch (error) {
        // Không quét được -> coi như chưa có cấu hình cũ (sẽ gán cổng mới).
        return {};
    } finally {
        ssh.dispose();
    }
}

/**
 * Tìm port trống tiếp theo trong dãy 3000-3999
 * usedPorts: mảng các port đã bị chiếm
 * count: số lượng port trống cần tìm
 */
export function findAvailablePorts(usedPorts, count = 1) {
    const available = [];
    for (let port = 3000; port <= 3999 && available.length < count; port++) {
        if (!usedPorts.includes(port)) {
            available.push(port);
        }
    }
    return available;
}
