const express = require('express');
const db = require('../database');
const router = express.Router();
const { promoteToVIP, evaluateVIPStatus } = require('../helpers/vip');

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

    db.get(
        `SELECT is_vip, status, role, suspension_count FROM Users WHERE id = ?`,
        [userId],
        (err, user) => {
            if (err || !user) {
                return res.status(500).json({ message: 'Error retrieving user details.' });
            }

            let query, params;

            if (action === 'suspended') {
                if (user.is_vip) {
                    query = `UPDATE Users SET is_vip = 0, role = 'U' WHERE id = ?`;
                    params = [userId];
                } else {
                    const fineAmount = 50;
                    const updatedCount = (user.suspension_count || 0) + 1;
                    query = `
                        UPDATE Users 
                        SET status = 'suspended', 
                            suspension_fine_due = suspension_fine_due + ?, 
                            suspension_count = ? 
                        WHERE id = ?`;
                    params = [fineAmount, updatedCount, userId];
                }
            } else if (action === 'approved') {
                query = `UPDATE Users SET status = ?, role = ? WHERE id = ?`;
                params = ['approved', 'U', userId];
            } else if (action === 'rejected') {
                query = `UPDATE Users SET status = ?, role = NULL WHERE id = ?`;
                params = ['rejected', userId];
            } else {
                return res.status(400).json({ message: 'Invalid action.' });
            }

            db.run(query, params, function (err) {
                if (err) {
                    return res.status(500).json({ message: 'Error updating user status.' });
                }

                const actionMessage = action === 'suspended' && user.is_vip
                    ? 'demoted from VIP to regular user'
                    : action;
                console.log(`User ${userId} ${actionMessage}.`);
                res.redirect('/superuser/superuser_dashboard');
            });
        }
    );
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

            db.all(
                `SELECT id, username, status, suspension_fine_due, suspension_count 
                 FROM Users 
                 WHERE status = 'suspended'`,
                [],
                (err, suspended) => {
                    if (err) {
                        return res.status(500).send('Error retrieving suspended users.');
                    }

                    db.all(
                        `SELECT q.id, u.username, u.email 
                         FROM QuitRequests q 
                         JOIN Users u ON q.user_id = u.id 
                         WHERE q.status = 'pending'`,
                        [],
                        (err, requests) => {
                            if (err) {
                                return res.status(500).send('Error retrieving quit requests.');
                            }

                            res.render('superuser_dashboard', {
                                username: req.session.user.username,
                                pending,
                                approved,
                                suspended,
                                requests: requests || []
                            });
                        }
                    );
                }
            );
        });
    });
});

router.get('/complaints', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'S') {
        return res.feedback('/', 'You do not have access to this page', true);
    }

    db.all(
        `SELECT c.*, u1.username as complainant, u2.username as target_user, i.name as item_name
         FROM Complaints c
         JOIN Users u1 ON c.complainant_id = u1.id
         JOIN Users u2 ON c.target_id = u2.id
         JOIN Transactions t ON c.transaction_id = t.id
         JOIN Items i ON t.item_id = i.id
         ORDER BY c.created_at DESC`,
        [],
        (err, complaints) => {
            if (err) {
                return res.status(500).send('Error retrieving complaints.');
            }
            res.render('superuser_complaint', { complaints });
        }
    );
});

router.post('/complaints/:id/resolve', (req, res) => {
    const complaintId = req.params.id;

    db.run(
        `UPDATE Complaints SET status = 'resolved' WHERE id = ?`,
        [complaintId],
        function (err) {
            if (err) {
                return res.status(500).send('Error resolving complaint.');
            }
            res.redirect('/superuser/complaints');
        }
    );
});

router.get('/quit-requests', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'S') {
        return res.status(403).send('Access denied.');
    }

    db.all(`SELECT q.id, q.status, u.username, u.email
            FROM QuitRequests q
            JOIN Users u ON q.user_id = u.id
            WHERE q.status = 'pending'`, [], (err, quitRequests) => {
        if (err) {
            return res.status(500).send('Error retrieving quit requests.');
        }
        res.render('redirect', { quitRequests });
    });
});

router.post('/quit-requests/:id/approve', (req, res) => {
    const requestId = req.params.id;

    db.get(`SELECT user_id FROM QuitRequests WHERE id = ?`, [requestId], (err, request) => {
        if (err || !request) {
            return res.feedback('/superuser/superuser_dashboard', 'Quit request not found or could not be processed.', true);
        }

        const userId = request.user_id;

        db.run(
            `DELETE FROM Users WHERE id = ?`,
            [userId],
            function (err) {
                if (err) {
                    return res.feedback('/superuser/superuser_dashboard', 'Error deleting user.', true);
                }

                db.run(
                    `UPDATE QuitRequests SET status = 'approved' WHERE id = ?`,
                    [requestId],
                    function (err) {
                        if (err) {
                            return res.feedback('/superuser/superuser_dashboard', 'Error updating quit request.', true);
                        }
                        res.feedback('/superuser/superuser_dashboard', 'Quit request approved successfully.');
                    }
                );
            }
        );
    });
});

