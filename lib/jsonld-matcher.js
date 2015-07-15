/* JSON-LD @set and @list intersection
 * Tabular data like data sources (set or list of objects)
 * Search criteria like a db name and an identifier, sorted by the preference for matching ()
 * Given tabular data , we want to find one row that matches
 * a provided object.
 *
 * First, we pull out the keys from the provided object that match the column headers
 * in the tabular data.
 *
 * Then we try matching any of the values for each of those keys.
 */

var _ = require('lodash');
//var hyperquest = require('hyperquest');
//var JSONStream = require('JSONStream');
var Rx = require('rx');

module.exports = function(jsonldrx) {
  'use strict';

  var cache = jsonldrx._cache;
  var internalContext;
  var embedContexts = jsonldrx.embedContexts;
  var normalize = jsonldrx.normalize;

  var normalizationNSBase = 'jsonldMatcher';
  var jsonldNormalizationNS = normalizationNSBase + 'JsonldNormalized';
  var textNormalizationNS = normalizationNSBase + 'TextNormalized';

  function _removeNormalizedProperties(args) {
    return _.reduce(args, function(result, value, key) {
      if (key.indexOf(normalizationNSBase) !== 0) {
        result[key] = value;
      }
      return result;
    }, {});
  }

  function _addNormalizedProperties(input, selectedKeys) {
    return Rx.Observable.pairs(input)
    .filter(function(pair) {
      return !selectedKeys ? true : selectedKeys.indexOf(pair[0]) > -1;
    })
    .flatMap(function(pair) {
      return _jsonldNormalizePair(pair)
      .flatMap(function(jsonldNormalizedPair) {
        return _textNormalizePair(jsonldNormalizedPair)
        .flatMap(function(textNormalizedPair) {
          return [
            pair,
            jsonldNormalizedPair,
            textNormalizedPair
          ];
        });
      })
      .map(function(pairs) {
        return pairs;
      });
    })
    .reduce(input, function(accumulator, pair) {
      accumulator[pair[0]] = pair[1];
      return accumulator;
    });
  }

  function _jsonldNormalizePair(pair) {
    var doc = {};
    doc['@context'] = internalContext;
    doc[pair[0]] = pair[1];

    /*
    console.log('pair');
    console.log(pair);
    //*/

    return embedContexts(doc)
      .flatMap(function(doc) {
        console.log('doc');
        console.log(doc);
        return normalize(doc);
      })
      .map(function(normalized) {
        console.log('normalized');
        console.log(normalized);
        var elementDelimiter = ' .\n';
        var normalizedValues = normalized.split(elementDelimiter);
        console.log('normalizedValues');
        console.log(normalizedValues);
        // Get rid of last element, which will always be '' (empty string)
        normalizedValues.pop();
        return normalizedValues;
      })
      .map(function(normalizedValues) {
        var key = jsonldNormalizationNS + pair[0];
        return [key, normalizedValues];
      });
  }

  /**
   * @private
   *
   * Normalize text for comparison purposes
   *
   * @param {undefined|null|string|number|object|boolean|date} inputText
   * @return {string} normalizedText
   */
  function normalizeText(inputText) {
    var stringifiedInput = inputText;
    if (!_.isString(inputText)) {
      if (_.isNumber(inputText) || _.isRegExp(inputText) ||
          _.isDate(inputText) || _.isBoolean(inputText)) {
        stringifiedInput = inputText.toString();
      } else if (_.isPlainObject(inputText)) {
        stringifiedInput = JSON.stringify(inputText);
      } else if (_.isUndefined(inputText)) {
        stringifiedInput = 'undefined';
      } else if (_.isNull(inputText)) {
        stringifiedInput = 'null';
      } else {
        console.warn('Cannot normalize provided value "' +
          JSON.stringify(inputText) + '".');
        console.warn('Using toString on input.');
        stringifiedInput = inputText.toString();
      }
    }
    // not using \w because we don't want to include the underscore
    var identifierPattern = /[^A-Za-z0-9]/gi;
    var alphanumericText = stringifiedInput.replace(identifierPattern, '');
    var normalizedText = alphanumericText;
    // This could be null if the inputText were something like '-..-'
    if (!_.isNull(alphanumericText)) {
      normalizedText = alphanumericText.toUpperCase();
    }
    return normalizedText;
  }

  function _textNormalizePair(pair) {
    var pairSource;
    if (pair[0].indexOf(jsonldNormalizationNS) === -1) {
      pairSource = _jsonldNormalizePair(pair);
    } else {
      pairSource = Rx.Observable.from([pair]);
    }

    console.log('pairSource');
    console.log(pairSource);

    return pairSource.map(function(pair) {
      console.log('pairSourcepair');
      console.log(pair);
      var key = textNormalizationNS +
                (pair[0]).replace(jsonldNormalizationNS, '');
      var value;
      if (_.isArray(pair[1])) {
        value = pair[1].map(normalizeText);
      } else {
        value = normalizeText(pair[1]);
      }
      return [key, value];
    });
  }

  /**
   * tieredFind
   *
   * @param {Object} args the element we are trying to match
   * @param {Object} source An RxJs Observable that we are searching to find a match
   * @param {String} name
   * @param {String[]} selectedKeys Keys for values that will positively identify the match
   * @param {Function[]} alternateFilters Filter functions that will positively identify the match.
   * @param {String|String[]|Object|Object[]} providedInternalContext
   * @return {Object} matching item from the source
   */
  function tieredFind(args, source, name, selectedKeys, alternateFilters, providedInternalContext) {
    internalContext = providedInternalContext;
    // if an @id is provided, we will use it. We will search for a matching
    // @id and for a match in owl:sameAs.
    if (!!args['@id']) {
      args['owl:sameAs'] = args['owl:sameAs'] || [];
      args['owl:sameAs'].push(args['@id']);
      if (selectedKeys.indexOf('@id') === -1) {
        selectedKeys.push('@id');
      }
      if (selectedKeys.indexOf('owl:sameAs') === -1) {
        selectedKeys.push('owl:sameAs');
      }
    }

    alternateFilters = alternateFilters || [];

    var getPairSource = function() {
      return Rx.Observable.pairs(args).filter(function(pair) {
        console.log('pair193');
        console.log(pair);
        return selectedKeys.indexOf(pair[0]) > -1;
      });
    };

    var isEmpty = true;

    var normalizedSource = source.flatMap(function(data) {
      return _addNormalizedProperties(data, selectedKeys);
    })
    .map(function(value) {
      console.log('value202');
      console.log(value);
      return value;
    })
    .toArray();

    //*
    var normalizedSourceCache = new Rx.ReplaySubject(1);
    normalizedSourceCache.subscribe(normalizedSource);
    //*/

    //*
    normalizedSource.subscribe(function(value) {
      // do something
      console.log('value209');
      console.log(value);
    }, function(err) {
      throw err;
      // do something
    }, function() {
      // on complete
    });
    //*/

    return normalizedSourceCache
      .flatMap(function(element) {
        console.log('element216');
        console.log(element);
        // First we try the built-in, preferred filters
        return Rx.Observable.merge(
          getPairSource().flatMap(function(pair) {
            return tieredFindAttempt(pair, element, 0);
          })

          /*
          getPairSource().filter(function(pair) {
            return selectedKeys.indexOf(pair[0]) > -1;
          })
          .flatMap(function(pair) {
            return tieredFindAttempt(pair, element, 1);
          }),

          getPairSource().filter(function(pair) {
            return selectedKeys.indexOf(pair[0]) > -1;
          })
          .flatMap(function(pair) {
            return tieredFindAttempt(pair, element, 2);
          })
          //*/
        )
        // If the preferred filters don't find anything, we try
        // any provided alternate filters.
        /*
        .concat(
          alternateFilters.map(function(alternateFilter) {
            return Rx.Observable.return(element).filter(alternateFilter);
          })
        )
        // If we still don't find anything, we return an error.
        .concat(Rx.Observable.return(
          function() {
            var message = 'Could not find a match for ' + name +
              ' for the provided args "' + JSON.stringify(args) + '"';
            var err = new Error(message);
            return err;
          }()
        ))
        //*/
        .map(function(value) {
          console.log('value238');
          console.log(value);
          return value;
        })
        //.first()
        /*
        // TODO why is this not throwing an error when the codeblock
        // above returns one?
        .errors(function(err, push) {
          if (isEmpty) {
            return push(err);
          }
        })
        // TODO The chunk of code below seems like a kludge.
        // 1) It is trying to detect errors, which should be
        //    taken care of above.
        // 2) It is returning the first non-empty stream, but
        //    to do so requires using this "isEmpty" variable,
        //    which seems wrong.
        .flatMap(function(inputStream) {
          if (highland.isStream(inputStream) && isEmpty) {
            return inputStream.map(function(data) {
              isEmpty = false;
              return data;
            });
          } else if (!isEmpty) {
            return highland([]);
          } else {
            throw inputStream;
          }
        });
        //*/
      })
      .map(_removeNormalizedProperties);
  }

  var pairByAttemptIndex = [
    function(pair) {
      return Rx.Observable.from([pair]);
    },
    // second attempt. if previous failed, we normalize it with a JSON-LD context.
    _jsonldNormalizePair,
    // third attempt. if previous failed, we get a little looser
    // about the match here on this attempt.
    function(pair) {
      return Rx.Observable.from([pair]).flatMap(_textNormalizePair);
    }
  ];

  function tieredFindAttempt(pair, element, attemptIndex) {
    console.log('tieredFindAttemptpair');
    console.log(pair);
    return pairByAttemptIndex[attemptIndex](pair)
    .flatMap(function(currentPair) {
      console.log('currentPair');
      console.log(currentPair);
      return Rx.Observable.from(element).filter(function(data) {
        return data[currentPair[0]] === currentPair[1] ||
          !_.isEmpty(
            _.intersection(
              data[currentPair[0]], currentPair[1]
            )
          );
      });
    });
  }

  return {
    _addNormalizedProperties: _addNormalizedProperties,
    tieredFind: tieredFind,
    _jsonldNormalizePair: _jsonldNormalizePair,
    normalizeText: normalizeText,
    _removeNormalizedProperties: _removeNormalizedProperties,
    _textNormalizePair: _textNormalizePair,
  };
}
