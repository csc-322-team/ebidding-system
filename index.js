const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const port = 3000;

// Database connection
const db = new sqlite3.Database('./src/database/database.sqlite', (err) => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        console.log('Connected to SQLite database');
    }
});

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', './src/views');  // Tell Express where to find templates

// Basic route
app.get('/', (req, res) => {
    res.render('index', {
        title: 'Project Home',
        message: 'Welcome to our group project!'
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
