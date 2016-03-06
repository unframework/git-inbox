var fs = require('fs');
var git = require('nodegit');
var moment = require('moment');

var yamlRepoPath = 'example.yml';
var sourceCopyRepoPath = 'example.xlsx';

var remoteCallbacks = new git.RemoteCallbacks(); // empty for now, but injecting into places for consistency

var fetchOptions = new git.FetchOptions();
fetchOptions.prune = 1;
fetchOptions.callbacks = remoteCallbacks;

var cloneOptions = new git.CloneOptions();
cloneOptions.bare = 1;
cloneOptions.checkoutBranch = 'master';
cloneOptions.fetchOpts = fetchOptions;

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

function loadHeadCommit(repo) {
    return git.Reference.nameToId(repo, 'HEAD').then(function (head) { return repo.getCommit(head); });
}

function Repo(gitUrl) {
    var workspaceDirPath = __dirname + '/../.repo-workspace/' + moment().format('YYYY-MM-DD-HH-mm-ss');

    this._whenCloned = git.Clone(gitUrl, workspaceDirPath, cloneOptions);
}

Repo.prototype.commitFile = function (yamlBuffer, sourceFileBuffer) {
    return this._whenCloned.then(function (repo) {
        return repo.openIndex().then(function (index) {
            console.log('adding updated files');

            var whenHeadCommitLoaded = loadHeadCommit(repo);

            return whenHeadCommitLoaded.then(function (headCommit) { return headCommit.getTree(); }).then(function (headCommitTree) {
                index.readTree(headCommitTree);
                index.read(); // @todo does this do anything?

                index.add(createIndexEntry(repo, yamlRepoPath, yamlBuffer));
                index.add(createIndexEntry(repo, sourceCopyRepoPath, sourceFileBuffer));

                index.write();

                return index.writeTree();
            }).then(function (indexOid) {
                return whenHeadCommitLoaded.then(function (headCommit) {
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
        });
    });
};

Repo.prototype.push = function () {
    return this._whenCloned.then(function (repo) {
        return repo.getRemote('origin').then(function (remote) {
            var pushOptions = new git.PushOptions();
            pushOptions.callbacks = remoteCallbacks;

            return remote.push(['refs/heads/master:refs/heads/master'], pushOptions);
        });
    });
};

module.exports = Repo;
