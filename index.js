var _removeDotSegments = require('remove-dot-segments');

var _nodejs = false;
var _browser = !_nodejs;

if (typeof XMLSerializer === 'undefined') {
  /* jshint ignore:start */
  XMLSerializer = require('xmldom').XMLSerializer;
  /* jshint ignore:end */
}

var jsonld = {};


jsonld.compact = function(input, ctx, options, callback) {
  if(arguments.length < 2) {
    return jsonld.nextTick(function() {
      callback(new TypeError('Could not compact, too few arguments.'));
    });
  }

  // get arguments
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};

  if(ctx === null) {
    return jsonld.nextTick(function() {
      callback(new JsonLdError(
        'The compaction context must not be null.',
        'jsonld.CompactError', {code: 'invalid local context'}));
    });
  }

  // nothing to compact
  if(input === null) {
    return jsonld.nextTick(function() {
      callback(null, null);
    });
  }

  // set default options
  if(!('base' in options)) {
    options.base = (typeof input === 'string') ? input : '';
  }
  if(!('compactArrays' in options)) {
    options.compactArrays = true;
  }
  if(!('graph' in options)) {
    options.graph = false;
  }
  if(!('skipExpansion' in options)) {
    options.skipExpansion = false;
  }
  if(!('documentLoader' in options)) {
    options.documentLoader = jsonld.loadDocument;
  }
  if(!('link' in options)) {
    options.link = false;
  }
  if(options.link) {
    // force skip expansion when linking, "link" is not part of the public
    // API, it should only be called from framing
    options.skipExpansion = true;
  }

  var expand = function(input, options, callback) {
    jsonld.nextTick(function() {
      if(options.skipExpansion) {
        return callback(null, input);
      }
      jsonld.expand(input, options, callback);
    });
  };

  // expand input then do compaction
  expand(input, options, function(err, expanded) {
    if(err) {
      return callback(new JsonLdError(
        'Could not expand input before compaction.',
        'jsonld.CompactError', {cause: err}));
    }

    // process context
    var activeCtx = _getInitialContext(options);
    jsonld.processContext(activeCtx, ctx, options, function(err, activeCtx) {
      if(err) {
        return callback(new JsonLdError(
          'Could not process context before compaction.',
          'jsonld.CompactError', {cause: err}));
      }

      var compacted;
      try {
        // do compaction
        compacted = new Processor().compact(activeCtx, null, expanded, options);
      } catch(ex) {
        return callback(ex);
      }

      cleanup(null, compacted, activeCtx, options);
    });
  });

  // performs clean up after compaction
  function cleanup(err, compacted, activeCtx, options) {
    if(err) {
      return callback(err);
    }

    if(options.compactArrays && !options.graph && _isArray(compacted)) {
      if(compacted.length === 1) {
        // simplify to a single item
        compacted = compacted[0];
      } else if(compacted.length === 0) {
        // simplify to an empty object
        compacted = {};
      }
    } else if(options.graph && _isObject(compacted)) {
      // always use array if graph option is on
      compacted = [compacted];
    }

    // follow @context key
    if(_isObject(ctx) && '@context' in ctx) {
      ctx = ctx['@context'];
    }

    // build output context
    ctx = _clone(ctx);
    if(!_isArray(ctx)) {
      ctx = [ctx];
    }
    // remove empty contexts
    var tmp = ctx;
    ctx = [];
    for(var i = 0; i < tmp.length; ++i) {
      if(!_isObject(tmp[i]) || Object.keys(tmp[i]).length > 0) {
        ctx.push(tmp[i]);
      }
    }

    // remove array if only one context
    var hasContext = (ctx.length > 0);
    if(ctx.length === 1) {
      ctx = ctx[0];
    }

    // add context and/or @graph
    if(_isArray(compacted)) {
      // use '@graph' keyword
      var kwgraph = _compactIri(activeCtx, '@graph');
      var graph = compacted;
      compacted = {};
      if(hasContext) {
        compacted['@context'] = ctx;
      }
      compacted[kwgraph] = graph;
    } else if(_isObject(compacted) && hasContext) {
      // reorder keys so @context is first
      var graph = compacted;
      compacted = {'@context': ctx};
      for(var key in graph) {
        compacted[key] = graph[key];
      }
    }

    callback(null, compacted, activeCtx);
  }
};

jsonld.expand = function(input, options, callback) {
  if(arguments.length < 1) {
    return jsonld.nextTick(function() {
      callback(new TypeError('Could not expand, too few arguments.'));
    });
  }

  // get arguments
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};

  // set default options
  if(!('documentLoader' in options)) {
    options.documentLoader = jsonld.loadDocument;
  }
  if(!('keepFreeFloatingNodes' in options)) {
    options.keepFreeFloatingNodes = false;
  }

  jsonld.nextTick(function() {
    // if input is a string, attempt to dereference remote document
    if(typeof input === 'string') {
      var done = function(err, remoteDoc) {
        if(err) {
          return callback(err);
        }
        try {
          if(!remoteDoc.document) {
            throw new JsonLdError(
              'No remote document found at the given URL.',
              'jsonld.NullRemoteDocument');
          }
          if(typeof remoteDoc.document === 'string') {
            remoteDoc.document = JSON.parse(remoteDoc.document);
          }
        } catch(ex) {
          return callback(new JsonLdError(
            'Could not retrieve a JSON-LD document from the URL. URL ' +
            'dereferencing not implemented.', 'jsonld.LoadDocumentError', {
              code: 'loading document failed',
              cause: ex,
              remoteDoc: remoteDoc
          }));
        }
        expand(remoteDoc);
      };
      options.documentLoader(input, done);
       
      return;
    }
    // nothing to load
    expand({contextUrl: null, documentUrl: null, document: input});
  });

  function expand(remoteDoc) {
    // set default base
    if(!('base' in options)) {
      options.base = remoteDoc.documentUrl || '';
    }
    // build meta-object and retrieve all @context URLs
    var input = {
      document: _clone(remoteDoc.document),
      remoteContext: {'@context': remoteDoc.contextUrl}
    };
    if('expandContext' in options) {
      var expandContext = _clone(options.expandContext);
      if(typeof expandContext === 'object' && '@context' in expandContext) {
        input.expandContext = expandContext;
      } else {
        input.expandContext = {'@context': expandContext};
      }
    }
    _retrieveContextUrls(input, options, function(err, input) {
      if(err) {
        return callback(err);
      }

      var expanded;
      try {
        var processor = new Processor();
        var activeCtx = _getInitialContext(options);
        var document = input.document;
        var remoteContext = input.remoteContext['@context'];

        // process optional expandContext
        if(input.expandContext) {
          activeCtx = processor.processContext(
            activeCtx, input.expandContext['@context'], options);
        }

        // process remote context from HTTP Link Header
        if(remoteContext) {
          activeCtx = processor.processContext(
            activeCtx, remoteContext, options);
        }

        // expand document
        expanded = processor.expand(
          activeCtx, null, document, options, false);

        // optimize away @graph with no other properties
        if(_isObject(expanded) && ('@graph' in expanded) &&
          Object.keys(expanded).length === 1) {
          expanded = expanded['@graph'];
        } else if(expanded === null) {
          expanded = [];
        }

        // normalize to an array
        if(!_isArray(expanded)) {
          expanded = [expanded];
        }
      } catch(ex) {
        return callback(ex);
      }
      callback(null, expanded);
    });
  }
};

jsonld.flatten = function(input, ctx, options, callback) {
  if(arguments.length < 1) {
    return jsonld.nextTick(function() {
      callback(new TypeError('Could not flatten, too few arguments.'));
    });
  }

  // get arguments
  if(typeof options === 'function') {
    callback = options;
    options = {};
  } else if(typeof ctx === 'function') {
    callback = ctx;
    ctx = null;
    options = {};
  }
  options = options || {};

  // set default options
  if(!('base' in options)) {
    options.base = (typeof input === 'string') ? input : '';
  }
  if(!('documentLoader' in options)) {
    options.documentLoader = jsonld.loadDocument;
  }

  // expand input
  jsonld.expand(input, options, function(err, _input) {
    if(err) {
      return callback(new JsonLdError(
        'Could not expand input before flattening.',
        'jsonld.FlattenError', {cause: err}));
    }

    var flattened;
    try {
      // do flattening
      flattened = new Processor().flatten(_input);
    } catch(ex) {
      return callback(ex);
    }

    if(ctx === null) {
      return callback(null, flattened);
    }

    // compact result (force @graph option to true, skip expansion)
    options.graph = true;
    options.skipExpansion = true;
    jsonld.compact(flattened, ctx, options, function(err, compacted) {
      if(err) {
        return callback(new JsonLdError(
          'Could not compact flattened output.',
          'jsonld.FlattenError', {cause: err}));
      }
      callback(null, compacted);
    });
  });
};

jsonld.frame = function(input, frame, options, callback) {
  if(arguments.length < 2) {
    return jsonld.nextTick(function() {
      callback(new TypeError('Could not frame, too few arguments.'));
    });
  }

  // get arguments
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};

  // set default options
  if(!('base' in options)) {
    options.base = (typeof input === 'string') ? input : '';
  }
  if(!('documentLoader' in options)) {
    options.documentLoader = jsonld.loadDocument;
  }
  if(!('embed' in options)) {
    options.embed = '@last';
  }
  options.explicit = options.explicit || false;
  if(!('requireAll' in options)) {
    options.requireAll = true;
  }
  options.omitDefault = options.omitDefault || false;

  jsonld.nextTick(function() {
    // if frame is a string, attempt to dereference remote document
    if(typeof frame === 'string') {
      var done = function(err, remoteDoc) {
        if(err) {
          return callback(err);
        }
        try {
          if(!remoteDoc.document) {
            throw new JsonLdError(
              'No remote document found at the given URL.',
              'jsonld.NullRemoteDocument');
          }
          if(typeof remoteDoc.document === 'string') {
            remoteDoc.document = JSON.parse(remoteDoc.document);
          }
        } catch(ex) {
          return callback(new JsonLdError(
            'Could not retrieve a JSON-LD document from the URL. URL ' +
            'dereferencing not implemented.', 'jsonld.LoadDocumentError', {
              code: 'loading document failed',
              cause: ex,
              remoteDoc: remoteDoc
          }));
        }
        doFrame(remoteDoc);
      };
      options.documentLoader(frame, done);
       
      return;
    }
    // nothing to load
    doFrame({contextUrl: null, documentUrl: null, document: frame});
  });

  function doFrame(remoteFrame) {
    // preserve frame context and add any Link header context
    var frame = remoteFrame.document;
    var ctx;
    if(frame) {
      ctx = frame['@context'];
      if(remoteFrame.contextUrl) {
        if(!ctx) {
          ctx = remoteFrame.contextUrl;
        } else if(_isArray(ctx)) {
          ctx.push(remoteFrame.contextUrl);
        } else {
          ctx = [ctx, remoteFrame.contextUrl];
        }
        frame['@context'] = ctx;
      } else {
        ctx = ctx || {};
      }
    } else {
      ctx = {};
    }

    // expand input
    jsonld.expand(input, options, function(err, expanded) {
      if(err) {
        return callback(new JsonLdError(
          'Could not expand input before framing.',
          'jsonld.FrameError', {cause: err}));
      }

      // expand frame
      var opts = _clone(options);
      opts.isFrame = true;
      opts.keepFreeFloatingNodes = true;
      jsonld.expand(frame, opts, function(err, expandedFrame) {
        if(err) {
          return callback(new JsonLdError(
            'Could not expand frame before framing.',
            'jsonld.FrameError', {cause: err}));
        }

        var framed;
        try {
          // do framing
          framed = new Processor().frame(expanded, expandedFrame, opts);
        } catch(ex) {
          return callback(ex);
        }

        // compact result (force @graph option to true, skip expansion,
        // check for linked embeds)
        opts.graph = true;
        opts.skipExpansion = true;
        opts.link = {};
        jsonld.compact(framed, ctx, opts, function(err, compacted, ctx) {
          if(err) {
            return callback(new JsonLdError(
              'Could not compact framed output.',
              'jsonld.FrameError', {cause: err}));
          }
          // get graph alias
          var graph = _compactIri(ctx, '@graph');
          // remove @preserve from results
          opts.link = {};
          compacted[graph] = _removePreserve(ctx, compacted[graph], opts);
          callback(null, compacted);
        });
      });
    });
  }
};

jsonld.link = function(input, ctx, options, callback) {
  // API matches running frame with a wildcard frame and embed: '@link'
  // get arguments
  var frame = {};
  if(ctx) {
    frame['@context'] = ctx;
  }
  frame['@embed'] = '@link';
  jsonld.frame(input, frame, options, callback);
};

 

jsonld.normalize = function(input, options, callback) {
  if(arguments.length < 1) {
    return jsonld.nextTick(function() {
      callback(new TypeError('Could not normalize, too few arguments.'));
    });
  }

  // get arguments
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};

  // set default options
  if(!('algorithm' in options)) {
    options.algorithm = 'URGNA2012';
  }
  if(!('base' in options)) {
    options.base = (typeof input === 'string') ? input : '';
  }
  if(!('documentLoader' in options)) {
    options.documentLoader = jsonld.loadDocument;
  }

  if('inputFormat' in options) {
    if(options.inputFormat !== 'application/nquads') {
      return callback(new JsonLdError(
        'Unknown normalization input format.',
        'jsonld.NormalizeError'));
    }
    var parsedInput = _parseNQuads(input);
    // do normalization
    new Processor().normalize(parsedInput, options, callback);
  } else {
    // convert to RDF dataset then do normalization
    var opts = _clone(options);
    delete opts.format;
    opts.produceGeneralizedRdf = false;
    jsonld.toRDF(input, opts, function(err, dataset) {
      if(err) {
        return callback(new JsonLdError(
          'Could not convert input to RDF dataset before normalization.',
          'jsonld.NormalizeError', {cause: err}));
      }
      // do normalization
      new Processor().normalize(dataset, options, callback);
    });
  }
};

jsonld.fromRDF = function(dataset, options, callback) {
  if(arguments.length < 1) {
    return jsonld.nextTick(function() {
      callback(new TypeError('Could not convert from RDF, too few arguments.'));
    });
  }

  // get arguments
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};

  // set default options
  if(!('useRdfType' in options)) {
    options.useRdfType = false;
  }
  if(!('useNativeTypes' in options)) {
    options.useNativeTypes = false;
  }

  if(!('format' in options) && _isString(dataset)) {
    // set default format to nquads
    if(!('format' in options)) {
      options.format = 'application/nquads';
    }
  }

  jsonld.nextTick(function() {
    // handle special format
    var rdfParser;
    if(options.format) {
      // check supported formats
      rdfParser = options.rdfParser || _rdfParsers[options.format];
      if(!rdfParser) {
        return callback(new JsonLdError(
          'Unknown input format.',
          'jsonld.UnknownFormat', {format: options.format}));
      }
    } else {
      // no-op parser, assume dataset already parsed
      rdfParser = function() {
        return dataset;
      };
    }

    var callbackCalled = false;
    try {
      // rdf parser may be async or sync, always pass callback
      dataset = rdfParser(dataset, function(err, dataset) {
        callbackCalled = true;
        if(err) {
          return callback(err);
        }
        fromRDF(dataset, options, callback);
      });
    } catch(e) {
      if(!callbackCalled) {
        return callback(e);
      }
      throw e;
    }
    // handle synchronous or promise-based parser
    if(dataset) {
      // if dataset is actually a promise
      if('then' in dataset) {
        return dataset.then(function(dataset) {
          fromRDF(dataset, options, callback);
        }, callback);
      }
      // parser is synchronous
      fromRDF(dataset, options, callback);
    }

    function fromRDF(dataset, options, callback) {
      // convert from RDF
      new Processor().fromRDF(dataset, options, callback);
    }
  });
};

jsonld.toRDF = function(input, options, callback) {
  if(arguments.length < 1) {
    return jsonld.nextTick(function() {
      callback(new TypeError('Could not convert to RDF, too few arguments.'));
    });
  }

  // get arguments
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};

  // set default options
  if(!('base' in options)) {
    options.base = (typeof input === 'string') ? input : '';
  }
  if(!('documentLoader' in options)) {
    options.documentLoader = jsonld.loadDocument;
  }

  // expand input
  jsonld.expand(input, options, function(err, expanded) {
    if(err) {
      return callback(new JsonLdError(
        'Could not expand input before serialization to RDF.',
        'jsonld.RdfError', {cause: err}));
    }

    var dataset;
    try {
      // output RDF dataset
      dataset = Processor.prototype.toRDF(expanded, options);
      if(options.format) {
        if(options.format === 'application/nquads') {
          return callback(null, _toNQuads(dataset));
        }
        throw new JsonLdError(
          'Unknown output format.',
          'jsonld.UnknownFormat', {format: options.format});
      }
    } catch(ex) {
      return callback(ex);
    }
    callback(null, dataset);
  });
};

jsonld.createNodeMap = function(input, options, callback) {
  if(arguments.length < 1) {
    return jsonld.nextTick(function() {
      callback(new TypeError('Could not create node map, too few arguments.'));
    });
  }

  // get arguments
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options = options || {};

  // set default options
  if(!('base' in options)) {
    options.base = (typeof input === 'string') ? input : '';
  }
  if(!('documentLoader' in options)) {
    options.documentLoader = jsonld.loadDocument;
  }

  // expand input
  jsonld.expand(input, options, function(err, _input) {
    if(err) {
      return callback(new JsonLdError(
        'Could not expand input before creating node map.',
        'jsonld.CreateNodeMapError', {cause: err}));
    }

    var nodeMap;
    try {
      nodeMap = new Processor().createNodeMap(_input, options);
    } catch(ex) {
      return callback(ex);
    }

    callback(null, nodeMap);
  });
};

jsonld.merge = function(docs, ctx, options, callback) {
  if(arguments.length < 1) {
    return jsonld.nextTick(function() {
      callback(new TypeError('Could not merge, too few arguments.'));
    });
  }
  if(!_isArray(docs)) {
    return jsonld.nextTick(function() {
      callback(new TypeError('Could not merge, "docs" must be an array.'));
    });
  }

  // get arguments
  if(typeof options === 'function') {
    callback = options;
    options = {};
  } else if(typeof ctx === 'function') {
    callback = ctx;
    ctx = null;
    options = {};
  }
  options = options || {};

  // expand all documents
  var expanded = [];
  var error = null;
  var count = docs.length;
  for(var i = 0; i < docs.length; ++i) {
    var opts = {};
    for(var key in options) {
      opts[key] = options[key];
    }
    jsonld.expand(docs[i], opts, expandComplete);
  }

  function expandComplete(err, _input) {
    if(error) {
      return;
    }
    if(err) {
      error = err;
      return callback(new JsonLdError(
        'Could not expand input before flattening.',
        'jsonld.FlattenError', {cause: err}));
    }
    expanded.push(_input);
    if(--count === 0) {
      merge(expanded);
    }
  }

  function merge(expanded) {
    var mergeNodes = true;
    if('mergeNodes' in options) {
      mergeNodes = options.mergeNodes;
    }

    var issuer = options.namer || options.issuer || new IdentifierIssuer('_:b');
    var graphs = {'@default': {}};

    var defaultGraph;
    try {
      for(var i = 0; i < expanded.length; ++i) {
        // uniquely relabel blank nodes
        var doc = expanded[i];
        doc = jsonld.relabelBlankNodes(doc, {
          issuer: new IdentifierIssuer('_:b' + i + '-')
        });

        // add nodes to the shared node map graphs if merging nodes, to a
        // separate graph set if not
        var _graphs = (mergeNodes || i === 0) ? graphs : {'@default': {}};
        _createNodeMap(doc, _graphs, '@default', issuer);

        if(_graphs !== graphs) {
          // merge document graphs but don't merge existing nodes
          for(var graphName in _graphs) {
            var _nodeMap = _graphs[graphName];
            if(!(graphName in graphs)) {
              graphs[graphName] = _nodeMap;
              continue;
            }
            var nodeMap = graphs[graphName];
            for(var key in _nodeMap) {
              if(!(key in nodeMap)) {
                nodeMap[key] = _nodeMap[key];
              }
            }
          }
        }
      }

      // add all non-default graphs to default graph
      defaultGraph = _mergeNodeMaps(graphs);
    } catch(ex) {
      return callback(ex);
    }

    // produce flattened output
    var flattened = [];
    var keys = Object.keys(defaultGraph).sort();
    for(var ki = 0; ki < keys.length; ++ki) {
      var node = defaultGraph[keys[ki]];
      // only add full subjects to top-level
      if(!_isSubjectReference(node)) {
        flattened.push(node);
      }
    }

    if(ctx === null) {
      return callback(null, flattened);
    }

    // compact result (force @graph option to true, skip expansion)
    options.graph = true;
    options.skipExpansion = true;
    jsonld.compact(flattened, ctx, options, function(err, compacted) {
      if(err) {
        return callback(new JsonLdError(
          'Could not compact merged output.',
          'jsonld.MergeError', {cause: err}));
      }
      callback(null, compacted);
    });
  }
};

jsonld.relabelBlankNodes = function(input, options) {
  options = options || {};
  var issuer = options.namer || options.issuer || new IdentifierIssuer('_:b');
  return _labelBlankNodes(issuer, input);
};

jsonld.prependBase = function(base, iri) {
  return _prependBase(base, iri);
};

function JsonLdProcessor() {}

JsonLdProcessor.prototype.toString = function() {
  if(this instanceof JsonLdProcessor) {
    return '[object JsonLdProcessor]';
  }
  return '[object JsonLdProcessorPrototype]';
};

jsonld.JsonLdProcessor = JsonLdProcessor;

var canDefineProperty = !!Object.defineProperty;

if(canDefineProperty) {
  try {
    Object.defineProperty({}, 'x', {});
  } catch(e) {
    canDefineProperty = false;
  }
}

if(canDefineProperty) {
  Object.defineProperty(JsonLdProcessor, 'prototype', {
    writable: false,
    enumerable: false
  });
  Object.defineProperty(JsonLdProcessor.prototype, 'constructor', {
    writable: true,
    enumerable: false,
    configurable: true,
    value: JsonLdProcessor
  });
}

if(_browser && typeof global.JsonLdProcessor === 'undefined') {
  if(canDefineProperty) {
    Object.defineProperty(global, 'JsonLdProcessor', {
      writable: true,
      enumerable: false,
      configurable: true,
      value: JsonLdProcessor
    });
  } else {
    global.JsonLdProcessor = JsonLdProcessor;
  }
}

