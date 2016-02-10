var Rx = require('rx-lite');
require('rx-thenable')(Rx);
var _removeDotSegments = require('remove-dot-segments');

var _nodejs = false;
var _browser = !_nodejs;

if (typeof XMLSerializer === 'undefined') {
  /* jshint ignore:start */
  XMLSerializer = require('xmldom').XMLSerializer;
  /* jshint ignore:end */
}

function wrapper(jsonld) {
