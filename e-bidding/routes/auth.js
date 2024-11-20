const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../database');
const router = express.Router();

router.post('/register', async (req, res) => {
    const { username, password, role } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required.' });
    }

    if (role && role !== 'V' && role !== 'S') {
        return res.status(400).json({ message: 'Invalid role.' });
    }

    db.get('SELECT * FROM Users WHERE username = ?', [username], async (err, user) => {
        if (err) return res.status(500).json({ message: 'Database error.' });
        if (user) return res.status(400).json({ message: 'Username already exists.' });

        const hashedPassword = await bcrypt.hash(password, 10);

        const status = role === 'S' ? 'approved' : 'pending';

        db.run(
            `INSERT INTO Users (username, password, role, status) VALUES (?, ?, ?, ?)`,
            [username, hashedPassword, role || 'V', status],
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
    res.render('register');
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

module.exports = router;