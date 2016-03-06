var Promise = require('bluebird');
var Slack = require('slack-client');
var request = require('request');
var yaml = require('js-yaml');

var parseXLSX = require('./lib/parseXLSX');
var Repo = require('./lib/Repo');

var slackAuthToken = process.env.SLACK_AUTH_TOKEN || '';
var gitUrl = process.env.TARGET_GIT_URL || '';

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

    var downloadedLength = null;
    var parsedItemCount = null;
    var commitHash = null;

    getSlackFile(file).then(function (sourceFileBuffer) {
        downloadedLength = sourceFileBuffer.length;

        console.log('got data', downloadedLength);

        var itemMap = parseXLSX(sourceFileBuffer);
        parsedItemCount = Object.keys(itemMap).length;

        console.log('parsed item count', parsedItemCount);

        var yamlData = yaml.safeDump(itemMap, { indent: 4 });

        var fileMap = {};
        fileMap['example.yml'] = new Buffer(yamlData);
        fileMap['example.xlsx'] = sourceFileBuffer;

        var repo = new Repo(gitUrl);

        return repo.commitFiles(fileMap).then(function (commit) {
            commitHash = commit.allocfmt();
            console.log('committed files', commitHash);

            return repo.push();
        });
    }).then(function () {
        console.log('successfully processed slack upload', file.name);

        slackClient.sendMessage('processed file: ' + escapeSlackText(file.name) + ' (' + downloadedLength + ' bytes, ' + parsedItemCount + ' items, commit hash ' + commitHash + ')', channelId);
    }, function (err) {
        console.error('error processing slack upload', file.name, err);

        slackClient.sendMessage('error processing file: ' + escapeSlackText(file.name), channelId);
    });
});
