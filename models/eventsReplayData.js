var mongoose = require("mongoose");
var Schema = mongoose.Schema;

const eventsReplayDataSchema = new Schema({
	blockHeight: {
		type: String,
	},
	blockData: {
		type: Object
	},
	deployData:{
		type:Object
	},
	status: {
		type: String,
	},
});

var eventsReplayData = mongoose.model("eventsReplayData", eventsReplayDataSchema);
module.exports = eventsReplayData;