var _setImmediate = typeof setImmediate === 'function' && setImmediate;

var _delay = _setImmediate ? function(fn) {
  // not a direct alias (for IE10 compatibility)
  _setImmediate(fn);
} : function(fn) {
  setTimeout(fn, 0);
};

if(typeof process === 'object' && typeof process.nextTick === 'function') {
  jsonld.nextTick = process.nextTick;
} else {
  jsonld.nextTick = _delay;
}

jsonld.setImmediate = _setImmediate ? _delay : jsonld.nextTick;

jsonld.parseLinkHeader = function(header) {
  var rval = {};
  // split on unbracketed/unquoted commas
  var entries = header.match(/(?:<[^>]*?>|"[^"]*?"|[^,])+/g);
  var rLinkHeader = /\s*<([^>]*?)>\s*(?:;\s*(.*))?/;
  for(var i = 0; i < entries.length; ++i) {
    var match = entries[i].match(rLinkHeader);
    if(!match) {
      continue;
    }
    var result = {target: match[1]};
    var params = match[2];
    var rParams = /(.*?)=(?:(?:"([^"]*?)")|([^"]*?))\s*(?:(?:;\s*)|$)/g;
    while(match = rParams.exec(params)) {
      result[match[1]] = (match[2] === undefined) ? match[3] : match[2];
    }
    var rel = result['rel'] || '';
    if(_isArray(rval[rel])) {
      rval[rel].push(result);
    } else if(rel in rval) {
      rval[rel] = [rval[rel], result];
    } else {
      rval[rel] = result;
    }
  }
  return rval;
};

jsonld.DocumentCache = function(size) {
  this.order = [];
  this.cache = {};
  this.size = size || 50;
  this.expires = 30 * 1000;
};

jsonld.DocumentCache.prototype.get = function(url) {
  if(url in this.cache) {
    var entry = this.cache[url];
    if(entry.expires >= +new Date()) {
      return entry.ctx;
    }
    delete this.cache[url];
    this.order.splice(this.order.indexOf(url), 1);
  }
  return null;
};

jsonld.DocumentCache.prototype.set = function(url, ctx) {
  if(this.order.length === this.size) {
    delete this.cache[this.order.shift()];
  }
  this.order.push(url);
  this.cache[url] = {ctx: ctx, expires: (+new Date() + this.expires)};
};

jsonld.ActiveContextCache = function(size) {
  this.order = [];
  this.cache = {};
  this.size = size || 100;
};

jsonld.ActiveContextCache.prototype.get = function(activeCtx, localCtx) {
  var key1 = JSON.stringify(activeCtx);
  var key2 = JSON.stringify(localCtx);
  var level1 = this.cache[key1];
  if(level1 && key2 in level1) {
    return level1[key2];
  }
  return null;
};

jsonld.ActiveContextCache.prototype.set = function(
  activeCtx, localCtx, result) {
  if(this.order.length === this.size) {
    var entry = this.order.shift();
    delete this.cache[entry.activeCtx][entry.localCtx];
  }
  var key1 = JSON.stringify(activeCtx);
  var key2 = JSON.stringify(localCtx);
  this.order.push({activeCtx: key1, localCtx: key2});
  if(!(key1 in this.cache)) {
    this.cache[key1] = {};
  }
  this.cache[key1][key2] = _clone(result);
};

jsonld.cache = {
  activeCtx: new jsonld.ActiveContextCache()
};

jsonld.processContext = function(activeCtx, localCtx) {
  // get arguments
  var options = {};
  var callbackArg = 2;
  if(arguments.length > 3) {
    options = arguments[2] || {};
    callbackArg += 1;
  }
  var callback = arguments[callbackArg];

  // set default options
  if(!('base' in options)) {
    options.base = '';
  }
  if(!('documentLoader' in options)) {
    options.documentLoader = jsonld.loadDocument;
  }

  // return initial context early for null context
  if(localCtx === null) {
    return callback(null, _getInitialContext(options));
  }

  // retrieve URLs in localCtx
  localCtx = _clone(localCtx);
  if(!(_isObject(localCtx) && '@context' in localCtx)) {
    localCtx = {'@context': localCtx};
  }
  _retrieveContextUrls(localCtx, options, function(err, ctx) {
    if(err) {
      return callback(err);
    }
    try {
      // process context
      ctx = new Processor().processContext(activeCtx, ctx, options);
    } catch(ex) {
      return callback(ex);
    }
    callback(null, ctx);
  });
};

jsonld.hasProperty = function(subject, property) {
  var rval = false;
  if(property in subject) {
    var value = subject[property];
    rval = (!_isArray(value) || value.length > 0);
  }
  return rval;
};

jsonld.hasValue = function(subject, property, value) {
  var rval = false;
  if(jsonld.hasProperty(subject, property)) {
    var val = subject[property];
    var isList = _isList(val);
    if(_isArray(val) || isList) {
      if(isList) {
        val = val['@list'];
      }
      for(var i = 0; i < val.length; ++i) {
        if(jsonld.compareValues(value, val[i])) {
          rval = true;
          break;
        }
      }
    } else if(!_isArray(value)) {
      // avoid matching the set of values with an array value parameter
      rval = jsonld.compareValues(value, val);
    }
  }
  return rval;
};

jsonld.addValue = function(subject, property, value, options) {
  options = options || {};
  if(!('propertyIsArray' in options)) {
    options.propertyIsArray = false;
  }
  if(!('allowDuplicate' in options)) {
    options.allowDuplicate = true;
  }

  if(_isArray(value)) {
    if(value.length === 0 && options.propertyIsArray &&
      !(property in subject)) {
      subject[property] = [];
    }
    for(var i = 0; i < value.length; ++i) {
      jsonld.addValue(subject, property, value[i], options);
    }
  } else if(property in subject) {
    // check if subject already has value if duplicates not allowed
    var hasValue = (!options.allowDuplicate &&
      jsonld.hasValue(subject, property, value));

    // make property an array if value not present or always an array
    if(!_isArray(subject[property]) &&
      (!hasValue || options.propertyIsArray)) {
      subject[property] = [subject[property]];
    }

    // add new value
    if(!hasValue) {
      subject[property].push(value);
    }
  } else {
    // add new value as set or single value
    subject[property] = options.propertyIsArray ? [value] : value;
  }
};

jsonld.getValues = function(subject, property) {
  var rval = subject[property] || [];
  if(!_isArray(rval)) {
    rval = [rval];
  }
  return rval;
};

jsonld.removeProperty = function(subject, property) {
  delete subject[property];
};

jsonld.removeValue = function(subject, property, value, options) {
  options = options || {};
  if(!('propertyIsArray' in options)) {
    options.propertyIsArray = false;
  }

  // filter out value
  var values = jsonld.getValues(subject, property).filter(function(e) {
    return !jsonld.compareValues(e, value);
  });

  if(values.length === 0) {
    jsonld.removeProperty(subject, property);
  } else if(values.length === 1 && !options.propertyIsArray) {
    subject[property] = values[0];
  } else {
    subject[property] = values;
  }
};

jsonld.compareValues = function(v1, v2) {
  // 1. equal primitives
  if(v1 === v2) {
    return true;
  }

  // 2. equal @values
  if(_isValue(v1) && _isValue(v2) &&
    v1['@value'] === v2['@value'] &&
    v1['@type'] === v2['@type'] &&
    v1['@language'] === v2['@language'] &&
    v1['@index'] === v2['@index']) {
    return true;
  }

  // 3. equal @ids
  if(_isObject(v1) && ('@id' in v1) && _isObject(v2) && ('@id' in v2)) {
    return v1['@id'] === v2['@id'];
  }

  return false;
};

jsonld.getContextValue = function(ctx, key, type) {
  var rval = null;

  // return null for invalid key
  if(key === null) {
    return rval;
  }

  // get default language
  if(type === '@language' && (type in ctx)) {
    rval = ctx[type];
  }

  // get specific entry information
  if(ctx.mappings[key]) {
    var entry = ctx.mappings[key];

    if(_isUndefined(type)) {
      // return whole entry
      rval = entry;
    } else if(type in entry) {
      // return entry value for type
      rval = entry[type];
    }
  }

  return rval;
};

var _rdfParsers = {};

jsonld.registerRDFParser = function(contentType, parser) {
  _rdfParsers[contentType] = parser;
};

jsonld.unregisterRDFParser = function(contentType) {
  delete _rdfParsers[contentType];
};

var XSD_BOOLEAN = 'http://www.w3.org/2001/XMLSchema#boolean';

var XSD_DOUBLE = 'http://www.w3.org/2001/XMLSchema#double';

var XSD_INTEGER = 'http://www.w3.org/2001/XMLSchema#integer';

var XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';

var RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

var RDF_LIST = RDF + 'List';

var RDF_FIRST = RDF + 'first';

var RDF_REST = RDF + 'rest';

var RDF_NIL = RDF + 'nil';

var RDF_TYPE = RDF + 'type';

var RDF_PLAIN_LITERAL = RDF + 'PlainLiteral';

var RDF_XML_LITERAL = RDF + 'XMLLiteral';

var RDF_OBJECT = RDF + 'object';

var RDF_LANGSTRING = RDF + 'langString';

var LINK_HEADER_REL = 'http://www.w3.org/ns/json-ld#context';

var MAX_CONTEXT_URLS = 10;

var JsonLdError = function(msg, type, details) {
  if(_nodejs) {
    Error.call(this);
    Error.captureStackTrace(this, this.constructor);
  } else if(typeof Error !== 'undefined') {
    this.stack = (new Error()).stack;
  }
  this.name = type || 'jsonld.Error';
  this.message = msg || 'An unspecified JSON-LD error occurred.';
  this.details = details || {};
};

var Processor = function() {};

Processor.prototype.compact = function(
  activeCtx, activeProperty, element, options) {
  // recursively compact array
  if(_isArray(element)) {
    var rval = [];
    for(var i = 0; i < element.length; ++i) {
      // compact, dropping any null values
      var compacted = this.compact(
        activeCtx, activeProperty, element[i], options);
      if(compacted !== null) {
        rval.push(compacted);
      }
    }
    if(options.compactArrays && rval.length === 1) {
      // use single element if no container is specified
      var container = jsonld.getContextValue(
        activeCtx, activeProperty, '@container');
      if(container === null) {
        rval = rval[0];
      }
    }
    return rval;
  }

  // recursively compact object
  if(_isObject(element)) {
    if(options.link && '@id' in element && element['@id'] in options.link) {
      // check for a linked element to reuse
      var linked = options.link[element['@id']];
      for(var i = 0; i < linked.length; ++i) {
        if(linked[i].expanded === element) {
          return linked[i].compacted;
        }
      }
    }

    // do value compaction on @values and subject references
    if(_isValue(element) || _isSubjectReference(element)) {
      var rval = _compactValue(activeCtx, activeProperty, element);
      if(options.link && _isSubjectReference(element)) {
        // store linked element
        if(!(element['@id'] in options.link)) {
          options.link[element['@id']] = [];
        }
        options.link[element['@id']].push({expanded: element, compacted: rval});
      }
      return rval;
    }

    // FIXME: avoid misuse of active property as an expanded property?
    var insideReverse = (activeProperty === '@reverse');

    var rval = {};

    if(options.link && '@id' in element) {
      // store linked element
      if(!(element['@id'] in options.link)) {
        options.link[element['@id']] = [];
      }
      options.link[element['@id']].push({expanded: element, compacted: rval});
    }

    // process element keys in order
    var keys = Object.keys(element).sort();
    for(var ki = 0; ki < keys.length; ++ki) {
      var expandedProperty = keys[ki];
      var expandedValue = element[expandedProperty];

      // compact @id and @type(s)
      if(expandedProperty === '@id' || expandedProperty === '@type') {
        var compactedValue;

        // compact single @id
        if(_isString(expandedValue)) {
          compactedValue = _compactIri(
            activeCtx, expandedValue, null,
            {vocab: (expandedProperty === '@type')});
        } else {
          // expanded value must be a @type array
          compactedValue = [];
          for(var vi = 0; vi < expandedValue.length; ++vi) {
            compactedValue.push(_compactIri(
              activeCtx, expandedValue[vi], null, {vocab: true}));
          }
        }

        // use keyword alias and add value
        var alias = _compactIri(activeCtx, expandedProperty);
        var isArray = (_isArray(compactedValue) && expandedValue.length === 0);
        jsonld.addValue(
          rval, alias, compactedValue, {propertyIsArray: isArray});
        continue;
      }

      // handle @reverse
      if(expandedProperty === '@reverse') {
        // recursively compact expanded value
        var compactedValue = this.compact(
          activeCtx, '@reverse', expandedValue, options);

        // handle double-reversed properties
        for(var compactedProperty in compactedValue) {
          if(activeCtx.mappings[compactedProperty] &&
            activeCtx.mappings[compactedProperty].reverse) {
            var value = compactedValue[compactedProperty];
            var container = jsonld.getContextValue(
              activeCtx, compactedProperty, '@container');
            var useArray = (container === '@set' || !options.compactArrays);
            jsonld.addValue(
              rval, compactedProperty, value, {propertyIsArray: useArray});
            delete compactedValue[compactedProperty];
          }
        }

        if(Object.keys(compactedValue).length > 0) {
          // use keyword alias and add value
          var alias = _compactIri(activeCtx, expandedProperty);
          jsonld.addValue(rval, alias, compactedValue);
        }

        continue;
      }

      // handle @index property
      if(expandedProperty === '@index') {
        // drop @index if inside an @index container
        var container = jsonld.getContextValue(
          activeCtx, activeProperty, '@container');
        if(container === '@index') {
          continue;
        }

        // use keyword alias and add value
        var alias = _compactIri(activeCtx, expandedProperty);
        jsonld.addValue(rval, alias, expandedValue);
        continue;
      }

      // skip array processing for keywords that aren't @graph or @list
      if(expandedProperty !== '@graph' && expandedProperty !== '@list' &&
        _isKeyword(expandedProperty)) {
        // use keyword alias and add value as is
        var alias = _compactIri(activeCtx, expandedProperty);
        jsonld.addValue(rval, alias, expandedValue);
        continue;
      }

      // Note: expanded value must be an array due to expansion algorithm.

      // preserve empty arrays
      if(expandedValue.length === 0) {
        var itemActiveProperty = _compactIri(
          activeCtx, expandedProperty, expandedValue, {vocab: true},
          insideReverse);
        jsonld.addValue(
          rval, itemActiveProperty, expandedValue, {propertyIsArray: true});
      }

      // recusively process array values
      for(var vi = 0; vi < expandedValue.length; ++vi) {
        var expandedItem = expandedValue[vi];

        // compact property and get container type
        var itemActiveProperty = _compactIri(
          activeCtx, expandedProperty, expandedItem, {vocab: true},
          insideReverse);
        var container = jsonld.getContextValue(
          activeCtx, itemActiveProperty, '@container');

        // get @list value if appropriate
        var isList = _isList(expandedItem);
        var list = null;
        if(isList) {
          list = expandedItem['@list'];
        }

        // recursively compact expanded item
        var compactedItem = this.compact(
          activeCtx, itemActiveProperty, isList ? list : expandedItem, options);

        // handle @list
        if(isList) {
          // ensure @list value is an array
          if(!_isArray(compactedItem)) {
            compactedItem = [compactedItem];
          }

          if(container !== '@list') {
            // wrap using @list alias
            var wrapper = {};
            wrapper[_compactIri(activeCtx, '@list')] = compactedItem;
            compactedItem = wrapper;

            // include @index from expanded @list, if any
            if('@index' in expandedItem) {
              compactedItem[_compactIri(activeCtx, '@index')] =
                expandedItem['@index'];
            }
          } else if(itemActiveProperty in rval) {
            // can't use @list container for more than 1 list
            throw new JsonLdError(
              'JSON-LD compact error; property has a "@list" @container ' +
              'rule but there is more than a single @list that matches ' +
              'the compacted term in the document. Compaction might mix ' +
              'unwanted items into the list.',
              'jsonld.SyntaxError', {code: 'compaction to list of lists'});
          }
        }

        // handle language and index maps
        if(container === '@language' || container === '@index') {
          // get or create the map object
          var mapObject;
          if(itemActiveProperty in rval) {
            mapObject = rval[itemActiveProperty];
          } else {
            rval[itemActiveProperty] = mapObject = {};
          }

          // if container is a language map, simplify compacted value to
          // a simple string
          if(container === '@language' && _isValue(compactedItem)) {
            compactedItem = compactedItem['@value'];
          }

          // add compact value to map object using key from expanded value
          // based on the container type
          jsonld.addValue(mapObject, expandedItem[container], compactedItem);
        } else {
          // use an array if: compactArrays flag is false,
          // @container is @set or @list , value is an empty
          // array, or key is @graph
          var isArray = (!options.compactArrays || container === '@set' ||
            container === '@list' ||
            (_isArray(compactedItem) && compactedItem.length === 0) ||
            expandedProperty === '@list' || expandedProperty === '@graph');

          // add compact value
          jsonld.addValue(
            rval, itemActiveProperty, compactedItem,
            {propertyIsArray: isArray});
        }
      }
    }

    return rval;
  }

  // only primitives remain which are already compact
  return element;
};

