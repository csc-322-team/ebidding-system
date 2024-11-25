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
            return res.status(500).json({ message: 'Error retrieving items.' });
        }
        res.render('items', { items: rows });
    });
});

router.get('/my-items', authenticate_token, (req, res) => {
    const userId = req.user.id;

    db.all(`SELECT * FROM Items WHERE owner_id = ?`, [userId], (err, rows) => {
        if (err) {
            return res.status(500).json({ message: 'Error retrieving user items.' });
        }
        res.json(rows);
    });
});

router.get('/add', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }

    res.render('add');
});

router.post('/add', upload.single('image'), (req, res) => {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }

    const { name, description, starting_price, type, deadline_date } = req.body;
    const owner_id = req.session.user.id;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    if (!name || !starting_price || !type || !deadline_date) {
        return res.status(400).send('All required fields must be filled.');
    }

    const selected_date = new Date(deadline_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (selected_date < today) {
        return res.status(400).send('Deadline cannot be set to a past date.');
    }

    const deadline_day = selected_date.toLocaleDateString('en-US');

    const created_at = new Date().toISOString();

    db.run(
        `INSERT INTO Items (owner_id, name, description, starting_price, current_price, image_url, type, deadline_date, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [owner_id, name, description, starting_price, starting_price, imageUrl, type, deadline_day, created_at],
        function (err) {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).send('Error adding item.');
            }
            res.redirect('/items/list');
        }
    );
});

router.get('/:id', (req, res) => {
    const itemId = req.params.id;
    const error = req.query.error;

    db.get(`SELECT * FROM Items WHERE id = ?`, [itemId], (err, item) => {
        if (err || !item) {
            return res.status(404).send('Item not found.');
        }

        db.all(`SELECT * FROM Comments WHERE item_id = ?`, [itemId], (err, comments) => {
            if (err) {
                return res.status(500).send('Error retrieving comments.');
            }

            db.all(
                `SELECT Bids.id, Bids.bid_amount, Users.username FROM Bids 
                 JOIN Users ON Bids.bidder_id = Users.id 
                 WHERE Bids.item_id = ? ORDER BY Bids.bid_amount DESC`,
                [itemId],
                (err, bids) => {
                    if (err) {
                        return res.status(500).send('Error retrieving bids.');
                    }

                    res.render('item_details', {
                        item,
                        comments,
                        bids,
                        user: req.session.user || null,
                        error: error || null
                    });
                }
            );
        });
    });
});

router.post('/:id/bid', (req, res) => {
    if (!req.session.user) {
        return res.status(403).send('You must be logged in to place a bid.');
    }

    const itemId = req.params.id;
    const bidderId = req.session.user.id;
    const { bidAmount } = req.body;

    if (!bidAmount || bidAmount <= 0) {
        return res.redirect(`/items/${itemId}?error=Invalid bid amount.`);
    }

    db.get(`SELECT * FROM Items WHERE id = ? AND status = 'active'`, [itemId], (err, item) => {
        if (err || !item) {
            return res.redirect(`/items/${itemId}?error=Item not found or inactive.`);
        }
        
        // Check if below starting price
        if (parseFloat(bidAmount) < parseFloat(item.starting_price)) {
            return res.redirect(`/items/${itemId}?error=Bid amount must be at least the starting price.`);
        }

        db.get(`SELECT balance FROM Users WHERE id = ?`, [bidderId], (err, user) => {
            if (err) {
                return res.redirect(`/items/${itemId}?error=Error retrieving balance.`);
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
                        return res.status(500).send('Error placing bid.');
                    }
                    res.redirect(`/items/${itemId}`);
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
        return res.status(400).send('Comment cannot be empty.');
    }

    db.run(
        `INSERT INTO Comments (item_id, author, content) VALUES (?, ?, ?)`,
        [itemId, author, content],
        function (err) {
            if (err) {
                return res.status(500).send('Error adding comment.');
            }
            res.redirect(`/items/${itemId}`);
        }
    );
});


router.post('/:id/accept-bid', (req, res) => {
    console.log("Route hit: accept-bid", req.params.id, req.body.bid_id);
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }

    const itemId = req.params.id;
    const bidId = req.body.bid_id;
    const sellerId = req.session.user.id;

    // First verify seller owns the item
    db.get('SELECT * FROM Items WHERE id = ?', [itemId], (err, item) => {
        if (err || !item) {
            return res.status(404).send('Item not found');
        }
        if (item.owner_id !== sellerId) {
            return res.status(403).send('Not authorized');
        }
        if (item.status !== 'active') {
            return res.status(400).send('Item is not active');
        }

        // Get bid details and check buyer's balance
        db.get('SELECT Bids.*, Users.balance FROM Bids JOIN Users ON Bids.bidder_id = Users.id WHERE Bids.id = ?',
            [bidId], (err, bid) => {
            if (err || !bid) {
                return res.status(404).send('Bid not found');
            }
            if (bid.balance < bid.bid_amount) {
                return res.status(400).send('Buyer has insufficient funds');
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
                            return res.status(500).send('Transaction failed');
                        }
                        completed++;
                        if (completed === updates.length) {
                            db.run('COMMIT', (err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    return res.status(500).send('Failed to commit transaction');
                                }
                                res.render('success', {
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



module.exports = router;