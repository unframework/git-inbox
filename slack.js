var Slack = require('slack-client');

var slackAuthToken = process.env.SLACK_AUTH_TOKEN || '';

var slackClient = new Slack.RtmClient(slackAuthToken);

slackClient.on(Slack.CLIENT_EVENTS.RTM.AUTHENTICATED, function () {
    console.log('started slack client');
});

slackClient.start();

slackClient.on(Slack.RTM_EVENTS.FILE_SHARED, function (e) {
    console.log('created file', e);
});

