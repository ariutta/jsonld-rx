  var nodeStatusCodes = require('node-status-codes');
  var request = require('superagent');
  /* TODO superagent-cache makes the jsonld normalization redirect tests fail
  var cache = new require('cache-service-cache-module')();
  var prune = function(res) {
    console.log('res');
    console.log(res);
    if (res.redirects && res.redirects.length && res.redirects.length > 0) {
      console.log('res5a');
      console.log(res);
      console.log('request.cache8');
      console.log(request.cache);
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
  //*/

  /* // For some reason, the test passes when this block is enabled,
     // possibly because it results in a redirects array being attached
     // to the cache entry for doc-0001.
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
      //console.log('url48: ' + url);
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
        if (!res.text) {
         res.body = null;
        }
        var body = res.body;
        var documentUrl = url;
        var redirects = res.redirects;
        if (redirects) {
          var redirectsLength = redirects.length;
          if (redirectsLength && redirectsLength > 0) {
            documentUrl = redirects[redirectsLength - 1];
          }
        }
        /*
        if (url === 'http://json-ld.org/test-suite/tests/remote-doc-0005-in.jsonld') {
          console.log('res51');
          console.log(res);
        }
        //*/
        doc = {contextUrl: null, documentUrl: documentUrl, document: body || null};

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
        var responseContentType = res.headers['content-type'];
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

  //return jsonld;

  // Converts jsonld to jsonldRx.
  // For original source of this, see
  // https://github.com/ariutta/jsonld-rx/blob/3e22fa21b713b18462ba625f1201fc021704c4ef/lib/main.js
  var jsonldAsyncMethodNames = [
    'compact',
    'expand',
    'flatten',
    'frame',
    'fromRDF',
    'normalize',
    'toRDF'
  ];

  var jsonldMethodNames = Object.keys(jsonld).filter(function(methodName) {
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

  return jsonldRx;
}

// TODO is this the best design pattern to use?
// used to generate a new jsonld API instance
var factory = function() {
  return wrapper(function() {
    return factory();
  });
};

wrapper(factory);

module.exports = factory;
