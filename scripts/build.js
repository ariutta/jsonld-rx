var falafel = require('falafel');
var fs = require('fs');
var grasp = require('grasp');
var path = require('path');
var Rx = require('rx-extra');

function falafelRx(code, opts) {
  opts = opts || {};
  var subject = new Rx.ReplaySubject();
  var result = falafel(code, opts, function(node) {
    subject.onNext(node);
    if (node.type === 'Program') {
      subject.onCompleted();
    }
  });
  return subject;
}

var beforeString = fs.readFileSync(path.join(__dirname, '..', 'lib', 'before.js'));
var afterString = fs.readFileSync(path.join(__dirname, '..', 'lib', 'after.js'));

var neededFunctions = [
  'wrapper',
];
var sourcePath = path.join(__dirname, '..', 'node_modules', 'jsonld', 'js', 'jsonld.js');
var sourceString = fs.readFileSync(sourcePath);
falafelRx(sourceString)
  .filter(function(node) {
    //grasp '[test =#_nodejs]' ./node_modules/jsonld/js/jsonld.js
    if (node.test && node.test.name === '_nodejs') {
      return false;
    }

    //grasp 'var-dec[id=#wrapper][init=func-exp].init.body>*' ./node_modules/jsonld/js/jsonld.js
    return node.id && (node.id.name === 'wrapper') && node.init && node.init.body &&
      node.init.type === 'FunctionExpression' && node.init.body.body;
  })
  .reduce(function(accumulator, node) {
    accumulator = accumulator.concat(
      node.init.body.body
        .filter(function(item) {
          console.log('**********************************');
          console.log(item.source());
          if (item.argument && item.argument.name === 'jsonld') {
            return false;
          }

          if (item.test && item.test.name === '_nodejs') {
            return false;
          }

          if (item.expression && item.expression.callee) {
            var callee = item.expression.callee;
            if (callee.object && callee.object.name === 'jsonld' &&
                callee.property && callee.property.name === 'promises') {
              return false;
            }
          }

          if (item.expression && item.expression.left) {
            var left = item.expression.left;

            if (left.object && left.object.name === 'jsonld' &&
                left.property && left.property.name === 'promises') {
              return false;
            }
            if (left.object && left.object.object && left.object.object.object &&
                left.object.object.object.name === 'jsonld' &&
                left.object.object.property &&
                left.object.object.property.name === 'promises') {
              return false;
            }

            if (left.object && left.object.name === 'jsonld' &&
                left.property && left.property.name === 'RequestQueue') {
              return false;
            }
            if (left.object && left.object.object && left.object.object.object &&
                left.object.object.object.name === 'jsonld' &&
                left.object.object.property &&
                left.object.object.property.name === 'RequestQueue') {
              return false;
            }
            if (left.object && left.object.name === 'jsonld' &&
                left.property && left.property.name === 'promisify') {
              return false;
            }
            if (left.object && left.object.name === 'JsonLdProcessor' &&
                left.property && left.property.name === 'prototype') {
              return false;
            }

            if (left.object && left.object.object &&
                left.object.object.name === 'jsonld' &&
                left.object.property &&
                left.object.property.name === 'documentLoaders'
                /*
                left.object.property.name === 'documentLoaders' &&
                left.property &&
                (left.property.name === 'jquery' ||
                  left.property.name === 'xhr')
                //*/
                ) {
              return false;
            }
            if (left.object && left.object.name === 'jsonld' &&
                left.property && left.property.name === 'documentLoaders') {
              return false;
            }
            if (left.object && left.object.name === 'jsonld' &&
                left.property && left.property.name === 'useDocumentLoader') {
              return false;
            }
            if (left.object && left.object.name === 'jsonld' &&
                left.property && left.property.name === 'documentLoader') {
              return false;
            }
            if (left.object && left.object.name === 'jsonld' &&
                left.property && left.property.name === 'loadDocument') {
              return false;
            }

            console.log('left');
            console.log(left);
          }
          return item.source;
        })
        .map(function(item) {
          return item.source();
        })
    );

    return accumulator;
  }, [beforeString])
  .map(function(chunks) {
    return chunks.concat([afterString]);
  })
  .map(function(chunks) {
    return chunks.join('\n\n')
  })
  .map(function(outputString) {
    return outputString.replace(/var\ promise\ =\ /g, '');
      //.replace(/jsonld\.documentLoaders\.node/g, 'jsonld.documentLoaderCreator')
      //.replace(/var\ http\ \=\ require\('http'\);/g, '')
      //.replace(/http.STATUS_CODES/g, 'nodeStatusCodes');
  })
  .map(function(outputString) {
    return grasp.replace('squery', 'if!.test #promise', ' ', outputString);
  })
  .map(function(outputString) {
    return grasp.replace('squery',
        'exp-statement!' +
            '[expression.left.object.name=jsonld][expression.left.property.name=objectify]',
        ' ',
        outputString);
  })
  .subscribe(function(outputString) {
    console.log('outputString');
    console.log(outputString);

    var destPath = path.join(__dirname, '..', 'index.js');
    fs.writeFileSync(destPath, outputString, {encoding: 'utf8'});
  }, function(err) {
    throw err;
  }, function() {
    console.log('completed');
  });
