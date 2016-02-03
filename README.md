TODO: this hasn't been tested yet. I stripped out any functionality not in the jsonld.js API and move it into jsonld-rx-extra, but haven't tested either of these yet.

```
node ./scripts/build.js
cp -r ./node_modules/jsonld/tests/ ./tests
./node_modules/mocha/bin/mocha ./tests/test.js 
```

