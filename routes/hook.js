// Initialize WebHooks module.
var WebHooks = require('node-webhooks');
 
// Initialize webhooks module with object; changes will only be
// made in-memory
var webHooks = new WebHooks({
    db: {"addPost": ["https://casper-uniswap-v2-graphql.herokuapp.com/"]}, // our backend link
})
 
// sync instantation - add a new webhook called 'hook'
webHooks.add('hook', 'https://casper-uniswap-v2-graphql.herokuapp.com/geteventsdata').then(function(){
    // done
}).catch(function(err){
    console.log(err)
})

var emitter = webHooks.getEmitter()
 
exports.webHooks = webHooks;
exports.emitter = emitter;


 