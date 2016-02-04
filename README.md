I stripped out any functionality not in the jsonld.js API and moved it into jsonld-rx-extra.

TODO: It's working without a Node.js cache, but there's a problem with the superagent-cache when there are redirects.

Clone these two repos as sibling directories of your local jsonld-rx repo directory:

```
git clone https://github.com/json-ld/normalization.git
git clone https://github.com/json-ld/json-ld.org.git
```

```
mkdir auto-generated
export JSDIR='../auto-generated'
node ./scripts/build.js
cp -r ./node_modules/jsonld/tests/ ./auto-generated/tests
./node_modules/mocha/bin/mocha ./auto-generated/tests/test.js 
```

