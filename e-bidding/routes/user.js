const express = require('express');
const db = require('../database');
const router = express.Router();

function authenticated(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }
    next();
}

router.get('/dashboard', authenticated, (req, res) => {
    const userId = req.session.user.id;

    db.all(`SELECT * FROM Items WHERE owner_id = ?`, [userId], (err, items) => {
        if (err) {
            return res.status(500).send('Error retrieving items.');
        }

        db.get(`SELECT balance FROM Users WHERE id = ?`, [userId], (err, user) => {
            if (err) {
                return res.status(500).send('Error retrieving balance.');
            }

            res.render('user_dashboard', {
                username: req.session.user.username,
                items,
                balance: user.balance
            });
        });
    });
});

router.post('/deposit', authenticated, (req, res) => {
    const userId = req.session.user.id;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
        return res.status(400).send('Invalid deposit amount.');
    }

    db.run(`UPDATE Users SET balance = balance + ? WHERE id = ?`, [amount, userId], function (err) {
        if (err) {
            return res.status(500).send('Error processing deposit.');
        }
        res.redirect('/user/dashboard');
    });
});

router.post('/withdraw', authenticated, (req, res) => {
    const userId = req.session.user.id;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
        return res.status(400).send('Invalid withdrawal amount.');
    }

    db.get(`SELECT balance FROM Users WHERE id = ?`, [userId], (err, user) => {
        if (err) {
            return res.status(500).send('Error retrieving balance.');
        }

        if (user.balance < amount) {
            return res.status(400).send('Insufficient balance.');
        }

        db.run(`UPDATE Users SET balance = balance - ? WHERE id = ?`, [amount, userId], function (err) {
            if (err) {
                return res.status(500).send('Error processing withdrawal.');
            }
            res.redirect('/user/dashboard');
        });
    });
});

router.get('/item/:id', authenticated, (req, res) => {
    const itemId = req.params.id;

    db.get(`SELECT * FROM Items WHERE id = ?`, [itemId], (err, item) => {
        if (err || !item) {
            return res.status(404).send('Item not found.');
        }

        db.all(`SELECT * FROM Comments WHERE item_id = ?`, [itemId], (err, comments) => {
            if (err) {
                return res.status(500).send('Error retrieving comments.');
            }

            res.render('item_details', {
                item,
                comments,
                username: req.session.user.username
            });
        });
    });
});

module.exports = router;