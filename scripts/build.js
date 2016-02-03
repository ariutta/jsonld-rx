var falafel = require('falafel');
var fs = require('fs');
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

var outputChunks = [];
var beforeString = fs.readFileSync(path.join(__dirname, '..', 'lib', 'before.js'));
outputChunks.push(beforeString);

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
  .subscribe(function(node) {
    outputChunks = outputChunks.concat(
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

          // TODO get rid of all the code sections from jsonld.js that look like the following:
          /*
          var promise = options.documentLoader(input, done);
          if(promise && 'then' in promise) {
            promise.then(done.bind(null, null), done);
          }
          //*/

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
            //jsonld.promises({api: jsonld.promises});

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
  }, function(err) {
    throw err;
  }, function() {
    var afterString = fs.readFileSync(path.join(__dirname, '..', 'lib', 'after.js'));
    outputChunks.push(afterString);

    var outputString = outputChunks.join('\n\n');
      //.replace(/jsonld\.documentLoaders\.node/g, 'jsonld.documentLoaderCreator')
      //.replace(/var\ http\ \=\ require\('http'\);/g, '')
      //.replace(/http.STATUS_CODES/g, 'nodeStatusCodes');
    /*
    console.log('outputString');
    console.log(outputString);
    //*/

    var destPath = path.join(__dirname, '..', 'index.js');
    fs.writeFileSync(destPath, outputString, {encoding: 'utf8'});
    console.log('completed');
  });
