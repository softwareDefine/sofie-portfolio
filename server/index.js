const express = require('express');
const cookieSession = require('cookie-session');
const path = require('path');
const crypto = require('crypto');
const { migrate } = require('./db');
const { requireInternal, ensureCredentials } = require('./auth');
const api = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// 리버스 프록시(nginx, cloudflared 등) 뒤에 있으면 TRUST_PROXY=1 설정
// → X-Forwarded-For 기준으로 req.ip 판별
if (process.env.TRUST_PROXY) app.set('trust proxy', true);

app.use(express.json());
app.use(cookieSession({
    name: 'sofie_session',
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7일
    httpOnly: true,
    sameSite: 'lax',
}));

app.use('/api', api);
app.get('/admin', requireInternal, (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));
app.get('/project/:id(\\d+)', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'project.html')));
app.use(express.static(PUBLIC_DIR));

// 에러 핸들러
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: err.message || '서버 오류' });
});

(async () => {
    // DB가 늦게 뜨는 경우(docker compose) 대비 재시도
    for (let i = 0; i < 10; i++) {
        try {
            await migrate();
            await ensureCredentials();
            break;
        } catch (e) {
            if (i === 9) { console.error('DB 연결 실패:', e.message); process.exit(1); }
            console.log(`DB 대기 중... (${i + 1}/10)`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    app.listen(PORT, () => console.log(`sofie-portfolio listening on :${PORT}`));
})();
