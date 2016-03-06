var Promise = require('bluebird');
var Slack = require('slack-client');
var request = require('request');

var slackAuthToken = process.env.SLACK_AUTH_TOKEN || '';

function getSlackFile(file) {
    return new Promise(function (resolve, reject) {
        var fileUrl = file.url_private_download;

        console.log('file request', fileUrl);

        request.get({
            url: fileUrl,
            auth: { bearer: slackAuthToken },
            encoding: null // ensure binary response
        }, function (err, resp, body) {
            console.log('file response', fileUrl);

            if (err) {
                reject(err);
                return;
            }

            resolve(body);
        });
    });
}

function escapeSlackText(text) {
    return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&/g, '&amp;');
}

var slackClient = new Slack.RtmClient(slackAuthToken);

slackClient.on(Slack.CLIENT_EVENTS.RTM.AUTHENTICATED, function () {
    console.log('started slack client');
});

slackClient.start();

slackClient.on(Slack.RTM_EVENTS.MESSAGE, function (e) {
    // ignore anything but file shares
    if (e.subtype !== 'file_share') {
        return;
    }

    var channelId = e.channel;
    var file = e.file;

    // ignore anything but channel messages
    if (!channelId) {
        return;
    }

    console.log('shared file', file.id, file.name, channelId);

    getSlackFile(file).then(function (body) {
        console.log('got data', body.length);
    }).then(function () {
        console.log('successfully processed slack upload', file.name);

        slackClient.sendMessage('processed file: ' + escapeSlackText(file.name), channelId);
    }, function (err) {
        console.error('error processing slack upload', file.name, err);

        slackClient.sendMessage('error processing file: ' + escapeSlackText(file.name), channelId);
    });
});
