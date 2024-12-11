const db = require('../database');

function evaluateSuspensions() {
    db.all(
        `SELECT u.id, u.username, COUNT(r.id) as rating_count, AVG(r.rating) as avg_rating, u.is_vip
         FROM Users u
         LEFT JOIN Reviews r ON u.id = r.reviewer_id
         WHERE u.role = 'U'
         GROUP BY u.id`,
        (err, users) => {
            if (err) {
                console.error('Error evaluating user suspensions:', err.message);
                return;
            }

            users.forEach(user => {
                if (user.is_vip) {
                    if (user.rating_count >= 3 && (user.avg_rating < 2 || user.avg_rating > 4)) {
                        demoteVIP(user.id, 'Low rating average or too high rating average');
                    }
                } else if (user.rating_count >= 3 && (user.avg_rating < 2 || user.avg_rating > 4)) {
                    suspendUser(user.id, `Average rating (${user.avg_rating.toFixed(1)}) is outside acceptable range.`);
                }
            });
        }
    );
}

function suspendUser(userId, reason) {
    db.serialize(() => {
        db.run(
            `UPDATE Users 
             SET status = 'suspended', suspension_count = suspension_count + 1, suspension_fine_due = suspension_fine_due + 50
             WHERE id = ?`,
            [userId],
            (err) => {
                if (err) {
                    console.error(`Error suspending user ${userId}:`, err.message);
                } else {
                    console.log(`User ${userId} suspended: ${reason}`);
                }
            }
        );

        db.get(`SELECT suspension_count FROM Users WHERE id = ?`, [userId], (err, user) => {
            if (err) {
                console.error('Error fetching suspension count:', err.message);
            } else if (user.suspension_count >= 3) {
                forceOutUser(userId);
            }
        });
    });
}

function forceOutUser(userId) {
    db.run(
        `DELETE FROM Users WHERE id = ?`,
        [userId],
        (err) => {
            if (err) {
                console.error(`Error forcing out user ${userId}:`, err.message);
            } else {
                console.log(`User ${userId} permanently removed from the system.`);
            }
        }
    );
}

function demoteVIP(userId, reason) {
    db.run(
        `UPDATE Users 
         SET is_vip = 0
         WHERE id = ?`,
        [userId],
        (err) => {
            if (err) {
                console.error(`Error demoting VIP ${userId}:`, err.message);
            } else {
                console.log(`VIP ${userId} demoted: ${reason}`);
            }
        }
    );
}

module.exports = { evaluateSuspensions, suspendUser, forceOutUser, demoteVIP };
