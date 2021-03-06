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

var http = require('http'),
    async = require('async'),
    helpers = require('../helpers'),
    Bucket = require('../bucket');

var HTTPBackend = function(host, port, defaults) {
    //http.globalAgent.maxSockets = 1000;

    this.host = host;
    this.port = port;
    this.defaults = helpers.merge(HTTPBackend.defaults, defaults || {});

    this.buckets = this.bucket = Object.create(HTTPBackend.prototype.buckets); // Establish namespace 'bucket(s)'
    this.buckets.this = this.bucket.this = this; // used as a placeholder for namespaced functions, referenced using this.this in those functions.

    this.objects = this.object = Object.create(HTTPBackend.prototype.objects); // Establish namespace 'object(s)'
    this.objects.this = this.object.this = this; // used as a placeholder for namespaced functions, referenced using this.this in those functions.
};

HTTPBackend.prototype.adapter = http;

HTTPBackend.prototype.ping = function(_return) {
    var query = { resource: this.defaults.resources.riak_kv_wm_ping };
    this.GET(query, _return);
};

HTTPBackend.prototype.stats = function(_return) {
    var query = { resource: this.defaults.resources.riak_kv_wm_stats };
    this.GET(query, _return);
};

HTTPBackend.prototype.resources = function(_return) {
    var query = { resource: '' };
    this.GET(query, _return);
};

HTTPBackend.prototype.buckets = {};
HTTPBackend.prototype.buckets.list = function(_return) {
    var _this = this.this;

    var query = {
        resource: _this.defaults.resources.riak_kv_wm_index,
        options: { buckets: true },
        headers: { "Accept": "application/json" }
    };
    
    _this.GET(query, function(err, obj) {
        _return(err, obj.data.buckets || []);
    });
};

HTTPBackend.prototype.buckets.props = function(bucket_name, _return) {
    var _this = this.this;

    var query = {
        resource: _this.defaults.resources.riak_kv_wm_index+"/"+encodeURIComponent(bucket_name)+"/props",
        headers: { "Accept": "application/json" }
    };
    _this.GET(query, function(err, response) {
        _return(err, response.data.props || {});
    });
};

HTTPBackend.prototype.buckets.get = function(bucket_name, props) {
    var _this = this.this;

    return new Bucket(bucket_name, props, _this);
};

HTTPBackend.prototype.buckets.save = function(bucket_name, props, _return) {
    var _this = this.this;

    var query = {
        resource: _this.defaults.resources.riak_kv_wm_index+"/"+encodeURIComponent(bucket_name)+"/props",
        body: {props: props},
        headers: { "Accept": "application/json" }
    };

    _this.PUT(query, _return);
};

HTTPBackend.prototype.buckets.keys = function(/* bucket_name, options, _return */) {
    var bucket_name = arguments[0];
    var options = typeof(arguments[1]) == 'object' && arguments[1].keys ? arguments[1] : { keys: 'stream' };
    var _return = typeof(arguments[arguments.length - 1]) == 'function' ? arguments[arguments.length - 1] : function(){};

    var _this = this.this;

    var query = {
        resource: _this.defaults.resources.riak_kv_wm_index + "/" +encodeURIComponent(bucket_name)+ "/keys/",
        options: options,
        headers: { "Accept": "application/json" }
    };

    var stream_cache = [];
    _this.GET(query, function(err, response) {
        if(err) _return(err, response);
        else {
            if(response.metadata && response.metadata.transfer_encoding.toLowerCase() === 'chunked') {
                _this.streamResponseHandler(response.data, '{', '}', stream_cache, function(whole_chunk) {
                    _return(err, _this.defaults.mime[response.metadata.content_type].decoder(whole_chunk).keys);
                });
            }
            else {
                _return(err, response.data.keys || []);
            }
        }
    });
};

