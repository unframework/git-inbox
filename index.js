var fs = require('fs');
var XLSX = require('xlsx');
var yaml = require('js-yaml');
var git = require('nodegit');
var moment = require('moment');

var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

var gitUrl = process.env.TARGET_GIT_URL || '';

var sourceFilePath = __dirname + '/example.xlsx';

var workbook = XLSX.readFile(sourceFilePath);

var firstSheetName = workbook.SheetNames[0];
var firstSheet = workbook.Sheets[firstSheetName];

var keys = Object.keys(firstSheet);

var match = /^([A-Z])([0-9]+):([A-Z])([0-9]+)$/.exec(firstSheet['!ref']);

var firstCharCode = match[1].charCodeAt(0);
var lastCharCode = match[3].charCodeAt(0);
var propCodeList = LETTERS.filter(function (letter) {
    var letterCode = letter.charCodeAt(0);
    return letterCode >= firstCharCode && letterCode <= lastCharCode;
});
var keyPropCode = propCodeList.shift();

var firstItemIndex = parseInt(match[2], 10);
var lastItemIndex = parseInt(match[4], 10);

function getCellAsString(cellCoord) {
    var cell = firstSheet[cellCoord];

    return cell
        ? (Object.prototype.hasOwnProperty.call(cell, 'w')
            ? cell.w
            : (cell.XF ? XLSX.SSF.format(cell.XF.ifmt || 0, cell.v) : cell.v)
        )
        : null;
}

function iterateItems(cb) {
    var index = firstItemIndex;

    while (index <= lastItemIndex) {
        var key = getCellAsString(keyPropCode + index.toString());
        var item = Object.create(null);

        propCodeList.forEach(function (code) {
            item[code] = getCellAsString(code + index.toString());
        });

        if (key !== null) {
            cb(key, item);
        }

        index += 1;
    }
}

var itemMap = Object.create(null);
var keyHeader = null;
var headerMap = null;

iterateItems(function (key, data) {
    if (headerMap === null) {
        keyHeader = key;
        headerMap = Object.create(null);

        Object.keys(data).forEach(function (headerCode) {
            var label = data[headerCode];

            if (label === null) {
                return;
            }

            if (Object.prototype.hasOwnProperty.call(headerMap, headerCode)) {
                throw new Error('duplicate property name'); // @todo handle as e.g. sub-list?
            }

            headerMap[label] = headerCode;
        });

        return;
    }

    if (Object.prototype.hasOwnProperty.call(itemMap, key)) {
        throw new Error('duplicate key');
    }

    var item = Object.create(null);

    Object.keys(headerMap).forEach(function (label) {
        var value = data[headerMap[label]];

        if (value !== null) {
            item[label] = value;
        }
    });

    itemMap[key] = item;
});

var yamlData = yaml.safeDump(itemMap, { indent: 4 });

var workspaceDirPath = __dirname + '/.repo-workspace/' + moment().format('YYYY-MM-DD-HH-mm-ss');
var yamlRepoPath = 'example.yml';
var sourceCopyRepoPath = 'example.xlsx';

var remoteCallbacks = new git.RemoteCallbacks(); // empty for now, but injecting into places for consistency

function createIndexEntry(repo, repoPath, dataBuffer) {
    var oid = git.Blob.createFromBuffer(repo, dataBuffer, dataBuffer.length);

    var indexEntry = new git.IndexEntry();
    indexEntry.path = repoPath;
    indexEntry.flags = 0; // explicit init avoids unpredictable behaviour: https://github.com/nodegit/nodegit/issues/816
    indexEntry.uid = 0;
    indexEntry.gid = 0;
    indexEntry.ino = 0;
    indexEntry.dev = 0;
    indexEntry.id = oid;
    indexEntry.mode = git.TreeEntry.FILEMODE.BLOB;

    return indexEntry;
}

var fetchOptions = new git.FetchOptions();
fetchOptions.prune = 1;
fetchOptions.callbacks = remoteCallbacks;

var cloneOptions = new git.CloneOptions();
cloneOptions.bare = 1;
cloneOptions.checkoutBranch = 'master';
cloneOptions.fetchOpts = fetchOptions;

git.Clone(gitUrl, workspaceDirPath, cloneOptions).then(function (repo) {
    console.log('done!');

    function loadHeadCommit() {
        console.log('getting the master HEAD');
        return git.Reference.nameToId(repo, 'HEAD').then(function (head) { return repo.getCommit(head); });
    }

    // stage changes
    // @todo check diff? what if we add dynamic header comment though
    return repo.openIndex().then(function (index) {
        console.log('adding updated files');

        return loadHeadCommit().then(function (headCommit) { return headCommit.getTree(); }).then(function (headCommitTree) {
            index.readTree(headCommitTree);
            index.read(); // @todo does this do anything?

            index.add(createIndexEntry(repo, yamlRepoPath, new Buffer(yamlData)));
            index.add(createIndexEntry(repo, sourceCopyRepoPath, fs.readFileSync(sourceFilePath)));

            index.write();

            return index.writeTree();
        }).then(function (indexOid) {
            return loadHeadCommit().then(function (headCommit) {
                var commitTimestamp = moment().unix();
                var author = git.Signature.create('git-inbox', 'git-inbox@example.com', commitTimestamp, 0);
                var committer = git.Signature.create('git-inbox', 'git-inbox@example.com', commitTimestamp, 0);

                return repo.createCommit(
                    'HEAD',
                    author,
                    committer,
                    'Imported XLSX data',
                    indexOid,
                    [ headCommit ]
                );
            });
        });
    }).then(function (commit) {
        console.log('committed files', commit.allocfmt());

        return repo.getRemote('origin').then(function (remote) {
            var pushOptions = new git.PushOptions();
            pushOptions.callbacks = remoteCallbacks;

            return remote.push(['refs/heads/master:refs/heads/master'], pushOptions);
        });
    });
}).then(function () {
    console.log('pushed');
}, function (err) {
    console.log('error', err, err.stack);
});
