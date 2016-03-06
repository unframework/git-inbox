var fs = require('fs');
var XLSX = require('xlsx');
var yaml = require('js-yaml');
var git = require('nodegit');
var moment = require('moment');

var Repo = require('./lib/Repo');

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

var fileMap = {};
fileMap['example.yml'] = new Buffer(yamlData);
fileMap['example.xlsx'] = fs.readFileSync(sourceFilePath);

var repo = new Repo(gitUrl);
repo.commitFiles(fileMap).then(function (commit) {
    console.log('committed files', commit.allocfmt());

    return repo.push();
}).then(function () {
    console.log('pushed');
}, function (err) {
    console.log('error', err, err.stack);
});