Processor.prototype.expand = function(
  activeCtx, activeProperty, element, options, insideList) {
  var self = this;

  // nothing to expand
  if(element === null || element === undefined) {
    return null;
  }

  if(!_isArray(element) && !_isObject(element)) {
    // drop free-floating scalars that are not in lists
    if(!insideList && (activeProperty === null ||
      _expandIri(activeCtx, activeProperty, {vocab: true}) === '@graph')) {
      return null;
    }

    // expand element according to value expansion rules
    return _expandValue(activeCtx, activeProperty, element);
  }

  // recursively expand array
  if(_isArray(element)) {
    var rval = [];
    var container = jsonld.getContextValue(
      activeCtx, activeProperty, '@container');
    insideList = insideList || container === '@list';
    for(var i = 0; i < element.length; ++i) {
      // expand element
      var e = self.expand(activeCtx, activeProperty, element[i], options);
      if(insideList && (_isArray(e) || _isList(e))) {
        // lists of lists are illegal
        throw new JsonLdError(
          'Invalid JSON-LD syntax; lists of lists are not permitted.',
          'jsonld.SyntaxError', {code: 'list of lists'});
      }
      // drop null values
      if(e !== null) {
        if(_isArray(e)) {
          rval = rval.concat(e);
        } else {
          rval.push(e);
        }
      }
    }
    return rval;
  }

  // recursively expand object:

  // if element has a context, process it
  if('@context' in element) {
    activeCtx = self.processContext(activeCtx, element['@context'], options);
  }

  // expand the active property
  var expandedActiveProperty = _expandIri(
    activeCtx, activeProperty, {vocab: true});

  var rval = {};
  var keys = Object.keys(element).sort();
  for(var ki = 0; ki < keys.length; ++ki) {
    var key = keys[ki];
    var value = element[key];
    var expandedValue;

    // skip @context
    if(key === '@context') {
      continue;
    }

    // expand property
    var expandedProperty = _expandIri(activeCtx, key, {vocab: true});

    // drop non-absolute IRI keys that aren't keywords
    if(expandedProperty === null ||
      !(_isAbsoluteIri(expandedProperty) || _isKeyword(expandedProperty))) {
      continue;
    }

    if(_isKeyword(expandedProperty)) {
      if(expandedActiveProperty === '@reverse') {
        throw new JsonLdError(
          'Invalid JSON-LD syntax; a keyword cannot be used as a @reverse ' +
          'property.', 'jsonld.SyntaxError',
          {code: 'invalid reverse property map', value: value});
      }
      if(expandedProperty in rval) {
        throw new JsonLdError(
          'Invalid JSON-LD syntax; colliding keywords detected.',
          'jsonld.SyntaxError',
          {code: 'colliding keywords', keyword: expandedProperty});
      }
    }

    // syntax error if @id is not a string
    if(expandedProperty === '@id' && !_isString(value)) {
      if(!options.isFrame) {
        throw new JsonLdError(
          'Invalid JSON-LD syntax; "@id" value must a string.',
          'jsonld.SyntaxError', {code: 'invalid @id value', value: value});
      }
      if(!_isObject(value)) {
        throw new JsonLdError(
          'Invalid JSON-LD syntax; "@id" value must be a string or an ' +
          'object.', 'jsonld.SyntaxError',
          {code: 'invalid @id value', value: value});
      }
    }

    if(expandedProperty === '@type') {
      _validateTypeValue(value);
    }

    // @graph must be an array or an object
    if(expandedProperty === '@graph' &&
      !(_isObject(value) || _isArray(value))) {
      throw new JsonLdError(
        'Invalid JSON-LD syntax; "@graph" value must not be an ' +
        'object or an array.',
        'jsonld.SyntaxError', {code: 'invalid @graph value', value: value});
    }

    // @value must not be an object or an array
    if(expandedProperty === '@value' &&
      (_isObject(value) || _isArray(value))) {
      throw new JsonLdError(
        'Invalid JSON-LD syntax; "@value" value must not be an ' +
        'object or an array.',
        'jsonld.SyntaxError',
        {code: 'invalid value object value', value: value});
    }

    // @language must be a string
    if(expandedProperty === '@language') {
      if(value === null) {
        // drop null @language values, they expand as if they didn't exist
        continue;
      }
      if(!_isString(value)) {
        throw new JsonLdError(
          'Invalid JSON-LD syntax; "@language" value must be a string.',
          'jsonld.SyntaxError',
          {code: 'invalid language-tagged string', value: value});
      }
      // ensure language value is lowercase
      value = value.toLowerCase();
    }

    // @index must be a string
    if(expandedProperty === '@index') {
      if(!_isString(value)) {
        throw new JsonLdError(
          'Invalid JSON-LD syntax; "@index" value must be a string.',
          'jsonld.SyntaxError',
          {code: 'invalid @index value', value: value});
      }
    }

    // @reverse must be an object
    if(expandedProperty === '@reverse') {
      if(!_isObject(value)) {
        throw new JsonLdError(
          'Invalid JSON-LD syntax; "@reverse" value must be an object.',
          'jsonld.SyntaxError', {code: 'invalid @reverse value', value: value});
      }

      expandedValue = self.expand(activeCtx, '@reverse', value, options);

      // properties double-reversed
      if('@reverse' in expandedValue) {
        for(var property in expandedValue['@reverse']) {
          jsonld.addValue(
            rval, property, expandedValue['@reverse'][property],
            {propertyIsArray: true});
        }
      }

      // FIXME: can this be merged with code below to simplify?
      // merge in all reversed properties
      var reverseMap = rval['@reverse'] || null;
      for(var property in expandedValue) {
        if(property === '@reverse') {
          continue;
        }
        if(reverseMap === null) {
          reverseMap = rval['@reverse'] = {};
        }
        jsonld.addValue(reverseMap, property, [], {propertyIsArray: true});
        var items = expandedValue[property];
        for(var ii = 0; ii < items.length; ++ii) {
          var item = items[ii];
          if(_isValue(item) || _isList(item)) {
            throw new JsonLdError(
              'Invalid JSON-LD syntax; "@reverse" value must not be a ' +
              '@value or an @list.', 'jsonld.SyntaxError',
              {code: 'invalid reverse property value', value: expandedValue});
          }
          jsonld.addValue(
            reverseMap, property, item, {propertyIsArray: true});
        }
      }

      continue;
    }

    var container = jsonld.getContextValue(activeCtx, key, '@container');

    if(container === '@language' && _isObject(value)) {
      // handle language map container (skip if value is not an object)
      expandedValue = _expandLanguageMap(value);
    } else if(container === '@index' && _isObject(value)) {
      // handle index container (skip if value is not an object)
      expandedValue = (function _expandIndexMap(activeProperty) {
        var rval = [];
        var keys = Object.keys(value).sort();
        for(var ki = 0; ki < keys.length; ++ki) {
          var key = keys[ki];
          var val = value[key];
          if(!_isArray(val)) {
            val = [val];
          }
          val = self.expand(activeCtx, activeProperty, val, options, false);
          for(var vi = 0; vi < val.length; ++vi) {
            var item = val[vi];
            if(!('@index' in item)) {
              item['@index'] = key;
            }
            rval.push(item);
          }
        }
        return rval;
      })(key);
    } else {
      // recurse into @list or @set
      var isList = (expandedProperty === '@list');
      if(isList || expandedProperty === '@set') {
        var nextActiveProperty = activeProperty;
        if(isList && expandedActiveProperty === '@graph') {
          nextActiveProperty = null;
        }
        expandedValue = self.expand(
          activeCtx, nextActiveProperty, value, options, isList);
        if(isList && _isList(expandedValue)) {
          throw new JsonLdError(
            'Invalid JSON-LD syntax; lists of lists are not permitted.',
            'jsonld.SyntaxError', {code: 'list of lists'});
        }
      } else {
        // recursively expand value with key as new active property
        expandedValue = self.expand(activeCtx, key, value, options, false);
      }
    }

    // drop null values if property is not @value
    if(expandedValue === null && expandedProperty !== '@value') {
      continue;
    }

    // convert expanded value to @list if container specifies it
    if(expandedProperty !== '@list' && !_isList(expandedValue) &&
      container === '@list') {
      // ensure expanded value is an array
      expandedValue = (_isArray(expandedValue) ?
        expandedValue : [expandedValue]);
      expandedValue = {'@list': expandedValue};
    }

    // FIXME: can this be merged with code above to simplify?
    // merge in reverse properties
    if(activeCtx.mappings[key] && activeCtx.mappings[key].reverse) {
      var reverseMap = rval['@reverse'] = rval['@reverse'] || {};
      if(!_isArray(expandedValue)) {
        expandedValue = [expandedValue];
      }
      for(var ii = 0; ii < expandedValue.length; ++ii) {
        var item = expandedValue[ii];
        if(_isValue(item) || _isList(item)) {
          throw new JsonLdError(
            'Invalid JSON-LD syntax; "@reverse" value must not be a ' +
            '@value or an @list.', 'jsonld.SyntaxError',
            {code: 'invalid reverse property value', value: expandedValue});
        }
        jsonld.addValue(
          reverseMap, expandedProperty, item, {propertyIsArray: true});
      }
      continue;
    }

    // add value for property
    // use an array except for certain keywords
    var useArray =
      ['@index', '@id', '@type', '@value', '@language'].indexOf(
        expandedProperty) === -1;
    jsonld.addValue(
      rval, expandedProperty, expandedValue, {propertyIsArray: useArray});
  }

  // get property count on expanded output
  keys = Object.keys(rval);
  var count = keys.length;

  if('@value' in rval) {
    // @value must only have @language or @type
    if('@type' in rval && '@language' in rval) {
      throw new JsonLdError(
        'Invalid JSON-LD syntax; an element containing "@value" may not ' +
        'contain both "@type" and "@language".',
        'jsonld.SyntaxError', {code: 'invalid value object', element: rval});
    }
    var validCount = count - 1;
    if('@type' in rval) {
      validCount -= 1;
    }
    if('@index' in rval) {
      validCount -= 1;
    }
    if('@language' in rval) {
      validCount -= 1;
    }
    if(validCount !== 0) {
      throw new JsonLdError(
        'Invalid JSON-LD syntax; an element containing "@value" may only ' +
        'have an "@index" property and at most one other property ' +
        'which can be "@type" or "@language".',
        'jsonld.SyntaxError', {code: 'invalid value object', element: rval});
    }
    // drop null @values
    if(rval['@value'] === null) {
      rval = null;
    } else if('@language' in rval && !_isString(rval['@value'])) {
      // if @language is present, @value must be a string
      throw new JsonLdError(
        'Invalid JSON-LD syntax; only strings may be language-tagged.',
        'jsonld.SyntaxError',
        {code: 'invalid language-tagged value', element: rval});
    } else if('@type' in rval && (!_isAbsoluteIri(rval['@type']) ||
      rval['@type'].indexOf('_:') === 0)) {
      throw new JsonLdError(
        'Invalid JSON-LD syntax; an element containing "@value" and "@type" ' +
        'must have an absolute IRI for the value of "@type".',
        'jsonld.SyntaxError', {code: 'invalid typed value', element: rval});
    }
  } else if('@type' in rval && !_isArray(rval['@type'])) {
    // convert @type to an array
    rval['@type'] = [rval['@type']];
  } else if('@set' in rval || '@list' in rval) {
    // handle @set and @list
    if(count > 1 && !(count === 2 && '@index' in rval)) {
      throw new JsonLdError(
        'Invalid JSON-LD syntax; if an element has the property "@set" ' +
        'or "@list", then it can have at most one other property that is ' +
        '"@index".', 'jsonld.SyntaxError',
        {code: 'invalid set or list object', element: rval});
    }
    // optimize away @set
    if('@set' in rval) {
      rval = rval['@set'];
      keys = Object.keys(rval);
      count = keys.length;
    }
  } else if(count === 1 && '@language' in rval) {
    // drop objects with only @language
    rval = null;
  }

  // drop certain top-level objects that do not occur in lists
  if(_isObject(rval) &&
    !options.keepFreeFloatingNodes && !insideList &&
    (activeProperty === null || expandedActiveProperty === '@graph')) {
    // drop empty object, top-level @value/@list, or object with only @id
    if(count === 0 || '@value' in rval || '@list' in rval ||
      (count === 1 && '@id' in rval)) {
      rval = null;
    }
  }

  return rval;
};

Processor.prototype.createNodeMap = function(input, options) {
  options = options || {};

  // produce a map of all subjects and name each bnode
  var issuer = options.namer || options.issuer || new IdentifierIssuer('_:b');
  var graphs = {'@default': {}};
  _createNodeMap(input, graphs, '@default', issuer);

  // add all non-default graphs to default graph
  return _mergeNodeMaps(graphs);
};

Processor.prototype.flatten = function(input) {
  var defaultGraph = this.createNodeMap(input);

  // produce flattened output
  var flattened = [];
  var keys = Object.keys(defaultGraph).sort();
  for(var ki = 0; ki < keys.length; ++ki) {
    var node = defaultGraph[keys[ki]];
    // only add full subjects to top-level
    if(!_isSubjectReference(node)) {
      flattened.push(node);
    }
  }
  return flattened;
};

Processor.prototype.frame = function(input, frame, options) {
  // create framing state
  var state = {
    options: options,
    graphs: {'@default': {}, '@merged': {}},
    subjectStack: [],
    link: {}
  };

  // produce a map of all graphs and name each bnode
  // FIXME: currently uses subjects from @merged graph only
  var issuer = new IdentifierIssuer('_:b');
  _createNodeMap(input, state.graphs, '@merged', issuer);
  state.subjects = state.graphs['@merged'];

  // frame the subjects
  var framed = [];
  _frame(state, Object.keys(state.subjects).sort(), frame, framed, null);
  return framed;
};

Processor.prototype.normalize = function(dataset, options, callback) {
  if(options.algorithm === 'URDNA2015') {
    return new URDNA2015(options).main(dataset, callback);
  }
  if(options.algorithm === 'URGNA2012') {
    return new URGNA2012(options).main(dataset, callback);
  }
  callback(new Error(
    'Invalid RDF Dataset Normalization algorithm: ' + options.algorithm));
};

Processor.prototype.fromRDF = function(dataset, options, callback) {
  var defaultGraph = {};
  var graphMap = {'@default': defaultGraph};
  var referencedOnce = {};

  for(var name in dataset) {
    var graph = dataset[name];
    if(!(name in graphMap)) {
      graphMap[name] = {};
    }
    if(name !== '@default' && !(name in defaultGraph)) {
      defaultGraph[name] = {'@id': name};
    }
    var nodeMap = graphMap[name];
    for(var ti = 0; ti < graph.length; ++ti) {
      var triple = graph[ti];

      // get subject, predicate, object
      var s = triple.subject.value;
      var p = triple.predicate.value;
      var o = triple.object;

      if(!(s in nodeMap)) {
        nodeMap[s] = {'@id': s};
      }
      var node = nodeMap[s];

      var objectIsId = (o.type === 'IRI' || o.type === 'blank node');
      if(objectIsId && !(o.value in nodeMap)) {
        nodeMap[o.value] = {'@id': o.value};
      }

      if(p === RDF_TYPE && !options.useRdfType && objectIsId) {
        jsonld.addValue(node, '@type', o.value, {propertyIsArray: true});
        continue;
      }

      var value = _RDFToObject(o, options.useNativeTypes);
      jsonld.addValue(node, p, value, {propertyIsArray: true});

      // object may be an RDF list/partial list node but we can't know easily
      // until all triples are read
      if(objectIsId) {
        if(o.value === RDF_NIL) {
          // track rdf:nil uniquely per graph
          var object = nodeMap[o.value];
          if(!('usages' in object)) {
            object.usages = [];
          }
          object.usages.push({
            node: node,
            property: p,
            value: value
          });
        } else if(o.value in referencedOnce) {
          // object referenced more than once
          referencedOnce[o.value] = false;
        } else {
          // keep track of single reference
          referencedOnce[o.value] = {
            node: node,
            property: p,
            value: value
          };
        }
      }
    }
  }

  // convert linked lists to @list arrays
  for(var name in graphMap) {
    var graphObject = graphMap[name];

    // no @lists to be converted, continue
    if(!(RDF_NIL in graphObject)) {
      continue;
    }

    // iterate backwards through each RDF list
    var nil = graphObject[RDF_NIL];
    for(var i = 0; i < nil.usages.length; ++i) {
      var usage = nil.usages[i];
      var node = usage.node;
      var property = usage.property;
      var head = usage.value;
      var list = [];
      var listNodes = [];

      // ensure node is a well-formed list node; it must:
      // 1. Be referenced only once.
      // 2. Have an array for rdf:first that has 1 item.
      // 3. Have an array for rdf:rest that has 1 item.
      // 4. Have no keys other than: @id, rdf:first, rdf:rest, and,
      //   optionally, @type where the value is rdf:List.
      var nodeKeyCount = Object.keys(node).length;
      while(property === RDF_REST &&
        _isObject(referencedOnce[node['@id']]) &&
        _isArray(node[RDF_FIRST]) && node[RDF_FIRST].length === 1 &&
        _isArray(node[RDF_REST]) && node[RDF_REST].length === 1 &&
        (nodeKeyCount === 3 || (nodeKeyCount === 4 && _isArray(node['@type']) &&
          node['@type'].length === 1 && node['@type'][0] === RDF_LIST))) {
        list.push(node[RDF_FIRST][0]);
        listNodes.push(node['@id']);

        // get next node, moving backwards through list
        usage = referencedOnce[node['@id']];
        node = usage.node;
        property = usage.property;
        head = usage.value;
        nodeKeyCount = Object.keys(node).length;

        // if node is not a blank node, then list head found
        if(node['@id'].indexOf('_:') !== 0) {
          break;
        }
      }

      // the list is nested in another list
      if(property === RDF_FIRST) {
        // empty list
        if(node['@id'] === RDF_NIL) {
          // can't convert rdf:nil to a @list object because it would
          // result in a list of lists which isn't supported
          continue;
        }

        // preserve list head
        head = graphObject[head['@id']][RDF_REST][0];
        list.pop();
        listNodes.pop();
      }

      // transform list into @list object
      delete head['@id'];
      head['@list'] = list.reverse();
      for(var j = 0; j < listNodes.length; ++j) {
        delete graphObject[listNodes[j]];
      }
    }

    delete nil.usages;
  }

  var result = [];
  var subjects = Object.keys(defaultGraph).sort();
  for(var i = 0; i < subjects.length; ++i) {
    var subject = subjects[i];
    var node = defaultGraph[subject];
    if(subject in graphMap) {
      var graph = node['@graph'] = [];
      var graphObject = graphMap[subject];
      var subjects_ = Object.keys(graphObject).sort();
      for(var si = 0; si < subjects_.length; ++si) {
        var node_ = graphObject[subjects_[si]];
        // only add full subjects to top-level
        if(!_isSubjectReference(node_)) {
          graph.push(node_);
        }
      }
    }
    // only add full subjects to top-level
    if(!_isSubjectReference(node)) {
      result.push(node);
    }
  }

  callback(null, result);
};

Processor.prototype.toRDF = function(input, options) {
  // create node map for default graph (and any named graphs)
  var issuer = new IdentifierIssuer('_:b');
  var nodeMap = {'@default': {}};
  _createNodeMap(input, nodeMap, '@default', issuer);

  var dataset = {};
  var graphNames = Object.keys(nodeMap).sort();
  for(var i = 0; i < graphNames.length; ++i) {
    var graphName = graphNames[i];
    // skip relative IRIs
    if(graphName === '@default' || _isAbsoluteIri(graphName)) {
      dataset[graphName] = _graphToRDF(nodeMap[graphName], issuer, options);
    }
  }
  return dataset;
};

Processor.prototype.processContext = function(activeCtx, localCtx, options) {
  // normalize local context to an array of @context objects
  if(_isObject(localCtx) && '@context' in localCtx &&
    _isArray(localCtx['@context'])) {
    localCtx = localCtx['@context'];
  }
  var ctxs = _isArray(localCtx) ? localCtx : [localCtx];

  // no contexts in array, clone existing context
  if(ctxs.length === 0) {
    return activeCtx.clone();
  }

  // process each context in order, update active context
  // on each iteration to ensure proper caching
  var rval = activeCtx;
  for(var i = 0; i < ctxs.length; ++i) {
    var ctx = ctxs[i];

    // reset to initial context
    if(ctx === null) {
      rval = activeCtx = _getInitialContext(options);
      continue;
    }

    // dereference @context key if present
    if(_isObject(ctx) && '@context' in ctx) {
      ctx = ctx['@context'];
    }

    // context must be an object by now, all URLs retrieved before this call
    if(!_isObject(ctx)) {
      throw new JsonLdError(
        'Invalid JSON-LD syntax; @context must be an object.',
        'jsonld.SyntaxError', {code: 'invalid local context', context: ctx});
    }

    // get context from cache if available
    if(jsonld.cache.activeCtx) {
      var cached = jsonld.cache.activeCtx.get(activeCtx, ctx);
      if(cached) {
        rval = activeCtx = cached;
        continue;
      }
    }

    // update active context and clone new one before updating
    activeCtx = rval;
    rval = rval.clone();

    // define context mappings for keys in local context
    var defined = {};

    // handle @base
    if('@base' in ctx) {
      var base = ctx['@base'];

      // clear base
      if(base === null) {
        base = null;
      } else if(!_isString(base)) {
        throw new JsonLdError(
          'Invalid JSON-LD syntax; the value of "@base" in a ' +
          '@context must be a string or null.',
          'jsonld.SyntaxError', {code: 'invalid base IRI', context: ctx});
      } else if(base !== '' && !_isAbsoluteIri(base)) {
        throw new JsonLdError(
          'Invalid JSON-LD syntax; the value of "@base" in a ' +
          '@context must be an absolute IRI or the empty string.',
          'jsonld.SyntaxError', {code: 'invalid base IRI', context: ctx});
      }

      if(base !== null) {
        base = jsonld.url.parse(base || '');
      }
      rval['@base'] = base;
      defined['@base'] = true;
    }

    // handle @vocab
    if('@vocab' in ctx) {
      var value = ctx['@vocab'];
      if(value === null) {
        delete rval['@vocab'];
      } else if(!_isString(value)) {
        throw new JsonLdError(
          'Invalid JSON-LD syntax; the value of "@vocab" in a ' +
          '@context must be a string or null.',
          'jsonld.SyntaxError', {code: 'invalid vocab mapping', context: ctx});
      } else if(!_isAbsoluteIri(value)) {
        throw new JsonLdError(
          'Invalid JSON-LD syntax; the value of "@vocab" in a ' +
          '@context must be an absolute IRI.',
          'jsonld.SyntaxError', {code: 'invalid vocab mapping', context: ctx});
      } else {
        rval['@vocab'] = value;
      }
      defined['@vocab'] = true;
    }

    // handle @language
    if('@language' in ctx) {
      var value = ctx['@language'];
      if(value === null) {
        delete rval['@language'];
      } else if(!_isString(value)) {
        throw new JsonLdError(
          'Invalid JSON-LD syntax; the value of "@language" in a ' +
          '@context must be a string or null.',
          'jsonld.SyntaxError',
          {code: 'invalid default language', context: ctx});
      } else {
        rval['@language'] = value.toLowerCase();
      }
      defined['@language'] = true;
    }

    // process all other keys
    for(var key in ctx) {
      _createTermDefinition(rval, ctx, key, defined);
    }

    // cache result
    if(jsonld.cache.activeCtx) {
      jsonld.cache.activeCtx.set(activeCtx, ctx, rval);
    }
  }

  return rval;
};

function _expandLanguageMap(languageMap) {
  var rval = [];
  var keys = Object.keys(languageMap).sort();
  for(var ki = 0; ki < keys.length; ++ki) {
    var key = keys[ki];
    var val = languageMap[key];
    if(!_isArray(val)) {
      val = [val];
    }
    for(var vi = 0; vi < val.length; ++vi) {
      var item = val[vi];
      if(item === null) {
          // null values are allowed (8.5) but ignored (3.1)
          continue;
      }
      if(!_isString(item)) {
        throw new JsonLdError(
          'Invalid JSON-LD syntax; language map values must be strings.',
          'jsonld.SyntaxError',
          {code: 'invalid language map value', languageMap: languageMap});
      }
      rval.push({
        '@value': item,
        '@language': key.toLowerCase()
      });
    }
  }
  return rval;
}

function _labelBlankNodes(issuer, element) {
  if(_isArray(element)) {
    for(var i = 0; i < element.length; ++i) {
      element[i] = _labelBlankNodes(issuer, element[i]);
    }
  } else if(_isList(element)) {
    element['@list'] = _labelBlankNodes(issuer, element['@list']);
  } else if(_isObject(element)) {
    // relabel blank node
    if(_isBlankNode(element)) {
      element['@id'] = issuer.getId(element['@id']);
    }

    // recursively apply to all keys
    var keys = Object.keys(element).sort();
    for(var ki = 0; ki < keys.length; ++ki) {
      var key = keys[ki];
      if(key !== '@id') {
        element[key] = _labelBlankNodes(issuer, element[key]);
      }
    }
  }

  return element;
}

function _expandValue(activeCtx, activeProperty, value) {
  // nothing to expand
  if(value === null || value === undefined) {
    return null;
  }

  // special-case expand @id and @type (skips '@id' expansion)
  var expandedProperty = _expandIri(activeCtx, activeProperty, {vocab: true});
  if(expandedProperty === '@id') {
    return _expandIri(activeCtx, value, {base: true});
  } else if(expandedProperty === '@type') {
    return _expandIri(activeCtx, value, {vocab: true, base: true});
  }

  // get type definition from context
  var type = jsonld.getContextValue(activeCtx, activeProperty, '@type');

  // do @id expansion (automatic for @graph)
  if(type === '@id' || (expandedProperty === '@graph' && _isString(value))) {
    return {'@id': _expandIri(activeCtx, value, {base: true})};
  }
  // do @id expansion w/vocab
  if(type === '@vocab') {
    return {'@id': _expandIri(activeCtx, value, {vocab: true, base: true})};
  }

  // do not expand keyword values
  if(_isKeyword(expandedProperty)) {
    return value;
  }

  var rval = {};

  if(type !== null) {
    // other type
    rval['@type'] = type;
  } else if(_isString(value)) {
    // check for language tagging for strings
    var language = jsonld.getContextValue(
      activeCtx, activeProperty, '@language');
    if(language !== null) {
      rval['@language'] = language;
    }
  }
  // do conversion of values that aren't basic JSON types to strings
  if(['boolean', 'number', 'string'].indexOf(typeof value) === -1) {
    value = value.toString();
  }
  rval['@value'] = value;

  return rval;
}

function _graphToRDF(graph, issuer, options) {
  var rval = [];

  var ids = Object.keys(graph).sort();
  for(var i = 0; i < ids.length; ++i) {
    var id = ids[i];
    var node = graph[id];
    var properties = Object.keys(node).sort();
    for(var pi = 0; pi < properties.length; ++pi) {
      var property = properties[pi];
      var items = node[property];
      if(property === '@type') {
        property = RDF_TYPE;
      } else if(_isKeyword(property)) {
        continue;
      }

      for(var ii = 0; ii < items.length; ++ii) {
        var item = items[ii];

        // RDF subject
        var subject = {};
        subject.type = (id.indexOf('_:') === 0) ? 'blank node' : 'IRI';
        subject.value = id;

        // skip relative IRI subjects
        if(!_isAbsoluteIri(id)) {
          continue;
        }

        // RDF predicate
        var predicate = {};
        predicate.type = (property.indexOf('_:') === 0) ? 'blank node' : 'IRI';
        predicate.value = property;

        // skip relative IRI predicates
        if(!_isAbsoluteIri(property)) {
          continue;
        }

        // skip blank node predicates unless producing generalized RDF
        if(predicate.type === 'blank node' && !options.produceGeneralizedRdf) {
          continue;
        }

        // convert @list to triples
        if(_isList(item)) {
          _listToRDF(item['@list'], issuer, subject, predicate, rval);
        } else {
          // convert value or node object to triple
          var object = _objectToRDF(item);
          // skip null objects (they are relative IRIs)
          if(object) {
            rval.push({subject: subject, predicate: predicate, object: object});
          }
        }
      }
    }
  }

  return rval;
}

