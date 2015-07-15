var JsonldRx = require('../../index.js');
var jsonldRx = new JsonldRx();

var globalContext = [];
// TODO update this to remove test2.
//globalContext.push('http://test2.wikipathways.org/v2/contexts/pathway.jsonld');
globalContext.push('https://wikipathwayscontexts.firebaseio.com/biopax/.json');
globalContext.push('https://wikipathwayscontexts.firebaseio.com/organism/.json');
globalContext.push('https://wikipathwayscontexts.firebaseio.com/cellularLocation/.json');
globalContext.push('https://wikipathwayscontexts.firebaseio.com/display/.json');
globalContext.push('https://wikipathwayscontexts.firebaseio.com/bridgedb/.json');

jsonldRx.mergeContexts(globalContext)
  .subscribe(function(value) {
    console.log(value);
  });
