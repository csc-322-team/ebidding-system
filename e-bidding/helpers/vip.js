const db = require('../database');

function evaluateVIPStatus() {
    db.all(
        `SELECT u.id, u.username, COUNT(t.id) as transaction_count, u.balance, 
                u.is_vip, u.status, -- include is_vip and status fields
                (SELECT COUNT(c.id) FROM Complaints c WHERE c.target_id = u.id AND c.status = 'open') as open_complaints
         FROM Users u
         LEFT JOIN Transactions t ON u.id = t.buyer_id OR u.id = t.seller_id
         WHERE u.role = 'U'
         GROUP BY u.id`,
        (err, users) => {
            if (err) {
                console.error('Error evaluating VIP status:', err.message);
                return;
            }

            users.forEach(user => {
                console.log(`Evaluating user ${user.username} (ID: ${user.id})`);
                console.log(`Balance: ${user.balance}, Transactions: ${user.transaction_count}, Open Complaints: ${user.open_complaints}`);

                if (
                    user.balance > 5000 &&
                    user.transaction_count > 5 &&
                    user.open_complaints === 0
                ) {
                    promoteToVIP(user.id);
                } else if (user.is_vip) {
                    if (user.status === 'suspended') {
                        demoteVIP(user.id, 'Demoted due to suspension.');
                    } else {
                        demoteVIP(user.id, 'Failed to meet VIP conditions.');
                    }
                }
            });
        }
    );
}
function promoteToVIP(userId) {
    db.run(
        `UPDATE Users 
         SET is_vip = 1
         WHERE id = ?`,
        [userId],
        (err) => {
            if (err) {
                console.error(`Error promoting user ${userId} to VIP:`, err.message);
            } else {
                console.log(`User ${userId} promoted to VIP.`);
            }
        }
    );
}

function demoteVIP(userId, reason) {
    db.run(
        `UPDATE Users 
         SET is_vip = 0, status = 'approved' -- ensure they are no longer suspended and become a regular user
         WHERE id = ?`,
        [userId],
        (err) => {
            if (err) {
                console.error(`Error demoting user ${userId}:`, err.message);
            } else {
                console.log(`User ${userId} demoted from VIP. Reason: ${reason}`);
            }
        }
    );
}

module.exports = { evaluateVIPStatus, promoteToVIP,  demoteVIP };