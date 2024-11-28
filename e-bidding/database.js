const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./e-bidding.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
    }
});

db.serialize(() => {

    db.run(`
        CREATE TABLE IF NOT EXISTS Users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            role TEXT CHECK(role IN ('V', 'U', 'S')) DEFAULT 'V',
            balance REAL DEFAULT 0.0,
            rating REAL DEFAULT 0.0,
            suspension_count INTEGER DEFAULT 0,
            is_vip INTEGER DEFAULT 0
        );
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS Items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id INTEGER,
            name TEXT NOT NULL,
            description TEXT,
            starting_price REAL NOT NULL, -- New column for starting price
            current_price REAL NOT NULL, -- Holds the current highest bid
            image_url TEXT, -- New column for the image path
            type TEXT CHECK(type IN ('sale', 'rent')),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            deadline_date DATETIME,
            status TEXT CHECK(status IN ('active', 'closed')) DEFAULT 'active',
            FOREIGN KEY(owner_id) REFERENCES Users(id)
        );
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS Bids (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER,
            bidder_id INTEGER,
            bid_amount REAL NOT NULL,
            deadline DATETIME NOT NULL,
            FOREIGN KEY(item_id) REFERENCES Items(id),
            FOREIGN KEY(bidder_id) REFERENCES Users(id)
        );
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS Transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER,
            buyer_id INTEGER,
            seller_id INTEGER,
            amount REAL NOT NULL,
            date DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(item_id) REFERENCES Items(id),
            FOREIGN KEY(buyer_id) REFERENCES Users(id),
            FOREIGN KEY(seller_id) REFERENCES Users(id)
        );
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS Ratings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_user_id INTEGER,
            to_user_id INTEGER,
            score INTEGER CHECK(score BETWEEN 1 AND 5),
            transaction_id INTEGER,
            FOREIGN KEY(from_user_id) REFERENCES Users(id),
            FOREIGN KEY(to_user_id) REFERENCES Users(id),
            FOREIGN KEY(transaction_id) REFERENCES Transactions(id)
        );
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS Complaints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            complainant_id INTEGER,
            target_id INTEGER,
            description TEXT NOT NULL,
            status TEXT CHECK(status IN ('open', 'resolved')) DEFAULT 'open',
            FOREIGN KEY(complainant_id) REFERENCES Users(id),
            FOREIGN KEY(target_id) REFERENCES Users(id)
        );
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS Comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL,
            author TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(item_id) REFERENCES Items(id)
        );
    `);

    db.run(`
        ALTER TABLE Items 
        ADD COLUMN starting_price REAL NOT NULL DEFAULT 0
    `, (err) => {
        if (err && !err.message.includes("duplicate column")) {
            console.error("Error adding starting_price column:", err.message);
        }
    });
    
    db.run(`
        ALTER TABLE Items 
        ADD COLUMN current_price REAL NOT NULL DEFAULT 0
    `, (err) => {
        if (err && !err.message.includes("duplicate column")) {
            console.error("Error adding current_price column:", err.message);
        }
    });

    db.run(`
        CREATE TABLE IF NOT EXISTS BalanceHistory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            type TEXT CHECK(type IN ('deposit', 'withdraw')) NOT NULL,
            date DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES Users(id)
        );
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS Reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id INTEGER NOT NULL,
            reviewer_id INTEGER NOT NULL,
            recipient_id INTEGER NOT NULL,
            rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
            description TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(transaction_id) REFERENCES Transactions(id),
            FOREIGN KEY(reviewer_id) REFERENCES Users(id),
            FOREIGN KEY(recipient_id) REFERENCES Users(id)
        );
    `);
    
});

module.exports = db;