router.post('/quit-requests/:id/reject', (req, res) => {
    const requestId = req.params.id;

    db.run(
        `UPDATE QuitRequests SET status = 'rejected' WHERE id = ?`,
        [requestId],
        function (err) {
            if (err) {
                return res.feedback('/superuser/superuser_dashboard', 'Error rejecting quit request.', true);
            }
            res.feedback('/superuser/superuser_dashboard', 'Quit request rejected successfully.');
        }
    );
});

router.post('/reinstate', superuser, (req, res) => {
    const { username } = req.body;

    db.get(
        `SELECT id, status, suspension_fine_due FROM Users WHERE username = ?`,
        [username],
        (err, user) => {
            if (err || !user || user.status !== 'suspended') {
                return res.feedback('/superuser/superuser_dashboard', 'Suspended user not found.', true);
            }

            db.run(
                `UPDATE Users SET status = 'approved', suspension_fine_due = 0 WHERE id = ?`,
                [user.id],
                function (err) {
                    if (err) {
                        return res.feedback('/superuser/superuser_dashboard', 'Error reinstating user.', true);
                    }
                    res.feedback('/superuser/superuser_dashboard', `User ${username} reinstated successfully.`);
                }
            );
        }
    );
});

router.post('/make-vip', superuser, (req, res) => {
    const { userId } = req.body;

    db.get(
        `SELECT u.id, u.username, COUNT(t.id) as transaction_count, u.balance, 
                (SELECT COUNT(c.id) FROM Complaints c WHERE c.target_id = u.id AND c.status = 'open') as open_complaints
         FROM Users u
         LEFT JOIN Transactions t ON u.id = t.buyer_id OR u.id = t.seller_id
         WHERE u.id = ? AND u.role = 'U'
         GROUP BY u.id`,
        [userId],
        (err, user) => {
            if (err || !user) {
                return res.status(404).json({ message: 'User not found or error fetching details.' });
            }

            if (
                user.balance > 5000 &&
                user.transaction_count > 5 &&
                user.open_complaints === 0
            ) {
                promoteToVIP(user.id);
                return res.json({ message: `User ${user.username} has been successfully promoted to VIP.` });
            } else {
                return res.status(400).json({ message: 'User does not meet VIP requirements.' });
            }
        }
    );
});

router.post('/evaluate-vip-status', superuser, (req, res) => {
    try {
        evaluateVIPStatus();

        db.all(`SELECT id, username, status FROM Users WHERE status = 'pending'`, [], (err, pending) => {
            if (err) {
                return res.status(500).send('Error retrieving pending users.');
            }

            db.all(`SELECT id, username, status FROM Users WHERE status = 'approved'`, [], (err, approved) => {
                if (err) {
                    return res.status(500).send('Error retrieving approved users.');
                }

                db.all(
                    `SELECT id, username, status, suspension_fine_due, suspension_count 
                     FROM Users 
                     WHERE status = 'suspended'`,
                    [],
                    (err, suspended) => {
                        if (err) {
                            return res.status(500).send('Error retrieving suspended users.');
                        }

                        db.all(
                            `SELECT q.id, u.username, u.email 
                             FROM QuitRequests q 
                             JOIN Users u ON q.user_id = u.id 
                             WHERE q.status = 'pending'`,
                            [],
                            (err, requests) => {
                                if (err) {
                                    return res.status(500).send('Error retrieving quit requests.');
                                }

                                res.render('superuser_dashboard', {
                                    username: req.session.user.username,
                                    pending,
                                    approved,
                                    suspended,
                                    requests: requests || []
                                });
                            }
                        );
                    }
                );
            });
        });
    } catch (err) {
        console.error('Error triggering VIP evaluation:', err.message);
        res.status(500).send('Error evaluating VIP status.');
    }
});

router.post('/evaluate-suspensions', superuser, (req, res) => {
    try {
        evaluateSuspensions();
        res.feedback('/superuser/superuser_dashboard', 'Suspensions evaluated successfully.');
    } catch (err) {
        console.error('Error evaluating suspensions:', err.message);
        res.render('/superuser/superuser_dashboard', 'Failed to evaluate suspensions.', true);
    }
});

module.exports = router;
