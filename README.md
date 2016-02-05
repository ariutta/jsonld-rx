# jsonld-rx

This is a work-in-progress. It will be an [RxJS](https://github.com/Reactive-Extensions/RxJS) wrapper for [jsonld.js](https://github.com/digitalbazaar/jsonld.js), but it is currently just a slimmed-down version of `jsonld.js`, without any `RxJS` integration.

From pre-existing code, I stripped out any functionality not in the `jsonld.js` API and moved it into `jsonld-rx-extra`.

TODO: It's working without a Node.js cache, but there's a problem with redirects when `superagent-cache` is enabled.

## Installation

```
git clone https://github.com/ariutta/jsonld-rx.git
cd jsonld-rx
npm install
```

## Testing

Clone the following two repos as sibling directories of the directory for your local `jsonld-rx` repo:

```
git clone https://github.com/json-ld/normalization.git
git clone https://github.com/json-ld/json-ld.org.git
```

Then run the tests: `npm test`

If you're not on Windows, you can also run the tests with color: `npm run test-color`
