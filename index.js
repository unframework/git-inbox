var fs = require('fs');
var yaml = require('js-yaml');

var parseXLSX = require('./lib/parseXLSX');
var Repo = require('./lib/Repo');

var gitUrl = process.env.TARGET_GIT_URL || '';

var sourceFilePath = __dirname + '/example.xlsx';
var sourceBuffer = fs.readFileSync(sourceFilePath);

var itemMap = parseXLSX(sourceBuffer);

var yamlData = yaml.safeDump(itemMap, { indent: 4 });

var fileMap = {};
fileMap['example.yml'] = new Buffer(yamlData);
fileMap['example.xlsx'] = sourceBuffer;

var repo = new Repo(gitUrl);
repo.commitFiles(fileMap. 'Imported XLSX data').then(function (commit) {
    console.log('committed files', commit.allocfmt());

    return repo.push();
}).then(function () {
    console.log('pushed');
}, function (err) {
    console.log('error', err, err.stack);
});
