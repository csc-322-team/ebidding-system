const express = require('express');
const bcrypt = require('bcrypt');
const { Readable } = require( "stream" );
const db = require('../database');
const router = express.Router();

const activeCaptchas = {};
const CAPTCHA_EXPIRE = 5 * 60 * 1000;

router.post('/register', async (req, res) => {
    const fields = req.body;
    
    const requiredFields = ['username', 'password', 'captchaId', 'captcha'];
    for (const fieldName of requiredFields) {
        if (!fields[fieldName]) return res.status(400).json({ message: 'Username, password, and captcha answer are required.' });
    }
    
    if (fields.password !== fields.confirm) {
        return res.status(400).json({ message: 'Input password does not match confirmed password.' });
    }

    if (fields.role && fields.role !== 'V' && fields.role !== 'S') {
        return res.status(400).json({ message: 'Invalid role.' });
    }
    
    const captchaAns = activeCaptchas[fields.captchaId];
    if (!captchaAns) {
        return res.status(400).json({ message: 'Captcha expired from inactivity.' });
    }
    if (captchaAns !== fields.captcha.toUpperCase()) {
        return res.status(400).json({ message: 'Captcha answer is incorrect.' });
    }

    db.get('SELECT * FROM Users WHERE username = ?', [fields.username], async (err, user) => {
        if (err) return res.status(500).json({ message: 'Database error.' });
        if (user) return res.status(400).json({ message: 'Username already exists.' });

        const hashedPassword = await bcrypt.hash(fields.password, 10);

        const status = fields.role === 'S' ? 'approved' : 'pending';

        db.run(
            `INSERT INTO Users (username, password, role, status) VALUES (?, ?, ?, ?)`,
            [fields.username, hashedPassword, fields.role || 'V', status],
            function (err) {
                if (err) {
                    return res.status(500).json({ message: 'Error registering user.' });
                }

                const message = status === 'approved'
                    ? 'Superuser registered successfully.'
                    : 'Registration successful. Awaiting admin approval.';
                res.status(201).json({ message });
            }
        );
    });
});

router.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required.' });
    }

    db.get('SELECT * FROM Users WHERE username = ?', [username], async (err, user) => {
        if (err) return res.status(500).json({ message: 'Database error.' });
        if (!user) return res.status(400).json({ message: 'Invalid username or password.' });

        if (user.status === 'pending') {
            return res.status(403).json({ message: 'Account is pending approval.' });
        }

        if (user.status === 'rejected') {
            return res.status(403).json({ message: 'Account has been rejected.' });
        }

        if (user.status === 'suspended') {
            return res.status(403).json({ message: 'Account has been suspended.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid username or password.' });
        }

        req.session.user = { id: user.id, username: user.username, role: user.role };

        if (user.role === 'S') {
            return res.redirect('/superuser/superuser_dashboard');
        } else {
            return res.redirect('/');
        }
    });
});

router.get('/register', (req, res) => {
    // Generate a captcha and store it temporarily
    const captchaId = Math.random().toString().slice(2);
    const captchaText = Math.floor(Math.random() * 36 ** 6).toString(36).toUpperCase().padStart(6, '0');
    activeCaptchas[captchaId] = captchaText;
    setTimeout(() => delete activeCaptchas[captchaId], CAPTCHA_EXPIRE);

    res.render('register', {captchaId});
});

router.get('/login', (req, res) => {
    res.render('login');
});

router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ message: 'Error logging out.' });
        }
        res.redirect('/auth/login');
    });
});

router.get('/captcha/:id', (req, res) => {
    const text = activeCaptchas[req.params.id];
    if (!text) return res.sendStatus(404);
    
    fetch('https://api.opencaptcha.io/captcha', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({text, difficulty: 3, width: 200, height: 50})}
    ).then(
        captchaRes => Readable.fromWeb(captchaRes.body).pipe(res)
    );
});

module.exports = router;