function _listToRDF(list, issuer, subject, predicate, triples) {
  var first = {type: 'IRI', value: RDF_FIRST};
  var rest = {type: 'IRI', value: RDF_REST};
  var nil = {type: 'IRI', value: RDF_NIL};

  for(var i = 0; i < list.length; ++i) {
    var item = list[i];

    var blankNode = {type: 'blank node', value: issuer.getId()};
    triples.push({subject: subject, predicate: predicate, object: blankNode});

    subject = blankNode;
    predicate = first;
    var object = _objectToRDF(item);

    // skip null objects (they are relative IRIs)
    if(object) {
      triples.push({subject: subject, predicate: predicate, object: object});
    }

    predicate = rest;
  }

  triples.push({subject: subject, predicate: predicate, object: nil});
}

function _objectToRDF(item) {
  var object = {};

  // convert value object to RDF
  if(_isValue(item)) {
    object.type = 'literal';
    var value = item['@value'];
    var datatype = item['@type'] || null;

    // convert to XSD datatypes as appropriate
    if(_isBoolean(value)) {
      object.value = value.toString();
      object.datatype = datatype || XSD_BOOLEAN;
    } else if(_isDouble(value) || datatype === XSD_DOUBLE) {
      if(!_isDouble(value)) {
        value = parseFloat(value);
      }
      // canonical double representation
      object.value = value.toExponential(15).replace(/(\d)0*e\+?/, '$1E');
      object.datatype = datatype || XSD_DOUBLE;
    } else if(_isNumber(value)) {
      object.value = value.toFixed(0);
      object.datatype = datatype || XSD_INTEGER;
    } else if('@language' in item) {
      object.value = value;
      object.datatype = datatype || RDF_LANGSTRING;
      object.language = item['@language'];
    } else {
      object.value = value;
      object.datatype = datatype || XSD_STRING;
    }
  } else {
    // convert string/node object to RDF
    var id = _isObject(item) ? item['@id'] : item;
    object.type = (id.indexOf('_:') === 0) ? 'blank node' : 'IRI';
    object.value = id;
  }

  // skip relative IRIs
  if(object.type === 'IRI' && !_isAbsoluteIri(object.value)) {
    return null;
  }

  return object;
}

function _RDFToObject(o, useNativeTypes) {
  // convert IRI/blank node object to JSON-LD
  if(o.type === 'IRI' || o.type === 'blank node') {
    return {'@id': o.value};
  }

  // convert literal to JSON-LD
  var rval = {'@value': o.value};

  // add language
  if(o.language) {
    rval['@language'] = o.language;
  } else {
    var type = o.datatype;
    if(!type) {
      type = XSD_STRING;
    }
    // use native types for certain xsd types
    if(useNativeTypes) {
      if(type === XSD_BOOLEAN) {
        if(rval['@value'] === 'true') {
          rval['@value'] = true;
        } else if(rval['@value'] === 'false') {
          rval['@value'] = false;
        }
      } else if(_isNumeric(rval['@value'])) {
        if(type === XSD_INTEGER) {
          var i = parseInt(rval['@value'], 10);
          if(i.toFixed(0) === rval['@value']) {
            rval['@value'] = i;
          }
        } else if(type === XSD_DOUBLE) {
          rval['@value'] = parseFloat(rval['@value']);
        }
      }
      // do not add native type
      if([XSD_BOOLEAN, XSD_INTEGER, XSD_DOUBLE, XSD_STRING]
        .indexOf(type) === -1) {
        rval['@type'] = type;
      }
    } else if(type !== XSD_STRING) {
      rval['@type'] = type;
    }
  }

  return rval;
}

function _compareRDFTriples(t1, t2) {
  var attrs = ['subject', 'predicate', 'object'];
  for(var i = 0; i < attrs.length; ++i) {
    var attr = attrs[i];
    if(t1[attr].type !== t2[attr].type || t1[attr].value !== t2[attr].value) {
      return false;
    }
  }
  if(t1.object.language !== t2.object.language) {
    return false;
  }
  if(t1.object.datatype !== t2.object.datatype) {
    return false;
  }
  return true;
}

var URDNA2015 = (function() {

var POSITIONS = {'subject': 's', 'object': 'o', 'name': 'g'};

var Normalize = function(options) {
  options = options || {};
  this.name = 'URDNA2015';
  this.options = options;
  this.blankNodeInfo = {};
  this.hashToBlankNodes = {};
  this.canonicalIssuer = new IdentifierIssuer('_:c14n');
  this.quads = [];
  this.schedule = {};
  if('maxCallStackDepth' in options) {
    this.schedule.MAX_DEPTH = options.maxCallStackDepth;
  } else {
    this.schedule.MAX_DEPTH = 500;
  }
  if('maxTotalCallStackDepth' in options) {
    this.schedule.MAX_TOTAL_DEPTH = options.maxCallStackDepth;
  } else {
    this.schedule.MAX_TOTAL_DEPTH = 0xFFFFFFFF;
  }
  this.schedule.depth = 0;
  this.schedule.totalDepth = 0;
  if('timeSlice' in options) {
    this.schedule.timeSlice = options.timeSlice;
  } else {
    // milliseconds
    this.schedule.timeSlice = 10;
  }
};

// do some work in a time slice, but in serial
Normalize.prototype.doWork = function(fn, callback) {
  var schedule = this.schedule;

  if(schedule.totalDepth >= schedule.MAX_TOTAL_DEPTH) {
    return callback(new Error(
      'Maximum total call stack depth exceeded; normalization aborting.'));
  }

  (function work() {
    if(schedule.depth === schedule.MAX_DEPTH) {
      // stack too deep, run on next tick
      schedule.depth = 0;
      schedule.running = false;
      return jsonld.nextTick(work);
    }

    // if not yet running, force run
    var now = new Date().getTime();
    if(!schedule.running) {
      schedule.start = new Date().getTime();
      schedule.deadline = schedule.start + schedule.timeSlice;
    }

    // TODO: should also include an estimate of expectedWorkTime
    if(now < schedule.deadline) {
      schedule.running = true;
      schedule.depth++;
      schedule.totalDepth++;
      return fn(function(err, result) {
        schedule.depth--;
        schedule.totalDepth--;
        callback(err, result);
      });
    }

    // not enough time left in this slice, run after letting browser
    // do some other things
    schedule.depth = 0;
    schedule.running = false;
    jsonld.setImmediate(work);
  })();
};

// asynchronously loop
Normalize.prototype.forEach = function(iterable, fn, callback) {
  var self = this;
  var iterator;
  var idx = 0;
  var length;
  if(_isArray(iterable)) {
    length = iterable.length;
    iterator = function() {
      if(idx === length) {
        return false;
      }
      iterator.value = iterable[idx++];
      iterator.key = idx;
      return true;
    };
  } else {
    var keys = Object.keys(iterable);
    length = keys.length;
    iterator = function() {
      if(idx === length) {
        return false;
      }
      iterator.key = keys[idx++];
      iterator.value = iterable[iterator.key];
      return true;
    };
  }

  (function iterate(err, result) {
    if(err) {
      return callback(err);
    }
    if(iterator()) {
      return self.doWork(function() {
        fn(iterator.value, iterator.key, iterate);
      });
    }
    callback();
  })();
};

// asynchronous waterfall
Normalize.prototype.waterfall = function(fns, callback) {
  var self = this;
  self.forEach(fns, function(fn, idx, callback) {
    self.doWork(fn, callback);
  }, callback);
};

// asynchronous while
Normalize.prototype.whilst = function(condition, fn, callback) {
  var self = this;
  (function loop(err) {
    if(err) {
      return callback(err);
    }
    if(!condition()) {
      return callback();
    }
    self.doWork(fn, loop);
  })();
};

// 4.4) Normalization Algorithm
Normalize.prototype.main = function(dataset, callback) {
  var self = this;
  self.schedule.start = new Date().getTime();
  var result;

  // handle invalid output format
  if(self.options.format) {
    if(self.options.format !== 'application/nquads') {
      return callback(new JsonLdError(
        'Unknown output format.',
        'jsonld.UnknownFormat', {format: self.options.format}));
    }
  }

  // 1) Create the normalization state.

  // Note: Optimize by generating non-normalized blank node map concurrently.
  var nonNormalized = {};

  self.waterfall([
    function(callback) {
      // 2) For every quad in input dataset:
      self.forEach(dataset, function(triples, graphName, callback) {
        if(graphName === '@default') {
          graphName = null;
        }
        self.forEach(triples, function(quad, idx, callback) {
          if(graphName !== null) {
            if(graphName.indexOf('_:') === 0) {
              quad.name = {type: 'blank node', value: graphName};
            } else {
              quad.name = {type: 'IRI', value: graphName};
            }
          }
          self.quads.push(quad);

          // 2.1) For each blank node that occurs in the quad, add a reference
          // to the quad using the blank node identifier in the blank node to
          // quads map, creating a new entry if necessary.
          self.forEachComponent(quad, function(component) {
            if(component.type !== 'blank node') {
              return;
            }
            var id = component.value;
            if(id in self.blankNodeInfo) {
              self.blankNodeInfo[id].quads.push(quad);
            } else {
              nonNormalized[id] = true;
              self.blankNodeInfo[id] = {quads: [quad]};
            }
          });
          callback();
        }, callback);
      }, callback);
    },
    function(callback) {
      // 3) Create a list of non-normalized blank node identifiers
      // non-normalized identifiers and populate it using the keys from the
      // blank node to quads map.
      // Note: We use a map here and it was generated during step 2.

      // 4) Initialize simple, a boolean flag, to true.
      var simple = true;

      // 5) While simple is true, issue canonical identifiers for blank nodes:
      self.whilst(function() { return simple; }, function(callback) {
        // 5.1) Set simple to false.
        simple = false;

        // 5.2) Clear hash to blank nodes map.
        self.hashToBlankNodes = {};

        self.waterfall([
          function(callback) {
            // 5.3) For each blank node identifier identifier in non-normalized
            // identifiers:
            self.forEach(nonNormalized, function(value, id, callback) {
              // 5.3.1) Create a hash, hash, according to the Hash First Degree
              // Quads algorithm.
              self.hashFirstDegreeQuads(id, function(err, hash) {
                if(err) {
                  return callback(err);
                }
                // 5.3.2) Add hash and identifier to hash to blank nodes map,
                // creating a new entry if necessary.
                if(hash in self.hashToBlankNodes) {
                  self.hashToBlankNodes[hash].push(id);
                } else {
                  self.hashToBlankNodes[hash] = [id];
                }
                callback();
              });
            }, callback);
          },
          function(callback) {
            // 5.4) For each hash to identifier list mapping in hash to blank
            // nodes map, lexicographically-sorted by hash:
            var hashes = Object.keys(self.hashToBlankNodes).sort();
            self.forEach(hashes, function(hash, i, callback) {
              // 5.4.1) If the length of identifier list is greater than 1,
              // continue to the next mapping.
              var idList = self.hashToBlankNodes[hash];
              if(idList.length > 1) {
                return callback();
              }

              // 5.4.2) Use the Issue Identifier algorithm, passing canonical
              // issuer and the single blank node identifier in identifier
              // list, identifier, to issue a canonical replacement identifier
              // for identifier.
              // TODO: consider changing `getId` to `issue`
              var id = idList[0];
              self.canonicalIssuer.getId(id);

              // 5.4.3) Remove identifier from non-normalized identifiers.
              delete nonNormalized[id];

              // 5.4.4) Remove hash from the hash to blank nodes map.
              delete self.hashToBlankNodes[hash];

              // 5.4.5) Set simple to true.
              simple = true;
              callback();
            }, callback);
          }
        ], callback);
      }, callback);
    },
    function(callback) {
      // 6) For each hash to identifier list mapping in hash to blank nodes map,
      // lexicographically-sorted by hash:
      var hashes = Object.keys(self.hashToBlankNodes).sort();
      self.forEach(hashes, function(hash, idx, callback) {
        // 6.1) Create hash path list where each item will be a result of
        // running the Hash N-Degree Quads algorithm.
        var hashPathList = [];

        // 6.2) For each blank node identifier identifier in identifier list:
        var idList = self.hashToBlankNodes[hash];
        self.waterfall([
          function(callback) {
            self.forEach(idList, function(id, idx, callback) {
              // 6.2.1) If a canonical identifier has already been issued for
              // identifier, continue to the next identifier.
              if(self.canonicalIssuer.hasId(id)) {
                return callback();
              }

              // 6.2.2) Create temporary issuer, an identifier issuer
              // initialized with the prefix _:b.
              var issuer = new IdentifierIssuer('_:b');

              // 6.2.3) Use the Issue Identifier algorithm, passing temporary
              // issuer and identifier, to issue a new temporary blank node
              // identifier for identifier.
              issuer.getId(id);

              // 6.2.4) Run the Hash N-Degree Quads algorithm, passing
              // temporary issuer, and append the result to the hash path list.
              self.hashNDegreeQuads(id, issuer, function(err, result) {
                if(err) {
                  return callback(err);
                }
                hashPathList.push(result);
                callback();
              });
            }, callback);
          },
          function(callback) {
            // 6.3) For each result in the hash path list,
            // lexicographically-sorted by the hash in result:
            hashPathList.sort(function(a, b) {
              return (a.hash < b.hash) ? -1 : ((a.hash > b.hash) ? 1 : 0);
            });
            self.forEach(hashPathList, function(result, idx, callback) {
              // 6.3.1) For each blank node identifier, existing identifier,
              // that was issued a temporary identifier by identifier issuer
              // in result, issue a canonical identifier, in the same order,
              // using the Issue Identifier algorithm, passing canonical
              // issuer and existing identifier.
              for(var existing in result.issuer.existing) {
                self.canonicalIssuer.getId(existing);
              }
              callback();
            }, callback);
          }
        ], callback);
      }, callback);
    }, function(callback) {
      /* Note: At this point all blank nodes in the set of RDF quads have been
      assigned canonical identifiers, which have been stored in the canonical
      issuer. Here each quad is updated by assigning each of its blank nodes
      its new identifier. */

      // 7) For each quad, quad, in input dataset:
      var normalized = [];
      self.waterfall([
        function(callback) {
          self.forEach(self.quads, function(quad, idx, callback) {
            // 7.1) Create a copy, quad copy, of quad and replace any existing
            // blank node identifiers using the canonical identifiers
            // previously issued by canonical issuer.
            // Note: We optimize away the copy here.
            self.forEachComponent(quad, function(component) {
              if(component.type === 'blank node' &&
                component.value.indexOf(self.canonicalIssuer.prefix) !== 0) {
                component.value = self.canonicalIssuer.getId(component.value);
              }
            });
            // 7.2) Add quad copy to the normalized dataset.
            normalized.push(_toNQuad(quad));
            callback();
          }, callback);
        },
        function(callback) {
          // sort normalized output
          normalized.sort();

          // 8) Return the normalized dataset.
          if(self.options.format === 'application/nquads') {
            result = normalized.join('');
            return callback();
          }

          result = _parseNQuads(normalized.join(''));
          callback();
        }
      ], callback);
    }
  ], function(err) {
    callback(err, result);
  });
};

// 4.6) Hash First Degree Quads
Normalize.prototype.hashFirstDegreeQuads = function(id, callback) {
  var self = this;

  // return cached hash
  var info = self.blankNodeInfo[id];
  if('hash' in info) {
    return callback(null, info.hash);
  }

  // 1) Initialize nquads to an empty list. It will be used to store quads in
  // N-Quads format.
  var nquads = [];

  // 2) Get the list of quads quads associated with the reference blank node
  // identifier in the blank node to quads map.
  var quads = info.quads;

  // 3) For each quad quad in quads:
  self.forEach(quads, function(quad, idx, callback) {
    // 3.1) Serialize the quad in N-Quads format with the following special
    // rule:

    // 3.1.1) If any component in quad is an blank node, then serialize it
    // using a special identifier as follows:
    var copy = {predicate: quad.predicate};
    self.forEachComponent(quad, function(component, key) {
      // 3.1.2) If the blank node's existing blank node identifier matches the
      // reference blank node identifier then use the blank node identifier _:a,
      // otherwise, use the blank node identifier _:z.
      copy[key] = self.modifyFirstDegreeComponent(id, component, key);
    });
    nquads.push(_toNQuad(copy));
    callback();
  }, function(err) {
    if(err) {
      return callback(err);
    }
    // 4) Sort nquads in lexicographical order.
    nquads.sort();

    // 5) Return the hash that results from passing the sorted, joined nquads
    // through the hash algorithm.
    info.hash = NormalizeHash.hashNQuads(self.name, nquads);
    callback(null, info.hash);
  });
};

// helper for modifying component during Hash First Degree Quads
Normalize.prototype.modifyFirstDegreeComponent = function(id, component) {
  if(component.type !== 'blank node') {
    return component;
  }
  component = _clone(component);
  component.value = (component.value === id ? '_:a' : '_:z');
  return component;
};

// 4.7) Hash Related Blank Node
Normalize.prototype.hashRelatedBlankNode = function(
  related, quad, issuer, position, callback) {
  var self = this;

  // 1) Set the identifier to use for related, preferring first the canonical
  // identifier for related if issued, second the identifier issued by issuer
  // if issued, and last, if necessary, the result of the Hash First Degree
  // Quads algorithm, passing related.
  var id;
  self.waterfall([
    function(callback) {
      if(self.canonicalIssuer.hasId(related)) {
        id = self.canonicalIssuer.getId(related);
        return callback();
      }
      if(issuer.hasId(related)) {
        id = issuer.getId(related);
        return callback();
      }
      self.hashFirstDegreeQuads(related, function(err, hash) {
        if(err) {
          return callback(err);
        }
        id = hash;
        callback();
      });
    }
  ], function(err) {
    if(err) {
      return callback(err);
    }

    // 2) Initialize a string input to the value of position.
    // Note: We use a hash object instead.
    var md = new NormalizeHash(self.name);
    md.update(position);

    // 3) If position is not g, append <, the value of the predicate in quad,
    // and > to input.
    if(position !== 'g') {
      md.update(self.getRelatedPredicate(quad));
    }

    // 4) Append identifier to input.
    md.update(id);

    // 5) Return the hash that results from passing input through the hash
    // algorithm.
    return callback(null, md.digest());
  });
};

// helper for getting a related predicate
Normalize.prototype.getRelatedPredicate = function(quad) {
  return '<' + quad.predicate.value + '>';
};

// 4.8) Hash N-Degree Quads
Normalize.prototype.hashNDegreeQuads = function(id, issuer, callback) {
  var self = this;

  // 1) Create a hash to related blank nodes map for storing hashes that
  // identify related blank nodes.
  // Note: 2) and 3) handled within `createHashToRelated`
  var hashToRelated;
  var md = new NormalizeHash(self.name);
  self.waterfall([
    function(callback) {
      self.createHashToRelated(id, issuer, function(err, result) {
        if(err) {
          return callback(err);
        }
        hashToRelated = result;
        callback();
      });
    },
    function(callback) {
      // 4) Create an empty string, data to hash.
      // Note: We created a hash object `md` above instead.

      // 5) For each related hash to blank node list mapping in hash to related
      // blank nodes map, sorted lexicographically by related hash:
      var hashes = Object.keys(hashToRelated).sort();
      self.forEach(hashes, function(hash, idx, callback) {
        // 5.1) Append the related hash to the data to hash.
        md.update(hash);

        // 5.2) Create a string chosen path.
        var chosenPath = '';

        // 5.3) Create an unset chosen issuer variable.
        var chosenIssuer;

        // 5.4) For each permutation of blank node list:
        var permutator = new Permutator(hashToRelated[hash]);
        self.whilst(
          function() { return permutator.hasNext(); },
          function(nextPermutation) {
          var permutation = permutator.next();

          // 5.4.1) Create a copy of issuer, issuer copy.
          var issuerCopy = issuer.clone();

          // 5.4.2) Create a string path.
          var path = '';

          // 5.4.3) Create a recursion list, to store blank node identifiers
          // that must be recursively processed by this algorithm.
          var recursionList = [];

          self.waterfall([
            function(callback) {
              // 5.4.4) For each related in permutation:
              self.forEach(permutation, function(related, idx, callback) {
                // 5.4.4.1) If a canonical identifier has been issued for
                // related, append it to path.
                if(self.canonicalIssuer.hasId(related)) {
                  path += self.canonicalIssuer.getId(related);
                } else {
                  // 5.4.4.2) Otherwise:
                  // 5.4.4.2.1) If issuer copy has not issued an identifier for
                  // related, append related to recursion list.
                  if(!issuerCopy.hasId(related)) {
                    recursionList.push(related);
                  }
                  // 5.4.4.2.2) Use the Issue Identifier algorithm, passing
                  // issuer copy and related and append the result to path.
                  path += issuerCopy.getId(related);
                }

                // 5.4.4.3) If chosen path is not empty and the length of path
                // is greater than or equal to the length of chosen path and
                // path is lexicographically greater than chosen path, then
                // skip to the next permutation.
                if(chosenPath.length !== 0 &&
                  path.length >= chosenPath.length && path > chosenPath) {
                  // FIXME: may cause inaccurate total depth calculation
                  return nextPermutation();
                }
                callback();
              }, callback);
            },
            function(callback) {
              // 5.4.5) For each related in recursion list:
              self.forEach(recursionList, function(related, idx, callback) {
                // 5.4.5.1) Set result to the result of recursively executing
                // the Hash N-Degree Quads algorithm, passing related for
                // identifier and issuer copy for path identifier issuer.
                self.hashNDegreeQuads(
                  related, issuerCopy, function(err, result) {
                  if(err) {
                    return callback(err);
                  }

                  // 5.4.5.2) Use the Issue Identifier algorithm, passing issuer
                  // copy and related and append the result to path.
                  path += issuerCopy.getId(related);

                  // 5.4.5.3) Append <, the hash in result, and > to path.
                  path += '<' + result.hash + '>';

                  // 5.4.5.4) Set issuer copy to the identifier issuer in
                  // result.
                  issuerCopy = result.issuer;

                  // 5.4.5.5) If chosen path is not empty and the length of path
                  // is greater than or equal to the length of chosen path and
                  // path is lexicographically greater than chosen path, then
                  // skip to the next permutation.
                  if(chosenPath.length !== 0 &&
                    path.length >= chosenPath.length && path > chosenPath) {
                    // FIXME: may cause inaccurate total depth calculation
                    return nextPermutation();
                  }
                  callback();
                });
              }, callback);
            },
            function(callback) {
              // 5.4.6) If chosen path is empty or path is lexicographically
              // less than chosen path, set chosen path to path and chosen
              // issuer to issuer copy.
              if(chosenPath.length === 0 || path < chosenPath) {
                chosenPath = path;
                chosenIssuer = issuerCopy;
              }
              callback();
            }
          ], nextPermutation);
        }, function(err) {
          if(err) {
            return callback(err);
          }

          // 5.5) Append chosen path to data to hash.
          md.update(chosenPath);

          // 5.6) Replace issuer, by reference, with chosen issuer.
          issuer = chosenIssuer;
          callback();
        });
      }, callback);
    }
  ], function(err) {
    // 6) Return issuer and the hash that results from passing data to hash
    // through the hash algorithm.
    callback(err, {hash: md.digest(), issuer: issuer});
  });
};

// helper for creating hash to related blank nodes map
Normalize.prototype.createHashToRelated = function(id, issuer, callback) {
  var self = this;

  // 1) Create a hash to related blank nodes map for storing hashes that
  // identify related blank nodes.
  var hashToRelated = {};

  // 2) Get a reference, quads, to the list of quads in the blank node to
  // quads map for the key identifier.
  var quads = self.blankNodeInfo[id].quads;

  // 3) For each quad in quads:
  self.forEach(quads, function(quad, idx, callback) {
    // 3.1) For each component in quad, if component is the subject, object,
    // and graph name and it is a blank node that is not identified by
    // identifier:
    self.forEach(quad, function(component, key, callback) {
      if(key === 'predicate' ||
        !(component.type === 'blank node' && component.value !== id)) {
        return callback();
      }
      // 3.1.1) Set hash to the result of the Hash Related Blank Node
      // algorithm, passing the blank node identifier for component as
      // related, quad, path identifier issuer as issuer, and position as
      // either s, o, or g based on whether component is a subject, object,
      // graph name, respectively.
      var related = component.value;
      var position = POSITIONS[key];
      self.hashRelatedBlankNode(
        related, quad, issuer, position, function(err, hash) {
        if(err) {
          return callback(err);
        }
        // 3.1.2) Add a mapping of hash to the blank node identifier for
        // component to hash to related blank nodes map, adding an entry as
        // necessary.
        if(hash in hashToRelated) {
          hashToRelated[hash].push(related);
        } else {
          hashToRelated[hash] = [related];
        }
        callback();
      });
    }, callback);
  }, function(err) {
    callback(err, hashToRelated);
  });
};

// helper that iterates over quad components (skips predicate)
Normalize.prototype.forEachComponent = function(quad, op) {
  for(var key in quad) {
    // skip `predicate`
    if(key === 'predicate') {
      continue;
    }
    op(quad[key], key, quad);
  }
};

return Normalize;

})();

