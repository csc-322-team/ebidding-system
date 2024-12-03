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

        db.all(
            `SELECT t.*, i.name as item_name, i.description
             FROM Transactions t
             JOIN Items i ON t.item_id = i.id
             WHERE t.buyer_id = ?
             ORDER BY t.date DESC`,
            [userId],
            (err, purchases) => {
                if (err) {
                    return res.status(500).send('Error retrieving purchases.');
                }

                db.all(
                    `SELECT * FROM BalanceHistory
                     WHERE user_id = ?
                     ORDER BY date DESC
                     LIMIT 10`,
                    [userId],
                    (err, balanceHistory) => {
                        if (err) {
                            return res.status(500).send('Error retrieving balance history.');
                        }

                        db.get(
                            `SELECT AVG(rating) as avg_rating FROM Reviews WHERE recipient_id = ?`,
                            [userId],
                            (err, ratingResult) => {
                                if (err) {
                                    return res.status(500).send('Error retrieving overall rating.');
                                }

                                const overallRating = ratingResult?.avg_rating || 0;

                                db.all(
                                    `SELECT r.*, u.username AS from_user
                                     FROM Reviews r
                                     JOIN Users u ON r.reviewer_id = u.id
                                     WHERE r.recipient_id = ?`,
                                    [userId],
                                    (err, receivedRatings) => {
                                        if (err) {
                                            return res.status(500).send('Error retrieving received ratings.');
                                        }

                                        db.all(
                                            `SELECT r.*, u.username AS to_user
                                             FROM Reviews r
                                             JOIN Users u ON r.recipient_id = u.id
                                             WHERE r.reviewer_id = ?`,
                                            [userId],
                                            (err, givenRatings) => {
                                                if (err) {
                                                    return res.status(500).send('Error retrieving given ratings.');
                                                }

                                                db.get(
                                                    `SELECT balance, is_vip FROM Users WHERE id = ?`,
                                                    [userId],
                                                    (err, user) => {
                                                        if (err) {
                                                            return res.status(500).send('Error retrieving user details.');
                                                        }
                                                
                                                        // Check if the user has a pending quit request
                                                        db.get(
                                                            `SELECT * FROM QuitRequests WHERE user_id = ? AND status = 'pending'`,
                                                            [userId],
                                                            (err, quitRequest) => {
                                                                if (err) {
                                                                    return res.status(500).send('Error retrieving quit request status.');
                                                                }
                                                
                                                                res.render('user_dashboard', {
                                                                    username: req.session.user.username,
                                                                    is_vip: user.is_vip, // Include this in the template data
                                                                    items,
                                                                    purchases,
                                                                    balance: user.balance,
                                                                    balanceHistory,
                                                                    receivedRatings,
                                                                    givenRatings,
                                                                    rating: overallRating,
                                                                    quitRequestPending: !!quitRequest,
                                                                    error: req.query.error,
                                                                    success: req.query.success
                                                                });
                                                            }
                                                        );
                                                    }
                                                );
                                            }
                                        );
                                    }
                                );
                            }
                        );
                    }
                );
            }
        );
    });
});

router.post('/deposit', authenticated, (req, res) => {
    const userId = req.session.user.id;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
        return res.redirect('/user/dashboard?error=Invalid deposit amount');
    }

    db.serialize(() => {
        db.run(`UPDATE Users SET balance = balance + ? WHERE id = ?`, [amount, userId], function (err) {
            if (err) {
                return res.redirect('/user/dashboard?error=Error processing deposit');
            }

            db.run(`INSERT INTO BalanceHistory (user_id, amount, type) VALUES (?, ?, 'deposit')`,
                [userId, amount], function(err) {
                if (err) {
                    return res.redirect('/user/dashboard?error=Error recording transaction');
                }
                res.redirect('/user/dashboard?success=Deposit successful');
            });
        });
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

        db.serialize(() => {
            db.run(`UPDATE Users SET balance = balance - ? WHERE id = ?`, [amount, userId], function (err) {
                if (err) {
                    return res.redirect('/user/dashboard?error=Error processing withdrawal');
                }

                db.run(`INSERT INTO BalanceHistory (user_id, amount, type) VALUES (?, ?, 'withdraw')`,
                    [userId, amount], function(err) {
                    if (err) {
                        return res.redirect('/user/dashboard?error=Error recording transaction');
                    }
                    res.redirect('/user/dashboard?success=Withdrawal successful');
                });
            });
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

            db.get('SELECT * FROM Bids WHERE id = ?', [bidId], (err, bid) => {
                if (err || !bid) {
                    db.run('ROLLBACK');
                    return reject(new Error('Bid not found'));
                }
                bidData = bid;

                db.get('SELECT * FROM Items WHERE id = ?', [itemId], (err, item) => {
                    if (err || !item) {
                        db.run('ROLLBACK');
                        return reject(new Error('Item not found'));
                    }
                    itemData = item;

                    db.get('SELECT balance FROM Users WHERE id = ?', [bidData.bidder_id], (err, user) => {
                        if (err || !user) {
                            db.run('ROLLBACK');
                            return reject(new Error('Bidder not found'));
                        }
                        bidderBalance = user.balance;

                        if (bidderBalance < bidData.bid_amount) {
                            db.run('ROLLBACK');
                            return reject(new Error('Insufficient balance'));
                        }

                        db.run('UPDATE Items SET status = ?, current_price = ? WHERE id = ?', ['closed', bidData.bid_amount, itemId], (err) => {
                            if (err) {
                                db.run('ROLLBACK');
                                return reject(new Error('Error updating item status'));
                            }

                            db.run('INSERT INTO Transactions (item_id, buyer_id, seller_id, amount) VALUES (?, ?, ?, ?)',
                                [itemId, bidData.bidder_id, itemData.owner_id, bidData.bid_amount], (err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    return reject(new Error('Error creating transaction'));
                                }

                                db.run('UPDATE Users SET balance = balance - ? WHERE id = ?', [bidData.bid_amount, bidData.bidder_id], (err) => {
                                    if (err) {
                                        db.run('ROLLBACK');
                                        return reject(new Error('Error deducting bidder balance'));
                                    }

                                    db.run('UPDATE Users SET balance = balance + ? WHERE id = ?', [bidData.bid_amount, itemData.owner_id], (err) => {
                                        if (err) {
                                            db.run('ROLLBACK');
                                            return reject(new Error('Error crediting seller balance'));
                                        }

                                        db.run('COMMIT', (err) => {
                                            if (err) {
                                                db.run('ROLLBACK');
                                                return reject(new Error('Error committing transaction'));
                                            }
                                            resolve();
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}

router.post('/apply-quit', authenticated, (req, res) => {
    const userId = req.session.user.id;

    db.get(
        `SELECT * FROM QuitRequests WHERE user_id = ? AND status = 'pending'`,
        [userId],
        (err, quitRequest) => {
            if (err) {
                return res.redirect('/user/dashboard?error=Error checking quit request status.');
            }

            if (quitRequest) {
                return res.redirect('/user/dashboard?error=You have already submitted a quit request.');
            }

            db.run(
                `INSERT INTO QuitRequests (user_id, status) VALUES (?, 'pending')`,
                [userId],
                function (err) {
                    if (err) {
                        return res.redirect('/user/dashboard?error=Unable to apply for account deletion.');
                    }

                    req.session.success = 'Your request to quit the system has been submitted.';
                    res.redirect('/user/dashboard');
                }
            );
        }
    );
});

module.exports = router;