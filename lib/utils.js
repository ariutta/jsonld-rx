var _ = require('lodash');
var Rx = require('rx');

/**
 * Convert an input into an array, if it is not already.
 *
 * @param {*} arg
 * @return {array} arrayified version on input arg
 */
function arrayify(arg) {
  return _.isArray(arg) ? arg : [arg];
}

/**
 * Convert an input into an array, if it is not already.
 * If the input is falsey but not false or 0, return an empty array.
 *
 * @param {*} arg
 * @return {array} arrayified version on input arg
 */
function arrayifyClean(arg) {
  if (!arg && arg !== false && arg !== 0) {
    return [];
  }
  return arrayify(arg);
}

var defaultsDeep = _.partialRight(_.merge, function deep(value, other) {
  return _.merge(value, other, deep);
});

function hierarchicalPartition(inputSource, partitioner, parentResetSource) {
  var latestValue;
  var loopbackSource = new Rx.Subject();

  var mainAndResetSource = Rx.Observable.merge(
      inputSource
        .map(function(value) {
          latestValue = value;
          return value;
        }),
      loopbackSource
  )
    .partition(partitioner);

  var mainSource = mainAndResetSource[0];
  var thisResetSource = mainAndResetSource[1];
  var resetSource;
  if (parentResetSource) {
    resetSource = parentResetSource.merge(thisResetSource);
  } else {
    resetSource = thisResetSource;
  }
  return {
    mainSource: mainSource,
    resetSource: resetSource,
    loopback: function() {
      loopbackSource.onNext(latestValue);
    }
  };
}

module.exports = {
  arrayify: arrayify,
  arrayifyClean: arrayifyClean,
  defaultsDeep: defaultsDeep,
  hierarchicalPartition: hierarchicalPartition
};