var URGNA2012 = (function() {

var Normalize = function(options) {
  URDNA2015.call(this, options);
  this.name = 'URGNA2012';
};
Normalize.prototype = new URDNA2015();

// helper for modifying component during Hash First Degree Quads
Normalize.prototype.modifyFirstDegreeComponent = function(id, component, key) {
  if(component.type !== 'blank node') {
    return component;
  }
  component = _clone(component);
  if(key === 'name') {
    component.value = '_:g';
  } else {
    component.value = (component.value === id ? '_:a' : '_:z');
  }
  return component;
};

// helper for getting a related predicate
Normalize.prototype.getRelatedPredicate = function(quad) {
  return quad.predicate.value;
};

// helper for creating hash to related blank nodes map
Normalize.prototype.createHashToRelated = function(id, issuer, callback) {
  var self = this;

  // 1) Create a hash to related blank nodes map for storing hashes that
  // identify related blank nodes.
  var hashToRelated = {};

  // 2) Get a reference, quads, to the list of quads in the blank node to
  // quads map for the key identifier.
  var quads = self.blankNodeInfo[id].quads;

  // 3) For each quad in quads:
  self.forEach(quads, function(quad, idx, callback) {
    // 3.1) If the quad's subject is a blank node that does not match
    // identifier, set hash to the result of the Hash Related Blank Node
    // algorithm, passing the blank node identifier for subject as related,
    // quad, path identifier issuer as issuer, and p as position.
    var position;
    var related;
    if(quad.subject.type === 'blank node' && quad.subject.value !== id) {
      related = quad.subject.value;
      position = 'p';
    } else if(quad.object.type === 'blank node' && quad.object.value !== id) {
      // 3.2) Otherwise, if quad's object is a blank node that does not match
      // identifier, to the result of the Hash Related Blank Node algorithm,
      // passing the blank node identifier for object as related, quad, path
      // identifier issuer as issuer, and r as position.
      related = quad.object.value;
      position = 'r';
    } else {
      // 3.3) Otherwise, continue to the next quad.
      return callback();
    }
    // 3.4) Add a mapping of hash to the blank node identifier for the
    // component that matched (subject or object) to hash to related blank
    // nodes map, adding an entry as necessary.
    self.hashRelatedBlankNode(
      related, quad, issuer, position, function(err, hash) {
      if(hash in hashToRelated) {
        hashToRelated[hash].push(related);
      } else {
        hashToRelated[hash] = [related];
      }
      callback();
    });
  }, function(err) {
    callback(err, hashToRelated);
  });
};

return Normalize;

})();

function _createNodeMap(input, graphs, graph, issuer, name, list) {
  // recurse through array
  if(_isArray(input)) {
    for(var i = 0; i < input.length; ++i) {
      _createNodeMap(input[i], graphs, graph, issuer, undefined, list);
    }
    return;
  }

  // add non-object to list
  if(!_isObject(input)) {
    if(list) {
      list.push(input);
    }
    return;
  }

  // add values to list
  if(_isValue(input)) {
    if('@type' in input) {
      var type = input['@type'];
      // rename @type blank node
      if(type.indexOf('_:') === 0) {
        input['@type'] = type = issuer.getId(type);
      }
    }
    if(list) {
      list.push(input);
    }
    return;
  }

  // Note: At this point, input must be a subject.

  // spec requires @type to be named first, so assign names early
  if('@type' in input) {
    var types = input['@type'];
    for(var i = 0; i < types.length; ++i) {
      var type = types[i];
      if(type.indexOf('_:') === 0) {
        issuer.getId(type);
      }
    }
  }

  // get name for subject
  if(_isUndefined(name)) {
    name = _isBlankNode(input) ? issuer.getId(input['@id']) : input['@id'];
  }

  // add subject reference to list
  if(list) {
    list.push({'@id': name});
  }

  // create new subject or merge into existing one
  var subjects = graphs[graph];
  var subject = subjects[name] = subjects[name] || {};
  subject['@id'] = name;
  var properties = Object.keys(input).sort();
  for(var pi = 0; pi < properties.length; ++pi) {
    var property = properties[pi];

    // skip @id
    if(property === '@id') {
      continue;
    }

    // handle reverse properties
    if(property === '@reverse') {
      var referencedNode = {'@id': name};
      var reverseMap = input['@reverse'];
      for(var reverseProperty in reverseMap) {
        var items = reverseMap[reverseProperty];
        for(var ii = 0; ii < items.length; ++ii) {
          var item = items[ii];
          var itemName = item['@id'];
          if(_isBlankNode(item)) {
            itemName = issuer.getId(itemName);
          }
          _createNodeMap(item, graphs, graph, issuer, itemName);
          jsonld.addValue(
            subjects[itemName], reverseProperty, referencedNode,
            {propertyIsArray: true, allowDuplicate: false});
        }
      }
      continue;
    }

    // recurse into graph
    if(property === '@graph') {
      // add graph subjects map entry
      if(!(name in graphs)) {
        graphs[name] = {};
      }
      var g = (graph === '@merged') ? graph : name;
      _createNodeMap(input[property], graphs, g, issuer);
      continue;
    }

    // copy non-@type keywords
    if(property !== '@type' && _isKeyword(property)) {
      if(property === '@index' && property in subject &&
        (input[property] !== subject[property] ||
        input[property]['@id'] !== subject[property]['@id'])) {
        throw new JsonLdError(
          'Invalid JSON-LD syntax; conflicting @index property detected.',
          'jsonld.SyntaxError',
          {code: 'conflicting indexes', subject: subject});
      }
      subject[property] = input[property];
      continue;
    }

    // iterate over objects
    var objects = input[property];

    // if property is a bnode, assign it a new id
    if(property.indexOf('_:') === 0) {
      property = issuer.getId(property);
    }

    // ensure property is added for empty arrays
    if(objects.length === 0) {
      jsonld.addValue(subject, property, [], {propertyIsArray: true});
      continue;
    }
    for(var oi = 0; oi < objects.length; ++oi) {
      var o = objects[oi];

      if(property === '@type') {
        // rename @type blank nodes
        o = (o.indexOf('_:') === 0) ? issuer.getId(o) : o;
      }

      // handle embedded subject or subject reference
      if(_isSubject(o) || _isSubjectReference(o)) {
        // relabel blank node @id
        var id = _isBlankNode(o) ? issuer.getId(o['@id']) : o['@id'];

        // add reference and recurse
        jsonld.addValue(
          subject, property, {'@id': id},
          {propertyIsArray: true, allowDuplicate: false});
        _createNodeMap(o, graphs, graph, issuer, id);
      } else if(_isList(o)) {
        // handle @list
        var _list = [];
        _createNodeMap(o['@list'], graphs, graph, issuer, name, _list);
        o = {'@list': _list};
        jsonld.addValue(
          subject, property, o,
          {propertyIsArray: true, allowDuplicate: false});
      } else {
        // handle @value
        _createNodeMap(o, graphs, graph, issuer, name);
        jsonld.addValue(
          subject, property, o, {propertyIsArray: true, allowDuplicate: false});
      }
    }
  }
}

function _mergeNodeMaps(graphs) {
  // add all non-default graphs to default graph
  var defaultGraph = graphs['@default'];
  var graphNames = Object.keys(graphs).sort();
  for(var i = 0; i < graphNames.length; ++i) {
    var graphName = graphNames[i];
    if(graphName === '@default') {
      continue;
    }
    var nodeMap = graphs[graphName];
    var subject = defaultGraph[graphName];
    if(!subject) {
      defaultGraph[graphName] = subject = {
        '@id': graphName,
        '@graph': []
      };
    } else if(!('@graph' in subject)) {
      subject['@graph'] = [];
    }
    var graph = subject['@graph'];
    var ids = Object.keys(nodeMap).sort();
    for(var ii = 0; ii < ids.length; ++ii) {
      var node = nodeMap[ids[ii]];
      // only add full subjects
      if(!_isSubjectReference(node)) {
        graph.push(node);
      }
    }
  }
  return defaultGraph;
}

function _frame(state, subjects, frame, parent, property) {
  // validate the frame
  _validateFrame(frame);
  frame = frame[0];

  // get flags for current frame
  var options = state.options;
  var flags = {
    embed: _getFrameFlag(frame, options, 'embed'),
    explicit: _getFrameFlag(frame, options, 'explicit'),
    requireAll: _getFrameFlag(frame, options, 'requireAll')
  };

  // filter out subjects that match the frame
  var matches = _filterSubjects(state, subjects, frame, flags);

  // add matches to output
  var ids = Object.keys(matches).sort();
  for(var idx = 0; idx < ids.length; ++idx) {
    var id = ids[idx];
    var subject = matches[id];

    if(flags.embed === '@link' && id in state.link) {
      // TODO: may want to also match an existing linked subject against
      // the current frame ... so different frames could produce different
      // subjects that are only shared in-memory when the frames are the same

      // add existing linked subject
      _addFrameOutput(parent, property, state.link[id]);
      continue;
    }

    /* Note: In order to treat each top-level match as a compartmentalized
    result, clear the unique embedded subjects map when the property is null,
    which only occurs at the top-level. */
    if(property === null) {
      state.uniqueEmbeds = {};
    }

    // start output for subject
    var output = {};
    output['@id'] = id;
    state.link[id] = output;

    // if embed is @never or if a circular reference would be created by an
    // embed, the subject cannot be embedded, just add the reference;
    // note that a circular reference won't occur when the embed flag is
    // `@link` as the above check will short-circuit before reaching this point
    if(flags.embed === '@never' ||
      _createsCircularReference(subject, state.subjectStack)) {
      _addFrameOutput(parent, property, output);
      continue;
    }

    // if only the last match should be embedded
    if(flags.embed === '@last') {
      // remove any existing embed
      if(id in state.uniqueEmbeds) {
        _removeEmbed(state, id);
      }
      state.uniqueEmbeds[id] = {parent: parent, property: property};
    }

    // push matching subject onto stack to enable circular embed checks
    state.subjectStack.push(subject);

    // iterate over subject properties
    var props = Object.keys(subject).sort();
    for(var i = 0; i < props.length; i++) {
      var prop = props[i];

      // copy keywords to output
      if(_isKeyword(prop)) {
        output[prop] = _clone(subject[prop]);
        continue;
      }

      // explicit is on and property isn't in the frame, skip processing
      if(flags.explicit && !(prop in frame)) {
        continue;
      }

      // add objects
      var objects = subject[prop];
      for(var oi = 0; oi < objects.length; ++oi) {
        var o = objects[oi];

        // recurse into list
        if(_isList(o)) {
          // add empty list
          var list = {'@list': []};
          _addFrameOutput(output, prop, list);

          // add list objects
          var src = o['@list'];
          for(var n in src) {
            o = src[n];
            if(_isSubjectReference(o)) {
              var subframe = (prop in frame ?
                frame[prop][0]['@list'] : _createImplicitFrame(flags));
              // recurse into subject reference
              _frame(state, [o['@id']], subframe, list, '@list');
            } else {
              // include other values automatically
              _addFrameOutput(list, '@list', _clone(o));
            }
          }
          continue;
        }

        if(_isSubjectReference(o)) {
          // recurse into subject reference
          var subframe = (prop in frame ?
            frame[prop] : _createImplicitFrame(flags));
          _frame(state, [o['@id']], subframe, output, prop);
        } else {
          // include other values automatically
          _addFrameOutput(output, prop, _clone(o));
        }
      }
    }

    // handle defaults
    var props = Object.keys(frame).sort();
    for(var i = 0; i < props.length; ++i) {
      var prop = props[i];

      // skip keywords
      if(_isKeyword(prop)) {
        continue;
      }

      // if omit default is off, then include default values for properties
      // that appear in the next frame but are not in the matching subject
      var next = frame[prop][0];
      var omitDefaultOn = _getFrameFlag(next, options, 'omitDefault');
      if(!omitDefaultOn && !(prop in output)) {
        var preserve = '@null';
        if('@default' in next) {
          preserve = _clone(next['@default']);
        }
        if(!_isArray(preserve)) {
          preserve = [preserve];
        }
        output[prop] = [{'@preserve': preserve}];
      }
    }

    // add output to parent
    _addFrameOutput(parent, property, output);

    // pop matching subject from circular ref-checking stack
    state.subjectStack.pop();
  }
}

function _createImplicitFrame(flags) {
  var frame = {};
  for(var key in flags) {
    if(flags[key] !== undefined) {
      frame['@' + key] = [flags[key]];
    }
  }
  return [frame];
}

function _createsCircularReference(subjectToEmbed, subjectStack) {
  for(var i = subjectStack.length - 1; i >= 0; --i) {
    if(subjectStack[i]['@id'] === subjectToEmbed['@id']) {
      return true;
    }
  }
  return false;
}

function _getFrameFlag(frame, options, name) {
  var flag = '@' + name;
  var rval = (flag in frame ? frame[flag][0] : options[name]);
  if(name === 'embed') {
    // default is "@last"
    // backwards-compatibility support for "embed" maps:
    // true => "@last"
    // false => "@never"
    if(rval === true) {
      rval = '@last';
    } else if(rval === false) {
      rval = '@never';
    } else if(rval !== '@always' && rval !== '@never' && rval !== '@link') {
      rval = '@last';
    }
  }
  return rval;
}

function _validateFrame(frame) {
  if(!_isArray(frame) || frame.length !== 1 || !_isObject(frame[0])) {
    throw new JsonLdError(
      'Invalid JSON-LD syntax; a JSON-LD frame must be a single object.',
      'jsonld.SyntaxError', {frame: frame});
  }
}

function _filterSubjects(state, subjects, frame, flags) {
  // filter subjects in @id order
  var rval = {};
  for(var i = 0; i < subjects.length; ++i) {
    var id = subjects[i];
    var subject = state.subjects[id];
    if(_filterSubject(subject, frame, flags)) {
      rval[id] = subject;
    }
  }
  return rval;
}

function _filterSubject(subject, frame, flags) {
  // check @type (object value means 'any' type, fall through to ducktyping)
  if('@type' in frame &&
    !(frame['@type'].length === 1 && _isObject(frame['@type'][0]))) {
    var types = frame['@type'];
    for(var i = 0; i < types.length; ++i) {
      // any matching @type is a match
      if(jsonld.hasValue(subject, '@type', types[i])) {
        return true;
      }
    }
    return false;
  }

  // check ducktype
  var wildcard = true;
  var matchesSome = false;
  for(var key in frame) {
    if(_isKeyword(key)) {
      // skip non-@id and non-@type
      if(key !== '@id' && key !== '@type') {
        continue;
      }
      wildcard = false;

      // check @id for a specific @id value
      if(key === '@id' && _isString(frame[key])) {
        if(subject[key] !== frame[key]) {
          return false;
        }
        matchesSome = true;
        continue;
      }
    }

    wildcard = false;

    if(key in subject) {
      // frame[key] === [] means do not match if property is present
      if(_isArray(frame[key]) && frame[key].length === 0 &&
        subject[key] !== undefined) {
        return false;
      }
      matchesSome = true;
      continue;
    }

    // all properties must match to be a duck unless a @default is specified
    var hasDefault = (_isArray(frame[key]) && _isObject(frame[key][0]) &&
      '@default' in frame[key][0]);
    if(flags.requireAll && !hasDefault) {
      return false;
    }
  }

  // return true if wildcard or subject matches some properties
  return wildcard || matchesSome;
}

function _removeEmbed(state, id) {
  // get existing embed
  var embeds = state.uniqueEmbeds;
  var embed = embeds[id];
  var parent = embed.parent;
  var property = embed.property;

  // create reference to replace embed
  var subject = {'@id': id};

  // remove existing embed
  if(_isArray(parent)) {
    // replace subject with reference
    for(var i = 0; i < parent.length; ++i) {
      if(jsonld.compareValues(parent[i], subject)) {
        parent[i] = subject;
        break;
      }
    }
  } else {
    // replace subject with reference
    var useArray = _isArray(parent[property]);
    jsonld.removeValue(parent, property, subject, {propertyIsArray: useArray});
    jsonld.addValue(parent, property, subject, {propertyIsArray: useArray});
  }

  // recursively remove dependent dangling embeds
  var removeDependents = function(id) {
    // get embed keys as a separate array to enable deleting keys in map
    var ids = Object.keys(embeds);
    for(var i = 0; i < ids.length; ++i) {
      var next = ids[i];
      if(next in embeds && _isObject(embeds[next].parent) &&
        embeds[next].parent['@id'] === id) {
        delete embeds[next];
        removeDependents(next);
      }
    }
  };
  removeDependents(id);
}

function _addFrameOutput(parent, property, output) {
  if(_isObject(parent)) {
    jsonld.addValue(parent, property, output, {propertyIsArray: true});
  } else {
    parent.push(output);
  }
}

function _removePreserve(ctx, input, options) {
  // recurse through arrays
  if(_isArray(input)) {
    var output = [];
    for(var i = 0; i < input.length; ++i) {
      var result = _removePreserve(ctx, input[i], options);
      // drop nulls from arrays
      if(result !== null) {
        output.push(result);
      }
    }
    input = output;
  } else if(_isObject(input)) {
    // remove @preserve
    if('@preserve' in input) {
      if(input['@preserve'] === '@null') {
        return null;
      }
      return input['@preserve'];
    }

    // skip @values
    if(_isValue(input)) {
      return input;
    }

    // recurse through @lists
    if(_isList(input)) {
      input['@list'] = _removePreserve(ctx, input['@list'], options);
      return input;
    }

    // handle in-memory linked nodes
    var idAlias = _compactIri(ctx, '@id');
    if(idAlias in input) {
      var id = input[idAlias];
      if(id in options.link) {
        var idx = options.link[id].indexOf(input);
        if(idx === -1) {
          // prevent circular visitation
          options.link[id].push(input);
        } else {
          // already visited
          return options.link[id][idx];
        }
      } else {
        // prevent circular visitation
        options.link[id] = [input];
      }
    }

    // recurse through properties
    for(var prop in input) {
      var result = _removePreserve(ctx, input[prop], options);
      var container = jsonld.getContextValue(ctx, prop, '@container');
      if(options.compactArrays && _isArray(result) && result.length === 1 &&
        container === null) {
        result = result[0];
      }
      input[prop] = result;
    }
  }
  return input;
}

function _compareShortestLeast(a, b) {
  if(a.length < b.length) {
    return -1;
  }
  if(b.length < a.length) {
    return 1;
  }
  if(a === b) {
    return 0;
  }
  return (a < b) ? -1 : 1;
}

function _selectTerm(
  activeCtx, iri, value, containers, typeOrLanguage, typeOrLanguageValue) {
  if(typeOrLanguageValue === null) {
    typeOrLanguageValue = '@null';
  }

  // preferences for the value of @type or @language
  var prefs = [];

  // determine prefs for @id based on whether or not value compacts to a term
  if((typeOrLanguageValue === '@id' || typeOrLanguageValue === '@reverse') &&
    _isSubjectReference(value)) {
    // prefer @reverse first
    if(typeOrLanguageValue === '@reverse') {
      prefs.push('@reverse');
    }
    // try to compact value to a term
    var term = _compactIri(activeCtx, value['@id'], null, {vocab: true});
    if(term in activeCtx.mappings &&
      activeCtx.mappings[term] &&
      activeCtx.mappings[term]['@id'] === value['@id']) {
      // prefer @vocab
      prefs.push.apply(prefs, ['@vocab', '@id']);
    } else {
      // prefer @id
      prefs.push.apply(prefs, ['@id', '@vocab']);
    }
  } else {
    prefs.push(typeOrLanguageValue);
  }
  prefs.push('@none');

  var containerMap = activeCtx.inverse[iri];
  for(var ci = 0; ci < containers.length; ++ci) {
    // if container not available in the map, continue
    var container = containers[ci];
    if(!(container in containerMap)) {
      continue;
    }

    var typeOrLanguageValueMap = containerMap[container][typeOrLanguage];
    for(var pi = 0; pi < prefs.length; ++pi) {
      // if type/language option not available in the map, continue
      var pref = prefs[pi];
      if(!(pref in typeOrLanguageValueMap)) {
        continue;
      }

      // select term
      return typeOrLanguageValueMap[pref];
    }
  }

  return null;
}

