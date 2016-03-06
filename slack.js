var Slack = require('slack-client');
var request = require('request');

var slackAuthToken = process.env.SLACK_AUTH_TOKEN || '';

var slackClient = new Slack.RtmClient(slackAuthToken);

slackClient.on(Slack.CLIENT_EVENTS.RTM.AUTHENTICATED, function () {
    console.log('started slack client');
});

slackClient.start();

slackClient.on(Slack.RTM_EVENTS.FILE_SHARED, function (e) {
    var file = e.file;

    console.log('created file', file.id, file.name);

    var fileUrl = file.url_private_download;

    console.log('file request', fileUrl);

    request.get({
        url: fileUrl,
        auth: { bearer: slackAuthToken },
        encoding: null // ensure binary response
    }, function (err, resp, body) {
        console.log('file response', err, Buffer.isBuffer(body), body.length);
    });
});

