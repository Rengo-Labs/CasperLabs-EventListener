var mongoose = require("mongoose");
var Schema = mongoose.Schema;

const eventsDataSchema = new Schema({
	deployHash: {
		type: String,
	},
	eventName: {
		type: String,
	},
	status:{
		type:String,
	},
	eventType:{
		type:String,
	},
	timestamp: {
		type: Number,
	},
	block_hash: {
		type: String,
	},
	eventsdata: {
		type: Object,
	},
});

var eventsData = mongoose.model("eventsData", eventsDataSchema);
module.exports = eventsData;