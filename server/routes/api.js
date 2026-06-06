const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { pool } = require('../db');
const { login, logout, loginConfig, requireAdmin, requireInternal } = require('../auth');

const router = express.Router();

// ─── 공개 API ───
// 메인 페이지가 한 번에 받아가는 전체 콘텐츠
router.get('/content', async (req, res, next) => {
    try {
        const [careers, projects, settings] = await Promise.all([
            pool.query('SELECT * FROM careers ORDER BY year DESC, sort_order, id'),
            pool.query('SELECT * FROM projects ORDER BY sort_order, id'),
            pool.query('SELECT key, value FROM settings'),
        ]);
        res.json({
            careers: careers.rows,
            projects: projects.rows,
            settings: Object.fromEntries(settings.rows.map(r => [r.key, r.value])),
        });
    } catch (e) { next(e); }
});

// 이하 전부 내부망 전용 (로그인 포함)
router.use(requireInternal);

// ─── 인증 ───
router.get('/login-config', loginConfig);
router.post('/login', login);
router.post('/logout', logout);
router.get('/me', (req, res) => res.json({ admin: !!(req.session && req.session.admin) }));

// 이하 전부 admin 전용
router.use(requireAdmin);

// ─── 드래그 정렬 (반드시 /:id 라우트보다 먼저) ───
async function reorder(table, ids, res, next) {
    if (!Array.isArray(ids) || !ids.every(Number.isInteger)) {
        return res.status(400).json({ error: 'ids는 정수 배열이어야 함' });
    }
    try {
        await pool.query(
            `UPDATE ${table} t SET sort_order = v.ord - 1
             FROM unnest($1::int[]) WITH ORDINALITY AS v(id, ord)
             WHERE t.id = v.id`,
            [ids]
        );
        res.json({ ok: true });
    } catch (e) { next(e); }
}
router.put('/careers/reorder', (req, res, next) => reorder('careers', req.body.ids, res, next));
router.put('/projects/reorder', (req, res, next) => reorder('projects', req.body.ids, res, next));

// ─── 세부경력 CRUD ───
router.post('/careers', async (req, res, next) => {
    try {
        const { year, title, featured = false } = req.body;
        if (!Number.isInteger(year) || !title) return res.status(400).json({ error: 'year(정수), title 필수' });
        // 같은 연도 맨 뒤에 추가
        const { rows } = await pool.query(
            `INSERT INTO careers (year, title, featured, sort_order)
             VALUES ($1,$2,$3, (SELECT COALESCE(MAX(sort_order)+1, 0) FROM careers WHERE year=$1))
             RETURNING *`,
            [year, title, !!featured]
        );
        res.status(201).json(rows[0]);
    } catch (e) { next(e); }
});

router.put('/careers/:id', async (req, res, next) => {
    try {
        const { year, title, featured, sort_order } = req.body;
        const { rows } = await pool.query(
            `UPDATE careers SET
                year = COALESCE($1, year),
                title = COALESCE($2, title),
                featured = COALESCE($3, featured),
                sort_order = COALESCE($4, sort_order)
             WHERE id = $5 RETURNING *`,
            [year ?? null, title ?? null, featured ?? null, sort_order ?? null, req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: '없는 항목' });
        res.json(rows[0]);
    } catch (e) { next(e); }
});

router.delete('/careers/:id', async (req, res, next) => {
    try {
        const { rowCount } = await pool.query('DELETE FROM careers WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ error: '없는 항목' });
        res.json({ ok: true });
    } catch (e) { next(e); }
});

// ─── 프로젝트 CRUD ───
router.post('/projects', async (req, res, next) => {
    try {
        const { year, title, description = '', tags = [], image_url = null, link_url = null } = req.body;
        if (!Number.isInteger(year) || !title) return res.status(400).json({ error: 'year(정수), title 필수' });
        // 맨 뒤에 추가
        const { rows } = await pool.query(
            `INSERT INTO projects (year, title, description, tags, image_url, link_url, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6, (SELECT COALESCE(MAX(sort_order)+1, 0) FROM projects))
             RETURNING *`,
            [year, title, description, tags, image_url, link_url]
        );
        res.status(201).json(rows[0]);
    } catch (e) { next(e); }
});

router.put('/projects/:id', async (req, res, next) => {
    try {
        const { year, title, description, tags, image_url, link_url, sort_order } = req.body;
        const { rows } = await pool.query(
            `UPDATE projects SET
                year = COALESCE($1, year),
                title = COALESCE($2, title),
                description = COALESCE($3, description),
                tags = COALESCE($4, tags),
                image_url = $5,
                link_url = $6,
                sort_order = COALESCE($7, sort_order)
             WHERE id = $8 RETURNING *`,
            [year ?? null, title ?? null, description ?? null, tags ?? null,
             image_url !== undefined ? image_url : null, link_url !== undefined ? link_url : null,
             sort_order ?? null, req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: '없는 항목' });
        res.json(rows[0]);
    } catch (e) { next(e); }
});

router.delete('/projects/:id', async (req, res, next) => {
    try {
        const { rowCount } = await pool.query('DELETE FROM projects WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ error: '없는 항목' });
        res.json({ ok: true });
    } catch (e) { next(e); }
});

// ─── 스탯 (settings) ───
router.put('/settings', async (req, res, next) => {
    try {
        const entries = Object.entries(req.body || {});
        for (const [key, value] of entries) {
            await pool.query(
                `INSERT INTO settings (key, value) VALUES ($1,$2)
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
                [key, String(value)]
            );
        }
        res.json({ ok: true });
    } catch (e) { next(e); }
});

// ─── 이미지 업로드 ───
const upload = multer({
    storage: multer.diskStorage({
        destination: path.join(__dirname, '..', '..', 'public', 'uploads'),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            cb(null, crypto.randomBytes(8).toString('hex') + ext);
        },
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(path.extname(file.originalname).toLowerCase());
        cb(ok ? null : new Error('이미지 파일만 업로드 가능'), ok);
    },
});

router.post('/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: '파일 없음' });
    res.json({ url: '/uploads/' + req.file.filename });
});

module.exports = router;
