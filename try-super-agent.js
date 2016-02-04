var request = require('superagent');
var prune = function(res) {
  console.log('res4a');
  console.log(res);
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
require('superagent-cache')(request, null, {prune: prune});

//var url = 'http://webservice.bridgedb.org/Human/xrefs/L/1234';
//var url = 'http://json-ld.org/test-suite/tests/remote-doc-0001-in.jsonld';
var url = 'http://json-ld.org/test-suite/tests/remote-doc-0005-in.jsonld';
//var url = 'http://json-ld.org/test-suite/tests/remote-doc-0004-in.jldte';
//var url = 'http://www.google.com';

request
  .get(url)
  .set('Accept', 'application/ld+json, application/json')
  .end(function(err, res) {
    console.log('err');
    console.log(err);
    console.log('res32');
    console.log(res);
    /*
    console.log('res.headers');
    console.log(res.headers);
    console.log('res.body');
    console.log(res.body);
    //*/
  });

setTimeout(function() {
  request
    .get(url)
    .set('Accept', 'application/ld+json, application/json')
    .end(function(err, res) {
      console.log('err');
      console.log(err);
      console.log('res45');
      console.log(res);
    });
}, 1500);

/*
var request = require('request');
request({
  url: url,
  headers: {
    'Accept': 'application/ld+json, application/json'
  },
  followRedirect: false
}, function(error, response, body) {
  console.log('error');
  console.log(error);
  console.log('body');
  console.log(body);
});
//*/
