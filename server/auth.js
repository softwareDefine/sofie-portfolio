const path = require('path');
const crypto = require('crypto');
const { pool } = require('./db');
const { verifyTotp, generateSecret } = require('./totp');
const { sendResetCode, maskEmail, targetEmail } = require('./mailer');

// ─── settings 헬퍼 ───
async function getSetting(key) {
    const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
    return rows.length ? rows[0].value : null;
}
async function setSetting(key, value) {
    await pool.query(
        `INSERT INTO settings (key, value) VALUES ($1,$2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, String(value)]
    );
}

// ─── 비밀번호 해시 (scrypt) ───
function hashPassword(pw) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
    return salt + ':' + hash;
}
function verifyPassword(pw, stored) {
    if (!stored || !stored.includes(':')) return false;
    const [salt, hash] = stored.split(':');
    const test = crypto.scryptSync(pw, salt, 64);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), test);
}

// 최초 부팅 시 env 값으로 자격증명 초기화 (DB에 없을 때만)
async function ensureCredentials() {
    if (!(await getSetting('admin_password_hash'))) {
        await setSetting('admin_password_hash', hashPassword(process.env.ADMIN_PASSWORD || 'changeme'));
        console.log('admin 비밀번호 초기화됨 (env ADMIN_PASSWORD 기준)');
    }
    if (process.env.OTP_SECRET && !(await getSetting('otp_secret'))) {
        await setSetting('otp_secret', process.env.OTP_SECRET);
        console.log('OTP 시크릿 초기화됨 (env OTP_SECRET 기준)');
    }
}

// ─── 로그인 ───
async function login(req, res, next) {
    try {
        const { password, otp } = req.body || {};
        const stored = await getSetting('admin_password_hash');
        if (typeof password !== 'string' || !verifyPassword(password, stored)) {
            return res.status(401).json({ error: '비밀번호가 틀렸습니다.' });
        }
        const otpSecret = await getSetting('otp_secret');
        if (otpSecret && !verifyTotp(otpSecret, otp)) {
            return res.status(401).json({ error: 'OTP가 올바르지 않습니다.' });
        }
        req.session.admin = true;
        res.json({ ok: true });
    } catch (e) { next(e); }
}

function logout(req, res) {
    req.session = null;
    res.json({ ok: true });
}

// 프론트가 OTP 입력칸 표시 여부 판단용
async function loginConfig(req, res, next) {
    try {
        res.json({ otpRequired: !!(await getSetting('otp_secret')) });
    } catch (e) { next(e); }
}

// ─── 메일 인증 재설정 ───
// 단일 admin이므로 메모리 상태로 충분 (재시작하면 무효 — 다시 요청하면 됨)
let resetState = null; // { codeHash, expires, attempts, lastSent }

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

async function resetRequest(req, res, next) {
    try {
        const now = Date.now();
        if (resetState && now - resetState.lastSent < 60_000) {
            return res.status(429).json({ error: '잠시 후 다시 시도하세요. (1분에 1회)' });
        }
        const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
        resetState = { codeHash: sha256(code), expires: now + 10 * 60_000, attempts: 0, lastSent: now };
        const result = await sendResetCode(code);
        res.json({ ok: true, sentTo: result.dev ? '(dev: 서버 콘솔 확인)' : maskEmail(targetEmail()) });
    } catch (e) { next(e); }
}

async function resetConfirm(req, res, next) {
    try {
        const { code, newPassword, regenOtp, disableOtp } = req.body || {};
        if (!resetState || Date.now() > resetState.expires) {
            return res.status(400).json({ error: '인증코드가 만료됐습니다. 다시 요청하세요.' });
        }
        if (resetState.attempts >= 5) {
            resetState = null;
            return res.status(429).json({ error: '시도 횟수 초과. 다시 요청하세요.' });
        }
        resetState.attempts++;
        if (!/^\d{6}$/.test(code || '') || sha256(code) !== resetState.codeHash) {
            return res.status(401).json({ error: '인증코드가 올바르지 않습니다.' });
        }
        resetState = null; // 일회용

        const out = { ok: true };
        if (newPassword) {
            if (typeof newPassword !== 'string' || newPassword.length < 8) {
                return res.status(400).json({ error: '새 비밀번호는 8자 이상이어야 합니다.' });
            }
            await setSetting('admin_password_hash', hashPassword(newPassword));
            out.passwordChanged = true;
        }
        if (regenOtp) {
            const secret = generateSecret();
            await setSetting('otp_secret', secret);
            out.otpSecret = secret;
            out.otpauthUri = `otpauth://totp/sofie-admin?secret=${secret}&issuer=sofie`;
        } else if (disableOtp) {
            await pool.query(`DELETE FROM settings WHERE key = 'otp_secret'`);
            out.otpDisabled = true;
        }
        res.json(out);
    } catch (e) { next(e); }
}

// 내부 서비스(운영 콘솔)가 세션 없이 쓰기 위한 경로.
// SERVICE_TOKEN 이 설정된 경우에만 열리고, 값은 상수 시간으로 비교한다.
// 이 라우터는 이미 requireInternal 뒤에 있으므로 도커 내부망에서만 닿는다.
function hasServiceToken(req) {
    const expected = process.env.SERVICE_TOKEN;
    if (!expected) return false;
    const got = req.get('x-service-token') || '';
    const a = Buffer.from(got), b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
    if (req.session && req.session.admin) return next();
    if (hasServiceToken(req)) return next();
    res.status(401).json({ error: '로그인이 필요합니다.' });
}

// 사설망/로컬 IP만 허용 (admin 전용)
function isInternalIp(ip) {
    if (!ip) return false;
    ip = ip.replace(/^::ffff:/, '');
    return ip === '::1'
        || /^127\./.test(ip)
        || /^10\./.test(ip)
        || /^192\.168\./.test(ip)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
        || /^f[cd]/i.test(ip)   // fc00::/7 ULA
        || /^fe80/i.test(ip);   // link-local
}

function requireInternal(req, res, next) {
    if (isInternalIp(req.ip)) return next();
    res.status(403);
    // 브라우저 접근이면 차단 페이지, API 호출이면 JSON
    if (req.accepts(['json', 'html']) === 'html') {
        return res.sendFile(path.join(__dirname, 'views', 'forbidden.html'));
    }
    res.json({ error: '지정되지 않은 접근입니다.' });
}

module.exports = {
    login, logout, loginConfig, requireAdmin, requireInternal,
    ensureCredentials, resetRequest, resetConfirm,
};
