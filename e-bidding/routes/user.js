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
                balance: user.balance,
                error: req.query.error,
                success: req.query.success
            });
        });
    });
});


router.post('/deposit', authenticated, (req, res) => {
    const userId = req.session.user.id;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
        return res.redirect('/user/dashboard?error=Invalid deposit amount');
    }

    db.run(`UPDATE Users SET balance = balance + ? WHERE id = ?`, [amount, userId], function (err) {
        if (err) {
            return res.redirect('/user/dashboard?error=Error processing deposit');
        }
        res.redirect('/user/dashboard?success=Deposit successful');
    });
});


router.post('/withdraw', authenticated, (req, res) => {
    const userId = req.session.user.id;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
        return res.redirect('/user/dashboard?error=Invalid withdrawal amount');
    }

    db.get(`SELECT balance FROM Users WHERE id = ?`, [userId], (err, user) => {
        if (err) {
            return res.redirect('/user/dashboard?error=Error retrieving balance');
        }

        if (user.balance < amount) {
            return res.redirect('/user/dashboard?error=Insufficient balance');
        }

        db.run(`UPDATE Users SET balance = balance - ? WHERE id = ?`, [amount, userId], function (err) {
            if (err) {
                return res.redirect('/user/dashboard?error=Error processing withdrawal');
            }
            res.redirect('/user/dashboard?success=Withdrawal successful');
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

router.post('/:itemId/accept', (req, res) => {
    const itemId = req.params.itemId;
    const bidId = req.body.bidId;
    const userId = req.session.user.id;

    db.get('SELECT owner_id FROM Items WHERE id = ?', [itemId])
        .then(item => {
            if (!item) throw new Error('Item not found');
            if (item.owner_id !== userId) throw new Error('You are not authorized to accept bids for this item');

            return acceptBid(itemId, bidId);
        })
        .then(() => {
            res.redirect(`/items/${itemId}`);
        }) 
        .catch(err => {
            res.status(500).send('Error accepting bid: ' + err.message);
        });
});


function acceptBid(itemId, bidId) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            let bidData, itemData, bidderBalance;

            db.get('SELECT * FROM Bids WHERE id = ?', [bidId])
                .then(bid => {
                    if (!bid) throw new Error('Bid not found');
                    bidData = bid;
                    return db.get('SELECT * FROM Items WHERE id = ?', [itemId]);
                })
                .then(item => {
                    if (!item) throw new Error('Item not found');
                    itemData = item;
                    return db.get('SELECT balance FROM Users WHERE id = ?', [bidData.bidder_id]);
                })
                .then(user => {
                    if (!user) throw new Error('Bidder not found');
                    bidderBalance = user.balance;
                    if (bidderBalance < bidData.bid_amount) {
                        throw new Error('Insufficient balance');
                    }
                    return db.run('UPDATE Items SET status = ?, current_price = ? WHERE id = ?', ['closed', bidData.bid_amount, itemId]);
                })
                .then(() => {
                    return db.run('INSERT INTO Transactions (item_id, buyer_id, seller_id, amount) VALUES (?, ?, ?, ?)',
                        [itemId, bidData.bidder_id, itemData.owner_id, bidData.bid_amount]);
                })
                .then(() => {
                    return db.run('UPDATE Users SET balance = balance - ? WHERE id = ?', [bidData.bid_amount, bidData.bidder_id]);
                })
                .then(() => {
                    return db.run('UPDATE Users SET balance = balance + ? WHERE id = ?', [bidData.bid_amount, itemData.owner_id]);
                })
                .then(() => {
                    db.run('COMMIT', (err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                })
                .catch(err => {
                    db.run('ROLLBACK');
                    reject(err);
                });
        });
    });
}

module.exports = router;