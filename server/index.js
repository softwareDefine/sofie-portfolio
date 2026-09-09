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
// 관리 화면은 운영 콘솔로 일원화됐다(구글 로그인). 예전 화면은 views/admin.html 에 남아 있고
// 이 줄을 되돌리면 그대로 살아난다.
app.get('/admin', (req, res) => res.redirect(302, process.env.CONSOLE_URL || 'https://console.sofie.co.kr/'));
app.get('/project/:id(\\d+)', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'project.html')));
app.get('/career/:id(\\d+)', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'career.html')));
// 링크 태그 없이 직접 /favicon.ico 요청하는 클라이언트 대응
app.get('/favicon.ico', (req, res) => {
    res.type('image/svg+xml');
    res.sendFile(path.join(PUBLIC_DIR, '소피로고.svg'));
});
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