function _compactIri(activeCtx, iri, value, relativeTo, reverse) {
  // can't compact null
  if(iri === null) {
    return iri;
  }

  // default value and parent to null
  if(_isUndefined(value)) {
    value = null;
  }
  // default reverse to false
  if(_isUndefined(reverse)) {
    reverse = false;
  }
  relativeTo = relativeTo || {};

  // if term is a keyword, default vocab to true
  if(_isKeyword(iri)) {
    relativeTo.vocab = true;
  }

  // use inverse context to pick a term if iri is relative to vocab
  if(relativeTo.vocab && iri in activeCtx.getInverse()) {
    var defaultLanguage = activeCtx['@language'] || '@none';

    // prefer @index if available in value
    var containers = [];
    if(_isObject(value) && '@index' in value) {
      containers.push('@index');
    }

    // defaults for term selection based on type/language
    var typeOrLanguage = '@language';
    var typeOrLanguageValue = '@null';

    if(reverse) {
      typeOrLanguage = '@type';
      typeOrLanguageValue = '@reverse';
      containers.push('@set');
    } else if(_isList(value)) {
      // choose the most specific term that works for all elements in @list
      // only select @list containers if @index is NOT in value
      if(!('@index' in value)) {
        containers.push('@list');
      }
      var list = value['@list'];
      var commonLanguage = (list.length === 0) ? defaultLanguage : null;
      var commonType = null;
      for(var i = 0; i < list.length; ++i) {
        var item = list[i];
        var itemLanguage = '@none';
        var itemType = '@none';
        if(_isValue(item)) {
          if('@language' in item) {
            itemLanguage = item['@language'];
          } else if('@type' in item) {
            itemType = item['@type'];
          } else {
            // plain literal
            itemLanguage = '@null';
          }
        } else {
          itemType = '@id';
        }
        if(commonLanguage === null) {
          commonLanguage = itemLanguage;
        } else if(itemLanguage !== commonLanguage && _isValue(item)) {
          commonLanguage = '@none';
        }
        if(commonType === null) {
          commonType = itemType;
        } else if(itemType !== commonType) {
          commonType = '@none';
        }
        // there are different languages and types in the list, so choose
        // the most generic term, no need to keep iterating the list
        if(commonLanguage === '@none' && commonType === '@none') {
          break;
        }
      }
      commonLanguage = commonLanguage || '@none';
      commonType = commonType || '@none';
      if(commonType !== '@none') {
        typeOrLanguage = '@type';
        typeOrLanguageValue = commonType;
      } else {
        typeOrLanguageValue = commonLanguage;
      }
    } else {
      if(_isValue(value)) {
        if('@language' in value && !('@index' in value)) {
          containers.push('@language');
          typeOrLanguageValue = value['@language'];
        } else if('@type' in value) {
          typeOrLanguage = '@type';
          typeOrLanguageValue = value['@type'];
        }
      } else {
        typeOrLanguage = '@type';
        typeOrLanguageValue = '@id';
      }
      containers.push('@set');
    }

    // do term selection
    containers.push('@none');
    var term = _selectTerm(
      activeCtx, iri, value, containers, typeOrLanguage, typeOrLanguageValue);
    if(term !== null) {
      return term;
    }
  }

  // no term match, use @vocab if available
  if(relativeTo.vocab) {
    if('@vocab' in activeCtx) {
      // determine if vocab is a prefix of the iri
      var vocab = activeCtx['@vocab'];
      if(iri.indexOf(vocab) === 0 && iri !== vocab) {
        // use suffix as relative iri if it is not a term in the active context
        var suffix = iri.substr(vocab.length);
        if(!(suffix in activeCtx.mappings)) {
          return suffix;
        }
      }
    }
  }

  // no term or @vocab match, check for possible CURIEs
  var choice = null;
  for(var term in activeCtx.mappings) {
    // skip terms with colons, they can't be prefixes
    if(term.indexOf(':') !== -1) {
      continue;
    }
    // skip entries with @ids that are not partial matches
    var definition = activeCtx.mappings[term];
    if(!definition ||
      definition['@id'] === iri || iri.indexOf(definition['@id']) !== 0) {
      continue;
    }

    // a CURIE is usable if:
    // 1. it has no mapping, OR
    // 2. value is null, which means we're not compacting an @value, AND
    //   the mapping matches the IRI)
    var curie = term + ':' + iri.substr(definition['@id'].length);
    var isUsableCurie = (!(curie in activeCtx.mappings) ||
      (value === null && activeCtx.mappings[curie] &&
      activeCtx.mappings[curie]['@id'] === iri));

    // select curie if it is shorter or the same length but lexicographically
    // less than the current choice
    if(isUsableCurie && (choice === null ||
      _compareShortestLeast(curie, choice) < 0)) {
      choice = curie;
    }
  }

  // return chosen curie
  if(choice !== null) {
    return choice;
  }

  // compact IRI relative to base
  if(!relativeTo.vocab) {
    return _removeBase(activeCtx['@base'], iri);
  }

  // return IRI as is
  return iri;
}

function _compactValue(activeCtx, activeProperty, value) {
  // value is a @value
  if(_isValue(value)) {
    // get context rules
    var type = jsonld.getContextValue(activeCtx, activeProperty, '@type');
    var language = jsonld.getContextValue(
      activeCtx, activeProperty, '@language');
    var container = jsonld.getContextValue(
      activeCtx, activeProperty, '@container');

    // whether or not the value has an @index that must be preserved
    var preserveIndex = (('@index' in value) &&
      container !== '@index');

    // if there's no @index to preserve ...
    if(!preserveIndex) {
      // matching @type or @language specified in context, compact value
      if(value['@type'] === type || value['@language'] === language) {
        return value['@value'];
      }
    }

    // return just the value of @value if all are true:
    // 1. @value is the only key or @index isn't being preserved
    // 2. there is no default language or @value is not a string or
    //   the key has a mapping with a null @language
    var keyCount = Object.keys(value).length;
    var isValueOnlyKey = (keyCount === 1 ||
      (keyCount === 2 && ('@index' in value) && !preserveIndex));
    var hasDefaultLanguage = ('@language' in activeCtx);
    var isValueString = _isString(value['@value']);
    var hasNullMapping = (activeCtx.mappings[activeProperty] &&
      activeCtx.mappings[activeProperty]['@language'] === null);
    if(isValueOnlyKey &&
      (!hasDefaultLanguage || !isValueString || hasNullMapping)) {
      return value['@value'];
    }

    var rval = {};

    // preserve @index
    if(preserveIndex) {
      rval[_compactIri(activeCtx, '@index')] = value['@index'];
    }

    if('@type' in value) {
      // compact @type IRI
      rval[_compactIri(activeCtx, '@type')] = _compactIri(
        activeCtx, value['@type'], null, {vocab: true});
    } else if('@language' in value) {
      // alias @language
      rval[_compactIri(activeCtx, '@language')] = value['@language'];
    }

    // alias @value
    rval[_compactIri(activeCtx, '@value')] = value['@value'];

    return rval;
  }

  // value is a subject reference
  var expandedProperty = _expandIri(activeCtx, activeProperty, {vocab: true});
  var type = jsonld.getContextValue(activeCtx, activeProperty, '@type');
  var compacted = _compactIri(
    activeCtx, value['@id'], null, {vocab: type === '@vocab'});

  // compact to scalar
  if(type === '@id' || type === '@vocab' || expandedProperty === '@graph') {
    return compacted;
  }

  var rval = {};
  rval[_compactIri(activeCtx, '@id')] = compacted;
  return rval;
}

function _createTermDefinition(activeCtx, localCtx, term, defined) {
  if(term in defined) {
    // term already defined
    if(defined[term]) {
      return;
    }
    // cycle detected
    throw new JsonLdError(
      'Cyclical context definition detected.',
      'jsonld.CyclicalContext',
      {code: 'cyclic IRI mapping', context: localCtx, term: term});
  }

  // now defining term
  defined[term] = false;

  if(_isKeyword(term)) {
    throw new JsonLdError(
      'Invalid JSON-LD syntax; keywords cannot be overridden.',
      'jsonld.SyntaxError',
      {code: 'keyword redefinition', context: localCtx, term: term});
  }

  if(term === '') {
    throw new JsonLdError(
      'Invalid JSON-LD syntax; a term cannot be an empty string.',
      'jsonld.SyntaxError',
      {code: 'invalid term definition', context: localCtx});
  }

  // remove old mapping
  if(activeCtx.mappings[term]) {
    delete activeCtx.mappings[term];
  }

  // get context term value
  var value = localCtx[term];

  // clear context entry
  if(value === null || (_isObject(value) && value['@id'] === null)) {
    activeCtx.mappings[term] = null;
    defined[term] = true;
    return;
  }

  // convert short-hand value to object w/@id
  if(_isString(value)) {
    value = {'@id': value};
  }

  if(!_isObject(value)) {
    throw new JsonLdError(
      'Invalid JSON-LD syntax; @context property values must be ' +
      'strings or objects.',
      'jsonld.SyntaxError',
      {code: 'invalid term definition', context: localCtx});
  }

  // create new mapping
  var mapping = activeCtx.mappings[term] = {};
  mapping.reverse = false;

  if('@reverse' in value) {
    if('@id' in value) {
      throw new JsonLdError(
        'Invalid JSON-LD syntax; a @reverse term definition must not ' +
        'contain @id.', 'jsonld.SyntaxError',
        {code: 'invalid reverse property', context: localCtx});
    }
    var reverse = value['@reverse'];
    if(!_isString(reverse)) {
      throw new JsonLdError(
        'Invalid JSON-LD syntax; a @context @reverse value must be a string.',
        'jsonld.SyntaxError', {code: 'invalid IRI mapping', context: localCtx});
    }

    // expand and add @id mapping
    var id = _expandIri(
      activeCtx, reverse, {vocab: true, base: false}, localCtx, defined);
    if(!_isAbsoluteIri(id)) {
      throw new JsonLdError(
        'Invalid JSON-LD syntax; a @context @reverse value must be an ' +
        'absolute IRI or a blank node identifier.',
        'jsonld.SyntaxError', {code: 'invalid IRI mapping', context: localCtx});
    }
    mapping['@id'] = id;
    mapping.reverse = true;
  } else if('@id' in value) {
    var id = value['@id'];
    if(!_isString(id)) {
      throw new JsonLdError(
        'Invalid JSON-LD syntax; a @context @id value must be an array ' +
        'of strings or a string.',
        'jsonld.SyntaxError', {code: 'invalid IRI mapping', context: localCtx});
    }
    if(id !== term) {
      // expand and add @id mapping
      id = _expandIri(
        activeCtx, id, {vocab: true, base: false}, localCtx, defined);
      if(!_isAbsoluteIri(id) && !_isKeyword(id)) {
        throw new JsonLdError(
          'Invalid JSON-LD syntax; a @context @id value must be an ' +
          'absolute IRI, a blank node identifier, or a keyword.',
          'jsonld.SyntaxError',
          {code: 'invalid IRI mapping', context: localCtx});
      }
      mapping['@id'] = id;
    }
  }

  if(!('@id' in mapping)) {
    // see if the term has a prefix
    var colon = term.indexOf(':');
    if(colon !== -1) {
      var prefix = term.substr(0, colon);
      if(prefix in localCtx) {
        // define parent prefix
        _createTermDefinition(activeCtx, localCtx, prefix, defined);
      }

      if(activeCtx.mappings[prefix]) {
        // set @id based on prefix parent
        var suffix = term.substr(colon + 1);
        mapping['@id'] = activeCtx.mappings[prefix]['@id'] + suffix;
      } else {
        // term is an absolute IRI
        mapping['@id'] = term;
      }
    } else {
      // non-IRIs *must* define @ids if @vocab is not available
      if(!('@vocab' in activeCtx)) {
        throw new JsonLdError(
          'Invalid JSON-LD syntax; @context terms must define an @id.',
          'jsonld.SyntaxError',
          {code: 'invalid IRI mapping', context: localCtx, term: term});
      }
      // prepend vocab to term
      mapping['@id'] = activeCtx['@vocab'] + term;
    }
  }

  // IRI mapping now defined
  defined[term] = true;

  if('@type' in value) {
    var type = value['@type'];
    if(!_isString(type)) {
      throw new JsonLdError(
        'Invalid JSON-LD syntax; an @context @type values must be a string.',
        'jsonld.SyntaxError',
        {code: 'invalid type mapping', context: localCtx});
    }

    if(type !== '@id' && type !== '@vocab') {
      // expand @type to full IRI
      type = _expandIri(
        activeCtx, type, {vocab: true, base: false}, localCtx, defined);
      if(!_isAbsoluteIri(type)) {
        throw new JsonLdError(
          'Invalid JSON-LD syntax; an @context @type value must be an ' +
          'absolute IRI.',
          'jsonld.SyntaxError',
          {code: 'invalid type mapping', context: localCtx});
      }
      if(type.indexOf('_:') === 0) {
        throw new JsonLdError(
          'Invalid JSON-LD syntax; an @context @type values must be an IRI, ' +
          'not a blank node identifier.',
          'jsonld.SyntaxError',
          {code: 'invalid type mapping', context: localCtx});
      }
    }

    // add @type to mapping
    mapping['@type'] = type;
  }

  if('@container' in value) {
    var container = value['@container'];
    if(container !== '@list' && container !== '@set' &&
      container !== '@index' && container !== '@language') {
      throw new JsonLdError(
        'Invalid JSON-LD syntax; @context @container value must be ' +
        'one of the following: @list, @set, @index, or @language.',
        'jsonld.SyntaxError',
        {code: 'invalid container mapping', context: localCtx});
    }
    if(mapping.reverse && container !== '@index' && container !== '@set' &&
      container !== null) {
      throw new JsonLdError(
        'Invalid JSON-LD syntax; @context @container value for a @reverse ' +
        'type definition must be @index or @set.', 'jsonld.SyntaxError',
        {code: 'invalid reverse property', context: localCtx});
    }

    // add @container to mapping
    mapping['@container'] = container;
  }

  if('@language' in value && !('@type' in value)) {
    var language = value['@language'];
    if(language !== null && !_isString(language)) {
      throw new JsonLdError(
        'Invalid JSON-LD syntax; @context @language value must be ' +
        'a string or null.', 'jsonld.SyntaxError',
        {code: 'invalid language mapping', context: localCtx});
    }

    // add @language to mapping
    if(language !== null) {
      language = language.toLowerCase();
    }
    mapping['@language'] = language;
  }

  // disallow aliasing @context and @preserve
  var id = mapping['@id'];
  if(id === '@context' || id === '@preserve') {
    throw new JsonLdError(
      'Invalid JSON-LD syntax; @context and @preserve cannot be aliased.',
      'jsonld.SyntaxError', {code: 'invalid keyword alias', context: localCtx});
  }
}

function _expandIri(activeCtx, value, relativeTo, localCtx, defined) {
  // already expanded
  if(value === null || _isKeyword(value)) {
    return value;
  }

  // ensure value is interpreted as a string
  value = String(value);

  // define term dependency if not defined
  if(localCtx && value in localCtx && defined[value] !== true) {
    _createTermDefinition(activeCtx, localCtx, value, defined);
  }

  relativeTo = relativeTo || {};
  if(relativeTo.vocab) {
    var mapping = activeCtx.mappings[value];

    // value is explicitly ignored with a null mapping
    if(mapping === null) {
      return null;
    }

    if(mapping) {
      // value is a term
      return mapping['@id'];
    }
  }

  // split value into prefix:suffix
  var colon = value.indexOf(':');
  if(colon !== -1) {
    var prefix = value.substr(0, colon);
    var suffix = value.substr(colon + 1);

    // do not expand blank nodes (prefix of '_') or already-absolute
    // IRIs (suffix of '//')
    if(prefix === '_' || suffix.indexOf('//') === 0) {
      return value;
    }

    // prefix dependency not defined, define it
    if(localCtx && prefix in localCtx) {
      _createTermDefinition(activeCtx, localCtx, prefix, defined);
    }

    // use mapping if prefix is defined
    var mapping = activeCtx.mappings[prefix];
    if(mapping) {
      return mapping['@id'] + suffix;
    }

    // already absolute IRI
    return value;
  }

  // prepend vocab
  if(relativeTo.vocab && '@vocab' in activeCtx) {
    return activeCtx['@vocab'] + value;
  }

  // prepend base
  var rval = value;
  if(relativeTo.base) {
    rval = jsonld.prependBase(activeCtx['@base'], rval);
  }

  return rval;
}

var _removeDotSegments = require('remove-dot-segments');

function _prependBase(base, iri) {
  // skip IRI processing
  if(base === null) {
    return iri;
  }
  // already an absolute IRI
  if(iri.indexOf(':') !== -1) {
    return iri;
  }

  // parse base if it is a string
  if(_isString(base)) {
    base = jsonld.url.parse(base || '');
  }

  // parse given IRI
  var rel = jsonld.url.parse(iri);

  // per RFC3986 5.2.2
  var transform = {
    protocol: base.protocol || ''
  };

  if(rel.authority !== null) {
    transform.authority = rel.authority;
    transform.path = rel.path;
    transform.query = rel.query;
  } else {
    transform.authority = base.authority;

    if(rel.path === '') {
      transform.path = base.path;
      if(rel.query !== null) {
        transform.query = rel.query;
      } else {
        transform.query = base.query;
      }
    } else {
      if(rel.path.indexOf('/') === 0) {
        // IRI represents an absolute path
        transform.path = rel.path;
      } else {
        // merge paths
        var path = base.path;

        // append relative path to the end of the last directory from base
        if(rel.path !== '') {
          path = path.substr(0, path.lastIndexOf('/') + 1);
          if(path.length > 0 && path.substr(-1) !== '/') {
            path += '/';
          }
          path += rel.path;
        }

        transform.path = path;
      }
      transform.query = rel.query;
    }
  }

  // remove slashes and dots in path
  transform.path = _removeDotSegments(transform.path, !!transform.authority);

  // construct URL
  var rval = transform.protocol;
  if(transform.authority !== null) {
    rval += '//' + transform.authority;
  }
  rval += transform.path;
  if(transform.query !== null) {
    rval += '?' + transform.query;
  }
  if(rel.fragment !== null) {
    rval += '#' + rel.fragment;
  }

  // handle empty base
  if(rval === '') {
    rval = './';
  }

  return rval;
}

function _removeBase(base, iri) {
  // skip IRI processing
  if(base === null) {
    return iri;
  }

  if(_isString(base)) {
    base = jsonld.url.parse(base || '');
  }

  // establish base root
  var root = '';
  if(base.href !== '') {
    root += (base.protocol || '') + '//' + (base.authority || '');
  } else if(iri.indexOf('//')) {
    // support network-path reference with empty base
    root += '//';
  }

  // IRI not relative to base
  if(iri.indexOf(root) !== 0) {
    return iri;
  }

  // remove root from IRI and parse remainder
  var rel = jsonld.url.parse(iri.substr(root.length));

  // remove path segments that match (do not remove last segment unless there
  // is a hash or query)
  var baseSegments = base.normalizedPath.split('/');
  var iriSegments = rel.normalizedPath.split('/');
  var last = (rel.fragment || rel.query) ? 0 : 1;
  while(baseSegments.length > 0 && iriSegments.length > last) {
    if(baseSegments[0] !== iriSegments[0]) {
      break;
    }
    baseSegments.shift();
    iriSegments.shift();
  }

  // use '../' for each non-matching base segment
  var rval = '';
  if(baseSegments.length > 0) {
    // don't count the last segment (if it ends with '/' last path doesn't
    // count and if it doesn't end with '/' it isn't a path)
    baseSegments.pop();
    for(var i = 0; i < baseSegments.length; ++i) {
      rval += '../';
    }
  }

  // prepend remaining segments
  rval += iriSegments.join('/');

  // add query and hash
  if(rel.query !== null) {
    rval += '?' + rel.query;
  }
  if(rel.fragment !== null) {
    rval += '#' + rel.fragment;
  }

  // handle empty base
  if(rval === '') {
    rval = './';
  }

  return rval;
}

function _getInitialContext(options) {
  var base = jsonld.url.parse(options.base || '');
  return {
    '@base': base,
    mappings: {},
    inverse: null,
    getInverse: _createInverseContext,
    clone: _cloneActiveContext
  };

  /**
   * Generates an inverse context for use in the compaction algorithm, if
   * not already generated for the given active context.
   *
   * @return the inverse context.
   */
  function _createInverseContext() {
    var activeCtx = this;

    // lazily create inverse
    if(activeCtx.inverse) {
      return activeCtx.inverse;
    }
    var inverse = activeCtx.inverse = {};

    // handle default language
    var defaultLanguage = activeCtx['@language'] || '@none';

    // create term selections for each mapping in the context, ordered by
    // shortest and then lexicographically least
    var mappings = activeCtx.mappings;
    var terms = Object.keys(mappings).sort(_compareShortestLeast);
    for(var i = 0; i < terms.length; ++i) {
      var term = terms[i];
      var mapping = mappings[term];
      if(mapping === null) {
        continue;
      }

      var container = mapping['@container'] || '@none';

      // iterate over every IRI in the mapping
      var ids = mapping['@id'];
      if(!_isArray(ids)) {
        ids = [ids];
      }
      for(var ii = 0; ii < ids.length; ++ii) {
        var iri = ids[ii];
        var entry = inverse[iri];

        // initialize entry
        if(!entry) {
          inverse[iri] = entry = {};
        }

        // add new entry
        if(!entry[container]) {
          entry[container] = {
            '@language': {},
            '@type': {}
          };
        }
        entry = entry[container];

        if(mapping.reverse) {
          // term is preferred for values using @reverse
          _addPreferredTerm(mapping, term, entry['@type'], '@reverse');
        } else if('@type' in mapping) {
          // term is preferred for values using specific type
          _addPreferredTerm(mapping, term, entry['@type'], mapping['@type']);
        } else if('@language' in mapping) {
          // term is preferred for values using specific language
          var language = mapping['@language'] || '@null';
          _addPreferredTerm(mapping, term, entry['@language'], language);
        } else {
          // term is preferred for values w/default language or no type and
          // no language
          // add an entry for the default language
          _addPreferredTerm(mapping, term, entry['@language'], defaultLanguage);

          // add entries for no type and no language
          _addPreferredTerm(mapping, term, entry['@type'], '@none');
          _addPreferredTerm(mapping, term, entry['@language'], '@none');
        }
      }
    }

    return inverse;
  }

  /**
   * Adds the term for the given entry if not already added.
   *
   * @param mapping the term mapping.
   * @param term the term to add.
   * @param entry the inverse context typeOrLanguage entry to add to.
   * @param typeOrLanguageValue the key in the entry to add to.
   */
  function _addPreferredTerm(mapping, term, entry, typeOrLanguageValue) {
    if(!(typeOrLanguageValue in entry)) {
      entry[typeOrLanguageValue] = term;
    }
  }

  /**
   * Clones an active context, creating a child active context.
   *
   * @return a clone (child) of the active context.
   */
  function _cloneActiveContext() {
    var child = {};
    child['@base'] = this['@base'];
    child.mappings = _clone(this.mappings);
    child.clone = this.clone;
    child.inverse = null;
    child.getInverse = this.getInverse;
    if('@language' in this) {
      child['@language'] = this['@language'];
    }
    if('@vocab' in this) {
      child['@vocab'] = this['@vocab'];
    }
    return child;
  }
}

