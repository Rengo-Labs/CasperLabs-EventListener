var mongoose = require("mongoose");
var Schema = mongoose.Schema;

const listenerEventsDataSchema = new Schema({
	deployHash: {
		type: String,
	},
	eventName: {
		type: String,
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

var listenerEventsData = mongoose.model("listenerEventsData", listenerEventsDataSchema);
module.exports = listenerEventsData;