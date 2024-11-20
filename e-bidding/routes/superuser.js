const express = require('express');
const db = require('../database');
const router = express.Router();

function superuser(req, res, next) {
    if (!req.session.user || req.session.user.role !== 'S') {
        return res.status(403).send('Access denied.');
    }
    next();
}

router.post('/update-status', superuser, (req, res) => {
    const { userId, action } = req.body;

    if (!userId || !['approved', 'rejected', 'suspended'].includes(action)) {
        return res.status(400).json({ message: 'Invalid request.' });
    }

    let query = `UPDATE Users SET status = ?, role = ? WHERE id = ?`;
    let params = action === 'approved' ? ['approved', 'U', userId] : [action, null, userId];

    db.run(query, params, function (err) {
        if (err) {
            return res.status(500).json({ message: 'Error updating user status.' });
        }

        const action_message =
            action === 'suspended'
                ? 'suspended'
                : action === 'approved'
                ? 'approved and converted to user'
                : 'rejected';
        res.redirect('/superuser/superuser_dashboard');
    });
});

router.get('/superuser_dashboard', superuser, (req, res) => {
    db.all(`SELECT id, username, status FROM Users WHERE status = 'pending'`, [], (err, pending) => {
        if (err) {
            return res.status(500).send('Error retrieving pending users.');
        }

        db.all(`SELECT id, username, status FROM Users WHERE status = 'approved'`, [], (err, approved) => {
            if (err) {
                return res.status(500).send('Error retrieving approved users.');
            }

            res.render('superuser_dashboard', {
                username: req.session.user.username,
                pending,
                approved
            });
        });
    });
});

module.exports = router;