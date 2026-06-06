const path = require('path');
const { verifyTotp } = require('./totp');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const OTP_SECRET = process.env.OTP_SECRET || '';

function login(req, res) {
    const { password, otp } = req.body || {};
    if (typeof password !== 'string' || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: '비밀번호가 틀렸습니다.' });
    }
    if (OTP_SECRET && !verifyTotp(OTP_SECRET, otp)) {
        return res.status(401).json({ error: 'OTP가 올바르지 않습니다.' });
    }
    req.session.admin = true;
    res.json({ ok: true });
}

// 프론트가 OTP 입력칸 표시 여부 판단용
function loginConfig(req, res) {
    res.json({ otpRequired: !!OTP_SECRET });
}

function logout(req, res) {
    req.session = null;
    res.json({ ok: true });
}

function requireAdmin(req, res, next) {
    if (req.session && req.session.admin) return next();
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

module.exports = { login, logout, loginConfig, requireAdmin, requireInternal };
