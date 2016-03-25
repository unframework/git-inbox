var fs = require('fs');
var git = require('nodegit');
var moment = require('moment');
var rimraf = require('rimraf');
var Promise = require('bluebird');

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
    this._workspaceDirPath = workspaceDirPath;
}

Repo.prototype._setupAction = function () {
    if (this._pendingAction) {
        throw new Error('pending action');
    }

    this._pendingAction = true;

    return { resolvedBy: function (pendingTarget) {
        pendingTarget.then(function () { this._pendingAction = false; }.bind(this));

        return pendingTarget; // pass-through for easy chaining
    }.bind(this) };
};

Repo.prototype.commitFiles = function (fileBufferMap, commitMessage) {
    return this._setupAction().resolvedBy(this._whenCloned.then(function (repo) {
        return repo.openIndex().then(function (index) {
            console.log('adding updated files');

            var whenHeadCommitLoaded = loadHeadCommit(repo);

            return whenHeadCommitLoaded.then(function (headCommit) { return headCommit.getTree(); }).then(function (headCommitTree) {
                index.readTree(headCommitTree);
                index.read(); // @todo does this do anything?

                Object.keys(fileBufferMap).forEach(function (path) {
                    index.add(createIndexEntry(repo, path, fileBufferMap[path]));
                });

                index.write();

                return index.writeTree();
            }).then(function (indexOid) {
                return whenHeadCommitLoaded.then(function (headCommit) {
                    var commitTimestamp = moment().unix();

                    // @todo use the original user ID? as e.g. git-inbox-slack-U12345@blah or something
                    var author = git.Signature.create('git-inbox', 'git-inbox@git-inbox.local', commitTimestamp, 0);
                    var committer = git.Signature.create('git-inbox', 'git-inbox@git-inbox.local', commitTimestamp, 0);

                    return repo.createCommit(
                        'HEAD',
                        author,
                        committer,
                        commitMessage,
                        indexOid,
                        [ headCommit ]
                    );
                });
            });
        });
    }));
};

Repo.prototype.push = function (branchName) {
    return this._setupAction().resolvedBy(this._whenCloned.then(function (repo) {
        return repo.getRemote('origin').then(function (remote) {
            var pushOptions = new git.PushOptions();
            pushOptions.callbacks = remoteCallbacks;

            return remote.push(['refs/heads/master:refs/heads/' + branchName], pushOptions);
        });
    }));
};

Repo.prototype.destroy = function () {
    return this._setupAction().resolvedBy(this._whenCloned.then(function (repo) {
        this._whenCloned = null; // prevent further actions

        repo.free(); // filehandle cleanup

        return new Promise(function (resolve, reject) {
            console.log('deleting everything in', this._workspaceDirPath);
            rimraf(this._workspaceDirPath, { disableGlob: true }, function (err) {
                if (err) {
                    reject(err);
                    return;
                }

                console.log('finished deleting', this._workspaceDirPath);
                resolve();
            }.bind(this));
        }.bind(this));
    }.bind(this)));
};

module.exports = Repo;
