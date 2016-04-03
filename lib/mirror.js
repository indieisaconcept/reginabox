/*
Copyright (c) 2015, Yahoo! Inc. All rights reserved.
Code licensed under the MIT License.
See LICENSE.txt file.
*/
var express = require('express');
var st      = require('st');
var lru     = require('lru-cache');
var fs      = require('fs');
var url     = require('url');
var mdns    = require('mdns');
var path    = require('path');
var spawn   = require('child_process').spawn;
var logger  = require('davlog');
var patch   = require('patch-package-json');
var resolveBin = require('resolve-bin')

var argv    = require('argv');
var args    = argv.option([
    { name : 'port', short : 'p', type : 'int' },
    { name : 'sync', short : 's', type : 'boolean' }
]).run();

logger.init({name: 'reginabox'});

var app       = express();
var cache     = lru();
var port      = args.options.port;
var outputDir = args.targets[1] || path.join(process.cwd(), 'registry');

logger.info('using output directory', outputDir);

// log each request, set server header
app.use(function(req, res, cb) {
    logger.info(req.ip, req.method, req.path);
    res.append('Server', 'reginabox');
    cb();
});

// serve up main index (no caching)
app.get('/', function(req, res) {
    res.type('json');
    fs.createReadStream(path.join(outputDir, 'index.json')).pipe(res);
});

// serve up tarballs
app.use(st({path: outputDir, passthrough: true, index: false}));

// serve up metadata. doing it manually so we can modify JSON
app.use(function(req, res) {

    var cached = cache.get(req.url);
    if (cached) {
        res.type('json')
        res.send(cached);
        return;
    }

    fs.readFile(path.join(outputDir, req.url, 'index.json'), {encoding: 'utf8'}, function(err, data) {

        if (err) {
            res.sendStatus(err.code === 'ENOENT' ? 404 : 500);
            return;
        }

        data = JSON.parse(data);
        data = patch.json(data, 'http://' +req.hostname + ':' + port);
        var buf = new Buffer(JSON.stringify(data));
        cache.set(req.url, buf);
        res.type('json');
        res.send(buf);

    });
});

var server = app.listen(port, function() {
    exports.port = port || server.address().port;
    logger.info('listening on port', exports.port);
    mdns.createAdvertisement(mdns.tcp('reginabox'), exports.port).start();
    logger.info('broadcasting on mDNS');
    if (args.options.sync) {
        var child = spawn(
            resolveBin.sync('registry-static'),
            ['-o', outputDir, '-d', 'localhost'],
            {stdio: 'inherit'}
        );
        process.on('SIGINT', function() {
            child.kill('SIGINT');
            process.kill();
        });
    }
    logger.info('starting registry-static');
});

exports.close = function() {
    server.close();
};
