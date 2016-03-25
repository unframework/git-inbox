var moment = require('moment');
var request = require('request');
var Promise = require('bluebird');

function expectedString(v) {
    if (typeof v !== 'string') {
        throw new Error('expected string');
    }

    return v;
}

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

function submitGitHubPull(gitUrl, baseName, branchName, slackUserId) {
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

function Pusher(pushConfigYaml, gitUrl) {
    this._gitUrl = gitUrl;

    if (typeof pushConfigYaml !== 'object') {
        pushConfigYaml = {
            type: 'branch',
            branch: pushConfigYaml
        };
    }

    this._pushType = expectedString(pushConfigYaml.type);
    this._targetBranch = null;

    if (this._pushType === 'branch') {
        this._targetBranch = expectedString(pushConfigYaml.branch || 'master');
    } else if (this._pushType === 'github-request') {
        this._targetBranch = expectedString(pushConfigYaml.base || 'master');
    } else {
        throw new Error('expected branch push type');
    }
}

Pusher.prototype.getTargetBranch = function () {
    return this._targetBranch;
};

Pusher.prototype.getIsPushGHR = function () {
    return this._pushType === 'github-request';
};

Pusher.prototype.push = function (userId, performPush, reportPR, reportCommit) {
    var tempBranchName = ('git-inbox-' + userId + '-' + moment().format('YYYY-MM-DD-HH-mm-ss')).toLowerCase();

    return this._pushType === 'github-request'
        ? performPush(tempBranchName).then(function (res) {
            return submitGitHubPull(this._gitUrl, this._targetBranch, tempBranchName, userId).then(function (resultUrl) {
                return reportPR(resultUrl);
            });
        }.bind(this))
        : performPush(this._targetBranch).then(function () {
            return reportCommit(this._targetBranch);
        }.bind(this));
};

module.exports = Pusher;
