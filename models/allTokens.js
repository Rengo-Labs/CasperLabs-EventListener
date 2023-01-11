var mongoose = require('mongoose');
var Schema = mongoose.Schema;

const allTokensDataSchema = new Schema({
    
    contractHash:{type: String},
    packageHash:{type: String}
    
});

var allTokensData = mongoose.model("allTokensData", allTokensDataSchema);
module.exports = allTokensData;
