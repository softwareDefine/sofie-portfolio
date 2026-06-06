// RFC 6238 TOTP — Google Authenticator 호환 (SHA-1, 30초, 6자리)
const crypto = require('crypto');

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(str) {
    const clean = str.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
    let bits = 0, value = 0;
    const bytes = [];
    for (const ch of clean) {
        const idx = B32_ALPHABET.indexOf(ch);
        if (idx === -1) throw new Error('잘못된 base32 문자: ' + ch);
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
}

function hotp(secretBuf, counter) {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', secretBuf).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = ((hmac[offset] & 0x7f) << 24)
        | (hmac[offset + 1] << 16)
        | (hmac[offset + 2] << 8)
        | hmac[offset + 3];
    return String(code % 1_000_000).padStart(6, '0');
}

// 시계 오차 허용: 현재 ±1 스텝(30초)
function verifyTotp(secretBase32, token) {
    if (!/^\d{6}$/.test(token || '')) return false;
    const secretBuf = base32Decode(secretBase32);
    const step = Math.floor(Date.now() / 1000 / 30);
    for (const w of [0, -1, 1]) {
        const expected = hotp(secretBuf, step + w);
        if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token))) return true;
    }
    return false;
}

function generateSecret() {
    const bytes = crypto.randomBytes(20);
    let out = '', bits = 0, value = 0;
    for (const b of bytes) {
        value = (value << 8) | b;
        bits += 8;
        while (bits >= 5) {
            out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    return out;
}

module.exports = { verifyTotp, generateSecret, base32Decode, hotp };
