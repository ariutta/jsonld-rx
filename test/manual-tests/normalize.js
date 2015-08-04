var JsonldRx = require('../../index.js');
var jsonldRx = new JsonldRx();

jsonldRx.defaultNormalize({
  '@context': ['https://wikipathwayscontexts.firebaseio.com/bridgedb/.json'],
  'alternatePrefix':['Bc']
})
.subscribe(function(value) {console.log(value)})
