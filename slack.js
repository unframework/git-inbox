var fs = require('fs');
var path = require('path');
var Promise = require('bluebird');
var Slack = require('slack-client');
var request = require('request');
var yaml = require('js-yaml');
var Minimatch = require('minimatch').Minimatch;

var parseXLSX = require('./lib/parseXLSX');
var Repo = require('./lib/Repo');

var slackAuthToken = process.env.SLACK_AUTH_TOKEN || '';
var gitUrl = process.env.TARGET_GIT_URL || '';

var configYaml = yaml.safeLoad(fs.readFileSync(__dirname + '/config.yml'));

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

var slackMatcherList = slackConfigYaml.map(function (matcherConfigYaml) {
    // simple strings are meant to define target path
    if (typeof matcherConfigYaml !== 'object') {
        matcherConfigYaml = {
            in: null,
            out: expectedString(matcherConfigYaml)
        };
    }

    // target path is just a string for now
    var outConfigYaml = matcherConfigYaml.out || null;
    var targetPath = expectedString(outConfigYaml);

    // input is either a glob pattern or by default matches exact basename of target path minus extension
    var inConfigYaml = matcherConfigYaml.in || null;
    var matchExec = inConfigYaml === null
        ? createPrefixMatcher(path.basename(targetPath, path.extname(targetPath)))
        : createGlobMatcher(expectedString(inConfigYaml));

    return function (fileName) {
        return matchExec(fileName) ? targetPath : null;
    };
});

if (slackMatcherList.length < 1) {
    throw new Error('set up at least one Slack upload match pattern');
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
    var targetPathList = slackMatcherList.map(function (matcher) {
        return matcher(file.name);
    }).filter(function (path) { return path !== null; });

    // no need to keep going
    if (targetPathList.length < 1) {
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
    var parsedItemCount = null;
    var commitHash = null;

    getSlackFile(file).then(function (sourceFileBuffer) {
        downloadedLength = sourceFileBuffer.length;

        console.log('got data', downloadedLength);

        var itemMap = parseXLSX(sourceFileBuffer);
        parsedItemCount = Object.keys(itemMap).length;

        console.log('parsed item count', parsedItemCount);

        var yamlData = yaml.safeDump(itemMap, { indent: 4 });
        var yamlDataBuffer = new Buffer(yamlData);

        var fileMap = {};

        targetPathList.forEach(function (targetPath) {
            fileMap[targetPath] = yamlDataBuffer;
        });

        var repo = new Repo(gitUrl);

        return repo.commitFiles(fileMap, commitMessage).then(function (commit) {
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
