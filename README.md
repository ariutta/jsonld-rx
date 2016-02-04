# jsonld-rx

This is a work-in-progress. It will be an [RxJS](https://github.com/Reactive-Extensions/RxJS) wrapper for [jsonld.js](https://github.com/digitalbazaar/jsonld.js), but it currently is just a slimmed down version of jsonld.js with no RxJS wrapper.

From pre-existing code, I stripped out any functionality not in the jsonld.js API and moved it into jsonld-rx-extra.

TODO: It's working without a Node.js cache, but there's a problem with the superagent-cache when there are redirects.

## Installation

```
git clone https://github.com/ariutta/jsonld-rx.git
cd jsonld-rx
npm install
mkdir auto-generated
node ./scripts/build.js
cp -r ./node_modules/jsonld/tests/ ./auto-generated/tests
```

## Testing

Clone these two repos as sibling directories of your local jsonld-rx repo directory:

```
git clone https://github.com/json-ld/normalization.git
git clone https://github.com/json-ld/json-ld.org.git
```

Then export the location of the jsonld.js file and run the tests:

```
export JSDIR='../auto-generated'
./node_modules/mocha/bin/mocha ./auto-generated/tests/test.js 
```
