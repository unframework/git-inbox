function expectedString(v) {
    if (typeof v !== 'string') {
        throw new Error('expected string');
    }

    return v;
}

function Pusher(pushConfigYaml) {
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

module.exports = Pusher;
