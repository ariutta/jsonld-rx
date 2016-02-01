var _ = require('lodash');
var jsonld = require('jsonld');
var LRU = require('lru-cache');
var rxQuest = require('rx-quest');
var rxJSONStream = require('rx-json-stream');
var RxNode = require('rx-node-extra');
var Rx = RxNode.Rx;

var JsonldRx = function(options) {
  options = options || {};
  /*
  // properties to delete because they aren't needed in this library
  [
    'Promise',
    'promises',
    'Promisify'
  ].forEach(function(methodName) {
    delete jsonld[methodName];
  });
  //*/

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

    if (dereferencedDocumentSourceCache) {
      return dereferencedDocumentSourceCache;
    }

    var dereferencedDocumentSource = rxQuest
      .get(iri, {
        withCredentials: false
      })
      //.let(rxJSONStream.parse('*'))
      .let(rxJSONStream.parse(true))

    dereferencedDocumentSourceCache = new Rx.ReplaySubject(1);
    cache.set(iri, dereferencedDocumentSourceCache);
    dereferencedDocumentSource.subscribe(function(value) {
      dereferencedDocumentSourceCache.onNext(value);
    }, function(err) {
      throw err;
    }, function() {
      dereferencedDocumentSourceCache.onCompleted();
    });
    return dereferencedDocumentSourceCache;
  }

  jsonld.documentLoader = function(iri, callback) {
    dereferenceDocument(iri).subscribe(function(body) {
      var doc = {contextUrl: null, documentUrl: iri, document: body || null};
      callback(null, doc);
    }, function(err) {
      callback(err);
    });
  };

  jsonldRx._dereferenceDocument = dereferenceDocument;
  return jsonldRx;
};

module.exports = JsonldRx;
