var path = require('path');
var yaml = require('js-yaml');
var moment = require('moment');
var Promise = require('bluebird');
var Minimatch = require('minimatch').Minimatch;

var parseXLSX = require('./parseXLSX');

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

function Processor(slackConfigYaml, pushConfigYaml) {
    if (typeof pushConfigYaml !== 'object') {
        pushConfigYaml = {
            type: 'branch',
            branch: pushConfigYaml
        };
    }

    this._pushType = expectedString(pushConfigYaml.type);

    this._branchNameGenerator = null;
    this._ghPullBase = null;

    if (this._pushType === 'branch') {
        this._branchNameGenerator = function (userId) {
            return expectedString(pushConfigYaml.branch || 'master');
        };
    } else if (this._pushType === 'github-request') {
        this._ghPullBase = expectedString(pushConfigYaml.base || 'master');
        this._branchNameGenerator = function (userId) {
            return ('git-inbox-' + userId + '-' + moment().format('YYYY-MM-DD-HH-mm-ss')).toLowerCase();
        };
    } else {
        throw new Error('expected branch push type');
    }

    this._slackMatcherList = slackConfigYaml.map(function (matcherConfigYaml) {
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

    if (this._slackMatcherList.length < 1) {
        throw new Error('set up at least one Slack upload match pattern');
    }
}

Processor.prototype.processFile = function (fileName, contentGetter) {
    // match up against what we have
    var targetFormatterList = this._slackMatcherList.map(function (matcher) {
        return matcher(fileName);
    }).filter(function (formatter) { return formatter !== null; })

    // no need to keep going
    if (targetFormatterList.length < 1) {
        console.log('no target paths matched, ignoring');
        return Promise.resolve({});
    }

    return contentGetter().then(function (sourceFileBuffer) {
        var fileMap = {};

        targetFormatterList.forEach(function (targetFormatter) {
            targetFormatter(sourceFileBuffer, fileMap);
        });

        return fileMap;
    });
};

Processor.prototype.generateBranchName = function (userId) {
    return this._branchNameGenerator(userId);
};

Processor.prototype.getGHPullBase = function (userId) {
    return this._ghPullBase;
};

Processor.prototype.getIsPushGHR = function () {
    return this._pushType === 'github-request';
};

module.exports = Processor;
