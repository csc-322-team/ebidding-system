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
                    if (err) return error('Something went wrong while trying to register you.');
                    const message = status === 'approved' ? 'Superuser registered successfully. You may login with your new credentials.'
                        : 'Registration successful. You may login after an admin approves your registration.';
                    res.feedback('/', message);
                }
            );
        });
    });

    router.post('/login', (req, res) => {
        const { username, password } = req.body;
        const error = msg => res.feedback('/auth/login', msg, true);

        if (!username || !password) {
            return error('Username and password are required.');
        }

        db.get('SELECT * FROM Users WHERE username = ?', [username], async (err, user) => {
            if (err) return error('Something went wrong while trying to find your account.', 500);
            if (!user) return error('Invalid username or password.');

            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) return error('Invalid username or password.');

            switch (user.status) {
                case 'pending': return error('Account is pending approval.');
                case 'rejected': return error('Account has been rejected.');
                case 'suspended': {
                    return res.render('pay_fine', {
                        message: 'Your account is suspended. Please pay the fine to reinstate your account.',
                        username: user.username,
                        fineDue: user.suspension_fine_due,
                        error: null
                    });
                }
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

    function generateCaptcha() {
        const captchaId = Math.random().toString().slice(2);
        const captchaText = Math.floor(Math.random() * 36 ** 6).toString(36).toUpperCase().padStart(6, '0');
        activeCaptchas[captchaId] = captchaText;
        setTimeout(() => delete activeCaptchas[captchaId], CAPTCHA_EXPIRE);
        return captchaId;
    }

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

    router.post('/pay_fine', (req, res) => {
        const { username, paymentAmount } = req.body;
        console.log('Pay Fine Request:', { username, paymentAmount });
    
        const error = (msg, user, code = 400) => {
            console.log('Error:', msg);
            return res.status(code).render('pay_fine', {
                error: msg,
                username,
                fineDue: user ? user.suspension_fine_due : 0,
                message: 'Your account is suspended. Please pay the fine to reinstate your account.'
            });
        };
    
        if (!username || !paymentAmount) {
            return error('Username and payment amount are required.', null);
        }
    
        const paymentAmountNum = parseFloat(paymentAmount);
        if (isNaN(paymentAmountNum) || paymentAmountNum <= 0) {
            return error('Invalid payment amount.', null);
        }
    
        db.get('SELECT * FROM Users WHERE username = ?', [username], (err, user) => {
            if (err) {
                console.error('Database Error:', err);
                return error('User not found.', null, 500);
            }
            if (!user) {
                return error('User not found.', null);
            }
    
            if (paymentAmountNum < user.suspension_fine_due) {
                return error('The payment amount is insufficient.', user);
            }
    
            const newBalance = user.balance - paymentAmountNum;
    
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
    
                db.run('UPDATE Users SET balance = ?, suspension_fine_due = 0, status = ? WHERE username = ?', 
                       [newBalance, 'approved', username], function (err) {
                    if (err) {
                        console.error('Update Error:', err);
                        db.run('ROLLBACK');
                        return error('Something went wrong while updating your account.', user, 500);
                    }
    
                    db.run('INSERT INTO BalanceHistory (user_id, amount, type) VALUES (?, ?, ?)', 
                           [user.id, -paymentAmountNum, 'withdraw'], function(err) {
                        if (err) {
                            console.error('Insert Error:', err);
                            db.run('ROLLBACK');
                            return error('Error recording transaction.', user, 500);
                        }
    
                        db.run('COMMIT', (err) => {
                            if (err) {
                                console.error('Commit Error:', err);
                                return error('Error finalizing transaction.', user, 500);
                            }
    
                            console.log('Payment successful, redirecting to login');
                            res.redirect('/auth/login');
                        });
                    });
                });
            });
        });
    });

    module.exports = router;