// (The MIT License)

// Copyright (c) 2012 Coradine Aviation Systems
// Copyright (c) 2012 Nathan Aschbacher

// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// 'Software'), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:

// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
// IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
// CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
// TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
// SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

var helpers = require('./helpers'),
    RObject = require('./robject'),
    async = require('async');

var Bucket = function(name, props, client) {
    this.name = name;
    this.props = props || {};

    this.client = client;

    this.objects = this.object = Object.create(Bucket.prototype.objects); // Establish namespace 'object(s)'
    this.objects.this = this.object.this = this; // used as a placeholder for namespaced functions, referenced using this.this in those functions.
};

Bucket.prototype.props = function(_return) {
    this.client.bucket.props(this.name, function(err, props) {
        if(err) _return(err, props);
        else {
            this.props = props;
            _return(err, props || {});
        }
    });
};

Bucket.prototype.save = function(/* [merge], _return */) {
    var _this = this;

    var merge = typeof(arguments[0]) == 'boolean' ? arguments[0] : true;
    var _return = typeof(arguments[arguments.length - 1]) == 'function' ? arguments[arguments.length - 1] : function(){};

    this.getProps(function(err, props, meta) {
        if(err) _return(err, props, meta);
        else {
            if(merge) {
                _this.props = helpers.merge(props, _this.props);
            }
            _this.client.bucket.save(_this.name, _this.props, _return);
        }
    });
};

Bucket.prototype.search = function(/* range_or_solr, [index], _return */) {
    var _this = this.this;

    var range_or_solr = arguments[0];
    var index = arguments[1] ? arguments[1] : null;
    var _return = typeof(arguments[arguments.length - 1]) == 'function' ? arguments[arguments.length - 1] : function(){};

    if(index !== null && range_or_solr[0] !== undefined) {
        index = typeof(range_or_solr[0]) === 'string' ? index+'_bin' : index+'_int';
    }

    _this.client.bucket.search(_this.name, range_or_solr, index, function(err, obj) {
        if(err) _return(err, obj);
        else {
            if(obj.data.response && obj.data.response.docs) { // if Riak Search result
                obj.data.keys = [];
                for(var i = 0, length = obj.data.response.docs.length; i < length; i++) {
                    obj.data.keys.push(obj.data.response.docs[i].id);
                }
            }
            _this.objects.get(obj.data.keys || [], _return);
        }
    });
};

Bucket.prototype.objects = {};
Bucket.prototype.objects.new = function(key, data, metadata) {
    var _this = this.this;

    return new RObject(_this, key, data, metadata);
};

Bucket.prototype.objects.all = function(_return) {
    var _this = this.this;

    _this.client.bucket.keys(_this.name, function(err, keys) {
        _this.objects.get(keys, function(err, r_objs) {
            _return(err, r_objs);
        });
    });
};

Bucket.prototype.objects.get = function(/* keys, [options], [resolver_fn], _return */) {
    var keys = arguments[0];
    var options = typeof(arguments[1]) == 'object' ? arguments[1] : {};
    var resolver_fn = typeof(arguments[arguments.length - 1]) == 'function' && typeof(arguments[arguments.length - 2]) == 'function' ? arguments[arguments.length - 2] : Bucket.siblingLastWriteWins;
    var _return = typeof(arguments[arguments.length - 1]) == 'function' ? arguments[arguments.length - 1] : function(){};

    var _this = this.this;

    keys = keys.constructor.name == 'Array' ? keys : [keys];

    var keys_fetched_set = {};
    var compiled_results = [];

    async.forEach(keys,
        function(key, _intermediate) {
            if(!keys_fetched_set[key]) {
                keys_fetched_set[key] = true;
                _this.client.object.get(_this.name, key, null, options, function(err, obj) {                    
                    if(err && err.http_code == 404) {
                        _intermediate(null);
                    }
                    else if(err && err.http_code != 404) {
                        _intermediate(err);
                    }
                    else if(obj.siblings && obj.siblings.length > 0 ) {
                        _this.object.fetchSiblings(obj.key, obj.siblings, function(err, siblings) {
                            var resolved = resolver_fn(siblings);
                            resolved.save(); // no callback because we don't care about the result of this save.  The read-resolved object should be returned in any case.
                            compiled_results.push(resolved);
                            _intermediate(err);
                        });
                    }
                    else {
                        compiled_results.push(new RObject(_this, key, obj.data, obj.metadata));
                        _intermediate(err);
                    }
                });
            }
            else {
                _intermediate(null);
            }
        },
        function(err) {
            _return((err === undefined ? null : err), (compiled_results.length == 1 ? compiled_results[0] : compiled_results));
        }
    );
};

Bucket.prototype.objects.save = function(r_objects, _return) {
    var _this = this.this;

    r_objects = r_objects.constructor.name == 'Array' ? r_objects : [r_objects];

    async.map(r_objects,
        function(r_object, _intermediate) {
            r_object.save(function(err, obj) {
                _intermediate(err, obj);
            });
        },
        function(err, results) {
            _return(err, results.length == 1 ? results[0] : results);
        }
    );
};

Bucket.prototype.objects.exists = function(key, _return) {
    var _this = this.this;

    _this.client.object.exists(_this.name, key, _return);
};

Bucket.prototype.objects.delete = function(r_objects, _return) {
    var _this = this.this;

    r_objects = r_objects !== null && r_objects.constructor.name == 'Array' ? r_objects : [r_objects];

    async.map(r_objects,
        function(r_object, _intermediate) {
            r_object.delete(function(err, obj) {
                _intermediate(err, r_object);
            });
        },
        function(err, results) {
            _return(err, results.length == 1 ? results[0] : results);
        }
    );
};

Bucket.prototype.objects.fetchSiblings = function(key, vtags, _return) {
    var _this = this.this;

    async.map(vtags,
        function(vtag, _intermediate) {
            _this.objects.get(key, { vtag: vtag }, function(err, obj) {
                _intermediate(err, obj);
            });
        },
        function(err, siblings) {
            _return(err, siblings);
        }
    );
};

Bucket.siblingLastWriteWins = function(siblings) {
    function siblingLastModifiedSort(a, b) {
        if(!a.metadata.last_modified || new Date(a.metadata.last_modified) < new Date(b.metadata.last_modified)) {
            return 1;
        }
        else {
            return -1;
        }
    }
    siblings.sort(siblingLastModifiedSort);

    return siblings[0];
};

module.exports = Bucket;