var https = require('https'),
    helpers = require('../helpers'),
    HTTPBackend = require('./http');

var HTTPSBackend = function(host, port, resources) {
    HTTPBackend.call(this, host, port, resources);
}; helpers.inherits(HTTPSBackend, HTTPBackend);

HTTPSBackend.prototype.adapter = https;

module.exports = HTTPSBackend;