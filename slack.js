var express = require('express');
var bodyParser = require('body-parser');

var configuredPort = process.env.PORT || 3010;

var app = express();

app.get('/', function (req, res) { res.send(''); }); // for looky-loos

app.post('/', bodyParser.urlencoded({ extended: true }), function (req, res) {
    if (req.body.bot_id) {
        res.send(''); // nothing to do
        return;
    }

    res.send({ text: 'thanks, received!' });
});

app.listen(configuredPort);