function _isKeyword(v) {
  if(!_isString(v)) {
    return false;
  }
  switch(v) {
  case '@base':
  case '@context':
  case '@container':
  case '@default':
  case '@embed':
  case '@explicit':
  case '@graph':
  case '@id':
  case '@index':
  case '@language':
  case '@list':
  case '@omitDefault':
  case '@preserve':
  case '@requireAll':
  case '@reverse':
  case '@set':
  case '@type':
  case '@value':
  case '@vocab':
    return true;
  }
  return false;
}

function _isObject(v) {
  return (Object.prototype.toString.call(v) === '[object Object]');
}

function _isEmptyObject(v) {
  return _isObject(v) && Object.keys(v).length === 0;
}

function _isArray(v) {
  return Array.isArray(v);
}

function _validateTypeValue(v) {
  // can be a string or an empty object
  if(_isString(v) || _isEmptyObject(v)) {
    return;
  }

  // must be an array
  var isValid = false;
  if(_isArray(v)) {
    // must contain only strings
    isValid = true;
    for(var i = 0; i < v.length; ++i) {
      if(!(_isString(v[i]))) {
        isValid = false;
        break;
      }
    }
  }

  if(!isValid) {
    throw new JsonLdError(
      'Invalid JSON-LD syntax; "@type" value must a string, an array of ' +
      'strings, or an empty object.', 'jsonld.SyntaxError',
      {code: 'invalid type value', value: v});
  }
}

function _isString(v) {
  return (typeof v === 'string' ||
    Object.prototype.toString.call(v) === '[object String]');
}

function _isNumber(v) {
  return (typeof v === 'number' ||
    Object.prototype.toString.call(v) === '[object Number]');
}

function _isDouble(v) {
  return _isNumber(v) && String(v).indexOf('.') !== -1;
}

function _isNumeric(v) {
  return !isNaN(parseFloat(v)) && isFinite(v);
}

function _isBoolean(v) {
  return (typeof v === 'boolean' ||
    Object.prototype.toString.call(v) === '[object Boolean]');
}

function _isUndefined(v) {
  return (typeof v === 'undefined');
}

function _isSubject(v) {
  // Note: A value is a subject if all of these hold true:
  // 1. It is an Object.
  // 2. It is not a @value, @set, or @list.
  // 3. It has more than 1 key OR any existing key is not @id.
  var rval = false;
  if(_isObject(v) &&
    !(('@value' in v) || ('@set' in v) || ('@list' in v))) {
    var keyCount = Object.keys(v).length;
    rval = (keyCount > 1 || !('@id' in v));
  }
  return rval;
}

function _isSubjectReference(v) {
  // Note: A value is a subject reference if all of these hold true:
  // 1. It is an Object.
  // 2. It has a single key: @id.
  return (_isObject(v) && Object.keys(v).length === 1 && ('@id' in v));
}

function _isValue(v) {
  // Note: A value is a @value if all of these hold true:
  // 1. It is an Object.
  // 2. It has the @value property.
  return _isObject(v) && ('@value' in v);
}

function _isList(v) {
  // Note: A value is a @list if all of these hold true:
  // 1. It is an Object.
  // 2. It has the @list property.
  return _isObject(v) && ('@list' in v);
}

function _isBlankNode(v) {
  // Note: A value is a blank node if all of these hold true:
  // 1. It is an Object.
  // 2. If it has an @id key its value begins with '_:'.
  // 3. It has no keys OR is not a @value, @set, or @list.
  var rval = false;
  if(_isObject(v)) {
    if('@id' in v) {
      rval = (v['@id'].indexOf('_:') === 0);
    } else {
      rval = (Object.keys(v).length === 0 ||
        !(('@value' in v) || ('@set' in v) || ('@list' in v)));
    }
  }
  return rval;
}

function _isAbsoluteIri(v) {
  return _isString(v) && v.indexOf(':') !== -1;
}

function _clone(value) {
  if(value && typeof value === 'object') {
    var rval;
    if(_isArray(value)) {
      rval = [];
      for(var i = 0; i < value.length; ++i) {
        rval[i] = _clone(value[i]);
      }
    } else if(_isObject(value)) {
      rval = {};
      for(var key in value) {
        rval[key] = _clone(value[key]);
      }
    } else {
      rval = value.toString();
    }
    return rval;
  }
  return value;
}

function _findContextUrls(input, urls, replace, base) {
  var count = Object.keys(urls).length;
  if(_isArray(input)) {
    for(var i = 0; i < input.length; ++i) {
      _findContextUrls(input[i], urls, replace, base);
    }
    return (count < Object.keys(urls).length);
  } else if(_isObject(input)) {
    for(var key in input) {
      if(key !== '@context') {
        _findContextUrls(input[key], urls, replace, base);
        continue;
      }

      // get @context
      var ctx = input[key];

      // array @context
      if(_isArray(ctx)) {
        var length = ctx.length;
        for(var i = 0; i < length; ++i) {
          var _ctx = ctx[i];
          if(_isString(_ctx)) {
            _ctx = jsonld.prependBase(base, _ctx);
            // replace w/@context if requested
            if(replace) {
              _ctx = urls[_ctx];
              if(_isArray(_ctx)) {
                // add flattened context
                Array.prototype.splice.apply(ctx, [i, 1].concat(_ctx));
                i += _ctx.length - 1;
                length = ctx.length;
              } else {
                ctx[i] = _ctx;
              }
            } else if(!(_ctx in urls)) {
              // @context URL found
              urls[_ctx] = false;
            }
          }
        }
      } else if(_isString(ctx)) {
        // string @context
        ctx = jsonld.prependBase(base, ctx);
        // replace w/@context if requested
        if(replace) {
          input[key] = urls[ctx];
        } else if(!(ctx in urls)) {
          // @context URL found
          urls[ctx] = false;
        }
      }
    }
    return (count < Object.keys(urls).length);
  }
  return false;
}

function _retrieveContextUrls(input, options, callback) {
  // if any error occurs during URL resolution, quit
  var error = null;

  // recursive document loader
  var documentLoader = options.documentLoader;
  var retrieve = function(input, cycles, documentLoader, base, callback) {
    if(Object.keys(cycles).length > MAX_CONTEXT_URLS) {
      error = new JsonLdError(
        'Maximum number of @context URLs exceeded.',
        'jsonld.ContextUrlError',
        {code: 'loading remote context failed', max: MAX_CONTEXT_URLS});
      return callback(error);
    }

    // for tracking the URLs to retrieve
    var urls = {};

    // finished will be called once the URL queue is empty
    var finished = function() {
      // replace all URLs in the input
      _findContextUrls(input, urls, true, base);
      callback(null, input);
    };

    // find all URLs in the given input
    if(!_findContextUrls(input, urls, false, base)) {
      // no new URLs in input
      finished();
    }

    // queue all unretrieved URLs
    var queue = [];
    for(var url in urls) {
      if(urls[url] === false) {
        queue.push(url);
      }
    }

    // retrieve URLs in queue
    var count = queue.length;
    for(var i = 0; i < queue.length; ++i) {
      (function(url) {
        // check for context URL cycle
        if(url in cycles) {
          error = new JsonLdError(
            'Cyclical @context URLs detected.',
            'jsonld.ContextUrlError',
            {code: 'recursive context inclusion', url: url});
          return callback(error);
        }
        var _cycles = _clone(cycles);
        _cycles[url] = true;
        var done = function(err, remoteDoc) {
          // short-circuit if there was an error with another URL
          if(error) {
            return;
          }

          var ctx = remoteDoc ? remoteDoc.document : null;

          // parse string context as JSON
          if(!err && _isString(ctx)) {
            try {
              ctx = JSON.parse(ctx);
            } catch(ex) {
              err = ex;
            }
          }

          // ensure ctx is an object
          if(err) {
            err = new JsonLdError(
              'Dereferencing a URL did not result in a valid JSON-LD object. ' +
              'Possible causes are an inaccessible URL perhaps due to ' +
              'a same-origin policy (ensure the server uses CORS if you are ' +
              'using client-side JavaScript), too many redirects, a ' +
              'non-JSON response, or more than one HTTP Link Header was ' +
              'provided for a remote context.',
              'jsonld.InvalidUrl',
              {code: 'loading remote context failed', url: url, cause: err});
          } else if(!_isObject(ctx)) {
            err = new JsonLdError(
              'Dereferencing a URL did not result in a JSON object. The ' +
              'response was valid JSON, but it was not a JSON object.',
              'jsonld.InvalidUrl',
              {code: 'invalid remote context', url: url, cause: err});
          }
          if(err) {
            error = err;
            return callback(error);
          }

          // use empty context if no @context key is present
          if(!('@context' in ctx)) {
            ctx = {'@context': {}};
          } else {
            ctx = {'@context': ctx['@context']};
          }

          // append context URL to context if given
          if(remoteDoc.contextUrl) {
            if(!_isArray(ctx['@context'])) {
              ctx['@context'] = [ctx['@context']];
            }
            ctx['@context'].push(remoteDoc.contextUrl);
          }

          // recurse
          retrieve(ctx, _cycles, documentLoader, url, function(err, ctx) {
            if(err) {
              return callback(err);
            }
            urls[url] = ctx['@context'];
            count -= 1;
            if(count === 0) {
              finished();
            }
          });
        };
        documentLoader(url, done);
         
      }(queue[i]));
    }
  };
  retrieve(input, {}, documentLoader, options.base, callback);
}

if(!Object.keys) {
  Object.keys = function(o) {
    if(o !== Object(o)) {
      throw new TypeError('Object.keys called on non-object');
    }
    var rval = [];
    for(var p in o) {
      if(Object.prototype.hasOwnProperty.call(o, p)) {
        rval.push(p);
      }
    }
    return rval;
  };
}

function _parseNQuads(input) {
  // define partial regexes
  var iri = '(?:<([^:]+:[^>]*)>)';
  var bnode = '(_:(?:[A-Za-z0-9]+))';
  var plain = '"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"';
  var datatype = '(?:\\^\\^' + iri + ')';
  var language = '(?:@([a-z]+(?:-[a-z0-9]+)*))';
  var literal = '(?:' + plain + '(?:' + datatype + '|' + language + ')?)';
  var comment = '(?:#.*)?';
  var ws = '[ \\t]+';
  var wso = '[ \\t]*';
  var eoln = /(?:\r\n)|(?:\n)|(?:\r)/g;
  var empty = new RegExp('^' + wso + comment + '$');

  // define quad part regexes
  var subject = '(?:' + iri + '|' + bnode + ')' + ws;
  var property = iri + ws;
  var object = '(?:' + iri + '|' + bnode + '|' + literal + ')' + wso;
  var graphName = '(?:\\.|(?:(?:' + iri + '|' + bnode + ')' + wso + '\\.))';

  // full quad regex
  var quad = new RegExp(
    '^' + wso + subject + property + object + graphName + wso + comment + '$');

  // build RDF dataset
  var dataset = {};

  // split N-Quad input into lines
  var lines = input.split(eoln);
  var lineNumber = 0;
  for(var li = 0; li < lines.length; ++li) {
    var line = lines[li];
    lineNumber++;

    // skip empty lines
    if(empty.test(line)) {
      continue;
    }

    // parse quad
    var match = line.match(quad);
    if(match === null) {
      throw new JsonLdError(
        'Error while parsing N-Quads; invalid quad.',
        'jsonld.ParseError', {line: lineNumber});
    }

    // create RDF triple
    var triple = {};

    // get subject
    if(!_isUndefined(match[1])) {
      triple.subject = {type: 'IRI', value: match[1]};
    } else {
      triple.subject = {type: 'blank node', value: match[2]};
    }

    // get predicate
    triple.predicate = {type: 'IRI', value: match[3]};

    // get object
    if(!_isUndefined(match[4])) {
      triple.object = {type: 'IRI', value: match[4]};
    } else if(!_isUndefined(match[5])) {
      triple.object = {type: 'blank node', value: match[5]};
    } else {
      triple.object = {type: 'literal'};
      if(!_isUndefined(match[7])) {
        triple.object.datatype = match[7];
      } else if(!_isUndefined(match[8])) {
        triple.object.datatype = RDF_LANGSTRING;
        triple.object.language = match[8];
      } else {
        triple.object.datatype = XSD_STRING;
      }
      var unescaped = match[6]
        .replace(/\\"/g, '"')
        .replace(/\\t/g, '\t')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\\\/g, '\\');
      triple.object.value = unescaped;
    }

    // get graph name ('@default' is used for the default graph)
    var name = '@default';
    if(!_isUndefined(match[9])) {
      name = match[9];
    } else if(!_isUndefined(match[10])) {
      name = match[10];
    }

    // initialize graph in dataset
    if(!(name in dataset)) {
      dataset[name] = [triple];
    } else {
      // add triple if unique to its graph
      var unique = true;
      var triples = dataset[name];
      for(var ti = 0; unique && ti < triples.length; ++ti) {
        if(_compareRDFTriples(triples[ti], triple)) {
          unique = false;
        }
      }
      if(unique) {
        triples.push(triple);
      }
    }
  }

  return dataset;
}

jsonld.registerRDFParser('application/nquads', _parseNQuads);

function _toNQuads(dataset) {
  var quads = [];
  for(var graphName in dataset) {
    var triples = dataset[graphName];
    for(var ti = 0; ti < triples.length; ++ti) {
      var triple = triples[ti];
      if(graphName === '@default') {
        graphName = null;
      }
      quads.push(_toNQuad(triple, graphName));
    }
  }
  return quads.sort().join('');
}

function _toNQuad(triple, graphName) {
  var s = triple.subject;
  var p = triple.predicate;
  var o = triple.object;
  var g = graphName || null;
  if('name' in triple && triple.name) {
    g = triple.name.value;
  }

  var quad = '';

  // subject is an IRI
  if(s.type === 'IRI') {
    quad += '<' + s.value + '>';
  } else {
    quad += s.value;
  }
  quad += ' ';

  // predicate is an IRI
  if(p.type === 'IRI') {
    quad += '<' + p.value + '>';
  } else {
    quad += p.value;
  }
  quad += ' ';

  // object is IRI, bnode, or literal
  if(o.type === 'IRI') {
    quad += '<' + o.value + '>';
  } else if(o.type === 'blank node') {
    quad += o.value;
  } else {
    var escaped = o.value
      .replace(/\\/g, '\\\\')
      .replace(/\t/g, '\\t')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\"/g, '\\"');
    quad += '"' + escaped + '"';
    if(o.datatype === RDF_LANGSTRING) {
      if(o.language) {
        quad += '@' + o.language;
      }
    } else if(o.datatype !== XSD_STRING) {
      quad += '^^<' + o.datatype + '>';
    }
  }

  // graph
  if(g !== null && g !== undefined) {
    if(g.indexOf('_:') !== 0) {
      quad += ' <' + g + '>';
    } else {
      quad += ' ' + g;
    }
  }

  quad += ' .\n';
  return quad;
}

function _parseRdfaApiData(data) {
  var dataset = {};
  dataset['@default'] = [];

  var subjects = data.getSubjects();
  for(var si = 0; si < subjects.length; ++si) {
    var subject = subjects[si];
    if(subject === null) {
      continue;
    }

    // get all related triples
    var triples = data.getSubjectTriples(subject);
    if(triples === null) {
      continue;
    }
    var predicates = triples.predicates;
    for(var predicate in predicates) {
      // iterate over objects
      var objects = predicates[predicate].objects;
      for(var oi = 0; oi < objects.length; ++oi) {
        var object = objects[oi];

        // create RDF triple
        var triple = {};

        // add subject
        if(subject.indexOf('_:') === 0) {
          triple.subject = {type: 'blank node', value: subject};
        } else {
          triple.subject = {type: 'IRI', value: subject};
        }

        // add predicate
        if(predicate.indexOf('_:') === 0) {
          triple.predicate = {type: 'blank node', value: predicate};
        } else {
          triple.predicate = {type: 'IRI', value: predicate};
        }

        // serialize XML literal
        var value = object.value;
        if(object.type === RDF_XML_LITERAL) {
          // initialize XMLSerializer
          if(!XMLSerializer) {
            _defineXMLSerializer();
          }
          var serializer = new XMLSerializer();
          value = '';
          for(var x = 0; x < object.value.length; x++) {
            if(object.value[x].nodeType === Node.ELEMENT_NODE) {
              value += serializer.serializeToString(object.value[x]);
            } else if(object.value[x].nodeType === Node.TEXT_NODE) {
              value += object.value[x].nodeValue;
            }
          }
        }

        // add object
        triple.object = {};

        // object is an IRI
        if(object.type === RDF_OBJECT) {
          if(object.value.indexOf('_:') === 0) {
            triple.object.type = 'blank node';
          } else {
            triple.object.type = 'IRI';
          }
        } else {
          // object is a literal
          triple.object.type = 'literal';
          if(object.type === RDF_PLAIN_LITERAL) {
            if(object.language) {
              triple.object.datatype = RDF_LANGSTRING;
              triple.object.language = object.language;
            } else {
              triple.object.datatype = XSD_STRING;
            }
          } else {
            triple.object.datatype = object.type;
          }
        }
        triple.object.value = value;

        // add triple to dataset in default graph
        dataset['@default'].push(triple);
      }
    }
  }

  return dataset;
}

jsonld.registerRDFParser('rdfa-api', _parseRdfaApiData);

function IdentifierIssuer(prefix) {
  this.prefix = prefix;
  this.counter = 0;
  this.existing = {};
}

jsonld.IdentifierIssuer = IdentifierIssuer;

jsonld.UniqueNamer = IdentifierIssuer;

IdentifierIssuer.prototype.clone = function() {
  var copy = new IdentifierIssuer(this.prefix);
  copy.counter = this.counter;
  copy.existing = _clone(this.existing);
  return copy;
};

IdentifierIssuer.prototype.getId = function(old) {
  // return existing old identifier
  if(old && old in this.existing) {
    return this.existing[old];
  }

  // get next identifier
  var identifier = this.prefix + this.counter;
  this.counter += 1;

  // save mapping
  if(old) {
    this.existing[old] = identifier;
  }

  return identifier;
};

IdentifierIssuer.prototype.getName = IdentifierIssuer.prototype.getName;

IdentifierIssuer.prototype.hasId = function(old) {
  return (old in this.existing);
};

IdentifierIssuer.prototype.isNamed = IdentifierIssuer.prototype.hasId;

var Permutator = function(list) {
  // original array
  this.list = list.sort();
  // indicates whether there are more permutations
  this.done = false;
  // directional info for permutation algorithm
  this.left = {};
  for(var i = 0; i < list.length; ++i) {
    this.left[list[i]] = true;
  }
};

Permutator.prototype.hasNext = function() {
  return !this.done;
};

Permutator.prototype.next = function() {
  // copy current permutation
  var rval = this.list.slice();

  /* Calculate the next permutation using the Steinhaus-Johnson-Trotter
   permutation algorithm. */

  // get largest mobile element k
  // (mobile: element is greater than the one it is looking at)
  var k = null;
  var pos = 0;
  var length = this.list.length;
  for(var i = 0; i < length; ++i) {
    var element = this.list[i];
    var left = this.left[element];
    if((k === null || element > k) &&
      ((left && i > 0 && element > this.list[i - 1]) ||
      (!left && i < (length - 1) && element > this.list[i + 1]))) {
      k = element;
      pos = i;
    }
  }

  // no more permutations
  if(k === null) {
    this.done = true;
  } else {
    // swap k and the element it is looking at
    var swap = this.left[k] ? pos - 1 : pos + 1;
    this.list[pos] = this.list[swap];
    this.list[swap] = k;

    // reverse the direction of all elements larger than k
    for(var i = 0; i < length; ++i) {
      if(this.list[i] > k) {
        this.left[this.list[i]] = !this.left[this.list[i]];
      }
    }
  }

  return rval;
};

var NormalizeHash = function(algorithm) {
  if(!(this instanceof NormalizeHash)) {
    return new NormalizeHash(algorithm);
  }
  if(['URDNA2015', 'URGNA2012'].indexOf(algorithm) === -1) {
    throw new Error(
      'Invalid RDF Dataset Normalization algorithm: ' + algorithm);
  }
  NormalizeHash._init.call(this, algorithm);
};

NormalizeHash.hashNQuads = function(algorithm, nquads) {
  var md = new NormalizeHash(algorithm);
  for(var i = 0; i < nquads.length; ++i) {
    md.update(nquads[i]);
  }
  return md.digest();
};

