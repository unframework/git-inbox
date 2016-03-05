var express = require('express');
var bodyParser = require('body-parser');
var request = require('request');

var slackAuthToken = process.env.SLACK_AUTH_TOKEN || '';
var slackHookToken = process.env.SLACK_HOOK_TOKEN || '';
var configuredPort = process.env.PORT || 3010;

var FILE_TIMESTAMP_MARGIN = 3; // how many seconds into the past to look before message timestamp for its files

var app = express();

app.get('/', function (req, res) { res.send(''); }); // for looky-loos

app.post('/', bodyParser.urlencoded({ extended: true }), function (req, res) {
    if (req.body.token !== slackHookToken) {
        res.status(403);
        res.send(''); // nothing to do
        return;
    }

    if (req.body.bot_id) {
        res.send(''); // nothing to do
        return;
    }

    var channelId = req.body.channel_id;
    var timestampFloor = Math.floor(req.body.timestamp);

    res.send({ text: 'thanks, received!' });

    function trySearch(count) {
        if (count > 20) {
            console.log('giving up');
            return;
        }

        setTimeout(function () {
            console.log(
                'searching', {
                    "token": slackAuthToken,
                    "channel": channelId,
                    ts_from: timestampFloor - FILE_TIMESTAMP_MARGIN,
                    ts_to: timestampFloor + FILE_TIMESTAMP_MARGIN
                }
            );

            request.post({
                url: 'https://slack.com/api/files.list',
                json: true,
                qs: {
                    "token": slackAuthToken,
                    "channel": channelId,
                    ts_from: timestampFloor - FILE_TIMESTAMP_MARGIN,
                    ts_to: timestampFloor
                },
            }, function(err, resp, body) {
                if (!body || !body.ok) {
                    console.error('slack err:', err, body);
                    return;
                }

                console.log('slack files:', body.files);

                if (body.files.length < 1) {
                    trySearch(count + 1);
                }
            });
        }, 5000);
    }

    trySearch(0);
});

app.listen(configuredPort);
