# jsonld-rx

This is an [RxJS](https://github.com/Reactive-Extensions/RxJS) wrapper for [jsonld.js](https://github.com/digitalbazaar/jsonld.js).

From pre-existing code, I stripped out any functionality not in the `jsonld.js` API and moved it into `jsonld-rx-extra`.

## Installation

```
git clone https://github.com/ariutta/jsonld-rx.git
cd jsonld-rx
npm install
```

## Testing

TODO: It's working without a Node.js cache, but there's a problem with redirects when `superagent-cache` is enabled.
TODO: The tests don't work for jsonldRx. Need to change ./lib/after.js to just return jsonld (uncomment `return jsonld;`) and rebuild before running tests.

Clone the following two repos as sibling directories of the directory for your local `jsonld-rx` repo:

```
git clone https://github.com/json-ld/normalization.git
git clone https://github.com/json-ld/json-ld.org.git
```

Then run the tests: `npm test`

If you're on Windows, you may need to instead run: `npm run test-windows`
