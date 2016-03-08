var fs = require('fs');
var path = require('path');
var Promise = require('bluebird');
var Slack = require('slack-client');
var request = require('request');
var yaml = require('js-yaml');
var moment = require('moment');
var Minimatch = require('minimatch').Minimatch;

var parseXLSX = require('./lib/parseXLSX');
var Repo = require('./lib/Repo');

var slackAuthToken = process.env.SLACK_AUTH_TOKEN || '';
var gitUrl = process.env.TARGET_GIT_URL || '';

var configYaml = yaml.safeLoad(fs.readFileSync(__dirname + '/config.yml'));

var pushConfigYaml = configYaml.push || null

if (typeof pushConfigYaml !== 'object') {
    pushConfigYaml = {
        type: 'branch',
        branch: pushConfigYaml
    };
}

var pushType = expectedString(pushConfigYaml.type);

var branchNameGenerator = null;
var ghPullBase = null;
if (pushType === 'branch') {
    branchNameGenerator = function (userId) {
        return expectedString(pushConfigYaml.branch || 'master');
    };
} else if (pushType === 'github-request') {
    ghPullBase = expectedString(pushConfigYaml.base || 'master');
    branchNameGenerator = function (userId) {
        return ('git-inbox-' + userId + '-' + moment().format('YYYY-MM-DD-HH-mm-ss')).toLowerCase();
    };
} else {
    throw new Error('expected branch push type');
}

var slackConfigYaml = configYaml.slack || [];

function expectedString(v) {
    if (typeof v !== 'string') {
        throw new Error('expected string');
    }

    return v;
}

function createPrefixMatcher(baseName) {
    return function (fileName) {
        return fileName.slice(0, baseName.length) === baseName;
    };
}

function createGlobMatcher(globPattern) {
    // globs with no funny business
    var mm = new Minimatch(globPattern, {
        noext: true,
        nocase: true,
        nocomment: true,
        nonegate: true
    });

    return function (fileName) {
        return mm.match(fileName);
    };
}

function createYamlFormatter(targetPath) {
    console.log('formatting as YAML:', targetPath);

    // parse as a sheet
    return function (sourceFileBuffer, fileMap) {
        var itemMap = parseXLSX(sourceFileBuffer);

        var yamlData = yaml.safeDump(itemMap, { indent: 4 });
        var yamlDataBuffer = new Buffer(yamlData);

        fileMap[targetPath] = yamlDataBuffer;
    };
}

function createCopyFormatter(targetPath) {
    console.log('formatting as copy:', targetPath);

    // simple file copy
    return function (sourceFileBuffer, fileMap) {
        fileMap[targetPath] = sourceFileBuffer;
    };
}

function autodetectFormatter(targetPath) {
    var ext = path.extname(targetPath).toLowerCase();

    console.log('auto-detect by extension', ext);

    if (ext === '.yml' || ext === '.yaml') {
        return createYamlFormatter(targetPath);
    }

    return createCopyFormatter(targetPath);
}

function chooseFormatter(format, targetPath) {
    if (format === 'yaml') {
        return createYamlFormatter(targetPath);
    } else if (format === 'copy') {
        return createCopyFormatter(targetPath);
    }

    throw new Error('unknown format: ' + format);
}

var slackMatcherList = slackConfigYaml.map(function (matcherConfigYaml) {
    // simple strings are meant to define target path
    if (typeof matcherConfigYaml !== 'object') {
        matcherConfigYaml = {
            in: null,
            out: expectedString(matcherConfigYaml)
        };
    }

    // simple strings are treated as path with auto-detect format
    var outConfigYaml = matcherConfigYaml.out || null;

    if (typeof outConfigYaml !== 'object') {
        outConfigYaml = {
            format: null,
            path: outConfigYaml
        };
    }

    var targetPath = expectedString(outConfigYaml.path);

    // detect the format if needed
    var formatter = outConfigYaml.format === null
        ? autodetectFormatter(targetPath)
        : chooseFormatter(outConfigYaml.format, targetPath);

    // input is either a glob pattern or by default matches exact basename of target path minus extension
    var inConfigYaml = matcherConfigYaml.in || null;
    var matchExec = inConfigYaml === null
        ? createPrefixMatcher(path.basename(targetPath, path.extname(targetPath)))
        : createGlobMatcher(expectedString(inConfigYaml));

    return function (fileName) {
        return matchExec(fileName) ? formatter : null;
    };
});

if (slackMatcherList.length < 1) {
    throw new Error('set up at least one Slack upload match pattern');
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

function submitGitHubPull(branchName, slackUserId) {
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
                base: ghPullBase
            }
        }, function (err, resp, body) {
            if (err || resp.statusCode !== 201) {
                reject(err || body);
                return;
            }

            console.log('GitHub PR creation response', resp.statusCode, body);

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
    var targetFormatterList = slackMatcherList.map(function (matcher) {
        return matcher(file.name);
    }).filter(function (formatter) { return formatter !== null; });

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

            var branchName = branchNameGenerator(e.user);
            var pushResult = repo.push(branchName);

            return pushType === 'github-request'
                ? pushResult.then(function () { return submitGitHubPull(branchName, e.user); })
                : pushResult
        });
    }).then(function (resultUrl) {
        console.log('successfully processed slack upload', file.name, resultUrl || '[no result url]');

        slackClient.sendMessage('processed file: ' + escapeSlackText(file.name) + ' (' + downloadedLength + ' bytes, ' + (resultUrl ? escapeSlackText(resultUrl) : 'commit hash ' + commitHash) + ')', channelId);
    }, function (err) {
        console.error('error processing slack upload', file.name, err);

        slackClient.sendMessage('error processing file: ' + escapeSlackText(file.name), channelId);
    });
});
