var nodeStatusCodes = require('node-status-codes');
//var request = require('superagent-cache')();
var request = require('superagent');

jsonld.documentLoaderCreator = function(options) {
    options = options || {};
    var strictSSL = ('strictSSL' in options) ? options.strictSSL : true;
    var maxRedirects = ('maxRedirects' in options) ? options.maxRedirects : -1;

    function loadDocument(url, callback) {
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
        .redirects(maxRedirects)
        .set('Accept', acceptTypes.join(', '))
        .end(handleResponse);

      function handleResponse(err, res) {
        var body = res.body;
        var documentUrl = url;
        var redirects = res.redirects;
        if (redirects) {
          var redirectsLength = redirects.length;
          if (redirectsLength && redirectsLength > 0) {
            documentUrl = redirects[redirectsLength - 1];
          }
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

jsonld.documentLoaders = {};
jsonld.documentLoaders.jquery = jsonld.documentLoaders.node = jsonld.documentLoaders.xhr =
    jsonld.documentLoaderCreator;

jsonld.documentLoader = jsonld.documentLoaderCreator();

module.exports = function() {
  return jsonld;
};
