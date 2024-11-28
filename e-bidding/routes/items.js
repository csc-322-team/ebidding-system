const express = require('express');
const { authenticate_token } = require('../middleware/middleware_auth');
const db = require('../database');
const router = express.Router();
const fs = require('fs');
const multer = require('multer');
const path = require('path');

const uploadsDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({ storage });

router.get('/list', (req, res) => {
    db.all(`SELECT * FROM Items WHERE status = 'active' ORDER BY created_at DESC`, [], (err, rows) => {
        if (err) {
            return res.render('redirect', {
                message: 'Database Error',
                details: 'Unable to retrieve items at this time',
                redirectUrl: '/'
            });
        }
        res.render('items', { items: rows });
    });
});

router.get('/my-items', authenticate_token, (req, res) => {
    const userId = req.user.id;

    db.all(`SELECT * FROM Items WHERE owner_id = ?`, [userId], (err, rows) => {
        if (err) {
            return res.render('redirect', {
                message: 'Database Error',
                details: 'Unable to retrieve your items',
                redirectUrl: '/user/dashboard'
            });
        }
        res.json(rows);
    });
});

router.get('/add', (req, res) => {
    if (!req.session.user) {
        return res.render('redirect', {
            message: 'Authentication Required',
            details: 'Please login to add items',
            redirectUrl: '/auth/login'
        });
    }
    res.render('add');
});

