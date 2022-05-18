var mongoose = require("mongoose");
var Schema = mongoose.Schema;

const packageHashesSchema = new Schema({
	id:{
		type:String
	},
	packageHashes: [{
		type: String,
	}]
	
});

var packageHashes = mongoose.model("packageHashes", packageHashesSchema);
module.exports = packageHashes;