# @indexed-finance/indexed.js

TypeScript libraries for using the Indexed core contracts.

### Usage

**Get helper classes for all pools**

```js
const { getAllHelpers, toWei, fromWei } = require('@indexed-finance/indexed.js');

const helpers = await getAllHelpers(web3);

// Get input amount