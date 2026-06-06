const nodemailer = require('nodemailer');

function smtpConfigured() {
    return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function targetEmail() {
    return process.env.RESET_EMAIL || '';
}

async function sendResetCode(code) {
    const to = targetEmail();
    if (!smtpConfigured()) {
        // dev 모드: SMTP 미설정이면 서버 콘솔에만 출력
        console.log(`[mailer] SMTP 미설정 — 재설정 인증코드: ${code}`);
        return { dev: true };
    }
    if (!to) throw new Error('RESET_EMAIL이 설정되지 않았습니다.');
    const port = +(process.env.SMTP_PORT || 587);
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject: '[sofie] admin 재설정 인증코드',
        text: `인증코드: ${code}\n\n10분 동안 유효합니다. 본인이 요청하지 않았다면 무시하세요.`,
    });
    return { dev: false };
}

function maskEmail(email) {
    if (!email) return '(콘솔 출력)';
    const [id, domain] = email.split('@');
    return id.slice(0, 2) + '***@' + domain;
}

module.exports = { sendResetCode, maskEmail, targetEmail, smtpConfigured };