(function(_nodejs) {

if(_nodejs) {
  // define NormalizeHash using native crypto lib
  var crypto = require('crypto');
  NormalizeHash._init = function(algorithm) {
    if(algorithm === 'URDNA2015') {
      algorithm = 'sha256';
    } else {
      // assume URGNA2012
      algorithm = 'sha1';
    }
    this.md = crypto.createHash(algorithm);
  };
  NormalizeHash.prototype.update = function(msg) {
    return this.md.update(msg, 'utf8');
  };
  NormalizeHash.prototype.digest = function() {
    return this.md.digest('hex');
  };
  return;
}

// define NormalizeHash using JavaScript
NormalizeHash._init = function(algorithm) {
  if(algorithm === 'URDNA2015') {
    algorithm = new sha256.Algorithm();
  } else {
    // assume URGNA2012
    algorithm = new sha1.Algorithm();
  }
  this.md = new MessageDigest(algorithm);
};
NormalizeHash.prototype.update = function(msg) {
  return this.md.update(msg);
};
NormalizeHash.prototype.digest = function() {
  return this.md.digest().toHex();
};

/////////////////////////// DEFINE MESSAGE DIGEST API /////////////////////////

/**
 * Creates a new MessageDigest.
 *
 * @param algorithm the algorithm to use.
 */
var MessageDigest = function(algorithm) {
  if(!(this instanceof MessageDigest)) {
    return new MessageDigest(algorithm);
  }

  this._algorithm = algorithm;

  // create shared padding as needed
  if(!MessageDigest._padding ||
    MessageDigest._padding.length < this._algorithm.blockSize) {
    MessageDigest._padding = String.fromCharCode(128);
    var c = String.fromCharCode(0x00);
    var n = 64;
    while(n > 0) {
      if(n & 1) {
        MessageDigest._padding += c;
      }
      n >>>= 1;
      if(n > 0) {
        c += c;
      }
    }
  }

  // start digest automatically for first time
  this.start();
};

/**
 * Starts the digest.
 *
 * @return this digest object.
 */
MessageDigest.prototype.start = function() {
  // up to 56-bit message length for convenience
  this.messageLength = 0;

  // full message length
  this.fullMessageLength = [];
  var int32s = this._algorithm.messageLengthSize / 4;
  for(var i = 0; i < int32s; ++i) {
    this.fullMessageLength.push(0);
  }

  // input buffer
  this._input = new MessageDigest.ByteBuffer();

  // get starting state
  this.state = this._algorithm.start();

  return this;
};

/**
 * Updates the digest with the given message input. The input must be
 * a string of characters.
 *
 * @param msg the message input to update with (ByteBuffer or string).
 *
 * @return this digest object.
 */
MessageDigest.prototype.update = function(msg) {
  // encode message as a UTF-8 encoded binary string
  msg = new MessageDigest.ByteBuffer(unescape(encodeURIComponent(msg)));

  // update message length
  this.messageLength += msg.length();
  var len = msg.length();
  len = [(len / 0x100000000) >>> 0, len >>> 0];
  for(var i = this.fullMessageLength.length - 1; i >= 0; --i) {
    this.fullMessageLength[i] += len[1];
    len[1] = len[0] + ((this.fullMessageLength[i] / 0x100000000) >>> 0);
    this.fullMessageLength[i] = this.fullMessageLength[i] >>> 0;
    len[0] = ((len[1] / 0x100000000) >>> 0);
  }

  // add bytes to input buffer
  this._input.putBytes(msg.bytes());

  // digest blocks
  while(this._input.length() >= this._algorithm.blockSize) {
    this.state = this._algorithm.digest(this.state, this._input);
  }

  // compact input buffer every 2K or if empty
  if(this._input.read > 2048 || this._input.length() === 0) {
    this._input.compact();
  }

  return this;
};

/**
 * Produces the digest.
 *
 * @return a byte buffer containing the digest value.
 */
MessageDigest.prototype.digest = function() {
  /* Note: Here we copy the remaining bytes in the input buffer and add the
  appropriate padding. Then we do the final update on a copy of the state so
  that if the user wants to get intermediate digests they can do so. */

  /* Determine the number of bytes that must be added to the message to
  ensure its length is appropriately congruent. In other words, the data to
  be digested must be a multiple of `blockSize`. This data includes the
  message, some padding, and the length of the message. Since the length of
  the message will be encoded as `messageLengthSize` bytes, that means that
  the last segment of the data must have `blockSize` - `messageLengthSize`
  bytes of message and padding. Therefore, the length of the message plus the
  padding must be congruent to X mod `blockSize` because
  `blockSize` - `messageLengthSize` = X.

  For example, SHA-1 is congruent to 448 mod 512 and SHA-512 is congruent to
  896 mod 1024. SHA-1 uses a `blockSize` of 64 bytes (512 bits) and a
  `messageLengthSize` of 8 bytes (64 bits). SHA-512 uses a `blockSize` of
  128 bytes (1024 bits) and a `messageLengthSize` of 16 bytes (128 bits).

  In order to fill up the message length it must be filled with padding that
  begins with 1 bit followed by all 0 bits. Padding must *always* be present,
  so if the message length is already congruent, then `blockSize` padding bits
  must be added. */

  // create final block
  var finalBlock = new MessageDigest.ByteBuffer();
  finalBlock.putBytes(this._input.bytes());

  // compute remaining size to be digested (include message length size)
  var remaining = (
    this.fullMessageLength[this.fullMessageLength.length - 1] +
    this._algorithm.messageLengthSize);

  // add padding for overflow blockSize - overflow
  // _padding starts with 1 byte with first bit is set (byte value 128), then
  // there may be up to (blockSize - 1) other pad bytes
  var overflow = remaining & (this._algorithm.blockSize - 1);
  finalBlock.putBytes(MessageDigest._padding.substr(
    0, this._algorithm.blockSize - overflow));

  // serialize message length in bits in big-endian order; since length
  // is stored in bytes we multiply by 8 (left shift by 3 and merge in
  // remainder from )
  var messageLength = new MessageDigest.ByteBuffer();
  for(var i = 0; i < this.fullMessageLength.length; ++i) {
    messageLength.putInt32((this.fullMessageLength[i] << 3) |
      (this.fullMessageLength[i + 1] >>> 28));
  }

  // write the length of the message (algorithm-specific)
  this._algorithm.writeMessageLength(finalBlock, messageLength);

  // digest final block
  var state = this._algorithm.digest(this.state.copy(), finalBlock);

  // write state to buffer
  var rval = new MessageDigest.ByteBuffer();
  state.write(rval);
  return rval;
};

/**
 * Creates a simple byte buffer for message digest operations.
 *
 * @param data the data to put in the buffer.
 */
MessageDigest.ByteBuffer = function(data) {
  if(typeof data === 'string') {
    this.data = data;
  } else {
    this.data = '';
  }
  this.read = 0;
};

/**
 * Puts a 32-bit integer into this buffer in big-endian order.
 *
 * @param i the 32-bit integer.
 */
MessageDigest.ByteBuffer.prototype.putInt32 = function(i) {
  this.data += (
    String.fromCharCode(i >> 24 & 0xFF) +
    String.fromCharCode(i >> 16 & 0xFF) +
    String.fromCharCode(i >> 8 & 0xFF) +
    String.fromCharCode(i & 0xFF));
};

/**
 * Gets a 32-bit integer from this buffer in big-endian order and
 * advances the read pointer by 4.
 *
 * @return the word.
 */
MessageDigest.ByteBuffer.prototype.getInt32 = function() {
  var rval = (
    this.data.charCodeAt(this.read) << 24 ^
    this.data.charCodeAt(this.read + 1) << 16 ^
    this.data.charCodeAt(this.read + 2) << 8 ^
    this.data.charCodeAt(this.read + 3));
  this.read += 4;
  return rval;
};

/**
 * Puts the given bytes into this buffer.
 *
 * @param bytes the bytes as a binary-encoded string.
 */
MessageDigest.ByteBuffer.prototype.putBytes = function(bytes) {
  this.data += bytes;
};

/**
 * Gets the bytes in this buffer.
 *
 * @return a string full of UTF-8 encoded characters.
 */
MessageDigest.ByteBuffer.prototype.bytes = function() {
  return this.data.slice(this.read);
};

/**
 * Gets the number of bytes in this buffer.
 *
 * @return the number of bytes in this buffer.
 */
MessageDigest.ByteBuffer.prototype.length = function() {
  return this.data.length - this.read;
};

/**
 * Compacts this buffer.
 */
MessageDigest.ByteBuffer.prototype.compact = function() {
  this.data = this.data.slice(this.read);
  this.read = 0;
};

/**
 * Converts this buffer to a hexadecimal string.
 *
 * @return a hexadecimal string.
 */
MessageDigest.ByteBuffer.prototype.toHex = function() {
  var rval = '';
  for(var i = this.read; i < this.data.length; ++i) {
    var b = this.data.charCodeAt(i);
    if(b < 16) {
      rval += '0';
    }
    rval += b.toString(16);
  }
  return rval;
};

///////////////////////////// DEFINE SHA-1 ALGORITHM //////////////////////////

var sha1 = {
  // used for word storage
  _w: null
};

sha1.Algorithm = function() {
  this.name = 'sha1',
  this.blockSize = 64;
  this.digestLength = 20;
  this.messageLengthSize = 8;
};

sha1.Algorithm.prototype.start = function() {
  if(!sha1._w) {
    sha1._w = new Array(80);
  }
  return sha1._createState();
};

sha1.Algorithm.prototype.writeMessageLength = function(
  finalBlock, messageLength) {
  // message length is in bits and in big-endian order; simply append
  finalBlock.putBytes(messageLength.bytes());
};

sha1.Algorithm.prototype.digest = function(s, input) {
  // consume 512 bit (64 byte) chunks
  var t, a, b, c, d, e, f, i;
  var len = input.length();
  var _w = sha1._w;
  while(len >= 64) {
    // initialize hash value for this chunk
    a = s.h0;
    b = s.h1;
    c = s.h2;
    d = s.h3;
    e = s.h4;

    // the _w array will be populated with sixteen 32-bit big-endian words
    // and then extended into 80 32-bit words according to SHA-1 algorithm
    // and for 32-79 using Max Locktyukhin's optimization

    // round 1
    for(i = 0; i < 16; ++i) {
      t = input.getInt32();
      _w[i] = t;
      f = d ^ (b & (c ^ d));
      t = ((a << 5) | (a >>> 27)) + f + e + 0x5A827999 + t;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    for(; i < 20; ++i) {
      t = (_w[i - 3] ^ _w[i - 8] ^ _w[i - 14] ^ _w[i - 16]);
      t = (t << 1) | (t >>> 31);
      _w[i] = t;
      f = d ^ (b & (c ^ d));
      t = ((a << 5) | (a >>> 27)) + f + e + 0x5A827999 + t;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    // round 2
    for(; i < 32; ++i) {
      t = (_w[i - 3] ^ _w[i - 8] ^ _w[i - 14] ^ _w[i - 16]);
      t = (t << 1) | (t >>> 31);
      _w[i] = t;
      f = b ^ c ^ d;
      t = ((a << 5) | (a >>> 27)) + f + e + 0x6ED9EBA1 + t;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    for(; i < 40; ++i) {
      t = (_w[i - 6] ^ _w[i - 16] ^ _w[i - 28] ^ _w[i - 32]);
      t = (t << 2) | (t >>> 30);
      _w[i] = t;
      f = b ^ c ^ d;
      t = ((a << 5) | (a >>> 27)) + f + e + 0x6ED9EBA1 + t;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    // round 3
    for(; i < 60; ++i) {
      t = (_w[i - 6] ^ _w[i - 16] ^ _w[i - 28] ^ _w[i - 32]);
      t = (t << 2) | (t >>> 30);
      _w[i] = t;
      f = (b & c) | (d & (b ^ c));
      t = ((a << 5) | (a >>> 27)) + f + e + 0x8F1BBCDC + t;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    // round 4
    for(; i < 80; ++i) {
      t = (_w[i - 6] ^ _w[i - 16] ^ _w[i - 28] ^ _w[i - 32]);
      t = (t << 2) | (t >>> 30);
      _w[i] = t;
      f = b ^ c ^ d;
      t = ((a << 5) | (a >>> 27)) + f + e + 0xCA62C1D6 + t;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }

    // update hash state
    s.h0 = (s.h0 + a) | 0;
    s.h1 = (s.h1 + b) | 0;
    s.h2 = (s.h2 + c) | 0;
    s.h3 = (s.h3 + d) | 0;
    s.h4 = (s.h4 + e) | 0;

    len -= 64;
  }

  return s;
};

sha1._createState = function() {
  var state = {
    h0: 0x67452301,
    h1: 0xEFCDAB89,
    h2: 0x98BADCFE,
    h3: 0x10325476,
    h4: 0xC3D2E1F0
  };
  state.copy = function() {
    var rval = sha1._createState();
    rval.h0 = state.h0;
    rval.h1 = state.h1;
    rval.h2 = state.h2;
    rval.h3 = state.h3;
    rval.h4 = state.h4;
    return rval;
  };
  state.write = function(buffer) {
    buffer.putInt32(state.h0);
    buffer.putInt32(state.h1);
    buffer.putInt32(state.h2);
    buffer.putInt32(state.h3);
    buffer.putInt32(state.h4);
  };
  return state;
};

//////////////////////////// DEFINE SHA-256 ALGORITHM /////////////////////////

var sha256 = {
  // shared state
  _k: null,
  _w: null
};

sha256.Algorithm = function() {
  this.name = 'sha256',
  this.blockSize = 64;
  this.digestLength = 32;
  this.messageLengthSize = 8;
};

sha256.Algorithm.prototype.start = function() {
  if(!sha256._k) {
    sha256._init();
  }
  return sha256._createState();
};

sha256.Algorithm.prototype.writeMessageLength = function(
  finalBlock, messageLength) {
  // message length is in bits and in big-endian order; simply append
  finalBlock.putBytes(messageLength.bytes());
};

sha256.Algorithm.prototype.digest = function(s, input) {
  // consume 512 bit (64 byte) chunks
  var t1, t2, s0, s1, ch, maj, i, a, b, c, d, e, f, g, h;
  var len = input.length();
  var _k = sha256._k;
  var _w = sha256._w;
  while(len >= 64) {
    // the w array will be populated with sixteen 32-bit big-endian words
    // and then extended into 64 32-bit words according to SHA-256
    for(i = 0; i < 16; ++i) {
      _w[i] = input.getInt32();
    }
    for(; i < 64; ++i) {
      // XOR word 2 words ago rot right 17, rot right 19, shft right 10
      t1 = _w[i - 2];
      t1 =
        ((t1 >>> 17) | (t1 << 15)) ^
        ((t1 >>> 19) | (t1 << 13)) ^
        (t1 >>> 10);
      // XOR word 15 words ago rot right 7, rot right 18, shft right 3
      t2 = _w[i - 15];
      t2 =
        ((t2 >>> 7) | (t2 << 25)) ^
        ((t2 >>> 18) | (t2 << 14)) ^
        (t2 >>> 3);
      // sum(t1, word 7 ago, t2, word 16 ago) modulo 2^32
      _w[i] = (t1 + _w[i - 7] + t2 + _w[i - 16]) | 0;
    }

    // initialize hash value for this chunk
    a = s.h0;
    b = s.h1;
    c = s.h2;
    d = s.h3;
    e = s.h4;
    f = s.h5;
    g = s.h6;
    h = s.h7;

    // round function
    for(i = 0; i < 64; ++i) {
      // Sum1(e)
      s1 =
        ((e >>> 6) | (e << 26)) ^
        ((e >>> 11) | (e << 21)) ^
        ((e >>> 25) | (e << 7));
      // Ch(e, f, g) (optimized the same way as SHA-1)
      ch = g ^ (e & (f ^ g));
      // Sum0(a)
      s0 =
        ((a >>> 2) | (a << 30)) ^
        ((a >>> 13) | (a << 19)) ^
        ((a >>> 22) | (a << 10));
      // Maj(a, b, c) (optimized the same way as SHA-1)
      maj = (a & b) | (c & (a ^ b));

      // main algorithm
      t1 = h + s1 + ch + _k[i] + _w[i];
      t2 = s0 + maj;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }

    // update hash state
    s.h0 = (s.h0 + a) | 0;
    s.h1 = (s.h1 + b) | 0;
    s.h2 = (s.h2 + c) | 0;
    s.h3 = (s.h3 + d) | 0;
    s.h4 = (s.h4 + e) | 0;
    s.h5 = (s.h5 + f) | 0;
    s.h6 = (s.h6 + g) | 0;
    s.h7 = (s.h7 + h) | 0;
    len -= 64;
  }

  return s;
};

sha256._createState = function() {
  var state = {
    h0: 0x6A09E667,
    h1: 0xBB67AE85,
    h2: 0x3C6EF372,
    h3: 0xA54FF53A,
    h4: 0x510E527F,
    h5: 0x9B05688C,
    h6: 0x1F83D9AB,
    h7: 0x5BE0CD19
  };
  state.copy = function() {
    var rval = sha256._createState();
    rval.h0 = state.h0;
    rval.h1 = state.h1;
    rval.h2 = state.h2;
    rval.h3 = state.h3;
    rval.h4 = state.h4;
    rval.h5 = state.h5;
    rval.h6 = state.h6;
    rval.h7 = state.h7;
    return rval;
  };
  state.write = function(buffer) {
    buffer.putInt32(state.h0);
    buffer.putInt32(state.h1);
    buffer.putInt32(state.h2);
    buffer.putInt32(state.h3);
    buffer.putInt32(state.h4);
    buffer.putInt32(state.h5);
    buffer.putInt32(state.h6);
    buffer.putInt32(state.h7);
  };
  return state;
};

sha256._init = function() {
  // create K table for SHA-256
  sha256._k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];

  // used for word storage
  sha256._w = new Array(64);
};

})(_nodejs);

if(!XMLSerializer) {

var _defineXMLSerializer = function() {
  XMLSerializer = require('xmldom').XMLSerializer;
};

}

jsonld.url = {};

jsonld.url.parse = require('jsonld-url-parse');

var nodeStatusCodes = require('node-status-codes');
var request = require('superagent');
var cache = new require('cache-service-cache-module')();
var prune = function(res) {
  if (res.redirects && res.redirects.length && res.redirects.length > 0) {
    console.log('res5a');
    console.log(res);
    console.log('request.cache8');
    console.log(request.cache);
    //var cache1 = request.cache.get.toString();
    var cache1 = request.cache.get(
        '{"method":"GET","uri":"http://json-ld.org/test-suite/tests/remote-doc-0001-in.jsonld","params":null,"options":null}',
        function(err, cached) {
          console.log('err');
          console.log(err);
          console.log('cached1');
          console.log(cached);
        });
    console.log('cache1');
    console.log(cache1);
    //*
    var cache7 = request.cache.get(
        '{"method":"GET","uri":"http://json-ld.org/test-suite/tests/remote-doc-0007-in.jsonld","params":null,"options":null}',
        function(err, cached) {
          console.log('err');
          console.log(err);
          console.log('cached7');
          console.log(cached);
        });
    console.log('cache7');
    console.log(cache7);
    //*/
  }
  return {
    body: res.body,
    text: res.text,
    headers: res.headers,
    statusCode: res.statusCode,
    status: res.status,
    ok: res.ok,
    redirects: res.redirects
  };
};
require('superagent-cache')(request, cache, {prune: prune});

//*
function initMe() {
  var testUrl = 'http://json-ld.org/test-suite/tests/remote-doc-0007-in.jsonld';
  //var testUrl = 'https://jigsaw.w3.org/HTTP/300/301.html';
  request
    .get(testUrl)
    //.set('Accept', 'application/ld+json, application/json')
    .end(function(err, res) {
      console.log('err');
      console.log(err);
      console.log('res32');
      console.log(res);
    });
}
initMe();
//*/

jsonld.documentLoaderCreator = function(options) {
  options = options || {};
  var strictSSL = ('strictSSL' in options) ? options.strictSSL : true;
  var maxRedirects = ('maxRedirects' in options) ? options.maxRedirects : 0;

  function loadDocument(url, callback) {
    console.log('url48: ' + url);
    if(url.indexOf('http:') !== 0 && url.indexOf('https:') !== 0) {
      return callback(new JsonLdError(
        'URL could not be dereferenced; only "http" and "https" URLs are ' +
        'supported.',
        'jsonld.InvalidUrl', {code: 'loading document failed', url: url}),
        {contextUrl: null, documentUrl: url, document: null});
    }
    if(options.secure && url.indexOf('https') !== 0) {
      return callback(new JsonLdError(
        'URL could not be dereferenced; secure mode is enabled and ' +
        'the URL\'s scheme is not "https".',
        'jsonld.InvalidUrl', {code: 'loading document failed', url: url}),
        {contextUrl: null, documentUrl: url, document: null});
    }

    var acceptTypes = [
      'application/ld+json',
      'application/json'
    ];

    request
      .get(url)
      //.redirects(5)
      //.redirects(maxRedirects)
      .set('Accept', acceptTypes.join(', '))
      .end(handleResponse);

    function handleResponse(err, res, key) {
      console.log('key');
      console.log(key);
      var body = res.body;
      var documentUrl = url;
      var redirects = res.redirects;
      if (redirects) {
        var redirectsLength = redirects.length;
        if (redirectsLength && redirectsLength > 0) {
          documentUrl = redirects[redirectsLength - 1];
        }
      }
      if (url === 'http://json-ld.org/test-suite/tests/remote-doc-0005-in.jsonld') {
        console.log('res51');
        console.log(res);
      }
      doc = {contextUrl: null, documentUrl: documentUrl, document: body || null};

      var responseContentType = res.headers['content-type'];
      if (!responseContentType.match(/^application\/(.*\+)?json$/)) {
        err = new Error('Response content type does not match request Accept header.')
      }

      // handle error
      if(err) {
        return callback(new JsonLdError(
          'URL could not be dereferenced, an error occurred.',
          'jsonld.LoadDocumentError',
          {code: 'loading document failed', url: url, cause: err}), doc);
      }
      var statusText = nodeStatusCodes[res.statusCode];
      if(res.statusCode >= 400) {
        return callback(new JsonLdError(
          'URL could not be dereferenced: ' + statusText,
          'jsonld.InvalidUrl', {
            code: 'loading document failed',
            url: url,
            httpStatusCode: res.statusCode
          }), doc);
      }

      // handle Link Header
      if(res.headers.link && responseContentType !== 'application/ld+json') {
        // only 1 related link header permitted
        var linkHeader = jsonld.parseLinkHeader(
          res.headers.link)[LINK_HEADER_REL];
        if(_isArray(linkHeader)) {
          return callback(new JsonLdError(
            'URL could not be dereferenced, it has more than one associated ' +
            'HTTP Link Header.',
            'jsonld.InvalidUrl',
            {code: 'multiple context link headers', url: url}), doc);
        }
        if(linkHeader) {
          doc.contextUrl = linkHeader.target;
        }
      }

      return callback(err, doc);
    }
  }

  return loadDocument;
};

jsonld.documentLoader = jsonld.documentLoaderCreator();

module.exports = function() {
  return jsonld;
};
