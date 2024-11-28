const express = require('express');
const bcrypt = require('bcrypt');
const { Readable } = require( "stream" );
const db = require('../database');
const router = express.Router();

const activeCaptchas = {};
const CAPTCHA_EXPIRE = 5 * 60 * 1000;

router.post('/register', async (req, res) => {
    const fields = req.body;
    const captchaAns = activeCaptchas[fields.captchaId];
    const error = (msg, code = 400) => res.status(code).render('register', {
        error: msg,
        captchaId: captchaAns ? fields.captchaId : generateCaptcha(),
        fields
    });
    
    const requiredFields = ['email', 'username', 'password', 'captchaId', 'captcha'];
    for (const fieldName of requiredFields) {
        if (!fields[fieldName]) return error('At least one field is missing.');
    }
    
    if (fields.password !== fields.confirm) {
        return error('Input password does not match confirmed password.');
    }

    if (fields.role && fields.role !== 'V' && fields.role !== 'S') {
        return error('Invalid role.');
    }
    
    if (!captchaAns) {
        return error('Captcha expired from inactivity.');
    }
    if (captchaAns !== fields.captcha.toUpperCase()) {
        return error('Captcha answer is incorrect.');
    }

    db.get('SELECT * FROM Users WHERE username = ? OR email = ?', [fields.username, fields.email], async (err, user) => {
        if (err) return error('Something went wrong while trying to verify your email and username are unique.', 500);
        if (user) return error('Email or username already exists.');

        const hashedPassword = await bcrypt.hash(fields.password, 10);

        const status = fields.role === 'S' ? 'approved' : 'pending';

        db.run(
            `INSERT INTO Users (email, username, password, role, status) VALUES (?, ?, ?, ?, ?)`,
            [fields.email, fields.username, hashedPassword, fields.role || 'V', status],
            function (err) {
                if (err) {
                    return error('Something went wrong while trying to register you.');
                }

                res.render('redirect', {
                    message: status === 'approved' ? 'Superuser registered successfully.' : 'Registration successful.',
                    details: status === 'approved' ? 'You may login with your new credentials.' : 'You may login after an admin approves your registration.',
                    redirectUrl: '/'
                });
            }
        );
    });
});

router.post('/login', (req, res) => {
    const { username, password } = req.body;
    const error = (msg, code = 400) => res.status(code).render('login', { error: msg });


    if (!username || !password) {
        return error('Username and password are required.');
    }

    db.get('SELECT * FROM Users WHERE username = ?', [username], async (err, user) => {
        if (err) return error('Something went wrong while trying to find your account.', 500);
        if (!user) return error('Invalid username or password.');

        switch (user.status) {
            case 'pending': return error('Account is pending approval.');
            case 'rejected': return error('Account has been rejected.');
            case 'suspended': return error('Account has been suspended.');
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return error('Invalid username or password.');

        req.session.user = { id: user.id, username: user.username, role: user.role };

        if (user.role === 'S') {
            return res.redirect('/superuser/superuser_dashboard');
        } else {
            return res.redirect('/');
        }
    });
});

router.get('/register', (req, res) => {
    res.render('register', {fields: {}, captchaId: generateCaptcha()});
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


function generateCaptcha() {
    const captchaId = Math.random().toString().slice(2);
    const captchaText = Math.floor(Math.random() * 36 ** 6).toString(36).toUpperCase().padStart(6, '0');
    activeCaptchas[captchaId] = captchaText;
    setTimeout(() => delete activeCaptchas[captchaId], CAPTCHA_EXPIRE);
    return captchaId;
}