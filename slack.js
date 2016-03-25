var fs = require('fs');
var Promise = require('bluebird');
var Slack = require('slack-client');
var request = require('request');

var Repo = require('./lib/Repo');
var Processor = require('./lib/Processor');

var slackAuthToken = process.env.SLACK_AUTH_TOKEN || '';
var gitUrl = process.env.TARGET_GIT_URL || '';

var processor = new Processor(fs.readFileSync(__dirname + '/config.yml'));

function getGitHubPullCreationUrl(repoUrl) {
    var match = /([^\/]+)\/([^\/]+?)(\.git)?$/.exec(repoUrl);
    if (!match) {
        throw new Error('not a recognizable GitHub repo URL');
    }

    var owner = match[1];
    var repo = match[2];

    return 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/pulls';
}

function getGitHubAuthToken(repoUrl) {
    var match = /:([^:]+)@github.com\//.exec(repoUrl);
    if (!match) {
        throw new Error('not a recognizable GitHub repo URL');
    }

    return match[1];
}

function submitGitHubPull(baseName, branchName, slackUserId) {
    var url = getGitHubPullCreationUrl(gitUrl);
    var authToken = getGitHubAuthToken(gitUrl);

    return new Promise(function (resolve, reject) {
        console.log('GitHub PR creation post', url);

        request.post({
            url: url,
            auth: { bearer: authToken },
            headers: {
                'User-Agent': 'git-inbox (unframework.com)'
            },
            json: true,
            body: {
                title: 'Incoming git-inbox upload by Slack user ' + slackUserId,
                head: branchName,
                base: baseName
            }
        }, function (err, resp, body) {
            if (err || resp.statusCode !== 201) {
                reject(err || body);
                return;
            }

            resolve(body.html_url);
        });
    });
}

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

    // match up against what we have
    var targetFormatterList = processor.getMatcherList(file.name);

    // no need to keep going
    if (targetFormatterList.length < 1) {
        console.log('no target paths matched, ignoring');
        return;
    }

    // @todo reconsider user IDs in commits?
    var commitMessage = [
        'Slack upload: ' + file.name,
        '',
        'File Slack ID: ' + file.id,
        'Sharer Slack ID: ' + e.user,
        'Uploader Slack ID: ' + file.user
    ].join("\n");

    var downloadedLength = null;
    var commitHash = null;

    getSlackFile(file).then(function (sourceFileBuffer) {
        downloadedLength = sourceFileBuffer.length;

        console.log('got data', downloadedLength);

        var fileMap = {};

        targetFormatterList.forEach(function (targetFormatter) {
            targetFormatter(sourceFileBuffer, fileMap);
        });

        var repo = new Repo(gitUrl);

        return repo.commitFiles(fileMap, commitMessage).then(function (commit) {
            commitHash = commit.allocfmt();
            console.log('committed files', commitHash);

            var branchName = processor.generateBranchName(e.user);
            var pushResult = repo.push(branchName);

            // @todo encapsulate this
            return processor.getIsPushGHR()
                ? pushResult.then(function () {
                    return submitGitHubPull(processor.getGHPullBase(), branchName, e.user).then(function (resultUrl) {
                        return 'GitHub pull request ' + escapeSlackText(resultUrl);
                    });
                })
                : pushResult.then(function () {
                    return 'commit hash _' + commitHash.slice(0, 7) + '_ on *' + branchName + '*';
                });
        }).then(function (resultSlackText) {
            // @todo also cleanup on error
            return repo.destroy().then(function () {
                return resultSlackText;
            });
        });
    }).then(function (resultSlackText) {
        console.log('successfully processed slack upload', file.name);

        // @todo markdown needs escaping
        slackClient.sendMessage([
            'Received',
            '*' + escapeSlackText(file.name) + '*',
            '(' + downloadedLength + ' bytes)',
            'posted by <@' + e.user + '>,',
            resultSlackText
        ].join(' '), channelId);
    }, function (err) {
        console.error('error processing slack upload', file.name, err);

        slackClient.sendMessage('Error processing *' + escapeSlackText(file.name) + '* posted by <@' + e.user + '>', channelId);
    });
});