HTTPBackend.prototype.buckets.search = function(bucket_name, range_or_solr, index, _return) {
    var _this = this.this;
    var query = {};

    var was2i = false;

    if(range_or_solr.constructor.name != "Object" || index !== null) { // perform 2i's search
        var range_str = range_or_solr.constructor.name == 'Array'  ? "/"+range_or_solr.join("/") : range_or_solr;
        was2i = true;

        query = {
            resource: _this.defaults.resources.riak_kv_wm_index+ "/" +encodeURIComponent(bucket_name)+ "/index/" +encodeURIComponent(index)+ "/" +range_str
        };
    }
    else { // perform Riak Search search
        range_or_solr['wt'] = range_or_solr['wt'] || 'json';

        query = {
            resource: _this.defaults.resources.riak_solr_searcher_wm+ "/" +encodeURIComponent(bucket_name)+ "/select/",
            options: range_or_solr
        };
    }

    _this.GET(query, function(err, obj) {
        if(was2i) {
            _return(err, obj.data.keys || []);
        }
        else {
            _return(err, obj);
        }
    });
};

HTTPBackend.prototype.objects = {};
HTTPBackend.prototype.objects.get = function(/* bucket_name, key, [metadata, [options]], _return */) {
    var _this = this.this;

    var bucket_name = arguments[0];
    var key = arguments[1];
    var metadata = arguments[2] || {};
    var options = arguments[3] || {};
    var _return = typeof(arguments[arguments.length - 1]) == 'function' ? arguments[arguments.length - 1] : function(){};

    var query = {
        resource: _this.defaults.resources.riak_kv_wm_index + "/" +encodeURIComponent(bucket_name)+ "/keys/" +encodeURIComponent(key) ,
        headers: metadata,
        options: options
    };

    _this.GET(query, function(err, obj) {
        obj.key = obj.key ? obj.key : key;

        if(obj.metadata && obj.metadata.status_code == 300) {
            obj.siblings = obj.data.split("\n").slice(1,-1);
            _return(err, obj); // return sibling vtags in siblings property.
        }
        else {
            _return(err, obj);
        }
    });
};

HTTPBackend.prototype.objects.save = function(/* bucket_name, key, data, metadata, [options] _return */) {
    var _this = this.this;

    var bucket_name = arguments[0];
    var key = arguments[1] || "";
    var data = arguments[2];
    var metadata = arguments[3] || {};
    var options = typeof(arguments[4]) == 'object' ? arguments[4] : {};
    var _return = typeof(arguments[arguments.length - 1]) == 'function' ? arguments[arguments.length - 1] : function(){};

    var query = {
        resource: _this.defaults.resources.riak_kv_wm_index + "/" +encodeURIComponent(bucket_name)+ "/keys/" +encodeURIComponent(key),
        headers: metadata,
        body: data,
        options: options
    };

    if(key === "") {
        _this.POST(query, function(err, obj) { // POST when no key provided.
            if(err) _return(err, obj);
            else {
                obj.key = obj.metadata.location.substring(obj.metadata.location.lastIndexOf('/') + 1 );
                obj.data = obj.metadata.status_code == 204 ? data : obj.data;
                _return(err, obj);
            }
        });
    }
    else {
        _this.PUT(query, function(err, obj) { // PUT when key is available.
            if(err) _return(err, obj);
            else {
                obj.key = key;
                obj.data = obj.metadata.status_code == 204 ? data : obj.data;
                _return(err, obj);
            }
        });
    }
};

HTTPBackend.prototype.objects.exists = function(/* bucket_name, key, [options] _return */) {
    var _this = this.this;

    var bucket_name = arguments[0];
    var key = arguments[1] || "";
    var options = typeof(arguments[2]) == 'object' ? arguments[2] : {};
    var _return = typeof(arguments[arguments.length - 1]) == 'function' ? arguments[arguments.length - 1] : function(){};

    var query = {
        resource: _this.defaults.resources.riak_kv_wm_index + "/" +encodeURIComponent(bucket_name)+ "/keys/" +encodeURIComponent(key),
        options: options
    };

    _this.HEAD(query, function(err, obj) {
        if(err && obj.metadata.status_code != 404) _return(err, obj);
        else {
            if(obj.metadata.status_code != 404) {
                _return(null, true);
            }
            else{
                _return(null, false);
            }
        }
    });
};