router.post('/add', upload.single('image'), (req, res) => {
    if (!req.session.user) {
        return res.render('redirect', {
            message: 'Authentication Required',
            details: 'Please login to add items',
            redirectUrl: '/auth/login'
        });
    }

    const { name, description, starting_price, type, deadline_date } = req.body;
    const owner_id = req.session.user.id;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    if (!name || !starting_price || !type || !deadline_date) {
        return res.render('redirect', {
            message: 'Invalid Input',
            details: 'All required fields must be filled',
            redirectUrl: '/items/add'
        });
    }

    const selected_date = new Date(deadline_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (selected_date < today) {
        return res.render('redirect', {
            message: 'Invalid Date',
            details: 'Deadline cannot be set to a past date',
            redirectUrl: '/items/add'
        });
    }

    const deadline_day = selected_date.toLocaleDateString('en-US');

    const created_at = new Date().toISOString();

    db.run(
        `INSERT INTO Items (owner_id, name, description, starting_price, current_price, image_url, type, deadline_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [owner_id, name, description, starting_price, starting_price, imageUrl, type, deadline_day, created_at],
        function (err) {
            if (err) {
                return res.render('redirect', {
                    message: 'Database Error',
                    details: 'Unable to add item at this time',
                    redirectUrl: '/items/add'
                });
            }
            res.render('redirect', {
                message: 'Success',
                details: 'Item has been added successfully',
                redirectUrl: '/items/list'
            });
        }
    );
});

router.get('/:id', (req, res) => {
    const itemId = req.params.id;
    const currentUserId = req.session.user ? req.session.user.id : null;

    db.get(`SELECT * FROM Items WHERE id = ?`, [itemId], (err, item) => {
        if (err || !item) {
            return res.render('redirect', {
                message: 'Item Not Found',
                details: 'The requested item could not be found',
                redirectUrl: '/items/list'
            });
        }

        // Check if current user is the purchaser
        db.get(
            `SELECT * FROM Transactions WHERE item_id = ? AND buyer_id = ?`,
            [itemId, currentUserId],
            (err, transaction) => {
                const isPurchaser = transaction ? true : false;

                // Get review if it exists
                db.get(
                    `SELECT Reviews.*, Users.username as reviewer_name
                     FROM Reviews
                     JOIN Users ON Reviews.reviewer_id = Users.id
                     WHERE Reviews.transaction_id IN
                        (SELECT id FROM Transactions WHERE item_id = ?)`,
                    [itemId],
                    (err, review) => {

                        // Get comments
                        db.all(`SELECT * FROM Comments WHERE item_id = ?`, [itemId], (err, comments) => {
                            if (err) {
                                return res.render('redirect', {
                                    message: 'Error Loading Comments',
                                    details: 'Unable to retrieve comments for this item',
                                    redirectUrl: '/items/list'
                                });
                            }

                            // Get bids
                            db.all(
                                `SELECT Bids.id, Bids.bid_amount, Users.username
                                 FROM Bids
                                 JOIN Users ON Bids.bidder_id = Users.id
                                 WHERE Bids.item_id = ?
                                 ORDER BY Bids.bid_amount DESC`,
                                [itemId],
                                (err, bids) => {
                                    if (err) {
                                        return res.render('redirect', {
                                            message: 'Error Loading Bids',
                                            details: 'Unable to retrieve bids for this item',
                                            redirectUrl: '/items/list'
                                        });
                                    }

                                    res.render('item_details', {
                                        item,
                                        comments,
                                        bids,
                                        user: req.session.user || null,
                                        error: null,
                                        isPurchaser: isPurchaser,
                                        review: review || null
                                    });
                                }
                            );
                        });
                    }
                );
            }
        );
    });
});

router.post('/:id/bid', (req, res) => {
    if (!req.session.user) {
        return res.render('redirect', {
            message: 'Authentication Required',
            details: 'You must be logged in to place a bid',
            redirectUrl: '/auth/login'
        });
    }

    const itemId = req.params.id;
    const bidderId = req.session.user.id;
    const { bidAmount } = req.body;

    if (!bidAmount || bidAmount <= 0) {
        return res.redirect(`/items/${itemId}?error=Invalid bid amount.`);
    }

    db.get(`SELECT * FROM Items WHERE id = ? AND status = 'active'`, [itemId], (err, item) => {
        if (err || !item) {
            return res.render('redirect', {
                message: 'Item Unavailable',
                details: 'Item not found or no longer active',
                redirectUrl: '/items/list'
            });
        }

        if (parseFloat(bidAmount) < parseFloat(item.starting_price)) {
            return res.redirect(`/items/${itemId}?error=Bid amount must be at least the starting price.`);
        }

        db.get(`SELECT balance FROM Users WHERE id = ?`, [bidderId], (err, user) => {
            if (err) {
                return res.render('redirect', {
                    message: 'System Error',
                    details: 'Unable to verify account balance',
                    redirectUrl: `/items/${itemId}`
                });
            }

            if (user.balance < bidAmount) {
                return res.redirect(`/items/${itemId}?error=Insufficient balance.`);
            }

            db.run(
                `INSERT INTO Bids (item_id, bidder_id, bid_amount, deadline)
                 VALUES (?, ?, ?, datetime('now', '+7 days'))`,
                [itemId, bidderId, bidAmount],
                function (err) {
                    if (err) {
                        return res.render('redirect', {
                            message: 'Bid Failed',
                            details: 'Unable to place bid at this time',
                            redirectUrl: `/items/${itemId}`
                        });
                    }
                    res.render('redirect', {
                        message: 'Bid Placed',
                        details: 'Your bid has been successfully recorded',
                        redirectUrl: `/items/${itemId}`
                    });
                }
            );
        });
    });
});

router.post('/:id/comment', (req, res) => {
    const itemId = req.params.id;
    const { content } = req.body;
    const author = req.session.user ? req.session.user.username : 'Guest';

    if (!content) {
        return res.render('redirect', {
            message: 'Invalid Comment',
            details: 'Comment cannot be empty',
            redirectUrl: `/items/${itemId}`
        });
    }

    db.run(
        `INSERT INTO Comments (item_id, author, content) VALUES (?, ?, ?)`,
        [itemId, author, content],
        function (err) {
            if (err) {
                return res.render('redirect', {
                    message: 'Comment Failed',
                    details: 'Unable to add comment at this time',
                    redirectUrl: `/items/${itemId}`
                });
            }
            res.redirect(`/items/${itemId}`);
        }
    );
});


router.post('/:id/accept-bid', (req, res) => {
    if (!req.session.user) {
        return res.render('redirect', {
            message: 'Authentication Required',
            details: 'Please login to accept bids',
            redirectUrl: '/auth/login'
        });
    }

    const itemId = req.params.id;
    const bidId = req.body.bid_id;
    const sellerId = req.session.user.id;

    // Verify seller owns the item
    db.get('SELECT * FROM Items WHERE id = ?', [itemId], (err, item) => {
        if (err || !item) {
            return res.render('redirect', {
                message: 'Item Not Found',
                details: 'The requested item could not be found',
                redirectUrl: '/user/dashboard'
            });
        }

        if (item.owner_id !== sellerId) {
            return res.render('redirect', {
                message: 'Not Authorized',
                details: 'You are not authorized to accept bids for this item',
                redirectUrl: `/items/${itemId}`
            });
        }

        if (item.status !== 'active') {
            return res.render('redirect', {
                message: 'Item Not Active',
                details: 'This item is no longer active for bidding',
                redirectUrl: `/items/${itemId}`
            });
        }

        // Get bid details and verify buyer's balance
        db.get('SELECT Bids.*, Users.balance FROM Bids JOIN Users ON Bids.bidder_id = Users.id WHERE Bids.id = ?',
            [bidId], (err, bid) => {
                if (err || !bid) {
                    return res.render('redirect', {
                        message: 'Bid Not Found',
                        details: 'The selected bid could not be found',
                        redirectUrl: `/items/${itemId}`
                    });
                }

                if (bid.balance < bid.bid_amount) {
                    return res.render('redirect', {
                        message: 'Insufficient Funds',
                        details: 'Buyer has insufficient funds to complete the transaction',
                        redirectUrl: `/items/${itemId}`
                    });
                }

                // Process the transaction
                db.serialize(() => {
                    db.run('BEGIN TRANSACTION');

                    const updates = [
                        ['UPDATE Items SET status = ? WHERE id = ?', ['closed', itemId]],
                        ['UPDATE Users SET balance = balance - ? WHERE id = ?', [bid.bid_amount, bid.bidder_id]],
                        ['UPDATE Users SET balance = balance + ? WHERE id = ?', [bid.bid_amount, sellerId]],
                        ['INSERT INTO Transactions (item_id, buyer_id, seller_id, amount) VALUES (?, ?, ?, ?)',
                            [itemId, bid.bidder_id, sellerId, bid.bid_amount]]
                    ];

                    let completed = 0;
                    updates.forEach(([query, params]) => {
                        db.run(query, params, (err) => {
                            if (err) {
                                db.run('ROLLBACK');
                                return res.render('redirect', {
                                    message: 'Transaction Failed',
                                    details: 'Unable to complete the transaction',
                                    redirectUrl: `/items/${itemId}`
                                });
                            }
                            completed++;
                            if (completed === updates.length) {
                                db.run('COMMIT', (err) => {
                                    if (err) {
                                        db.run('ROLLBACK');
                                        return res.render('redirect', {
                                            message: 'Transaction Failed',
                                            details: 'Failed to commit transaction',
                                            redirectUrl: `/items/${itemId}`
                                        });
                                    }
                                    res.render('redirect', {
                                        message: 'Bid Accepted',
                                        details: 'Transaction completed successfully',
                                        redirectUrl: '/user/dashboard'
                                    });
                                });
                            }
                        });
                    });
                });
            });
    });
});

router.post('/:id/review', (req, res) => {
    if (!req.session.user) {
        return res.render('redirect', {
            message: 'Authentication Required',
            details: 'Please login to leave a review',
            redirectUrl: '/auth/login'
        });
    }

    const itemId = req.params.id;
    const reviewerId = req.session.user.id;
    const { rating, description } = req.body;

    // Validate inputs
    if (!rating || !description) {
        return res.redirect(`/items/${itemId}?error=Both rating and description are required`);
    }

    if (rating < 1 || rating > 5) {
        return res.redirect(`/items/${itemId}?error=Rating must be between 1 and 5`);
    }

    // Verify transaction exists and user is the buyer
    db.get(
        `SELECT t.*, i.owner_id
         FROM Transactions t
         JOIN Items i ON t.item_id = i.id
         WHERE t.item_id = ? AND t.buyer_id = ?`,
        [itemId, reviewerId],
        (err, transaction) => {
            if (err || !transaction) {
                return res.render('redirect', {
                    message: 'Not Authorized',
                    details: 'You can only review items you have purchased',
                    redirectUrl: `/items/${itemId}`
                });
            }

            // Check for existing review
            db.get(
                `SELECT id FROM Reviews
                 WHERE transaction_id = ? AND reviewer_id = ?`,
                [transaction.id, reviewerId],
                (err, existingReview) => {
                    if (existingReview) {
                        // Update existing review
                        db.run(
                            `UPDATE Reviews
                             SET rating = ?, description = ?
                             WHERE transaction_id = ? AND reviewer_id = ?`,
                            [rating, description, transaction.id, reviewerId],
                            (err) => {
                                if (err) {
                                    return res.render('redirect', {
                                        message: 'Review Update Failed',
                                        details: 'Unable to update review at this time',
                                        redirectUrl: `/items/${itemId}`
                                    });
                                }
                                res.render('redirect', {
                                    message: 'Review Updated',
                                    details: 'Your review has been updated',
                                    redirectUrl: `/items/${itemId}`
                                });
                            }
                        );
                    } else {
                        // Insert new review
                        db.run(
                            `INSERT INTO Reviews (transaction_id, reviewer_id, recipient_id, rating, description)
                             VALUES (?, ?, ?, ?, ?)`,
                            [transaction.id, reviewerId, transaction.owner_id, rating, description],
                            function(err) {
                                if (err) {
                                    return res.render('redirect', {
                                        message: 'Review Failed',
                                        details: 'Unable to submit review at this time',
                                        redirectUrl: `/items/${itemId}`
                                    });
                                }
                                res.render('redirect', {
                                    message: 'Review Submitted',
                                    details: 'Your review has been recorded',
                                    redirectUrl: `/items/${itemId}`
                                });
                            }
                        );
                    }
                }
            );
        }
    );
});

module.exports = router;