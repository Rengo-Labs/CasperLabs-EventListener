const genericPool = require("generic-pool");

/**
 * Step 1 - Create pool using a factory object
 */
const factory = {
  create: function() {},
  destroy: function() {}
};

const opts = {
  max: 10, // maximum size of the pool
};

const myPool = genericPool.createPool(factory, opts);

/**
 * Step 2 - Use pool in your code to acquire/release resources
 */

// acquire connection - Promise is resolved
// once a resource becomes available

myPool.acquire()
.then(async function(resource) {
    console.log("resource started work...");
    console.log("resource ended work...");

    console.log("releasing resource...");
    // return object back to pool
    await myPool.release(resource);
    console.log("resource released...");
})
.catch(function(err) {
    // handle error - this is generally a timeout or maxWaitingClients
    // error
    console.log("resource error: ",err);
});

/**
 * Step 3 - Drain pool during shutdown (optional)
 */
// Only call this once in your application -- at the point you want
// to shutdown and stop using this pool.
// myPool.drain().then(function() {
//   myPool.clear();
// });