HTTPBackend.prototype.objects.delete = function(/* bucket_name, key, [options] _return */) {
    var _this = this.this;

    var bucket_name = arguments[0];
    var key = arguments[1];
    var options = typeof(arguments[2]) == 'object' ? arguments[2] : {};
    var _return = typeof(arguments[arguments.length - 1]) == 'function' ? arguments[arguments.length - 1] : function(){};

    var query = {
        resource: _this.defaults.resources.riak_kv_wm_index + "/" +encodeURIComponent(bucket_name)+ "/keys/" +encodeURIComponent(key),
        options: options
    };

    _this.DELETE(query, _return);
};


HTTPBackend.prototype.request = function(method, query, _return) {
    var _this = this;

    query.headers = HTTPBackend.appendDefaultHeaders(HTTPBackend.metadataToHeaders(query.headers), this.defaults.headers);

    var req = this.adapter.request({ headers: query.headers,
                           path: query.resource + HTTPBackend.appendOptions(query.options),
                           method: method,
                           host: this.host,
                           port: this.port}, function(response) { _this.responseHandler(response, _return); });

    req.on('error', function(error) {
        process.nextTick(function() { _return(error, query); });
    });

    query.body = this.defaults.mime[query.headers['content-type']] ? this.defaults.mime[query.headers['content-type']].encoder(query.body) : query.body;

    req.end(query.body, query.encoding || 'utf8');
};

HTTPBackend.prototype.responseHandler = function(res, _return) {
    var _this = this;

    var body = [];
    res.headers['status-code'] = res.statusCode;

    res.on('data', function(chunk) {
        if(res.headers['transfer-encoding'] != 'chunked') { // If NOT dealing with chunked results...
            body.push(chunk); // add chunk to Buffer array to be joined at the end of the response.
        }
        else { // Otherwise return the results immediately to handle results streaming from Riak.
            process.nextTick(function() { _return(null, { data: chunk, metadata: HTTPBackend.headersToMetadata(res.headers) }); });
        }
    });

    res.on('end', function() {
        if(res.headers['transfer-encoding'] !== 'chunked') { // If NOT dealing with chunked results...
            var body_length = parseInt(res.headers['content-length'], 10);

            body = Buffer.concat(body, body_length || undefined);
            var err = null;

            if(res.statusCode >= 400) {
                err = new Error();
                err.http_code = res.statusCode;
                err.message = body.toString();
            }

            body = (body_length !== 0 && _this.defaults.mime[res.headers['content-type']]) ? _this.defaults.mime[res.headers['content-type']].decoder(body) : body;
            process.nextTick(function() { _return(err, { data: body, metadata: HTTPBackend.headersToMetadata(res.headers) }); });
        }
    });

    res.on('close', function(err){
        process.nextTick(function() {_return(err, { data: body, metadata: res.headers }); });
    });
};

HTTPBackend.prototype.streamResponseHandler = function(chunk, start_delim, stop_delim, cache, _return) {
    var str = chunk.toString();

    if(str.substr(0,start_delim.length) === start_delim && str.substr(-stop_delim.length) === stop_delim) {
        _return(chunk);
    }
    else if(str[str.length-1] === stop_delim) {
        cache.push(chunk);

        _return(Buffer.concat(cache));
    }
    else {
        cache.push(chunk);
    }
};

HTTPBackend.appendDefaultHeaders = function(headers, defaults) {
    headers = headers || {};

    headers["content-type"] = headers["content-type"] || defaults["content-type"];
    headers["accept"] = headers["accept"] || defaults["accept"];

    return headers;
};

HTTPBackend.filterHeaders = function(headers) {
    for(var i = 0, length = HTTPBackend.defaults.ignore_headers.length; i < length; i++) {
        if(headers[HTTPBackend.defaults.ignore_headers[i]]) {
            delete headers[HTTPBackend.defaults.ignore_headers[i].toLowerCase()];
        }
    }
    return headers;
};

HTTPBackend.appendOptions = function(options) {
    var temp = "";
    
    for(var key in options) {
        temp += key + "=" + encodeURIComponent(options[key]) + "&";
    }

    temp = (temp.length !== 0) ? "?"+temp : temp;

    return temp;
};

HTTPBackend.headersToMetadata = function(headers) {
  var metadata = HTTPBackend.munchHeaders(headers);
  
  return metadata;
};

