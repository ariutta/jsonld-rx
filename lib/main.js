var _ = require('lodash');
var hyperquest = require('hyperquest');
var jsonld = require('jsonld');
//var JsonldMatcher = require('./jsonld-matcher.js');
//var JsonldMatcher = require('./streaming-jsonld-matcher.js');
var JSONStream = require('JSONStream');
var LRU = require('lru-cache');
var Rx = require('rx');
var RxNode = require('rx-node');
var utils = require('./utils.js');

Rx.Observable.prototype.toNodeCallback = function(cb) {
  var source = this;
  return function() {
    var val;
    var hasVal = false;
    source.subscribe(
      function(x) {
        hasVal = true;
        val = x;
      },
      function(e) {
        cb(e);
      },
      function() {
        if (hasVal) {
          cb(null, val);
        }
      }
    );
  };
};

var JsonldRx = function(options) {
  options = options || {};
  // properties to delete because they aren't needed in this library
  [
    'Promise',
    'promises',
    'Promisify'
  ].forEach(function(methodName) {
    delete jsonld[methodName];
  });

  var jsonldAsyncMethodNames = [
    'compact',
    'expand',
    'flatten',
    'frame',
    'fromRDF',
    'normalize',
    'toRDF'
  ];

  var jsonldMethodNames = _.keys(jsonld).filter(function(methodName) {
    return typeof jsonld[methodName] === 'function';
  });

  var jsonldRx = jsonldMethodNames.reduce(function(accumulator, methodName) {
    var method = jsonld[methodName];
    if (jsonldAsyncMethodNames.indexOf(methodName) > -1) {
      accumulator[methodName] = Rx.Observable.fromNodeCallback(method);
    } else {
      accumulator[methodName] = method;
    }
    return accumulator;
  }, {});

  jsonldRx.defaultContext = options.defaultContext;
  // TODO fix this
  jsonldRx._runOnceGlobal = options._runOnceGlobal;

  // jsonld.compact return this
  // callback(err, compacted, ctx)
  // so jsonldRx.compact will
  // return [compacted, ctx]

  var cacheOptions = {
    max: 500,
    length: function(n) {
      return n * 2;
    },
    dispose: function(key, n) {
      n.close();
    },
    maxAge: 1000 * 60 * 60
  };
  var cache = jsonldRx._cache = LRU(cacheOptions);

  function dereferenceDocument(iri) {
    var dereferencedDocumentSourceCache = cache.get(iri);

    console.log('iri');
    console.log(iri);

    if (dereferencedDocumentSourceCache) {
      console.log('retrieving cached - ke');
      /*
      dereferencedDocumentSourceCache.subscribe(function(value) {
        console.log('value105');
        console.log(value);
      }, function(err) {
        throw err;
      }, function() {
        console.log('done');
      });
      //*/
      return dereferencedDocumentSourceCache
        .map(function(value) {
          console.log('value103');
          console.log(value);
          return value;
        });
    }

    console.log('nothing cached - ke');

    var dereferencedDocumentSource = RxNode.fromReadableStream(
        hyperquest(iri, {
          withCredentials: false
        })
        .pipe(JSONStream.parse())
      )
      .map(function(dereferencedDocument) {
        console.log('dereferencedDocument');
        console.log(dereferencedDocument);
        return dereferencedDocument;
      });

    dereferencedDocumentSourceCache = new Rx.ReplaySubject(1);
    cache.set(iri, dereferencedDocumentSourceCache);
    dereferencedDocumentSource.subscribe(function(value) {
      console.log('value126');
      console.log(value);
      dereferencedDocumentSourceCache.onNext(value);
    }, function(err) {
      throw err;
    }, function() {
      dereferencedDocumentSourceCache.onCompleted();
    });
    return dereferencedDocumentSourceCache;
  }

  //*
  jsonld.documentLoader = function(iri, callback) {
    //var cache = new jsonld.DocumentCache();
    console.log('iri134');
    console.log(iri);
    console.log('callback136');
    console.log(callback);
    //return dereferenceDocument(iri).toNodeCallback(callback);
    return dereferenceDocument(iri).subscribe(function(body) {
      console.log('body141');
      console.log(body);
      var doc = {contextUrl: null, documentUrl: iri, document: body || null};
      console.log('doc144');
      console.log(doc);
      callback(null, doc);
    }, function(err) {
      console.log('err144');
      console.log(err);
      callback(err);
    });
  };
  //*/

  /**
   * dereferenceContext
   *
   * @param {String|String[]|Object|Object[]} inputContext
   * @return {Object} output same as input, except any contexts
   *    referenced as IRIs (external contexts) are dereferenced (embedded)
   */
  function dereferenceContext(inputContext) {
    if (!inputContext || _.isPlainObject(inputContext)) {
      return Rx.Observable.return(inputContext);
    }

    var inputContextArray = utils.arrayifyClean(inputContext);

    console.log('inputContextArray for dereferenceContext');
    console.log(inputContextArray);

    return Rx.Observable.from(inputContextArray)
      .flatMap(function(inputContextElement) {
        // A inputContextElement can be any of the following:
        // * the full inputContext, if the inputContext is an IRI
        // * one of one or more contexts, if the inputContext is an array,
        //   each element of which can be either:
        //   - an IRI (external) or
        //   - a plain object (embedded)

        console.log('inputContextElement for dereferenceContext');
        console.log(inputContextElement);

        if (!_.isString(inputContextElement)) {
          return Rx.Observable.return(inputContextElement);
        }

        return dereferenceDocument(inputContextElement)
          .map(function(contextEnvelope) {
            return contextEnvelope['@context'];
          });
      })
      .toArray();
  }

  /**
   * dereferenceOneContext
   *
   * @param {String} iri referencing an external context
   * @return {Object} context dereferenced (embedded)
   */
  function dereferenceOneContext(iri) {
    return dereferenceContext(iri)
      .map(function(contextArray) {
        return contextArray[0];
      });
  }

  /**
   * embedContexts
   *
   * @param {Object} input
   * @param {String|String[]|Object|Object[]} [input['@context']] the
   *    document's context or docContext
   * @return {Object} output same as input, except any contexts referenced
   *    as IRIs (external contexts) are dereferenced (embedded)
   */
  // TODO this doesn't handle in-line contexts within the body of the document
  function embedContexts(doc) {
    var docContext = doc['@context'];
    if (!docContext) {
      return Rx.Observable.return(docContext);
    }

    return dereferenceContext(docContext)
      .map(function(embeddedDocContext) {
        doc['@context'] = embeddedDocContext;
        return doc;
      });
  }

  function getValueIdsAndKeysFromContext(context) {
    console.log('context179');
    console.log(context);
    return _.pairs(context).reduce({}, function(accumulator, pair) {
      var key = pair[0];
      var value = pair[1];
      var valueId;
      if (_.isString(value)) {
        valueId = value;
      } else if (value['@id']) {
        valueId = value['@id'];
      } else if (value['@reverse']) {
        return;
      } else {
        console.log(value);
        throw new Error('Cannot handle this context value.');
      }
      if (valueId) {
        accumulator[valueId] = key;
      }
      return accumulator;
    });
  }

  function getValueIdsAndKeysFromContextMappings(mappings) {
    console.log('mappings262');
    console.log(mappings);
    return _.pairs(mappings).reduce({}, function(accumulator, pair) {
      var key = pair[0];
      var value = pair[1];
      var valueId;
      if (value['@id']) {
        valueId = value['@id'];
      } else {
        console.log(value);
        throw new Error('Cannot handle this context value.');
      }
      accumulator[valueId] = key;
      return accumulator;
    });
  }

  /**
   * replaceContext Use a new context but otherwise avoid changes, e.g.,
   * keep free-floating nodes.
   *
   * @param {String|String[]|Object|Object[]} inputDoc
   * @param {String|String[]|Object|Object[]} newContext
   * @return {Object|Object[]} resultDoc
   */
  jsonldRx.replaceContext = function(inputDoc, newContext) {
    return jsonldRx.expand(inputDoc, {keepFreeFloatingNodes: true})
      .flatMap(function(expanded) {
        return jsonldRx.compact(expanded, newContext, {skipExpansion: true});
      })
      .map(function(compactedAndCtx) {
        // return just the document, not the extra ctx element
        return compactedAndCtx[0];
      });
  };

  /**
   * mergeContexts
   *
   * If multiple contexts are provided, any name or valueId collisions
   * will be resolved by using the name or valueId, respectively, from
   * the latest context (the one with the largest index in the provided
   * array of contexts).
   *
   * @param {String|String[]|Object|Object[]} contexts
   * @return {Object} mergedContext
   */
  //*
  jsonldRx.mergeContexts = function(contexts) {
    console.log('contexts to merge');
    console.log(contexts);
    if (_.isPlainObject(contexts)) {
      return Rx.Observable.return(contexts);
    } else if (_.isString(contexts)) {
      return dereferenceContext(contexts);
    }

    var cacheKey = JSON.stringify(contexts);

    var mergedContextSourceCache = cache.get(cacheKey);

    if (mergedContextSourceCache) {
      //console.log('retrieving cached - ke');
      return mergedContextSourceCache;
    }

    //console.log('nothing cached - ke');

    var mergedContextSource = Rx.Observable.from(contexts)
      .distinct(JSON.stringify)
      .flatMap(dereferenceOneContext)
      .flatMap(function(context) {
        // Doing this because the context processor method
        // doesn't appear to be public.
        var placeholderDoc = {
          '@context': context,
          '@id': 'http://example.org/placeholder',
          '@type': 'gpml:GeneProduct'
        };
        return jsonldRx.compact(placeholderDoc, context)
          .map(function(result) {
            var newContext = result[1];
            var inverse = newContext.inverse;
            console.log('inverse305');
            console.log(inverse);
            return newContext;
          });
      })
      .reduce(function(accumulator, preferredContext) {
        var base = preferredContext['@base'].href;
        if (base) {
          accumulator['@base'] = base;
        }
        var vocab = preferredContext['@vocab'];
        if (vocab) {
          accumulator['@vocab'] = vocab;
        }
        // handle the first one, which is an empty object {}
        if (!accumulator.inverse) {
          _.assign(accumulator, preferredContext.mappings);
          return accumulator;
        }
        console.log('accumulator');
        console.log(accumulator);
        // TODO what about a context with @base or @vocab wrt names and valueIds?
        // We might think there's a collision when there really is not.

        // handle any valueId collisions
        var inverseAccumulator = getValueIdsAndKeysFromContext(accumulator);
        //var inversePreferredContext = getValueIdsAndKeysFromContext(preferredContext);
        //var inversePreferredContext = preferredContext.inverse;
        var inversePreferredContext = getValueIdsAndKeysFromContextMappings(
            preferredContext.mappings);
        var valueIdCollisions = _.intersection(
            _.keys(inverseAccumulator), _.keys(inversePreferredContext));
        valueIdCollisions
          .map(function(valueId) {
            return inverseAccumulator[valueId];
          })
          .forEach(function(accumulatorKey) {
            console.log('Deleting key ' + accumulatorKey + ' due to valueId collision.');
            delete accumulator[accumulatorKey];
          });

        var nameCollisions = _.intersection(
            _.keys(accumulator), _.keys(preferredContext));
        nameCollisions
          .forEach(function(accumulatorKey) {
            console.log('Overwriting key ' + accumulatorKey + ' due to name collision.');
          });
        // Add properties from preferred context, overwriting any name collisions
        accumulator = _.assign(accumulator, preferredContext.mappings);
        return accumulator;
      }, {});

    mergedContextSourceCache = new Rx.ReplaySubject(1);
    mergedContextSource.subscribe(function(value) {
      console.log('value278');
      console.log(value);
      mergedContextSourceCache.onNext(value);
    }, function(err) {
      throw err;
    }, function() {
      mergedContextSourceCache.onCompleted();
    });
    cache.set(cacheKey, mergedContextSourceCache);
    return mergedContextSourceCache;
  };
  //*/

  jsonldRx.arrayify = utils.arrayify;
  jsonldRx.arrayifyClean = utils.arrayifyClean;

  /* runOnceGlobally does not work yet
  var jsonldMatcher = jsonldRx._matcher = new JsonldMatcher(jsonldRx);
  jsonldRx.normalizeText = jsonldMatcher._normalizeText;
  jsonldRx.tieredFind = jsonldMatcher.tieredFind;
  //*/

  return jsonldRx;
};

module.exports = JsonldRx;
