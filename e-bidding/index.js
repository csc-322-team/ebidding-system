const express = require('express');
const db = require('./database');
const bodyParser = require('body-parser');
const auth_routes = require('./routes/auth');
const user_routes = require('./routes/user');
const superuser_routes = require('./routes/superuser');
const items_routes = require('./routes/items');
const support_routes = require('./routes/support');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const { evaluateSuspensions } = require('./helpers/suspension');
const { evaluateVIPStatus } = require('./helpers/vip');

const app = express();
const PORT = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(expressLayouts);

app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

app.set('view engine', 'ejs');
app.set('layout', 'layout');

// Initialize res.feedback as a helper for displaying messages to the user globally.
// The message expires after the redirect is complete.
app.use((req, res, next) => {
    res.locals.feedback = req.session.feedback;
    delete req.session.feedback;
    res.feedback = (url, message, isError = false) => {
        req.session.feedback = {message, isError};
        res.redirect(url);
    }
    next();
});

app.get('/', (req, res) => {
    res.render('home', { message: 'Welcome to the E-Bidding System!' });
});

app.use('/auth', auth_routes);
app.use('/user', user_routes);
app.use('/superuser', superuser_routes);
app.use('/items', items_routes);
app.use('/support', support_routes);

evaluateVIPStatus();
evaluateSuspensions();

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});