HTTPBackend.metadataToHeaders = function(metadata) {
  var headers = HTTPBackend.munchMetadata(metadata);

  return headers;
};

HTTPBackend.munchHeaders = function(headers) {
  var metadata = {};
  
  headers = HTTPBackend.filterHeaders(headers);

  for(var key in headers) {
    var low_key = key.toLowerCase();
    
    if(low_key.indexOf("x-riak-")) {
      low_key = low_key.replace("-","_");
    }
    else{
      low_key = low_key.slice(7).replace("_","-");
    }
    
    var parts = low_key.split("-");
    parts.push(headers[key]);
    metadata = HTTPBackend.toNamespaced(metadata, parts);
  }
  return metadata;
};

HTTPBackend.munchMetadata = function(metadata, accumulator, container) {
  accumulator = accumulator || "";
  container = container || {};
  
  for(var prop in metadata) {
    var acc = accumulator;

    acc = (prop === "vclock" || prop === "index" || prop === "meta") ? "x-riak" : acc;

    if(metadata.hasOwnProperty(prop) && metadata[prop].constructor.name == "Object") {
      HTTPBackend.munchMetadata(metadata[prop], (acc === "") ? prop : acc + "-" + prop, container);
    }
    else {
      var value = metadata[prop].constructor.name == "Array" ? metadata[prop].join(", ") : metadata[prop];
      prop = prop.replace("_","-");
      
      if(acc === "") {
        container[prop] = value;
      }
      else {
        container[(prop == "int" || prop == 'bin') ? (acc + "_" + prop) : (acc + "-" + prop)] = value;
      }
    }
  }
  
  return container;
};

HTTPBackend.toNamespaced = function(parent, parts) {
  var namespace = parent;
  
  for(var i = 0, length = parts.length-1; i < length; i++) {
      if(i+1 == length) {
        parent[parts[i]] = (parts[0] == 'index') ? parts[i+1].split(", ") : parts[i+1];
      }
      else {
        parent[parts[i]] = parent[parts[i]] || {};
        parent = parent[parts[i]];
      }
  }
  return namespace;
};

HTTPBackend.prototype.HEAD = function(query, _return) {
    this.request('HEAD', query, _return);
};

HTTPBackend.prototype.GET = function(query, _return) {
    this.request('GET', query, _return);
};

HTTPBackend.prototype.POST = function(query, _return) {
    this.request('POST', query, _return);
};

HTTPBackend.prototype.PUT = function(query, _return) {
    this.request('PUT', query, _return);
};

HTTPBackend.prototype.DELETE = function(query, _return) {
    this.request('DELETE', query, function(err, obj) {
        if(obj.metadata && obj.metadata.status_code == 404) {
            _return(null, obj);
        }
        else {
            _return(err, obj);
        }
    });
};

HTTPBackend.defaults = {
    headers: {
        "content-type": "application/json",
        "accept": "*/*"
    },
    mime: {
        'application/json': {
            encoder: function(data) { return JSON.stringify(data); },
            decoder: function(data) { return data.length > 0 ? JSON.parse(data) : data.toString(); }
        },
        'text/plain': {
            encoder: function(data) { return data.toString(); },
            decoder: function(data) { return data.toString(); }
        },
        'text/html' : {
            encoder: function(data) { return data.toString(); },
            decoder: function(data) { return data.toString(); }
        }
    },
    ignore_headers: [
        "date",
        "content-length",
        "server",
        "vary"
    ],
    connection: {
        host: 'localhost',
        port: 8098
    },
    resources: {
        riak_kv_wm_buckets: "/riak",
        riak_kv_wm_index: "/buckets",
        riak_kv_wm_keylist: "/buckets",
        riak_kv_wm_link_walker: "/riak",
        riak_kv_wm_mapred: "/mapred",
        riak_kv_wm_object: "/riak",
        riak_kv_wm_ping: "/ping",
        riak_kv_wm_props: "/buckets",
        riak_kv_wm_stats: "/stats",
        riak_solr_indexer_wm: "/solr",
        riak_solr_searcher_wm: "/solr"
    }
};

module.exports = HTTPBackend;